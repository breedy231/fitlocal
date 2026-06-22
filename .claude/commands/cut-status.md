Show the current cut status based on body weight data from the FitLocal API.

Targets (calories, macros, goal pace, per-session cardio minimum) are per-user
data — read them from the user's configured goals rather than assuming defaults.

**Production server (Fly.io).** All `/api/*` calls require a bearer token. Load it from `.env` first
(it is gitignored — never hardcode it here):
`export $(grep -E '^FITLOCAL_API_KEY=' .env | xargs)`
Then pass `-H "Authorization: Bearer $FITLOCAL_API_KEY"` on every request. Base URL: `https://fitlocal-app.fly.dev/api`.

Steps:

1. Fetch health snapshots: `curl -s -H "Authorization: Bearer $FITLOCAL_API_KEY" https://fitlocal-app.fly.dev/api/health-snapshots`
   Prefer the app's own computed endpoints when you can: `GET /api/goals/weight-trend?since=<YYYY-MM-DD>` returns
   raw + smoothed trend points and `weeklyRateLbs`; `GET /api/goals` returns the configured targets and cut window;
   `GET /api/goals/daily-nutrition` returns today's calories/protein vs target.

2. Filter to rows where `bodyWeightKg` is not null. Convert each to lbs (kg × 2.20462). Sort by date ascending.

3. If the user provided a weight in their message (e.g. "I weighed 170.4 lbs this morning"), log it immediately:
   `curl -s -X POST -H "Authorization: Bearer $FITLOCAL_API_KEY" https://fitlocal-app.fly.dev/api/health/sync -H "Content-Type: application/json" -d '{"bodyWeightLbs": <VALUE>}'`
   Include this today's reading in the trend.

4. Compute:
   - Starting weight: the earliest reading in the last 6 weeks
   - Current weight: the most recent reading (today if just logged)
   - Total change: current − starting
   - Approximate rate: lbs per week over that span
   - 7-day moving average if enough data points exist

5. Output a clean summary:
   - A table of weekly readings (one per week, showing the lightest reading that week)
   - Total lost, rate (lbs/week), and a one-line trend assessment (e.g. "on track", "stalled", "accelerating")
   - Any notable observations (e.g. water weight spikes after leg day, recent plateau)
   - If stalled or off-pace, flag one concrete action (e.g. tighten protein, add cardio)

Keep output concise. No padding or filler sentences.
