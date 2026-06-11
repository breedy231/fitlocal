#!/bin/sh
set -e

# Ensure the directory for the DB file exists
mkdir -p "$(dirname "$DATABASE_PATH")"

# Restore DB from R2 on cold start (no local DB present)
if [ ! -f "$DATABASE_PATH" ]; then
  echo "No local database found — restoring from R2..."
  litestream restore \
    -config /app/litestream.yml \
    -if-replica-exists \
    "$DATABASE_PATH"
  if [ -f "$DATABASE_PATH" ]; then
    echo "Restore complete."
  else
    echo "No replica found in R2 — starting with a fresh database."
  fi
fi

# Start Litestream as the replication wrapper, with node as the managed process.
# -exec means node is PID 1; Railway health checks and SIGTERM work correctly.
echo "Starting server with Litestream replication..."
exec litestream replicate \
  -config /app/litestream.yml \
  -exec "node /app/packages/api/dist/server.js"
