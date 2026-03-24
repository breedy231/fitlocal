import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';

export async function setRoutes(app: FastifyInstance) {
  // Add set to a workout exercise
  app.post<{
    Body: { workoutExerciseId: number; reps?: number; weightKg?: number; isWarmup?: boolean; rpe?: number };
  }>('/sets', async (req, reply) => {
    const result = db.insert(schema.sets).values(req.body).returning().get();
    return reply.status(201).send(result);
  });

  // Update set (PUT)
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/sets/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const result = db.update(schema.sets).set(req.body).where(eq(schema.sets.id, id)).returning().get();
    if (!result) return reply.status(404).send({ error: 'Not found' });
    return result;
  });

  // Update set (PATCH)
  app.patch<{ Params: { id: string }; Body: { reps?: number; weightKg?: number } }>('/sets/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const result = db.update(schema.sets).set(req.body).where(eq(schema.sets.id, id)).returning().get();
    if (!result) return reply.status(404).send({ error: 'Not found' });
    return result;
  });

  // Delete set
  app.delete<{ Params: { id: string } }>('/sets/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    db.delete(schema.sets).where(eq(schema.sets.id, id)).run();
    return reply.status(204).send();
  });
}
