Deploy the latest code to production (Fly.io).

Steps:

1. Run `fly deploy --app fitlocal-app` from the project root. This builds the Docker image (shared → API → web), pushes to Fly, and does a rolling deploy with health checks.

2. Verify the deploy succeeded. The health endpoint is unauthenticated:
   `curl -s https://fitlocal-app.fly.dev/api/health`  → expect `{"status":"ok"}`
   To also confirm the DB is serving real data, load the token from `.env` (gitignored) and hit an authed route:
   `export $(grep -E '^FITLOCAL_API_KEY=' .env | xargs)`
   `curl -s -H "Authorization: Bearer $FITLOCAL_API_KEY" https://fitlocal-app.fly.dev/api/workouts | python3 -c "import json,sys; d=json.load(sys.stdin); print('Up — latest workout:', d[0]['date'])"`

3. If the health check fails or the deploy hangs:
   - Check logs: `fly logs --app fitlocal-app`
   - Check machine status: `fly status --app fitlocal-app`
   - Common issues:
     - Litestream restore from R2 takes ~10s on cold start — extend grace period if needed
     - `NODE_ENV` not set → routes missing `/api` prefix (should be set as a secret)
     - npm workspace resolution errors → check Dockerfile copies all three package.json files

4. If a rollback is needed: `fly deploy --image <previous-image-ref>` (image ref visible in `fly status`)

Report: whether the deploy succeeded and the API is responding with real data.
