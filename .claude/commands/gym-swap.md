Suggest a substitute exercise when the user wants to swap something out — equipment not available, injury, preference, etc.

Trigger phrases: "swap X", "substitute for X", "don't have X", "what can I do instead of X", "replace X"

Steps:

1. Identify the exercise being swapped from the user's message.

2. Fetch the full exercise list: `curl -s http://localhost:3001/api/exercises`
   Filter client-side to find exercises that target the same primary muscle group.

3. Fetch recent workouts to check what the user has actually done before:
   `curl -s http://localhost:3001/api/workouts`
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
