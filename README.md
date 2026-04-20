# FitLocal

Self-hosted workout tracker PWA — a Fitbod replacement you own. No subscriptions, no cloud lock-in. Runs on your Mac, accessible from your iPhone via local WiFi or Tailscale.

## Architecture

```
                                    ┌─────────────────────────────────────────────────┐
                                    │              Mac (always-on)                     │
                                    │                                                 │
┌──────────────┐   HTTPS/Tailscale  │  ┌─────────────────────────────────────────┐    │
│              │◄──────────────────► │  │         Fastify Server (:3001)          │    │
│   iPhone     │                    │  │                                         │    │
│   (PWA)      │   Service Worker   │  │  ┌──────────┐    ┌──────────────────┐   │    │
│              │   • cache-first    │  │  │ Static   │    │   API Routes     │   │    │
│  ┌────────┐  │     static assets  │  │  │ SvelteKit│    │                  │   │    │
│  │SvelteKit│ │   • network-first  │  │  │ Build    │    │  /workouts       │   │    │
│  │  PWA    │ │     API (3s timeout│  │  │ (/*)     │    │  /exercises      │   │    │
│  └────────┘  │     → cache)       │  │  └──────────┘    │  /generate       │   │    │
│  ┌────────┐  │                    │  │                  │  /recovery       │   │    │
│  │Offline │  │   IndexedDB queue  │  │                  │  /reports        │   │    │
│  │ Queue  │  │   for mutations    │  │                  │  /programs       │   │    │
│  └────────┘  │   when offline     │  │                  │  /health         │   │    │
└──────────────┘                    │  │                  └────────┬─────────┘   │    │
                                    │  │                           │             │    │
┌──────────────┐                    │  │                  ┌────────▼─────────┐   │    │
│  iOS         │   POST /health/    │  │                  │    Drizzle ORM   │   │    │
│  Shortcut    │──── sync ─────────►│  │                  │                  │   │    │
│  (daily 6AM) │                    │  │                  │  ┌────────────┐  │   │    │
└──────────────┘                    │  │                  │  │ SQLite     │  │   │    │
                                    │  │                  │  │ (WAL mode) │  │   │    │
┌──────────────┐                    │  │                  │  │            │  │   │    │
│  Apple Health│  HealthKit XML     │  │                  │  │ fitlocal.db│  │   │    │
│  Export      │──── import ───────►│  │                  │  └────────────┘  │   │    │
└──────────────┘                    │  │                  └──────────────────┘   │    │
                                    │  └─────────────────────────────────────────┘    │
                                    │                                                 │
                                    │  LaunchAgent: auto-start, keep-alive, logging   │
                                    └─────────────────────────────────────────────────┘
```

### Data Flow

```
Generate Workout                          Log Workout                    Reports
     │                                         │                            │
     ▼                                         ▼                            ▼
┌──────────┐   recovery %    ┌──────────┐  set data   ┌──────────┐   aggregations
│ Recovery │◄────────────────│ Workout  │────────────►│ Reports  │◄──────────
│ Engine   │   muscle state  │ Logger   │  (reps,     │ Engine   │   (volume,
│          │                 │          │   weight,   │          │    frequency,
│ 48h half-│   progression   │ Batch    │   RPE)      │ Charts   │    PRs, trends)
│ life     │◄────────────────│ Create   │             │ (SVG)    │
│ decay    │   weight/rep    │ (single  │             └──────────┘
└──────────┘   suggestions   │  txn)    │
     │                       └──────────┘
     ▼                             │
┌──────────┐                       │          ┌──────────┐
│ Generator│                       └─────────►│ Health   │
│          │   double progression              │ Sync     │
│ Day type │◄──────────────────────────────────│          │
│ Equipment│   HRV/sleep modifier             │ iOS      │
│ Supersets│                                   │ Shortcut │
└──────────┘                                   └──────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | SvelteKit 2.15, Svelte 5, Tailwind CSS, TypeScript |
| **Backend** | Fastify 5.2, Drizzle ORM 0.38, TypeScript |
| **Database** | SQLite (better-sqlite3) with WAL mode |
| **PWA** | Service worker, IndexedDB offline queue, manifest |
| **Charts** | Hand-rolled SVG (no D3/Chart.js) |
| **Deployment** | macOS LaunchAgent, Tailscale for remote access |

## Setup

```bash
npm install
npm run dev          # API (:3001) + Web (:5173) in parallel
```

Or separately:

```bash
npm run dev:api      # http://localhost:3001
npm run dev:web      # http://localhost:5173
```

### Production

```bash
npm run build
NODE_ENV=production node packages/api/dist/server.js   # serves API + static web on :3001
```

### LaunchAgent (auto-start on Mac boot)

```bash
scripts/install-launchagent.sh    # builds, symlinks plist, loads agent
```

Logs: `tail -f ~/Library/Logs/fitlocal.log`

### Docker

```bash
docker compose up --build
```

## Features

### Workout Generation
- **Day types:** Upper, Lower, Full Body
- **Equipment profiles:** Full Gym, Travel (dumbbells/bodyweight/bands)
- **Recovery-aware:** Exercises weighted by muscle recovery state (exponential decay, 48h half-life)
- **Progressive overload:** Double progression — hit top of rep range 2/3 sessions → increase weight
- **Health modifier:** Poor HRV/sleep → suppressed progressions, fewer sets
- **Supersets:** Automatic antagonist pairing (chest+back, biceps+triceps, quads+hamstrings) — toggleable
- **Exercise swapping:** Replace any exercise with same-muscle alternatives (searchable)
- **Weight estimation:** New exercises get starting weights estimated from your history on similar muscle groups

### Workout Logging
- Set-by-set logging with +/- reps and weight (lbs display, kg storage)
- Rest timer with haptic vibration on set completion
- Plate calculator for barbell exercises
- Warm-up stretches before workout (muscle-specific)
- Cool-down stretches after finishing
- Workout summary screen (volume, duration, exercises)

### Program Support
- Import training programs from Muscle & Strength PDFs
- Day-by-day progression through program schedule
- Cardio plan tracking (weekly sessions with completion count)
- Add exercises to program days on the fly
- Fuzzy exercise matching (program names → exercise library)

### History
- Paginated workout list with expandable detail (sets x reps x weight)
- Search by exercise name
- Edit workout dates/notes, individual sets
- Bulk delete with multi-select
- Manual workout logging

### Reports

**Training tab:**
- Summary cards: streak, workouts this week/month, total volume
- Weekly frequency bar chart (12 weeks)
- Volume per workout line chart (30 workouts)
- Muscle group distribution (30 days)
- Exercise progression drill-down (select exercise → weight over time)
- Personal records table (top 10 by max weight)

**Health tab:**
- Body weight trend, daily steps, HRV, resting HR
- Sleep hours, calories, protein
- Configurable time range (30/90/365 days or all)

### Apple Health Integration
- iOS Shortcut syncs daily at 6 AM: HRV, resting HR, sleep, steps, weight, calories, protein
- Apple Health XML export import (bulk backfill via zip upload)
- Batch sync endpoint for historical data

### Offline & Performance
- **Service worker:** Network-first for API (3s timeout → cache fallback), cache-first for static assets
- **IndexedDB queue:** Mutations persist when offline, replay on reconnect
- **In-memory cache:** Stale-while-revalidate with per-endpoint TTLs and automatic invalidation on writes
- **Server cache headers:** `Cache-Control` tuned per endpoint (exercises: 1h, workouts: 10s, reports: 60s)
- **Batch queries:** N+1 elimination across workout list/detail, progression, recovery, and exercise swap
- **DB indexes:** Covering indexes on workout_exercises, sets, and workouts for JOIN-heavy queries

## Project Structure

```
fitlocal/
├── fitlocal.db                         # SQLite database
├── packages/
│   ├── api/
│   │   └── src/
│   │       ├── server.ts               # Fastify app, route registration, cache headers
│   │       ├── db.ts                   # Drizzle client, WAL mode, indexes
│   │       ├── schema/index.ts         # Table definitions (Drizzle)
│   │       ├── migrate.ts              # Schema migrations (raw SQL)
│   │       ├── routes/
│   │       │   ├── workouts.ts         # CRUD, batch start, export, bulk delete
│   │       │   ├── exercises.ts        # Library, search, progression endpoint
│   │       │   ├── sets.ts             # Set-level CRUD
│   │       │   ├── generate.ts         # Workout generation + exercise swap
│   │       │   ├── recovery.ts         # Muscle recovery percentages
│   │       │   ├── reports.ts          # Analytics queries
│   │       │   ├── health.ts           # Health sync (single + batch)
│   │       │   ├── programs.ts         # Program CRUD, PDF import, active tracking
│   │       │   ├── import.ts           # Fitbod CSV import
│   │       │   └── stretches.ts        # Warm-up/cool-down stretches
│   │       └── lib/
│   │           ├── generator.ts        # Exercise selection, superset pairing
│   │           ├── progression.ts      # Double progression, weight estimation
│   │           ├── recovery.ts         # Exponential decay recovery model
│   │           ├── stretches.ts        # Stretch library by muscle group
│   │           ├── pdf-parser.ts       # M&S PDF → program exercises
│   │           └── health-xml-parser.ts # Apple Health XML parser
│   └── web/
│       └── src/
│           ├── service-worker.ts       # API cache, offline support
│           ├── lib/
│           │   ├── api.ts              # Fetch wrapper, offline queue integration
│           │   ├── api-cache.svelte.ts # Stale-while-revalidate reactive cache
│           │   ├── offline-queue.ts    # IndexedDB mutation queue
│           │   ├── toast.ts            # Notifications
│           │   ├── BarChart.svelte     # SVG bar chart
│           │   ├── LineChart.svelte    # SVG line chart (hover tooltips)
│           │   ├── ExerciseDetail.svelte
│           │   ├── ExerciseSearch.svelte
│           │   └── PlateCalculator.svelte
│           └── routes/
│               ├── +layout.svelte      # Bottom nav, settings overlay
│               ├── +page.svelte        # Home: recovery heatmap, recent workouts
│               ├── generate/           # Workout generation + program mode
│               ├── log/[id]/           # Set-by-set workout logging
│               ├── history/            # Workout list, search, edit
│               ├── reports/            # Training + health analytics
│               ├── programs/           # Program list + detail
│               └── settings/           # Equipment, import, health config
├── scripts/
│   ├── build.sh                        # Production build
│   └── install-launchagent.sh          # LaunchAgent setup
├── com.fitlocal.server.plist           # macOS LaunchAgent config
├── docker-compose.yml
└── HEALTHKIT.md                        # iOS Swift app contract
```

## Database Schema

| Table | Purpose |
|-------|---------|
| `workouts` | Workout sessions (date, location_profile, notes) |
| `exercises` | Exercise library — 334 entries with muscles, equipment, images (wger API) |
| `workout_exercises` | Links exercises to workouts (display order, superset groups) |
| `sets` | Individual sets (reps, weight_kg, is_warmup, RPE, multiplier) |
| `programs` | Training programs from PDF import (days, cardio plan) |
| `program_days` | Workout days within a program |
| `program_exercises` | Exercises within program days |
| `active_program` | Currently active program + day index |
| `health_snapshots` | Daily health metrics (HR, HRV, sleep, steps, weight, calories, protein) |
| `equipment_profiles` | Saved equipment configurations |

All weights stored in kg internally, displayed in lbs in the UI.

## Key Algorithms

### Recovery Model
Each muscle group's recovery is calculated with exponential decay (48-hour half-life). Recent sets contribute fatigue proportional to volume (reps x weight), decaying over time. Current fatigue is normalized against the user's 95th percentile historical session load. The result: a 0-100% recovery score per muscle group that drives workout generation.

### Progressive Overload (Double Progression)
Exercises are classified by name pattern: barbell compound (4-6 reps, +2.5 kg), dumbbell compound (6-10, +2 kg), accessory (8-12, +1 kg), bodyweight (8-15, +reps), cardio. A 3-session lookback determines the directive: hit top of range 2/3 → **progress** (increase weight, reset reps); miss bottom 2/3 → **deload** (drop 10%); otherwise → **hold**.

### Weight Estimation for New Exercises
When an exercise has no history, FitLocal estimates a starting weight by finding exercises you've done that share the same primary muscles, averaging their working weights, applying a conversion factor for exercise type differences (e.g., barbell → dumbbell = 0.6x), and applying an 80% safety factor.

## Data Import

### Fitbod CSV
```bash
curl -X POST http://localhost:3001/import/fitbod \
  -H "Content-Type: text/csv" \
  --data-binary @fitbod-export.csv
```

Idempotent — skips dates already in the database.

### Apple Health XML
Upload a HealthKit export zip via the Settings page. Parses heart rate, HRV, sleep, steps, weight, calories, and protein data.

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | /workouts | List workouts (with exercise/set counts) |
| GET | /workouts/:id | Workout detail (exercises + sets, single JOIN) |
| POST | /workouts/start | Batch create workout + exercises + sets (single transaction) |
| PUT | /workouts/:id | Update workout |
| DELETE | /workouts/:id | Delete workout |
| GET | /exercises | List all exercises |
| GET | /exercises/search?q= | Search exercises by name |
| GET | /exercises/:id/progression | Progression data for a single exercise |
| POST | /sets | Create set |
| PUT | /sets/:id | Update set |
| DELETE | /sets/:id | Delete set |
| GET | /generate-workout | Generate workout (dayType, equipment, supersets) |
| GET | /generate-workout/replace | Swap a single exercise |
| GET | /recovery-summary | All muscle group recovery percentages |
| GET | /reports/summary | Workout totals, streak, frequency |
| GET | /reports/frequency | Weekly workout frequency (12 weeks) |
| GET | /reports/volume | Volume per workout (30 workouts) |
| GET | /reports/muscle-distribution | Muscle group volume distribution |
| GET | /reports/personal-records | Top lifts by weight |
| GET | /reports/exercise-progression | Weight over time for an exercise |
| GET | /reports/exercises-with-history | Exercises that have logged sets |
| GET | /reports/health-trends | Health snapshot time series |
| GET | /programs | List programs |
| GET | /programs/:id | Program detail with days + exercises |
| GET | /programs/active | Active program with current day + progression data |
| POST | /programs/active/advance | Advance to next program day |
| POST | /health/sync | Daily health data push |
| POST | /health/sync-batch | Backfill health data |
| POST | /import/fitbod | Import Fitbod CSV |
| GET | /stretches?muscles= | Stretches for muscle groups |
| GET | /health | Health check |

## Apple Health iOS Shortcut

Create an iOS Shortcut for daily health sync:

1. **Find Health Samples** — HRV (last 24h, latest, limit 1) → set `hrv`
2. **Find Health Samples** — Resting Heart Rate (last 24h) → set `restingHr`
3. **Find Health Samples** — Sleep Analysis (last 24h) → set `sleepHours` (duration in hours)
4. **Get Contents of URL:**
   - URL: `http://YOUR_TAILSCALE_IP:3001/health/sync`
   - Method: POST, Content-Type: application/json
   - Body: `{ "hrv": hrv, "restingHr": restingHr, "sleepHours": sleepHours }`

Automate: Shortcuts → Automation → Time of Day → 6:00 AM → Daily → Run Immediately.

Get your Tailscale IP: `tailscale ip -4`
