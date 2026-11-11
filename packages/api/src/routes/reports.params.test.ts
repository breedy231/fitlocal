// Garbage query params on /reports/* must produce 400, never 500.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-reports-params-${randomUUID()}.db`);
let app: FastifyInstance;

beforeAll(async () => {
  process.env.DATABASE_PATH = TMP_DB;
  await import('../migrate.js');
  const { reportRoutes } = await import('./reports.js');
  const { applyErrorHandler } = await import('../lib/http.js');
  app = Fastify();
  applyErrorHandler(app);
  await app.register(reportRoutes);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

const get = (url: string) => app.inject({ method: 'GET', url });

const bad: string[] = [
  '/reports/calendar?year=abc',
  '/reports/calendar?month=13',
  '/reports/calendar?month=0',
  '/reports/calendar?year=99999',
  '/reports/calendar?month=abc',
  '/reports/volume-heatmap?weeks=-5',
  '/reports/volume-heatmap?weeks=abc',
  '/reports/volume-heatmap?weeks=0',
  '/reports/volume-heatmap?weeks=53',
  '/reports/volume-heatmap?weeks=100000',
  '/reports/frequency?excludeExerciseIds=abc',
  '/reports/frequency?excludeExerciseIds=1,,x',
  '/reports/summary?excludeExerciseIds=1;DROP',
  '/reports/health-trends?since=notadate',
  '/reports/health-trends?until=2026-13-45',
  '/reports/exercise-1rm-history?exerciseId=abc',
  '/reports/exercise-1rm-history',
  '/reports/exercise-progression?exerciseId=abc',
  '/reports/exercise-progression-batch?exerciseIds=1,x',
  '/reports/benchmarks?gender=other',
];

const good: string[] = [
  '/reports/calendar',
  '/reports/calendar?year=2026&month=6',
  '/reports/volume-heatmap',
  '/reports/volume-heatmap?weeks=4',
  '/reports/volume-heatmap?weeks=52',
  '/reports/frequency?excludeExerciseIds=1,2,3',
  '/reports/frequency?excludeExerciseIds=',
  '/reports/summary?excludeExerciseIds=7',
  '/reports/health-trends',
  '/reports/health-trends?since=2026-01-01&until=2026-06-30',
  '/reports/exercise-1rm-history?exerciseId=5',
  '/reports/exercise-progression?name=Foo',
  '/reports/exercise-progression?exerciseId=5&excludeExerciseIds=1,2',
  '/reports/exercise-progression-batch?exerciseIds=1,2,3',
  '/reports/exercise-progression-batch',
  '/reports/benchmarks',
  '/reports/benchmarks?gender=female',
];

describe('bad query params are rejected with 400', () => {
  it.each(bad)('%s', async (url) => {
    const res = await get(url);
    expect(res.statusCode).toBe(400);
  });
});

describe('valid / omitted query params still return 200', () => {
  it.each(good)('%s', async (url) => {
    const res = await get(url);
    expect(res.statusCode).toBe(200);
  });
});
