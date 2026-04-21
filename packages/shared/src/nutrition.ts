/**
 * Nutrition / goals / cut-progress response shapes.
 */

/** GET /goals and PUT /goals. */
export interface UserGoals {
  maintenanceCalories: number | null;
  targetCalories: number | null;
  targetProteinG: number | null;
  targetWeightKg: number | null;
  cutStartDate: string | null;
  cutEndDate: string | null;
}

/** GET /goals/daily-nutrition — today's intake vs targets. */
export interface NutritionData {
  date?: string;
  snapshotDate?: string;
  isStale?: boolean;
  calories: { current: number | null; target: number | null };
  protein: { current: number | null; target: number | null };
  isInCut: boolean;
  deficitMagnitude: number | null;
  deficitPct: number | null;
}

export interface WeightTrendPoint {
  date: string;
  rawKg: number;
  trendKg: number;
}

/** GET /goals/weight-trend */
export interface WeightTrend {
  points: WeightTrendPoint[];
  weeklyRateLbs: number | null;
  targetWeightKg: number | null;
  cutStartDate: string | null;
  cutEndDate: string | null;
}

/** GET /goals/weekly-progress */
export type WeeklyProgress =
  | {
      isInCut: false;
    }
  | {
      isInCut: true;
      week: {
        avgCalories: number | null;
        avgDeficit: number | null;
        targetDeficit: number;
        daysLogged: number;
      };
      weight: {
        currentTrendLbs: number | null;
        changeLbs: number | null;
        weeklyTargetLbs: number | null;
      };
      pace: 'on_track' | 'ahead' | 'behind' | null;
    };
