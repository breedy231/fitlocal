Deploy the latest code to production (Fly.io).

**Mac only.** Cloud sessions have no `fly` CLI or token, and can't reach production. In a cloud
session, stop once the PR is merged and ask the user to run `/deploy` from the Mac.

Steps:

1. **Pre-deploy guard — check for an active workout session.** A `fly deploy` restarts the single Fly machine and can interrupt in-progress logging (dropped connection / lost in-flight set PATCHes). Run:

   `bash scripts/check-active-workout.sh`

   - Exit 0 → no active session, proceed.
   - Exit 2 → an **active workout was detected** (a workout dated today with uncompleted sets). Do NOT deploy silently. Surface the warning to the user (workout id + how many sets are uncompleted) and require explicit confirmation ("deploy anyway?") before continuing. This is a soft guard, not a hard block — the user may still choose to deploy.
   - Exit 1 → could not determine state (API unreachable / auth / parse). Report it and let the user decide; do not auto-proceed.

2. Run `fly deploy --app fitlocal-app` from the project root. This builds the Docker image (shared → API → web), pushes to Fly, and does a rolling deploy with health checks.

3. Verify the deploy succeeded. The health endpoint is unauthenticated:
   `curl -sS -m 20 https://fitlocal-app.fly.dev/api/health`  → expect `{"status":"ok"}`
   To also confirm the DB is serving real data, hit an authed route through `scripts/api.sh`, which loads the
   token from the environment or `.env` (never `export $(grep … .env)` by hand; see `/cut-status`):
   `scripts/api.sh GET /workouts | python3 -c "import json,sys; d=json.load(sys.stdin); print('Up — latest workout:', d[0]['date'])"`

4. If the health check fails or the deploy hangs:
   - Check logs: `fly logs --app fitlocal-app`
   - Check machine status: `fly status --app fitlocal-app`
   - Common issues:
     - Litestream restore from R2 takes ~10s on cold start (the `fly.toml` health check already has a 60s grace period)
     - `NODE_ENV` not set → routes missing `/api` prefix (should be set as a secret)
     - npm workspace resolution errors → check Dockerfile copies all three package.json files

5. If a rollback is needed: `fly deploy --image <previous-image-ref>` (image ref visible in `fly status`)

Report: whether the deploy succeeded and the API is responding with real data.
