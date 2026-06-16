# FitLocal — Strategic Spec v2 (June 2026)

> Revised after technical review. Pass individual phases to subagents — each phase section is self-contained with context, steps, and acceptance criteria.
> Confirmed: persistent AI chat history, hosting on Fly.io, public repo at breedy231/fitlocal.

## Critical findings driving this revision

1. **`fitlocal.db-shm` and `fitlocal.db-wal` are tracked in git at repo root** (verify: `git ls-files | grep db`). The WAL file contains personal health data as readable SQLite pages. Must be purged from history before the repo goes public. This is the single most important item in the plan.
2. **The original DB transfer step (rsync the bare `.db`) would silently lose data** — WAL-mode DBs must be snapshotted with `sqlite3 .backup` first (the existing `scripts/backup-db.sh` already does this correctly).
3. **The assistant as originally specced (read-only Q&A) does not replace Claude Code** — Claude Code at the gym *acts* (logs weight, swaps exercises). The assistant needs tool use.
4. **PWA requires a secure context** — service workers don't run over plain `http://`. Fly.io serves the app over HTTPS by default (`force_https` in `fly.toml`), which satisfies this.
5. **CARDIO_PATTERN consolidation was sequenced last but is a prerequisite** for the phases that touch `generate.ts` and `log/[id]` — moved ahead of them.
6. **README + CI belong at repo-public time**, not at the end — a public portfolio repo without them defeats the purpose.

---

## Phase 1 — Hosting (done)

The app runs on **Fly.io**: a Docker image built from `packages/api/Dockerfile`
(config in `fly.toml`), single `shared-cpu-1x` machine. The SQLite DB lives at
`/app/fitlocal.db` and is continuously replicated to Cloudflare R2 via Litestream
(`litestream.yml`); on cold start `scripts/docker-entrypoint.sh` restores from R2
before Node boots. HTTPS (`force_https`), health checks (`/api/health`), and machine
auto-start/stop are handled by Fly. Deploy commands and environment variables
(`DATABASE_PATH`, `PORT`, `FITLOCAL_API_KEY`, `NODE_ENV`, plus Litestream/R2
secrets) live in `README.md`.

The WAL-safety lesson from finding #2 still applies to any manual DB move: snapshot
with `scripts/backup-db.sh` (a `sqlite3 .backup`), never copy a live `.db` without
its `-wal` sidecar.

> Historical note: an earlier draft of this phase planned an Oracle Cloud
> Always-Free ARM VM fronted by Tailscale + systemd. That path was dropped in favor
> of Fly.io; the OCI provisioning and cutover detail has been removed.

---

## Phase 2 — Personal Data Audit + Repo Public

**Goal:** Safe to flip breedy231/fitlocal public, and presentable the moment it flips (README + CI ship in this phase, not at the end).

### Steps

1. **🚨 Purge tracked DB files from git history.** `fitlocal.db-shm` and `fitlocal.db-wal` are tracked at repo root and contain personal health data as readable SQLite pages:
   ```bash
   git filter-repo --path-glob 'fitlocal.db*' --path-glob '*.png' --invert-paths
   ```
   (One filter-repo pass for both DB files and screenshots. Exempt `packages/web/static/*.png` app icons and `.github/test-screenshots/` if those should survive — use explicit `--path` rules accordingly.)
   Add `fitlocal.db*`, `*.db`, `*.db-shm`, `*.db-wal`, and root-level `*.png` to `.gitignore`.
   **Note:** filter-repo rewrites all history — every existing clone must be re-cloned afterward, and the remote needs a force push.
2. **History-wide secret/personal-data scan** — grepping the working tree is not enough; old commits may contain values the current tree doesn't:
   ```bash
   gitleaks detect --source . --log-opts="--all"
   git log -p --all | grep -inE "<your-name>|<your-email>|anthropic.*key|sk-ant" | head -50
   ```
3. **Working-tree grep for hardcoded personal values** (calorie/macro numbers, your name, your email in `*.ts`/`*.svelte`). Anything found moves to the DB (`user_goals`) — not env vars; personal data in env vars fights the public-repo goal too.
4. **Audit `.claude/`**: commands are fine to keep; check `settings.json` for local paths/secrets.
5. **Add `.env.example`** (`DATABASE_PATH`, `ANTHROPIC_API_KEY`, `PORT` — no personal values).
6. **Write `README.md`** — what it is (1 para), tech stack, ASCII architecture diagram, self-hosting instructions (Fly.io deploy), explicit "single-user, no multi-tenancy" note.
7. **Add CI**: one GitHub Actions workflow — `npm ci`, `npm run build`, `npm run test:run -w packages/api`. A portfolio repo with a green checkmark beats any amount of refactoring.
8. Flip repo to public. Re-clone anywhere the repo is checked out (history was rewritten in step 1).

**Definition of done:** `git log --all -- 'fitlocal.db*' '*.png'` is empty; gitleaks clean; README renders on GitHub; CI green on main; repo is public.

---

## Phase 3 — In-App AI Assistant (with tools)

**Goal:** Actually replace Claude Code on the phone. That means the assistant must **act**, not just answer — log weight, look up exercise history, suggest swaps.

### Architecture

`POST /api/assistant/chat` → server assembles context → calls Claude with **tool definitions** → agentic loop (tool calls execute server-side against the DB) → streams text deltas to client via SSE.

**Request:** `{ message: string; conversationId?: string }` (null = new conversation)
**Response:** `text/event-stream` — events: `delta {text}`, `tool {name, summary}` (so the UI can show "📊 logged 181 lbs"), `done {conversationId}`.

### Tools (server-side, executed in the agentic loop)

| Tool | Purpose | Implementation |
|---|---|---|
| `log_body_weight(lbs)` | "I weighed 181 this morning" | POST-equivalent of `/health/sync` upsert |
| `get_exercise_history(name, limit)` | "What did I bench 3 weeks ago?" — beyond the 7-workout context window | SQL query on sets joined to exercises |
| `get_swap_suggestions(exerciseName)` | "What can I do instead of X" | Reuse the `/generate-workout/replace` logic |

Cap the agentic loop at 5 tool-use rounds. Tools that mutate data (`log_body_weight`) must be echoed in the streamed response so the user sees what happened.

### Context assembled per request

- Last 7 workouts (date, notes, exercises + sets)
- Last 30 days of health snapshots
- Current goals **read from the DB (`user_goals`)** — NOT hardcoded in the prompt template. Hardcoded macros contradict Phase 2's audit.
- Today's date

**Prompt caching:** mark the system prompt + context block with `cache_control: {type: "ephemeral"}`. The context is identical across turns within a session; don't pay to re-process it.

**Conversation history:** server loads prior messages for the conversation and sends them to the model, **capped at the last 20 messages**. (Persistent conversations grow unboundedly otherwise.)

### Reliability (gym connectivity is bad)

- **Persist the assistant message server-side on completion regardless of client disconnect.** If the SSE stream drops mid-response, the full message must still land in `assistant_messages` — on reconnect/refresh the client reloads history from the DB and sees it.
- Client uses **`fetch` + `ReadableStream`** to consume SSE — `EventSource` cannot POST. (iOS Safari supports streaming fetch responses.)

### DB schema (new migration in `packages/api/src/migrate.ts`)

```sql
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id TEXT PRIMARY KEY,  -- uuid
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assistant_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,  -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Update `assistant_conversations.updated_at` explicitly on every message insert (nothing does it otherwise).

### System prompt outline

```
You are the FitLocal assistant — a personal trainer and nutrition coach with full access to the user's gym data, and tools to act on it.

Current date: {date}
Active goal: {from user_goals — cut phase, dates, pace}
Nutrition targets: {from user_goals}
Cardio minimum: 45–60 min per gym session
Workout rotation: Push → Pull → Legs

Recent workouts: {last_7_workouts}
Recent health data (30d): {health_snapshots}

Use tools to log data or look up history beyond what's shown. Be concise — the user is often on their phone between sets.
```

**Model:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`), configurable via `ASSISTANT_MODEL`. Haiku handles this tool set fine; if swap reasoning quality disappoints, flip the env var to Sonnet.

### Web: `/assistant` route

- Full-page chat UI, mobile-first (430px), input pinned above iOS safe area
- History loaded from DB on mount (last 50 messages of most recent conversation)
- Streaming render; tool events shown as inline status chips
- "New conversation" button; nav item in `+layout.svelte`

**Definition of done:** From the phone: "what's my next workout?" → contextual answer; "I weighed 181" → weight actually appears in `/api/health-snapshots`; "what did I bench last month?" → correct historical answer via tool. No Claude Code involved.

---

## Phase 4 — Cardio Consolidation + Generate Improvements

**Goal:** Plans visibly reflect current goals. **Starts with the CARDIO_PATTERN consolidation** because tasks 3–4 below touch the exact files containing the duplicated pattern — consolidate first or edit it in five places one more time.

1. **Consolidate CARDIO_PATTERN** → `packages/shared/src/cardio.ts`:
   ```typescript
   /**
    * Matches cardio machine/activity exercise names.
    * \b word boundaries required — bare "run" matches inside "crunch".
    * Single source of truth — imported by all five former definition sites.
    */
   export const CARDIO_PATTERN = /\b(treadmill|elliptical|cycling|rowing\s+machine|stationary\s+bike|stair\s*climber|air\s+bike|assault\s+bike|rower|bike|rowing|jogging|sprinting)\b/i;
   ```
   Update all 5 sites (find with `grep -rn "CARDIO_PATTERN\|CARDIO_KEYWORDS" packages/`), delete local definitions. Note: the two API sites use a `CARDIO_KEYWORDS` array — converting them to the shared regex needs a behavior check against existing tests.
2. **Duration input on `/generate`** — segmented control `45 / 60 / 75 min / No limit` (default 60), wired to existing `?duration` param.
3. **Cut-phase volume indicator** — add `volumeReductionPct` to generate response when the nutrition multiplier fires; UI banner: `"Volume reduced 12% — calorie deficit"`.
4. **Cardio minimum warning** — post-generate, if estimated cardio < 45 min on a gym day, yellow banner + inline "add cardio" affordance.

**Definition of done:** grep returns only the shared module + import sites; duration picker, cut banner, cardio warning all visible at 430×932; API tests pass.

---

## Phase 5 — Exercise Swap UX During Active Workout

**Goal:** Swapping mid-workout is instant and obvious. (Unchanged from v1.)

1. **Pre-fetch swap candidates on workout load** — call `/api/generate-workout/replace` for all exercises when `log/[id]` loads; cache in `$state`.
2. **Inline alternatives** — replace drawer with 3 inline cards below the exercise header: name, last performed, suggested weight. One tap confirms.
3. **Swap reason hint** — quick-tap "Equipment taken" / "Want a variation" before alternatives; log as future training signal (don't change the algorithm yet).

**Definition of done:** Alternatives visible < 500 ms after tapping swap; one tap confirms.

---

## Phase 6 — Remaining Code Quality

**Goal:** Final polish. (CARDIO consolidation moved to Phase 4; README + CI moved to Phase 2.)

1. **Refactor `generate.ts`** into named functions: `detectCutPhase(db, today)`, `loadActiveProgramExercises(db, dayType)`, `applyNutritionVolumeReduction(workout, db, today)`. Route handler becomes ~20 lines of orchestration. Existing Vitest tests must pass unchanged.
2. **Extract Svelte components** → `packages/web/src/lib/components/`: `ExerciseCard.svelte`, `SetRow.svelte` (strength/cardio variants), `CardioInput.svelte`. (No `SwapDrawer` — Phase 5 replaced it; extract whatever inline-card component Phase 5 actually produced, if reusable.)
3. **Document the raw-SQL choice** — comment block in `packages/api/src/db.ts`: Drizzle for schema/types only; raw SQL queries are intentional, not a migration-in-progress.

**Definition of done:** `npm run build` passes; all tests green; UI verified at 430×932 via Playwright after component extraction.

---

## Sequencing Summary

| Phase | Description | Effort | Why this order |
|---|---|---|---|
| **1** | Hosting on Fly.io | Done | Resolved before the public flip |
| **2** | Data purge, README, CI, repo public | Medium | DB-files-in-history is the critical blocker; repo must be presentable the day it flips |
| **3** | AI assistant with tools | High | Headline feature; needs `ANTHROPIC_API_KEY` set as a Fly secret |
| **4** | CARDIO consolidation + generate UI | Medium | Consolidation must precede edits to its host files |
| **5** | Swap UX | Medium | Touches `log/[id]` — after Phase 4's shared module exists |
| **6** | generate.ts refactor + components | Low–Med | Pure polish; safe to do last |

### Subagent execution notes

- Each Todoist task carries its own description with file paths, commands, and acceptance criteria — treat the task description as the brief and this spec as backup context.
- Always read `CLAUDE.md` first: prod vs dev API prefix (`/api` only in prod), kg/meters in DB vs lbs/miles in UI, Svelte 5 runes only, mobile-first 430×932.
- After UI changes: run `/project:playwright-test`. After API changes: curl the dev URL.
- Never modify `fitlocal.db` directly — API only.
