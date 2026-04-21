/**
 * Recovery / training-load / deload response shapes.
 */

export interface MuscleRecovery {
  name: string;
  recoveryPct: number;
}

/** GET /recovery-summary */
export interface RecoverySummary {
  muscles: MuscleRecovery[];
}

/** GET /weekly-goals */
export interface WeeklyGoals {
  volume: { current: number; target: number };
  consistency: { current: number; target: number };
  recovery: { current: number; target: number };
}

/** GET /training-load */
export interface TrainingLoad {
  label: 'well_below' | 'below' | 'steady' | 'above' | 'well_above';
  ratio: number;
  currentLoad: number;
  baselineLoad: number;
}

/** GET /deload-check */
export interface DeloadCheck {
  suggest: boolean;
  consecutiveWeeks: number;
  isInCut?: boolean;
  reason?: string;
  message: string | null;
  weeklyVolumes?: { week: string; volume: number }[];
}
