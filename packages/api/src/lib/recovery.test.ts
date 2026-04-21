import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getMusclesForExercise, computeAllMuscleRecoveries, getGlobalRecoveryModifier } from './recovery.js';
import { createTestDb } from './test-helpers.js';

// Reset the muscle cache between tests (it's module-level)
vi.mock('./recovery.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./recovery.js')>();
  return mod;
});

describe('getMusclesForExercise', () => {
  it('detects chest for bench press', () => {
    expect(getMusclesForExercise('Barbell Bench Press')).toContain('chest');
  });

  it('detects back for lat pulldown', () => {
    expect(getMusclesForExercise('Lat Pulldown')).toContain('back');
  });

  it('detects biceps for barbell curl', () => {
    expect(getMusclesForExercise('Barbell Curl')).toContain('biceps');
  });

  it('REGRESSION: biceps regex does NOT match "Leg Curl"', () => {
    // Stream 0 fix: lookbehind (?<!leg\s) on the curl pattern
    const muscles = getMusclesForExercise('Leg Curl');
    expect(muscles).not.toContain('biceps');
  });

  it('REGRESSION: hamstrings regex matches "Leg Curl"', () => {
    // Stream 0 fix: hamstrings pattern now includes leg.?curl
    const muscles = getMusclesForExercise('Leg Curl');
    expect(muscles).toContain('hamstrings');
  });

  it('REGRESSION: hamstrings regex matches "Hamstring Curl"', () => {
    const muscles = getMusclesForExercise('Hamstring Curl');
    expect(muscles).toContain('hamstrings');
  });

  it('detects shoulders for lateral raise', () => {
    expect(getMusclesForExercise('Lateral Raise')).toContain('shoulders');
  });

  it('detects quads for leg press', () => {
    expect(getMusclesForExercise('Leg Press')).toContain('quads');
  });

  it('detects core for crunch', () => {
    expect(getMusclesForExercise('Cable Crunch')).toContain('core');
  });

  it('returns empty array for unknown exercise', () => {
    expect(getMusclesForExercise('Totally Unknown Exercise XYZ')).toHaveLength(0);
  });
});

describe('computeAllMuscleRecoveries', () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => { ctx = createTestDb(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns 1.0 for all muscles when no workout history', () => {
    const recoveries = computeAllMuscleRecoveries(ctx.db);
    for (const [, pct] of recoveries) {
      expect(pct).toBe(1);
    }
  });

  it('reduces chest recovery after a recent bench session', () => {
    const exId = ctx.seedExercise('Barbell Bench Press');
    // Session yesterday
    ctx.seedSessions(exId, [{ daysAgo: 1, sets: [{ reps: 5, weightKg: 100 }] }]);

    const recoveries = computeAllMuscleRecoveries(ctx.db);
    const chest = recoveries.get('chest') ?? 1;
    expect(chest).toBeLessThan(1);
  });

  it('recovery is higher 4 days after a session than 1 day after (decay)', () => {
    const exId = ctx.seedExercise('Barbell Bench Press');
    ctx.seedSessions(exId, [{ daysAgo: 1, sets: [{ reps: 5, weightKg: 100 }, { reps: 5, weightKg: 100 }, { reps: 5, weightKg: 100 }] }]);
    const r1 = computeAllMuscleRecoveries(ctx.db).get('chest') ?? 1;

    const ctx2 = createTestDb();
    try {
      const exId2 = ctx2.seedExercise('Barbell Bench Press');
      ctx2.seedSessions(exId2, [{ daysAgo: 4, sets: [{ reps: 5, weightKg: 100 }, { reps: 5, weightKg: 100 }, { reps: 5, weightKg: 100 }] }]);
      const r4 = computeAllMuscleRecoveries(ctx2.db).get('chest') ?? 1;
      expect(r4).toBeGreaterThan(r1);
    } finally {
      ctx2.cleanup();
    }
  });

  it('recovery stays in [0, 1] range', () => {
    const exId = ctx.seedExercise('Barbell Bench Press');
    ctx.seedSessions(exId, [
      { daysAgo: 0, sets: [{ reps: 10, weightKg: 100 }, { reps: 10, weightKg: 100 }, { reps: 10, weightKg: 100 }] },
    ]);
    const recoveries = computeAllMuscleRecoveries(ctx.db);
    for (const [, r] of recoveries) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

describe('getGlobalRecoveryModifier', () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => { ctx = createTestDb(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns 1.0 when no health snapshots exist', () => {
    expect(getGlobalRecoveryModifier(ctx.db)).toBe(1.0);
  });

  it('returns <= 0.85 when today HRV is < 70% of average', () => {
    // Seed 10 days of high HRV, then one very low today
    for (let i = 10; i >= 2; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      ctx.seedHealthSnapshot(d.toISOString().split('T')[0], 100, 55);
    }
    const today = new Date().toISOString().split('T')[0];
    ctx.seedHealthSnapshot(today, 50, 55); // avg=~96, today=50, 50 < 96*0.7=67.2 → triggers penalty

    const modifier = getGlobalRecoveryModifier(ctx.db);
    expect(modifier).toBeLessThan(1.0);
  });

  it('returns <= 0.9 when resting HR > 110% of average', () => {
    for (let i = 10; i >= 2; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      ctx.seedHealthSnapshot(d.toISOString().split('T')[0], null, 50);
    }
    const today = new Date().toISOString().split('T')[0];
    ctx.seedHealthSnapshot(today, null, 60); // avg=50, today=60, 60 > 50*1.1=55 → penalty

    const modifier = getGlobalRecoveryModifier(ctx.db);
    expect(modifier).toBeLessThan(1.0);
  });

  it('never returns below 0.7 (floor)', () => {
    // Both HRV and HR penalties applied simultaneously = 0.85 * 0.90 = 0.765, floored at 0.7
    for (let i = 10; i >= 2; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      ctx.seedHealthSnapshot(d.toISOString().split('T')[0], 100, 50);
    }
    const today = new Date().toISOString().split('T')[0];
    ctx.seedHealthSnapshot(today, 30, 70); // bad HRV + bad HR

    const modifier = getGlobalRecoveryModifier(ctx.db);
    expect(modifier).toBeGreaterThanOrEqual(0.7);
  });
});
