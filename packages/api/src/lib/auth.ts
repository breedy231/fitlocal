import { timingSafeEqual } from 'crypto';
import type { FastifyInstance, RouteHandlerMethod } from 'fastify';

// Bearer-token auth for the API. The hook lives inside the one encapsulated
// plugin that owns every API route, so it runs for any request that *routes*
// to one of them, however the URL is spelled. The old root-level hook checked
// the raw `req.url` for an `/api/` prefix, but the router matches the
// percent-decoded path: `/%61pi/workouts` skipped the check yet still reached
// GET /api/workouts.

type RoutePlugin = (app: FastifyInstance) => Promise<void>;

export interface ApiOptions {
  /** '/api' in production, '' in dev. */
  prefix: string;
  /** Bearer token every API route requires. Unset = open (dev). */
  apiKey?: string;
  /** Handler for GET <prefix>/health, the one public API route. */
  health: RouteHandlerMethod;
  routes: RoutePlugin[];
}

// Constant-time compare against `Bearer <apiKey>`. timingSafeEqual throws on a
// length mismatch, so check length first: a wrong-length token is just a wrong
// token (this leaks the key's length, not its contents).
function isAuthorized(header: string | undefined, expected: Buffer): boolean {
  const actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function registerApi(
  app: FastifyInstance,
  { prefix, apiKey, health, routes }: ApiOptions
) {
  // Public on purpose: Fly's HTTP health check (fly.toml) polls it without a
  // token. Registered outside the authenticated scope below.
  app.get(`${prefix}/health`, health);

  // Encapsulated: the hook covers every route registered in here (including
  // Fastify's auto-generated HEAD routes) and nothing outside it.
  async function authenticatedScope(api: FastifyInstance) {
    if (apiKey) {
      const expected = Buffer.from(`Bearer ${apiKey}`);
      api.addHook('onRequest', (req, reply, done) => {
        if (isAuthorized(req.headers.authorization, expected)) {
          done();
          return;
        }
        reply.code(401).send({ error: 'Unauthorized' });
      });
    }
    for (const plugin of routes) {
      await api.register(plugin);
    }
  }

  await app.register(authenticatedScope, { prefix });
}
