import Fastify, { type RouteHandlerMethod } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import path from 'path';
import { workoutRoutes } from './routes/workouts.js';
import { exerciseRoutes } from './routes/exercises.js';
import { setRoutes } from './routes/sets.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/import.js';
import { generateRoutes } from './routes/generate.js';
import { recoveryRoutes } from './routes/recovery.js';
import { stretchRoutes } from './routes/stretches.js';
import { reportRoutes } from './routes/reports.js';
import { programRoutes } from './routes/programs.js';
import { challengeRoutes } from './routes/challenges.js';
import { achievementRoutes } from './routes/achievements.js';
import { goalRoutes } from './routes/goals.js';
import { routineRoutes } from './routes/routines.js';
import { equipmentProfileRoutes } from './routes/equipment-profiles.js';
import { assistantRoutes } from './routes/assistant.js';
import { hrRoutes } from './routes/hr.js';
import { workoutSessionRoutes } from './routes/workout-sessions.js';
import { pushRoutes } from './routes/push.js';
import { applyErrorHandler } from './lib/http.js';
import { registerApi } from './lib/auth.js';
import { sqlite } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3001;

// Run migrations on startup
await import('./migrate.js');

const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 }); // 10MB default

applyErrorHandler(app); // consistent 400/409/500 shapes (#82)

await app.register(cors, {
  origin: true, // allow all origins for local network use
});

// Parse plain text bodies for CSV import
app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => {
  done(null, body);
});

app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
  done(null, body);
});

// Accept raw binary for PDF uploads
app.addContentTypeParser('application/pdf', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});
app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});

// In production, mount API routes under /api prefix
const apiPrefix = isProduction ? '/api' : '';

// Bearer token auth — only enforced in production when FITLOCAL_API_KEY is set.
// Dev mounts routes without the /api prefix and has never required a key (the
// dev web app may not send one), so it stays open even if .env sets one.
const apiKey = isProduction ? process.env.FITLOCAL_API_KEY : undefined;

// Health check (Fly's http_service check in fly.toml polls this). It must prove
// the DB is usable, not just that Node is up: a cheap read of a core table fails
// on a missing schema, the wrong file, or an unreadable DB, and returns 503 so
// Fly marks the machine unhealthy instead of serving from a broken database.
const healthCheck: RouteHandlerMethod = async (_req, reply) => {
  try {
    sqlite.prepare('SELECT 1 FROM workouts LIMIT 1').get();
    return { status: 'ok' };
  } catch (err) {
    app.log.error({ err }, 'health: database check failed');
    return reply.code(503).send({ status: 'error', error: 'database unavailable' });
  }
};

// Every API route goes inside registerApi's authenticated scope; /health is
// the only public one. Don't register data routes on `app` directly.
await registerApi(app, {
  prefix: apiPrefix,
  apiKey,
  health: healthCheck,
  routes: [
    workoutRoutes,
    exerciseRoutes,
    setRoutes,
    healthRoutes,
    importRoutes,
    generateRoutes,
    recoveryRoutes,
    stretchRoutes,
    reportRoutes,
    programRoutes,
    challengeRoutes,
    achievementRoutes,
    goalRoutes,
    routineRoutes,
    equipmentProfileRoutes,
    assistantRoutes,
    hrRoutes,
    workoutSessionRoutes,
    pushRoutes,
  ],
});

// Cache-Control headers for GET responses
app.addHook('onSend', (_request, reply, _payload, done) => {
  if (_request.method !== 'GET') { done(); return; }

  const url = _request.url.replace(/^\/api/, ''); // normalize path

  if (url.startsWith('/exercises') && !url.includes('search')) {
    reply.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  } else if (url.startsWith('/stretches')) {
    reply.header('Cache-Control', 'public, max-age=3600');
  } else if (url.startsWith('/reports/')) {
    reply.header('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
  } else if (url.startsWith('/recovery-summary')) {
    reply.header('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
  } else if (url.startsWith('/programs/active')) {
    reply.header('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
  } else if (url.startsWith('/challenges')) {
    reply.header('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
  } else if (url.startsWith('/workouts')) {
    reply.header('Cache-Control', 'private, max-age=10, stale-while-revalidate=60');
  } else if (url.startsWith('/goals')) {
    reply.header('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
  } else if (url.startsWith('/routines')) {
    reply.header('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
  } else if (url.startsWith('/generate-workout')) {
    reply.header('Cache-Control', 'no-cache');
  }

  done();
});

// In production, serve the SvelteKit static build
if (isProduction) {
  const webBuildPath = path.resolve(__dirname, '../../web/build');
  // wildcard: true (default) serves files from disk dynamically — new files from
  // a rebuild are picked up without restarting the server. wildcard: false caches
  // the file list at startup, which forced a kickstart after every web rebuild.
  await app.register(fastifyStatic, {
    root: webBuildPath,
  });

  // SPA fallback — serve index.html for unmatched non-API routes. API routes
  // that don't exist should return a proper JSON 404, not the HTML shell.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
}

// Graceful shutdown: checkpoint the WAL into the main DB file before exiting.
// Prevents data loss if the next startup encounters corruption — writes that
// live only in the WAL are merged to disk while the server still holds the
// lock, so recovery tools operate on a complete main file, not a half-applied WAL.
//
// The checkpoint must never block. In production Litestream is PID 1 and holds
// a read lock on the WAL, so TRUNCATE can't complete; under better-sqlite3's
// default 5s busy timeout it sat blocked for the whole of Fly's kill window,
// leaving Litestream no time for its final sync to R2. With a short busy timeout
// SQLite waits briefly, then falls back to a PASSIVE checkpoint (backfills every
// frame it can, reports busy=1). Locally nothing else holds the lock, so it still
// truncates the WAL immediately.
const SHUTDOWN_CHECKPOINT_BUSY_MS = 100;
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutdown: starting graceful stop');
  // Bound app.close(): Fastify waits for in-flight requests, and an assistant SSE
  // stream (routes/assistant.ts) can stay open for tens of seconds. In production
  // Litestream only runs its final WAL sync to R2 after node exits, and Fly's
  // kill_timeout caps the whole stop — a long chat must not eat that window.
  const CLOSE_TIMEOUT_MS = 5_000;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = await Promise.race([
      app.close().then(() => false),
      new Promise<boolean>((resolve) => {
        closeTimer = setTimeout(() => resolve(true), CLOSE_TIMEOUT_MS);
      }),
    ]);
    if (timedOut) {
      app.log.warn(
        { timeoutMs: CLOSE_TIMEOUT_MS },
        'shutdown: fastify close timed out with requests still in flight; continuing'
      );
    }
  } catch (err) {
    app.log.error({ err }, 'shutdown: fastify close failed');
  } finally {
    clearTimeout(closeTimer);
  }
  try {
    sqlite.pragma(`busy_timeout = ${SHUTDOWN_CHECKPOINT_BUSY_MS}`);
    const result = sqlite.pragma('wal_checkpoint(TRUNCATE)');
    app.log.info({ result }, 'shutdown: WAL checkpoint complete');
    sqlite.close();
  } catch (err) {
    app.log.error({ err }, 'shutdown: WAL checkpoint failed');
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`FitLocal ${isProduction ? '(production)' : '(dev)'} running on http://localhost:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
