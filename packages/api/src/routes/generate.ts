import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { generateWorkout } from '../lib/generator.js';
import { getMFPNutrition } from '../lib/mfp.js';

const DAY_TYPE_ALIASES: Record<string, string> = {
  push: 'upper',
  pull: 'upper',
  legs: 'lower',
};

export async function generateRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { dayType: string; equipment?: string } }>(
    '/generate-workout',
    async (req, reply) => {
      let { dayType, equipment = 'full' } = req.query;
      if (!dayType) {
        return reply.status(400).send({ error: 'dayType query param required (upper, lower, or fullbody)' });
      }
      // Map legacy day types
      dayType = DAY_TYPE_ALIASES[dayType] ?? dayType;
      try {
        const workout = generateWorkout(dayType, equipment, db);

        // MFP integration: reduce volume if in caloric deficit
        const mfpUser = process.env.MFP_USERNAME;
        const mfpCookie = process.env.MFP_SESSION_COOKIE;
        if (mfpUser && mfpCookie) {
          const nutrition = await getMFPNutrition(mfpUser, mfpCookie);
          if (nutrition && nutrition.calories > 0) {
            // Assume ~2200 maintenance; if deficit > 300, reduce sets
            const deficit = 2200 - nutrition.calories;
            if (deficit > 300) {
              for (const ex of workout.exercises) {
                ex.suggestedSets = Math.max(2, Math.round(ex.suggestedSets * 0.9));
              }
            }
          }
        }

        return workout;
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );
}
