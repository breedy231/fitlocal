# FitLocal DB Safety Runbook

Written after the April 21 incident where several weeks of workout logs were lost
to an avoidable WAL-recovery mistake during initial diagnosis. Read this **before**
touching a suspected-bad database.

## Rule #1: Back up all three files before running anything

If `fitlocal.db` is misbehaving (server won't start, errors on open, unexpected
row counts), the **first** action is to copy all three WAL-mode files aside:

```bash
cd /path/to/fitlocal
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p db-backups
cp fitlocal.db       db-backups/fitlocal.db.$TS
cp fitlocal.db-shm   db-backups/fitlocal.db-shm.$TS  2>/dev/null || true
cp fitlocal.db-wal   db-backups/fitlocal.db-wal.$TS  2>/dev/null || true
```

**Why all three?** SQLite in WAL mode stores uncommitted pages in `fitlocal.db-wal`
and a coordination index in `fitlocal.db-shm`. Opening the DB with the `sqlite3`
CLI — even just to inspect it — triggers WAL recovery: SQLite tries to merge the
WAL into the main file and, if the WAL is partially corrupt, **discards pages it
can't apply**. This is exactly what lost the April data. With all three files
copied aside, you can always reconstruct the pre-mortem state on another machine.

The `db-backups/` directory at repo root is gitignored — never commit it.

## Rule #2: Stop the server before diagnostics

Stop whatever is running the API (the `npm run dev` process locally, or the
production process/container). A running server holds locks, writes new pages,
and can make the WAL-recovery problem worse. Stop it first.

## Order of operations on a suspect DB

1. **Back up all three files** (see Rule #1).
2. **Stop the server** (see Rule #2).
3. **Try automatic WAL checkpoint on a copy first**, not the original:
   ```bash
   cp db-backups/fitlocal.db.$TS /tmp/fitlocal-test.db
   cp db-backups/fitlocal.db-wal.$TS /tmp/fitlocal-test.db-wal 2>/dev/null || true
   sqlite3 /tmp/fitlocal-test.db "PRAGMA integrity_check;"
   ```
   If integrity check passes on the copy, move it into place — don't open the
   original until you have a verified good candidate.
4. **If integrity fails**, look at the most recent online backup:
   ```bash
   ls -lt ~/fitlocal-backups/ | head
   ```
   Backups in `~/fitlocal-backups/` are sqlite3 `.backup` outputs — they're
   complete, WAL-merged snapshots and don't have `-shm`/`-wal` sidecars. Copy
   the newest passing one over `fitlocal.db` and delete any stale `-shm`/`-wal`
   in the repo root.
5. **Verify restore** before restarting the server:
   ```bash
   sqlite3 fitlocal.db "PRAGMA integrity_check;"
   sqlite3 fitlocal.db "SELECT COUNT(*) FROM workouts;"
   ```
6. **Restart the server** (`npm run dev` locally, or redeploy in production) and
   watch the logs to confirm a clean boot.

## What's protecting the DB now

After Stream 5 and Stream 5b, there are five independent safety nets:

| Layer | What it does | Failure window |
|---|---|---|
| `wal_autocheckpoint = 100` (db.ts) | Merges WAL into main DB every ~400 KB of writes | Minutes of data |
| Graceful shutdown checkpoint (server.ts) | `wal_checkpoint(TRUNCATE)` on SIGTERM/SIGINT | Only ungraceful kills bypass |
| Pre-start backup (`npm run backup`) | Snapshot before every dev restart | — |
| Scheduled backup (`scripts/backup-db.sh`) | Online `.backup` to `~/fitlocal-backups/` | 1 hour |
| Tiered retention (prune-backups.py) | 24 hourly + 14 daily + 8 weekly | — |

If any one layer fails, another one covers you.

In production, the primary safety net is **Litestream**, which streams WAL changes
to Cloudflare R2 every second and restores on container start (see `litestream.yml`
and `scripts/docker-entrypoint.sh`).

## Common failure modes

- **"database disk image is malformed" on open**: WAL applied to corrupted main
  file. Restore from latest `~/fitlocal-backups/` snapshot. Do NOT `sqlite3
  fitlocal.db` first — it'll make it worse.
- **Server won't start after crash**: usually stale `-shm` lock. If integrity
  check passes, `rm fitlocal.db-shm fitlocal.db-wal` and restart. (Do Rule #1
  first so you can undo.)
- **Schema mismatch after checkout**: run `npm run build -w packages/api` to
  re-run migrations on boot. Not a corruption issue.
- **Unexpected row count after "recovery"**: you lost writes to WAL-recovery
  discarding pages. Compare against most recent hourly backup; if the backup
  has more rows, restore it.

## Finding out what was lost

Every backup is a full snapshot. To see what existed at a given point:

```bash
# How many workouts in the hourly backup from 3am today?
sqlite3 ~/fitlocal-backups/fitlocal-20260423-030000.db "SELECT COUNT(*) FROM workouts;"

# Which workouts are in the backup but not in the current DB?
sqlite3 fitlocal.db "ATTACH '~/fitlocal-backups/fitlocal-20260423-030000.db' AS b;
  SELECT b.id, b.date FROM b.workouts b
  LEFT JOIN workouts w ON w.id = b.id
  WHERE w.id IS NULL;"
```

Don't merge blindly — if the current DB has rows created after the backup, a
straight restore loses them. Use `ATTACH` + targeted `INSERT` for partial
recoveries.
