import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { generateWorkout } from '../lib/generator.js';

export async function generateRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { dayType: string; equipment?: string } }>(
    '/generate-workout',
    async (req, reply) => {
      const { dayType, equipment = 'full' } = req.query;
      if (!dayType) {
        return reply.status(400).send({ error: 'dayType query param required (push, pull, or legs)' });
      }
      try {
        const workout = generateWorkout(dayType, equipment, db);
        return workout;
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );
}
