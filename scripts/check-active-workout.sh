#!/usr/bin/env bash
# Pre-deploy guard: detect an in-progress workout session on production before a
# `fly deploy` restarts the single Fly machine (which would drop the connection
# and risk in-flight set PATCHes). See issue #60.
#
# "Active workout session" definition (kept deliberately simple/defensible):
#   A workout dated TODAY (server-side date, America/Chicago) that has at least
#   one uncompleted set (`completed = false`). Sets carry no timestamps, so a
#   time-window heuristic isn't possible; "today + has uncompleted sets" is the
#   closest reliable proxy for "user is mid-session".
#
# Exit codes:
#   0  no active workout found  -> safe to deploy
#   1  could not determine state (API unreachable / auth / parse error)
#   2  an active workout WAS found -> caller should warn + require confirmation
#
# Usage:
#   scripts/check-active-workout.sh
#   Reads FITLOCAL_API_KEY from the environment, or from .env if present.
#   Override the target with FITLOCAL_API_BASE (defaults to prod).

set -euo pipefail

API_BASE="${FITLOCAL_API_BASE:-https://fitlocal-app.fly.dev/api}"

# Load the API key from .env if not already in the environment.
if [[ -z "${FITLOCAL_API_KEY:-}" ]]; then
  ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC2046
    export $(grep -E '^FITLOCAL_API_KEY=' "$ENV_FILE" | xargs) || true
  fi
fi

if [[ -z "${FITLOCAL_API_KEY:-}" ]]; then
  echo "check-active-workout: FITLOCAL_API_KEY not set (env or .env)" >&2
  exit 1
fi

# Today in the user's timezone — workout dates are stored as local YYYY-MM-DD.
# FITLOCAL_CHECK_TODAY overrides the reference date (for testing the clean path).
TODAY="${FITLOCAL_CHECK_TODAY:-$(TZ=America/Chicago date +%F)}"

# Fetch recent workouts. The list endpoint exposes `date` + `setCount` but not
# per-set completion, so we use it only to find today's workout id(s), then hit
# the detail endpoint for completion state.
LIST_JSON="$(curl -sf -H "Authorization: Bearer $FITLOCAL_API_KEY" \
  "$API_BASE/workouts?limit=10")" || {
    echo "check-active-workout: could not reach $API_BASE/workouts" >&2
    exit 1
  }

# Collect today's workout ids (those with at least one set).
TODAY_IDS="$(printf '%s' "$LIST_JSON" | TODAY="$TODAY" python3 -c '
import json, os, sys
today = os.environ["TODAY"]
try:
    workouts = json.load(sys.stdin)
except Exception:
    sys.exit(3)
ids = [str(w["id"]) for w in workouts
       if w.get("date") == today and (w.get("setCount") or 0) > 0]
print(" ".join(ids))
')" || { echo "check-active-workout: failed to parse workouts list" >&2; exit 1; }

if [[ -z "$TODAY_IDS" ]]; then
  echo "check-active-workout: no workout dated $TODAY with sets — safe to deploy."
  exit 0
fi

# For each of today's workouts, check the detail endpoint for uncompleted sets.
for id in $TODAY_IDS; do
  DETAIL="$(curl -sf -H "Authorization: Bearer $FITLOCAL_API_KEY" \
    "$API_BASE/workouts/$id")" || {
      echo "check-active-workout: could not fetch workout $id detail" >&2
      exit 1
    }
  RESULT="$(printf '%s' "$DETAIL" | python3 -c '
import json, sys
w = json.load(sys.stdin)
total = incomplete = 0
for ex in w.get("exercises", []):
    for s in ex.get("sets", []):
        total += 1
        if not s.get("completed"):
            incomplete += 1
notes = (w.get("notes") or "").strip()
print(f"{incomplete}\t{total}\t{notes}")
')" || { echo "check-active-workout: failed to parse workout $id" >&2; exit 1; }

  incomplete="$(printf '%s' "$RESULT" | cut -f1)"
  total="$(printf '%s' "$RESULT" | cut -f2)"
  notes="$(printf '%s' "$RESULT" | cut -f3)"

  if [[ "$incomplete" -gt 0 ]]; then
    echo "check-active-workout: ACTIVE WORKOUT DETECTED" >&2
    echo "  workout #$id ($TODAY${notes:+, \"$notes\"}): $incomplete of $total sets still uncompleted." >&2
    echo "  Deploying now restarts the Fly machine and may interrupt the session." >&2
    exit 2
  fi
done

echo "check-active-workout: today's workout(s) [$TODAY_IDS] are fully completed — safe to deploy."
exit 0
