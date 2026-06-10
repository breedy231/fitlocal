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
      set_duration_seconds: number | null; set_distance_meters: number | null;
      set_resistance: number | null; set_completed: number | null;
    }>(sql`
      SELECT
        we.id as we_id, we.exercise_id, we.display_order, we.superset_group,
        e.name as ex_name, e.rest_seconds as ex_rest_seconds, e.image_url as ex_image_url,
        e.primary_muscles as ex_primary_muscles, e.secondary_muscles as ex_secondary_muscles,
        e.equipment as ex_equipment,
        s.id as set_id, s.reps as set_reps, s.weight_kg as set_weight_kg,
        s.is_warmup as set_is_warmup, s.rpe as set_rpe, s.multiplier as set_multiplier,
        s.duration_seconds as set_duration_seconds,
        s.distance_meters as set_distance_meters, s.resistance as set_resistance,
        s.completed as set_completed
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
            primaryMuscles: typeof r.ex_primary_muscles === 'string' ? JSON.parse(r.ex_primary_muscles || '[]') : (r.ex_primary_muscles ?? []),
            secondaryMuscles: typeof r.ex_secondary_muscles === 'string' ? JSON.parse(r.ex_secondary_muscles || '[]') : (r.ex_secondary_muscles ?? []),
            equipment: typeof r.ex_equipment === 'string' ? JSON.parse(r.ex_equipment || '[]') : (r.ex_equipment ?? []),
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
          durationSeconds: r.set_duration_seconds,
          distanceMeters: r.set_distance_meters,
          resistance: r.set_resistance,
          completed: !!r.set_completed,
        });
      }
    }

    // Enrich with last performance + PR data for each exercise
    const exerciseIds = [...new Set(Array.from(exerciseMap.values()).map((e: any) => e.exerciseId as number))];
    if (exerciseIds.length > 0) {
      // Last session's sets per exercise (excluding current workout).
      // Find the most recent workout_exercise entry per exercise, then grab its sets.
      const lastWeRows = db.all<{
        exercise_id: number; we_id: number; workout_date: string;
      }>(sql`
        SELECT we.exercise_id, we.id as we_id, w.date as workout_date
        FROM workout_exercises we
        JOIN workouts w ON we.workout_id = w.id
        WHERE we.exercise_id IN (${sql.join(exerciseIds.map(eid => sql`${eid}`), sql`, `)})
          AND w.id != ${id}
        ORDER BY w.date DESC, we.id DESC
      `);

      // Pick the most recent workout_exercise per exercise
      const latestWeIds = new Map<number, { weId: number; date: string }>();
      for (const r of lastWeRows) {
        if (!latestWeIds.has(r.exercise_id)) {
          latestWeIds.set(r.exercise_id, { weId: r.we_id, date: r.workout_date });
        }
      }

      const lastPerf = new Map<number, { date: string; sets: { reps: number; weightKg: number }[] }>();
      if (latestWeIds.size > 0) {
        const weIds = [...latestWeIds.values()].map(v => v.weId);
        const setRows = db.all<{
          we_id: number; reps: number; weight_kg: number;
        }>(sql`
          SELECT s.workout_exercise_id as we_id, s.reps, s.weight_kg
          FROM sets s
          WHERE s.workout_exercise_id IN (${sql.join(weIds.map(wid => sql`${wid}`), sql`, `)})
            AND s.is_warmup = 0
            AND s.reps > 0
          ORDER BY s.id ASC
        `);

        // Build a we_id → exercise_id reverse map
        const weToExercise = new Map<number, number>();
        for (const [exId, v] of latestWeIds) weToExercise.set(v.weId, exId);

        for (const r of setRows) {
          const exId = weToExercise.get(r.we_id)!;
          if (!lastPerf.has(exId)) {
            lastPerf.set(exId, { date: latestWeIds.get(exId)!.date, sets: [] });
          }
          lastPerf.get(exId)!.sets.push({ reps: r.reps, weightKg: r.weight_kg });
        }
      }

      // PR weight per exercise (all-time max, excluding current workout)
      const prRows = db.all<{ exercise_id: number; max_weight: number }>(sql`
        SELECT we.exercise_id, MAX(s.weight_kg) as max_weight
        FROM sets s
        JOIN workout_exercises we ON s.workout_exercise_id = we.id
        JOIN workouts w ON we.workout_id = w.id
        WHERE we.exercise_id IN (${sql.join(exerciseIds.map(eid => sql`${eid}`), sql`, `)})
          AND w.id != ${id}
          AND s.is_warmup = 0
          AND s.weight_kg > 0
        GROUP BY we.exercise_id
      `);
      const prMap = new Map(prRows.map(r => [r.exercise_id, r.max_weight]));

      for (const ex of exerciseMap.values()) {
        ex.lastPerformance = lastPerf.get(ex.exerciseId) ?? null;
        ex.prWeightKg = prMap.get(ex.exerciseId) ?? null;
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
  app.put<{ Params: { id: string }; Body: { date?: string; locationProfile?: string; notes?: string; effortRating?: number } }>(
    '/workouts/:id',
    async (req, reply) => {
      const id = parseInt(req.params.id);
      const result = db.update(schema.workouts).set(req.body).where(eq(schema.workouts.id, id)).returning().get();
      if (!result) return reply.status(404).send({ error: 'Not found' });
      return result;
    }
  );

  // Update workout (PATCH)
  app.patch<{ Params: { id: string }; Body: { date?: string; locationProfile?: string; notes?: string; effortRating?: number } }>(
    '/workouts/:id',
    async (req, reply) => {
      const id = parseInt(req.params.id);
      const result = db.update(schema.workouts).set(req.body).where(eq(schema.workouts.id, id)).returning().get();
      if (!result) return reply.status(404).send({ error: 'Not found' });
      return result;
    }
  );

  // Add exercise to existing workout
  app.post<{ Params: { id: string }; Body: { exerciseId: number; displayOrder?: number; supersetGroup?: number | null; swapReason?: string } }>(
    '/workouts/:id/exercises',
    async (req, reply) => {
      const workoutId = parseInt(req.params.id);
      const { exerciseId, displayOrder = 0, supersetGroup, swapReason } = req.body;
      const result = db
        .insert(schema.workoutExercises)
        .values({ workoutId, exerciseId, displayOrder, supersetGroup: supersetGroup ?? null, swapReason: swapReason ?? null })
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

  // Export workouts for HealthKit writeback (used by iOS Shortcut)
  app.get<{ Querystring: { since?: string; date?: string } }>('/workouts/export', async (req) => {
    const dateFilter = req.query.date
      ? sql`w.date = ${req.query.date}`
      : sql`w.date >= ${req.query.since || '1970-01-01'}`;

    // Get latest body weight for MET-based calorie estimation
    const weightRow = db.get<{ body_weight_kg: number | null }>(sql`
      SELECT body_weight_kg FROM health_snapshots
      WHERE body_weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1
    `);
    const bodyWeightKg = weightRow?.body_weight_kg || 80; // fallback 80kg

    const rows = db.all<{
      date: string;
      strength_sets: number;
      cardio_minutes: number;
      has_cardio: number;
    }>(sql`
      SELECT w.date,
        SUM(CASE WHEN e.name NOT IN ('Walking','Walking - Treadmill','Cycling','Cycling - Stationary',
          'Elliptical','Rowing','Running','Running - Treadmill')
          THEN 1 ELSE 0 END) as strength_sets,
        COALESCE(SUM(CASE WHEN e.name IN ('Walking','Walking - Treadmill','Cycling','Cycling - Stationary',
          'Elliptical','Rowing','Running','Running - Treadmill')
          THEN s.reps ELSE 0 END), 0) as cardio_minutes,
        MAX(CASE WHEN e.name IN ('Walking','Walking - Treadmill','Cycling','Cycling - Stationary',
          'Elliptical','Rowing','Running','Running - Treadmill')
          THEN 1 ELSE 0 END) as has_cardio
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON we.exercise_id = e.id
      LEFT JOIN sets s ON s.workout_exercise_id = we.id
      WHERE ${dateFilter}
      GROUP BY w.id
      ORDER BY w.date
    `);

    return rows.map(r => {
      // MET-based estimation: strength ~4 METs, cardio ~5 METs (walking/cycling mix)
      // Formula: MET * bodyWeightKg * durationHours
      const strengthMinutes = r.strength_sets * 2.5; // ~2.5 min per set including rest
      const cardioMinutes = r.cardio_minutes; // reps = minutes for cardio exercises
      const strengthCals = 4 * bodyWeightKg * (strengthMinutes / 60);
      const cardioCals = 5 * bodyWeightKg * (cardioMinutes / 60);
      const totalMinutes = Math.round(strengthMinutes + cardioMinutes);

      return {
        date: r.date,
        durationMinutes: totalMinutes,
        caloriesBurned: Math.round(strengthCals + cardioCals),
        exerciseType: r.has_cardio ? 'mixed' : 'strength',
      };
    });
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
