// PUT /goals must distinguish "key omitted" (leave column alone) from an
// explicit null (clear the column). Schema comes from migrate.ts on a temp DB.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-goals-${randomUUID()}.db`);
let app: FastifyInstance;

beforeAll(async () => {
  process.env.DATABASE_PATH = TMP_DB;
  await import('../migrate.js');
  await import('../db.js');
  const { goalRoutes } = await import('./goals.js');
  app = Fastify();
  await app.register(goalRoutes);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

async function put(payload: Record<string, unknown>) {
  const res = await app.inject({ method: 'PUT', url: '/goals', payload });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('PUT /goals', () => {
  it('stores values on first save', async () => {
    const g = await put({
      targetCalories: 2000,
      cutStartDate: '2026-09-01',
      cutEndDate: '2026-11-24',
    });
    expect(g.targetCalories).toBe(2000);
    expect(g.cutEndDate).toBe('2026-11-24');
  });

  it('leaves a column unchanged when its key is omitted', async () => {
    const g = await put({ targetProteinG: 180 });
    expect(g.targetProteinG).toBe(180);
    expect(g.targetCalories).toBe(2000);
    expect(g.cutEndDate).toBe('2026-11-24');
  });

  it('clears a column when it is explicitly null', async () => {
    const g = await put({ cutStartDate: null, cutEndDate: null });
    expect(g.cutStartDate).toBeNull();
    expect(g.cutEndDate).toBeNull();
    expect(g.targetCalories).toBe(2000);
    const fresh = (await app.inject({ method: 'GET', url: '/goals' })).json();
    expect(fresh.cutEndDate).toBeNull();
  });
});

describe('GET /goals/weight-trend weekly rate', () => {
  it('uses the point nearest 7 days back (Chicago date), not the first in range', async () => {
    const { sqlite } = await import('../db.js');
    sqlite.exec('DELETE FROM health_snapshots');
    const ins = sqlite.prepare('INSERT INTO health_snapshots (date, body_weight_kg) VALUES (?, ?)');
    ins.run('2026-09-01', 90);
    ins.run('2026-11-01', 86);
    ins.run('2026-11-09', 85);

    // 22:00 Chicago on 2026-11-09 is already 2026-11-10 in UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T04:00:00Z'));
    try {
      const body = (await app.inject({ method: 'GET', url: '/goals/weight-trend?since=2026-08-01' })).json();
      // prior = 11-01 (8 days before latest): (85-86)/8 kg/day * 7 * 2.2046 = -1.9 lbs/wk
      expect(body.weeklyRateLbs).toBe(-1.9);
    } finally {
      vi.useRealTimers();
    }
  });
});
