// Hermetic tests for workout session timestamps (#68 — prereq for HR zones #59).
// started_at must be stamped on create (both POST /workouts and POST
// /workouts/start), and ended_at must persist when the active-workout page
// PATCHes it on finish / visibilitychange. We point DATABASE_PATH at a throwaway
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

beforeAll(async () => {
  // db.ts opens the singleton at import time, so the file + tables must exist
  // first (with started_at / ended_at, matching the migration).
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
      payload: { date: '2026-06-24', notes: 'push' },
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
        date: '2026-06-24', notes: 'push',
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
      payload: { date: '2026-06-24' },
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
