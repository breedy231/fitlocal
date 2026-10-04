# Cloud sessions (Claude Code on the web)

A cloud session runs in a fresh Linux container with a shallow clone of this
repo at `/home/user/fitlocal`. None of the Mac's gitignored local state exists
there. This page lists what's different and gives a verified recipe for running
the app. Last verified 2026-09-27 on Node 22.22 against `main` @ 4041df6.

## What the container has and lacks

| | Cloud container | Consequence |
|---|---|---|
| `node_modules` | Installed by the SessionStart hook (`.claude/hooks/session-start.sh`) when it's registered; otherwise missing | If `node_modules` is missing, run `npm ci` (about 10s). Never `npm install`: it rewrites `package-lock.json` with metadata churn. |
| `packages/shared/dist` | Built by the hook; otherwise missing (gitignored) | `fitlocal-shared` resolves to `dist/`, so the API, web app, tests and svelte-check can't import it until `npm run build -w packages/shared` has run (`npm run seed` builds it too). |
| `.env` | Missing | Fine: the API dev script uses `--env-file-if-exists`. Without it, `FITLOCAL_API_KEY` and `ANTHROPIC_API_KEY` are unset. Don't `touch .env` to work around anything. |
| `fitlocal.db` | Missing: **no real data exists here** | Seed a demo DB into your scratchpad. |
| `FITLOCAL_API_KEY`, `ANTHROPIC_API_KEY` | Unset | No authenticated production calls, and the AI assistant can't be exercised. |
| Production (`fitlocal-app.fly.dev`) | **Not reachable**: the host isn't in the environment's network allowlist, so requests hang or get a proxy 403 | `/workout`, `/cut-status`, `/gym-swap`, `/deploy` and `scripts/check-active-workout.sh` can't run. Always pass `curl -m 20` so a blocked call fails fast. |
| `gh` CLI | Missing (installing it doesn't help: the proxy blocks GitHub GraphQL) | Use the `mcp__github__*` tools. |
| `fly`, `sqlite3`, `litestream`, `tailscale`, `todoist` | Missing | Deploys, `npm run backup` and launchd backups are Mac-only. Inspect a DB copy with `better-sqlite3` from `node -e`. Litestream can be downloaded from its GitHub release for testing with a `file` replica. Never point it at R2. |
| Playwright | Global 1.56 at `/opt/node22/lib/node_modules/playwright`, Chromium at `/opt/pw-browsers`. No Playwright MCP, no WebKit | See [Screenshots](#screenshots-at-430932). Never run `playwright install`. |
| Docker | CLI only, no daemon | The Fly image can't be built here. |
| Clock | UTC (TZ unset), same as production | See [Dates](#dates-and-the-utc-clock). |
| Git | Shallow (50 commits), on an auto-created `claude/*` branch | `git fetch --unshallow` before digging through older history. |

## Running the app

`S` is any scratch directory, ideally your session scratchpad. Use absolute
paths for `DATABASE_PATH`, and **never let it default**: the default creates
`fitlocal.db` in the repo root.

```bash
cd /home/user/fitlocal
[ -d node_modules ] || npm ci   # the SessionStart hook normally did this

# Demo DB: builds packages/shared if needed, runs migrations, then loads
# 112 exercises, 24 PPL workouts (six weeks ending yesterday), 536 sets and
# 42 days of health data. Refuses a non-empty file.
DATABASE_PATH=$S/demo.db npm run seed

# API on :3001 (dev has no /api prefix)
PORT=3001 DATABASE_PATH=$S/demo.db setsid nohup npm run dev:api > $S/api.log 2>&1 &
curl -s -m 20 localhost:3001/workouts | head -c 200

# Web on :5173. Its Vite proxy is hard-coded to localhost:3001.
(cd packages/web && setsid nohup npx vite dev --port 5173 --strictPort > $S/web.log 2>&1 &)
```

- **Empty but migrated DB:** `npm run build -w packages/shared && (cd packages/api && DATABASE_PATH=$S/empty.db npx tsx src/migrate.ts)`. Don't boot the API on a brand-new empty file on `main` @ 4041df6: it crashes with `no such table` (fixed in PR #107).
- **What the seed doesn't cover:** only workouts, sets, exercises, goals and health snapshots get data. Programs, routines, challenges, achievements, Apple cardio/HR and push subscriptions start empty. Create fixtures through the API, and say so in test notes.
- **Don't use `dev:api:scratch` in cloud.** With no `fitlocal.db` to copy, it starts on an empty DB after deleting any file you pre-seeded at its path.

### Several agents in one container

Subagents and workflow agents in a session share one container: the same
checkout, ports, `/tmp` and process table. Worktree isolation separates files,
not ports.

- Give each agent its own `PORT` and `DATABASE_PATH`. Check a port first with `lsof -iTCP:<port> -sTCP:LISTEN`.
- The web app only talks to an API on :3001 (Vite proxy target; `getApiBase()` returns `/api` only on port 5173). With a second web/API pair on other ports, the web app silently reaches whichever API owns :3001. Use a scratch Vite config that overrides `server.proxy['/api'].target` (it must be a `.mts` file), or run one pair at a time.
- Start servers with `setsid` and stop them by process group: `kill -- -$(ps -o pgid= -p <pid> | tr -d ' ')`. Killing the `npx` PID leaves `tsx`/`vite` children running. **Never `pkill -f` or `killall`**: that kills other agents' servers.
- Rebuilding `packages/shared` restarts every `tsx watch` API that imports it.

## Checks

```bash
npm run test:run -w packages/api        # ~4s, 272 tests on 4041df6
npm run lint                            # ~5s
npm run build                           # ~12s
npm run build -w packages/shared && (cd packages/web && npx svelte-kit sync) \
  && npx -y svelte-check@4 --workspace packages/web   # 0 errors / 48 warnings
```

svelte-check gives meaningless output until both `packages/shared/dist` and
`packages/web/.svelte-kit` exist.

## Screenshots at 430×932

No Playwright MCP here. Drive the global Playwright from a CommonJS script:

```js
// $S/shot.cjs; run with: NODE_PATH=/opt/node22/lib/node_modules node $S/shot.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({
    viewport: { width: 430, height: 932 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true,
    ignoreHTTPSErrors: true, // Chromium doesn't trust the proxy CA (Google Fonts)
  })).newPage();
  await page.goto('http://localhost:5173/');
  await page.screenshot({ path: (process.env.S || '/tmp') + '/home.png' });
  await browser.close();
})();
```

Or use the CLI: `playwright screenshot --viewport-size=430,932 --ignore-https-errors <url> $S/home.png`.

- Don't use `devices['iPhone 15 Pro Max']`: it defaults to WebKit, which isn't installed, and its viewport is 430×739.
- Chromium is not iOS Safari. WebKit's `Load failed` fetch error, PWA swipe-kill and service-worker eviction can't be reproduced here, so cover them with unit tests and say so in results.
- Keep screenshots in the scratchpad, never in the repo. The repo is **public**, and screenshots of real data are personal data.

## Dates and the UTC clock

The container runs in UTC like production, while the user's dates are
America/Chicago. From 7pm Central (6pm in winter) until midnight, the UTC
date is already tomorrow.

- Leave `TZ` unset when testing server code. That matches production and exposes the bugs. Set `TZ=America/Chicago` only for a deliberate Mac-parity run.
- For "today" or "yesterday" in shell steps, use `TZ=America/Chicago date +%F`, never bare `date`.

## GitHub from a cloud session

- Use the `mcp__github__*` tools. `pull_request_read` `get` returns `mergeable_state` (lowercase: `clean`/`blocked`/`behind`/`dirty`/`unstable`/`unknown`). List results don't include it, and there's no delete-branch tool.
- The session harness forbids empty commits and close/reopen to kick CI. For a PR whose checks never ran: if it's behind `main`, `update_pull_request_branch` starts a fresh run; otherwise report it to the user.
- Scheduled Routines run at most hourly. Use `subscribe_pr_activity` for event-driven PR watching.
- Merges stay confirm-first, whatever the tool.

## Enabling production access (optional, user action)

To let cloud sessions run `/workout`, `/cut-status` and `/gym-swap` against real
data, the environment needs `fitlocal-app.fly.dev` in its network allowlist and
`FITLOCAL_API_KEY` as an environment secret. Both are set in the cloud
environment's settings, not in the repo. Deploys stay Mac-only either way (no
`fly` CLI or token).

## Mac-only

`fly deploy/logs/status`, `npm run backup` and the launchd backups,
`scripts/daily-briefing.py` (local Ollama and a vault checkout),
`HEALTHKIT.md`'s Shortcut and VAPID setup, Tailscale HTTPS certs, and anything
that needs the real `fitlocal.db`.

## Delegating to other cloud sessions

A delegated session starts from a fresh clone and only knows what's in `main`
plus its prompt. The SessionStart hook installs dependencies, but seeding is
per-task: tell delegated sessions to seed into their own scratchpad
`DATABASE_PATH`. Also list the exact files each task may
touch and check the lists for overlap before dispatching. When two PRs share a
file (e.g. `server.ts`, `ci.yml`), the second to merge has to merge `main` in
and re-run CI.
