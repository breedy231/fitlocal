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
  triceps: /tricep|skullcrusher|skull.?crusher|(?<!glute\s)kickback(?!\s*machine)|dip(?!\s*belt)|overhead.?extension/i,
  back: /row(?!.*upright)|pulldown|pull.?up|lat\b|good.?morning|chin.?up/i,
  biceps: /curl|hammer|preacher|ez.?bar/i,
  quads: /squat|leg.?press|leg.?extension|lunge|front.?squat|step.?up/i,
  hamstrings: /deadlift|hamstring.?curl|rdl|romanian|stiff.?leg/i,
  glutes: /hip.?thrust|glute|hip.?extension|cable.?pull.?through/i,
  calves: /calf|standing.?calf/i,
  core: /crunch|plank|dead.?bug|windshield.?wiper|russian.?twist|toe.?toucher|vertical.?knee.?raise|abs/i,
};

export function getMusclesForExercise(exerciseName: string): string[] {
  const muscles: string[] = [];
  for (const [muscle, pattern] of Object.entries(MUSCLE_KEYWORDS)) {
    if (pattern.test(exerciseName)) {
      muscles.push(muscle);
    }
  }
  return muscles;
}

interface SetRow {
  reps: number | null;
  weight_kg: number | null;
  multiplier: number | null;
  workout_date: string;
  exercise_name: string;
}

function getRecentSetsForMuscle(db: DB, muscle: string): SetRow[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const rows = db.all<SetRow>(sql`
    SELECT s.reps, s.weight_kg, s.multiplier, w.date as workout_date, e.name as exercise_name
    FROM sets s
    JOIN workout_exercises we ON s.workout_exercise_id = we.id
    JOIN workouts w ON we.workout_id = w.id
    JOIN exercises e ON we.exercise_id = e.id
    WHERE w.date >= ${cutoffStr}
  `);

  // Filter to sets whose exercise matches this muscle group
  return rows.filter(r => getMusclesForExercise(r.exercise_name).includes(muscle));
}

function getAllHistoricalSessionFatigue(db: DB, muscle: string): number[] {
  const rows = db.all<SetRow>(sql`
    SELECT s.reps, s.weight_kg, s.multiplier, w.date as workout_date, e.name as exercise_name
    FROM sets s
    JOIN workout_exercises we ON s.workout_exercise_id = we.id
    JOIN workouts w ON we.workout_id = w.id
    JOIN exercises e ON we.exercise_id = e.id
  `);

  // Group by workout date and sum fatigue per session
  const bySession = new Map<string, number>();
  for (const r of rows) {
    if (!getMusclesForExercise(r.exercise_name).includes(muscle)) continue;
    const load = (r.reps ?? 0) * (r.weight_kg ?? 0) * (r.multiplier ?? 1);
    bySession.set(r.workout_date, (bySession.get(r.workout_date) ?? 0) + load);
  }
  return Array.from(bySession.values());
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function computeMuscleRecovery(muscle: string, db: DB): number {
  const recentSets = getRecentSetsForMuscle(db, muscle);
  if (recentSets.length === 0) return 1;

  const now = Date.now();
  let currentFatigue = 0;
  for (const s of recentSets) {
    const load = (s.reps ?? 0) * (s.weight_kg ?? 0) * (s.multiplier ?? 1);
    const hoursElapsed = (now - new Date(s.workout_date).getTime()) / (1000 * 60 * 60);
    currentFatigue += load * Math.exp(-Math.LN2 / PRIMARY_HALF_LIFE_HOURS * hoursElapsed);
  }

  const sessionFatigues = getAllHistoricalSessionFatigue(db, muscle);
  const maxThreshold = percentile95(sessionFatigues);

  const recovery = 1 - (currentFatigue / maxThreshold);
  return Math.max(0, Math.min(1, recovery));
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
