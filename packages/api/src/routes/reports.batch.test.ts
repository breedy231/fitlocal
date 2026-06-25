// Hermetic tests for the batched progression endpoint (#71, item 1).
// GET /reports/exercise-progression-batch resolves many lifts in one GROUP-BY
// query so the Reports gallery loads in a single round-trip instead of ~12.
// Asserts request-order preservation, per-session points, and that cardio /
// mobility / unknown ids resolve to empty series. We point DATABASE_PATH at a
// throwaway DB BEFORE importing db.js, build + seed the tables, then register
// reportRoutes on a Fastify instance and hit it via inject.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-reports-batch-${randomUUID()}.db`);

let app: FastifyInstance;

beforeAll(async () => {
  const seed = new Database(TMP_DB);
  seed.pragma('journal_mode = WAL');
  seed.exec(`
    CREATE TABLE workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, location_profile TEXT, notes TEXT,
      effort_rating INTEGER, started_at TEXT, ended_at TEXT
    );
    CREATE TABLE exercises (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
    CREATE TABLE workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL, exercise_id INTEGER NOT NULL,
      display_order INTEGER DEFAULT 0, superset_group INTEGER, swap_reason TEXT
    );
    CREATE TABLE sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workout_exercise_id INTEGER NOT NULL,
      reps INTEGER, weight_kg REAL, is_warmup INTEGER DEFAULT 0, rpe REAL,
      multiplier REAL DEFAULT 1.0, duration_seconds INTEGER, distance_meters REAL,
      resistance REAL, completed INTEGER DEFAULT 0
    );
  `);
  // 1 = Barbell Bench Press (2 weighted sessions), 2 = Back Squat (1 session),
  // 3 = Treadmill Run (cardio — must resolve to an empty series).
  seed.exec(`
    INSERT INTO exercises (id, name) VALUES
      (1, 'Barbell Bench Press'), (2, 'Back Squat'), (3, 'Treadmill Run');

    INSERT INTO workouts (id, date) VALUES
      (1, '2026-06-01'), (2, '2026-06-08'), (3, '2026-06-03'), (4, '2026-06-05');

    -- Bench: two sessions, ascending dates, increasing load.
    INSERT INTO workout_exercises (id, workout_id, exercise_id) VALUES (1, 1, 1), (2, 2, 1);
    INSERT INTO sets (workout_exercise_id, reps, weight_kg, is_warmup) VALUES
      (1, 5, 60, 0), (2, 5, 65, 0);

    -- Squat: one session.
    INSERT INTO workout_exercises (id, workout_id, exercise_id) VALUES (3, 3, 2);
    INSERT INTO sets (workout_exercise_id, reps, weight_kg, is_warmup) VALUES (3, 5, 100, 0);

    -- Treadmill: a logged session (legacy distance-in-weight), but cardio → empty.
    INSERT INTO workout_exercises (id, workout_id, exercise_id) VALUES (4, 4, 3);
    INSERT INTO sets (workout_exercise_id, reps, weight_kg, is_warmup) VALUES (4, 0, 5, 0);
  `);
  seed.close();

  process.env.DATABASE_PATH = TMP_DB;
  await import('../db.js');
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

describe('GET /reports/exercise-progression-batch', () => {
  it('returns a series per requested lift, preserving request order', async () => {
    const res = await app.inject({
      method: 'GET', url: '/reports/exercise-progression-batch?exerciseIds=2,1',
    });
    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    expect(results.map((r: any) => r.exerciseId)).toEqual([2, 1]);

    const squat = results[0];
    expect(squat.exerciseName).toBe('Back Squat');
    expect(squat.dataPoints).toHaveLength(1);

    const bench = results[1];
    expect(bench.exerciseName).toBe('Barbell Bench Press');
    expect(bench.dataPoints).toHaveLength(2);
    // Ascending by date, with the heavier session last.
    expect(bench.dataPoints.map((d: any) => d.date)).toEqual(['2026-06-01', '2026-06-08']);
    expect(bench.dataPoints[0].maxWeight).toBe(60);
    expect(bench.dataPoints[1].maxWeight).toBe(65);
  });

  it('resolves cardio lifts to an empty series', async () => {
    const res = await app.inject({
      method: 'GET', url: '/reports/exercise-progression-batch?exerciseIds=3',
    });
    const { results } = res.json();
    expect(results).toHaveLength(1);
    expect(results[0].exerciseName).toBe('Treadmill Run');
    expect(results[0].dataPoints).toEqual([]);
  });

  it('resolves unknown ids to a null name and empty series', async () => {
    const res = await app.inject({
      method: 'GET', url: '/reports/exercise-progression-batch?exerciseIds=999',
    });
    const { results } = res.json();
    expect(results).toEqual([{ exerciseId: 999, exerciseName: null, dataPoints: [] }]);
  });

  it('returns no results when exerciseIds is omitted', async () => {
    const res = await app.inject({
      method: 'GET', url: '/reports/exercise-progression-batch',
    });
    expect(res.json()).toEqual({ results: [] });
  });
});
