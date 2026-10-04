#!/bin/sh
set -e

# APP_DIR is overridable only so this script can be exercised outside the
# container; in the image it is always /app (the Dockerfile WORKDIR).
APP_DIR="${APP_DIR:-/app}"
LITESTREAM_CONFIG="$APP_DIR/litestream.yml"

: "${DATABASE_PATH:?DATABASE_PATH must be set}"

# Ensure the directory for the DB file exists
mkdir -p "$(dirname "$DATABASE_PATH")"

# Restore DB from R2 on cold start (no local DB present).
#
# Fail closed: if there is no replica to restore, refuse to boot. A missing
# replica almost always means a wrong bucket/path secret or an emptied bucket,
# not a new app. The old -if-replica-exists behaviour exited 0 in that case and
# production came up on a brand-new empty database (and started replicating it).
# Set BOOTSTRAP_EMPTY_DB=1 only for the first deploy of a new app or a deliberate
# reset, then unset it (`fly secrets unset BOOTSTRAP_EMPTY_DB`).
#
# -integrity-check full runs PRAGMA integrity_check on the restored file;
# Litestream deletes the file and exits non-zero if it fails.
if [ ! -f "$DATABASE_PATH" ]; then
  if [ "${BOOTSTRAP_EMPTY_DB:-0}" = "1" ]; then
    echo "No local database found — restoring from R2 (BOOTSTRAP_EMPTY_DB=1: an empty replica is allowed)..."
    IF_REPLICA_EXISTS="-if-replica-exists"
  else
    echo "No local database found — restoring from R2..."
    IF_REPLICA_EXISTS=""
  fi

  if ! litestream restore \
      -config "$LITESTREAM_CONFIG" \
      -integrity-check full \
      $IF_REPLICA_EXISTS \
      "$DATABASE_PATH"; then
    # Don't leave a partial file behind: a later boot would see it and skip restore.
    rm -f "$DATABASE_PATH" "$DATABASE_PATH-wal" "$DATABASE_PATH-shm"
    echo "FATAL: restore from R2 failed (no replica, bad credentials/bucket/path, or failed integrity check)." >&2
    echo "FATAL: refusing to start on an empty database. Check the Litestream secrets and the replica (see DB-SAFETY.md, Production)." >&2
    echo "FATAL: set BOOTSTRAP_EMPTY_DB=1 only if this is a brand-new app with no data to restore." >&2
    exit 1
  fi

  if [ -f "$DATABASE_PATH" ]; then
    echo "Restore complete (integrity check passed)."
  else
    echo "WARNING: BOOTSTRAP_EMPTY_DB=1 and no replica found in R2 — starting with an EMPTY database."
    echo "WARNING: unset BOOTSTRAP_EMPTY_DB once this first boot is done, or a misconfigured replica will fail open again."
  fi
fi

# Run node under Litestream. With `replicate -exec`, Litestream is PID 1 and node
# is its child: Litestream streams the WAL to R2 while node runs, forwards Fly's
# kill_signal to node, waits for node to exit, then does a final sync to R2
# before exiting (see kill_timeout in fly.toml). If node exits, Litestream exits.
echo "Starting server with Litestream replication..."
exec litestream replicate \
  -config "$LITESTREAM_CONFIG" \
  -exec "node $APP_DIR/packages/api/dist/server.js"
