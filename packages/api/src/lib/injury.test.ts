import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { InjuryRestriction } from 'fitlocal-shared';
import { restrictionReasons, buildExerciseFilter, getActiveRestriction } from './injury.js';
import { generateWorkout, generateFromProgram } from './generator.js';
import { createTestDb } from './test-helpers.js';

const PT_RULES: InjuryRestriction = {
  id: 1,
  label: 'Neck / upper back',
  notes: null,
  startedAt: '2026-11-01',
  avoidPatterns: ['overhead', 'freeweight_push'],
  avoidMuscles: [],
  avoidExerciseIds: [],
  allowExerciseIds: [],
};

const ex = (name: string, equipment: string[] = [], id = 1) => ({ id, name, equipment: JSON.stringify(equipment) });
const removed = (name: string, equipment: string[] = []) => restrictionReasons(ex(name, equipment), PT_RULES).length > 0;

describe('restrictionReasons — PT rules (overhead + free-weight push)', () => {
  it.each([
    ['Barbell Shoulder Press', ['barbell']],
    ['Machine Shoulder Press', ['machine']],
    ['Cable Rope Overhead Triceps Extension', ['cable']],
    ['Arnold Dumbbell Press', ['dumbbell']],
    ['Push Press', ['barbell']],
    ['Dumbbell Pullover', ['dumbbell']],
    ['Single Arm Landmine Press', ['barbell']],
    ['Dumbbell Standing Hammer Curl To Front Press', ['dumbbell']],
    ['Kettlebell Single Arm Overhead Lunge', ['kettlebell']],
    ['Barbell Bench Press', ['barbell', 'flat-bench']],
    ['Dumbbell Incline Bench Press', ['dumbbell', 'incline-bench']],
    ['Dumbbell Fly', ['dumbbell']],
    ['Skullcrusher', []],
    ['Floor Press', []],
    ['Dumbbell Kickbacks', ['dumbbell']],
    ['Close-Grip Bench Press', ['barbell', 'flat-bench']],
  ])('removes %s', (name, equipment) => {
    expect(removed(name, equipment)).toBe(true);
  });

  it.each([
    // Machine / cable / bodyweight pushing is allowed
    ['Machine Bench Press', ['machine']],
    ['Hammerstrength Chest Press', ['machine']],
    ['Smith Machine Bench Press', ['smith-machine', 'flat-bench']],
    ['Cable Crossover Fly', ['cable']],
    ['Machine Fly', ['machine']],
    ['Cable Tricep Pushdown', ['cable']],
    ['Push Up', []],
    ['Assisted Dip', ['machine']],
    // Pulling and legs are fine, including overhead pulling
    ['Lat Pulldown', ['cable']],
    ['Pull Up', []],
    ['Dumbbell Bent Over Reverse Fly', ['dumbbell']],
    ['Dumbbell Rear Delt Raise', ['dumbbell']],
    ['Barbell Row', ['barbell']],
    ['Barbell Back Squat', ['barbell']],
    ['Leg Press', ['machine']],
    ['Seated Machine Calf Press', ['machine']],
    ['Glute Kickback Machine', ['machine']],
  ])('keeps %s', (name, equipment) => {
    expect(removed(name, equipment)).toBe(false);
  });

  it('labels each matching pattern', () => {
    expect(restrictionReasons(ex('Dumbbell Shoulder Press', ['dumbbell']), PT_RULES))
      .toEqual(['Overhead', 'Free-weight pushing']);
  });
});

describe('restrictionReasons — muscles and per-exercise overrides', () => {
  it('removes by avoided muscle', () => {
    const r = { ...PT_RULES, avoidPatterns: [], avoidMuscles: ['biceps'] };
    expect(restrictionReasons(ex('Barbell Curl'), r)).toEqual(['Avoided muscle: biceps']);
    expect(restrictionReasons(ex('Barbell Row'), r)).toEqual([]);
  });

  it('allowExerciseIds overrides patterns', () => {
    const r = { ...PT_RULES, allowExerciseIds: [7] };
    expect(restrictionReasons(ex('Dumbbell Fly', ['dumbbell'], 7), r)).toEqual([]);
  });

  it('avoidExerciseIds wins over allowExerciseIds', () => {
    const r = { ...PT_RULES, avoidPatterns: [], avoidExerciseIds: [7], allowExerciseIds: [7] };
    expect(restrictionReasons(ex('Lat Pulldown', [], 7), r)).toEqual(['Avoided exercise']);
  });

  it('no restriction means no filter', () => {
    expect(buildExerciseFilter(null)).toBeUndefined();
  });
});

describe('generator honours the injury filter', () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
    for (const [name, equip] of [
      ['Barbell Bench Press', ['barbell']],
      ['Dumbbell Shoulder Press', ['dumbbell']],
      ['Machine Bench Press', ['machine']],
      ['Machine Lateral Raise', ['machine']],
      ['Cable Tricep Pushdown', ['cable']],
      ['Cable Crossover Fly', ['cable']],
    ] as [string, string[]][]) ctx.seedExercise(name, 60, equip);
  });
  afterEach(() => ctx.cleanup());

  it('generateWorkout never picks a restricted exercise', () => {
    const w = generateWorkout('push', null, ctx.db, { exerciseFilter: buildExerciseFilter(PT_RULES), supersets: false });
    const names = w.exercises.map(e => e.name);
    expect(names).not.toContain('Barbell Bench Press');
    expect(names).not.toContain('Dumbbell Shoulder Press');
    expect(names).toContain('Machine Bench Press');
  });

  it('generateFromProgram drops restricted exercises and reports them', () => {
    const id = (n: string) => (ctx.sqlite.prepare('SELECT id FROM exercises WHERE name = ?').get(n) as { id: number }).id;
    const w = generateFromProgram('push', [
      { exerciseId: id('Barbell Bench Press'), exerciseName: 'Barbell Bench Press', targetSets: 3, targetReps: '8', restSeconds: null },
      { exerciseId: id('Machine Bench Press'), exerciseName: 'Machine Bench Press', targetSets: 3, targetReps: '8', restSeconds: null },
    ], ctx.db, { exerciseFilter: buildExerciseFilter(PT_RULES) });
    expect(w.exercises.map(e => e.name)).toEqual(['Machine Bench Press']);
    expect(w.injuryRemoved).toEqual(['Barbell Bench Press']);
  });

  it('getActiveRestriction ignores cleared rows', () => {
    ctx.sqlite.prepare(`INSERT INTO injury_restrictions (label, avoid_patterns, cleared_at) VALUES ('old', '["overhead"]', datetime('now'))`).run();
    expect(getActiveRestriction(ctx.db)).toBeNull();
    ctx.sqlite.prepare(`INSERT INTO injury_restrictions (label, avoid_patterns) VALUES ('neck', '["overhead"]')`).run();
    expect(getActiveRestriction(ctx.db)?.avoidPatterns).toEqual(['overhead']);
  });
});
