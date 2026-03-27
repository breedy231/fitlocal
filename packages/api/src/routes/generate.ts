import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db.js';
import { generateWorkout } from '../lib/generator.js';
import { getMFPNutrition } from '../lib/mfp.js';
import { getMusclesForExercise } from '../lib/recovery.js';

const DAY_TYPE_MUSCLES: Record<string, string[]> = {
  upper: ['chest', 'shoulders', 'triceps', 'back', 'biceps'],
  lower: ['quads', 'hamstrings', 'glutes', 'calves'],
  fullbody: ['chest', 'shoulders', 'triceps', 'back', 'biceps', 'quads', 'hamstrings', 'glutes', 'calves'],
};

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

  // Replace a single exercise with an alternative of the same muscle group
  app.get<{
    Querystring: { exerciseId: string; dayType?: string; equipment?: string; excludeIds?: string };
  }>('/generate-workout/replace', async (req, reply) => {
    const exerciseId = parseInt(req.query.exerciseId);
    const equipment = req.query.equipment || 'full';
    const excludeIds = (req.query.excludeIds || '')
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n));

    if (!exerciseId) {
      return reply.status(400).send({ error: 'exerciseId is required' });
    }

    // Get the exercise to replace and its muscles
    const original = db.all<{ id: number; name: string }>(
      sql`SELECT id, name FROM exercises WHERE id = ${exerciseId}`
    );
    if (original.length === 0) {
      return reply.status(404).send({ error: 'Exercise not found' });
    }

    let targetMuscles = getMusclesForExercise(original[0].name);

    // Fall back to day type muscles if we can't determine muscles from exercise name
    const dayType = req.query.dayType || 'fullbody';
    if (targetMuscles.length === 0) {
      targetMuscles = DAY_TYPE_MUSCLES[dayType] || DAY_TYPE_MUSCLES.fullbody;
    }

    // Get all exercises and find alternatives with overlapping muscles
    const allExercises = db.all<{ id: number; name: string; rest_seconds: number | null }>(
      sql`SELECT id, name, rest_seconds FROM exercises`
    );

    const excludeSet = new Set([exerciseId, ...excludeIds]);
    const TRAVEL_KEYWORDS = /dumbbell|bodyweight|band|trx|cardio/i;

    let candidates = allExercises.filter(e => {
      if (excludeSet.has(e.id)) return false;
      const muscles = getMusclesForExercise(e.name);
      return muscles.some(m => targetMuscles.includes(m));
    });

    if (equipment === 'travel') {
      candidates = candidates.filter(e => TRAVEL_KEYWORDS.test(e.name));
    }

    // If no muscle-matched candidates, fall back to any exercise not in exclude list
    if (candidates.length === 0) {
      candidates = allExercises.filter(e => {
        if (excludeSet.has(e.id)) return false;
        if (equipment === 'travel' && !TRAVEL_KEYWORDS.test(e.name)) return false;
        return true;
      });
    }

    if (candidates.length === 0) {
      return reply.status(404).send({ error: 'No alternative exercises found' });
    }

    // Enrich candidates with last-performed info and set suggestions
    const now = Date.now();
    const enriched = candidates.map(e => {
      const lastPerformed = db.all<{ date: string }>(sql`
        SELECT w.date FROM workouts w
        JOIN workout_exercises we ON we.workout_id = w.id
        WHERE we.exercise_id = ${e.id}
        ORDER BY w.date DESC
        LIMIT 1
      `);
      let daysSince = 999;
      if (lastPerformed.length > 0) {
        daysSince = (now - new Date(lastPerformed[0].date).getTime()) / (1000 * 60 * 60 * 24);
      }

      const lastSet = db.all<{ reps: number | null; weight_kg: number | null }>(sql`
        SELECT s.reps, s.weight_kg FROM sets s
        JOIN workout_exercises we ON s.workout_exercise_id = we.id
        JOIN workouts w ON we.workout_id = w.id
        WHERE we.exercise_id = ${e.id} AND s.is_warmup = 0
        ORDER BY w.date DESC, s.id DESC
        LIMIT 1
      `);

      const suggestedReps = lastSet.length > 0 ? (lastSet[0].reps ?? 10) : 10;
      const suggestedWeightKg = lastSet.length > 0 ? (lastSet[0].weight_kg ?? 0) : 0;

      return {
        id: e.id,
        name: e.name,
        suggestedSets: 3,
        suggestedReps,
        suggestedWeightKg: Math.round(suggestedWeightKg * 100) / 100,
        lastPerformedDaysAgo: Math.round(daysSince * 10) / 10,
        isFocus: false,
        isCardio: false,
        restSeconds: e.rest_seconds ?? 60,
        _daysSince: daysSince,
      };
    });

    // Sort: most recently performed first, then alphabetically
    enriched.sort((a, b) => {
      if (a._daysSince !== b._daysSince) return a._daysSince - b._daysSince;
      return a.name.localeCompare(b.name);
    });

    const alternatives = enriched.slice(0, 12).map(({ _daysSince, ...rest }) => rest);

    return { alternatives };
  });
}
