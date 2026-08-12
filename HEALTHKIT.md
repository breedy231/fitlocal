# HealthKit Bridge — Swift App Contract

## Overview

A lightweight iOS app that syncs health data bidirectionally between Apple Health and FitLocal. It runs daily via `BGTaskScheduler` and can also be triggered manually.

## Data Flow

```
Apple Health ──reads──▶ Swift App ──POST /api/health/sync──▶ FitLocal Server
FitLocal Server ──GET /api/workouts/export──▶ Swift App ──writes──▶ Apple Health
```

## API Endpoints

### `POST /health/sync`
Daily push of today's health metrics.

**Request:**
```json
{
  "hrv": 45,
  "restingHr": 52,
  "sleepHours": 7.5,
  "steps": 8200,
  "bodyWeightKg": 82.1,
  "calories": 2100,
  "proteinG": 165
}
```

All fields optional — send whatever HealthKit provides. Server uses today's date.

### `POST /health/sync-batch`
Backfill historical data (initial setup or catch-up after offline period).

**Request:**
```json
{
  "snapshots": [
    { "date": "2025-01-15", "hrv": 45, "restingHr": 52, "sleepHours": 7.5 },
    { "date": "2025-01-16", "hrv": 48, "restingHr": 50, "sleepHours": 8.0 }
  ]
}
```

Upserts by date — existing fields not included in the payload are preserved (COALESCE).

### `GET /workouts/export?since=2025-01-01`
Fetch completed workouts for writing to Apple Health as workout samples.

**Response:**
```json
[
  {
    "date": "2025-01-15",
    "durationMinutes": 55,
    "caloriesBurned": 320,
    "exerciseType": "strength"
  }
]
```

`exerciseType` is `"strength"`, `"mixed"` (includes cardio), or `"cardio"`.

> **Note (#93):** This endpoint now **excludes Apple-measured cardio sets**
> (`source = 'apple_health'`) from the export, so cardio that originated in Apple
> Health is not written back and double-counted. Only FitLocal-native workout data
> is exported.

### `POST /workout-sessions`
Ingest completed Apple Health / Apple Watch **cardio** workout sessions (#93).
Each session either **enriches** a cardio set inside an overlapping FitLocal
workout, is **appended** to that workout, or becomes a **standalone** cardio
workout. Idempotent per `externalId`.

> Prod: `POST /api/workout-sessions` · Dev (`tsx watch`): `POST /workout-sessions` (no prefix).
> Requires the `Authorization: Bearer <FITLOCAL_API_KEY>` header like all `/api/*` routes.

**Request:** a single session object, an array of sessions, or `{ "sessions": [...] }`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `externalId` | string | **yes** | The `HKWorkout` UUID. Idempotency key — re-posting the same id updates in place, never duplicates. |
| `activityType` | string | **yes** | Apple activity type. Accepts Shortcut display names (`"Outdoor Run"`), `HKWorkoutActivityType*` identifiers, or raw enum words. Non-cardio types are skipped (see below). |
| `start` | ISO string / epoch ms | **yes** | Session start. |
| `end` | ISO string / epoch ms | **yes** | Session end. Must be after `start`, window ≤ the max active window. |
| `durationSeconds` | number | optional | Falls back to `(end − start)` when omitted. |
| `distanceMeters` | number | optional | Total distance (meters). |
| `energyKcal` | number | optional | Active energy burned (kcal). |
| `indoor` | boolean | optional | Explicit indoor flag; overrides inference from the activity name (picks e.g. `Running - Treadmill` vs `Running`). |
| `splits` | array | optional | Per-segment legs: `[{ distanceMeters, durationSeconds, avgHr? }]`. `avgHr` optional. |
| `hrSamples` | CSV string or array | optional | Same shape `/hr-samples` accepts: a CSV string of `<time>,<bpm>` lines, or an array of `{ t, bpm }` (flexible key names). Only samples inside `[start, end]` are kept and downsampled. |

**Example** (outdoor run with splits + HR samples):

```json
{
  "externalId": "8B1F2C3D-4E5A-6789-A0B1-C2D3E4F5A6B7",
  "activityType": "Outdoor Run",
  "start": "2026-08-12T13:02:00Z",
  "end": "2026-08-12T13:34:20Z",
  "durationSeconds": 1940,
  "distanceMeters": 5000,
  "energyKcal": 412,
  "indoor": false,
  "splits": [
    { "distanceMeters": 1609.34, "durationSeconds": 620, "avgHr": 151 },
    { "distanceMeters": 1609.34, "durationSeconds": 631, "avgHr": 158 },
    { "distanceMeters": 1609.34, "durationSeconds": 625, "avgHr": 162 }
  ],
  "hrSamples": "2026-08-12T13:02:10Z,148\n2026-08-12T13:03:10Z,153"
}
```

**Behavior (enrich-in-place model):**

- **Overlap → enrich.** A cardio session whose window overlaps an existing
  FitLocal workout (with a ±15 min grace) enriches the closest matching cardio
  set in place: it fills exact `durationSeconds` / `distanceMeters` / `energyKcal`,
  replaces splits, and attaches the HR samples — instead of creating a duplicate.
  Subjective fields (RPE, resistance, warm-up flag) are preserved.
- **Overlap but no matching set → append.** If the overlapping workout has no
  same-family cardio set to enrich, a new cardio set (or exercise) is appended to it.
- **No overlap → standalone.** A session with no overlapping workout creates a
  standalone cardio workout (`source = 'apple_health'`) on the session's local date.
- **Idempotent.** Re-posting the same `externalId` updates the existing set
  (duration/distance/energy/splits/HR), never duplicates.

**Response** — `201` with `{ "results": [ ... ] }`, one entry per input session:

```json
{ "results": [ { "externalId": "…", "status": "enriched_set", "workoutId": 812, "setId": 4471, "hrStored": 2 } ] }
```

Each result carries `externalId`, `status`, and (where applicable) `workoutId`,
`setId`, `hrStored`, and a `reason`. The six statuses:

| Status | Meaning |
|---|---|
| `created_workout` | No overlap — a standalone cardio workout was created for the session. |
| `enriched_set` | Filled an existing manual cardio set in an overlapping workout (no duplicate). |
| `appended_set` | Overlapping workout had no matching set — a new cardio set was appended. |
| `updated` | Same `externalId` seen before — the existing set was updated in place (idempotent). |
| `skipped_activity` | Activity type is not steady-state cardio (strength / HIIT / flexibility) — intentionally ignored. |
| `invalid` | Session rejected (missing `externalId`, unparseable timestamps, `end` ≤ `start`, window too long, exercise not found, or an internal error). `reason` explains which. |

**Skipped activity types.** Only steady-state cardio ingests: run, walk, hike,
cycle/bike, elliptical, row, stair stepper, swim. **Strength**
(traditional/functional/core), **HIIT-family** (HIIT, high-intensity interval,
cross-training, mixed cardio), and **flexibility/yoga/cooldown** all return
`skipped_activity`. You log strength by hand; Apple strength HR still attaches to
that manual workout through the existing `/hr-samples` flow.

## HealthKit Data Sources

| HealthKit Type | Field | Notes |
|---|---|---|
| `HKQuantityTypeIdentifier.heartRateVariabilitySDNN` | `hrv` | Daily average, ms |
| `HKQuantityTypeIdentifier.restingHeartRate` | `restingHr` | BPM |
| `HKCategoryTypeIdentifier.sleepAnalysis` | `sleepHours` | Sum of asleep intervals |
| `HKQuantityTypeIdentifier.stepCount` | `steps` | Daily total |
| `HKQuantityTypeIdentifier.bodyMass` | `bodyWeightKg` | Most recent sample |
| `HKQuantityTypeIdentifier.dietaryEnergyConsumed` | `calories` | Daily total (from MFP etc.) |
| `HKQuantityTypeIdentifier.dietaryProtein` | `proteinG` | Daily total (from MFP etc.) |

## iOS Shortcut: Workout Calorie Writeback

Add these steps to the existing **10 PM "FitLocal Sync"** Shortcut, after the health sync POST:

### Steps

1. **Get Contents of URL**
   - URL: `https://<server>/api/workouts/export?date=<Current Date formatted as yyyy-MM-dd>`
   - Method: GET

2. **If** → result is not empty (Count > 0)

3. **Repeat with Each** (the result array)

4. **Log Health Sample**
   - Type: **Active Energy Burned**
   - Value: `Repeat Item.caloriesBurned`
   - Unit: kcal
   - Date: `Repeat Item.date`

5. **End Repeat / End If**

### Notes
- The export endpoint uses MET-based calorie estimation factoring in your latest body weight
- Cardio exercises (treadmill, cycling, etc.) use reps-as-minutes at ~5 METs; strength sets at ~4 METs
- HealthKit deduplicates by source + date, so running the Shortcut twice won't double-count
- Use `?date=` for a single day (Shortcut use) or `?since=` for a date range (backfill)

---

## iOS Shortcut: Apple Cardio Session Ingest (#93)

Pushes a just-finished Apple Watch / Fitness cardio workout to
`POST /workout-sessions`, where it enriches the matching FitLocal cardio set (or
creates a standalone cardio workout). Runs automatically at the end of each workout.

### Automation trigger

- **When any workout ends** — if your iOS version exposes it, use
  Shortcuts → Automation → *Workout* → **When any workout ends** so a single
  automation covers every activity type.
- Otherwise create a per-workout-type automation (one each for Outdoor Run,
  Outdoor Cycle, etc.) that fires **When [Type] Ends**.
- Set the automation to **Run Immediately** (no confirmation prompt).

### Steps

1. **Get the finished workout** — the automation passes the workout as
   *Shortcut Input*. Read its fields into variables:
   - **Type** (activity type — e.g. "Outdoor Run")
   - **Start Date** and **End Date**
   - **Duration** (seconds)
   - **Distance** (convert to meters if needed)
   - **Active Energy** (kcal)

2. **(If reachable) Get HR samples** — *Find Health Samples* → **Heart Rate**,
   filtered to the window between Start Date and End Date. *Repeat with Each* to
   build a CSV string of `<ISO time>,<bpm>` lines (one per sample). Optional —
   skip if the samples aren't accessible in your Shortcuts build.

3. **Build the JSON** — a *Text* action (or *Dictionary* → *Get Text from Input*):

   ```json
   {
     "externalId": "<workout UUID>",
     "activityType": "<Type>",
     "start": "<Start Date, ISO 8601>",
     "end": "<End Date, ISO 8601>",
     "durationSeconds": <Duration>,
     "distanceMeters": <Distance in meters>,
     "energyKcal": <Active Energy>,
     "hrSamples": "<CSV built in step 2>"
   }
   ```

   Use the workout's UUID for `externalId` so re-runs stay idempotent. Omit
   `hrSamples` / `distanceMeters` / `energyKcal` if a value isn't available.

4. **Get Contents of URL** — POST the JSON:
   - URL: `https://<server>/api/workout-sessions`
   - Method: **POST**
   - Headers: `Authorization: Bearer <FITLOCAL_API_KEY>` (same header the other
     Shortcut steps use), `Content-Type: application/json`
   - Request Body: **JSON** (or File) = the text from step 3

### Notes
- **Splits are optional and often unreachable.** Per-mile / per-segment splits
  (`HKWorkoutEvent` segments) are **not reliably exposed to the Shortcuts app**,
  so leave `splits` out of the Shortcut payload — total **distance, energy,
  duration, and HR samples ARE reachable** from Shortcuts. Populating `splits`
  generally requires the companion Swift app.
- Only cardio ingests. Strength / HIIT / flexibility workouts return
  `skipped_activity` and are ignored — that's expected. Strength HR still flows
  through the separate `/hr-samples` Shortcut.
- Re-running for the same workout is safe: the endpoint updates in place by
  `externalId` and never duplicates.
- **Deleting an Apple-created set in FitLocal is not permanent** — its
  `external_id` is gone, so the next sync of that session re-creates it. To
  suppress an Apple session permanently, remove it in Apple Health instead.

---

## Web Push Notifications (Daily Briefing, #78)

The daily briefing script (`scripts/daily-briefing.py`) can push a notification to
subscribed browsers/PWA instances each morning after writing the Obsidian note.

### How it works

1. The client (Settings page in the PWA) calls `GET /api/push/vapid-public-key` to get
   the server's VAPID public key, subscribes via `pushManager.subscribe()`, and POSTs
   the resulting subscription to `POST /api/push-subscriptions`.
2. The briefing script reads all subscriptions via `GET /api/push-subscriptions` and
   sends a push payload `{"title":"...", "body":"...", "url":"/"}` using `pywebpush`.
3. The service worker's `push` event handler displays the notification. Tapping it
   focuses/opens the PWA at the configured URL.

### Generating VAPID keys (one-time setup)

```bash
npx web-push generate-vapid-keys
```

This prints a public key and private key. **Do not commit real keys.**

### Where to put the keys

| Location | Variable | Value |
|---|---|---|
| Fly.io app env (`fly secrets set`) | `FITLOCAL_VAPID_PUBLIC_KEY` | The public key (base64url) |
| Sender machine `.env` or launchd plist `EnvironmentVariables` | `FITLOCAL_VAPID_PRIVATE_KEY` | The private key (base64url) |
| Sender machine `.env` or launchd plist `EnvironmentVariables` | `FITLOCAL_VAPID_SUBJECT` | `mailto:your@email.com` |

The API only needs the **public** key (to serve it to the client). The briefing
script needs the **private** key (to sign push payloads). The subject is the
`mailto:` claim required by push services.

### Launchd plist snippet (private key + subject)

Add to `~/Library/LaunchAgents/com.brendan.fitlocal-briefing.plist` under
`<key>EnvironmentVariables</key>`:

```xml
<key>FITLOCAL_VAPID_PRIVATE_KEY</key>
<string>your_private_key_here</string>
<key>FITLOCAL_VAPID_SUBJECT</key>
<string>mailto:your@email.com</string>
```

### Installing pywebpush

```bash
pip3 install pywebpush
```

Push is fully optional — if `pywebpush` is not installed or either VAPID env var
is missing, the script logs "push skipped: ..." and continues normally.
