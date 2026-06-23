#!/usr/bin/env bash
# Copy the dev DB to a throwaway scratch file, then run the API against it.
#
# Why: in dev the API opens fitlocal.db in the repo root (DATABASE_PATH unset),
# so ANY write-test — manual taps, Playwright flows, curl, the AI assistant's
# tools — mutates real workout data. This script points the API at a disposable
# copy (/tmp/fitlocal-scratch.db) so test writes never touch the real DB.
#
# The copy is one-shot: the scratch file is overwritten from the current real DB
# on every launch, so each session starts from a fresh snapshot of real data.
# The real fitlocal.db is only ever READ here, never written.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/fitlocal.db"
SCRATCH="${SCRATCH_DB_PATH:-/tmp/fitlocal-scratch.db}"

# Start clean: drop any scratch file (+ WAL-mode sidecars) from a prior run.
rm -f "$SCRATCH" "$SCRATCH-wal" "$SCRATCH-shm"

if [[ -f "$SRC" ]]; then
  # Read-only online backup via the SQLite backup API. This is WAL-safe even if
  # a dev server is holding the real DB open, and it produces a single merged
  # file (no -wal/-shm sidecars to copy). Never writes to $SRC.
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$SRC" ".backup '$SCRATCH'"
  else
    # Fallback: plain copy of the main DB + any sidecars, so the scratch DB sees
    # the same state including un-checkpointed WAL writes.
    cp "$SRC" "$SCRATCH"
    [[ -f "$SRC-wal" ]] && cp "$SRC-wal" "$SCRATCH-wal"
    [[ -f "$SRC-shm" ]] && cp "$SRC-shm" "$SCRATCH-shm"
  fi
  echo "[scratch-db] copied $SRC -> $SCRATCH ($(du -h "$SCRATCH" | cut -f1))"
else
  # No real DB yet (fresh checkout): start the API on an empty scratch DB. The
  # API's migrate step creates the schema on boot.
  echo "[scratch-db] no DB at $SRC — starting API on an empty scratch DB at $SCRATCH" >&2
fi

echo "[scratch-db] launching API with DATABASE_PATH=$SCRATCH (writes are isolated; real DB untouched)"
DATABASE_PATH="$SCRATCH" exec npm run dev -w packages/api
