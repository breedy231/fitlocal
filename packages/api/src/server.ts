import Fastify from 'fastify';
import cors from '@fastify/cors';
import { workoutRoutes } from './routes/workouts.js';
import { exerciseRoutes } from './routes/exercises.js';
import { setRoutes } from './routes/sets.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/import.js';
import { generateRoutes } from './routes/generate.js';
import { recoveryRoutes } from './routes/recovery.js';
import { stretchRoutes } from './routes/stretches.js';
import { reportRoutes } from './routes/reports.js';

// Run migrations on startup
await import('./migrate.js');

const app = Fastify({ logger: true });

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

await app.register(workoutRoutes);
await app.register(exerciseRoutes);
await app.register(setRoutes);
await app.register(healthRoutes);
await app.register(importRoutes);
await app.register(generateRoutes);
await app.register(recoveryRoutes);
await app.register(stretchRoutes);
await app.register(reportRoutes);

app.get('/health', async () => ({ status: 'ok' }));

try {
  await app.listen({ port: 3001, host: '0.0.0.0' });
  console.log('FitLocal API running on http://localhost:3001');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
