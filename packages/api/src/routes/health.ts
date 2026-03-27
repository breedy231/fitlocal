import { FastifyInstance } from 'fastify';
import { db, schema } from '../db.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health-snapshots', async () => {
    return db.select().from(schema.healthSnapshots).orderBy(schema.healthSnapshots.date);
  });

  app.post<{
    Body: {
      date: string;
      restingHr?: number;
      hrv?: number;
      sleepHours?: number;
      calories?: number;
      proteinG?: number;
      steps?: number;
      bodyWeightKg?: number;
    };
  }>('/health-snapshots', async (req, reply) => {
    const result = db.insert(schema.healthSnapshots).values(req.body).returning().get();
    return reply.status(201).send(result);
  });

  // iOS Shortcut sync endpoint
  app.post<{
    Body: {
      hrv?: number;
      restingHr?: number;
      sleepHours?: number;
      steps?: number;
      bodyWeightKg?: number;
    };
  }>('/health/sync', async (req, reply) => {
    const _d = new Date();
    const date = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
    const { hrv, restingHr, sleepHours, steps, bodyWeightKg } = req.body;
    const result = db
      .insert(schema.healthSnapshots)
      .values({ date, hrv, restingHr, sleepHours, steps, bodyWeightKg })
      .returning()
      .get();
    return reply.status(201).send(result);
  });
}
