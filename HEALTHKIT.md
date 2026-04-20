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

## Swift App Behavior

### Daily Sync (Background)
1. Register `BGAppRefreshTask` with identifier `com.fitlocal.healthsync`
2. On trigger: query HealthKit for today's values
3. `POST /health/sync` to FitLocal server (configurable host URL)
4. `GET /workouts/export?since={lastSyncDate}` — write any new workouts to HealthKit
5. Schedule next refresh

### Initial Setup
1. Request HealthKit permissions (read: all above types; write: workout type)
2. Query last 90 days of health data
3. `POST /health/sync-batch` to backfill

### Configuration
- Server URL stored in `UserDefaults` (e.g., `http://macbook.local:3001`)
- Last sync date tracked in `UserDefaults`

## Discovery

The Swift app finds the server via:
1. User-entered URL (settings screen)
2. Bonjour/mDNS discovery (future enhancement)
