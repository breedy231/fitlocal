import { FastifyInstance } from 'fastify';
import { getStretchesForMuscles } from '../lib/stretches.js';

export async function stretchRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { muscleGroups?: string } }>('/stretches', async (req, reply) => {
    const { muscleGroups } = req.query;
    if (!muscleGroups) {
      return reply.status(400).send({ error: 'muscleGroups query param required (comma-separated)' });
    }
    const groups = muscleGroups.split(',').map(g => g.trim()).filter(Boolean);
    return getStretchesForMuscles(groups);
  });
}
