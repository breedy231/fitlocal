# FitLocal — v0 Product Overview

*Self-hosted Fitbod replacement. Mobile-first PWA, runs on your Mac, accessible from anywhere via Tailscale.*

---

## What It Is

FitLocal is a personal workout tracking app built to replace Fitbod. It lives on your Mac (SQLite DB, local API), is accessible from your iPhone via local WiFi or Tailscale, and stores all your data locally — no subscriptions, no cloud lock-in.

The core loop: generate a workout based on your muscle recovery state → log it set-by-set → review history and progress over time.

---

## Architecture

```
iPhone (PWA) ←→ SvelteKit Web (port 5173) ←→ Fastify API (port 3001) ←→ SQLite DB
```

### Stack
- **Web:** SvelteKit PWA (Svelte 5, Tailwind CSS, dark theme)
- **API:** Fastify + Drizzle ORM
- **DB:** SQLite (`fitlocal.db`) — single file, no server required
- **Deployment:** Dev server (`npm run dev`) on Mac, accessed via local IP or Tailscale
- **Charts:** Hand-rolled SVG (no dependencies)

### Running It
```bash
cd ~/Projects/fitlocal && npm run dev
# Web: http://192.168.50.238:5173 (local) or http://100.97.122.88:5173 (Tailscale)
# API: http://192.168.50.238:3001
```

No process manager — if the Mac sleeps or crashes, it goes down. Manual restart required.

---

## Data Model

| Table | Description |
|-------|-------------|
| `workouts` | One row per workout session (date, notes) |
| `exercises` | Exercise library (334 exercises, enriched from wger API with muscles/equipment/images) |
| `workout_exercises` | Join: which exercises were in a workout, in what order |
| `sets` | Individual sets (reps, weight_kg, is_warmup, rpe, multiplier) |
| `muscle_groups` | Canonical muscle group names |
| `health_snapshots` | Daily health data (HR, HRV, sleep, steps, weight, calories, protein) |
| `equipment_profiles` | Saved equipment configs (full gym vs travel) |

All weights stored in kg internally, displayed in lbs throughout the UI.

---

## Seeded Data

- **403 workouts** imported from Fitbod CSV history (2021–2026)
- **334 exercises** with muscle group mappings, equipment tags, rest times, and images
- **14,780 sets** of historical lifting data

---

## Features (v0)

### 🏠 Home
- Muscle recovery heatmap — shows each muscle group's recovery % (green/yellow/red)
- Quick Generate Workout button
- Recent workouts list — tappable, links to detail view

### ⚡ Generate Workout
- Select day type: Upper / Lower / Full Body
- Equipment toggle: Full Gym / Travel
- Generates a workout based on muscle recovery state (recovery model weights exercises by days since last training)
- Shows sets × reps × suggested weight (in lbs), last performed date, focus exercise badge
- Regenerate button to get a different workout
- Per-exercise swap button (↻) to replace individual exercises with same-muscle alternatives
- Start Workout → creates workout in DB and navigates to log view

### 📝 Log Workout
- Set-by-set logging with +/- reps and lbs input
- Checkmark to complete each set — triggers rest timer with haptic vibration
- Add Set button per exercise
- All-sets-complete animation (green flash + haptic)
- Finish Workout → saves all sets, shows workout summary (volume, duration, exercises), then navigates to history
- Cool-down stretch sequence after finishing (based on muscles worked)

### 📋 History
- Paginated workout list, newest first
- Expand any workout to see exercises + sets × reps × weight
- Search by exercise name
- Edit mode: multi-select checkboxes + bulk delete
- Single workout delete with confirmation
- Inline error toasts (no blocking alerts)
- Manual workout logging via "+ Log Workout"

### 📊 Reports
- **Training tab:**
  - Summary cards: current streak, workouts this week/month
  - Weekly frequency bar chart (last 12 weeks)
  - Volume per workout line chart (last 30 workouts)
  - Muscle group distribution (30-day)
  - Exercise progression drill-down (select exercise → weight over time chart)
  - Personal records table (top 10 by max weight)
  - All charts: stretches/foam rolls excluded, responsive width, no horizontal scroll
- **Health tab:**
  - Body weight trend
  - Daily steps, HRV, resting HR, sleep, calories, protein
  - Empty state when no health data exists
- Tab highlight fixed (uses SvelteKit `$page` store for reactivity)

### ⚙️ Settings
- Equipment profile selector
- Fitbod CSV import (file picker, idempotent — skips dates already in DB, 10MB limit)
- Apple Health sync: endpoint URL, JSON schema, test connection button
- Persistent gear icon (floating overlay, top-right) accessible from every page

### Navigation
- Bottom nav: Home / Generate / Log / History / Reports
- Active tab highlights correctly on all navigation

---

## Key Technical Decisions

**Recovery model:** Each muscle group gets a recovery % based on days since last training. More recovered = more likely to be included in the generated workout. The model uses a simple exponential decay curve seeded from Fitbod CSV history.

**Muscle matching:** Keyword-based matching from exercise names to muscle groups. Known edge cases fixed: leg press → quads (not chest), kickback → glutes (not triceps), etc.

**Idempotent import:** Fitbod CSV import skips dates that already have a workout. Re-importing won't create duplicates.

**Date handling:** All date creation uses local date (not `toISOString()` which returns UTC and causes off-by-one before midnight UTC ≈ 6 PM CDT).

**Charts:** Pure SVG, no dependencies. `bind:clientWidth` on wrapper divs for responsive sizing. Y-axis uses clean tick values.

**Stretch exclusion:** All reports queries explicitly exclude exercises matching `stretch` or `foam roll` patterns.

---

## Known Gaps / Not Built Yet

- **No authentication** — anyone on the network/Tailscale can access it
- **No production build** — runs as dev server, no PM2/LaunchAgent to keep it alive
- **Apple Health iOS Shortcut** — endpoint exists, schema documented in Settings, but the Shortcut itself needs to be created manually
- **No push notifications** — no way to remind you to work out
- **No social/sharing features**
- **No progressive overload tracking** — weight suggestions are based on last session, not a structured progression scheme
- **No superset support** — exercises are independent, no grouping
- **No cardio tracking beyond duration** — treadmill/bike just logs duration, no pace/distance/HR
- **Fitbod parity gaps:** no AI-suggested progression, no plate calculator, no body measurements

---

## Data Integrity Notes

- **828 duplicate workouts** were created and cleaned up after an accidental double-import (March 2026). The import route now prevents this.
- Exercise muscle mappings are keyword-based and imperfect — some exercises may be miscategorized.
- wger exercise images: ~146 of 334 exercises have images; the rest show no image.

---

## File Structure

```
fitlocal/
├── fitlocal.db                    # SQLite database
├── packages/
│   ├── api/
│   │   └── src/
│   │       ├── server.ts          # Fastify app setup (10MB body limit)
│   │       ├── db.ts              # Drizzle client (WAL mode, FK on)
│   │       ├── schema/index.ts    # All table definitions
│   │       ├── migrate.ts         # Schema migrations
│   │       └── routes/
│   │           ├── workouts.ts    # CRUD + bulk delete + exerciseName search
│   │           ├── exercises.ts   # Exercise library
│   │           ├── sets.ts        # Set CRUD
│   │           ├── generate.ts    # Workout generator + single-exercise swap
│   │           ├── recovery.ts    # Muscle recovery model
│   │           ├── reports.ts     # All analytics queries
│   │           ├── health.ts      # Health snapshot sync
│   │           ├── import.ts      # Fitbod CSV importer
│   │           └── stretches.ts   # Post-workout cool-down
│   └── web/
│       └── src/
│           ├── lib/
│           │   ├── api.ts         # Fetch wrapper (no Content-Type on bodyless requests)
│           │   ├── BarChart.svelte
│           │   ├── LineChart.svelte
│           │   └── ExerciseDetail.svelte
│           └── routes/
│               ├── +layout.svelte # Bottom nav + settings gear overlay
│               ├── +page.svelte   # Home (recovery + recent workouts)
│               ├── generate/      # Workout generator
│               ├── log/[id]/      # Active workout logging
│               ├── history/       # Workout history + search + edit
│               ├── reports/       # Analytics dashboard
│               └── settings/      # Import + health sync config
```

---

## Branch

All v0 work lives on `claude/reporting-health-integrations-NlYqH` — PR #6 on GitHub (`breedy231/fitlocal`). Not yet merged to main.
