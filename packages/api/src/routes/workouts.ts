import { FastifyInstance } from 'fastify';
import { eq, desc, like, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';

export async function workoutRoutes(app: FastifyInstance) {
  // List all workouts with exercise/set counts
  app.get<{ Querystring: { detail?: string; limit?: string; offset?: string; exerciseName?: string } }>('/workouts', async (req) => {
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const offset = parseInt(req.query.offset || '0');
    const exerciseNameFilter = req.query.exerciseName?.trim();

    let workoutIds: number[] | null = null;

    // If exerciseName filter is provided, find matching workout IDs
    if (exerciseNameFilter) {
      const matchingRows = db.all<{ workout_id: number }>(sql`
        SELECT DISTINCT we.workout_id
        FROM workout_exercises we
        JOIN exercises e ON we.exercise_id = e.id
        WHERE e.name LIKE ${'%' + exerciseNameFilter + '%'}
      `);
      workoutIds = matchingRows.map(r => r.workout_id);
      if (workoutIds.length === 0) return [];
    }

    let workouts;
    if (workoutIds) {
      workouts = await db.select().from(schema.workouts)
        .where(sql`${schema.workouts.id} IN (${sql.join(workoutIds.map(id => sql`${id}`), sql`, `)})`)
        .orderBy(desc(schema.workouts.date))
        .limit(limit)
        .offset(offset);
    } else {
      workouts = await db.select().from(schema.workouts)
        .orderBy(desc(schema.workouts.date))
        .limit(limit)
        .offset(offset);
    }

    const enriched = await Promise.all(
      workouts.map(async (w) => {
        const wExercises = await db
          .select()
          .from(schema.workoutExercises)
          .where(eq(schema.workoutExercises.workoutId, w.id));

        let setCount = 0;
        let exerciseNames: string[] = [];

        for (const we of wExercises) {
          const sets = await db.select().from(schema.sets).where(eq(schema.sets.workoutExerciseId, we.id));
          setCount += sets.length;
          if (req.query.detail === 'true') {
            const ex = await db.select().from(schema.exercises).where(eq(schema.exercises.id, we.exerciseId)).get();
            if (ex) exerciseNames.push(ex.name);
          }
        }

        return {
          ...w,
          exerciseCount: wExercises.length,
          setCount,
          ...(req.query.detail === 'true' ? { exerciseNames } : {}),
        };
      })
    );

    return enriched;
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
        return { ...we, exercise, sets: setsData, restSeconds: exercise?.restSeconds ?? 60 };
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

  // Update workout (PUT)
  app.put<{ Params: { id: string }; Body: { date?: string; locationProfile?: string; notes?: string } }>(
    '/workouts/:id',
    async (req, reply) => {
      const id = parseInt(req.params.id);
      const result = db.update(schema.workouts).set(req.body).where(eq(schema.workouts.id, id)).returning().get();
      if (!result) return reply.status(404).send({ error: 'Not found' });
      return result;
    }
  );

  // Update workout (PATCH)
  app.patch<{ Params: { id: string }; Body: { date?: string; locationProfile?: string; notes?: string } }>(
    '/workouts/:id',
    async (req, reply) => {
      const id = parseInt(req.params.id);
      const result = db.update(schema.workouts).set(req.body).where(eq(schema.workouts.id, id)).returning().get();
      if (!result) return reply.status(404).send({ error: 'Not found' });
      return result;
    }
  );

  // Add exercise to existing workout
  app.post<{ Params: { id: string }; Body: { exerciseId: number; displayOrder?: number; supersetGroup?: number | null } }>(
    '/workouts/:id/exercises',
    async (req, reply) => {
      const workoutId = parseInt(req.params.id);
      const { exerciseId, displayOrder = 0, supersetGroup } = req.body;
      const result = db
        .insert(schema.workoutExercises)
        .values({ workoutId, exerciseId, displayOrder, supersetGroup: supersetGroup ?? null })
        .returning()
        .get();
      return reply.status(201).send(result);
    }
  );

  // Bulk delete workouts
  app.delete<{ Body: { ids: number[] } }>('/workouts/bulk', async (req, reply) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids must be a non-empty array' });
    }
    db.transaction((tx) => {
      for (const id of ids) {
        tx.delete(schema.workouts).where(eq(schema.workouts.id, id)).run();
      }
    });
    return reply.status(204).send();
  });

  // Delete workout
  app.delete<{ Params: { id: string } }>('/workouts/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    db.delete(schema.workouts).where(eq(schema.workouts.id, id)).run();
    return reply.status(204).send();
  });

  // Create workout_exercise (link exercise to workout)
  app.post<{
    Body: { workoutId: number; exerciseId: number; displayOrder?: number; supersetGroup?: number | null };
  }>('/workout-exercises', async (req, reply) => {
    const { workoutId, exerciseId, displayOrder = 0, supersetGroup } = req.body;
    const result = db
      .insert(schema.workoutExercises)
      .values({ workoutId, exerciseId, displayOrder, supersetGroup: supersetGroup ?? null })
      .returning()
      .get();
    return reply.status(201).send(result);
  });

  // Export workouts for HealthKit writeback
  app.get<{ Querystring: { since?: string } }>('/workouts/export', async (req) => {
    const since = req.query.since || '1970-01-01';
    const rows = db.all<{
      date: string;
      set_count: number;
      total_reps: number;
      has_cardio: number;
    }>(sql`
      SELECT w.date,
        COUNT(s.id) as set_count,
        COALESCE(SUM(s.reps), 0) as total_reps,
        MAX(CASE WHEN lower(e.name) GLOB '*treadmill*' OR lower(e.name) GLOB '*elliptical*'
          OR lower(e.name) GLOB '*cycling*' OR lower(e.name) GLOB '*rowing*'
          OR lower(e.name) GLOB '*bike*' OR lower(e.name) GLOB '*run*'
          OR lower(e.name) GLOB '*cardio*' THEN 1 ELSE 0 END) as has_cardio
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON we.exercise_id = e.id
      LEFT JOIN sets s ON s.workout_exercise_id = we.id
      WHERE w.date >= ${since}
      GROUP BY w.id
      ORDER BY w.date
    `);

    return rows.map(r => ({
      date: r.date,
      durationMinutes: Math.round(r.set_count * 2.5),  // ~2.5 min per set including rest
      caloriesBurned: Math.round(r.total_reps * 0.5 + r.set_count * 8), // rough estimate
      exerciseType: r.has_cardio ? 'mixed' : 'strength',
    }));
  });

  // Delete workout_exercise (cascades sets)
  app.delete<{ Params: { id: string } }>('/workout-exercises/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    db.delete(schema.workoutExercises).where(eq(schema.workoutExercises.id, id)).run();
    return reply.status(204).send();
  });

  // Add set to workout exercise
  app.post<{
    Params: { id: string };
    Body: { reps?: number; weightKg?: number; isWarmup?: boolean; multiplier?: number };
  }>('/workout-exercises/:id/sets', async (req, reply) => {
    const workoutExerciseId = parseInt(req.params.id);
    const result = db
      .insert(schema.sets)
      .values({ workoutExerciseId, ...req.body })
      .returning()
      .get();
    return reply.status(201).send(result);
  });
}
