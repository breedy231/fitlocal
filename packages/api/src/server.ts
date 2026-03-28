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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3001;

// Run migrations on startup
await import('./migrate.js');

const app = Fastify({ logger: true, bodyLimit: 500 * 1024 * 1024 }); // 500MB for health exports

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

app.get(`${apiPrefix}/health`, async () => ({ status: 'ok' }));

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
