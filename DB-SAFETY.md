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
| Graceful shutdown checkpoint (server.ts) | `wal_checkpoint(TRUNCATE)` on SIGTERM/SIGINT, 100 ms busy timeout (falls back to PASSIVE if another process holds a read lock, so it never stalls shutdown) | Only ungraceful kills bypass |
| Pre-start backup (`npm run backup`) | Snapshot before every dev restart | — |
| Scheduled backup (`scripts/backup-db.sh`) | Online `.backup` to `~/fitlocal-backups/` | 1 hour |
| Tiered retention (prune-backups.py) | 24 hourly + 14 daily + 8 weekly | — |

If any one layer fails, another one covers you.

In production, the primary safety net is **Litestream**, which streams WAL changes
to Cloudflare R2 every second and restores on container start (see `litestream.yml`
and `scripts/docker-entrypoint.sh`). See [Production](#production) below.

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

## Production

The Fly machine's disk is ephemeral: every start is a blank slate. The only
durable copy of production data is the Litestream replica in R2 (bucket
`fitlocal-db`, prefix `fitlocal/`). What protects it:

| Layer | What it does |
|---|---|
| Replication (`litestream.yml`) | Streams the WAL to R2 every 1s |
| Snapshots + retention (`litestream.yml`) | Full snapshot every 6h, kept 8 days, so point-in-time restore reaches back at least 7 days. (Litestream 0.5's default was 24h.) |
| Fail-closed restore (`scripts/docker-entrypoint.sh`) | Cold start restores from R2 with `-integrity-check full`, and refuses to boot if there's no replica or the check fails |
| DB-backed health check (`/api/health`) | Reads `workouts`; returns 503 if the DB is unusable, so Fly marks the machine unhealthy |
| Shutdown window (`fly.toml`, `litestream.yml`) | `kill_timeout = 30` and `shutdown-sync-timeout: 20s` give Litestream time for its final sync to R2 when the machine stops |

### Machine won't boot: "FATAL: restore from R2 failed"

That's the fail-closed restore working. **Don't** set `BOOTSTRAP_EMPTY_DB=1` to
get past it: that starts production on an empty database. Check the Litestream
secrets (`fly secrets list`: `LITESTREAM_BUCKET`, `R2_ACCOUNT_ID`,
`LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`) and confirm the
replica exists by listing it locally (below). `BOOTSTRAP_EMPTY_DB=1` is only for
the first deploy of a brand-new app. Unset it right after that first boot.

### Restore the R2 replica to a local file

Use this to inspect production data, prove the backup is restorable, or recover.

1. Install the Litestream version pinned in `packages/api/Dockerfile`
   (`LITESTREAM_VERSION`, currently 0.5.12) from its GitHub release page.
2. In Cloudflare, create an R2 API token with **Object Read** only, scoped to
   `fitlocal-db`. Fly secrets can't be read back, and a read-only token can't
   damage the replica.
3. Restore from the repo root using the repo's `litestream.yml`. `DATABASE_PATH`
   only selects the DB entry in the config, so set it to the production path.
   Nothing is written there.

   ```bash
   export LITESTREAM_BUCKET=fitlocal-db R2_ACCOUNT_ID=<account-id> \
          LITESTREAM_ACCESS_KEY_ID=<token-key-id> LITESTREAM_SECRET_ACCESS_KEY=<token-secret> \
          DATABASE_PATH=/app/fitlocal.db
   mkdir -p db-backups   # gitignored

   # List restore points (level 9 = full snapshots, with timestamps)
   litestream ltx -config litestream.yml -level 9 /app/fitlocal.db

   # Latest state
   litestream restore -config litestream.yml -integrity-check full \
     -o db-backups/prod-latest.db /app/fitlocal.db

   # Or a point in time (UTC), e.g. just before a bad write
   litestream restore -config litestream.yml -integrity-check full \
     -timestamp 2026-09-27T12:00:00Z -o db-backups/prod-pitr.db /app/fitlocal.db
   ```

   Add `-dry-run` to see which files a restore would use without writing anything.

4. Verify before trusting it:

   ```bash
   sqlite3 db-backups/prod-latest.db "PRAGMA integrity_check;"   # must print: ok
   sqlite3 db-backups/prod-latest.db "
     SELECT 'workouts', COUNT(*), MAX(date) FROM workouts
     UNION ALL SELECT 'sets', COUNT(*), NULL FROM sets
     UNION ALL SELECT 'health_snapshots', COUNT(*), MAX(date) FROM health_snapshots;"
   ```

   The latest `workouts` date should match the most recent workout in the app,
   and counts should never be lower than those of an older restore.

### Put a restore back into production

- **R2 is fine but the machine is bad:** `fly machine restart` (or redeploy). The
  disk comes back blank, so the entrypoint restores the latest state from R2.
- **Roll production back to an earlier point:** never delete or overwrite the
  `fitlocal/` prefix. Seed a new prefix from the verified file (this needs a
  read-write token), then point production at it:

  ```bash
  sed 's/^      path: fitlocal$/      path: fitlocal-restored-20260927/' litestream.yml > db-backups/litestream-restored.yml
  DATABASE_PATH="$PWD/db-backups/prod-pitr.db" \
    litestream replicate -config db-backups/litestream-restored.yml -once -force-snapshot
  ```

  Then set `path: fitlocal-restored-20260927` in `litestream.yml` and deploy.
  Production writes made after the restore point are not in the new prefix, so
  pull out anything you need first (see "Finding out what was lost"). The old
  prefix stays intact as a fallback.

### Hardening R2 (manual, Cloudflare dashboard)

R2 does not support S3 bucket versioning (`PutBucketVersioning` is unimplemented
in Cloudflare's R2 S3-compatibility table, checked 2026-09-27). A deleted object
is gone, and so is a replica wiped with the production credentials. Instead:

- Make the token in Fly's secrets an R2 token scoped to `fitlocal-db` with
  object read/write only, not an account-wide admin token.
- Keep a copy outside Litestream's control: periodically run the restore above
  and keep the dated file (e.g. with the dev backups in `~/fitlocal-backups/`),
  or upload it to a separate bucket protected by an R2 bucket lock.
- Don't put a bucket lock on the `fitlocal/` prefix itself. Litestream deletes
  its own files there (L0 files after ~5 min, snapshots past retention), and a
  lock would refuse those deletes.
