# FitLocal Tier 2 Implementation Plan

Self-contained plan for a fresh conversation to implement without prior context.

## Project Context

FitLocal is a self-hosted fitness tracking PWA. Backend: Fastify 5 + Drizzle ORM + SQLite (`packages/api/src/`). Frontend: SvelteKit + Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`) + Tailwind CSS (`packages/web/src/`). All charts are hand-rolled SVG. Weights stored in kg, displayed in lbs. Migrations are imperative `ALTER TABLE` in `migrate.ts` with try/catch. Frontend data loading uses `cachedGet<T>(path)` (stale-while-revalidate) and `api<T>(path, options)` for mutations.

### Key Patterns
- **Routes**: `async function fooRoutes(app: FastifyInstance)` registered in `server.ts`
- **Schema**: Drizzle in `schema/index.ts`, raw SQL in `migrate.ts`
- **Components**: `$props()` for inputs, live in `/packages/web/src/lib/`
- **Charts**: `LineChart`/`BarChart` accept `{ label: string; value: number }[]`, SVG-based
- **Cache headers**: Set in `server.ts` `onSend` hook by URL prefix

---

## Build Order

| # | Feature | Scope | Depends On |
|---|---------|-------|-----------|
| 1 | Estimated 1RM | Small | — |
| 2 | Strength Standards | Medium | #1 (epley1RM utility) |
| 3 | Workout Calendar Heatmap | Medium | — |
| 4 | Body Part Volume Heatmap | Medium | — |
| 5 | Progressive Disclosure | Medium-Large | #3 (heatmap = Layer 1 for history) |
| 6 | Monthly Challenges | Medium | — (benefits from #5's layout) |

Features 1→2 have a hard dependency. 3→5 is a soft dependency. Everything else is independent.

---

## Feature 1: Estimated 1RM per Exercise

**What**: Calculate estimated one-rep max using Epley formula (`1RM = weight * (1 + reps/30)`) per set, take maximum. Show in exercise progression reports and personal records. Track over time as a line chart.

**Schema**: None.

**API**:
- New utility: `/packages/api/src/lib/strength.ts`
  - `epley1RM(weightKg: number, reps: number): number` — pure function
- Modify `GET /reports/exercise-progression` in `reports.ts`:
  - Add `estimated1RmKg` to each data point: `MAX(s.weight_kg * (1.0 + CAST(s.reps AS REAL) / 30.0))` per session
- Modify `GET /reports/personal-records` in `reports.ts`:
  - Add `estimated1RmKg` column: same formula, grouped by exercise
- New `GET /reports/exercise-1rm-history?exerciseId=N` in `reports.ts`:
  - Returns `{ exerciseName, dataPoints: [{ date, estimated1RmKg }] }` — max 1RM per session over time

**Frontend**:
- Modify `/packages/web/src/routes/reports/+page.svelte`:
  - Exercise Progression: add toggle or second line showing 1RM trend
  - Personal Records: add "Est. 1RM" column next to max weight
- No new components needed.

**Notes**: Exclude warmup sets and zero-weight. For reps > 12, Epley overestimates — consider capping at 12 for formula input.

---

## Feature 2: Strength Standards / Benchmarks

**What**: Show where each lift falls on a bodyweight-adjusted scale: Beginner / Novice / Intermediate / Advanced / Elite. Horizontal segmented bar with user's position. Uses 1RM-to-bodyweight ratios from standard strength tables.

**Schema**: None (data is a static JSON file).

**API**:
- New data file: `/packages/api/src/data/strength-standards.json`
  - `{ "Barbell Bench Press": { "male": { "beginner": 0.5, "novice": 0.75, "intermediate": 1.0, "advanced": 1.25, "elite": 1.5 } } }`
  - Cover ~20 common barbell/dumbbell compounds
- New `GET /reports/benchmarks` in `reports.ts`:
  - For each exercise with standards data: compute 1RM (use `epley1RM`), get latest `body_weight_kg` from `health_snapshots`, compute ratio, classify
  - Response: `{ bodyWeightKg, exercises: [{ name, estimated1RmKg, ratio, level, thresholds }] }`
- New `GET /exercises/:id/benchmark` in `exercises.ts` — single exercise version

**Frontend**:
- New component: `/packages/web/src/lib/BenchmarkBar.svelte`
  - Horizontal 5-segment bar with marker dot. Props: `{ ratio, thresholds, level }`
  - Colors: gray / blue / green / orange / red (beginner → elite)
- Modify `reports/+page.svelte`: Add "Strength Benchmarks" section below Personal Records
- Modify `ExerciseDetail.svelte`: Add benchmark bar if data available

**Notes**:
- Gender: use localStorage preference (male/female) with default male. Simple toggle in the benchmarks section.
- Body weight: `SELECT body_weight_kg FROM health_snapshots WHERE body_weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1`
- Only barbell/dumbbell compounds get benchmarks. Match via normalized name patterns.

---

## Feature 3: Workout Calendar Heatmap

**What**: Month-view calendar on history page. Each day is a colored square — trained days are green (intensity varies by volume), no-workout days are dark. Month navigation arrows. GitHub contribution graph aesthetic in a 7-column calendar grid.

**Schema**: None.

**API**:
- New `GET /reports/calendar?year=2026&month=3` in `reports.ts`:
  - Returns `{ days: [{ date, workoutCount, primaryMuscles: string[], totalSets }] }` for days with workouts
  - Single query: workouts + workout_exercises + exercises + sets, GROUP BY date, filtered to the month

**Frontend**:
- New component: `/packages/web/src/lib/CalendarHeatmap.svelte`
  - Props: `{ year, month, days: DayData[] }`
  - 7-column SVG grid (Mon-Sun). Each cell = rounded rect. Color: no workout = `#1a1a1a`, workout = green with opacity scaled by totalSets relative to month max
  - Month/year header with ← → buttons
  - Tap a day to navigate to that workout
- Modify `history/+page.svelte`: Add CalendarHeatmap above workout list

**Notes**: Handle first-day-of-month offset (which column the 1st lands on). Keep SVG simple: ~30x30px cells with 2px gaps.

---

## Feature 4: Body Part Volume Heatmap

**What**: Grid showing volume (working sets) per muscle group per day of the week over the last 4 weeks. Rows = 10 muscle groups, columns = 7 days per week. Cell color intensity = set count. Lives on reports page.

**Schema**: None.

**API**:
- New `GET /reports/volume-heatmap?weeks=4` in `reports.ts`:
  - Returns `{ weeks: [{ weekStart, days: [{ date, muscles: { chest: 6, back: 0, ... } }] }] }`
  - Uses `getMusclesForExercise()` from `recovery.ts` to attribute sets to muscles
  - Secondary muscles count as 0.5 sets

**Frontend**:
- New component: `/packages/web/src/lib/VolumeHeatmap.svelte`
  - Props: `{ weeks: WeekData[] }`
  - Grid: rows = muscle names, columns = M T W T F S S. Color scale from dark to bright green (5 steps based on max across all cells)
  - Multiple weeks stacked vertically with dividers
- Modify `reports/+page.svelte`: Add between Muscle Distribution and Personal Records

**Notes**: The 10 muscles are defined in `recovery.ts`: chest, shoulders, triceps, back, biceps, quads, hamstrings, glutes, calves, core.

---

## Feature 5: Three-Layer Progressive Disclosure

**What**: Apply Apple's glanceable → summary → detail pattern across all pages. Layer 1 = visible with zero taps. Layer 2 = tap to expand. Layer 3 = navigate to full detail. Primarily a frontend refactor.

**Schema**: None. **API**: None.

**Frontend**:
- New component: `/packages/web/src/lib/Expandable.svelte`
  - Wrapper with expand/collapse animation (CSS max-height transition or Svelte slide)
  - Props: `{ expanded: boolean }`, renders slot content

- Modify `+page.svelte` (home):
  - Rings section: tap to expand → weekly bar chart of daily sets
  - Training load: tap to expand → 4-week sparkline
  - "See more →" links to reports

- Modify `reports/+page.svelte`:
  - Each chart section gets a `showDetail` toggle
  - Tap chart → show data table beneath it (e.g., frequency chart → table of workouts per week)

- Modify `history/+page.svelte`:
  - Layer 1 = Calendar heatmap (#3) + count summary
  - Layer 2 = Workout list (already exists)
  - Layer 3 = Expanded workout detail (already exists)

**Notes**: Layer 1 must fit above the fold on a 375px phone screen. Keep Layer 2 behind a tap. Test mobile viewport.

---

## Feature 6: Monthly Personal Challenges

**What**: Auto-generate one challenge per month calibrated to recent 4-week average + 12%. Track progress on home page. Badge collection for completed months.

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,           -- '2026-04'
  type TEXT NOT NULL,            -- 'workouts' | 'sets' | 'volume'
  description TEXT NOT NULL,     -- 'Complete 18 workouts in April'
  target_value REAL NOT NULL,
  unit TEXT NOT NULL,            -- 'workouts' | 'sets' | 'lbs'
  completed INTEGER DEFAULT 0,
  completed_at TEXT
);
```
Add to `migrate.ts` and `schema/index.ts`.

**API**:
- New file: `/packages/api/src/routes/challenges.ts`
  - `GET /challenges/current` — return current month's challenge (auto-generate if none exists)
  - `GET /challenges/history` — all past challenges with completion status
  - Auto-complete: if `currentValue >= targetValue` during GET, mark complete
- New file: `/packages/api/src/lib/challenges.ts`
  - `generateChallenge(month, db)` — pick metric type (rotate), compute target from 4-week avg × stretch factor
  - `computeCurrentValue(challenge, db)` — live progress query
- Register in `server.ts`

**Frontend**:
- New component: `/packages/web/src/lib/ChallengeCard.svelte`
  - Single ring (reuse TrainingRings pattern), description, "X of Y" progress
  - Completed state: green check + "Completed!"
- Modify `+page.svelte` (home): Add ChallengeCard between rings and training load
- Optional new route: `/packages/web/src/routes/challenges/+page.svelte` — badge collection grid

**Notes**:
- Generation must be idempotent (check if challenge exists for month before creating)
- Require 4 weeks of data before generating first challenge
- Volume descriptions should be in lbs (convert from kg)
- Challenge types rotate: workouts → sets → volume → workouts → ...

---

## Files Touched by Multiple Features

| File | Features |
|------|----------|
| `packages/api/src/routes/reports.ts` | 1, 2, 3, 4 |
| `packages/web/src/routes/reports/+page.svelte` | 1, 2, 4, 5 |
| `packages/web/src/routes/+page.svelte` | 5, 6 |
| `packages/web/src/routes/history/+page.svelte` | 3, 5 |
| `packages/api/src/schema/index.ts` | 6 |
| `packages/api/src/migrate.ts` | 6 |
| `packages/api/src/server.ts` | 6 |
