Suggest a substitute exercise when the user wants to swap something out — equipment not available, injury, preference, etc.

Trigger phrases: "swap X", "substitute for X", "don't have X", "what can I do instead of X", "replace X"

**Production server (Fly.io).** All `/api/*` calls require a bearer token. Make every call through
`scripts/api.sh METHOD /path [json]`: it adds the token (from the environment, or the gitignored `.env`)
and the prod base URL `https://fitlocal-app.fly.dev/api`, and times out instead of hanging. Don't
`export $(grep … .env)` by hand: when the key is missing, that runs a bare `export`, which prints
every environment variable, secrets included, into the transcript. If `api.sh` reports the key is
missing or the call times out (the default in cloud sessions, see `docs/cloud-sessions.md`), tell the
user this needs production access. Don't guess at their data.

Steps:

1. Identify the exercise being swapped from the user's message.

2. Fetch the full exercise list: `scripts/api.sh GET /exercises`
   Filter client-side to find exercises that target the same primary muscle group.

3. Fetch recent workouts to check what the user has actually done before:
   `scripts/api.sh GET /workouts`
   Then fetch details for the 3–4 most recent sessions of the relevant day type (push/pull/legs) to find exercises with logged history.

4. Rank swap candidates by:
   - Same primary muscle group as the exercise being replaced
   - Has prior logged history (preferred — can suggest target weight)
   - Equipment available at a standard gym
   - Avoids overlap with other exercises already in today's session

5. Output 2–3 swap options in Obsidian format, ready to copy-paste:

```
Exercise Name
[warmup sets if applicable]
[sets] sets x [reps] reps x [weight] lbs     ← use last logged weight, nudge +5 if RPE ≤ 8
[N] reps in reserve
```

If no prior history exists for a candidate, note it and suggest a conservative starting weight.

Keep it short. Give the best option first.
