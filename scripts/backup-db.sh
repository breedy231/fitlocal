#!/usr/bin/env bash
# Online backup of fitlocal.db using sqlite3 .backup (WAL-safe, atomic).
# Writes to ~/fitlocal-backups/ with a timestamped filename. Prunes files older than 14 days.
#
# Safe to run against a live database — .backup uses the SQLite online backup API
# and coordinates with any active writers via the shared cache / page lock protocol.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/fitlocal.db"
DEST_DIR="${FITLOCAL_BACKUP_DIR:-$HOME/fitlocal-backups}"
RETENTION_DAYS="${FITLOCAL_BACKUP_RETENTION_DAYS:-14}"

if [[ ! -f "$SRC" ]]; then
  echo "[backup-db] no DB at $SRC — nothing to back up" >&2
  exit 0
fi

mkdir -p "$DEST_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
DEST="$DEST_DIR/fitlocal-$TS.db"
TMP="$DEST.partial"

# Online backup. Uses the SQLite backup API; does NOT require the server to be stopped.
sqlite3 "$SRC" ".backup '$TMP'"

# Verify the copy is readable and integrity-clean before promoting it.
if ! sqlite3 "$TMP" "PRAGMA integrity_check;" | grep -q '^ok$'; then
  echo "[backup-db] integrity check FAILED on fresh backup $TMP — keeping as .corrupt for inspection" >&2
  mv "$TMP" "$DEST.corrupt"
  exit 2
fi

mv "$TMP" "$DEST"
# sqlite3 opens a DB in WAL mode, which creates sidecar -shm/-wal files during
# the integrity check. They're empty for a just-written backup — discard them
# so the backup directory contains one file per snapshot.
rm -f "$TMP-shm" "$TMP-wal"
echo "[backup-db] wrote $DEST ($(du -h "$DEST" | cut -f1))"

# Prune old backups. Only deletes files whose names match our format, so it can't
# accidentally remove unrelated files a user drops in this directory.
find "$DEST_DIR" -maxdepth 1 -type f -name 'fitlocal-*.db' -mtime "+$RETENTION_DAYS" -print -delete \
  | sed 's/^/[backup-db] pruned /' || true
