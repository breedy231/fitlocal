/**
 * Exercise-related API response shapes.
 */

export type ProgressionDirective = 'up' | 'hold' | 'deload';

export interface RepRange {
  min: number;
  max: number;
  jump?: number;
}

export interface Exercise {
  id: number;
  name: string;
  primaryMuscles: string[] | null;
  secondaryMuscles: string[] | null;
  equipment: string[] | null;
  movementType: string | null;
  description: string | null;
  imageUrl: string | null;
  wgerId: number | null;
  restSeconds: number | null;
}

export interface ExerciseSearchResult extends Exercise {}

/** GET /exercises/:id/progression — output from computeProgression. */
export interface Progression {
  weightKg: number;
  reps: number;
  sets: number;
  directive: ProgressionDirective;
  repRange: RepRange;
  classification: 'barbell_compound' | 'dumbbell_compound' | 'accessory' | 'bodyweight' | 'cardio';
  isEstimate?: boolean;
}

/** GET /exercises/:id/last-performance */
export interface LastPerformanceResponse {
  date?: string;
  sets: { reps: number; weightKg: number }[];
}
