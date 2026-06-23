import { describe, it, expect } from 'vitest';
import { deriveWorkoutType, WORKOUT_THEMES, type WorkoutExercise } from 'fitlocal-shared';

// deriveWorkoutType buckets strength exercises by their first primary muscle
// (push = chest/shoulders/triceps, pull = back/biceps, legs = quads/hamstrings/
// glutes/calves) and detects cardio via the shared CARDIO_PATTERN on the name.

/** Minimal WorkoutExercise factory — only the fields deriveWorkoutType reads. */
function ex(name: string, primaryMuscles: string[] = []): WorkoutExercise {
  return {
    id: 0,
    workoutId: 0,
    exerciseId: 0,
    displayOrder: 0,
    supersetGroup: null,
    exercise: {
      id: 0,
      name,
      restSeconds: null,
      imageUrl: null,
      primaryMuscles,
      secondaryMuscles: [],
      equipment: [],
    },
    sets: [],
    restSeconds: 90,
  };
}

describe('deriveWorkoutType', () => {
  it('returns full_body for an empty workout', () => {
    expect(deriveWorkoutType([])).toBe('full_body');
  });

  it('classifies a push workout', () => {
    const w = [
      ex('Bench Press', ['chest']),
      ex('Overhead Press', ['shoulders']),
      ex('Tricep Pushdown', ['triceps']),
    ];
    expect(deriveWorkoutType(w)).toBe('push');
  });

  it('classifies a pull workout', () => {
    const w = [
      ex('Barbell Row', ['back']),
      ex('Lat Pulldown', ['back']),
      ex('Bicep Curl', ['biceps']),
    ];
    expect(deriveWorkoutType(w)).toBe('pull');
  });

  it('classifies a legs workout', () => {
    const w = [
      ex('Back Squat', ['quads']),
      ex('Romanian Deadlift', ['hamstrings']),
      ex('Hip Thrust', ['glutes']),
      ex('Calf Raise', ['calves']),
    ];
    expect(deriveWorkoutType(w)).toBe('legs');
  });

  it('classifies cardio when at least half the exercises are cardio', () => {
    const w = [
      ex('Treadmill'),
      ex('Rowing'),
      ex('Bench Press', ['chest']),
    ];
    // 2 of 3 cardio >= half → cardio
    expect(deriveWorkoutType(w)).toBe('cardio');
  });

  it('does not over-classify cardio below the half threshold', () => {
    const w = [
      ex('Treadmill'),
      ex('Bench Press', ['chest']),
      ex('Overhead Press', ['shoulders']),
    ];
    // 1 of 3 cardio < half → falls through to push
    expect(deriveWorkoutType(w)).toBe('push');
  });

  it('classifies full_body when two muscle buckets each clear 25%', () => {
    const w = [
      ex('Bench Press', ['chest']),
      ex('Overhead Press', ['shoulders']),
      ex('Barbell Row', ['back']),
      ex('Back Squat', ['quads']),
    ];
    // push=2 (50%), pull=1 (25%), legs=1 (25%) → 3 buckets >= 25% → full_body
    expect(deriveWorkoutType(w)).toBe('full_body');
  });

  it('falls back to full_body when muscle data is missing', () => {
    const w = [ex('Mystery Lift'), ex('Another Lift')];
    expect(deriveWorkoutType(w)).toBe('full_body');
  });

  it('ignores cardio exercises when bucketing strength work', () => {
    const w = [
      ex('Treadmill'),
      ex('Bench Press', ['chest']),
      ex('Overhead Press', ['shoulders']),
      ex('Tricep Pushdown', ['triceps']),
    ];
    // 1 of 4 cardio < half; strength is all-push → push
    expect(deriveWorkoutType(w)).toBe('push');
  });

  it('has a theme for every workout type', () => {
    for (const type of ['push', 'pull', 'legs', 'cardio', 'full_body'] as const) {
      expect(WORKOUT_THEMES[type]).toMatchObject({
        accent: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        secondary: expect.stringMatching(/^#[0-9a-f]{6}$/i),
      });
    }
  });
});
