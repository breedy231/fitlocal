import { FastifyInstance } from 'fastify';
import { eq, like, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { computeProgression } from '../lib/progression.js';

export async function exerciseRoutes(app: FastifyInstance) {
  // Last performance for a single exercise (used when swapping exercises mid-workout)
  app.get<{ Params: { id: string }; Querystring: { excludeWorkoutId?: string } }>(
    '/exercises/:id/last-performance',
    async (req) => {
      const exerciseId = parseInt(req.params.id);
      const excludeId = req.query.excludeWorkoutId ? parseInt(req.query.excludeWorkoutId) : 0;
      const rows = db.all<{ reps: number; weight_kg: number; workout_date: string }>(sql`
        SELECT s.reps, s.weight_kg, w.date as workout_date
        FROM sets s
        JOIN workout_exercises we ON s.workout_exercise_id = we.id
        JOIN workouts w ON we.workout_id = w.id
        WHERE we.exercise_id = ${exerciseId}
          AND w.id != ${excludeId}
          AND s.is_warmup = 0
          AND s.reps > 0
        ORDER BY w.date DESC, s.id ASC
      `);
      if (rows.length === 0) return { sets: [] };
      const date = rows[0].workout_date;
      return {
        date,
        sets: rows.filter(r => r.workout_date === date).map(r => ({ reps: r.reps, weightKg: r.weight_kg })),
      };
    }
  );
  app.get('/exercises', async () => {
    return db.select().from(schema.exercises).orderBy(schema.exercises.name);
  });

  // Search exercises by name
  app.get<{ Querystring: { q?: string } }>('/exercises/search', async (req) => {
    const q = req.query.q?.trim();
    if (!q) return [];
    return db
      .select()
      .from(schema.exercises)
      .where(like(schema.exercises.name, `%${q}%`))
      .orderBy(schema.exercises.name)
      .limit(20);
  });

  app.get<{ Params: { id: string } }>('/exercises/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const exercise = await db.select().from(schema.exercises).where(eq(schema.exercises.id, id)).get();
    if (!exercise) return reply.status(404).send({ error: 'Not found' });
    return exercise;
  });

  app.post<{
    Body: {
      name: string;
      primaryMuscles?: string[];
      secondaryMuscles?: string[];
      equipment?: string[];
      movementType?: string;
    };
  }>('/exercises', async (req, reply) => {
    const result = db.insert(schema.exercises).values(req.body).returning().get();
    return reply.status(201).send(result);
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/exercises/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const result = db.update(schema.exercises).set(req.body).where(eq(schema.exercises.id, id)).returning().get();
    if (!result) return reply.status(404).send({ error: 'Not found' });
    return result;
  });

  // Get progression/estimation for an exercise
  app.get<{ Params: { id: string } }>('/exercises/:id/progression', async (req, reply) => {
    const id = parseInt(req.params.id);
    const exercise = db.select().from(schema.exercises).where(eq(schema.exercises.id, id)).get();
    if (!exercise) return reply.status(404).send({ error: 'Not found' });
    return computeProgression(id, exercise.name, db);
  });

  app.delete<{ Params: { id: string } }>('/exercises/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    db.delete(schema.exercises).where(eq(schema.exercises.id, id)).run();
    return reply.status(204).send();
  });
}
