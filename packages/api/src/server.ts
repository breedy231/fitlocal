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
  await app.register(fastifyStatic, {
    root: webBuildPath,
    wildcard: false,
  });

  // SPA fallback — serve index.html for unmatched routes
  app.setNotFoundHandler((_req, reply) => {
    return reply.sendFile('index.html');
  });
}

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`FitLocal ${isProduction ? '(production)' : '(dev)'} running on http://localhost:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
