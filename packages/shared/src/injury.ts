/**
 * Injury restrictions — one active injury whose rules hard-remove exercises
 * from anything the app picks for you (generated workouts, program days, swap
 * suggestions). Hand-built routines and manual adds are left alone.
 */

/** Movement patterns the API knows how to recognise from name + equipment. */
export const INJURY_PATTERNS = ['overhead', 'freeweight_push'] as const;
export type InjuryPattern = (typeof INJURY_PATTERNS)[number];

export const INJURY_PATTERN_LABELS: Record<InjuryPattern, string> = {
  overhead: 'Overhead — presses, overhead extensions, pullovers, anything loaded above the head',
  freeweight_push: 'Free-weight pushing — barbell / dumbbell / kettlebell presses, flys, skullcrushers, kickbacks',
};

/** Muscle groups as the generator classifies them (see api lib/recovery.ts). */
export const INJURY_MUSCLES = [
  'chest', 'shoulders', 'triceps', 'back', 'biceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'core',
] as const;

export interface InjuryRestrictionInput {
  label: string;
  notes?: string | null;
  avoidPatterns: InjuryPattern[];
  avoidMuscles: string[];
  /** Always removed, whatever the patterns say. */
  avoidExerciseIds: number[];
  /** Kept even if a pattern or muscle would remove it (avoidExerciseIds still wins). */
  allowExerciseIds: number[];
}

/** GET /injury — the active restriction, or null. */
export interface InjuryRestriction extends InjuryRestrictionInput {
  id: number;
  notes: string | null;
  startedAt: string;
}

/** GET /injury/preview — every catalog exercise the active rules remove. */
export interface InjuryPreview {
  excluded: { id: number; name: string; reasons: string[] }[];
}
