/**
 * Workout-related API response shapes.
 */

/** One running/cycling split from an Apple cardio session (#93). 1-based index. */
export interface SetSplit {
  splitIndex: number;
  distanceMeters: number;
  durationSeconds: number;
  avgHr: number | null;
}

export interface Set {
  id: number;
  workoutExerciseId: number;
  reps: number | null;
  weightKg: number | null;
  isWarmup: boolean | number | null;
  rpe: number | null;
  multiplier: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  resistance: number | null;
  completed: boolean;
  // Apple cardio ingest (#93). NULL / empty for manual sets.
  externalId?: string | null;
  source?: string | null;
  energyKcal?: number | null;
  splits?: SetSplit[];
}

export interface ExerciseRef {
  id: number;
  name: string;
  restSeconds: number | null;
  imageUrl: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
}

export interface LastPerformance {
  date: string;
  sets: { reps: number; weightKg: number }[];
}

export interface WorkoutExercise {
  id: number;
  workoutId: number;
  exerciseId: number;
  displayOrder: number;
  supersetGroup: number | null;
  exercise: ExerciseRef;
  sets: Set[];
  restSeconds: number;
  lastPerformance?: LastPerformance | null;
  prWeightKg?: number | null;
}

/** The base workout row returned by POST /workouts, PUT/PATCH /workouts/:id, and in list items. */
export interface Workout {
  id: number;
  date: string;
  locationProfile: string | null;
  notes: string | null;
  effortRating: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  /** 'apple_health' for standalone workouts ingested from Apple cardio (#93). */
  source?: string | null;
}

/** GET /workouts — list item shape (workout + counts). */
export interface WorkoutListItem extends Workout {
  exerciseCount: number;
  setCount: number;
  /** present only when `detail=true` query param was passed. */
  exerciseNames?: string[];
}

/** GET /workouts/:id — workout with full nested exercises and sets. */
export interface WorkoutDetail extends Workout {
  exercises: WorkoutExercise[];
}

/** One heart-rate zone bucket (Z1-Z5) from GET /workouts/:id/hr (#59, #93). */
export interface HrZone {
  zone: number;
  label: string;
  minBpm: number;
  maxBpm: number | null;
  seconds: number;
}

/** GET /workouts/:id/hr — HR summary + time-in-zone. `zones` is null when no max HR is configured. */
export interface WorkoutHr {
  workoutId: number;
  sampleCount: number;
  avgHr: number | null;
  maxHr: number | null;
  minHr: number | null;
  maxHrConfig: number | null;
  zones: HrZone[] | null;
  samples: { t: string; bpm: number }[];
}

/** GET /workouts/export — per-workout HealthKit writeback entry. */
export interface WorkoutExport {
  date: string;
  durationMinutes: number;
  caloriesBurned: number;
  exerciseType: 'mixed' | 'strength';
}
