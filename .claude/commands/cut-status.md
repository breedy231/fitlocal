Show the current cut status based on body weight data from the FitLocal API.

Current targets (as of June 2026):
- Calories: 1800/day
- Protein: 170g | Fat: 55g | Carbs: 148g
- Cardio: 45–60 min minimum per gym session
- Goal pace: ~1 lb/week loss

Steps:

1. Fetch health snapshots: `curl -s http://localhost:3001/api/health-snapshots`

2. Filter to rows where `bodyWeightKg` is not null. Convert each to lbs (kg × 2.20462). Sort by date ascending.

3. If the user provided a weight in their message (e.g. "I weighed 170.4 lbs this morning"), log it immediately:
   `curl -s -X POST http://localhost:3001/api/health/sync -H "Content-Type: application/json" -d '{"bodyWeightLbs": <VALUE>}'`
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
