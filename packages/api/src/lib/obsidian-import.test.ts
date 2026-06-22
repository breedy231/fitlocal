import { describe, it, expect } from 'vitest';
import { parseObsidianWorkout } from 'fitlocal-shared';

describe('parseObsidianWorkout', () => {
  const block = `Legs Day - 2026-06-19
Back Squat
8 reps x 95 lbs
3 sets x 8 reps x 135 lbs
1 reps in reserve

Reverse Crunch
3 sets x 15 reps

Running - Treadmill
48 mins
4.45 mi`;

  const parsed = parseObsidianWorkout(block);

  it('extracts the date and notes from the title', () => {
    expect(parsed.date).toBe('2026-06-19');
    expect(parsed.notes).toBe('Legs Day - 2026-06-19');
  });

  it('treats a single "reps x lbs" line before the working line as a warmup set', () => {
    const squat = parsed.exercises.find((e) => e.name === 'Back Squat')!;
    expect(squat.sets[0]).toEqual({ reps: 8, weightLbs: 95, isWarmup: true });
  });

  it('expands "N sets x R reps x W lbs" into N working sets', () => {
    const squat = parsed.exercises.find((e) => e.name === 'Back Squat')!;
    const working = squat.sets.filter((s) => !s.isWarmup);
    expect(working).toHaveLength(3);
    expect(working.every((s) => s.reps === 8 && s.weightLbs === 135)).toBe(true);
  });

  it('applies RIR to ALL working sets, not just the first (regression)', () => {
    const squat = parsed.exercises.find((e) => e.name === 'Back Squat')!;
    const working = squat.sets.filter((s) => !s.isWarmup);
    expect(working.every((s) => s.rir === 1)).toBe(true);
    // warmup set must NOT get an RIR
    expect(squat.sets[0].rir).toBeUndefined();
  });

  it('parses bodyweight sets with no weight', () => {
    const crunch = parsed.exercises.find((e) => e.name === 'Reverse Crunch')!;
    expect(crunch.sets).toHaveLength(3);
    expect(crunch.sets.every((s) => s.reps === 15 && s.weightLbs === undefined)).toBe(true);
  });

  it('classifies cardio lines as duration/distance, not as new exercises (regression)', () => {
    const names = parsed.exercises.map((e) => e.name);
    expect(names).toEqual(['Back Squat', 'Reverse Crunch', 'Running - Treadmill']);
    const run = parsed.exercises.find((e) => e.name === 'Running - Treadmill')!;
    expect(run.sets).toEqual([{ durationMin: 48 }, { distanceMi: 4.45 }]);
  });

  it('does not misread an exercise name containing "x" as a set', () => {
    const p = parseObsidianWorkout('Push\nHex Bar Deadlift\n3 sets x 5 reps x 225 lbs');
    expect(p.exercises[0].name).toBe('Hex Bar Deadlift');
    expect(p.exercises[0].sets).toHaveLength(3);
  });
});
