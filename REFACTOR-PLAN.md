# FitLocal Refactor Plan — Long-Term Durability

This plan captures work identified during the 2026-04-20 codebase review. It is structured as five streams — one sequencing stream (0) that lands uncommitted WIP, plus four parallel improvement streams (1–4) that build on that baseline.

Each stream is scoped so a single agent can execute it independently using this document as the brief. Read your assigned stream end-to-end before starting.

---

## Why these streams?

FitLocal is now ~14k LOC across a SvelteKit + Fastify + SQLite stack, single-user, self-hosted, used live at the gym. The core algorithms (recovery, progression, generation) are sophisticated and work well. The friction points that will compound as the app grows:

1. **Runtime type drift** between API and web — the most common source of silent breakage
2. **A 1,600+ line workout page** — every iteration on the core loop is slow
3. **Zero tests on the brain** — algorithm regressions can only be caught by gym-use feel
4. **Gym-flow friction** — too many taps and small targets for a standing, one-handed, gloved user

Additionally, the current working branch contains substantial uncommitted work that refines the generator, persists set completion state, adds cardio-aware UI, and polishes the search modal. That work is load-bearing for everything else and is addressed in Stream 0.

---

## Parallelization Strategy

| Stream | Wave | Description | Depends on |
|---|---|---|---|
| **0** | A (now) | Land uncommitted WIP as a clean baseline | — |
| **1** | B | Shared types package | Stream 0 merged |
| **2** | B | Algorithm tests | Stream 0 merged |
| **3** | C | Component extraction of log page | Streams 0 + 1 merged |
| **4a** | C | Focused home-page CTA | Streams 0 + 1 merged |
| **4b** | C | Quick-start from generate page | Streams 0 + 1 merged |
| **4c** | D | Log-page touch targets | Stream 3 merged |

**Wave A (do first, solo):** Stream 0.
**Wave B (parallel, after 0):** Streams 1 and 2. No file overlap.
**Wave C (parallel, after 1):** Streams 3, 4a, and 4b. See conflict note.
**Wave D (solo, after 3):** Stream 4c.

**Conflict note (Streams 3 and 4):** Stream 3 restructures `log/[id]/+page.svelte` into components. Stream 4a+4b only touch `routes/+page.svelte` (home) and `routes/generate/+page.svelte`. Touch-target work on the log page (4c) waits for Stream 3 to merge.

Each agent should open a branch named `claude/refactor-stream-{N}` and open a PR when done. Link back to this document from the PR body.

---

## Shared conventions for all streams

- Read the target files in full before modifying. Do not propose changes to code you haven't read.
- Do not introduce new dependencies beyond what this doc specifies without calling it out in the PR.
- Do not touch `fitlocal.db*` files. They're the user's live data.
- Do not commit anything in `.claude/`.
- Follow the existing code style: 2-space indent, TypeScript strict, Svelte 5 runes (`$state`, `$derived`, `$effect`).
- Do not add backwards-compatibility shims or feature flags — this is a single-user app, just make the change.
- Do not "improve" adjacent code that isn't part of your scope. Keep diffs focused.
- When you finish, verify by running `npm run dev` at the repo root and loading the app. Describe what you verified in the PR body.

---

# Stream 0 — Land the WIP

**Goal:** Commit the uncommitted work currently on `claude/reporting-health-integrations-NlYqH` so subsequent streams build on a clean baseline. This is a single agent, single PR, no surprises.

**Why this matters:** The WIP contains (a) a schema change (`sets.completed` column), (b) a new generator mode (`generateFromProgram`), (c) persisted set-completion state across reloads, (d) cardio-aware UI in history and edit pages, and (e) a redesigned exercise search modal. Every other stream touches at least one of these files; running them on top of uncommitted work is a recipe for conflicts and lost changes.

## What's in the WIP (inventory)

Tracked-file changes as of 2026-04-20:

### Schema + migration
- `packages/api/src/schema/index.ts` — adds `sets.completed` (integer, boolean mode, default false)
- `packages/api/src/migrate.ts` — runtime `ALTER TABLE sets ADD COLUMN completed INTEGER DEFAULT 0`

### API — generator
- `packages/api/src/lib/generator.ts`
  - Reduces PPL target counts (chest 4→3, biceps 3→2, triceps 3→2, etc.) — intentional volume reduction based on gym-use feel
  - Adds `EXERCISE_FAMILIES` regex array + `getExerciseFamily(name)` — prevents two curl variants or two bench press variants in one session
  - Adds `interleaveByMuscle(exercises)` — round-robins picks so consecutive exercises target different muscles
  - Adds `generateFromProgram(dayType, programExercises, db, options)` — new exported function that generates a workout from an active program's prescribed exercises, with progression-aware weight suggestions, cut-mode suppression, and superset assignment
  - Adds `programDriven?: boolean` to `GeneratedWorkout`
  - Fullbody target no longer includes triceps (targeted by chest exercises already)

### API — recovery
- `packages/api/src/lib/recovery.ts`
  - `biceps` regex no longer matches "leg curl" (lookbehind `(?<!leg\s)`)
  - `hamstrings` regex now explicitly includes `leg.?curl|hamstring.?curl`

### API — routes
- `packages/api/src/routes/generate.ts` — when an `active_program` exists and its current day matches `dayType`, route delegates to `generateFromProgram()` instead of freestyle `generateWorkout()`
- `packages/api/src/routes/sets.ts` — `PATCH /sets/:id` body now accepts `rpe` and `durationSeconds`
- `packages/api/src/routes/workouts.ts`
  - `GET /workouts/:id` now parses `primaryMuscles`/`secondaryMuscles`/`equipment` from JSON strings to arrays in the response (fixes web-side muscle detection)
  - Set rows now include `completed`
  - "Last performance" query rewritten: finds the most recent `workout_exercise` per exercise, then returns its sets (previously grouped sets by date which dropped exercises with empty sets)
- `packages/api/src/routes/health.ts` — extensive structured logging on `/health/sync`, `/health/sync-batch`, `/health/import-samples` (no behavior change, debug-only)

### Web
- `packages/web/src/app.css` — global scrollbar hide; portrait-lock on mobile landscape
- `packages/web/src/routes/history/+page.svelte` — cardio-aware set display ("10 min, resistance 3, 1.2 mi" instead of reps/weight)
- `packages/web/src/routes/history/[id]/edit/+page.svelte` — cardio-aware edit layout with duration/resistance/distance columns; persists `rpe` and `durationSeconds` on save
- `packages/web/src/routes/log/[id]/+page.svelte`
  - Sets now initialize from persisted `completed` state
  - Auto-expand only if not all sets are complete
  - `completed` field always saved to API on toggle (not only when becoming complete)
  - Treadmill detection — "Incline" label instead of "Resistance"
  - Exercise history panel (lazy-loaded per exercise, shows last 5 sessions with max weight × reps)
  - Visibility-change handler — when tab was hidden and rest timer expired, fire notification + dismiss on return
  - `fireRestCompleteNotification()` — main-thread notification as backup for iOS (SW setTimeout is unreliable)
  - Muscle detection fallback: legs win on ties (was chest)
  - Redesigned exercise search modal: handle bar, larger targets, muscle tags on results, backdrop-click-to-close, blurred background

### Docs
- `HEALTHKIT.md` — minor updates to reflect current shortcut state

### NOT in scope for Stream 0
- Binary `fitlocal.db-shm` / `fitlocal.db-wal` changes — these are live-DB journal files, do not commit
- `.claude/` — agent metadata, already gitignored

## Implementation Steps

1. **Review the working-tree diff.** `git diff --stat` and `git diff` against HEAD. Verify the inventory above matches reality.
2. **Confirm the app still runs.** Start `npm run dev`, load the app over Tailscale, do a short gym-flow test (generate a workout, start it, mark a set complete, reload — set should stay complete). This is a smoke test of the uncommitted work.
3. **Run `npm run build`** — both packages must build. If TypeScript errors exist in the WIP, fix the minimum needed to make it compile; do not refactor.
4. **Stage and commit in two logical commits** (not one giant commit):
   - **Commit A — "feat: generator program-mode + set completion persistence"**
     - `packages/api/src/schema/index.ts`
     - `packages/api/src/migrate.ts`
     - `packages/api/src/lib/generator.ts`
     - `packages/api/src/lib/recovery.ts`
     - `packages/api/src/routes/generate.ts`
     - `packages/api/src/routes/sets.ts`
     - `packages/api/src/routes/workouts.ts`
     - `packages/web/src/routes/log/[id]/+page.svelte` (the set-persistence + exercise history + visibility handler + treadmill detection changes)
   - **Commit B — "feat: cardio-aware UI, search modal polish, health logging"**
     - `packages/api/src/routes/health.ts`
     - `packages/web/src/app.css`
     - `packages/web/src/routes/history/+page.svelte`
     - `packages/web/src/routes/history/[id]/edit/+page.svelte`
     - The search-modal redesign portion of `packages/web/src/routes/log/[id]/+page.svelte` (if separable; if not, fold everything into Commit A)
     - `HEALTHKIT.md`

   If the log page changes are too interleaved to split cleanly, one commit is fine. Don't force a split that costs accuracy.

5. **Push the branch** and open a PR against `main` titled "Land WIP: generator program-mode, set persistence, cardio UI, search polish."
6. **Merge the PR** once CI is green (or locally if no CI). Do not force-push. Do not squash — preserve the two commits if you made them.
7. **Post-merge:** notify the user; Wave B can now launch.

## Success Criteria

- [ ] Working tree is clean (`git status` shows no modified tracked files)
- [ ] Two commits landed on main, each with a clear message
- [ ] `npm run build` passes on main
- [ ] Manual smoke test: workout generates, set completion persists across reload, cardio editing works in history, exercise search modal is polished
- [ ] No `.claude/` or `fitlocal.db*` in the committed diff

## Gotchas

- The `sets.completed` column migration runs via `try/catch ALTER TABLE` in `migrate.ts` — idempotent. Do not touch.
- The log page changes include both the set-persistence feature and the search-modal redesign. Splitting them cleanly by lines may not be practical; if not, land as one commit with a descriptive message.
- Do not run `npm install` unless dependency changes were explicitly part of the WIP. The current `package.json` is unchanged.
- The user's working DB may have stale rows — do not delete or reset.

---

# Stream 1 — Shared Types Package

**Goal:** Eliminate runtime type drift between API and web by introducing a `packages/shared` workspace that both packages import from.

**Why this matters:** Today, response shapes like `SetData`, `WorkoutExercise`, `NutritionData` are redeclared inline in nearly every `.svelte` file. When an API route changes a field name, the frontend compiles fine and breaks at runtime. This class of bug disappears with shared types.

## Scope

### Files to CREATE
- `packages/shared/package.json`
- `packages/shared/tsconfig.json`
- `packages/shared/src/index.ts` — re-exports everything
- `packages/shared/src/workouts.ts` — `Workout`, `WorkoutExercise`, `Set`, `WorkoutListItem`, `WorkoutDetail`, etc.
- `packages/shared/src/exercises.ts` — `Exercise`, `ExerciseSearchResult`, `Progression`, `LastPerformance`
- `packages/shared/src/recovery.ts` — `RecoverySummary`, `WeeklyGoals`, `TrainingLoad`, `DeloadCheck`
- `packages/shared/src/nutrition.ts` — `NutritionData`, `UserGoals`, `WeightTrend`, `WeeklyProgress`
- `packages/shared/src/programs.ts` — `Program`, `ProgramDay`, `ProgramExercise`, `ActiveProgram`
- `packages/shared/src/reports.ts` — all report response shapes
- `packages/shared/src/health.ts` — `HealthSnapshot`, sync request/response shapes
- `packages/shared/src/routines.ts` — `Routine`, `RoutineExercise`
- `packages/shared/src/challenges.ts` — `Challenge`, `Achievement`
- `packages/shared/src/generation.ts` — `GeneratedWorkout`, `GeneratedExercise`, `ProgressionDirective`, including `programDriven?: boolean` from Stream 0

### Files to MODIFY
- `package.json` (root) — no change needed, workspaces already `packages/*`
- `packages/api/package.json` — add `"fitlocal-shared": "*"` to dependencies
- `packages/web/package.json` — add `"fitlocal-shared": "*"` to dependencies
- Every API route file in `packages/api/src/routes/**` — annotate response types with shared types where trivial; do NOT refactor business logic
- Every `.svelte` file that has inline response interfaces — replace with imports from `fitlocal-shared`

### Files NOT to touch
- `packages/api/src/schema/index.ts` — Drizzle schema stays the source of DB types; shared types are API response shapes, not DB shapes
- `packages/api/src/lib/*.ts` — internal algorithm types stay internal (but `generator.ts` may export `GeneratedWorkout` via a type-only re-export from shared if useful; see Implementation)
- `packages/web/src/lib/api.ts`, `api-cache.svelte.ts`, `offline-queue.ts`, `toast.ts` — infrastructure, not scope
- Service worker, build configs, Docker

## Implementation Steps

1. **Create the shared package skeleton.** Use `"type": "module"`, `"main": "src/index.ts"`, TypeScript 5.7 dev dep, no runtime deps. Mirror the tsconfig style of `packages/api` but target `ES2022`/`bundler` resolution so both SvelteKit and tsx can consume it directly without a build step.
2. **Survey response shapes.** Read every route file in `packages/api/src/routes/` and every `.svelte` file in `packages/web/src/routes/`. List every distinct response shape. Group semantically (workouts, exercises, etc.).
3. **Author types to match current reality, not aspirations.** If the API returns `weightKg` and the web reads `weightKg`, name the field `weightKg`. Do not rename fields or "fix" inconsistencies. Exact match to current JSON is the success criterion.
4. **Wire dependencies.** Add `"fitlocal-shared": "*"` to both `packages/api/package.json` and `packages/web/package.json`. Run `npm install` at the root. Verify the symlink works.
5. **Migrate one domain at a time.** Suggested order: workouts → exercises → recovery → nutrition → programs → routines → reports → health → challenges → generation. For each domain:
   - Define types in `packages/shared/src/{domain}.ts`
   - Import in the API route handler(s) that return that shape — annotate `reply.send` response types
   - Import in every `.svelte` file that used an inline interface for that shape — delete the inline interface, import from `fitlocal-shared`
6. **Handle Stream 0 additions:** `sets.completed: boolean` must be on `Set`; `GeneratedWorkout.programDriven?: boolean` must be on the generation type.
7. **Verify incrementally.** After each domain, run `npm run dev` and load the affected pages.
8. **Final verification.** Run `npm run build` at the repo root. Both packages must build cleanly. No `any` leaks into shared types.

## Gotchas

- SvelteKit with `adapter-static` and Vite can consume a TypeScript-only workspace package if it has `"type": "module"` and exports `.ts` files directly. No build step needed for shared. Confirm this pattern works before authoring 10 files.
- Drizzle ORM's inferred types (`typeof workouts.$inferSelect`) are DB-row types, not API-response types. Shared types are API-response types. Do not import Drizzle types into shared.
- Some responses have optional fields conditionally present (e.g., `isPR` only on sets that are PRs). Reflect with optional markers (`isPR?: boolean`).
- Date fields are serialized as ISO strings in JSON. Shared types should use `string`, not `Date`.
- Enum-like fields (e.g., progression directive `'up' | 'hold' | 'deload'`) should be string literal unions.
- Stream 0's `generateFromProgram()` returns `GeneratedWorkout` with `programDriven: true`. The web side in `routes/generate/+page.svelte` already reads `programDriven` — make sure shared type reflects it.

## Success Criteria

- [ ] `packages/shared` exists and is consumed by both API and web
- [ ] No inline response-shape interfaces remain in `.svelte` files for the migrated domains
- [ ] API route handlers have typed responses for at least the 10 most-used endpoints
- [ ] `npm run build` succeeds at repo root
- [ ] Manual smoke test: home, generate, log, history, reports pages all load without errors

---

# Stream 2 — Algorithm Tests

**Goal:** Add Vitest and integration tests for the three modules that constitute the app's brain: `generator.ts`, `progression.ts`, `recovery.ts`. Protect them from silent regressions.

**Why this matters:** These 1,200+ lines of logic decide what workout you do and how much weight to lift. A subtle bug today (e.g., cut-mode volume reduction firing on a non-cut day, or the Stream 0 `EXERCISE_FAMILIES` dedup over-filtering) only surfaces after a few gym sessions feel off. Tests turn that feedback loop from days into seconds.

## Scope

### Files to CREATE
- `packages/api/vitest.config.ts`
- `packages/api/src/lib/progression.test.ts`
- `packages/api/src/lib/recovery.test.ts`
- `packages/api/src/lib/generator.test.ts`
- `packages/api/src/lib/strength.test.ts` (trivial, ~5 Epley formula assertions)
- `packages/api/test/fixtures/` — seed data helpers if needed

### Files to MODIFY
- `packages/api/package.json` — add `vitest`, `@vitest/ui` dev deps; add `"test": "vitest"`, `"test:run": "vitest run"` scripts
- Possibly minimal refactors in `generator.ts` / `progression.ts` / `recovery.ts` to expose pure helpers — keep behavior-preserving

### Files NOT to touch
- Route handlers
- The schema
- Anything in `packages/web`

## Testable surface — what to cover

### `strength.ts` (warm-up)
- Epley 1RM for various weights and reps
- 1 rep returns the weight itself
- 0 reps / negative returns something sensible (read source, mirror)

### `recovery.ts`
- `getMusclesForExercise` — given an exercise with primary/secondary muscles, returns the right list and weights
- **Biceps regex does NOT match "leg curl"** (regression test for Stream 0 fix)
- **Hamstrings regex matches "leg curl" and "hamstring curl"** (regression test for Stream 0 fix)
- Fatigue decay — a load applied 48 hours ago contributes ~half of what it did at t=0
- Recovery score bounds — always in [0, 1]
- Global modifier with HRV — latest HRV below 70% of mean reduces modifier
- Global modifier with resting HR — latest HR above 110% of mean reduces modifier
- Global modifier floor — never below 0.7
- No health snapshots — modifier defaults to 1.0

### `progression.ts`
- Exercise classification — bench → barbell compound, DB press → dumbbell compound, cable curl → accessory, pull-up → bodyweight, treadmill → cardio
- Up directive — 2+ of last 3 sessions hit top of rep range → weight increases by the type's jump, reps reset to bottom of range
- Deload directive — 2+ of last 3 sessions missed bottom of range → weight drops to 90%
- Hold directive — mixed results → weight held, reps adjusted toward middle of range
- Bodyweight special — 2+ sessions at top of range → +1 rep (no weight change)
- New exercise estimation — no history, sibling exercise has history → estimate from sibling with conversion factor, then take 80%
- Rounding — output is always rounded to nearest 1.25 kg
- Batch function — computing for 10 exercises at once matches per-exercise computation

### `generator.ts`
- Day type muscle targets — `push` returns chest/shoulders/triceps, `pull` returns back/biceps/shoulders, etc.
- **`EXERCISE_FAMILIES` dedup (Stream 0)** — never returns two curl variants or two bench press variants in one session
- **`interleaveByMuscle` (Stream 0)** — consecutive exercises target different muscles when possible
- Duration profile — 30-min profile returns ≤ 4 strength exercises; 120-min returns up to 13
- Cut mode — reduces strength slot count by 1 and adds a second cardio block
- Cut mode suppresses progression — "up" directives become "hold"
- Low recovery modifier (<0.85) — "up" directives become "hold" with weight -1 jump; sets reduced by 1
- Supersets enabled — pairs antagonist muscle groups (chest/back, biceps/triceps)
- Supersets disabled — no `supersetGroup` values on any exercise
- Trainer-prescribed exercises prioritized — when an active PPL program runs, trainer exercises preferred
- **`generateFromProgram()` (Stream 0)** — returns `programDriven: true`; uses program's `targetSets`/`targetReps` as baseline; respects cut mode; suppresses progression under low recovery; assigns supersets when enabled; handles `AMRAP` target reps by falling back to rep range max; skips program exercises with null `exerciseId` (unlinked)

## Implementation Steps

1. **Install Vitest.** `npm i -D vitest @vitest/ui -w packages/api`. Use Vitest ≥ 1.0.
2. **Author `vitest.config.ts`.** Node environment, `test.include: ['src/**/*.test.ts']`, no globals.
3. **Build a DB fixture helper.** Generator and progression tests need a database. Use `better-sqlite3` in-memory (`new Database(':memory:')`), run the DDL, seed fixtures. Wrap in `createTestDb(): { db, seedWorkout, seedExercise, seedProgram, cleanup }`.
4. **Start with strength.ts.** 5 minutes. Establishes the pattern.
5. **Progression tests.** Pure-ish functions with DB reads. Seed workouts + sets to exercise "hit top 2/3" logic.
6. **Recovery tests.** Seed `health_snapshots` for HRV/HR branches. Seed `workouts` + `sets` for fatigue decay.
7. **Generator tests — biggest payoff.** Behavioral assertions: "pull day has no chest-primary exercise", "cut mode has ≥ 2 cardio entries", "PPL day has no two curl variants", "generateFromProgram returns exercises in program order".
8. **Run suite.** `npm run test:run -w packages/api`. Target < 10s total.

## Gotchas

- Functions accept a `DB` parameter (`BetterSQLite3Database`). Fixture helper must provide exactly that type.
- Schema DDL is in `packages/api/src/schema/index.ts`. Reuse `migrate.ts`'s runner against in-memory DB, or copy the DDL.
- Date-sensitive tests (fatigue decay over 48h) should control time via `vi.useFakeTimers()` or pass dates into function under test.
- Do not test against the real `fitlocal.db`. Tests must be hermetic.
- If a helper isn't testable without exporting, export it. Minimal refactor OK; semantic changes not OK.

## Success Criteria

- [ ] `npm run test -w packages/api` launches Vitest in watch mode
- [ ] `npm run test:run -w packages/api` runs once, exits 0, completes in < 10s
- [ ] ≥ 30 test cases passing
- [ ] Each testable-surface bullet has at least one assertion
- [ ] Regression tests for the Stream 0 fixes (biceps/leg-curl regex, hamstrings/leg-curl regex, `EXERCISE_FAMILIES` dedup, `generateFromProgram`) are present and pass
- [ ] No test depends on network, filesystem outside `/tmp` or in-memory SQLite, or the live DB

---

# Stream 3 — Component Extraction (Workout Page)

**Goal:** Reduce `packages/web/src/routes/log/[id]/+page.svelte` (post-Stream-0, ~1,780 lines) to a thin orchestrator (~400 lines) by extracting purposeful components. Preserve exact behavior.

**Why this matters:** This is the file touched every time we iterate on the gym loop. Large files slow iteration, hide bugs, make merges painful. Decomposition makes each piece understandable and the main file readable.

## Scope

### Files to CREATE
- `packages/web/src/lib/workout/RestTimer.svelte` — floating rest timer bar with wall-clock persistence, presets, vibration, service-worker notification backup, **main-thread notification fallback (from Stream 0, critical for iOS)**, visibility-change recovery
- `packages/web/src/lib/workout/SetRow.svelte` — single set's reps/weight inputs, +/- buttons, complete toggle, RPE display, PR indicator; supports strength, cardio, and treadmill (incline) modes
- `packages/web/src/lib/workout/ExerciseCard.svelte` — one exercise: header, sets list, add/remove set, swap, history toggle, rest editor, RIR rating, last-performance display
- `packages/web/src/lib/workout/ExerciseHistoryPanel.svelte` — lazy-loaded history list (last 5 sessions) **(already implemented in Stream 0, just extract)**
- `packages/web/src/lib/workout/StretchPhase.svelte` — warm-up or cool-down stretch screen with duration timer and instructions
- `packages/web/src/lib/workout/WorkoutSummary.svelte` — post-workout screen: stats grid, PR callouts, per-exercise breakdown, effort rating, nutrition card, share button
- `packages/web/src/lib/workout/CelebrationOverlay.svelte` — "ALL SETS DONE!" and "NEW PR!" flashes with confetti and vibration
- `packages/web/src/lib/workout/ExerciseSearchSheet.svelte` — the redesigned bottom-sheet search modal from Stream 0 (handle bar, muscle tags, backdrop-click dismiss)

### Files to MODIFY
- `packages/web/src/routes/log/[id]/+page.svelte` — becomes the orchestrator: loads workout, holds top-level `$state`, renders the right phase (`warmup` | `workout` | `cooldown` | `summary`), composes extracted components

### Files NOT to touch
- `packages/web/src/lib/PlateCalculator.svelte`, `NutritionCard.svelte`, `ExerciseDetail.svelte` — existing components, reuse as-is
- The API — no backend changes
- Other routes

## Implementation Steps

1. **Read the current file in full (post-Stream-0, ~1,780 lines).** Understand every `$state`, `$derived`, `$effect`. Map local state (e.g., search query) vs. workout-wide state (e.g., current exercise index).
2. **Preserve behavior exactly.** Golden path (start → warm up → log sets → finish → summary) must work identically. Rest timer must survive tab switches (including Stream 0's visibility-change handler and main-thread notification fallback). Celebrations must fire at the same moments. Set-completion persistence (Stream 0) must continue to save on toggle.
3. **Establish props contracts up front.** For each new component, write the props interface first. Use shared types from Stream 1 (`Set`, `WorkoutExercise`, etc.).
4. **Extract bottom-up.** Leaves first: `SetRow`, `CelebrationOverlay`, `ExerciseHistoryPanel`, `StretchPhase`, `ExerciseSearchSheet`. Then mid-level: `RestTimer`, `ExerciseCard`. Then `WorkoutSummary`. Each extraction is its own commit.
5. **Use callbacks, not stores, for child → parent.** Svelte 5 pattern: pass `onComplete: () => void` callback props. Avoid new stores for local state.
6. **Timers live in components that own them.** `RestTimer` owns the rest timer AND the main-thread notification fallback AND the visibility-change handler — all three work together and must stay co-located. `StretchPhase` owns its countdown. `CelebrationOverlay` owns its 2-second auto-dismiss.
7. **Verify after each extraction.** Full workout flow in browser. Generate → warm up → log sets → celebration → PR → finish → summary. Repeat after every extraction.

## Critical behaviors to preserve

- **Rest timer wall-clock persistence** — when user switches tabs, timer continues from wall-clock delta, not JS-setInterval ticks.
- **Service worker timer notification** — the SW handshake is a backup on iOS.
- **Main-thread notification fallback (Stream 0)** — `fireRestCompleteNotification()` called both from the interval tick (when rest hits 0) AND from the visibility-change handler (when user returns after timer expired off-screen). Both code paths must be preserved.
- **Visibility-change handler (Stream 0)** — recovers missed rest-timer completion when the tab was backgrounded.
- **Vibration API calls** — 10s warning, set completion, celebration. Preserve all three.
- **Set completion persistence (Stream 0)** — `completed` field is PUT to API on every toggle (both true→false and false→true). Must not regress.
- **Offline caching** — workout cached to localStorage under `fitlocal-workout-{id}`. Lives in the parent orchestrator.
- **Superset auto-scroll** — completing a superset set scrolls to the paired exercise. Parent concern.
- **Auto-collapse on completion** — when an exercise's last set is completed, it collapses and the next incomplete exercise opens. Parent concern.
- **Initial expansion logic (Stream 0)** — exercises auto-expand only if NOT all sets are already complete (so a reloaded, already-done exercise stays collapsed).
- **Effort rating persistence** — effort POSTed when user clicks Done on summary, not on selection.
- **Share image generation** — `WorkoutSummary` owns the canvas. Preserve the exact layout.
- **Treadmill vs. cardio distinction (Stream 0)** — treadmill shows "Incline" label, other cardio shows "Resistance".
- **Exercise history panel lazy-load (Stream 0)** — fetches on toggle, caches in parent-owned state, slices last 5 sessions.
- **Search sheet UX (Stream 0)** — handle bar, muscle tag display, backdrop-click-to-close, larger tap targets, blurred background.

## Gotchas

- Svelte 5 runes: when passing `$state` values into child components, they are not reactive by default. Pass the object, let the child bind via `$bindable()` or use callbacks on mutations.
- The current file mixes DOM refs and scrolling logic. Scroll logic lives in the parent; refs can be returned via callback or queried by DOM.
- Be careful with `onDestroy` cleanup for timers. Each component that owns a timer must clean up its own — including the visibility-change listener.
- `browser` guard from `$app/environment` — preserve everywhere it guards `localStorage`, `navigator.vibrate`, `Notification`, service worker access.
- The visibility-change handler (Stream 0) reads shared state (`restTimerActive`, `restEndTime`). When extracted into `RestTimer`, this state becomes local — update accordingly.

## Success Criteria

- [ ] `log/[id]/+page.svelte` is under 500 lines
- [ ] Eight new components exist under `packages/web/src/lib/workout/`
- [ ] Full gym flow works: start workout → warm up → log sets → rest timer runs correctly across tab switches and backgrounded expirations → celebration fires → PR detected → cool down → summary → effort rating → done
- [ ] Reload mid-workout: set completion state persists, already-complete exercises stay collapsed
- [ ] Offline mode: disable network, the workout still loads from localStorage
- [ ] Share image generation still produces a correct canvas
- [ ] Treadmill/cardio label distinction (Incline vs Resistance) preserved
- [ ] Exercise history panel still lazy-loads and caches

---

# Stream 4 — Gym-Flow UX

**Goal:** Reduce taps from "I walked into the gym" to "I'm tracking my first set." Make the app usable with gloves and one hand.

**Why this matters:** The current home page loads 8+ API calls and presents a dense dashboard. Mid-workout, the +/- buttons are small for gloved taps. A ruthlessly gym-focused flow makes the app better every session.

**Note on Stream 0 overlap:** Stream 0 already improved the search modal (handle bar, bigger targets, muscle tags) and added treadmill/incline distinction. Don't re-do those — build on them.

## Scope — phased to coexist with Stream 3

### Wave C (parallel with Stream 3)

#### Stream 4a — Focused home: `packages/web/src/routes/+page.svelte`
- Add a prominent "Start Today's Workout" primary CTA above the dashboard. If an active program exists, CTA goes directly to program quick-start. Otherwise, opens a quick day-type chooser (push/pull/legs/upper/lower/full-body).
- Collapse the dashboard into a scrollable section below the CTA. Keep recovery/training load visible but secondary.
- Preserve all existing data cards — move, don't delete.

#### Stream 4b — Quick-start from generate: `packages/web/src/routes/generate/+page.svelte`
- Add a "Quick Start" mode that skips the selection grid when the user has an active program. One tap on "Quick Start" = today's program day generated + workout created + navigate to `/log/{id}`, no intermediate screens.
- For freestyle, remember the last-used day type and equipment in localStorage. Default to those. User can override via an "Options" expander.
- **Stream 0 context:** Active-program detection is already in the backend (`generateFromProgram()` in generate route). This stream just wires the frontend to skip intermediate screens.

### Wave D (after Stream 3 merges)

#### Stream 4c — Touch targets on log page
- Target: the components extracted in Stream 3 (`SetRow.svelte`, `ExerciseCard.svelte`, etc.).
- Increase +/- button tap targets to ≥ 48×48 px. Increase set-complete checkbox to ≥ 48×48 px. No interactive element below Apple's recommended 44 px minimum.
- Add haptic feedback (`navigator.vibrate(10)`) to all +/- button presses.
- Evaluate press-and-hold for +/- (500ms hold → larger increment). Optional.

### Files NOT to touch
- The API
- Database
- Settings page
- Existing components already gym-friendly (PlateCalculator, NutritionCard)
- Stream 3's extracted components while 3 is in flight — wait for Stream 3's PR to merge before starting 4c

## Implementation Steps — 4a

1. Read current `+page.svelte` and `TrainingRings.svelte`. Understand what loads when.
2. Design new layout: CTA at top (full-width, ~96 px tall, green, rounded, clear label). Dashboard below, retains all current cards.
3. CTA behavior: if `/programs/active` returns a program, text is "Start {dayName}" and `onclick` does quick-start. Otherwise, "Start Workout" opens a simple day-type sheet.
4. Keep the dashboard's API calls unchanged. Do not remove data, only re-prioritize visual hierarchy.
5. Test on iPhone-width viewport. CTA must be thumb-reachable from the bottom.

## Implementation Steps — 4b

1. Read the current generate page. Note how program/routine/freestyle modes are mutually exclusive.
2. When an active program is present, program mode should auto-generate on page load — user sees exercises immediately, doesn't have to tap first. Keep the Start button to commit.
3. Add a "Quick Start" button at top of freestyle that uses localStorage defaults (last day type, last equipment, last duration) and triggers generate + start in one action.
4. Persist last-used freestyle choices to localStorage: `fitlocal-last-day-type`, `fitlocal-equipment` (exists), `fitlocal-last-duration`.

## Implementation Steps — 4c (WAIT FOR STREAM 3)

1. Pull latest main. Target files are `SetRow.svelte` and siblings.
2. Audit every interactive element in workout-flow components. Measure in dev tools.
3. Increase any element below 44×44 px to at least 48×48 px. Prefer 56 px for primary controls.
4. Add `navigator.vibrate(10)` to +/- and set-complete.
5. Evaluate long-press for +/- (500ms → larger increment). Skip if fiddly.

## Gotchas

- Do not remove features to "simplify." Move them. Everything on home is there for a reason.
- Preserve training load bar, recovery badges, challenges — part of the motivational loop.
- Prefer Tailwind in-line over adding to app.css unless reused ≥ 3 times.
- The share-image canvas in WorkoutSummary is fragile. Don't touch it as part of 4c.
- localStorage keys use `fitlocal-` prefix consistently.

## Success Criteria

- [ ] From home, "Start Workout" is visible without scrolling on iPhone 14/15 viewport
- [ ] Active-program user can start tracking their first set in ≤ 3 taps (home → quick-start → set complete)
- [ ] Freestyle user can start in ≤ 4 taps (home → quick-start → day type → set complete) with defaults remembered
- [ ] After Stream 3+4c merges, no interactive element in workout flow is below 44×44 px
- [ ] All +/- and complete actions produce haptic feedback on supported devices

---

## Post-Merge Checklist (after all streams land)

- [ ] Run `npm run build` at repo root — both packages build
- [ ] Run `npm run test:run -w packages/api` — all tests pass
- [ ] Full manual smoke test — generate → log → history → reports → settings
- [ ] Verify LaunchAgent restart: `launchctl unload ~/Library/LaunchAgents/com.fitlocal.server.plist && launchctl load ~/Library/LaunchAgents/com.fitlocal.server.plist`
- [ ] Confirm the app still works over Tailscale on iPhone
- [ ] Do one real gym session. Note remaining friction; that's the next plan.

---

## Out of scope (explicitly deferred)

- Periodization / mesocycle awareness
- Body measurement tracking
- Effort-rating trend charts
- `goal_phases` table for historical cut/bulk data
- Hand-rolled → Drizzle Kit migrations
- Junction tables for exercise muscles
- Rate limiting / auth

These were identified in the review but held for a later iteration.
