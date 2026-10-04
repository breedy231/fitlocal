#!/bin/bash
# SessionStart hook: make a fresh Claude Code on the web clone runnable.
# Installs deps, builds packages/shared (fitlocal-shared resolves to its
# gitignored dist/), and generates packages/web/.svelte-kit so svelte-check
# works. No-op on the Mac. See docs/cloud-sessions.md.
#
# Doesn't seed a DB or touch .env: each agent seeds its own scratchpad DB, and
# an empty .env would make older `export $(grep … .env)` snippets dump the
# whole environment.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
LOG="${TMPDIR:-/tmp}/fitlocal-session-start.log"
: > "$LOG"

# `npm ci`, not `npm install`: install rewrites package-lock.json with metadata
# churn. Skip it when the cached container already matches the lockfile
# (npm writes node_modules/.package-lock.json on every install).
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund >> "$LOG" 2>&1
fi

npm run build -w packages/shared >> "$LOG" 2>&1
(cd packages/web && npx svelte-kit sync) >> "$LOG" 2>&1

# Stdout becomes session context: keep it to one pointer.
echo "Cloud setup done (deps installed, packages/shared built; log: $LOG). There is no data yet: seed a scratchpad DB before running the API. See docs/cloud-sessions.md."
