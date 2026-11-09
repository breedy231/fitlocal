// Exercises created (or renamed) after the first report request must still be
// classified as cardio / mobility. Schema comes from migrate.ts on a temp DB.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-reports-class-${randomUUID()}.db`);
let app: FastifyInstance;
let sqlite: import('better-sqlite3').Database;

beforeAll(async () => {
  process.env.DATABASE_PATH = TMP_DB;
  await import('../migrate.js');
  ({ sqlite } = await import('../db.js'));
  const { reportRoutes } = await import('./reports.js');
  const { exerciseRoutes } = await import('./exercises.js');
  app = Fastify();
  await app.register(reportRoutes);
  await app.register(exerciseRoutes);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

async function createExercise(name: string): Promise<number> {
  const res = await app.inject({ method: 'POST', url: '/exercises', payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

function logSet(workoutId: number, exerciseId: number, weightKg: number) {
  const we = sqlite
    .prepare('INSERT INTO workout_exercises (workout_id, exercise_id, display_order) VALUES (?, ?, 0)')
    .run(workoutId, exerciseId);
  sqlite
    .prepare('INSERT INTO sets (workout_exercise_id, reps, weight_kg, is_warmup, multiplier, completed) VALUES (?, 5, ?, 0, 1.0, 1)')
    .run(we.lastInsertRowid, weightKg);
}

async function prNames(): Promise<string[]> {
  const res = await app.inject({ method: 'GET', url: '/reports/personal-records' });
  return res.json().records.map((r: any) => r.exerciseName);
}

describe('report exercise classification after runtime creation', () => {
  it('excludes cardio and mobility exercises created after the first report request', async () => {
    const workoutId = Number(
      sqlite.prepare("INSERT INTO workouts (date) VALUES ('2026-11-01')").run().lastInsertRowid,
    );
    const benchId = await createExercise('Barbell Bench Press');
    logSet(workoutId, benchId, 100);

    // First report request: this is what used to freeze the ID caches.
    expect(await prNames()).toEqual(['Barbell Bench Press']);

    const treadmillId = await createExercise('Treadmill');
    const stretchId = await createExercise('Hamstring Stretch');
    logSet(workoutId, treadmillId, 2000); // legacy distance-in-weight_kg row
    logSet(workoutId, stretchId, 50);

    const names = await prNames();
    expect(names).toContain('Barbell Bench Press');
    expect(names).not.toContain('Treadmill');
    expect(names).not.toContain('Hamstring Stretch');
  });

  it('re-classifies an exercise renamed into cardio', async () => {
    const workoutId = Number(
      sqlite.prepare("INSERT INTO workouts (date) VALUES ('2026-11-02')").run().lastInsertRowid,
    );
    const id = await createExercise('Mystery Machine Thing');
    logSet(workoutId, id, 1500);
    expect(await prNames()).toContain('Mystery Machine Thing');

    const res = await app.inject({ method: 'PUT', url: `/exercises/${id}`, payload: { name: 'Rowing' } });
    expect(res.statusCode).toBe(200);
    expect(await prNames()).not.toContain('Rowing');
  });
});
