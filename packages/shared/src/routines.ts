/**
 * Routine (saved exercise list) response shapes.
 */

import type { ProgressionDirective, RepRange } from './exercises.js';

export interface RoutineExercise {
  exerciseName: string;
  exerciseId: number | null;
  targetSets: number;
  targetReps: string;
}

export interface Routine {
  id: number;
  name: string;
  exercises: RoutineExercise[];
  createdAt: string;
}

export interface EnrichedRoutineExercise {
  exerciseName: string;
  exerciseId: number | null;
  targetSets: number;
  targetReps: string;
  suggestedWeightKg: number | null;
  suggestedReps: number | null;
  repRange: RepRange | null;
  progression: ProgressionDirective | string | null;
  isEstimate: boolean;
}

/** GET /routines/:id — routine with progression-enriched exercises. */
export interface RoutineDetail extends Omit<Routine, 'exercises'> {
  exercises: EnrichedRoutineExercise[];
}

/** POST /routines */
export interface RoutineCreateResponse {
  id: number;
  name: string;
  exercises: RoutineExercise[];
  matched: number;
  unmatched: number;
}
