Show the current cut status based on body weight data from the FitLocal API.

Targets (calories, macros, goal pace) are per-user data. Read them from the user's configured goals
(`GET /goals`) rather than assuming defaults. The cardio minimum isn't a goals field yet (see CLAUDE.md,
Fitness goals).

**Production server (Fly.io).** All `/api/*` calls require a bearer token. Make every call through
`scripts/api.sh METHOD /path [json]`: it adds the token (from the environment, or the gitignored `.env`)
and the prod base URL `https://fitlocal-app.fly.dev/api`, and times out instead of hanging. Don't
`export $(grep … .env)` by hand: when the key is missing, that runs a bare `export`, which prints
every environment variable, secrets included, into the transcript. If `api.sh` reports the key is
missing or the call times out (the default in cloud sessions, see `docs/cloud-sessions.md`), tell the
user this needs production access. Don't guess at their data.

Steps:

1. Fetch health snapshots: `scripts/api.sh GET /health-snapshots`
   Prefer the app's own computed endpoints when you can: `GET /api/goals/weight-trend?since=<YYYY-MM-DD>` returns
   raw + smoothed trend points and `weeklyRateLbs`; `GET /api/goals` returns the configured targets and cut window;
   `GET /api/goals/daily-nutrition` returns today's calories/protein vs target.

2. Filter to rows where `bodyWeightKg` is not null. Convert each to lbs (kg × 2.20462). Sort by date ascending.

3. If the user provided a weight in their message (e.g. "I weighed 170.4 lbs this morning"), log it immediately:
   `scripts/api.sh POST /health/sync '{"bodyWeightLbs": <VALUE>}'`
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
