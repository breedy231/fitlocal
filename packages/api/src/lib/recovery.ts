import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schemaTypes from '../schema/index.js';

type DB = BetterSQLite3Database<typeof schemaTypes>;

const PRIMARY_HALF_LIFE_HOURS = 48;
const LOOKBACK_DAYS = 14;

// Keyword-based muscle mapping for exercises
const MUSCLE_KEYWORDS: Record<string, RegExp> = {
  chest: /bench|fly|pushup|push.?up|crossover|pec|(?:machine|cable|dumbbell|barbell)\s+press(?!\s+(?:leg|shoulder|calf|hip))/i,
  shoulders: /shoulder.?press|lateral.?raise|front.?raise|face.?pull|rear.?delt|upright.?row|ohp|military/i,
  triceps: /tricep|skullcrusher|skull.?crusher|(?:dumbbell|cable).?kickback|dip(?!\s*belt)|overhead.?extension/i,
  back: /row(?!.*upright)|pulldown|pull.?up|lat\b|good.?morning|chin.?up/i,
  biceps: /curl|hammer|preacher|ez.?bar/i,
  quads: /squat|leg.?press|leg.?extension|lunge|front.?squat|step.?up/i,
  hamstrings: /deadlift|hamstring.?curl|rdl|romanian|stiff.?leg/i,
  glutes: /hip.?thrust|glute|hip.?extension|cable.?pull.?through|(?:single.?leg|standing).?kickback/i,
  calves: /calf|standing.?calf/i,
  core: /crunch|plank|dead.?bug|windshield.?wiper|russian.?twist|toe.?toucher|vertical.?knee.?raise|abs/i,
};

// Cache: exercise name → muscle list (avoids re-running regex on every call)
const muscleCache = new Map<string, string[]>();

export function getMusclesForExercise(exerciseName: string): string[] {
  let cached = muscleCache.get(exerciseName);
  if (cached) return cached;

  const muscles: string[] = [];
  for (const [muscle, pattern] of Object.entries(MUSCLE_KEYWORDS)) {
    if (pattern.test(exerciseName)) {
      muscles.push(muscle);
    }
  }
  muscleCache.set(exerciseName, muscles);
  return muscles;
}

interface SetRow {
  reps: number | null;
  weight_kg: number | null;
  multiplier: number | null;
  workout_date: string;
  exercise_name: string;
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Compute recovery for all muscle groups in 2 queries instead of 2 per muscle.
 */
export function computeAllMuscleRecoveries(db: DB): Map<string, number> {
  const now = Date.now();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Query 1: Recent sets (for current fatigue calculation)
  const recentRows = db.all<SetRow>(sql`
    SELECT s.reps, s.weight_kg, s.multiplier, w.date as workout_date, e.name as exercise_name
    FROM sets s
    JOIN workout_exercises we ON s.workout_exercise_id = we.id
    JOIN workouts w ON we.workout_id = w.id
    JOIN exercises e ON we.exercise_id = e.id
    WHERE w.date >= ${cutoffStr}
  `);

  // Query 2: All historical sets (for percentile threshold)
  const allRows = db.all<SetRow>(sql`
    SELECT s.reps, s.weight_kg, s.multiplier, w.date as workout_date, e.name as exercise_name
    FROM sets s
    JOIN workout_exercises we ON s.workout_exercise_id = we.id
    JOIN workouts w ON we.workout_id = w.id
    JOIN exercises e ON we.exercise_id = e.id
  `);

  // Bucket into muscle groups
  const recentByMuscle = new Map<string, SetRow[]>();
  const historicalByMuscle = new Map<string, Map<string, number>>(); // muscle → (date → sessionLoad)

  for (const row of recentRows) {
    for (const muscle of getMusclesForExercise(row.exercise_name)) {
      if (!recentByMuscle.has(muscle)) recentByMuscle.set(muscle, []);
      recentByMuscle.get(muscle)!.push(row);
    }
  }

  for (const row of allRows) {
    const load = (row.reps ?? 0) * (row.weight_kg ?? 0) * (row.multiplier ?? 1);
    for (const muscle of getMusclesForExercise(row.exercise_name)) {
      if (!historicalByMuscle.has(muscle)) historicalByMuscle.set(muscle, new Map());
      const sessions = historicalByMuscle.get(muscle)!;
      sessions.set(row.workout_date, (sessions.get(row.workout_date) ?? 0) + load);
    }
  }

  // Compute recovery per muscle
  const results = new Map<string, number>();

  for (const [muscle] of Object.entries(MUSCLE_KEYWORDS)) {
    const recentSets = recentByMuscle.get(muscle) ?? [];
    if (recentSets.length === 0) {
      results.set(muscle, 1);
      continue;
    }

    // Current fatigue with exponential decay
    let currentFatigue = 0;
    for (const s of recentSets) {
      const load = (s.reps ?? 0) * (s.weight_kg ?? 0) * (s.multiplier ?? 1);
      const hoursElapsed = (now - new Date(s.workout_date).getTime()) / (1000 * 60 * 60);
      currentFatigue += load * Math.exp(-Math.LN2 / PRIMARY_HALF_LIFE_HOURS * hoursElapsed);
    }

    // Historical session fatigue for percentile threshold
    const sessions = historicalByMuscle.get(muscle);
    const sessionFatigues = sessions ? Array.from(sessions.values()) : [];
    const maxThreshold = percentile95(sessionFatigues);

    const recovery = 1 - (currentFatigue / maxThreshold);
    results.set(muscle, Math.max(0, Math.min(1, recovery)));
  }

  return results;
}

/** Single-muscle recovery (kept for backward compat if needed elsewhere) */
export function computeMuscleRecovery(muscle: string, db: DB): number {
  // For single-muscle calls, delegate to the batch function
  // This is less efficient than calling computeAllMuscleRecoveries once,
  // but maintains the API for any code that still calls it
  const all = computeAllMuscleRecoveries(db);
  return all.get(muscle) ?? 1;
}

interface HealthSnapshot {
  hrv: number | null;
  resting_hr: number | null;
  date: string;
}

export function getGlobalRecoveryModifier(db: DB): number {
  const snapshots = db.all<HealthSnapshot>(sql`
    SELECT hrv, resting_hr, date FROM health_snapshots
    ORDER BY date DESC
    LIMIT 30
  `);

  if (snapshots.length === 0) return 1.0;

  const latest = snapshots[0];
  let modifier = 1.0;

  // HRV check
  const hrvValues = snapshots.filter(s => s.hrv != null).map(s => s.hrv!);
  if (hrvValues.length > 0 && latest.hrv != null) {
    const avgHrv = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length;
    if (latest.hrv < avgHrv * 0.7) {
      modifier *= 0.85;
    }
  }

  // Resting HR check
  const hrValues = snapshots.filter(s => s.resting_hr != null).map(s => s.resting_hr!);
  if (hrValues.length > 0 && latest.resting_hr != null) {
    const avgHr = hrValues.reduce((a, b) => a + b, 0) / hrValues.length;
    if (latest.resting_hr > avgHr * 1.1) {
      modifier *= 0.90;
    }
  }

  return Math.max(0.7, modifier);
}
