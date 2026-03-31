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

    if (workouts.length === 0) return [];

    const wIds = workouts.map(w => w.id);

    // Single query for exercise + set counts
    const countRows = db.all<{ workout_id: number; exercise_count: number; set_count: number }>(sql`
      SELECT we.workout_id,
        COUNT(DISTINCT we.id) as exercise_count,
        COUNT(s.id) as set_count
      FROM workout_exercises we
      LEFT JOIN sets s ON s.workout_exercise_id = we.id
      WHERE we.workout_id IN (${sql.join(wIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY we.workout_id
    `);
    const countMap = new Map(countRows.map(r => [r.workout_id, r]));

    // Optional: exercise names for detail mode
    let nameMap = new Map<number, string[]>();
    if (req.query.detail === 'true') {
      const nameRows = db.all<{ workout_id: number; names: string }>(sql`
        SELECT we.workout_id, GROUP_CONCAT(e.name, '||') as names
        FROM workout_exercises we
        JOIN exercises e ON we.exercise_id = e.id
        WHERE we.workout_id IN (${sql.join(wIds.map(id => sql`${id}`), sql`, `)})
        GROUP BY we.workout_id
      `);
      nameMap = new Map(nameRows.map(r => [r.workout_id, r.names ? r.names.split('||') : []]));
    }

    return workouts.map(w => {
      const counts = countMap.get(w.id);
      return {
        ...w,
        exerciseCount: counts?.exercise_count ?? 0,
        setCount: counts?.set_count ?? 0,
        ...(req.query.detail === 'true' ? { exerciseNames: nameMap.get(w.id) ?? [] } : {}),
      };
    });
  });

  // Get single workout with exercises and sets
  app.get<{ Params: { id: string } }>('/workouts/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const workout = await db.select().from(schema.workouts).where(eq(schema.workouts.id, id)).get();
    if (!workout) return reply.status(404).send({ error: 'Not found' });

    // Single JOIN query for all exercises + sets
    const rows = db.all<{
      we_id: number; exercise_id: number; display_order: number; superset_group: number | null;
      ex_name: string; ex_rest_seconds: number | null; ex_image_url: string | null;
      ex_primary_muscles: string | null; ex_secondary_muscles: string | null; ex_equipment: string | null;
      set_id: number | null; set_reps: number | null; set_weight_kg: number | null;
      set_is_warmup: number | null; set_rpe: number | null; set_multiplier: number | null;
    }>(sql`
      SELECT
        we.id as we_id, we.exercise_id, we.display_order, we.superset_group,
        e.name as ex_name, e.rest_seconds as ex_rest_seconds, e.image_url as ex_image_url,
        e.primary_muscles as ex_primary_muscles, e.secondary_muscles as ex_secondary_muscles,
        e.equipment as ex_equipment,
        s.id as set_id, s.reps as set_reps, s.weight_kg as set_weight_kg,
        s.is_warmup as set_is_warmup, s.rpe as set_rpe, s.multiplier as set_multiplier
      FROM workout_exercises we
      JOIN exercises e ON we.exercise_id = e.id
      LEFT JOIN sets s ON s.workout_exercise_id = we.id
      WHERE we.workout_id = ${id}
      ORDER BY we.display_order, s.id
    `);

    // Group flat rows into nested structure
    const exerciseMap = new Map<number, any>();
    for (const r of rows) {
      if (!exerciseMap.has(r.we_id)) {
        exerciseMap.set(r.we_id, {
          id: r.we_id,
          workoutId: id,
          exerciseId: r.exercise_id,
          displayOrder: r.display_order,
          supersetGroup: r.superset_group,
          exercise: {
            id: r.exercise_id,
            name: r.ex_name,
            restSeconds: r.ex_rest_seconds,
            imageUrl: r.ex_image_url,
            primaryMuscles: r.ex_primary_muscles,
            secondaryMuscles: r.ex_secondary_muscles,
            equipment: r.ex_equipment,
          },
          sets: [],
          restSeconds: r.ex_rest_seconds ?? 60,
        });
      }
      if (r.set_id != null) {
        exerciseMap.get(r.we_id)!.sets.push({
          id: r.set_id,
          workoutExerciseId: r.we_id,
          reps: r.set_reps,
          weightKg: r.set_weight_kg,
          isWarmup: r.set_is_warmup,
          rpe: r.set_rpe,
          multiplier: r.set_multiplier,
        });
      }
    }

    return { ...workout, exercises: Array.from(exerciseMap.values()) };
  });

  // Create workout
  app.post<{ Body: { date: string; locationProfile?: string; notes?: string } }>('/workouts', async (req, reply) => {
    const { date, locationProfile, notes } = req.body;
    const result = db.insert(schema.workouts).values({ date, locationProfile, notes }).returning().get();
    return reply.status(201).send(result);
  });

  // Batch start workout — create workout + exercises + sets in a single transaction
  app.post<{
    Body: {
      date: string;
      notes?: string;
      locationProfile?: string;
      exercises: Array<{
        exerciseId: number;
        displayOrder: number;
        supersetGroup?: number | null;
        sets: Array<{
          reps: number;
          weightKg: number;
          isWarmup?: boolean;
        }>;
      }>;
    };
  }>('/workouts/start', async (req, reply) => {
    const { date, notes, locationProfile, exercises } = req.body;

    const result = db.transaction((tx) => {
      const workout = tx.insert(schema.workouts)
        .values({ date, notes, locationProfile })
        .returning()
        .get();

      for (const ex of exercises) {
        const we = tx.insert(schema.workoutExercises)
          .values({
            workoutId: workout.id,
            exerciseId: ex.exerciseId,
            displayOrder: ex.displayOrder,
            supersetGroup: ex.supersetGroup ?? null,
          })
          .returning()
          .get();

        for (const set of ex.sets) {
          tx.insert(schema.sets)
            .values({
              workoutExerciseId: we.id,
              reps: set.reps,
              weightKg: set.weightKg,
              isWarmup: set.isWarmup ?? false,
            })
            .run();
        }
      }

      return workout;
    });

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
