import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db.js';
import { generateWorkout } from '../lib/generator.js';
import { computeProgression } from '../lib/progression.js';
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
  app.get<{ Querystring: { dayType: string; equipment?: string; supersets?: string } }>(
    '/generate-workout',
    async (req, reply) => {
      let { dayType, equipment = 'full', supersets: supersetsParam } = req.query;
      if (!dayType) {
        return reply.status(400).send({ error: 'dayType query param required (upper, lower, or fullbody)' });
      }
      // Map legacy day types
      dayType = DAY_TYPE_ALIASES[dayType] ?? dayType;
      const supersets = supersetsParam !== 'false';
      try {
        const workout = generateWorkout(dayType, equipment, db, { supersets });

        // Nutrition integration: reduce volume if in caloric deficit
        // Reads from health_snapshots (synced via HealthKit or iOS Shortcut)
        const maintenance = Number(process.env.MAINTENANCE_CALORIES) || 2200;
        const today = new Date().toISOString().slice(0, 10);
        const snapshot = db.all<{ calories: number | null }>(
          sql`SELECT calories FROM health_snapshots WHERE date = ${today} LIMIT 1`
        );
        if (snapshot.length > 0 && snapshot[0].calories && snapshot[0].calories > 0) {
          const deficit = maintenance - snapshot[0].calories;
          if (deficit > 300) {
            for (const ex of workout.exercises) {
              ex.suggestedSets = Math.max(2, Math.round(ex.suggestedSets * 0.9));
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

    const originalName = original[0].name;
    const CARDIO_KEYWORDS = /treadmill|elliptical|cycling|rowing|stair|bike|run|jog|sprint|cardio/i;
    const isCardio = CARDIO_KEYWORDS.test(originalName);

    let targetMuscles = getMusclesForExercise(originalName);

    // Fall back to day type muscles if we can't determine muscles from exercise name
    const dayType = req.query.dayType || 'fullbody';
    if (targetMuscles.length === 0 && !isCardio) {
      targetMuscles = DAY_TYPE_MUSCLES[dayType] || DAY_TYPE_MUSCLES.fullbody;
    }

    // Get all exercises and find alternatives with overlapping muscles
    const allExercises = db.all<{ id: number; name: string; rest_seconds: number | null }>(
      sql`SELECT id, name, rest_seconds FROM exercises`
    );

    const excludeSet = new Set([exerciseId, ...excludeIds]);
    const TRAVEL_KEYWORDS = /dumbbell|bodyweight|band|trx|cardio/i;

    let candidates;

    if (isCardio) {
      // For cardio: only return other cardio exercises
      candidates = allExercises.filter(e => {
        if (excludeSet.has(e.id)) return false;
        return CARDIO_KEYWORDS.test(e.name);
      });
    } else {
      candidates = allExercises.filter(e => {
        if (excludeSet.has(e.id)) return false;
        const muscles = getMusclesForExercise(e.name);
        // Exclude cardio from strength swaps
        if (CARDIO_KEYWORDS.test(e.name)) return false;
        return muscles.some(m => targetMuscles.includes(m));
      });

      if (equipment === 'travel') {
        candidates = candidates.filter(e => TRAVEL_KEYWORDS.test(e.name));
      }
    }

    // If no muscle-matched candidates, fall back to any exercise not in exclude list
    if (candidates.length === 0) {
      candidates = allExercises.filter(e => {
        if (excludeSet.has(e.id)) return false;
        if (isCardio) return CARDIO_KEYWORDS.test(e.name);
        if (CARDIO_KEYWORDS.test(e.name)) return false;
        if (equipment === 'travel' && !TRAVEL_KEYWORDS.test(e.name)) return false;
        return true;
      });
    }

    if (candidates.length === 0) {
      return reply.status(404).send({ error: 'No alternative exercises found' });
    }

    // Enrich candidates with progression data and last-performed info
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

      const prog = computeProgression(e.id, e.name, db);

      return {
        id: e.id,
        name: e.name,
        suggestedSets: prog.sets,
        suggestedReps: prog.reps,
        suggestedWeightKg: prog.weightKg,
        lastPerformedDaysAgo: Math.round(daysSince * 10) / 10,
        isFocus: false,
        isCardio: false,
        restSeconds: e.rest_seconds ?? 60,
        progression: prog.directive,
        repRange: { min: prog.repRange.min, max: prog.repRange.max },
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
