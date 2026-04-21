/**
 * Health / HealthKit sync response shapes.
 */

export interface HealthSnapshot {
  id: number;
  date: string;
  restingHr: number | null;
  hrv: number | null;
  sleepHours: number | null;
  calories: number | null;
  proteinG: number | null;
  steps: number | null;
  bodyWeightKg: number | null;
}

export interface HealthSyncRequest {
  hrv?: number;
  restingHr?: number;
  sleepHours?: number;
  steps?: number;
  bodyWeightKg?: number;
  bodyWeightLbs?: number;
  calories?: number;
  proteinG?: number;
}

/** POST /health/sync-batch */
export interface HealthSyncBatchRequest {
  snapshots: Array<{
    date: string;
    hrv?: number;
    restingHr?: number;
    sleepHours?: number;
    steps?: number;
    bodyWeightKg?: number;
    calories?: number;
    proteinG?: number;
  }>;
}
export interface HealthSyncBatchResponse {
  synced: { date: string; action: 'inserted' | 'updated' }[];
}

/** POST /health/import-samples */
export interface HealthImportSamplesRequest {
  type: 'hrv' | 'restingHr' | 'sleep' | 'steps' | 'bodyWeight' | 'calories';
  samples: { date: string; value: number }[];
}
export interface HealthImportSamplesResponse {
  type: string;
  samplesReceived: number;
  daysAggregated: number;
  inserted: number;
  updated: number;
}

/** POST /health/import-apple */
export interface HealthImportAppleResponse {
  daysProcessed: number;
  dateRange: string;
  inserted: number;
  updated: number;
  sampleCounts: Record<string, number>;
}
