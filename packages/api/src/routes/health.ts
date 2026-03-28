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

  // Bulk import raw HealthKit samples — one metric type at a time.
  // The Shortcut dumps raw samples; the server aggregates by date.
  app.post<{
    Body: {
      type: 'hrv' | 'restingHr' | 'sleep' | 'steps' | 'bodyWeight' | 'calories';
      samples: Array<{ date: string; value: number }>;
    };
  }>('/health/import-samples', async (req, reply) => {
    const { type, samples } = req.body;
    if (!type || !samples || !Array.isArray(samples) || samples.length === 0) {
      return reply.status(400).send({ error: 'type and non-empty samples array required' });
    }

    const columnMap: Record<string, string> = {
      hrv: 'hrv',
      restingHr: 'resting_hr',
      sleep: 'sleep_hours',
      steps: 'steps',
      bodyWeight: 'body_weight_kg',
      calories: 'calories',
    };
    const column = columnMap[type];
    if (!column) {
      return reply.status(400).send({ error: `Unknown type: ${type}. Valid: ${Object.keys(columnMap).join(', ')}` });
    }

    // Aggregate by date: avg for hrv/restingHr, sum for steps/sleep/calories, latest for bodyWeight
    const byDate = new Map<string, number[]>();
    for (const s of samples) {
      if (!s.date || s.value == null || isNaN(s.value)) continue;
      const dateKey = s.date.slice(0, 10); // normalize to YYYY-MM-DD
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey)!.push(s.value);
    }

    const aggregated = new Map<string, number>();
    for (const [date, values] of byDate) {
      let agg: number;
      switch (type) {
        case 'steps':
        case 'sleep':
        case 'calories':
          agg = values.reduce((a, b) => a + b, 0);
          break;
        case 'bodyWeight':
          agg = values[values.length - 1]; // latest reading
          break;
        default: // hrv, restingHr — daily average
          agg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
          break;
      }
      aggregated.set(date, Math.round(agg * 100) / 100);
    }

    // Upsert all dates in a transaction
    const results = db.transaction((tx) => {
      let inserted = 0;
      let updated = 0;
      for (const [date, value] of aggregated) {
        const existing = tx.all<{ id: number }>(
          sql`SELECT id FROM health_snapshots WHERE date = ${date} LIMIT 1`
        );
        if (existing.length > 0) {
          tx.run(sql.raw(`UPDATE health_snapshots SET ${column} = ${value} WHERE date = '${date}'`));
          updated++;
        } else {
          tx.run(sql.raw(`INSERT INTO health_snapshots (date, ${column}) VALUES ('${date}', ${value})`));
          inserted++;
        }
      }
      return { inserted, updated };
    });

    return reply.status(200).send({
      type,
      samplesReceived: samples.length,
      daysAggregated: aggregated.size,
      ...results,
    });
  });
}
