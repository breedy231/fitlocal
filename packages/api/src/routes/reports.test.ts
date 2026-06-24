// Hermetic tests for the reports route's weight-based aggregations. Regression
// guard for issue #57: legacy cardio rows (e.g. "Rowing") stored distance in
// weight_kg before distance_meters became a first-class column, so any
// weight-based stat that didn't exclude cardio surfaced nonsense (a ~5,050 lb
// rower in Personal Records). We point DATABASE_PATH at a throwaway DB BEFORE
// importing db.js, build + seed the tables, then register the reports routes on
// a Fastify instance and hit them via inject.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-reports-${randomUUID()}.db`);

let sqlite: DatabaseType.Database;
let app: FastifyInstance;

beforeAll(async () => {
  // db.ts creates indexes on these tables at import time, so they must exist
  // first. Build + seed on a pre-connection, then let the singleton open it.
  const seed = new Database(TMP_DB);
  seed.pragma('journal_mode = WAL');
  seed.exec(`
    CREATE TABLE workouts (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, notes TEXT);
    CREATE TABLE exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      primary_muscles TEXT DEFAULT '[]', secondary_muscles TEXT DEFAULT '[]',
      equipment TEXT DEFAULT '[]', movement_type TEXT, description TEXT,
      image_url TEXT, wger_id INTEGER, rest_seconds INTEGER DEFAULT 60
    );
    CREATE TABLE workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL, exercise_id INTEGER NOT NULL, display_order INTEGER DEFAULT 0
    );
    CREATE TABLE sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workout_exercise_id INTEGER NOT NULL,
      reps INTEGER, weight_kg REAL, duration_seconds INTEGER, distance_meters REAL,
      is_warmup INTEGER DEFAULT 0, multiplier REAL DEFAULT 1.0, completed INTEGER DEFAULT 0
    );
    CREATE TABLE health_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, body_weight_kg REAL
    );
  `);

  // Strength: Barbell Bench Press, top working set 100 kg x 5.
  // Cardio: Rowing with a legacy meters-in-weight_kg value (2290 kg ~= 5,050 lb)
  // — exactly the bogus PR from issue #57.
  seed.exec(`
    INSERT INTO exercises (id, name) VALUES
      (1, 'Barbell Bench Press'),
      (2, 'Rowing');
    INSERT INTO workouts (id, date, notes) VALUES
      (1, '2026-06-01', 'push'),
      (2, '2026-06-08', 'push');
    INSERT INTO workout_exercises (id, workout_id, exercise_id) VALUES
      (1, 1, 1), (2, 1, 2), (3, 2, 1), (4, 2, 2);
    INSERT INTO sets (workout_exercise_id, reps, weight_kg, distance_meters, is_warmup, multiplier, completed) VALUES
      (1, 5, 90, NULL, 0, 1.0, 1),
      (2, 23, 2153.2, NULL, 0, 1.0, 1),
      (3, 5, 100, NULL, 0, 1.0, 1),
      (4, 25, 2290.6, NULL, 0, 1.0, 1);
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

async function getJson(url: string): Promise<any> {
  const res = await app.inject({ method: 'GET', url });
  return res.json();
}

describe('GET /reports/personal-records', () => {
  it('excludes cardio (Rowing) so no impossible weight is surfaced', async () => {
    const body = await getJson('/reports/personal-records');
    const names = body.records.map((r: any) => r.exerciseName);
    expect(names).toContain('Barbell Bench Press');
    expect(names).not.toContain('Rowing');
    // No record should carry the bogus multi-thousand-kg weight.
    expect(body.records.every((r: any) => r.maxWeightKg < 500)).toBe(true);
    const bench = body.records.find((r: any) => r.exerciseName === 'Barbell Bench Press');
    expect(bench.maxWeightKg).toBe(100);
  });
});

describe('GET /reports/exercise-progression', () => {
  it('returns an empty series for a cardio exercise', async () => {
    const body = await getJson('/reports/exercise-progression?exerciseId=2');
    expect(body.exerciseName).toBe('Rowing');
    expect(body.dataPoints).toEqual([]);
  });

  it('still returns a real series for a strength exercise', async () => {
    const body = await getJson('/reports/exercise-progression?exerciseId=1');
    expect(body.exerciseName).toBe('Barbell Bench Press');
    expect(body.dataPoints.length).toBe(2);
    expect(Math.max(...body.dataPoints.map((d: any) => d.maxWeight))).toBe(100);
  });
});

describe('GET /reports/exercises-with-history', () => {
  it('omits cardio from the progression picker', async () => {
    const body = await getJson('/reports/exercises-with-history');
    const names = body.exercises.map((e: any) => e.name);
    expect(names).toContain('Barbell Bench Press');
    expect(names).not.toContain('Rowing');
  });
});

describe('GET /reports/summary', () => {
  it('excludes cardio from total volume so legacy meters do not inflate lbs', async () => {
    const body = await getJson('/reports/summary');
    // Only the two bench sets count: 5*90 + 5*100 = 950 kg. The rowing sets
    // (23*2153 + 25*2290 ~= 106k kg) must NOT be included.
    expect(body.totalVolumeKg).toBe(950);
  });
});
