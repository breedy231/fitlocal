// POST /health/sync must date the row by America/Chicago, not the server clock.
// Fly runs in UTC, so an evening sync used to land on tomorrow's row.
// Schema comes from migrate.ts on a temp DB. Values are made up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-health-sync-${randomUUID()}.db`);
const ORIGINAL_TZ = process.env.TZ;
let app: FastifyInstance;

beforeAll(async () => {
  process.env.TZ = 'UTC'; // what Fly, CI and cloud containers run with
  process.env.DATABASE_PATH = TMP_DB;
  await import('../migrate.js');
  await import('../db.js');
  const { healthRoutes } = await import('./health.js');
  app = Fastify();
  await app.register(healthRoutes);
  await app.ready();
});

afterEach(() => vi.useRealTimers());

afterAll(async () => {
  await app?.close();
  process.env.TZ = ORIGINAL_TZ;
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

describe('POST /health/sync', () => {
  it('dates an evening (Central) sync as today, not tomorrow', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T03:30:00Z')); // 9:30 pm CST on Nov 11
    const res = await app.inject({ method: 'POST', url: '/health/sync', payload: { steps: 1234 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().date).toBe('2026-11-11');
  });

  it('dates a morning sync as the same Central day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T14:00:00Z')); // 8 am CST on Nov 12
    const res = await app.inject({ method: 'POST', url: '/health/sync', payload: { steps: 4321 } });
    expect(res.json().date).toBe('2026-11-12');
  });
});
