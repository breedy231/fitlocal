// Tests for workout session-window timestamps (#59 follow-up). started_at is
// only stamped for live (today's) workouts so back-logged ones don't create a
// wrong-day HR window; ended_at is bumped server-side on every set write so the
// window closes reliably without depending on the client's flaky keepalive
// PATCH. We point DATABASE_PATH at a throwaway DB BEFORE importing db.js, seed
// the tables, register the routes, and drive them via inject.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-sw-${randomUUID()}.db`);

// Today's local calendar date in the user's tz — must match the helper's logic.
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const PAST = '2020-01-01';

let app: FastifyInstance;
let raw: Database.Database;

const workoutRow = (id: number) =>
  raw.prepare('SELECT started_at AS startedAt, ended_at AS endedAt FROM workouts WHERE id = ?').get(id) as
    | { startedAt: string | null; endedAt: string | null }
    | undefined;

beforeAll(async () => {
  const seed = new Database(TMP_DB);
  seed.pragma('journal_mode = WAL');
  seed.exec(`
    CREATE TABLE workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, location_profile TEXT, notes TEXT,
      effort_rating INTEGER, started_at TEXT, ended_at TEXT
    );
    CREATE TABLE exercises (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL, exercise_id INTEGER NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0, superset_group INTEGER, swap_reason TEXT
    );
    CREATE TABLE sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_exercise_id INTEGER NOT NULL,
      reps INTEGER, weight_kg REAL, is_warmup INTEGER DEFAULT 0, rpe REAL,
      multiplier REAL DEFAULT 1.0, duration_seconds INTEGER, distance_meters REAL,
      resistance REAL, completed INTEGER DEFAULT 0
    );
    CREATE TABLE workout_hr_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workout_id INTEGER NOT NULL, t TEXT NOT NULL, bpm INTEGER NOT NULL
    );
    INSERT INTO exercises (id, name) VALUES (1, 'Bench Press');
    -- A live workout (started today) and a back-logged one (no started_at).
    INSERT INTO workouts (id, date, started_at, ended_at) VALUES
      (1, '${TODAY}', '${new Date().toISOString()}', NULL),
      (2, '${PAST}', NULL, NULL);
    INSERT INTO workout_exercises (id, workout_id, exercise_id) VALUES (10, 1, 1), (20, 2, 1);
  `);
  seed.close();

  process.env.DATABASE_PATH = TMP_DB;
  await import('../db.js');
  const { workoutRoutes } = await import('./workouts.js');
  const { setRoutes } = await import('./sets.js');

  app = Fastify();
  await app.register(workoutRoutes);
  await app.register(setRoutes);
  await app.ready();

  raw = new Database(TMP_DB, { readonly: true });
});

afterAll(async () => {
  await app?.close();
  raw?.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

describe('POST /workouts — started_at guard', () => {
  it("stamps started_at for a workout dated today", async () => {
    const res = await app.inject({ method: 'POST', url: '/workouts', payload: { date: TODAY } });
    expect(res.statusCode).toBe(201);
    expect(res.json().startedAt).toBeTruthy();
  });

  it('leaves started_at null for a back-logged (past-dated) workout', async () => {
    const res = await app.inject({ method: 'POST', url: '/workouts', payload: { date: PAST } });
    expect(res.statusCode).toBe(201);
    expect(res.json().startedAt).toBeNull();
  });
});

describe('set heartbeat — ended_at', () => {
  it('bumps ended_at on a live workout when a set is created', async () => {
    expect(workoutRow(1)?.endedAt).toBeNull();
    const res = await app.inject({ method: 'POST', url: '/sets', payload: { workoutExerciseId: 10, reps: 8, weightKg: 60 } });
    expect(res.statusCode).toBe(201);
    expect(workoutRow(1)?.endedAt).toBeTruthy();
  });

  it('extends ended_at on a later set update (PATCH)', async () => {
    const first = workoutRow(1)!.endedAt!;
    const created = await app.inject({ method: 'POST', url: '/sets', payload: { workoutExerciseId: 10, reps: 8, weightKg: 60 } });
    const setId = created.json().id;
    await new Promise((r) => setTimeout(r, 5));
    await app.inject({ method: 'PATCH', url: `/sets/${setId}`, payload: { reps: 10 } });
    expect(workoutRow(1)!.endedAt! >= first).toBe(true);
  });

  it('does NOT manufacture a window for a back-logged workout (no started_at)', async () => {
    await app.inject({ method: 'POST', url: '/sets', payload: { workoutExerciseId: 20, reps: 8, weightKg: 60 } });
    expect(workoutRow(2)?.endedAt).toBeNull();
  });
});
