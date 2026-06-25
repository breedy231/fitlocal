/**
 * Report response shapes — /reports/* endpoints.
 */

/** GET /reports/frequency */
export interface FrequencyReport {
  weeks: { week: string; weekStart: string; count: number }[];
}

/** GET /reports/volume */
export interface VolumeWorkout {
  id: number;
  date: string;
  notes: string | null;
  totalVolume: number;
  exerciseCount: number;
  setCount: number;
}
export interface VolumeReport {
  workouts: VolumeWorkout[];
}

/** GET /reports/muscle-distribution */
export interface MuscleDistributionReport {
  muscles: { name: string; sets: number }[];
}

/** GET /reports/personal-records */
export interface PersonalRecord {
  exerciseName: string;
  maxWeightKg: number;
  repsAtMax: number;
  dateAchieved: string;
  estimated1RmKg: number;
}
export interface PersonalRecordsReport {
  records: PersonalRecord[];
}

/** GET /reports/exercise-progression */
export interface ExerciseDataPoint {
  date: string;
  maxWeight: number;
  maxReps: number;
  sessionVolume: number;
  estimated1RmKg: number;
}
export interface ExerciseProgressionReport {
  exerciseName: string | null;
  dataPoints: ExerciseDataPoint[];
}
export interface ExerciseProgressionBatchEntry {
  exerciseId: number;
  exerciseName: string | null;
  dataPoints: ExerciseDataPoint[];
}
export interface ExerciseProgressionBatchReport {
  results: ExerciseProgressionBatchEntry[];
}

/** GET /reports/exercises-with-history */
export interface ExerciseWithHistory {
  id: number;
  name: string;
  workoutCount: number;
  recentCount: number;
}
export interface ExercisesWithHistoryReport {
  exercises: ExerciseWithHistory[];
}

/** GET /reports/health-trends */
export interface HealthTrendSnapshot {
  date: string;
  restingHr: number | null;
  hrv: number | null;
  sleepHours: number | null;
  calories: number | null;
  proteinG: number | null;
  steps: number | null;
  bodyWeightKg: number | null;
}
export interface HealthTrendsReport {
  snapshots: HealthTrendSnapshot[];
}

/** GET /reports/exercise-1rm-history */
export interface Exercise1RmHistoryReport {
  exerciseName: string | null;
  dataPoints: { date: string; estimated1RmKg: number }[];
}

/** GET /reports/calendar */
export interface CalendarDay {
  date: string;
  workoutCount: number;
  totalSets: number;
  primaryMuscles: string[];
}
export interface CalendarReport {
  year: number;
  month: number;
  days: CalendarDay[];
}

/** GET /reports/volume-heatmap */
export interface VolumeHeatmapWeek {
  weekStart: string;
  days: { date: string; muscles: Record<string, number> }[];
}
export interface VolumeHeatmapReport {
  muscles: string[];
  weeks: VolumeHeatmapWeek[];
}

/** GET /reports/benchmarks */
export interface BenchmarkExercise {
  name: string;
  estimated1RmKg: number;
  ratio: number;
  level: string;
  label: string;
  thresholds: Record<string, number>;
}
export interface BenchmarksReport {
  bodyWeightKg: number | null;
  exercises: BenchmarkExercise[];
}

/** GET /reports/summary */
export interface SummaryReport {
  totalWorkouts: number;
  totalWorkingSets: number;
  totalVolumeKg: number;
  currentStreak: number;
  workoutsThisWeek: number;
  workoutsThisMonth: number;
}
