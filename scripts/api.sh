#!/usr/bin/env bash
# Thin curl wrapper for the FitLocal API — handles bearer auth + base URL so you
# don't re-type `source .env` / `Authorization: Bearer ...` on every call.
#
# Since the M2 cleanup (#34), prod enforces bearer auth on all /api/* routes
# except /api/health. The token lives in the project-root .env as FITLOCAL_API_KEY.
#
# Usage:
#   scripts/api.sh GET  /workouts
#   scripts/api.sh GET  /workouts/2948
#   scripts/api.sh POST /sets '{"workoutExerciseId":25031,"reps":8,"weightKg":61.2,"completed":true}'
#   scripts/api.sh PATCH /sets/123 '{"reps":10}'
#   scripts/api.sh -d GET /workouts        # hit local dev API (no /api prefix)
#
# Flags:
#   -d, --dev   Target http://localhost:3001 (dev has NO /api prefix) instead of prod.
#
# Output is the raw response body — pipe to `jq` yourself, e.g.
#   scripts/api.sh GET /workouts | jq '.[0]'
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROD_BASE="https://fitlocal-app.fly.dev/api"
DEV_BASE="http://localhost:3001"
BASE="$PROD_BASE"

if [[ "${1:-}" == "-d" || "${1:-}" == "--dev" ]]; then
  BASE="$DEV_BASE"
  shift
fi

METHOD="${1:-}"
PATH_="${2:-}"
BODY="${3:-}"

if [[ -z "$METHOD" || -z "$PATH_" ]]; then
  echo "usage: scripts/api.sh [-d|--dev] METHOD PATH [JSON_BODY]" >&2
  echo "example: scripts/api.sh GET /workouts" >&2
  exit 2
fi

# Load FITLOCAL_API_KEY from .env if not already in the environment.
if [[ -z "${FITLOCAL_API_KEY:-}" && -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

# Prod requires the token (dev works without it, so only warn for prod).
if [[ -z "${FITLOCAL_API_KEY:-}" && "$BASE" == "$PROD_BASE" ]]; then
  echo "[api] FITLOCAL_API_KEY not set and not found in $REPO_ROOT/.env — prod will 401" >&2
fi

# PATH_ may be given with or without a leading slash.
[[ "$PATH_" == /* ]] || PATH_="/$PATH_"

args=(-sS -X "$METHOD" "$BASE$PATH_")
[[ -n "${FITLOCAL_API_KEY:-}" ]] && args+=(-H "Authorization: Bearer $FITLOCAL_API_KEY")
if [[ -n "$BODY" ]]; then
  args+=(-H "Content-Type: application/json" -d "$BODY")
fi

curl "${args[@]}"
