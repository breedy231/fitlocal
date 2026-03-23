import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { computeMuscleRecovery } from '../lib/recovery.js';

const MUSCLE_GROUPS = [
  'chest', 'shoulders', 'triceps', 'back', 'biceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'core',
];

export async function recoveryRoutes(app: FastifyInstance) {
  app.get('/recovery-summary', async () => {
    const muscles = MUSCLE_GROUPS.map(name => ({
      name,
      recoveryPct: Math.round(computeMuscleRecovery(name, db) * 100),
    }));
    return { muscles };
  });
}
