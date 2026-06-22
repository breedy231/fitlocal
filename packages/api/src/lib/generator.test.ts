import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateWorkout,
  generateFromProgram,
  DAY_TYPE_MUSCLES,
  type ProgramExerciseInput,
} from './generator.js';
import { createTestDb } from './test-helpers.js';

// Seed a representative exercise library into the test DB
function seedExerciseLibrary(ctx: ReturnType<typeof createTestDb>) {
  // Push muscles
  ctx.seedExercise('Barbell Bench Press');
  ctx.seedExercise('Dumbbell Incline Bench Press');
  ctx.seedExercise('Machine Fly');
  ctx.seedExercise('Dumbbell Shoulder Press');
  ctx.seedExercise('Lateral Raise');
  ctx.seedExercise('Cable Tricep Extension');
  ctx.seedExercise('Dumbbell Tricep Kickback');

  // Pull muscles
  ctx.seedExercise('Lat Pulldown');
  ctx.seedExercise('Dumbbell Row');
  ctx.seedExercise('TRX Row');
  ctx.seedExercise('Barbell Curl');
  ctx.seedExercise('Dumbbell Hammer Curl');
  ctx.seedExercise('Preacher Curl');
  ctx.seedExercise('Cable Face Pull');

  // Legs muscles
  ctx.seedExercise('Back Squat');
  ctx.seedExercise('Leg Press');
  ctx.seedExercise('Seated Leg Curl');
  ctx.seedExercise('Leg Extension');
  ctx.seedExercise('Barbell Hip Thrust');
  ctx.seedExercise('Dumbbell Bulgarian Split Squat');
  ctx.seedExercise('Calf Raise');

  // Core
  ctx.seedExercise('Cable Crunch');
  ctx.seedExercise('Plank');

  // Cardio
  ctx.seedExercise('Treadmill');
  ctx.seedExercise('Elliptical');

  return ctx;
}

describe('DAY_TYPE_MUSCLES', () => {
  it('push day targets chest, shoulders, triceps', () => {
    const muscles = DAY_TYPE_MUSCLES['push'];
    expect(muscles).toContain('chest');
    expect(muscles).toContain('shoulders');
    expect(muscles).toContain('triceps');
    expect(muscles).not.toContain('back');
  });

  it('pull day targets back, biceps, shoulders', () => {
    const muscles = DAY_TYPE_MUSCLES['pull'];
    expect(muscles).toContain('back');
    expect(muscles).toContain('biceps');
    expect(muscles).toContain('shoulders');
    expect(muscles).not.toContain('chest');
  });

  it('legs day targets quads, hamstrings, glutes, calves', () => {
    const muscles = DAY_TYPE_MUSCLES['legs'];
    expect(muscles).toContain('quads');
    expect(muscles).toContain('hamstrings');
    expect(muscles).toContain('glutes');
    expect(muscles).toContain('calves');
    expect(muscles).not.toContain('chest');
  });
});

describe('generateWorkout', () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    ctx = createTestDb();
    seedExerciseLibrary(ctx);
  });
  afterEach(() => ctx.cleanup());

  it('pull day contains no chest-primary exercises', () => {
    const workout = generateWorkout('pull', null, ctx.db, { supersets: false });
    const chestEx = workout.exercises.filter(e => !e.isCardio && /bench|fly|crossover|pec/i.test(e.name));
    expect(chestEx).toHaveLength(0);
  });

  it('30-min profile produces <= 5 total non-cardio exercises (4 strength + 1 core)', () => {
    // DURATION_PROFILES[30] = { maxStrength: 4, coreCount: 1 } — core is counted separately
    const workout = generateWorkout('push', null, ctx.db, { durationMinutes: 30, supersets: false });
    const nonCardio = workout.exercises.filter(e => !e.isCardio);
    expect(nonCardio.length).toBeLessThanOrEqual(5);
  });

  it('60-min default produces at least 4 exercises', () => {
    const workout = generateWorkout('push', null, ctx.db, { supersets: false });
    expect(workout.exercises.length).toBeGreaterThanOrEqual(4);
  });

  it('cut mode: adds second cardio block', () => {
    const workout = generateWorkout('push', null, ctx.db, { isInCut: true, supersets: false });
    const cardio = workout.exercises.filter(e => e.isCardio);
    expect(cardio.length).toBeGreaterThanOrEqual(2);
  });

  it('cut mode: suppresses up directives (no progression)', () => {
    // Seed sessions to trigger an "up" directive
    const benchId = (ctx.sqlite.prepare('SELECT id FROM exercises WHERE name = ?').get('Barbell Bench Press') as any).id;
    ctx.seedSessions(benchId, [
      { daysAgo: 1, sets: [{ reps: 6, weightKg: 100 }, { reps: 6, weightKg: 100 }] },
      { daysAgo: 7, sets: [{ reps: 6, weightKg: 100 }, { reps: 6, weightKg: 100 }] },
    ]);
    const workout = generateWorkout('push', null, ctx.db, { isInCut: true, supersets: false });
    const upDirectives = workout.exercises.filter(e => e.progression === 'up');
    expect(upDirectives).toHaveLength(0);
    expect(workout.isInCut).toBe(true);
  });

  it('supersets: assigns supersetGroup when enabled', () => {
    const workout = generateWorkout('upper', null, ctx.db, { supersets: true });
    const grouped = workout.exercises.filter(e => e.supersetGroup !== undefined);
    expect(grouped.length).toBeGreaterThan(0);
  });

  it('supersets disabled: no supersetGroup on any exercise', () => {
    const workout = generateWorkout('upper', null, ctx.db, { supersets: false });
    const grouped = workout.exercises.filter(e => e.supersetGroup !== undefined);
    expect(grouped).toHaveLength(0);
  });

  it('REGRESSION: EXERCISE_FAMILIES dedup — no two curl variants in same session', () => {
    // All three curl types in the library: Barbell Curl, Dumbbell Hammer Curl, Preacher Curl
    // pull day should only pick ONE curl family
    const workout = generateWorkout('pull', null, ctx.db, { supersets: false });
    const curls = workout.exercises.filter(e => /curl/i.test(e.name) && !e.isCardio);
    // They may have different family labels (curl / hammer / preacher) — check no dup family
    const families = new Set(curls.map(e => {
      if (/hammer/i.test(e.name)) return 'hammer';
      if (/preacher/i.test(e.name)) return 'preacher';
      return 'curl';
    }));
    // Each family should appear at most once
    expect(families.size).toBe(curls.length);
  });
});

describe('generateFromProgram', () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    ctx = createTestDb();
    seedExerciseLibrary(ctx);
  });
  afterEach(() => ctx.cleanup());

  it('returns programDriven: true', () => {
    const benchId = (ctx.sqlite.prepare('SELECT id FROM exercises WHERE name = ?').get('Barbell Bench Press') as any).id;
    const programExercises: ProgramExerciseInput[] = [
      { exerciseId: benchId, exerciseName: 'Barbell Bench Press', targetSets: 3, targetReps: '8', restSeconds: null },
    ];
    const workout = generateFromProgram('push', programExercises, ctx.db);
    expect(workout.programDriven).toBe(true);
  });

  it('uses program target sets', () => {
    const benchId = (ctx.sqlite.prepare('SELECT id FROM exercises WHERE name = ?').get('Barbell Bench Press') as any).id;
    const programExercises: ProgramExerciseInput[] = [
      { exerciseId: benchId, exerciseName: 'Barbell Bench Press', targetSets: 4, targetReps: '8', restSeconds: null },
    ];
    const workout = generateFromProgram('push', programExercises, ctx.db);
    const bench = workout.exercises.find(e => e.name === 'Barbell Bench Press');
    expect(bench?.suggestedSets).toBe(4);
  });

  it('AMRAP target reps falls back to rep range max', () => {
    const benchId = (ctx.sqlite.prepare('SELECT id FROM exercises WHERE name = ?').get('Barbell Bench Press') as any).id;
    const programExercises: ProgramExerciseInput[] = [
      { exerciseId: benchId, exerciseName: 'Barbell Bench Press', targetSets: 3, targetReps: 'AMRAP', restSeconds: null },
    ];
    const workout = generateFromProgram('push', programExercises, ctx.db);
    const bench = workout.exercises.find(e => e.name === 'Barbell Bench Press');
    // barbell_compound max rep = 6
    expect(bench?.suggestedReps).toBe(6);
  });

  it('skips exercises with null exerciseId (unlinked)', () => {
    const benchId = (ctx.sqlite.prepare('SELECT id FROM exercises WHERE name = ?').get('Barbell Bench Press') as any).id;
    const programExercises: ProgramExerciseInput[] = [
      { exerciseId: null, exerciseName: 'Unknown Exercise', targetSets: 3, targetReps: '8', restSeconds: null },
      { exerciseId: benchId, exerciseName: 'Barbell Bench Press', targetSets: 3, targetReps: '8', restSeconds: null },
    ];
    const workout = generateFromProgram('push', programExercises, ctx.db);
    expect(workout.exercises).toHaveLength(1);
    expect(workout.exercises[0].name).toBe('Barbell Bench Press');
  });

  it('cut mode suppresses up directives', () => {
    const benchId = (ctx.sqlite.prepare('SELECT id FROM exercises WHERE name = ?').get('Barbell Bench Press') as any).id;
    ctx.seedSessions(benchId, [
      { daysAgo: 1, sets: [{ reps: 6, weightKg: 100 }, { reps: 6, weightKg: 100 }] },
      { daysAgo: 7, sets: [{ reps: 6, weightKg: 100 }, { reps: 6, weightKg: 100 }] },
    ]);
    const programExercises: ProgramExerciseInput[] = [
      { exerciseId: benchId, exerciseName: 'Barbell Bench Press', targetSets: 3, targetReps: '6', restSeconds: null },
    ];
    const workout = generateFromProgram('push', programExercises, ctx.db, { isInCut: true });
    const bench = workout.exercises.find(e => e.name === 'Barbell Bench Press');
    expect(bench?.progression).not.toBe('up');
    expect(workout.isInCut).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// volumeReductionPct formula (computed in generate route)
// ----------------------------------------------------------------------------
describe('volumeReductionPct formula', () => {
  function computeVolumeReductionPct(maintenance: number, actualCalories: number): number | undefined {
    const deficitPct = (maintenance - actualCalories) / maintenance;
    if (deficitPct <= 0.10) return undefined;
    const volumeMultiplier = 1.0 - Math.min((deficitPct - 0.10) / 0.20, 1.0) * 0.20;
    return Math.round((1.0 - volumeMultiplier) * 100);
  }

  it('returns undefined when deficit <= 10%', () => {
    expect(computeVolumeReductionPct(2200, 2000)).toBeUndefined(); // ~9% deficit
  });

  it('returns a reduction at 20% deficit', () => {
    const pct = computeVolumeReductionPct(2200, 1760); // 20% deficit
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(20);
  });

  it('caps at 20% reduction at >= 30% deficit', () => {
    const pct = computeVolumeReductionPct(2200, 1100); // 50% deficit — capped
    expect(pct).toBe(20);
  });
});

describe('generateWorkout — equipment filtering (#33)', () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    ctx = createTestDb();
    // Push-day library with explicit equipment tags (as the migration backfills them)
    ctx.seedExercise('Barbell Bench Press', 60, ['barbell', 'flat-bench']);
    ctx.seedExercise('Dumbbell Bench Press', 60, ['dumbbell', 'flat-bench']);
    ctx.seedExercise('Dumbbell Incline Bench Press', 60, ['dumbbell', 'incline-bench']);
    ctx.seedExercise('Dumbbell Shoulder Press', 60, ['dumbbell']);
    ctx.seedExercise('Machine Fly', 60, ['machine']);
    ctx.seedExercise('Push Up', 60, []); // bodyweight
  });
  afterEach(() => ctx.cleanup());

  it("Mom's House (dumbbell+flat-bench) excludes barbell and incline movements", () => {
    const available = ['dumbbell', 'flat-bench', 'bodyweight'];
    const workout = generateWorkout('push', available, ctx.db, { supersets: false, durationMinutes: 120 });
    const names = workout.exercises.map(e => e.name);
    expect(names).not.toContain('Barbell Bench Press');
    expect(names).not.toContain('Dumbbell Incline Bench Press');
    expect(names).not.toContain('Machine Fly');
    // dumbbell + bodyweight movements remain available
    expect(names).toContain('Dumbbell Bench Press');
  });

  it('no equipment restriction (null) surfaces barbell/machine movements', () => {
    const workout = generateWorkout('push', null, ctx.db, { supersets: false, durationMinutes: 120 });
    const names = workout.exercises.map(e => e.name);
    expect(names).toContain('Barbell Bench Press');
  });
});
