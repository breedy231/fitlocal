# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (runs API + web concurrently, backs up DB first)
npm run dev

# Individual services
npm run dev:api          # Fastify API on :3001 (tsx watch) — hits the REAL dev DB
npm run dev:api:scratch  # Same API on :3001, but against a disposable copy of the DB
                         # at /tmp/fitlocal-scratch.db. Use this for ANY write-testing
                         # (manual taps, Playwright, curl, the AI assistant's tools) so
                         # real workout data isn't polluted. Real fitlocal.db is read-only.
npm run dev:web          # SvelteKit on :5173 (vite dev)

# Build
npm run build            # Builds shared → API (tsc) → web (vite build)

# Deploy (production is Fly.io)
fly deploy               # Build Docker image + deploy to Fly.io
fly logs --app fitlocal-app          # Stream live logs
fly status --app fitlocal-app        # Machine health + check status
fly deploy --app fitlocal-app        # Deploy from any directory

# Tests (API package only — Vitest)
npm test -w packages/api          # Watch mode
npm run test:run -w packages/api  # Single run
npx vitest run packages/api/src/lib/generator.test.ts  # Single file

# Database
npm run backup           # Manual SQLite backup (scripts/backup-db.sh)
```

**IMPORTANT: Cloud sessions (Claude Code on the web)** start from a fresh clone
with no `.env`, `fitlocal.db`, `gh`, `fly` or `sqlite3`, and can't reach
production. The SessionStart hook (`.claude/hooks/session-start.sh`) installs
dependencies once it's registered in `.claude/settings.json`; if it hasn't run,
`npm ci` first. There's no data until you seed a scratchpad DB. Read
[`docs/cloud-sessions.md`](docs/cloud-sessions.md) before running anything.

## Architecture

Monorepo with npm workspaces — three packages:

- **`packages/api`** — Fastify 5 REST API, better-sqlite3 with WAL mode. Routes in `src/routes/`, DB access via raw SQL in `src/db.ts`. Migrations are inline `ALTER TABLE` statements in `src/migrate.ts` (idempotent try/catch pattern, not file-based). Schema defined in `src/schema/index.ts` (Drizzle ORM types, but queries are mostly raw SQL).
- **`packages/web`** — SvelteKit 2 + Svelte 5 (runes). Static adapter — builds to a SPA served by the API in production. Tailwind CSS. Pages under `src/routes/`: home, generate, log/[id] (active workout), history, programs, routines, reports, settings.
- **`packages/shared`** — TypeScript types shared between API and web (imported as `fitlocal-shared`). Workout, Set, Exercise types live here. `fitlocal-shared` resolves to the **built** `packages/shared/dist/` (gitignored), not `src/`: after editing anything in `packages/shared/src`, run `npm run build -w packages/shared`, or the API, web dev server and Vitest keep running the old code.

**Data flow:** Web SPA → Fastify API (:3001) → SQLite file. In production, the API serves the built SPA via `@fastify/static`. In dev, they run on separate ports.

**Production server:** Fly.io at `https://fitlocal-app.fly.dev`. Single `shared-cpu-1x` machine (ord region). DB is at `/app/fitlocal.db` inside the container, continuously replicated to Cloudflare R2 (`fitlocal-db` bucket) via Litestream. On cold start, Litestream restores from R2 before Node starts. Local dev DB lives at `fitlocal.db` in the project root (not `packages/fitlocal.db`).

**IMPORTANT: API route prefix.** Production (`NODE_ENV=production`) mounts all routes under `/api` (e.g., `/api/workouts`). Dev mode (`tsx watch`) has NO prefix (e.g., `/workouts`). Production = `https://fitlocal-app.fly.dev/api/...`. Dev = `http://localhost:3001/...`.

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
| `/app-status` | "status of the app", "what's been shipped", "latest fitlocal status" | `git log`, open PRs, working tree summary |
| `/cut-status` | "how's my cut", "cut trending", "weight trend", "I weighed X lbs" | Fetches `/api/health-snapshots`, computes trend; logs today's weight if user provides one |
| `/workout` | "last workout", "what should I do next", "next session", "what did I do yesterday" | Last workout recap + next PPL session with suggested weights |
| `/playwright-test` | "test this", "screenshot it", "show me it works", "run playwright" | Runs Playwright at 430×932, walks the affected flow, takes screenshots, posts a text-only results comment to the open PR |
| `/deploy` | "deploy", "ship it", "push to prod", "rebuild production" | Active-workout guard → `fly deploy` → health check. Mac-only (needs the `fly` CLI) |
| `/gym-swap` | "swap X", "substitute for X", "don't have X", "what can I do instead of X" | Suggests substitute exercises for the same muscle group, with Obsidian-ready output |
| `/babysit-prs` | "babysit PRs", "check the PRs", "merge the green PRs", "poll open PRs", "nudge stuck CI" | Polls open PRs into `main`, applies a CI decision table, auto-nudges stuck CI (empty commit), proposes squash-merges confirm-first. Never deploys. `--dry-run` for report-only |

`/workout`, `/cut-status`, `/gym-swap` and `/deploy` read or write **production**
data, so they need `FITLOCAL_API_KEY` and a route to `fitlocal-app.fly.dev`. Cloud
sessions have neither by default. If one of them can't reach real data, say so;
don't guess at the user's workouts.

**PPL rotation:** Push → Pull → Legs → repeat. The rotation is inferred from the `notes` field on recent workouts ("push day" / "pull day" / "legs day").

## Key conventions

- **Svelte 5 runes only.** Use `$state`, `$derived`, `$effect`, `$props()`. No legacy `$:` reactivity or `export let`.
- **IMPORTANT: Mobile-first UI.** All UI changes MUST target iPhone 15 Pro Max (430x932). Use 44px minimum tap targets (iOS HIG). Test with Playwright at that viewport before shipping.
- **IMPORTANT: PWA/iOS quirks.** `beforeunload` does NOT fire on iOS PWA swipe-kill. Always persist state on `visibilitychange` → hidden. Service workers can be evicted after ~2 days idle. iOS WebKit reports a dropped connection as `TypeError: Load failed` (Chrome: `Failed to fetch`, Firefox: `NetworkError…`), so never detect offline by error-message text: treat any `TypeError` from `fetch()` as a network failure. Chromium (including cloud Playwright) can't reproduce WebKit behaviour, so cover it with unit tests.
- **Units:** Database stores kg and meters. UI displays lbs and miles. Convert at the boundary.
- **Cardio classification:** Exercise names are matched against a regex to determine cardio vs. strength UI. **The canonical pattern is `CARDIO_PATTERN` in `packages/shared/src/cardio.ts`.** Import it from `fitlocal-shared`; never redefine it, in JS *or* SQL. Some older classifiers still disagree with it: the `CARDIO` regex in `progression.ts`, the `GLOB` list in `programs.ts`, and the hard-coded `isCardio: false` in `generate.ts`'s replace route. Before adding a cardio check, grep for `treadmill|elliptical|GLOB` and migrate what you find instead of copying it. For SQL, select names and filter in JS with `CARDIO_PATTERN`.

  **Critical footgun:** patterns without `\b` word boundaries will match substrings — e.g. `run` matches inside `c**run**ch`, causing crunch exercises to render as cardio. The shared pattern already uses `\b` boundaries; preserve them when editing it.

  **Inverse footgun (hyphenated tags):** `\b` treats a hyphen as a word boundary, so `\bmachine\b` *matches inside* `smith-machine` (and `\bbar\b` inside `t-bar`, etc.). When matching against hyphenated equipment tags (see `packages/api/src/lib/equipment-classifier.ts`), strip/replace the compound token first or anchor differently — don't assume `\b...\b` isolates a whole hyphenated tag.
- **After every change:** curl the dev URL to verify the API responds. For UI changes, run `/playwright-test`, which handles viewport, screenshots and the PR comment. For any `.svelte` change, also type-check: `cd packages/web && npx svelte-check@4 --threshold error`. Nothing else type-checks Svelte files: `vite build` strips types, ESLint has `no-undef` off for `.svelte`, and CI doesn't run svelte-check. That's how an undeclared variable (`addExerciseLoading`) shipped. The baseline is 0 errors; keep it there.
- **IMPORTANT: "Today" means America/Chicago, and every server runs in UTC.** Fly, CI and cloud containers leave `TZ` unset. From 7pm Central (6pm in winter), `new Date().toISOString().slice(0,10)`, server-local getters (`getFullYear()`/`getDate()`) and SQLite `date('now')` all return *tomorrow*. For a user-facing calendar date in the API, use `localDate()` from `packages/api/src/lib/session-window.ts`. In the browser, use local getters, never `toISOString()`. Parse a stored `YYYY-MM-DD` as `new Date(date + 'T12:00:00')`, since a bare `new Date('2026-09-27')` is UTC midnight, which is the previous evening in Chicago. About 30 older call sites still use UTC; don't copy them.
- **Never make auth or routing decisions from `req.url`.** Fastify percent-decodes the path before matching a route, but `req.url` stays raw, so a `req.url.startsWith('/api/')` check is bypassed by `/%61pi/workouts`. Put hooks inside the encapsulated plugin that owns the routes, so they run for whatever route matched, or check `req.routeOptions.url`.
- **No DB work at module import time.** ESM evaluates every static import before `server.ts` runs `migrate.ts`, so a module that touches tables on import crashes a fresh DB with `no such table`. A prod container restoring from an empty replica takes exactly that path. Keep all DDL in `migrate.ts`, and after changing the DB layer or startup, boot once against an empty `DATABASE_PATH`.
- **Tests should get their schema from `migrate.ts`.** Most route tests hand-write `CREATE TABLE` (no FKs, missing columns), and that drift hid the fresh-DB crash above. For new tests, point `DATABASE_PATH` at a temp file and run the migrations before importing `db.js` or any route, the way `scripts/seed.ts` does.
- **Four cache layers sit between a write and the next read:** server `Cache-Control` from the `onSend` hook in `server.ts` (prefix-matched, so `/exercises*` covers `/exercises/:id/progression` at `max-age=3600`), the browser HTTP cache, the in-memory SWR cache in `api-cache.svelte.ts`, and the service worker's `api-cache-*`. Data that changes when a set is logged must not be long-lived in the first layer, and every new mutation path must invalidate the last two. When a screen shows stale data, check all four before touching the component.
- **Permission allowlists are prefix globs, not guards.** `.claude/settings.json` allows `Bash(npm *)` and `Bash(curl *)`, so `npm run deploy` (= `fly deploy`) and authenticated prod writes run with no prompt. The active-workout check in `/deploy` is prose, not enforcement. Never deploy or write to production unless the user asked for that exact action.
- **The repo is public.** Never put real weights, health numbers or workout history in commits, PR bodies, PR comments or issues. Seed-data screenshots are fine. Screenshots of real data stay local.
- **Install from the repo root only.** `fitlocal-shared` is an unscoped name that is *unclaimed* on the public npm registry. It resolves to `packages/shared` only through the root workspace lockfile, so a standalone `npm install` inside a package directory could pull a stranger's package. Use `npm ci` at the root and `-w <pkg>` for scripts. New internal packages get a scoped name.
- **Terse prompts expected.** User often gives short prompts from mobile mid-workout. Infer intent from context; prefer the most likely workout-related interpretation before asking clarifying questions.

### Git conventions

- Branch off `main`; don't commit directly to it.
- End commit message bodies with the `Co-Authored-By:` trailer (and any session-link trailer) that Claude Code supplies for the model you're running as. Don't hardcode a model name here: it goes stale, and because CLAUDE.md overrides the harness, a hardcoded name forces a wrong attribution.
- End PR bodies with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

#### Parallel sessions MUST use separate worktrees (Mac)

This applies to sessions on the Mac. Each cloud session already gets its own
container and clone, so cloud sessions can't clobber each other's checkout,
but agents *within* one cloud session share ports and processes (see
`docs/cloud-sessions.md`).

Brendan often runs **multiple top-level Claude Code sessions at once** on this
repo. Top-level sessions do **not** auto-isolate — two sessions in the same
checkout (`/Users/brendanreed/Projects/fitlocal`) share one working tree and
`HEAD`. When one session runs `git checkout <branch>` it yanks the branch (and
any uncommitted edits) out from under the other, and a `git commit` in the
shared tree can sweep up the *other* session's unstaged changes into the wrong
commit. (This actually happened: a timestamps migration got swept into PR #69.)

**Rule:** never do branch work in the shared main checkout while another session
may be active. Give each parallel task its own git worktree:

```bash
# one-time per task — separate dir, own branch, own HEAD
git worktree add ../fitlocal-<task> -b feat/<task> origin/main
cd ../fitlocal-<task> && claude        # run the session here
# when the branch is merged:
git worktree remove ../fitlocal-<task>
```

A worktree shares the repo's object store but has an independent working tree,
so concurrent sessions can't clobber each other. Run `npm ci` in the new
worktree (about 10s) and symlink only `.env` from the main checkout. Don't
symlink `node_modules`: `node_modules/fitlocal-shared` is a relative link to
`../packages/shared`, so a symlinked `node_modules` makes the worktree import
the *main checkout's* shared package, and edits to `packages/shared` in the
worktree silently have no effect. If you (an agent) ever notice you're sharing
a checkout with another session mid-task, stop and move to a worktree before
committing.

(Subagents spawned via the Agent tool isolate per-spawn with
`isolation: "worktree"` — that path already works; this rule is about
human-launched parallel sessions, which don't.)

#### Fanning out reviews and delegated fixes

Split reviewer subagents by layer (API / web / deploy + CI). Before ranking
their findings, reproduce the highest-severity claims yourself, e.g. with a
scratch Fastify `app.inject` script or a boot against an empty scratch DB.
Subagent findings are usually right, but a severity you haven't reproduced is
a guess. Delegate each fix as a self-contained prompt that lists the exact
files it may touch, and check those lists for overlap before dispatching.

## Fitness goals

Nutrition and pacing targets (calories, macros, goal weight, weekly pace) are
per-user data and are **not** hardcoded here — they live in the database and are
edited from the Settings page. When generating plans, read the user's configured
targets rather than assuming defaults.

- **Cardio:** a per-session cardio minimum. It is **not** a Settings field yet: the app hardcodes 45 min (`generate/+page.svelte`), and the assistant prompt says 45–60 min (`packages/api/src/routes/assistant.ts`).
- **Workout format:** Output all gym plans in Obsidian format (see below)

### Obsidian workout format

```
Exercise Name
[warmup reps] reps x [warmup weight] lbs        ← only if warmup set exists
[sets] sets x [reps] reps x [weight] lbs
[N] reps in reserve                              ← omit for bodyweight or cardio
```

## Database

- SQLite with WAL mode, foreign keys ON. Dev DB at `fitlocal.db` (project root). Prod DB at `/app/fitlocal.db` inside the Fly.io container, set via `DATABASE_PATH` env var.
- Migrations live in `packages/api/src/migrate.ts` and run on every API boot. The pattern is `CREATE TABLE IF NOT EXISTS`, plus `ALTER TABLE … ADD COLUMN` in try/catch, plus one-shot data migrations gated by a key in the `migrations` table (add a new key; never edit one that has already run). The existing bare `catch {}` blocks swallow *every* error, so a typo'd ALTER silently does nothing. In new ones, ignore only `duplicate column name` and rethrow the rest. Ignore the drizzle-kit `db:generate`/`db:migrate` scripts; they aren't the migration path. Always check existing migrations before adding new ones.
- **Production replication:** Litestream streams WAL changes to Cloudflare R2 (`fitlocal-db` bucket) every second. On Fly.io redeploy/restart, `scripts/docker-entrypoint.sh` restores from R2 before starting Node. Config in `litestream.yml`.
- Local dev (Mac only): hourly automated backups via launchd (`scripts/backup-db.sh`). Tiered retention policy (`scripts/prune-backups.py`).
- Never modify the DB file directly — always go through the API.
- **Scratch DB for write-testing:** `npm run dev:api:scratch` (`scripts/scratch-db.sh`) copies the live `fitlocal.db` to `/tmp/fitlocal-scratch.db` via the SQLite online-backup API and runs the API with `DATABASE_PATH` pointed at that copy. The real DB is only ever read, so any mutating test (logging workouts, weigh-ins, the AI assistant's tools, Playwright/curl flows) is fully isolated. The scratch file is re-copied fresh from real data on every launch. This is the default for `/playwright-test` and any other write-testing. It doesn't work in cloud sessions, which have no `fitlocal.db` to copy; there, seed a scratchpad DB instead (`docs/cloud-sessions.md`).
