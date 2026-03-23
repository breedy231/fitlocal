# FitLocal

Self-hosted workout tracker PWA — a Fitbod replacement you own.

## Tech Stack

- **Backend:** Fastify + TypeScript + SQLite (Drizzle ORM)
- **Frontend:** SvelteKit + Tailwind CSS (PWA)

## Setup

```bash
# Install all dependencies
npm install

# Run API (port 3001) and web (port 5173)
npm run dev
```

Or run them separately:

```bash
npm run dev:api   # http://localhost:3001
npm run dev:web   # http://localhost:5173
```

## Docker

```bash
docker compose up --build
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /workouts | List workouts |
| GET | /workouts/:id | Get workout with exercises & sets |
| POST | /workouts | Create workout |
| PUT | /workouts/:id | Update workout |
| DELETE | /workouts/:id | Delete workout |
| GET | /exercises | List exercises |
| POST | /exercises | Create exercise |
| PUT | /exercises/:id | Update exercise |
| DELETE | /exercises/:id | Delete exercise |
| POST | /sets | Add set |
| PUT | /sets/:id | Update set |
| DELETE | /sets/:id | Delete set |
| POST | /health-snapshots | Record health snapshot |
| GET | /health-snapshots | List health snapshots |
| POST | /import/fitbod | Import Fitbod CSV |
| GET | /health | Health check |

## New Endpoints (Phase 2-4)

| Method | Path | Description |
|--------|------|-------------|
| GET | /generate-workout?dayType=push&equipment=full | Generate workout |
| GET | /recovery-summary | Muscle recovery percentages |
| POST | /workout-exercises | Link exercise to workout |
| POST | /health/sync | iOS Shortcut health sync |

## Fitbod Import

Export your data from Fitbod as CSV, then:

```bash
curl -X POST http://localhost:3001/import/fitbod \
  -H "Content-Type: text/csv" \
  --data-binary @fitbod-export.csv
```

Or use the standalone import script:

```bash
npx tsx packages/api/src/import-fitbod.ts
```

## Apple Health iOS Shortcut Setup

Create an iOS Shortcut that syncs health data to FitLocal daily.

### Setup Steps

1. Open the **Shortcuts** app on your iPhone
2. Tap **+** to create a new shortcut
3. Name it "FitLocal Health Sync"

### Shortcut Actions (in order)

1. **Find Health Samples** — Type: Heart Rate Variability, Start Date: Last 24 Hours, Sort by: Start Date (Latest First), Limit: 1
2. **Set Variable** — Name: `hrv`, to: Health Sample Value
3. **Find Health Samples** — Type: Resting Heart Rate, Start Date: Last 24 Hours, Sort by: Start Date (Latest First), Limit: 1
4. **Set Variable** — Name: `restingHr`, to: Health Sample Value
5. **Find Health Samples** — Type: Sleep Analysis, Start Date: Last 24 Hours
6. **Set Variable** — Name: `sleepHours`, to: Health Sample Duration (in hours)
7. **Get Contents of URL**:
   - URL: `http://YOUR_TAILSCALE_IP:3001/health/sync`
   - Method: POST
   - Headers: `Content-Type: application/json`
   - Request Body (JSON):
     ```json
     {
       "hrv": hrv,
       "restingHr": restingHr,
       "sleepHours": sleepHours
     }
     ```

### Automation

1. Go to **Shortcuts → Automation → +**
2. Choose **Time of Day → 6:00 AM → Daily**
3. Select your "FitLocal Health Sync" shortcut
4. Toggle **Run Immediately** (no confirmation)

Replace `YOUR_TAILSCALE_IP` with your machine's Tailscale IP (run `tailscale ip -4`).
