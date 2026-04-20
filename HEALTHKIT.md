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
