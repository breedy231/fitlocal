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
