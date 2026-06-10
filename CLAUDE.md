# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (runs API + web concurrently, backs up DB first)
npm run dev

# Individual services
npm run dev:api          # Fastify API on :3001 (tsx watch)
npm run dev:web          # SvelteKit on :5173 (vite dev)

# Build
npm run build            # Builds API (tsc) then web (vite build)
npm run deploy           # Build + kill old server + restart production on :3001

# Tests (API package only — Vitest)
npm test -w packages/api          # Watch mode
npm run test:run -w packages/api  # Single run
npx vitest run packages/api/src/lib/generator.test.ts  # Single file

# Database
npm run backup           # Manual SQLite backup (scripts/backup-db.sh)
```

## Architecture

Monorepo with npm workspaces — three packages:

- **`packages/api`** — Fastify 5 REST API, better-sqlite3 with WAL mode. Routes in `src/routes/`, DB access via raw SQL in `src/db.ts`. Migrations are inline `ALTER TABLE` statements in `src/migrate.ts` (idempotent try/catch pattern, not file-based). Schema defined in `src/schema/index.ts` (Drizzle ORM types, but queries are mostly raw SQL).
- **`packages/web`** — SvelteKit 2 + Svelte 5 (runes). Static adapter — builds to a SPA served by the API in production. Tailwind CSS. Pages under `src/routes/`: home, generate, log/[id] (active workout), history, programs, routines, reports, settings.
- **`packages/shared`** — TypeScript types shared between API and web (imported as `fitlocal-shared`). Workout, Set, Exercise types live here.

**Data flow:** Web SPA → Fastify API (:3001) → SQLite file (`packages/fitlocal.db`). In production, the API serves the built SPA via `@fastify/static`. In dev, they run on separate ports.

**IMPORTANT: API route prefix.** Production (`node dist/server.js`) mounts all routes under `/api` (e.g., `/api/workouts`). Dev mode (`tsx watch`) has NO prefix (e.g., `/workouts`). The running server is almost always production. Check `ps` or the process command if unsure — `dist/server.js` = prod, `src/server.ts` = dev.

**Workout logging flow:** `generate` page creates a workout via POST → redirects to `log/[id]` → sets are saved individually via PATCH as the user works out → workout state is also cached to localStorage for offline resilience.

## Key API routes

```
POST   /workouts                         → create workout {date, locationProfile?, notes?}
POST   /workouts/:id/exercises            → add exercise {exerciseId, displayOrder?}
POST   /sets                              → create set {workoutExerciseId, reps?, weightKg?, ...}
PATCH  /sets/:id                          → update set {reps?, weightKg?, durationSeconds?, distanceMeters?, resistance?, completed?}
POST   /health/sync                       → upsert today's health {bodyWeightLbs?, hrv?, sleepHours?, steps?, calories?, proteinG?}
POST   /health-snapshots                  → insert health row {date, bodyWeightKg?, ...}
GET    /exercises                          → all exercises (no query filtering — filter client-side)
```

Prefix all routes with `/api` when hitting the production server.

## Project slash commands

These commands live in `.claude/commands/` and should be invoked automatically when the user asks the corresponding question — do not re-derive the logic from scratch.

| Command | Trigger phrases | What it does |
|---|---|---|
| `/project:app-status` | "status of the app", "what's been shipped", "latest fitlocal status" | `git log`, open PRs, working tree summary |
| `/project:cut-status` | "how's my cut", "cut trending", "weight trend", "I weighed X lbs" | Fetches `/api/health-snapshots`, computes trend; logs today's weight if user provides one |
| `/project:workout` | "last workout", "what should I do next", "next session", "what did I do yesterday" | Last workout recap + next PPL session with suggested weights |
| `/project:playwright-test` | "test this", "screenshot it", "show me it works", "run playwright" | Runs Playwright at 430×932, walks the affected flow, takes screenshots, posts them to the open PR |
| `/project:deploy` | "deploy", "ship it", "push to prod", "rebuild production", "restart the server" | Builds API + web, restarts production server on :3001, verifies it's up |
| `/project:gym-swap` | "swap X", "substitute for X", "don't have X", "what can I do instead of X" | Suggests substitute exercises for the same muscle group, with Obsidian-ready output |

**PPL rotation:** Push → Pull → Legs → repeat. The rotation is inferred from the `notes` field on recent workouts ("push day" / "pull day" / "legs day").

## Key conventions

- **Svelte 5 runes only.** Use `$state`, `$derived`, `$effect`, `$props()`. No legacy `$:` reactivity or `export let`.
- **IMPORTANT: Mobile-first UI.** All UI changes MUST target iPhone 15 Pro Max (430x932). Use 44px minimum tap targets (iOS HIG). Test with Playwright at that viewport before shipping.
- **IMPORTANT: PWA/iOS quirks.** `beforeunload` does NOT fire on iOS PWA swipe-kill. Always persist state on `visibilitychange` → hidden. Service workers can be evicted after ~2 days idle.
- **Units:** Database stores kg and meters. UI displays lbs and miles. Convert at the boundary.
- **Cardio classification:** Exercise names are matched against a regex to determine cardio vs. strength UI. **The pattern is duplicated in 5 places — any change must update all of them:**
  1. `packages/web/src/routes/log/[id]/+page.svelte` — active workout UI (`CARDIO_PATTERN`)
  2. `packages/web/src/routes/history/+page.svelte` — history list display (`CARDIO_PATTERN`)
  3. `packages/web/src/routes/history/[id]/edit/+page.svelte` — history edit UI (`CARDIO_PATTERN`)
  4. `packages/api/src/lib/generator.ts` — workout generator (`CARDIO_KEYWORDS`)
  5. `packages/api/src/routes/generate.ts` — swap suggestions (`CARDIO_KEYWORDS`)
  
  **Critical footgun:** patterns without `\b` word boundaries will match substrings — e.g. `run` matches inside `c**run**ch`, causing crunch exercises to render as cardio. Always use `\b` word boundaries. Use `grep -rn "CARDIO_PATTERN\|CARDIO_KEYWORDS" packages/` to find all instances before editing.
- **After every change:** curl the dev URL to verify the API responds. For UI changes, run `/project:playwright-test` — it handles viewport, screenshots, and posting them to the PR.
- **Terse prompts expected.** User often gives short prompts from mobile mid-workout. Infer intent from context; prefer the most likely workout-related interpretation before asking clarifying questions.

## Fitness goals (current as of June 2026)

- **Cut targets:** 1800 cal/day — 170g protein / 55g fat / 148g carbs
- **Goal pace:** ~1 lb/week loss
- **Cardio:** 45–60 min minimum per gym session
- **Workout format:** Output all gym plans in Obsidian format (see below)
- **Steps:** 10k/day target

### Obsidian workout format

```
Exercise Name
[warmup reps] reps x [warmup weight] lbs        ← only if warmup set exists
[sets] sets x [reps] reps x [weight] lbs
[N] reps in reserve                              ← omit for bodyweight or cardio
```

## Database

- SQLite with WAL mode, foreign keys ON. Single file at `packages/fitlocal.db`.
- Migrations in `packages/api/src/migrate.ts` — idempotent ALTER TABLE wrapped in try/catch. Always check existing migrations before adding new ones.
- Hourly automated backups via launchd (`scripts/backup-db.sh`). Tiered retention policy (`scripts/prune-backups.py`).
- Never modify the DB file directly — always go through the API.
