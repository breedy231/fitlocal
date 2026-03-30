# FitLocal Roadmap — Full Fitbod Replacement

*What's left to build, in what order, and how each piece works.*

---

## Current State

FitLocal already covers: workout generation from muscle recovery state, set-by-set logging with rest timers, exercise swapping (with search), history with search, reports (volume, frequency, muscle distribution, PRs, exercise progression), and equipment profiles (full gym vs travel). 403 workouts and 14,780 sets imported from Fitbod.

---

## Phase 1: Production Build + Process Manager

**Goal:** Stop running `npm run dev` and make the app survive Mac restarts.

**Approach:** Consolidate to a single process. Add `@fastify/static` to the Fastify API server so it serves the SvelteKit static build directly. One process, one port.

### Changes

1. **Install `@fastify/static`** in `packages/api`
2. **Modify `server.ts`**: In production (`NODE_ENV=production`), register `@fastify/static` pointing at `../web/build` with SPA fallback
3. **Update `api.ts`** (web client): When served from same origin, use relative paths (`/api/...`) instead of `http://hostname:3001`. In production the API mounts routes under `/api` prefix.
4. **LaunchAgent plist** (`com.fitlocal.server.plist`):
   - Runs `node packages/api/dist/server.js` from the project root
   - Sets `NODE_ENV=production`
   - `KeepAlive: true`, `RunAtLoad: true`
   - Stdout/stderr to `~/Library/Logs/fitlocal.log`
5. **Build script** (`scripts/build.sh`): `npm run build` (both packages), copy web build to expected location
6. **Install script** (`scripts/install-launchagent.sh`): Symlinks plist to `~/Library/LaunchAgents/`, loads it

### Files to modify
- `packages/api/package.json` — add `@fastify/static`
- `packages/api/src/server.ts` — static file serving + `/api` prefix in production
- `packages/web/src/lib/api.ts` — same-origin detection
- New: `com.fitlocal.server.plist`
- New: `scripts/build.sh`, `scripts/install-launchagent.sh`

---

## Phase 2: Progressive Overload

**Goal:** Smart weight/rep suggestions instead of "repeat last session."

### Algorithm: Double Progression

The standard approach: work within a rep range. When you hit the top of the range for all sets, increase weight and reset to the bottom of the range.

**Rep ranges by movement type:**
| Type | Rep Range | Weight Jump |
|------|-----------|-------------|
| Barbell compound (bench, squat, deadlift, OHP, row) | 4–6 | 2.5 kg |
| Dumbbell compound | 6–10 | 2 kg (per hand) |
| Accessory / isolation | 8–12 | 1 kg |
| Bodyweight | 8–15 | N/A (add reps) |
| Cardio | N/A | N/A |

**Classification:** Keyword matching on exercise name (same pattern as existing muscle detection in `recovery.ts`). Barbell compounds match `bench|squat|deadlift|overhead press|barbell row|pendlay`. Dumbbell compounds match `dumbbell.*press|dumbbell.*row|dumbbell.*lunge`. Everything else is accessory.

**Three-session lookback:**
```
For each exercise, query last 3 workout sessions (non-warmup sets only):
  - hitTarget[i] = did ALL sets in session i reach top of rep range?
  - missedMin[i] = did ANY set in session i fail to reach bottom of rep range?
```

**Progression rules:**
1. **Progress** — If `hitTarget` in last 2 of 3 sessions:
   - Increase weight by the jump amount
   - Reset suggested reps to bottom of range
   - Mark exercise with `progression: 'up'` for UI badge
2. **Deload** — If `missedMin` in last 2 of 3 sessions:
   - Reduce weight by 10%
   - Set suggested reps to middle of range
   - Mark `progression: 'deload'`
3. **Hold** — Otherwise:
   - Keep last session's weight
   - If hit top of range last session, suggest +1 rep
   - Mark `progression: 'hold'`

**Recovery modifier integration:** When `globalModifier < 0.85` (bad HRV/HR day), don't suggest progressions — hold weight and reduce suggested sets by 1.

### Changes

1. **New module: `packages/api/src/lib/progression.ts`**
   - `classifyExercise(name: string): 'barbell_compound' | 'dumbbell_compound' | 'accessory' | 'bodyweight' | 'cardio'`
   - `getRepRange(classification): { min: number, max: number, jump: number }`
   - `getRecentSessions(exerciseId, db, count=3): SessionSummary[]` — queries last N sessions' sets
   - `computeProgression(exerciseId, db): { weightKg, reps, directive: 'up' | 'deload' | 'hold' }`

2. **Modify `generator.ts` `buildExercise`** (line 188):
   - Replace `getLastSetInfo` with `computeProgression`
   - Use returned weight/reps/directive
   - Pass directive through to `GeneratedExercise` type

3. **Modify `isFocus` scoring** (lines 214–222):
   - Focus = exercise with `directive: 'up'` and highest recovery score
   - If no exercise is progressing, pick the one closest to hitting target

4. **UI changes** in workout generation display and logging:
   - Show progression badge: green up arrow (progress), yellow hold, red down arrow (deload)
   - Show target rep range below suggested weight

### Files to modify
- New: `packages/api/src/lib/progression.ts`
- `packages/api/src/lib/generator.ts` — use progression in buildExercise
- `packages/api/src/routes/generate.ts` — pass through progression data, respect recovery modifier
- `packages/web/src/routes/generate/+page.svelte` — progression badges
- `packages/web/src/routes/log/[id]/+page.svelte` — show target rep range

---

## Phase 3: HealthKit Bridge API Contract

**Goal:** Define the API surface for bidirectional HealthKit sync so a lightweight Swift app can be built later.

### Changes

1. **Fix `/health/sync`** — add `calories` and `proteinG` to the destructured body (they're already in the schema but missing from the route handler at line 37 of `health.ts`)

2. **New endpoint: `POST /health/sync-batch`**
   ```json
   { "snapshots": [{ "date": "2025-01-15", "hrv": 45, "restingHr": 52, ... }] }
   ```
   Upserts by date. For backfilling historical HealthKit data.

3. **New endpoint: `GET /workouts/export?since=2025-01-01`**
   Returns workouts in a format the Swift app can write to HealthKit:
   ```json
   [{ "date": "...", "durationMinutes": 55, "caloriesBurned": 320, "exerciseType": "strength" }]
   ```

4. **Document the Swift app contract** in a `HEALTHKIT.md` spec — what it reads, what it POSTs, scheduling (daily background refresh via BGTaskScheduler)

### Files to modify
- `packages/api/src/routes/health.ts` — fix sync, add batch endpoint
- `packages/api/src/routes/workouts.ts` — add export endpoint
- New: `HEALTHKIT.md`

---

## Phase 4: Offline Queue

**Goal:** Gym sessions don't fail when WiFi drops.

### Approach

1. **IndexedDB queue** (`packages/web/src/lib/offline-queue.ts`):
   - On API write failure (network error, not 4xx/5xx), serialize request to IndexedDB
   - On `online` event or app foreground, replay queue in order
   - Deduplicate by request signature (method + path + body hash)

2. **Wrap `api()` function** in `api.ts`:
   - GET requests: fail normally (read-only, can't queue)
   - Mutation requests (POST/PUT/DELETE): catch network errors → queue → return optimistic response
   - Show toast: "Saved offline — will sync when connected"

3. **Online/offline indicator** in `+layout.svelte`:
   - Small banner at top when offline
   - Badge showing queued request count

4. **Current workout cache**:
   - When a workout is loaded for logging, cache the full exercise list + sets in IndexedDB
   - If the page is refreshed offline, load from cache instead of API

### Files to modify
- New: `packages/web/src/lib/offline-queue.ts`
- `packages/web/src/lib/api.ts` — wrap mutations with queue fallback
- `packages/web/src/routes/+layout.svelte` — offline banner
- `packages/web/src/routes/log/[id]/+page.svelte` — cache current workout

---

## Phase 5: MFP via HealthKit Passthrough

**Goal:** Get nutrition data without scraping MFP's website.

**How it works:** MFP already writes calories and protein to Apple Health. The HealthKit bridge (Phase 3) reads those values and includes them in the daily `/health/sync` POST. The generator reads from `health_snapshots` instead of scraping MFP.

### Changes

1. **Replace MFP scraper in `generate.ts`** (lines 33–47):
   - Instead of fetching MFP HTML, query today's `health_snapshots` row for `calories` and `protein_g`
   - Same deficit logic: if calories < maintenance - 300, reduce sets by 10%
   - Make maintenance calories configurable (env var or settings table)

2. **Delete `packages/api/src/lib/mfp.ts`** — no longer needed

3. **Remove `MFP_USERNAME` and `MFP_SESSION_COOKIE` env var references**

### Files to modify
- `packages/api/src/routes/generate.ts` — replace MFP fetch with health_snapshots query
- Delete: `packages/api/src/lib/mfp.ts`

---

## Phase 6: Superset Support

**Goal:** Pair antagonist exercises for time-efficient workouts.

### Schema Change
- Add `superset_group` (nullable integer) to `workout_exercises` table
- Exercises with the same `superset_group` value are paired

### Generator Logic
- Antagonist pairs: chest+back, biceps+triceps, quads+hamstrings
- After picking exercises, pair compatible ones (max 3 supersets per workout)
- Assign `superset_group` values (1, 2, 3...)

### UI
- Group paired exercises visually (shared card/section)
- Alternating set logging: A1 set 1 → A2 set 1 → A1 set 2 → A2 set 2
- Shorter rest timer between superset partners (30s vs normal 60-90s)

### Files to modify
- `packages/api/src/schema/index.ts` — add column
- `packages/api/src/migrate.ts` — migration
- `packages/api/src/lib/generator.ts` — pairing logic
- `packages/web/src/routes/log/[id]/+page.svelte` — grouped UI
- `packages/web/src/routes/generate/+page.svelte` — show pairs

---

## Phase 7: Plate Calculator

**Goal:** "Load 185 lbs" → show which plates per side.

### Implementation
- Pure frontend component: `packages/web/src/lib/PlateCalculator.svelte`
- Standard plates: 45, 35, 25, 10, 5, 2.5 lbs (or kg equivalents)
- Bar weight: 45 lbs / 20 kg (configurable)
- Greedy algorithm: subtract bar weight, divide by 2, fill with largest plates first
- Shows visual plate diagram (colored rectangles)

### Integration
- Button next to weight input in `log/[id]/+page.svelte`
- Opens as a bottom sheet or popover
- Auto-populates with the current set's target weight

### Files to modify
- New: `packages/web/src/lib/PlateCalculator.svelte`
- `packages/web/src/routes/log/[id]/+page.svelte` — plate calc button

---

## Implementation Order

```
Phase 1 (Production Build)     ← start here
  ↓
Phase 2 (Progressive Overload) ← biggest training value
  ↓
Phase 3 (HealthKit API)        ← unlocks phases 4-5
  ↓
Phase 4 (Offline Queue)        ← gym reliability
  ↓
Phase 5 (MFP Passthrough)      ← depends on phase 3
  ↓
Phase 6 (Supersets)             ← nice-to-have
Phase 7 (Plate Calculator)     ← nice-to-have, independent
```

Phases 6 and 7 are independent of each other and can be done in any order.
