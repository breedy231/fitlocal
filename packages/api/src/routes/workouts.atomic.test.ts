// Atomic add/swap of a workout exercise: one POST creates the exercise + its
// sets and (optionally) removes the exercise being replaced, all in one
// transaction. Schema comes from migrate.ts on a throwaway DATABASE_PATH.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-atomic-${randomUUID()}.db`);

let app: FastifyInstance;
let sqlite: import('better-sqlite3').Database;
let exA: number;
let exB: number;

beforeAll(async () => {
  process.env.DATABASE_PATH = TMP_DB;
  await import('../migrate.js');
  const dbMod = await import('../db.js');
  sqlite = dbMod.sqlite;
  exA = Number(sqlite.prepare("INSERT INTO exercises (name) VALUES ('Atomic Test A')").run().lastInsertRowid);
  exB = Number(sqlite.prepare("INSERT INTO exercises (name) VALUES ('Atomic Test B')").run().lastInsertRowid);
  const { workoutRoutes } = await import('./workouts.js');
  app = Fastify();
  await app.register(workoutRoutes);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

async function newWorkout(): Promise<number> {
  const res = await app.inject({ method: 'POST', url: '/workouts', payload: { date: '2026-01-01' } });
  return res.json().id;
}
const weCount = (workoutId: number) =>
  (sqlite.prepare('SELECT COUNT(*) c FROM workout_exercises WHERE workout_id = ?').get(workoutId) as { c: number }).c;
const setCount = (weId: number) =>
  (sqlite.prepare('SELECT COUNT(*) c FROM sets WHERE workout_exercise_id = ?').get(weId) as { c: number }).c;

describe('POST /workouts/:id/exercises with sets', () => {
  it('creates the exercise and its sets in one call', async () => {
    const wid = await newWorkout();
    const res = await app.inject({
      method: 'POST', url: `/workouts/${wid}/exercises`,
      payload: { exerciseId: exA, displayOrder: 2, sets: [{ reps: 8, weightKg: 20 }, { reps: 10, weightKg: null }, { reps: null, weightKg: null }] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.workoutId).toBe(wid);
    expect(body.exerciseId).toBe(exA);
    expect(body.sets).toHaveLength(3);
    expect(body.sets[0]).toMatchObject({ workoutExerciseId: body.id, reps: 8, weightKg: 20, isWarmup: false });
    expect(typeof body.sets[0].id).toBe('number');
    expect(setCount(body.id)).toBe(3);
  });

  it('extends the live workout HR window (ended_at) like POST /sets', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
    const wid = (await app.inject({ method: 'POST', url: '/workouts', payload: { date: today } })).json().id;
    const endedBefore = (sqlite.prepare('SELECT ended_at e FROM workouts WHERE id = ?').get(wid) as { e: string | null }).e;
    expect(endedBefore).toBeNull();
    const res = await app.inject({ method: 'POST', url: `/workouts/${wid}/exercises`, payload: { exerciseId: exA, sets: [{ reps: 5, weightKg: 10 }] } });
    expect(res.statusCode).toBe(201);
    const endedAfter = (sqlite.prepare('SELECT ended_at e FROM workouts WHERE id = ?').get(wid) as { e: string | null }).e;
    expect(endedAfter).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('swap: removes the old exercise and its sets', async () => {
    const wid = await newWorkout();
    const old = (await app.inject({ method: 'POST', url: `/workouts/${wid}/exercises`, payload: { exerciseId: exA, sets: [{ reps: 5, weightKg: 10 }] } })).json();
    expect(setCount(old.id)).toBe(1);
    const res = await app.inject({
      method: 'POST', url: `/workouts/${wid}/exercises`,
      payload: { exerciseId: exB, swapReason: 'busy', sets: [{ reps: 5, weightKg: 10 }, { reps: 5, weightKg: 10 }], replaceWorkoutExerciseId: old.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.sets).toHaveLength(2);
    expect(weCount(wid)).toBe(1);
    expect(sqlite.prepare('SELECT 1 FROM workout_exercises WHERE id = ?').get(old.id)).toBeUndefined();
    expect(setCount(old.id)).toBe(0);
    expect(setCount(body.id)).toBe(2);
  });

  it('replace id from another workout: error and nothing written', async () => {
    const w1 = await newWorkout();
    const w2 = await newWorkout();
    const other = (await app.inject({ method: 'POST', url: `/workouts/${w2}/exercises`, payload: { exerciseId: exA, sets: [{ reps: 5, weightKg: 10 }] } })).json();
    const before = { w1: weCount(w1), w2: weCount(w2), sets: setCount(other.id) };
    const res = await app.inject({
      method: 'POST', url: `/workouts/${w1}/exercises`,
      payload: { exerciseId: exB, sets: [{ reps: 5, weightKg: 10 }], replaceWorkoutExerciseId: other.id },
    });
    expect([400, 404]).toContain(res.statusCode);
    expect(weCount(w1)).toBe(before.w1);
    expect(weCount(w2)).toBe(before.w2);
    expect(setCount(other.id)).toBe(before.sets);
  });

  it('rolls back everything when a set insert fails mid-transaction', async () => {
    const wid = await newWorkout();
    const old = (await app.inject({ method: 'POST', url: `/workouts/${wid}/exercises`, payload: { exerciseId: exA, sets: [{ reps: 5, weightKg: 10 }] } })).json();
    // Nonexistent exercise id -> FK violation on the workout_exercise insert.
    const res = await app.inject({
      method: 'POST', url: `/workouts/${wid}/exercises`,
      payload: { exerciseId: 999999, sets: [{ reps: 5, weightKg: 10 }], replaceWorkoutExerciseId: old.id },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(weCount(wid)).toBe(1);
    expect(setCount(old.id)).toBe(1);
  });

  it('legacy body (no sets, no replace) behaves as before', async () => {
    const wid = await newWorkout();
    const res = await app.inject({ method: 'POST', url: `/workouts/${wid}/exercises`, payload: { exerciseId: exA } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.sets).toBeUndefined();
    expect(setCount(body.id)).toBe(0);
    expect(weCount(wid)).toBe(1);
  });
});
