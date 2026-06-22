import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { parseHealthExportZip } from '../lib/health-xml-parser.js';
import { lbsToKg } from 'fitlocal-shared';

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
      bodyWeightLbs?: number;
      calories?: number;
      proteinG?: number;
    };
  }>('/health/sync', async (req, reply) => {
    const _d = new Date();
    const date = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
    const raw = req.body;
    // Treat 0 as null for metrics where zero is meaningless
    const hrv = raw.hrv || null;
    const restingHr = raw.restingHr || null;
    const sleepHours = raw.sleepHours || null;
    const steps = raw.steps || null;
    // Accept weight in lbs or kg — store as kg
    const bodyWeightKg = raw.bodyWeightLbs
      ? Math.round(lbsToKg(raw.bodyWeightLbs) * 100) / 100
      : (raw.bodyWeightKg || null);
    const calories = raw.calories || null;
    const proteinG = raw.proteinG || null;

    const fields = { hrv, restingHr, sleepHours, steps, bodyWeightKg, calories, proteinG };
    const present = Object.entries(fields).filter(([, v]) => v != null).map(([k]) => k);
    const missing = Object.entries(fields).filter(([, v]) => v == null).map(([k]) => k);
    req.log.info({ date, present, missing, raw: req.body }, `health/sync for ${date} — fields: ${present.join(', ') || 'none'}`);

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
      req.log.info({ date, action: 'updated', result: updated[0] }, `health/sync updated existing row for ${date}`);
      return reply.status(200).send(updated[0]);
    }

    const result = db
      .insert(schema.healthSnapshots)
      .values({ date, hrv, restingHr, sleepHours, steps, bodyWeightKg, calories, proteinG })
      .returning()
      .get();
    req.log.info({ date, action: 'inserted', result }, `health/sync inserted new row for ${date}`);
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

    const dates = snapshots.map(s => s.date).sort();
    req.log.info({ count: snapshots.length, dateRange: `${dates[0]} → ${dates[dates.length - 1]}`, dates }, `health/sync-batch: ${snapshots.length} snapshots`);

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

    const inserted = results.filter(r => r.action === 'inserted').length;
    const updated = results.filter(r => r.action === 'updated').length;
    req.log.info({ inserted, updated }, `health/sync-batch done: ${inserted} inserted, ${updated} updated`);
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
    req.log.info({ type, sampleCount: samples.length }, `health/import-samples: ${samples.length} ${type} samples`);

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
          tx.run(sql`UPDATE health_snapshots SET ${sql.raw(column)} = ${value} WHERE date = ${date}`);
          updated++;
        } else {
          tx.run(sql`INSERT INTO health_snapshots (date, ${sql.raw(column)}) VALUES (${date}, ${value})`);
          inserted++;
        }
      }
      return { inserted, updated };
    });

    req.log.info({ type, ...results, daysAggregated: aggregated.size }, `health/import-samples done: ${results.inserted} inserted, ${results.updated} updated across ${aggregated.size} days`);
    return reply.status(200).send({
      type,
      samplesReceived: samples.length,
      daysAggregated: aggregated.size,
      ...results,
    });
  });

  // Import Apple Health export zip (Settings > Health > Export All Health Data)
  app.post('/health/import-apple', { bodyLimit: 500 * 1024 * 1024 }, async (req, reply) => {
    const zipBuffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body as string, 'binary');

    if (zipBuffer.length < 100) {
      return reply.status(400).send({ error: 'Invalid zip data' });
    }

    const { snapshots, stats } = await parseHealthExportZip(zipBuffer);

    if (snapshots.length === 0) {
      return reply.status(400).send({ error: 'No health records found in export' });
    }

    // Upsert all snapshots in a transaction
    const results = db.transaction((tx) => {
      let inserted = 0;
      let updated = 0;

      for (const s of snapshots) {
        const existing = tx.all<{ id: number }>(
          sql`SELECT id FROM health_snapshots WHERE date = ${s.date} LIMIT 1`
        );

        if (existing.length > 0) {
          tx.run(sql`UPDATE health_snapshots SET
            resting_hr = COALESCE(${s.restingHr}, resting_hr),
            hrv = COALESCE(${s.hrv}, hrv),
            sleep_hours = COALESCE(${s.sleepHours}, sleep_hours),
            steps = COALESCE(${s.steps}, steps),
            body_weight_kg = COALESCE(${s.bodyWeightKg}, body_weight_kg),
            calories = COALESCE(${s.calories}, calories),
            protein_g = COALESCE(${s.proteinG}, protein_g)
            WHERE date = ${s.date}`);
          updated++;
        } else {
          tx.run(sql`INSERT INTO health_snapshots (date, resting_hr, hrv, sleep_hours, steps, body_weight_kg, calories, protein_g)
            VALUES (${s.date}, ${s.restingHr}, ${s.hrv}, ${s.sleepHours},
                    ${s.steps}, ${s.bodyWeightKg}, ${s.calories}, ${s.proteinG})`);
          inserted++;
        }
      }

      return { inserted, updated };
    });

    const dateRange = `${snapshots[0].date} to ${snapshots[snapshots.length - 1].date}`;

    return reply.status(200).send({
      daysProcessed: snapshots.length,
      dateRange,
      ...results,
      sampleCounts: stats,
    });
  });
}
