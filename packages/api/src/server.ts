import Fastify from 'fastify';
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
import { sqlite } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3001;

// Run migrations on startup
await import('./migrate.js');

const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 }); // 10MB default

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

// Bearer token auth — only enforced when FITLOCAL_API_KEY is set (dev works without it)
const apiKey = process.env.FITLOCAL_API_KEY;
if (apiKey) {
  app.addHook('onRequest', (req, reply, done) => {
    // Skip auth for static assets and the health check endpoint
    if (!req.url.startsWith('/api/') && req.url !== '/api') {
      done();
      return;
    }
    if (req.url === '/api/health') {
      done();
      return;
    }
    const auth = req.headers['authorization'];
    if (auth === `Bearer ${apiKey}`) {
      done();
      return;
    }
    reply.code(401).send({ error: 'Unauthorized' });
  });
}

// In production, mount API routes under /api prefix
const apiPrefix = isProduction ? '/api' : '';

await app.register(workoutRoutes, { prefix: apiPrefix });
await app.register(exerciseRoutes, { prefix: apiPrefix });
await app.register(setRoutes, { prefix: apiPrefix });
await app.register(healthRoutes, { prefix: apiPrefix });
await app.register(importRoutes, { prefix: apiPrefix });
await app.register(generateRoutes, { prefix: apiPrefix });
await app.register(recoveryRoutes, { prefix: apiPrefix });
await app.register(stretchRoutes, { prefix: apiPrefix });
await app.register(reportRoutes, { prefix: apiPrefix });
await app.register(programRoutes, { prefix: apiPrefix });
await app.register(challengeRoutes, { prefix: apiPrefix });
await app.register(achievementRoutes, { prefix: apiPrefix });
await app.register(goalRoutes, { prefix: apiPrefix });
await app.register(routineRoutes, { prefix: apiPrefix });
await app.register(equipmentProfileRoutes, { prefix: apiPrefix });

app.get(`${apiPrefix}/health`, async () => ({ status: 'ok' }));

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
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutdown: starting graceful stop');
  try {
    await app.close();
  } catch (err) {
    app.log.error({ err }, 'shutdown: fastify close failed');
  }
  try {
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
