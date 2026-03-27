# FitLocal Improvements — Implementation Spec

## 1. History Page: Show Sets × Reps × Weight

**Problem:** Expanded workout in history only shows exercise names + set count. No actual set data.

**Fix:** In `packages/web/src/routes/history/+page.svelte`, the API is already loading detailed workout data (`/workouts/${id}` returns exercises with sets). The sets just aren't being rendered.

In the expanded view, replace the current exercise list with a proper table per exercise:
- Exercise name as subheader
- For each set: Set # | Reps | Weight (lbs) — formatted as "3 × 10 @ 185 lbs" or a compact grid
- Warmup sets can be styled differently (dimmed or labeled "W")
- Use `kgToLbs()` helper (kg * 2.20462, rounded to nearest 2.5)

The `/workouts/:id` response already includes `exercises[].sets[]` with `reps`, `weightKg`, `isWarmup`.

---

## 2. History Page: Search by Exercise Name

**Problem:** No way to find workouts containing a specific exercise.

**Fix:** Add a search input above the workout list in history page.
- Client-side filter on already-loaded data (no new API needed for basic implementation)
- Search matches against exercise names within expanded workout data
- Since detailed data is only loaded for first 20 workouts, add an API endpoint or filter param: `GET /workouts?search=bench+press` that queries workouts containing a matching exercise name
- Highlight matched exercise names in results
- Clear/X button on the search input

API change needed: `GET /workouts?exerciseName=<query>` — joins through workout_exercises + exercises to filter.

---

## 3. Reports: Y-Axis Categorization Fix

**Problem:** Y-axis labels on charts aren't meaningful/formatted correctly.

**Fix in `packages/web/src/lib/BarChart.svelte` and `LineChart.svelte`:**
- Y-axis should show evenly spaced, human-readable tick values (e.g., 0, 50, 100, 150 not raw decimals)
- Round tick values to nearest clean number (use `niceNumber()` helper — round to nearest 10/100/1000 depending on scale)
- For volume charts: label as "lbs" 
- For frequency charts: integer ticks only (can't have 0.5 workouts)
- Ensure the max Y value has a bit of padding (e.g., max * 1.1) so bars don't touch the top
- Add Y-axis grid lines (light, `stroke-neutral-800`) for readability

---

## 4. Reports: Tab Highlight Fix (Active Tab State)

**Problem:** Tab highlight not updating correctly when navigating between tabs.

**Root cause:** The tab buttons use `activeTab === 'training'` binding but the state might not be updating reactively with Svelte 5 runes correctly, or the conditional class isn't toggling properly.

**Fix in `packages/web/src/routes/reports/+page.svelte`:**
- Ensure `activeTab` is declared with `$state()` (it is — `let activeTab: 'training' | 'health' = $state('training')`)  
- The onclick handlers need to explicitly set `activeTab = 'training'` / `activeTab = 'health'`
- Check that the class binding `{activeTab === 'training' ? '...' : '...'}` syntax is correct for Svelte 5
- Add a visible border-bottom or indicator style, not just background color change, so it's unambiguous which tab is active
- Consider using a separate `$derived` for tab classes to make reactivity explicit

---

## 5. Generate Page: Replace Individual Exercises

**Problem:** You can regenerate the whole workout but can't swap out a single exercise you don't want.

**Fix in `packages/web/src/routes/generate/+page.svelte`:**
- Add a "swap" button (↻ icon) on each exercise card in the generated workout list
- On tap, call a new API endpoint: `GET /generate-workout/replace?exerciseId=<id>&dayType=<type>&equipment=<type>&excludeIds=<comma-separated-current-ids>`
- The endpoint returns a single replacement exercise of the same muscle group/type, excluding currently shown exercises
- Replace the exercise in the local `workout.exercises` array reactively
- Show a brief loading state on that specific card while fetching

**API change needed:** `GET /generate-workout/replace` — takes the exercise to replace, returns a single alternative. Look at the existing generator in `packages/api/src/lib/generator.ts` to find same-muscle alternatives.

---

## 6. Workout Completion Animation

**Problem:** Marking all sets done has no feedback. Finishing a workout jumps straight to history.

**Fix — Part A: All sets completed animation**
In `packages/web/src/routes/log/[id]/+page.svelte`:
- Track when ALL sets across ALL exercises are marked `completed`
- When that condition is first met, show a brief celebration — e.g., a full-screen green flash + confetti burst (can use pure CSS keyframe animation, no library needed) + haptic vibration `navigator.vibrate([100, 50, 100, 50, 200])`
- Auto-dismiss after ~2 seconds
- Keep it simple and fast — not blocking

**Fix — Part B: Workout summary screen**
Instead of `goto('/history')` after `finishWorkout()`, show an inline summary screen:
- Total sets completed, total volume (lbs), exercises hit
- Duration (track `startTime` with `Date.now()` on mount)
- List of exercises with total sets × avg weight
- A "Done" button that then navigates to `/history`
- Optionally: a fun message like "Great work 💪" with the stats

---

## 7. Long-term Hosting & Performance (Planning Notes)

Don't implement these now — just document decisions:

- **Current:** Dev server (`vite dev`) — not suitable for production
- **Short-term fix:** Build to static + run API with `tsx` or `node dist/` behind a simple process manager (PM2 or LaunchAgent)
- **Better:** `vite build` → serve static files via nginx or `serve` package; API as a proper built process
- **Hosting options:**
  - Stay local: LaunchAgent on Mac, wake-on-LAN if needed, Tailscale for remote
  - VPS: Fly.io or Railway for $5-10/month, SQLite via LiteFS or just copy DB
  - PWA + local API: Best UX for gym use — install to homescreen, API on Mac, access via Tailscale
- **Performance:** SQLite is fine for this scale. Main perf win would be caching report queries (they're expensive joins) — memoize with a 5-min TTL on the server.

---

## Implementation Order

1. **Tab highlight fix** (5 min — likely one-liner)
2. **History: sets × reps × weight display** (30 min)
3. **Workout summary screen** (45 min)
4. **Completion animation** (20 min)
5. **Replace individual exercise** (45 min — needs API + UI)
6. **History search** (30 min — needs API endpoint + UI)
7. **Y-axis chart fix** (20 min)

Total estimated: ~3-4 hours of focused Claude Code work.
