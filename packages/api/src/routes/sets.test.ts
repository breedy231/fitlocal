// Hermetic regression tests for set completion persistence (#73).
// Finishing a workout PUTs each set with completed:true; before the fix the
// finish loop omitted `completed`, leaving sessions "active" forever to the
// pre-deploy guard. These assert PUT /sets/:id round-trips the flag. We point
// DATABASE_PATH at a throwaway DB BEFORE importing db.js, build the tables,
// then register setRoutes on a Fastify instance and hit them via inject.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-sets-${randomUUID()}.db`);

let app: FastifyInstance;

// Raw read of the persisted column (0/1), independent of the API response.
function dbCompleted(id: number): number | undefined {
  const ro = new Database(TMP_DB, { readonly: true });
  try {
    const row = ro.prepare('SELECT completed FROM sets WHERE id = ?').get(id) as
      | { completed: number }
      | undefined;
    return row?.completed;
  } finally {
    ro.close();
  }
}

beforeAll(async () => {
  // db.ts opens the singleton at import time, so the file + tables must exist
  // first (with the completed column, matching the migration).
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
  seed.exec(`INSERT INTO exercises (id, name) VALUES (1, 'Barbell Bench Press');`);
  // A set needs a valid workoutExerciseId to reference.
  seed.exec(`
    INSERT INTO workouts (id, date) VALUES (1, '2026-06-24');
    INSERT INTO workout_exercises (id, workout_id, exercise_id) VALUES (1, 1, 1);
  `);
  seed.close();

  process.env.DATABASE_PATH = TMP_DB;
  await import('../db.js');
  const { setRoutes } = await import('./sets.js');

  app = Fastify();
  await app.register(setRoutes);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

describe('PUT /sets/:id', () => {
  it('persists completed=true (the #73 finish-workout regression)', async () => {
    // A freshly created set defaults to not-completed.
    const postRes = await app.inject({
      method: 'POST', url: '/sets',
      payload: { workoutExerciseId: 1, reps: 5, weightKg: 60 },
    });
    expect(postRes.statusCode).toBe(201);
    const set = postRes.json();
    expect(set.completed).toBe(false);
    expect(dbCompleted(set.id)).toBe(0);

    // finishWorkout()'s PUT payload — completed:true must round-trip.
    const putRes = await app.inject({
      method: 'PUT', url: `/sets/${set.id}`,
      payload: { reps: 5, weightKg: 60, completed: true },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().completed).toBe(true);
    expect(dbCompleted(set.id)).toBe(1);
  });

  it('flips completed back to false when PUT with completed:false', async () => {
    const postRes = await app.inject({
      method: 'POST', url: '/sets',
      payload: { workoutExerciseId: 1, reps: 5, weightKg: 60, completed: true },
    });
    expect(postRes.statusCode).toBe(201);
    const set = postRes.json();
    expect(dbCompleted(set.id)).toBe(1);

    const putRes = await app.inject({
      method: 'PUT', url: `/sets/${set.id}`,
      payload: { reps: 5, weightKg: 60, completed: false },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().completed).toBe(false);
    expect(dbCompleted(set.id)).toBe(0);
  });

  it('returns 404 for a non-existent id', async () => {
    const putRes = await app.inject({
      method: 'PUT', url: '/sets/99999',
      payload: { completed: true },
    });
    expect(putRes.statusCode).toBe(404);
    expect(putRes.json()).toEqual({ error: 'Not found' });
  });
});
