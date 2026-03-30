import { FastifyInstance } from 'fastify';
import { eq, desc, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';

// Reusable SQL fragment to exclude stretching/foam roll exercises
const STRENGTH_ONLY = sql`e.name NOT LIKE '%stretch%' AND e.name NOT LIKE '%foam roll%'`;

function parseExcludeIds(raw?: string): number[] {
  if (!raw) return [];
  return raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
}

function excludeFilter(excludeIds: number[]) {
  if (excludeIds.length === 0) return sql`1=1`;
  return sql.raw(`e.id NOT IN (${excludeIds.join(',')})`);
}

export async function reportRoutes(app: FastifyInstance) {
  // Weekly workout frequency (last 12 weeks)
  app.get<{ Querystring: { excludeExerciseIds?: string } }>('/reports/frequency', async (req) => {
    const excludeIds = parseExcludeIds(req.query.excludeExerciseIds);
    const rows = db.all(sql`
      SELECT
        strftime('%Y-W%W', w.date) as week,
        MIN(w.date) as weekStart,
        COUNT(DISTINCT w.id) as count
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON e.id = we.exercise_id
      WHERE w.date >= date('now', '-84 days')
        AND ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
      GROUP BY strftime('%Y-W%W', w.date)
      ORDER BY week ASC
    `) as { week: string; weekStart: string; count: number }[];

    return { weeks: rows };
  });

  // Volume over time (total kg lifted per workout, last 30 workouts)
  app.get<{ Querystring: { excludeExerciseIds?: string } }>('/reports/volume', async (req) => {
    const excludeIds = parseExcludeIds(req.query.excludeExerciseIds);
    const rows = db.all(sql`
      SELECT
        w.id,
        w.date,
        w.notes,
        COALESCE(SUM(
          CASE WHEN s.is_warmup = 0 THEN s.reps * s.weight_kg * s.multiplier ELSE 0 END
        ), 0) as totalVolume,
        COUNT(DISTINCT we.id) as exerciseCount,
        COUNT(s.id) as setCount
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON e.id = we.exercise_id
      LEFT JOIN sets s ON s.workout_exercise_id = we.id
      WHERE ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
      GROUP BY w.id
      ORDER BY w.date DESC
      LIMIT 30
    `) as { id: number; date: string; notes: string | null; totalVolume: number; exerciseCount: number; setCount: number }[];

    return { workouts: rows.reverse() };
  });

  // Muscle group distribution (last 30 days)
  app.get<{ Querystring: { excludeExerciseIds?: string } }>('/reports/muscle-distribution', async (req) => {
    const excludeIds = parseExcludeIds(req.query.excludeExerciseIds);

    const rows = db.all(sql`
      SELECT
        e.primary_muscles as primaryMuscles,
        e.secondary_muscles as secondaryMuscles,
        COUNT(CASE WHEN s.is_warmup = 0 THEN 1 END) as workingSets
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON e.id = we.exercise_id
      LEFT JOIN sets s ON s.workout_exercise_id = we.id
      WHERE w.date >= date('now', '-30 days')
        AND ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
      GROUP BY we.id
    `) as { primaryMuscles: string; secondaryMuscles: string; workingSets: number }[];

    const muscleMap: Record<string, number> = {};
    for (const row of rows) {
      const primary: string[] = JSON.parse(row.primaryMuscles || '[]');
      const secondary: string[] = JSON.parse(row.secondaryMuscles || '[]');
      for (const m of primary) {
        muscleMap[m] = (muscleMap[m] || 0) + row.workingSets;
      }
      for (const m of secondary) {
        muscleMap[m] = (muscleMap[m] || 0) + row.workingSets * 0.5;
      }
    }

    const muscles = Object.entries(muscleMap)
      .map(([name, sets]) => ({ name, sets: Math.round(sets * 10) / 10 }))
      .sort((a, b) => b.sets - a.sets);

    return { muscles };
  });

  // Personal records (heaviest working set per exercise)
  app.get<{ Querystring: { excludeExerciseIds?: string } }>('/reports/personal-records', async (req) => {
    const excludeIds = parseExcludeIds(req.query.excludeExerciseIds);
    const rows = db.all(sql`
      SELECT
        e.name as exerciseName,
        s.weight_kg as maxWeightKg,
        s.reps as repsAtMax,
        w.date as dateAchieved
      FROM sets s
      JOIN workout_exercises we ON we.id = s.workout_exercise_id
      JOIN exercises e ON e.id = we.exercise_id
      JOIN workouts w ON w.id = we.workout_id
      WHERE s.is_warmup = 0
        AND s.weight_kg > 0
        AND ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
        AND s.weight_kg = (
          SELECT MAX(s2.weight_kg)
          FROM sets s2
          JOIN workout_exercises we2 ON we2.id = s2.workout_exercise_id
          WHERE we2.exercise_id = we.exercise_id
            AND s2.is_warmup = 0
            AND s2.weight_kg > 0
        )
      GROUP BY e.id
      ORDER BY s.weight_kg DESC
      LIMIT 20
    `) as { exerciseName: string; maxWeightKg: number; repsAtMax: number; dateAchieved: string }[];

    return { records: rows };
  });

  // Exercise progression (weight over time for a specific exercise)
  app.get<{ Querystring: { exerciseId?: string; name?: string; excludeExerciseIds?: string } }>(
    '/reports/exercise-progression',
    async (req) => {
      let exerciseId: number | undefined;

      if (req.query.exerciseId) {
        exerciseId = parseInt(req.query.exerciseId);
      } else if (req.query.name) {
        const exercise = await db
          .select()
          .from(schema.exercises)
          .where(eq(schema.exercises.name, req.query.name))
          .get();
        exerciseId = exercise?.id;
      }

      if (!exerciseId) {
        return { dataPoints: [], exerciseName: null };
      }

      const exercise = await db
        .select()
        .from(schema.exercises)
        .where(eq(schema.exercises.id, exerciseId))
        .get();

      const rows = db.all(sql`
        SELECT
          w.date,
          MAX(CASE WHEN s.is_warmup = 0 THEN s.weight_kg ELSE 0 END) as maxWeight,
          MAX(CASE WHEN s.is_warmup = 0 THEN s.reps ELSE 0 END) as maxReps,
          SUM(CASE WHEN s.is_warmup = 0 THEN s.reps * s.weight_kg * s.multiplier ELSE 0 END) as sessionVolume
        FROM workouts w
        JOIN workout_exercises we ON we.workout_id = w.id
        JOIN sets s ON s.workout_exercise_id = we.id
        WHERE we.exercise_id = ${exerciseId}
        GROUP BY w.id
        ORDER BY w.date ASC
      `) as { date: string; maxWeight: number; maxReps: number; sessionVolume: number }[];

      return { exerciseName: exercise?.name, dataPoints: rows };
    }
  );

  // Exercise list for progression picker
  app.get<{ Querystring: { excludeExerciseIds?: string } }>('/reports/exercises-with-history', async (req) => {
    const excludeIds = parseExcludeIds(req.query.excludeExerciseIds);
    const rows = db.all(sql`
      SELECT DISTINCT e.id, e.name, COUNT(DISTINCT w.id) as workoutCount
      FROM exercises e
      JOIN workout_exercises we ON we.exercise_id = e.id
      JOIN workouts w ON w.id = we.workout_id
      WHERE ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
      GROUP BY e.id
      HAVING workoutCount >= 2
      ORDER BY workoutCount DESC
    `) as { id: number; name: string; workoutCount: number }[];

    return { exercises: rows };
  });

  // Health trends (weight, steps, HRV, resting HR, sleep over time)
  app.get<{ Querystring: { since?: string; until?: string } }>('/reports/health-trends', async (req) => {
    const until = req.query.until || new Date().toISOString().slice(0, 10);
    const since = req.query.since || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const rows = db.all(sql`
      SELECT *
      FROM health_snapshots
      WHERE date >= ${since} AND date <= ${until}
      ORDER BY date ASC
    `) as {
      id: number;
      date: string;
      resting_hr: number | null;
      hrv: number | null;
      sleep_hours: number | null;
      calories: number | null;
      protein_g: number | null;
      steps: number | null;
      body_weight_kg: number | null;
    }[];

    return {
      snapshots: rows.map((r) => ({
        date: r.date,
        restingHr: r.resting_hr,
        hrv: r.hrv,
        sleepHours: r.sleep_hours,
        calories: r.calories,
        proteinG: r.protein_g,
        steps: r.steps,
        bodyWeightKg: r.body_weight_kg,
      })),
    };
  });

  // Summary stats
  app.get<{ Querystring: { excludeExerciseIds?: string } }>('/reports/summary', async (req) => {
    const excludeIds = parseExcludeIds(req.query.excludeExerciseIds);
    const totalWorkouts = db.all(sql`
      SELECT COUNT(DISTINCT w.id) as count
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON e.id = we.exercise_id
      WHERE ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
    `) as { count: number }[];

    const totalSets = db.all(sql`
      SELECT COUNT(*) as count
      FROM sets s
      JOIN workout_exercises we ON we.id = s.workout_exercise_id
      JOIN exercises e ON e.id = we.exercise_id
      WHERE s.is_warmup = 0 AND ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
    `) as { count: number }[];

    const totalVolume = db.all(sql`
      SELECT COALESCE(SUM(s.reps * s.weight_kg * s.multiplier), 0) as total
      FROM sets s
      JOIN workout_exercises we ON we.id = s.workout_exercise_id
      JOIN exercises e ON e.id = we.exercise_id
      WHERE s.is_warmup = 0 AND ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
    `) as { total: number }[];

    // Current streak (consecutive days with workouts, allowing 1-day gaps for rest)
    const workoutDates = db.all(sql`
      SELECT DISTINCT w.date
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON e.id = we.exercise_id
      WHERE ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
      ORDER BY w.date DESC
    `) as { date: string }[];

    let streak = 0;
    if (workoutDates.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let checkDate = today;
      let i = 0;

      while (i < workoutDates.length) {
        const wDate = new Date(workoutDates[i].date + 'T00:00:00');
        const diff = Math.round((checkDate.getTime() - wDate.getTime()) / (1000 * 60 * 60 * 24));

        if (diff <= 2) {
          streak++;
          checkDate = new Date(wDate);
          checkDate.setDate(checkDate.getDate() - 1);
          i++;
        } else {
          break;
        }
      }
    }

    // Workouts this week
    const thisWeek = db.all(sql`
      SELECT COUNT(DISTINCT w.id) as count
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON e.id = we.exercise_id
      WHERE w.date >= date('now', 'weekday 0', '-7 days')
        AND ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
    `) as { count: number }[];

    // Workouts this month
    const thisMonth = db.all(sql`
      SELECT COUNT(DISTINCT w.id) as count
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON e.id = we.exercise_id
      WHERE w.date >= date('now', 'start of month')
        AND ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
    `) as { count: number }[];

    return {
      totalWorkouts: totalWorkouts[0]?.count || 0,
      totalWorkingSets: totalSets[0]?.count || 0,
      totalVolumeKg: Math.round(totalVolume[0]?.total || 0),
      currentStreak: streak,
      workoutsThisWeek: thisWeek[0]?.count || 0,
      workoutsThisMonth: thisMonth[0]?.count || 0,
    };
  });
}
