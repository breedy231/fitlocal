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

**PPL rotation:** Push → Pull → Legs → repeat. The rotation is inferred from the `notes` field on recent workouts ("push day" / "pull day" / "legs day").

## Key conventions

- **Svelte 5 runes only.** Use `$state`, `$derived`, `$effect`, `$props()`. No legacy `$:` reactivity or `export let`.
- **IMPORTANT: Mobile-first UI.** All UI changes MUST target iPhone 15 Pro Max (430x932). Use 44px minimum tap targets (iOS HIG). Test with Playwright at that viewport before shipping.
- **IMPORTANT: PWA/iOS quirks.** `beforeunload` does NOT fire on iOS PWA swipe-kill. Always persist state on `visibilitychange` → hidden. Service workers can be evicted after ~2 days idle.
- **Units:** Database stores kg and meters. UI displays lbs and miles. Convert at the boundary.
- **Cardio classification:** Exercise names are matched against a regex pattern in `log/[id]/+page.svelte` to determine cardio vs. strength UI. If adding new cardio exercises, update `CARDIO_PATTERN`.
- **After every change:** curl the dev URL to verify the API responds. For UI changes, run `/project:playwright-test` — it handles viewport, screenshots, and posting them to the PR.
- **Terse prompts expected.** User often gives short prompts from mobile mid-workout. Infer intent from context; prefer the most likely workout-related interpretation before asking clarifying questions.

## Database

- SQLite with WAL mode, foreign keys ON. Single file at `packages/fitlocal.db`.
- Migrations in `packages/api/src/migrate.ts` — idempotent ALTER TABLE wrapped in try/catch. Always check existing migrations before adding new ones.
- Hourly automated backups via launchd (`scripts/backup-db.sh`). Tiered retention policy (`scripts/prune-backups.py`).
- Never modify the DB file directly — always go through the API.
