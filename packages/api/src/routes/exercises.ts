import { FastifyInstance } from 'fastify';
import { eq, like } from 'drizzle-orm';
import { db, schema } from '../db.js';

export async function exerciseRoutes(app: FastifyInstance) {
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

  app.delete<{ Params: { id: string } }>('/exercises/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    db.delete(schema.exercises).where(eq(schema.exercises.id, id)).run();
    return reply.status(204).send();
  });
}
