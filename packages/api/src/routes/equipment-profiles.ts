import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';

export async function equipmentProfileRoutes(app: FastifyInstance) {
  // List all profiles
  app.get('/equipment-profiles', async () => {
    return db.select().from(schema.equipmentProfiles).orderBy(schema.equipmentProfiles.id);
  });

  // Get single profile
  app.get<{ Params: { id: string } }>('/equipment-profiles/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const result = db.select().from(schema.equipmentProfiles).where(eq(schema.equipmentProfiles.id, id)).get();
    if (!result) return reply.status(404).send({ error: 'Not found' });
    return result;
  });

  // Create profile
  app.post<{ Body: { name: string; availableEquipment: string[] } }>('/equipment-profiles', async (req, reply) => {
    const result = db.insert(schema.equipmentProfiles).values(req.body).returning().get();
    return reply.status(201).send(result);
  });

  // Update profile
  app.put<{ Params: { id: string }; Body: { name?: string; availableEquipment?: string[] } }>('/equipment-profiles/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const result = db.update(schema.equipmentProfiles).set(req.body).where(eq(schema.equipmentProfiles.id, id)).returning().get();
    if (!result) return reply.status(404).send({ error: 'Not found' });
    return result;
  });

  // Delete profile (block deleting the last one)
  app.delete<{ Params: { id: string } }>('/equipment-profiles/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const count = db.select().from(schema.equipmentProfiles).all().length;
    if (count <= 1) return reply.status(400).send({ error: 'Cannot delete the last profile' });
    db.delete(schema.equipmentProfiles).where(eq(schema.equipmentProfiles.id, id)).run();
    return reply.status(204).send();
  });
}
