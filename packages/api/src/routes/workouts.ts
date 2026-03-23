import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';

export async function workoutRoutes(app: FastifyInstance) {
  // List all workouts
  app.get('/workouts', async () => {
    return db.select().from(schema.workouts).orderBy(schema.workouts.date);
  });

  // Get single workout with exercises and sets
  app.get<{ Params: { id: string } }>('/workouts/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const workout = await db.select().from(schema.workouts).where(eq(schema.workouts.id, id)).get();
    if (!workout) return reply.status(404).send({ error: 'Not found' });

    const wExercises = await db
      .select()
      .from(schema.workoutExercises)
      .where(eq(schema.workoutExercises.workoutId, id))
      .orderBy(schema.workoutExercises.displayOrder);

    const result = await Promise.all(
      wExercises.map(async (we) => {
        const exercise = await db.select().from(schema.exercises).where(eq(schema.exercises.id, we.exerciseId)).get();
        const setsData = await db.select().from(schema.sets).where(eq(schema.sets.workoutExerciseId, we.id));
        return { ...we, exercise, sets: setsData };
      })
    );

    return { ...workout, exercises: result };
  });

  // Create workout
  app.post<{ Body: { date: string; locationProfile?: string; notes?: string } }>('/workouts', async (req, reply) => {
    const { date, locationProfile, notes } = req.body;
    const result = db.insert(schema.workouts).values({ date, locationProfile, notes }).returning().get();
    return reply.status(201).send(result);
  });

  // Update workout
  app.put<{ Params: { id: string }; Body: { date?: string; locationProfile?: string; notes?: string } }>(
    '/workouts/:id',
    async (req, reply) => {
      const id = parseInt(req.params.id);
      const result = db.update(schema.workouts).set(req.body).where(eq(schema.workouts.id, id)).returning().get();
      if (!result) return reply.status(404).send({ error: 'Not found' });
      return result;
    }
  );

  // Delete workout
  app.delete<{ Params: { id: string } }>('/workouts/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    db.delete(schema.workouts).where(eq(schema.workouts.id, id)).run();
    return reply.status(204).send();
  });

  // Create workout_exercise (link exercise to workout)
  app.post<{
    Body: { workoutId: number; exerciseId: number; displayOrder?: number };
  }>('/workout-exercises', async (req, reply) => {
    const { workoutId, exerciseId, displayOrder = 0 } = req.body;
    const result = db
      .insert(schema.workoutExercises)
      .values({ workoutId, exerciseId, displayOrder })
      .returning()
      .get();
    return reply.status(201).send(result);
  });
}
