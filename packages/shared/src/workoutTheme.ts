import { CARDIO_PATTERN } from './cardio.js';
import type { WorkoutExercise } from './workouts.js';

export type WorkoutType = 'push' | 'pull' | 'legs' | 'cardio' | 'full_body';

export const WORKOUT_THEMES: Record<WorkoutType, { accent: string; secondary: string }> = {
  push:      { accent: '#e8ff3a', secondary: '#ff6b35' },
  pull:      { accent: '#38bdf8', secondary: '#818cf8' },
  legs:      { accent: '#f97316', secondary: '#fbbf24' },
  cardio:    { accent: '#f43f5e', secondary: '#fb7185' },
  full_body: { accent: '#a78bfa', secondary: '#34d399' },
};

/**
 * Derives the workout type from a list of exercises.
 *
 * Cardio detection reuses CARDIO_PATTERN on the exercise NAME because ExerciseRef
 * has no movementType. Strength exercises are bucketed by their first primary
 * muscle (push = chest/shoulders/triceps, pull = back/biceps, legs =
 * quads/hamstrings/glutes/calves). A workout is full_body when at least two
 * buckets each hold >= 25% of the strength exercises; otherwise the dominant
 * bucket wins. Falls back to full_body when muscle data is missing/unclassified.
 */
export function deriveWorkoutType(exercises: WorkoutExercise[]): WorkoutType {
  if (exercises.length === 0) {
    return 'full_body';
  }

  const cardioCount = exercises.filter(ex => CARDIO_PATTERN.test(ex.exercise.name)).length;

  if (cardioCount >= exercises.length / 2) {
    return 'cardio';
  }

  const strengthExercises = exercises.filter(ex => !CARDIO_PATTERN.test(ex.exercise.name));
  const strengthTotal = strengthExercises.length;

  if (strengthTotal === 0) {
    return 'full_body';
  }

  let pushCount = 0;
  let pullCount = 0;
  let legsCount = 0;

  for (const ex of strengthExercises) {
    const primary = ex.exercise.primaryMuscles[0]?.toLowerCase();
    if (!primary) continue;

    switch (primary) {
      case 'chest':
      case 'shoulders':
      case 'triceps':
        pushCount++;
        break;
      case 'back':
      case 'biceps':
        pullCount++;
        break;
      case 'quads':
      case 'hamstrings':
      case 'glutes':
      case 'calves':
        legsCount++;
        break;
    }
  }

  // full_body: at least 2 of the 3 buckets each hold >= 25% of strengthTotal
  const counts = [pushCount, pullCount, legsCount];
  const fullBodyThreshold = strengthTotal * 0.25;
  let fullBodyBuckets = 0;

  for (const count of counts) {
    if (count >= fullBodyThreshold) {
      fullBodyBuckets++;
    }
  }

  if (fullBodyBuckets >= 2) {
    return 'full_body';
  }

  // Dominant bucket, tie-break order: push > pull > legs
  if (pushCount > 0 && pushCount >= pullCount && pushCount >= legsCount) {
    return 'push';
  } else if (pullCount > 0 && pullCount >= legsCount) {
    return 'pull';
  } else if (legsCount > 0) {
    return 'legs';
  }

  return 'full_body';
}
