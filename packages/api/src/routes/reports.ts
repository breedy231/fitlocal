import { FastifyInstance } from 'fastify';
import { eq, desc, sql } from 'drizzle-orm';
import { CARDIO_PATTERN } from 'fitlocal-shared';
import { db, schema } from '../db.js';
import { getMusclesForExercise } from '../lib/recovery.js';

// Reusable SQL fragment to exclude stretching/foam roll exercises
const STRENGTH_ONLY = sql`e.name NOT LIKE '%stretch%' AND e.name NOT LIKE '%foam roll%'`;

// Cardio exercises (treadmill, rowing, etc.) are logged with distance/duration,
// not weight. Legacy rows predating the dedicated distance_meters column stored
// miles/meters in weight_kg, so any weight-based aggregation (PRs, 1RM,
// progression, total volume) that includes them surfaces nonsense — e.g. a
// "5,050 lb" rower (issue #57). CARDIO_PATTERN is the single source of truth for
// the classification (packages/shared/src/cardio.ts); we resolve it to exercise
// IDs in JS rather than redefining the regex in SQL, then exclude those IDs from
// weight-based queries.
//
// Cached for the process lifetime: there's no runtime exercise-creation path, so
// re-querying the (effectively static) exercises table per request is waste.
let cardioExerciseIdsCache: number[] | null = null;
function cardioExerciseIds(): number[] {
  if (cardioExerciseIdsCache === null) {
    const rows = db.all(sql`SELECT id, name FROM exercises`) as { id: number; name: string }[];
    cardioExerciseIdsCache = rows.filter((r) => CARDIO_PATTERN.test(r.name)).map((r) => r.id);
  }
  return cardioExerciseIdsCache;
}

function parseExcludeIds(raw?: string): number[] {
  if (!raw) return [];
  return raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
}

function excludeFilter(excludeIds: number[]) {
  if (excludeIds.length === 0) return sql`1=1`;
  return sql.raw(`e.id NOT IN (${excludeIds.join(',')})`);
}

// SQL fragment excluding cardio exercises — plus any user-supplied exclusions —
// from weight-based stats. Use in place of excludeFilter() for weight queries.
function strengthOnlyFilter(extraExcludeIds: number[] = []) {
  const ids = [...new Set([...cardioExerciseIds(), ...extraExcludeIds])];
  if (ids.length === 0) return sql`1=1`;
  return sql.raw(`e.id NOT IN (${ids.join(',')})`);
}

// Benchmark categories with thresholds (1RM / bodyweight ratios)
// Each category has regex patterns to match, checked in order (first match wins per exercise)
// "skip" patterns prevent false positives (e.g. "dumbbell bench press" should NOT match "bench press")
interface BenchmarkCategory {
  label: string;
  match: RegExp;
  skip?: RegExp;
  thresholds: Record<'male' | 'female', Record<string, number>>;
}

const BENCHMARK_CATEGORIES: BenchmarkCategory[] = [
  {
    label: 'Bench Press',
    match: /\bbarbell bench press\b|^bench press$/i,
    skip: /dumbbell|incline|decline|close.grip|smith|machine/i,
    thresholds: {
      male: { beginner: 0.5, novice: 0.75, intermediate: 1.0, advanced: 1.25, elite: 1.5 },
      female: { beginner: 0.25, novice: 0.5, intermediate: 0.75, advanced: 1.0, elite: 1.15 },
    },
  },
  {
    label: 'Squat',
    match: /\bback squat\b|^barbell squat$/i,
    skip: /front|dumbbell|goblet|split|smith|machine|sumo|air|kneeling|kettlebell|pistol/i,
    thresholds: {
      male: { beginner: 0.75, novice: 1.0, intermediate: 1.5, advanced: 1.75, elite: 2.25 },
      female: { beginner: 0.5, novice: 0.75, intermediate: 1.0, advanced: 1.5, elite: 1.75 },
    },
  },
  {
    label: 'Deadlift',
    match: /^deadlift$|^barbell deadlift$|^conventional deadlift$/i,
    skip: /romanian|stiff|sumo|dumbbell|smith|landmine|trap bar/i,
    thresholds: {
      male: { beginner: 1.0, novice: 1.25, intermediate: 1.75, advanced: 2.25, elite: 2.75 },
      female: { beginner: 0.5, novice: 0.75, intermediate: 1.25, advanced: 1.5, elite: 2.0 },
    },
  },
  {
    label: 'Overhead Press',
    match: /\b(overhead|ohp|military)\s*press\b/i,
    skip: /dumbbell|kettlebell|single.arm|seated|machine|smith|push/i,
    thresholds: {
      male: { beginner: 0.35, novice: 0.55, intermediate: 0.65, advanced: 0.85, elite: 1.05 },
      female: { beginner: 0.2, novice: 0.35, intermediate: 0.5, advanced: 0.65, elite: 0.8 },
    },
  },
  {
    label: 'Barbell Row',
    match: /\bbarbell row\b|^bent.over.*row$/i,
    skip: /dumbbell|cable|machine|t.bar|seated/i,
    thresholds: {
      male: { beginner: 0.5, novice: 0.65, intermediate: 0.85, advanced: 1.05, elite: 1.3 },
      female: { beginner: 0.3, novice: 0.45, intermediate: 0.6, advanced: 0.75, elite: 0.95 },
    },
  },
  {
    label: 'Hip Thrust',
    match: /\bbarbell hip thrust\b/i,
    skip: /dumbbell|machine|single/i,
    thresholds: {
      male: { beginner: 0.75, novice: 1.0, intermediate: 1.5, advanced: 2.0, elite: 2.5 },
      female: { beginner: 0.5, novice: 1.0, intermediate: 1.5, advanced: 2.0, elite: 2.5 },
    },
  },
  {
    label: 'Romanian Deadlift',
    match: /^(barbell )?romanian deadlift$/i,
    skip: /dumbbell|single|smith|landmine/i,
    thresholds: {
      male: { beginner: 0.6, novice: 0.85, intermediate: 1.15, advanced: 1.5, elite: 1.85 },
      female: { beginner: 0.35, novice: 0.55, intermediate: 0.85, advanced: 1.1, elite: 1.4 },
    },
  },
  {
    label: 'Incline Bench',
    match: /\bincline bench press\b|\bincline barbell\b/i,
    skip: /dumbbell|smith|machine/i,
    thresholds: {
      male: { beginner: 0.4, novice: 0.6, intermediate: 0.85, advanced: 1.05, elite: 1.3 },
      female: { beginner: 0.2, novice: 0.4, intermediate: 0.6, advanced: 0.8, elite: 1.0 },
    },
  },
  {
    label: 'Front Squat',
    match: /\bfront squat\b/i,
    skip: /dumbbell|kettlebell|smith|machine/i,
    thresholds: {
      male: { beginner: 0.55, novice: 0.8, intermediate: 1.15, advanced: 1.45, elite: 1.8 },
      female: { beginner: 0.35, novice: 0.55, intermediate: 0.8, advanced: 1.1, elite: 1.35 },
    },
  },
  {
    label: 'Lat Pulldown',
    match: /^lat pulldown$/i,
    skip: /single|reverse|close/i,
    thresholds: {
      male: { beginner: 0.4, novice: 0.55, intermediate: 0.75, advanced: 0.95, elite: 1.15 },
      female: { beginner: 0.25, novice: 0.4, intermediate: 0.55, advanced: 0.7, elite: 0.85 },
    },
  },
];

// Match exercise name to a benchmark category; returns null if no match
function matchBenchmark(exerciseName: string): BenchmarkCategory | null {
  for (const cat of BENCHMARK_CATEGORIES) {
    if (cat.match.test(exerciseName) && (!cat.skip || !cat.skip.test(exerciseName))) {
      return cat;
    }
  }
  return null;
}

function classifyLevel(ratio: number, thresholds: Record<string, number>): string {
  if (ratio >= thresholds.elite) return 'elite';
  if (ratio >= thresholds.advanced) return 'advanced';
  if (ratio >= thresholds.intermediate) return 'intermediate';
  if (ratio >= thresholds.novice) return 'novice';
  return 'beginner';
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
        AND ${strengthOnlyFilter(excludeIds)}
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
        e.name as exerciseName,
        COUNT(CASE WHEN s.is_warmup = 0 THEN 1 END) as workingSets
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON e.id = we.exercise_id
      LEFT JOIN sets s ON s.workout_exercise_id = we.id
      WHERE w.date >= date('now', '-30 days')
        AND ${STRENGTH_ONLY}
        AND ${excludeFilter(excludeIds)}
      GROUP BY we.id
    `) as { exerciseName: string; workingSets: number }[];

    const muscleMap: Record<string, number> = {};
    for (const row of rows) {
      const muscles = getMusclesForExercise(row.exerciseName);
      for (const m of muscles) {
        muscleMap[m] = (muscleMap[m] || 0) + row.workingSets;
      }
    }

    const muscles = Object.entries(muscleMap)
      .map(([name, sets]) => ({ name, sets: Math.round(sets * 10) / 10 }))
      .sort((a, b) => b.sets - a.sets);

    return { muscles };
  });

  // Personal records (heaviest working set per exercise + estimated 1RM)
  app.get<{ Querystring: { excludeExerciseIds?: string } }>('/reports/personal-records', async (req) => {
    const excludeIds = parseExcludeIds(req.query.excludeExerciseIds);
    const rows = db.all(sql`
      SELECT
        e.name as exerciseName,
        s.weight_kg as maxWeightKg,
        s.reps as repsAtMax,
        w.date as dateAchieved,
        MAX(s.weight_kg * (1.0 + MIN(CAST(s.reps AS REAL), 12.0) / 30.0)) as estimated1RmKg
      FROM sets s
      JOIN workout_exercises we ON we.id = s.workout_exercise_id
      JOIN exercises e ON e.id = we.exercise_id
      JOIN workouts w ON w.id = we.workout_id
      WHERE s.is_warmup = 0
        AND s.weight_kg > 0
        AND ${STRENGTH_ONLY}
        AND ${strengthOnlyFilter(excludeIds)}
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
    `) as { exerciseName: string; maxWeightKg: number; repsAtMax: number; dateAchieved: string; estimated1RmKg: number }[];

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

      // Cardio has no meaningful weight progression (and legacy rows store
      // distance in weight_kg) — never render a weight series for it. See #57.
      if (exercise && CARDIO_PATTERN.test(exercise.name)) {
        return { exerciseName: exercise.name, dataPoints: [] };
      }

      const rows = db.all(sql`
        SELECT
          w.date,
          MAX(CASE WHEN s.is_warmup = 0 THEN s.weight_kg ELSE 0 END) as maxWeight,
          MAX(CASE WHEN s.is_warmup = 0 THEN s.reps ELSE 0 END) as maxReps,
          SUM(CASE WHEN s.is_warmup = 0 THEN s.reps * s.weight_kg * s.multiplier ELSE 0 END) as sessionVolume,
          MAX(CASE WHEN s.is_warmup = 0 AND s.weight_kg > 0 THEN s.weight_kg * (1.0 + MIN(CAST(s.reps AS REAL), 12.0) / 30.0) ELSE 0 END) as estimated1RmKg
        FROM workouts w
        JOIN workout_exercises we ON we.workout_id = w.id
        JOIN sets s ON s.workout_exercise_id = we.id
        WHERE we.exercise_id = ${exerciseId}
        GROUP BY w.id
        ORDER BY w.date ASC
      `) as { date: string; maxWeight: number; maxReps: number; sessionVolume: number; estimated1RmKg: number }[];

      return { exerciseName: exercise?.name, dataPoints: rows };
    }
  );

  // Exercise list for progression picker
  app.get<{ Querystring: { excludeExerciseIds?: string } }>('/reports/exercises-with-history', async (req) => {
    const excludeIds = parseExcludeIds(req.query.excludeExerciseIds);
    const rows = db.all(sql`
      SELECT DISTINCT e.id, e.name,
        COUNT(DISTINCT w.id) as workoutCount,
        COUNT(DISTINCT CASE WHEN w.date >= date('now','-56 days') THEN w.id END) as recentCount
      FROM exercises e
      JOIN workout_exercises we ON we.exercise_id = e.id
      JOIN workouts w ON w.id = we.workout_id
      WHERE ${STRENGTH_ONLY}
        AND ${strengthOnlyFilter(excludeIds)}
      GROUP BY e.id
      HAVING workoutCount >= 2
      ORDER BY recentCount DESC, workoutCount DESC
    `) as { id: number; name: string; workoutCount: number; recentCount: number }[];

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

  // Exercise 1RM history over time
  app.get<{ Querystring: { exerciseId: string } }>('/reports/exercise-1rm-history', async (req) => {
    const exerciseId = parseInt(req.query.exerciseId);
    if (!exerciseId) return { exerciseName: null, dataPoints: [] };

    const exercise = await db
      .select()
      .from(schema.exercises)
      .where(eq(schema.exercises.id, exerciseId))
      .get();

    // Cardio has no weight-based 1RM (legacy rows store distance in weight_kg).
    if (exercise && CARDIO_PATTERN.test(exercise.name)) {
      return { exerciseName: exercise.name, dataPoints: [] };
    }

    const rows = db.all(sql`
      SELECT
        w.date,
        MAX(CASE WHEN s.is_warmup = 0 AND s.weight_kg > 0
          THEN s.weight_kg * (1.0 + MIN(CAST(s.reps AS REAL), 12.0) / 30.0) ELSE 0 END) as estimated1RmKg
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN sets s ON s.workout_exercise_id = we.id
      WHERE we.exercise_id = ${exerciseId}
      GROUP BY w.id
      HAVING estimated1RmKg > 0
      ORDER BY w.date ASC
    `) as { date: string; estimated1RmKg: number }[];

    return { exerciseName: exercise?.name, dataPoints: rows };
  });

  // Workout calendar heatmap (month view)
  app.get<{ Querystring: { year?: string; month?: string } }>('/reports/calendar', async (req) => {
    const now = new Date();
    const year = parseInt(req.query.year || String(now.getFullYear()));
    const month = parseInt(req.query.month || String(now.getMonth() + 1));
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

    const rows = db.all(sql`
      SELECT
        w.date,
        COUNT(DISTINCT w.id) as workoutCount,
        GROUP_CONCAT(DISTINCT e.primary_muscles) as muscleGroups,
        COUNT(CASE WHEN s.is_warmup = 0 THEN 1 END) as totalSets
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON e.id = we.exercise_id
      LEFT JOIN sets s ON s.workout_exercise_id = we.id
      WHERE w.date >= ${startDate} AND w.date <= ${endDate}
        AND ${STRENGTH_ONLY}
      GROUP BY w.date
      ORDER BY w.date ASC
    `) as { date: string; workoutCount: number; muscleGroups: string; totalSets: number }[];

    return {
      year,
      month,
      days: rows.map(r => ({
        date: r.date,
        workoutCount: r.workoutCount,
        totalSets: r.totalSets,
        primaryMuscles: [...new Set(
          (r.muscleGroups || '').split(',')
            .flatMap(g => { try { return JSON.parse(g); } catch { return []; } })
        )],
      })),
    };
  });

  // Body part volume heatmap (weekly grid)
  app.get<{ Querystring: { weeks?: string } }>('/reports/volume-heatmap', async (req) => {
    const weeks = parseInt(req.query.weeks || '4');
    const since = new Date();
    since.setDate(since.getDate() - weeks * 7);
    const sinceStr = since.toISOString().slice(0, 10);

    const rows = db.all(sql`
      SELECT
        w.date,
        e.name as exerciseName,
        COUNT(CASE WHEN s.is_warmup = 0 THEN 1 END) as workingSets
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON e.id = we.exercise_id
      LEFT JOIN sets s ON s.workout_exercise_id = we.id
      WHERE w.date >= ${sinceStr} AND ${STRENGTH_ONLY}
      GROUP BY w.date, we.exercise_id
    `) as { date: string; exerciseName: string; workingSets: number }[];

    const MUSCLES = ['chest', 'shoulders', 'triceps', 'back', 'biceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core'];

    // Build day-muscle map using regex-based muscle detection
    const dayMap: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      if (!dayMap[row.date]) dayMap[row.date] = {};
      const muscles = getMusclesForExercise(row.exerciseName);
      for (const m of muscles) {
        if (MUSCLES.includes(m)) {
          dayMap[row.date][m] = (dayMap[row.date][m] || 0) + row.workingSets;
        }
      }
    }

    // Group into weeks (Mon-Sun)
    const weekBuckets: { weekStart: string; days: { date: string; muscles: Record<string, number> }[] }[] = [];
    const allDates = Object.keys(dayMap).sort();

    // Generate all dates in range
    const startDate = new Date(sinceStr + 'T12:00:00');
    const endDate = new Date();
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dayOfWeek = d.getDay();
      const monday = new Date(d);
      monday.setDate(monday.getDate() - ((dayOfWeek + 6) % 7));
      const weekStart = monday.toISOString().slice(0, 10);

      let bucket = weekBuckets.find(w => w.weekStart === weekStart);
      if (!bucket) {
        bucket = { weekStart, days: [] };
        weekBuckets.push(bucket);
      }

      const muscleData: Record<string, number> = {};
      for (const m of MUSCLES) muscleData[m] = dayMap[dateStr]?.[m] || 0;
      bucket.days.push({ date: dateStr, muscles: muscleData });
    }

    return { muscles: MUSCLES, weeks: weekBuckets.sort((a, b) => a.weekStart.localeCompare(b.weekStart)) };
  });

  // Strength benchmarks
  app.get<{ Querystring: { gender?: string } }>('/reports/benchmarks', async (req) => {
    const gender = (req.query.gender || 'male') as 'male' | 'female';

    // Get latest body weight
    const bwRow = db.all(sql`
      SELECT body_weight_kg FROM health_snapshots
      WHERE body_weight_kg IS NOT NULL
      ORDER BY date DESC LIMIT 1
    `) as { body_weight_kg: number }[];
    const bodyWeightKg = bwRow[0]?.body_weight_kg;
    if (!bodyWeightKg) return { bodyWeightKg: null, exercises: [] };

    // Get best estimated 1RM per exercise
    const rows = db.all(sql`
      SELECT
        e.id,
        e.name,
        MAX(s.weight_kg * (1.0 + MIN(CAST(s.reps AS REAL), 12.0) / 30.0)) as estimated1RmKg
      FROM sets s
      JOIN workout_exercises we ON we.id = s.workout_exercise_id
      JOIN exercises e ON e.id = we.exercise_id
      WHERE s.is_warmup = 0 AND s.weight_kg > 0 AND ${STRENGTH_ONLY}
        AND ${strengthOnlyFilter()}
      GROUP BY e.id
    `) as { id: number; name: string; estimated1RmKg: number }[];

    // Map each benchmark category to the best matching exercise
    const bestPerCategory = new Map<string, {
      name: string;
      estimated1RmKg: number;
      ratio: number;
      level: string;
      label: string;
      thresholds: Record<string, number>;
    }>();

    for (const row of rows) {
      const cat = matchBenchmark(row.name);
      if (!cat) continue;
      const thresholds = cat.thresholds[gender];
      const ratio = row.estimated1RmKg / bodyWeightKg;
      const existing = bestPerCategory.get(cat.label);
      // Keep the exercise with the highest 1RM per category
      if (!existing || row.estimated1RmKg > existing.estimated1RmKg) {
        bestPerCategory.set(cat.label, {
          name: row.name,
          estimated1RmKg: row.estimated1RmKg,
          ratio: Math.round(ratio * 100) / 100,
          level: classifyLevel(ratio, thresholds),
          label: cat.label,
          thresholds,
        });
      }
    }

    const exercises = [...bestPerCategory.values()].sort((a, b) => b.ratio - a.ratio);
    return { bodyWeightKg, exercises };
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

    // Volume is weight-based, so exclude cardio (legacy rows store distance in
    // weight_kg and would massively inflate the lbs total — see #57).
    const totalVolume = db.all(sql`
      SELECT COALESCE(SUM(s.reps * s.weight_kg * s.multiplier), 0) as total
      FROM sets s
      JOIN workout_exercises we ON we.id = s.workout_exercise_id
      JOIN exercises e ON e.id = we.exercise_id
      WHERE s.is_warmup = 0 AND ${STRENGTH_ONLY}
        AND ${strengthOnlyFilter(excludeIds)}
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
