import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { importObsidianWorkout } from './obsidian-import-db.js';
import { createTestDb } from './test-helpers.js';
import * as schema from '../schema/index.js';

// A workout block exercising every path: a warmup single-line set, a working
// line with weight + RIR, and a cardio exercise (minutes + miles).
const BLOCK = `Push Day 2026-06-20
Bench Press
8 reps x 95 lbs
3 sets x 8 reps x 135 lbs
2 reps in reserve
Treadmill
48 mins
4.45 mi`;

function setsForDate(t: ReturnType<typeof createTestDb>, date: string) {
  const workout = t.db.select().from(schema.workouts).where(eq(schema.workouts.date, date)).get()!;
  const wes = t.db
    .select()
    .from(schema.workoutExercises)
    .where(eq(schema.workoutExercises.workoutId, workout.id))
    .all();
  return { workout, wes };
}

describe('importObsidianWorkout', () => {
  it('converts lbs to kg at the boundary', () => {
    const t = createTestDb();
    const res = importObsidianWorkout(t.db, BLOCK);
    expect(res.workoutsCreated).toBe(1);

    const allSets = t.db.select().from(schema.sets).all();
    const working = allSets.filter((s) => s.reps === 8 && !s.isWarmup);
    expect(working).toHaveLength(3);
    // 135 lbs * 0.453592
    for (const s of working) {
      expect(s.weightKg).toBeCloseTo(61.23492, 4);
    }
    t.cleanup();
  });

  it('maps a cardio set: minutes → seconds and miles → meters', () => {
    const t = createTestDb();
    importObsidianWorkout(t.db, BLOCK);

    const allSets = t.db.select().from(schema.sets).all();
    const durationSet = allSets.find((s) => s.durationSeconds !== null);
    const distanceSet = allSets.find((s) => s.distanceMeters !== null);

    expect(durationSet?.durationSeconds).toBe(48 * 60); // 2880
    expect(distanceSet?.distanceMeters).toBeCloseTo(4.45 * 1609.34, 2);
    // cardio sets carry no weight/reps
    expect(durationSet?.weightKg).toBeNull();
    t.cleanup();
  });

  it('flags the warmup set and applies RIR only to working sets', () => {
    const t = createTestDb();
    importObsidianWorkout(t.db, BLOCK);

    const allSets = t.db.select().from(schema.sets).all();
    const warmups = allSets.filter((s) => s.isWarmup);
    expect(warmups).toHaveLength(1);
    expect(warmups[0].reps).toBe(8);
    expect(warmups[0].weightKg).toBeCloseTo(95 * 0.453592, 4);
    expect(warmups[0].rpe).toBeNull(); // RIR does not apply to warmups

    const rirSets = allSets.filter((s) => s.rpe === 2);
    expect(rirSets).toHaveLength(3); // the 3 working sets
    t.cleanup();
  });

  it('maps notes and records the right counts', () => {
    const t = createTestDb();
    const res = importObsidianWorkout(t.db, BLOCK);
    expect(res).toEqual({ workoutsCreated: 1, workoutsSkipped: 0, setsCreated: 6 });

    const { workout } = setsForDate(t, '2026-06-20');
    expect(workout.notes).toBe('Push Day 2026-06-20');
    t.cleanup();
  });

  it('is idempotent: re-importing the same date is skipped and writes nothing', () => {
    const t = createTestDb();
    importObsidianWorkout(t.db, BLOCK);
    const setsAfterFirst = t.db.select().from(schema.sets).all().length;

    const res = importObsidianWorkout(t.db, BLOCK);
    expect(res).toEqual({ workoutsCreated: 0, workoutsSkipped: 1, setsCreated: 0 });

    const workouts = t.db.select().from(schema.workouts).all();
    expect(workouts).toHaveLength(1);
    expect(t.db.select().from(schema.sets).all().length).toBe(setsAfterFirst);
    t.cleanup();
  });

  it('throws NO_DATE and writes nothing when the block has no date', () => {
    const t = createTestDb();
    const noDate = `Push Day\nBench Press\n3 sets x 8 reps x 135 lbs`;
    expect(() => importObsidianWorkout(t.db, noDate)).toThrow('NO_DATE');
    expect(t.db.select().from(schema.workouts).all()).toHaveLength(0);
    t.cleanup();
  });

  it('reuses an existing exercise by name instead of duplicating it', () => {
    const t = createTestDb();
    t.seedExercise('Bench Press');
    importObsidianWorkout(t.db, BLOCK);

    const benches = t.db.select().from(schema.exercises).where(eq(schema.exercises.name, 'Bench Press')).all();
    expect(benches).toHaveLength(1);
    t.cleanup();
  });
});
