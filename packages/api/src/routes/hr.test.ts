// Hermetic tests for per-workout HR ingest + read (#59, Phase 0).
// POST /hr-samples buckets raw Apple Watch samples into the workout whose
// [started_at, ended_at] window contains them, thins to ~1/10s, and is
// idempotent on re-post. GET /workouts/:id/hr returns summary + time-in-zone
// when a max HR is configured. We point DATABASE_PATH at a throwaway DB BEFORE
// importing db.js, seed the tables, register hrRoutes, and hit via inject.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-hr-${randomUUID()}.db`);

let app: FastifyInstance;

// Workout 1 ran 10:00–11:00Z; samples outside that fall to no workout.
const WIN_START = '2026-06-25T10:00:00.000Z';
const WIN_END = '2026-06-25T11:00:00.000Z';

beforeAll(async () => {
  const seed = new Database(TMP_DB);
  seed.pragma('journal_mode = WAL');
  seed.exec(`
    CREATE TABLE workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, location_profile TEXT, notes TEXT,
      effort_rating INTEGER, started_at TEXT, ended_at TEXT
    );
    CREATE TABLE workout_hr_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL, t TEXT NOT NULL, bpm INTEGER NOT NULL
    );
    -- db.ts builds indexes on these at import time, so they must exist.
    CREATE TABLE workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workout_id INTEGER NOT NULL, exercise_id INTEGER NOT NULL
    );
    CREATE TABLE sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workout_exercise_id INTEGER NOT NULL
    );
    CREATE TABLE user_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      maintenance_calories INTEGER, target_calories INTEGER, target_protein_g REAL,
      target_weight_kg REAL, cut_start_date TEXT, cut_end_date TEXT, max_hr INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  seed.exec(`
    INSERT INTO workouts (id, date, started_at, ended_at) VALUES
      (1, '2026-06-25', '${WIN_START}', '${WIN_END}'),
      (2, '2026-06-25', '2026-06-25T14:00:00.000Z', '2026-06-25T15:00:00.000Z');
    INSERT INTO user_goals (id, max_hr) VALUES (1, 190);
  `);
  seed.close();

  process.env.DATABASE_PATH = TMP_DB;
  await import('../db.js');
  const { hrRoutes } = await import('./hr.js');

  app = Fastify();
  await app.register(hrRoutes);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

// 5 samples inside workout 1's window (two within the same 10s bucket → one is
// dropped by downsampling → 4 kept) + 2 outside any window (unmatched).
const CSV = [
  '2026-06-25T10:00:00.000Z,120',
  '2026-06-25T10:00:05.000Z,125', // same 10s bucket as the first → dropped
  '2026-06-25T10:00:11.000Z,130',
  '2026-06-25T10:00:30.000Z,175',
  '2026-06-25T10:05:00.000Z,95',
  '2026-06-25T09:59:00.000Z,100',  // before window → unmatched
  '2026-06-25T12:00:00.000Z,110',  // after window → unmatched
].join('\n');

describe('POST /hr-samples', () => {
  it('buckets samples into the workout window, downsamples, and counts unmatched', async () => {
    const res = await app.inject({ method: 'POST', url: '/hr-samples', payload: { samples: CSV } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.received).toBe(7);
    expect(body.unmatched).toBe(2);
    expect(body.stored).toBe(4);
    expect(body.workouts).toHaveLength(1);
    expect(body.workouts[0]).toMatchObject({ workoutId: 1, sampleCount: 4, avgHr: 130, maxHr: 175 });
  });

  it('is idempotent — re-posting replaces, not appends', async () => {
    await app.inject({ method: 'POST', url: '/hr-samples', payload: { samples: CSV } });
    const res = await app.inject({ method: 'GET', url: '/workouts/1/hr' });
    expect(res.json().sampleCount).toBe(4);
  });

  it('rejects a payload with no valid samples', async () => {
    const res = await app.inject({ method: 'POST', url: '/hr-samples', payload: { samples: 'garbage,with,no,valid,rows' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /workouts/:id/hr', () => {
  it('returns summary + time-in-zone derived from the configured max HR', async () => {
    const res = await app.inject({ method: 'GET', url: '/workouts/1/hr' });
    const body = res.json();
    expect(body).toMatchObject({ workoutId: 1, sampleCount: 4, avgHr: 130, maxHr: 175, minHr: 95, maxHrConfig: 190 });
    expect(body.zones).toHaveLength(5);

    const secs = Object.fromEntries(body.zones.map((z: any) => [z.zone, z.seconds]));
    // 120 & 130 bpm → Z2 (11s + 19s); 175 → Z5 (gap capped at 30s); 95 → Z1 (nominal 10s tail).
    expect(secs[1]).toBe(10);
    expect(secs[2]).toBe(30);
    expect(secs[5]).toBe(30);
    expect(secs[3]).toBe(0);
    // Z1 lower bound = round(0.5 * 190) = 95.
    expect(body.zones[0].minBpm).toBe(95);
    expect(body.zones[4].maxBpm).toBeNull();
  });

  it('returns an empty series (and null zones) for a workout with no HR', async () => {
    const res = await app.inject({ method: 'GET', url: '/workouts/2/hr' });
    expect(res.json()).toMatchObject({ workoutId: 2, sampleCount: 0, avgHr: null, zones: null });
  });
});
