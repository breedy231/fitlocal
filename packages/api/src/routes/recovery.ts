import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { computeAllMuscleRecoveries } from '../lib/recovery.js';

const MUSCLE_GROUPS = [
  'chest', 'shoulders', 'triceps', 'back', 'biceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'core',
];

export async function recoveryRoutes(app: FastifyInstance) {
  app.get('/recovery-summary', async () => {
    const recoveries = computeAllMuscleRecoveries(db);
    const muscles = MUSCLE_GROUPS.map(name => ({
      name,
      recoveryPct: Math.round((recoveries.get(name) ?? 1) * 100),
    }));
    return { muscles };
  });
}
