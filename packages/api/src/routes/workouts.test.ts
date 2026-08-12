// Hermetic tests for workout session timestamps (#68 — prereq for HR zones #59).
// started_at is stamped on create for a *live* (today-dated) workout only (a
// back-logged date gets null so it can't form a wrong-day HR window — see
// session-window.test.ts), and ended_at must persist when the active-workout
// page PATCHes it on finish / visibilitychange. We point DATABASE_PATH at a throwaway
// DB BEFORE importing db.js, build the tables, then register workoutRoutes on a
// Fastify instance and hit them via inject.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-workouts-${randomUUID()}.db`);

let app: FastifyInstance;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// started_at is only stamped for a workout whose date is today (user's tz).
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

beforeAll(async () => {
  // db.ts opens the singleton at import time, so the file + tables must exist
  // first (with started_at / ended_at, matching the migration).
  const seed = new Database(TMP_DB);
  seed.pragma('journal_mode = WAL');
  seed.exec(`
    CREATE TABLE workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, location_profile TEXT, notes TEXT,
      effort_rating INTEGER, started_at TEXT, ended_at TEXT, source TEXT
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
      resistance REAL, completed INTEGER DEFAULT 0,
      external_id TEXT, source TEXT, energy_kcal REAL
    );
    CREATE TABLE health_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, body_weight_kg REAL);
  `);
  // Body weight for the export's MET-based calorie estimate.
  seed.exec(`INSERT INTO health_snapshots (date, body_weight_kg) VALUES ('2025-01-01', 80);`);
  seed.exec(`INSERT INTO exercises (id, name) VALUES
    (1, 'Barbell Bench Press'),
    (2, 'Running - Treadmill'),
    (3, 'Hiking'),
    (4, 'Stair Stepper'),
    (5, 'Swimming'),
    (6, 'Cycling');`);
  seed.close();

  process.env.DATABASE_PATH = TMP_DB;
  await import('../db.js');
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

describe('POST /workouts', () => {
  it('stamps started_at with an ISO-8601 timestamp and leaves ended_at null', async () => {
    const res = await app.inject({
      method: 'POST', url: '/workouts',
      payload: { date: TODAY, notes: 'push' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.startedAt).toMatch(ISO_RE);
    expect(body.endedAt).toBeNull();
  });
});

describe('POST /workouts/start', () => {
  it('stamps started_at on the batch-created workout', async () => {
    const res = await app.inject({
      method: 'POST', url: '/workouts/start',
      payload: {
        date: TODAY, notes: 'push',
        exercises: [
          { exerciseId: 1, displayOrder: 0, sets: [{ reps: 5, weightKg: 60 }] },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().startedAt).toMatch(ISO_RE);
  });
});

describe('PATCH /workouts/:id ended_at', () => {
  it('persists ended_at when the active-workout page stamps it', async () => {
    const created = (await app.inject({
      method: 'POST', url: '/workouts',
      payload: { date: TODAY },
    })).json();

    const endedAt = new Date().toISOString();
    const patched = await app.inject({
      method: 'PATCH', url: `/workouts/${created.id}`,
      payload: { endedAt },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().endedAt).toBe(endedAt);
    // started_at from create is untouched by the end-of-session PATCH.
    expect(patched.json().startedAt).toMatch(ISO_RE);
  });
});

// GET /workouts/export — HealthKit writeback (#93 step 5). Apple-measured cardio
// sets (external_id set) must contribute 0 min / 0 kcal so we don't double-count
// energy Apple already recorded; a workout that nets to 0 exported minutes is
// omitted; exerciseType is recomputed from the remaining (manual) sets; and the
// cardio classifier now covers Hiking / Stair Stepper / Swimming (the old
// hardcoded IN(...) list omitted them, silently dropping that manual cardio).
describe('GET /workouts/export', () => {
  // Seed raw rows (incl. external_id/source) directly — no API route exposes them.
  // Each test uses a distinct date so cases stay isolated.
  function seedRows() {
    const seed = new Database(TMP_DB);
    const wStmt = seed.prepare('INSERT INTO workouts (date, source) VALUES (?, ?)');
    const weStmt = seed.prepare('INSERT INTO workout_exercises (workout_id, exercise_id, display_order) VALUES (?, ?, 0)');
    const sStmt = seed.prepare(
      'INSERT INTO sets (workout_exercise_id, reps, weight_kg, external_id, source, energy_kcal) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const addWorkout = (date: string, workoutSource: string | null) =>
      Number(wStmt.run(date, workoutSource).lastInsertRowid);
    const addExercise = (workoutId: number, exerciseId: number) =>
      Number(weStmt.run(workoutId, exerciseId).lastInsertRowid);
    const addSet = (
      weId: number,
      reps: number | null,
      opts: { externalId?: string; source?: string; energyKcal?: number } = {}
    ) => sStmt.run(weId, reps, 0, opts.externalId ?? null, opts.source ?? null, opts.energyKcal ?? null);
    return { seed, addWorkout, addExercise, addSet };
  }

  it('excludes Apple-sourced cardio: enriched workout exports only its manual strength portion', async () => {
    const date = '2025-01-10';
    const { seed, addWorkout, addExercise, addSet } = seedRows();
    const w = addWorkout(date, null); // manual workout
    const bench = addExercise(w, 1); // Barbell Bench Press (strength)
    addSet(bench, 5); addSet(bench, 5); addSet(bench, 5); addSet(bench, 5); // 4 manual strength sets
    const run = addExercise(w, 2); // Running - Treadmill (cardio)
    // Apple-measured cardio set — must contribute 0 min / 0 kcal.
    addSet(run, 30, { externalId: 'apple-uuid-1', source: 'apple_health', energyKcal: 250 });
    seed.close();

    const res = await app.inject({ method: 'GET', url: `/workouts/export?date=${date}` });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.date).toBe(date);
    // Only 4 strength sets * 2.5 min = 10 min; no cardio minutes from the Apple set.
    expect(row.durationMinutes).toBe(10);
    expect(row.exerciseType).toBe('strength');
    // Calories reflect strength only (no cardio component).
    expect(row.caloriesBurned).toBeGreaterThan(0);
  });

  it('regression: a manual cardio set (external_id NULL) is still MET-counted', async () => {
    const date = '2025-01-11';
    const { seed, addWorkout, addExercise, addSet } = seedRows();
    const w = addWorkout(date, null);
    const run = addExercise(w, 2); // Running - Treadmill
    addSet(run, 20); // 20 min manual cardio, no external_id
    seed.close();

    const res = await app.inject({ method: 'GET', url: `/workouts/export?date=${date}` });
    const rows = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].durationMinutes).toBe(20);
    expect(rows[0].exerciseType).toBe('cardio');
    expect(rows[0].caloriesBurned).toBeGreaterThan(0);
  });

  it('omits a standalone Apple workout whose sets are all Apple-sourced', async () => {
    const date = '2025-01-12';
    const { seed, addWorkout, addExercise, addSet } = seedRows();
    const w = addWorkout(date, 'apple_health'); // standalone Apple workout
    const cyc = addExercise(w, 6); // Cycling
    addSet(cyc, 45, { externalId: 'apple-uuid-2', source: 'apple_health', energyKcal: 400 });
    seed.close();

    const res = await app.inject({ method: 'GET', url: `/workouts/export?date=${date}` });
    const rows = res.json();
    // Entire row omitted — 0 exported minutes, Apple already has it verbatim.
    expect(rows).toHaveLength(0);
  });

  it('bug-fix: manual Hiking / Stair Stepper / Swimming cardio is now counted', async () => {
    const date = '2025-01-13';
    const { seed, addWorkout, addExercise, addSet } = seedRows();
    const w = addWorkout(date, null);
    addSet(addExercise(w, 3), 40); // Hiking, 40 min
    addSet(addExercise(w, 4), 15); // Stair Stepper, 15 min
    addSet(addExercise(w, 5), 25); // Swimming, 25 min
    seed.close();

    const res = await app.inject({ method: 'GET', url: `/workouts/export?date=${date}` });
    const rows = res.json();
    expect(rows).toHaveLength(1);
    // Previously the hardcoded IN(...) list omitted these names → 0 min dropped.
    expect(rows[0].durationMinutes).toBe(80); // 40 + 15 + 25
    expect(rows[0].exerciseType).toBe('cardio');
    expect(rows[0].caloriesBurned).toBeGreaterThan(0);
  });

  it('mixed workout whose cardio was all Apple-sourced reports as strength', async () => {
    const date = '2025-01-14';
    const { seed, addWorkout, addExercise, addSet } = seedRows();
    const w = addWorkout(date, null);
    const bench = addExercise(w, 1);
    addSet(bench, 5); addSet(bench, 5); // 2 manual strength sets
    const hike = addExercise(w, 3); // Hiking (cardio) but Apple-sourced
    addSet(hike, 60, { externalId: 'apple-uuid-3', source: 'apple_health', energyKcal: 500 });
    seed.close();

    const res = await app.inject({ method: 'GET', url: `/workouts/export?date=${date}` });
    const rows = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].durationMinutes).toBe(5); // 2 * 2.5, no cardio
    expect(rows[0].exerciseType).toBe('strength');
  });
});
