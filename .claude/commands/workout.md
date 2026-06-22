Show the last workout and recommend the next one based on a Push / Pull / Legs rotation.

**Production server (Fly.io).** All `/api/*` calls require a bearer token. Load it from `.env` first
(it is gitignored — never hardcode it here):
`export $(grep -E '^FITLOCAL_API_KEY=' .env | xargs)`
Then pass `-H "Authorization: Bearer $FITLOCAL_API_KEY"` on every request. Base URL: `https://fitlocal-app.fly.dev/api`.

Steps:

1. Fetch recent workouts: `curl -s -H "Authorization: Bearer $FITLOCAL_API_KEY" https://fitlocal-app.fly.dev/api/workouts`
   Take the first result (most recent). Note its date, notes field, and id.

2. Fetch the full workout detail: `curl -s -H "Authorization: Bearer $FITLOCAL_API_KEY" https://fitlocal-app.fly.dev/api/workouts/<id>`
   Exercise name is nested at `.exercises[].exercise.name`; sets are at `.exercises[].sets[]`.
   List every exercise with sets × reps × weight (convert kg to lbs). Mark warm-up sets if isWarmup=1. Skip cardio-only entries in the strength summary but mention them separately.

3. Determine the PPL rotation position:
   - Look at the `notes` field of the last 4–5 workouts to identify the sequence (push/pull/legs).
   - The next session follows: push → pull → legs → push → ...
   - If the rotation is unclear from notes, infer from exercise names (e.g. bench/shoulder/tricep = push, row/curl/lat = pull, squat/deadlift/lunge = legs).

4. To build the next session plan, also fetch the most recent workout of the SAME type (e.g. if next is legs, find the last legs workout) to get accurate weight history per exercise.

5. Output:

**Last workout — [Day, Date] ([push/pull/legs])**
- Table: Exercise | Sets×Reps | Weight (lbs) | RPE
- Note any PRs or notable RPE scores
- Cardio: brief summary if present

**Next session — [push/pull/legs]**

Output the full session plan in Obsidian format, ready to copy-paste. Format each exercise as:

```
Exercise Name
[warmup reps] reps x [warmup weight] lbs        ← only if there's a warmup set
[sets] sets x [reps] reps x [weight] lbs
[N] reps in reserve                              ← omit for bodyweight or cardio
```

Rules:
- Nudge weight up 5 lbs if last session was completed at RPE ≤ 8; hold if RPE 9+
- Include warmup sets for compound lifts (squat, bench, deadlift, row, press)
- Include the full session: compounds first, then accessories, then abs, then cardio
- Cardio: target 45–60 min minimum. Show last session's duration/distance and suggest matching or exceeding it.
- Convert all weights to lbs (kg × 2.20462)

Keep output tight. No filler.
