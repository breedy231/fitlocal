/**
 * Workout-related API response shapes.
 */

export interface Set {
  id: number;
  workoutExerciseId: number;
  reps: number | null;
  weightKg: number | null;
  isWarmup: boolean | number | null;
  rpe: number | null;
  multiplier: number | null;
  durationSeconds: number | null;
  completed: boolean;
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

/** GET /workouts/export — per-workout HealthKit writeback entry. */
export interface WorkoutExport {
  date: string;
  durationMinutes: number;
  caloriesBurned: number;
  exerciseType: 'mixed' | 'strength';
}
