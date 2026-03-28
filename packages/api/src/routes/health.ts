import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
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

  // iOS Shortcut / HealthKit sync endpoint (idempotent — upserts by today's date)
  app.post<{
    Body: {
      hrv?: number;
      restingHr?: number;
      sleepHours?: number;
      steps?: number;
      bodyWeightKg?: number;
      calories?: number;
      proteinG?: number;
    };
  }>('/health/sync', async (req, reply) => {
    const _d = new Date();
    const date = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
    const { hrv, restingHr, sleepHours, steps, bodyWeightKg, calories, proteinG } = req.body;

    const existing = db.all<{ id: number }>(
      sql`SELECT id FROM health_snapshots WHERE date = ${date} LIMIT 1`
    );

    if (existing.length > 0) {
      db.run(sql`UPDATE health_snapshots SET
        resting_hr = COALESCE(${restingHr ?? null}, resting_hr),
        hrv = COALESCE(${hrv ?? null}, hrv),
        sleep_hours = COALESCE(${sleepHours ?? null}, sleep_hours),
        steps = COALESCE(${steps ?? null}, steps),
        body_weight_kg = COALESCE(${bodyWeightKg ?? null}, body_weight_kg),
        calories = COALESCE(${calories ?? null}, calories),
        protein_g = COALESCE(${proteinG ?? null}, protein_g)
        WHERE date = ${date}`);
      const updated = db.all<Record<string, unknown>>(
        sql`SELECT * FROM health_snapshots WHERE date = ${date} LIMIT 1`
      );
      return reply.status(200).send(updated[0]);
    }

    const result = db
      .insert(schema.healthSnapshots)
      .values({ date, hrv, restingHr, sleepHours, steps, bodyWeightKg, calories, proteinG })
      .returning()
      .get();
    return reply.status(201).send(result);
  });

  // Batch sync — upsert multiple days of HealthKit data at once
  app.post<{
    Body: {
      snapshots: Array<{
        date: string;
        hrv?: number;
        restingHr?: number;
        sleepHours?: number;
        steps?: number;
        bodyWeightKg?: number;
        calories?: number;
        proteinG?: number;
      }>;
    };
  }>('/health/sync-batch', async (req, reply) => {
    const { snapshots } = req.body;
    if (!snapshots || !Array.isArray(snapshots) || snapshots.length === 0) {
      return reply.status(400).send({ error: 'snapshots must be a non-empty array' });
    }

    const results = db.transaction((tx) => {
      return snapshots.map((s) => {
        const existing = tx.all<{ id: number }>(
          sql`SELECT id FROM health_snapshots WHERE date = ${s.date} LIMIT 1`
        );

        if (existing.length > 0) {
          tx.run(sql`UPDATE health_snapshots SET
            resting_hr = COALESCE(${s.restingHr ?? null}, resting_hr),
            hrv = COALESCE(${s.hrv ?? null}, hrv),
            sleep_hours = COALESCE(${s.sleepHours ?? null}, sleep_hours),
            steps = COALESCE(${s.steps ?? null}, steps),
            body_weight_kg = COALESCE(${s.bodyWeightKg ?? null}, body_weight_kg),
            calories = COALESCE(${s.calories ?? null}, calories),
            protein_g = COALESCE(${s.proteinG ?? null}, protein_g)
            WHERE date = ${s.date}`);
          return { date: s.date, action: 'updated' };
        } else {
          tx.run(sql`INSERT INTO health_snapshots (date, resting_hr, hrv, sleep_hours, steps, body_weight_kg, calories, protein_g)
            VALUES (${s.date}, ${s.restingHr ?? null}, ${s.hrv ?? null}, ${s.sleepHours ?? null},
                    ${s.steps ?? null}, ${s.bodyWeightKg ?? null}, ${s.calories ?? null}, ${s.proteinG ?? null})`);
          return { date: s.date, action: 'inserted' };
        }
      });
    });

    return reply.status(200).send({ synced: results });
  });
}
