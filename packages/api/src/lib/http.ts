import type { FastifyError, FastifyInstance } from 'fastify';

// Consistent error shapes across the API (#82). Registered in server.ts and in
// hermetic route tests (so error-shape assertions run against the real handler).
//   - AJV validation failures → 400 { error, details }
//   - SQLite constraint violations (FK, UNIQUE, NOT NULL…) → 409 { error }
//   - other errors that already carry a 4xx status keep it (body-parse, 404s…)
//   - everything else → opaque 500; full detail goes to the log, not the client
export function applyErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.validation) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: err.validation.map((v) => `${v.instancePath || 'body'} ${v.message ?? 'invalid'}`),
      });
    }
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
      req.log.warn({ msg: err.message }, 'constraint violation');
      return reply.status(409).send({ error: 'Constraint violation' });
    }
    if (err.statusCode !== undefined && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    // Drizzle throws this when an update body strips down to {} (AJV's
    // removeAdditional runs after minProperties, so a body of only unknown
    // keys passes validation empty). Client error, not a server fault.
    if (err.message === 'No values to set') {
      return reply.status(400).send({
        error: 'Validation failed',
        details: ['body must have at least 1 known property'],
      });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'Internal server error' });
  });
}

// Params schema for the ubiquitous numeric `:id` — rejects non-numeric ids at
// the door so handlers' parseInt() can't yield NaN. Kept as a string pattern
// (not type: integer) so the existing `Params: { id: string }` generics and
// parseInt() call sites stay untouched.
export const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^\\d+$' } },
} as const;
