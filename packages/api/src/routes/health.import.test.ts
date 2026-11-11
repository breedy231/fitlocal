// POST /health/import-apple reports expected metrics that went quiet (#90).
// Schema comes from migrate.ts on a temp DB. Values are made up.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-health-import-${randomUUID()}.db`);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlocal-hk-route-'));
let app: FastifyInstance;

function rec(type: string, unit: string, date: string, value: number) {
  const d = `${date} 12:00:00 -0600`;
  return ` <Record type="HKQuantityTypeIdentifier${type}" sourceName="Test" unit="${unit}" creationDate="${d}" startDate="${d}" endDate="${d}" value="${value}"/>`;
}

function zipOf(records: string[]): Buffer {
  const dir = path.join(WORK, randomUUID());
  fs.mkdirSync(path.join(dir, 'apple_health_export'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'apple_health_export', 'export.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_US">\n${records.join('\n')}\n</HealthData>\n`,
  );
  execSync('zip -q -r export.zip apple_health_export', { cwd: dir });
  return fs.readFileSync(path.join(dir, 'export.zip'));
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TMP_DB;
  await import('../migrate.js');
  await import('../db.js');
  const { healthRoutes } = await import('./health.js');
  app = Fastify();
  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  await app.register(healthRoutes);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  fs.rmSync(WORK, { recursive: true, force: true });
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

describe('POST /health/import-apple', () => {
  it('lists metrics with no data in the last 14 days of the export', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/health/import-apple',
      headers: { 'content-type': 'application/zip' },
      payload: zipOf([
        rec('BodyMass', 'lb', '2026-06-24', 200),
        rec('DietaryEnergyConsumed', 'kcal', '2026-06-24', 2000),
        rec('StepCount', 'count', '2026-11-09', 5000),
        rec('HeartRateVariabilitySDNN', 'ms', '2026-11-09', 40),
        rec('RestingHeartRate', 'count/min', '2026-11-09', 55),
        rec('DietaryProtein', 'g', '2026-11-10', 100),
      ]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.missingMetrics.map((m: { metric: string }) => m.metric)).toEqual(['bodyWeight', 'calories', 'sleep']);
    expect(body.missingMetrics[0]).toEqual({
      metric: 'bodyWeight', latestDate: '2026-06-24', windowStart: '2026-10-28', windowEnd: '2026-11-10',
    });
  });
});
