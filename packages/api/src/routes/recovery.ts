import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db.js';
import { computeAllMuscleRecoveries } from '../lib/recovery.js';

const MUSCLE_GROUPS = [
  'chest', 'shoulders', 'triceps', 'back', 'biceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'core',
];

export async function recoveryRoutes(app: FastifyInstance) {
  app.get('/recovery-summary', async () => {
    const recoveries = computeAllMuscleRecoveries(db);
    const muscles = MUSCLE_GROUPS.map(name => ({
      name,
      recoveryPct: Math.round((recoveries.get(name) ?? 1) * 100),
    }));
    return { muscles };
  });

  // Weekly goals: current week stats vs 4-week average targets
  app.get('/weekly-goals', async () => {
    // Current week (Mon-Sun)
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    const mondayStr = monday.toISOString().slice(0, 10);

    // 4 weeks back for baseline
    const fourWeeksAgo = new Date(monday);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const fourWeeksStr = fourWeeksAgo.toISOString().slice(0, 10);

    // Weekly stats for last 4 weeks + current
    const weekRows = db.all<{ week_start: string; days_trained: number; working_sets: number }>(sql`
      SELECT date(w.date, 'weekday 1', '-7 days') as week_start,
        COUNT(DISTINCT w.date) as days_trained,
        COUNT(s.id) as working_sets
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      LEFT JOIN sets s ON s.workout_exercise_id = we.id AND s.is_warmup = 0 AND s.reps > 0
      WHERE w.date >= ${fourWeeksStr}
      GROUP BY week_start
      ORDER BY week_start
    `);

    // Current week stats
    const currentWeek = weekRows.find(r => r.week_start >= mondayStr);
    const priorWeeks = weekRows.filter(r => r.week_start < mondayStr);

    const avgDays = priorWeeks.length > 0
      ? Math.round(priorWeeks.reduce((s, w) => s + w.days_trained, 0) / priorWeeks.length)
      : 4;
    const avgSets = priorWeeks.length > 0
      ? Math.round(priorWeeks.reduce((s, w) => s + w.working_sets, 0) / priorWeeks.length)
      : 60;

    // Recovery average
    const recoveries = computeAllMuscleRecoveries(db);
    let recoverySum = 0;
    let recoveryCount = 0;
    for (const pct of recoveries.values()) {
      recoverySum += pct;
      recoveryCount++;
    }
    const recoveryAvg = recoveryCount > 0 ? Math.round((recoverySum / recoveryCount) * 100) : 100;

    return {
      volume: { current: currentWeek?.working_sets ?? 0, target: Math.max(avgSets, 1) },
      consistency: { current: currentWeek?.days_trained ?? 0, target: Math.max(avgDays, 1) },
      recovery: { current: recoveryAvg, target: 100 },
    };
  });

  // Training load: 28-day EWMA of daily workout volume
  app.get('/training-load', async () => {
    // Get daily volume for the last 56 days (28 for current EWMA, 28 more for baseline)
    const rows = db.all<{ workout_date: string; volume: number; effort: number | null }>(sql`
      SELECT w.date as workout_date,
        SUM(s.reps * s.weight_kg * COALESCE(s.multiplier, 1.0)) as volume,
        w.effort_rating as effort
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN sets s ON s.workout_exercise_id = we.id
      WHERE w.date >= date('now', '-56 days')
        AND s.is_warmup = 0
        AND s.reps > 0
        AND s.weight_kg > 0
      GROUP BY w.id
      ORDER BY w.date ASC
    `);

    // Build daily volume map (sum if multiple workouts per day)
    const dailyVolume = new Map<string, number>();
    for (const r of rows) {
      // Scale volume by effort rating if available (normalize around 5)
      const effortFactor = r.effort ? r.effort / 5 : 1.0;
      const adjusted = r.volume * effortFactor;
      dailyVolume.set(r.workout_date, (dailyVolume.get(r.workout_date) ?? 0) + adjusted);
    }

    // Compute EWMA over 28-day windows
    const today = new Date();
    const alpha = 2 / (7 + 1); // ~7-day smoothing factor

    function computeEWMA(endDate: Date, days: number): number {
      let ewma = 0;
      for (let d = days - 1; d >= 0; d--) {
        const date = new Date(endDate);
        date.setDate(date.getDate() - d);
        const dateStr = date.toISOString().slice(0, 10);
        const vol = dailyVolume.get(dateStr) ?? 0;
        ewma = alpha * vol + (1 - alpha) * ewma;
      }
      return ewma;
    }

    const currentLoad = computeEWMA(today, 28);

    // Baseline: EWMA ending 28 days ago (the prior 28-day window)
    const baselineEnd = new Date(today);
    baselineEnd.setDate(baselineEnd.getDate() - 28);
    const baselineLoad = computeEWMA(baselineEnd, 28);

    // Ratio of current to baseline
    let ratio = 1.0;
    let label: 'well_below' | 'below' | 'steady' | 'above' | 'well_above' = 'steady';

    if (baselineLoad > 0) {
      ratio = currentLoad / baselineLoad;
      if (ratio < 0.7) label = 'well_below';
      else if (ratio < 0.9) label = 'below';
      else if (ratio <= 1.1) label = 'steady';
      else if (ratio <= 1.3) label = 'above';
      else label = 'well_above';
    } else if (currentLoad > 0) {
      label = 'above'; // training after a break
    }

    return {
      label,
      ratio: Math.round(ratio * 100) / 100,
      currentLoad: Math.round(currentLoad),
      baselineLoad: Math.round(baselineLoad),
    };
  });
}
