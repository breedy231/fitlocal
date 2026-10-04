// Hermetic tests for API bearer auth. Builds a Fastify app with the same
// registerApi() wiring server.ts uses — stub route plugins (no DB) plus a real
// @fastify/static root — then probes it via inject. Regression target: the old
// hook checked the raw URL, so `/%61pi/workouts` skipped auth yet the router
// (which percent-decodes) still served GET /api/workouts.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { registerApi } from './auth.js';

const KEY = 'test-key-0123456789abcdef';
const GOOD = `Bearer ${KEY}`;

const STATIC_ROOT = path.join(os.tmpdir(), `fitlocal-auth-${randomUUID()}`);

// Ids the stub DELETE handler actually ran for — proves a 401 stopped the
// request before the handler, not after.
let deleted: string[] = [];

async function workoutRoutes(app: FastifyInstance) {
  app.get('/workouts', async () => [{ id: 1 }]);
  app.delete<{ Params: { id: string } }>('/workouts/:id', async (req, reply) => {
    deleted.push(req.params.id);
    return reply.code(204).send();
  });
}

// A /health/* data route: the public /health exemption must not cover it.
async function healthRoutes(app: FastifyInstance) {
  app.post('/health/sync', async () => ({ ok: true }));
}

async function buildApp(opts: { prefix: string; apiKey?: string }) {
  const app = Fastify();
  await registerApi(app, {
    ...opts,
    health: async () => ({ status: 'ok' }),
    routes: [workoutRoutes, healthRoutes],
  });
  await app.register(fastifyStatic, { root: STATIC_ROOT });
  await app.ready();
  return app;
}

beforeAll(() => {
  fs.mkdirSync(path.join(STATIC_ROOT, '_app'), { recursive: true });
  fs.writeFileSync(path.join(STATIC_ROOT, 'index.html'), '<!doctype html><title>FitLocal</title>');
  fs.writeFileSync(path.join(STATIC_ROOT, '_app', 'app.js'), 'console.log(1)');
});

afterAll(() => {
  fs.rmSync(STATIC_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  deleted = [];
});

describe('with FITLOCAL_API_KEY set (production wiring)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ prefix: '/api', apiKey: KEY });
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['GET', '/api/workouts'],
    ['GET', '/%61pi/workouts'],
    ['GET', '/api/%77orkouts'],
    ['GET', '/%61%70%69/%77%6f%72%6b%6f%75%74%73'],
    ['HEAD', '/%61pi/workouts'],
    ['DELETE', '/api/workouts/1'],
    ['DELETE', '/%61pi/workouts/1'],
    ['POST', '/api/health/sync'],
    ['POST', '/%61pi/health/sync'],
  ] as const)('%s %s without a token → 401', async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
    expect(deleted).toEqual([]);
  });

  it('serves the correct token, however the path is spelled', async () => {
    for (const url of ['/api/workouts', '/%61pi/workouts', '/api/%77orkouts']) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: GOOD } });
      expect(res.statusCode, url).toBe(200);
      expect(res.json()).toEqual([{ id: 1 }]);
    }
  });

  it('lets an authorized DELETE through to the handler', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/%61pi/workouts/7',
      headers: { authorization: GOOD },
    });
    expect(res.statusCode).toBe(204);
    expect(deleted).toEqual(['7']);
  });

  it('rejects a wrong token of the same length', async () => {
    const wrong = `Bearer ${'x'.repeat(KEY.length)}`;
    expect(wrong.length).toBe(GOOD.length);
    const res = await app.inject({
      method: 'GET',
      url: '/api/workouts',
      headers: { authorization: wrong },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects wrong-length and malformed tokens with 401, not a 500 from timingSafeEqual', async () => {
    for (const authorization of [`Bearer ${KEY}x`, 'Bearer x', '', KEY, `bearer ${KEY}`]) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/workouts',
        headers: { authorization },
      });
      expect(res.statusCode, JSON.stringify(authorization)).toBe(401);
    }
  });

  it('keeps /api/health public', async () => {
    for (const url of ['/api/health', '/%61pi/health']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    }
  });

  it('does not gate static SPA assets', async () => {
    for (const url of ['/', '/index.html', '/_app/app.js']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('leaves unmatched /api/* paths to the not-found handler', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
  });
});

describe('without FITLOCAL_API_KEY (dev behaviour)', () => {
  it('leaves every route open under the /api prefix', async () => {
    const app = await buildApp({ prefix: '/api' });
    try {
      for (const url of ['/api/workouts', '/%61pi/workouts', '/api/health']) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
      }
      const del = await app.inject({ method: 'DELETE', url: '/api/workouts/3' });
      expect(del.statusCode).toBe(204);
      expect(deleted).toEqual(['3']);
    } finally {
      await app.close();
    }
  });

  it('mounts routes unprefixed when prefix is empty (dev server)', async () => {
    const app = await buildApp({ prefix: '' });
    try {
      for (const url of ['/workouts', '/health']) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
      }
    } finally {
      await app.close();
    }
  });
});
