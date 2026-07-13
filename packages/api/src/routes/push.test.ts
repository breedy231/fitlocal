// Hermetic tests for push subscription CRUD (#78).
// Mirrors the sets.test.ts pattern: point DATABASE_PATH at a throwaway DB
// before importing db.js, seed the schema, register pushRoutes on a Fastify
// instance, then hit it via inject.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-push-${randomUUID()}.db`);

let app: FastifyInstance;

beforeAll(async () => {
  // Build a minimal DB. db.ts creates indexes on workout_exercises/sets/workouts
  // at import time, so those tables must exist before we import db.js.
  const seed = new Database(TMP_DB);
  seed.pragma('journal_mode = WAL');
  seed.exec(`
    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, location_profile TEXT, notes TEXT,
      effort_rating INTEGER, started_at TEXT, ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL, exercise_id INTEGER NOT NULL,
      display_order INTEGER DEFAULT 0, superset_group INTEGER, swap_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workout_exercise_id INTEGER NOT NULL,
      reps INTEGER, weight_kg REAL, is_warmup INTEGER DEFAULT 0, rpe REAL,
      multiplier REAL DEFAULT 1.0, duration_seconds INTEGER, distance_meters REAL,
      resistance REAL, completed INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  seed.close();

  process.env.DATABASE_PATH = TMP_DB;
  await import('../db.js');
  const { pushRoutes } = await import('./push.js');

  app = Fastify();
  await app.register(pushRoutes);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

const SAMPLE_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BNfake256dhkey==', auth: 'fakeauthkey==' },
};

describe('POST /push-subscriptions', () => {
  it('creates a subscription and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/push-subscriptions',
      payload: SAMPLE_SUB,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });
  });

  it('upserts on duplicate endpoint (no error)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/push-subscriptions',
      payload: { ...SAMPLE_SUB, keys: { p256dh: 'BNewKey==', auth: 'newauth==' } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects missing keys field (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/push-subscriptions',
      payload: { endpoint: 'https://example.com/push' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /push-subscriptions', () => {
  it('returns an array with the upserted subscription', async () => {
    const res = await app.inject({ method: 'GET', url: '/push-subscriptions' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ endpoint: string; keys: { p256dh: string; auth: string } }>;
    expect(Array.isArray(rows)).toBe(true);
    const found = rows.find(r => r.endpoint === SAMPLE_SUB.endpoint);
    expect(found).toBeDefined();
    // After upsert the keys should reflect the most recent POST
    expect(found?.keys.p256dh).toBe('BNewKey==');
    expect(found?.keys.auth).toBe('newauth==');
  });
});

describe('DELETE /push-subscriptions', () => {
  it('removes the subscription and returns 204', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/push-subscriptions',
      payload: { endpoint: SAMPLE_SUB.endpoint },
    });
    expect(res.statusCode).toBe(204);

    // Verify it's gone
    const listRes = await app.inject({ method: 'GET', url: '/push-subscriptions' });
    const rows = listRes.json() as Array<{ endpoint: string }>;
    expect(rows.find(r => r.endpoint === SAMPLE_SUB.endpoint)).toBeUndefined();
  });

  it('is idempotent — deleting a non-existent endpoint returns 204', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/push-subscriptions',
      payload: { endpoint: 'https://example.com/nonexistent' },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('GET /push/vapid-public-key', () => {
  it('returns publicKey field (null when env var not set)', async () => {
    delete process.env.FITLOCAL_VAPID_PUBLIC_KEY;
    const res = await app.inject({ method: 'GET', url: '/push/vapid-public-key' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('publicKey', null);
  });

  it('returns the env var value when set', async () => {
    process.env.FITLOCAL_VAPID_PUBLIC_KEY = 'BFakePublicKey';
    const res = await app.inject({ method: 'GET', url: '/push/vapid-public-key' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('publicKey', 'BFakePublicKey');
    delete process.env.FITLOCAL_VAPID_PUBLIC_KEY;
  });
});
