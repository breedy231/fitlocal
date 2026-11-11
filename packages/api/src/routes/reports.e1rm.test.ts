// e1RM consistency between the SQL used by /reports/* and epley1RM().
// Schema comes from migrate.ts (not hand-written) per CLAUDE.md.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-reports-e1rm-${randomUUID()}.db`);
let app: FastifyInstance;

beforeAll(async () => {
  process.env.DATABASE_PATH = TMP_DB;
  await import('../migrate.js');
  const { sqlite } = await import('../db.js');
  sqlite.exec(`
    INSERT INTO exercises (id, name) VALUES (9001, 'Test Bench Press');
    INSERT INTO workouts (id, date) VALUES (9001, '2026-06-01');
    INSERT INTO workout_exercises (id, workout_id, exercise_id) VALUES (9001, 9001, 9001);
    INSERT INTO sets (workout_exercise_id, reps, weight_kg, is_warmup) VALUES (9001, 1, 100, 0);
  `);
  const { reportRoutes } = await import('./reports.js');
  app = Fastify();
  await app.register(reportRoutes);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

describe('single-rep e1RM equals the weight lifted', () => {
  it('/reports/exercise-1rm-history', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/exercise-1rm-history?exerciseId=9001' });
    expect(res.json().dataPoints[0].estimated1RmKg).toBeCloseTo(100, 6);
  });
  it('/reports/personal-records', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/personal-records' });
    const rec = res.json().records.find((r: any) => r.exerciseName === 'Test Bench Press');
    expect(rec.estimated1RmKg).toBeCloseTo(100, 6);
  });
  it('/reports/exercise-progression', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/exercise-progression?exerciseId=9001' });
    expect(res.json().dataPoints[0].estimated1RmKg).toBeCloseTo(100, 6);
  });
  it('/reports/exercise-progression-batch', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/exercise-progression-batch?exerciseIds=9001' });
    expect(res.json().results[0].dataPoints[0].estimated1RmKg).toBeCloseTo(100, 6);
  });
});
