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

## Fitbod Import

Export your data from Fitbod as CSV, then:

```bash
curl -X POST http://localhost:3001/import/fitbod \
  -H "Content-Type: text/csv" \
  --data-binary @fitbod-export.csv
```
