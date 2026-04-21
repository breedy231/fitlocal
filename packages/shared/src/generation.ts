/**
 * Generator response shapes — /generate-workout and /generate-workout/replace.
 */

import type { ProgressionDirective } from './exercises.js';

export interface GeneratedExercise {
  id: number;
  name: string;
  suggestedSets: number;
  suggestedReps: number;
  suggestedWeightKg: number;
  lastPerformedDaysAgo: number;
  isFocus: boolean;
  isCardio: boolean;
  suggestedDurationSec?: number;
  restSeconds: number;
  progression?: ProgressionDirective;
  repRange?: { min: number; max: number };
  supersetGroup?: number;
}

/** GET /generate-workout response. */
export interface GeneratedWorkout {
  dayType: string;
  globalModifier: number;
  isInCut: boolean;
  programDriven?: boolean;
  exercises: GeneratedExercise[];
}

/** GET /generate-workout/replace — alternatives for one exercise. */
export interface GeneratedAlternative {
  id: number;
  name: string;
  suggestedSets: number;
  suggestedReps: number;
  suggestedWeightKg: number;
  lastPerformedDaysAgo: number;
  isFocus: boolean;
  isCardio: boolean;
  restSeconds: number;
  progression: ProgressionDirective;
  repRange: { min: number; max: number };
}
export interface GenerateReplaceResponse {
  alternatives: GeneratedAlternative[];
}
