import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schemaTypes from '../schema/index.js';
import { getMusclesForExercise } from './recovery.js';

type DB = BetterSQLite3Database<typeof schemaTypes>;

export type ExerciseClass = 'barbell_compound' | 'dumbbell_compound' | 'accessory' | 'bodyweight' | 'cardio';
export type ProgressionDirective = 'up' | 'deload' | 'hold';

export interface RepRange {
  min: number;
  max: number;
  jump: number; // kg
}

export interface ProgressionResult {
  weightKg: number;
  reps: number;
  sets: number;
  directive: ProgressionDirective;
  repRange: RepRange;
  classification: ExerciseClass;
  isEstimate?: boolean;
}

// --- Classification ---

const BARBELL_COMPOUND = /barbell\s*(bench|squat|deadlift|overhead\s*press|row|pendlay|hip\s*thrust|front\s*squat|incline\s*bench|romanian\s*deadlift)|bench\s*press\s*\(barbell\)|squat\s*\(barbell\)/i;
const DUMBBELL_COMPOUND = /dumbbell\s*(press|row|lunge|fly|curl|bench|squat|shoulder\s*press|floor\s*press)|arnold\s*press/i;
const BODYWEIGHT = /bodyweight|pull.?up|push.?up|dip|chin.?up|muscle.?up|pistol|l-sit|plank|crunch|dead.?bug|windshield|russian\s*twist|toe\s*toucher|vertical\s*knee/i;
const CARDIO = /treadmill|elliptical|cycling|rowing/i;

export function classifyExercise(name: string): ExerciseClass {
  if (CARDIO.test(name)) return 'cardio';
  if (BODYWEIGHT.test(name)) return 'bodyweight';
  if (BARBELL_COMPOUND.test(name)) return 'barbell_compound';
  if (DUMBBELL_COMPOUND.test(name)) return 'dumbbell_compound';
  return 'accessory';
}

export function getRepRange(classification: ExerciseClass): RepRange {
  switch (classification) {
    case 'barbell_compound':  return { min: 4, max: 6, jump: 2.5 };
    case 'dumbbell_compound': return { min: 6, max: 10, jump: 2 };
    case 'accessory':         return { min: 8, max: 12, jump: 1 };
    case 'bodyweight':        return { min: 8, max: 15, jump: 0 };
    case 'cardio':            return { min: 1, max: 1, jump: 0 };
  }
}

// --- Session history ---

interface SessionSetRow {
  workout_date: string;
  reps: number;
  weight_kg: number;
}

interface SessionSummary {
  date: string;
  sets: { reps: number; weightKg: number }[];
}

function getRecentSessions(exerciseId: number, db: DB, count = 3): SessionSummary[] {
  const rows = db.all<SessionSetRow>(sql`
    SELECT w.date as workout_date, s.reps, s.weight_kg
    FROM sets s
    JOIN workout_exercises we ON s.workout_exercise_id = we.id
    JOIN workouts w ON we.workout_id = w.id
    WHERE we.exercise_id = ${exerciseId}
      AND s.is_warmup = 0
      AND s.reps > 0
    ORDER BY w.date DESC, s.id ASC
  `);

  // Group by date, take latest `count` sessions
  const byDate = new Map<string, { reps: number; weightKg: number }[]>();
  for (const r of rows) {
    if (!byDate.has(r.workout_date)) byDate.set(r.workout_date, []);
    byDate.get(r.workout_date)!.push({ reps: r.reps, weightKg: r.weight_kg });
  }

  const sessions: SessionSummary[] = [];
  for (const [date, sets] of byDate) {
    sessions.push({ date, sets });
    if (sessions.length >= count) break;
  }

  return sessions;
}

// --- Progression logic ---

export function computeProgression(exerciseId: number, exerciseName: string, db: DB): ProgressionResult {
  const classification = classifyExercise(exerciseName);
  const repRange = getRepRange(classification);
  const defaultSets = classification === 'cardio' ? 1 : 3;

  // No history — try muscle-group estimation, else return defaults
  const sessions = getRecentSessions(exerciseId, db);
  if (sessions.length === 0) {
    const estimated = estimateWeightForNewExercise(exerciseName, db);
    return {
      weightKg: estimated,
      reps: repRange.min + Math.floor((repRange.max - repRange.min) / 2),
      sets: defaultSets,
      directive: 'hold',
      repRange,
      classification,
      isEstimate: estimated > 0,
    };
  }

  const latest = sessions[0];
  const lastWeight = latest.sets[0]?.weightKg ?? 0;
  const lastAvgReps = Math.round(latest.sets.reduce((s, x) => s + x.reps, 0) / latest.sets.length);

  // Cardio and bodyweight without weight don't progress the same way
  if (classification === 'cardio') {
    return {
      weightKg: 0,
      reps: 1,
      sets: 1,
      directive: 'hold',
      repRange,
      classification,
    };
  }

  // Evaluate recent sessions against rep range
  const hitTarget = sessions.map(session => {
    // All working sets hit the top of the rep range
    return session.sets.every(s => s.reps >= repRange.max);
  });

  const missedMin = sessions.map(session => {
    // Any working set failed to reach the bottom of the rep range
    return session.sets.some(s => s.reps < repRange.min);
  });

  // Count how many of the recent sessions hit target or missed min
  const hitCount = hitTarget.filter(Boolean).length;
  const missCount = missedMin.filter(Boolean).length;

  // PROGRESS: Hit top of range in 2+ of last 3 sessions
  if (hitCount >= 2 && repRange.jump > 0) {
    return {
      weightKg: round(lastWeight + repRange.jump),
      reps: repRange.min,
      sets: defaultSets,
      directive: 'up',
      repRange,
      classification,
    };
  }

  // DELOAD: Missed bottom of range in 2+ of last 3 sessions
  if (missCount >= 2 && sessions.length >= 2) {
    const deloadWeight = round(lastWeight * 0.9);
    return {
      weightKg: deloadWeight,
      reps: repRange.min + Math.floor((repRange.max - repRange.min) / 2),
      sets: defaultSets,
      directive: 'deload',
      repRange,
      classification,
    };
  }

  // HOLD: Keep weight, suggest reps based on recent performance
  let suggestedReps = lastAvgReps;
  // If they hit the top last session but not consistently enough to progress, nudge up
  if (hitTarget[0] && suggestedReps < repRange.max) {
    suggestedReps = repRange.max;
  }
  // Clamp to rep range
  suggestedReps = Math.max(repRange.min, Math.min(repRange.max, suggestedReps));

  // For bodyweight: progress by adding reps
  if (classification === 'bodyweight' && hitCount >= 2) {
    return {
      weightKg: 0,
      reps: Math.min(repRange.max + 2, lastAvgReps + 1),
      sets: defaultSets,
      directive: 'up',
      repRange,
      classification,
    };
  }

  return {
    weightKg: round(lastWeight),
    reps: suggestedReps,
    sets: defaultSets,
    directive: 'hold',
    repRange,
    classification,
  };
}

// --- Strength estimation for new exercises ---

// Conversion factors when comparing across exercise types
const TYPE_CONVERSIONS: Record<string, Record<string, number>> = {
  barbell_compound:  { dumbbell_compound: 1.6, accessory: 2.0 },
  dumbbell_compound: { barbell_compound: 0.6, accessory: 1.25 },
  accessory:         { barbell_compound: 0.5, dumbbell_compound: 0.8 },
};

interface StrengthRow {
  exercise_name: string;
  weight_kg: number;
}

export function estimateWeightForNewExercise(exerciseName: string, db: DB): number {
  const targetClass = classifyExercise(exerciseName);
  if (targetClass === 'bodyweight' || targetClass === 'cardio') return 0;

  // Get target muscles from the exercise name
  const targetMuscles = getMusclesForExercise(exerciseName);
  if (targetMuscles.length === 0) return 0;

  // Find recent working weights for exercises sharing primary muscles
  const rows = db.all<StrengthRow>(sql`
    SELECT e.name as exercise_name, s.weight_kg
    FROM sets s
    JOIN workout_exercises we ON s.workout_exercise_id = we.id
    JOIN workouts w ON we.workout_id = w.id
    JOIN exercises e ON we.exercise_id = e.id
    WHERE s.is_warmup = 0
      AND s.reps > 0
      AND s.weight_kg > 0
    ORDER BY w.date DESC
    LIMIT 500
  `);

  if (rows.length === 0) return 0;

  // Group by exercise, keeping only exercises that share a primary muscle
  const byExercise = new Map<string, number[]>();
  for (const r of rows) {
    const muscles = getMusclesForExercise(r.exercise_name);
    const shared = muscles.some(m => targetMuscles.includes(m));
    if (!shared) continue;
    if (!byExercise.has(r.exercise_name)) byExercise.set(r.exercise_name, []);
    byExercise.get(r.exercise_name)!.push(r.weight_kg);
  }

  if (byExercise.size === 0) return 0;

  // Compute average working weight per exercise, then adjust by type conversion
  let totalAdjusted = 0;
  let count = 0;

  for (const [name, weights] of byExercise) {
    const refClass = classifyExercise(name);
    const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;

    // Apply conversion factor if exercise types differ
    let factor = 1.0;
    if (refClass !== targetClass) {
      factor = TYPE_CONVERSIONS[targetClass]?.[refClass] ?? 1.0;
    }

    totalAdjusted += avgWeight * factor;
    count++;
  }

  if (count === 0) return 0;

  const estimate = totalAdjusted / count;

  // Apply 80% safety factor and round to nearest 1.25 kg
  const conservative = estimate * 0.8;
  return Math.round(conservative / 1.25) * 1.25;
}

// --- Batch progression (avoids N+1) ---

function getRecentSessionsBatch(exerciseIds: number[], db: DB, count = 3): Map<number, SessionSummary[]> {
  if (exerciseIds.length === 0) return new Map();

  const placeholders = exerciseIds.map(() => '?').join(',');
  const rows = db.all<SessionSetRow & { exercise_id: number }>(
    sql`SELECT we.exercise_id, w.date as workout_date, s.reps, s.weight_kg
    FROM sets s
    JOIN workout_exercises we ON s.workout_exercise_id = we.id
    JOIN workouts w ON we.workout_id = w.id
    WHERE we.exercise_id IN (${sql.join(exerciseIds.map(id => sql`${id}`), sql`, `)})
      AND s.is_warmup = 0
      AND s.reps > 0
    ORDER BY w.date DESC, s.id ASC`
  );

  // Group by exerciseId → date → sets
  const byExercise = new Map<number, Map<string, { reps: number; weightKg: number }[]>>();
  for (const r of rows) {
    if (!byExercise.has(r.exercise_id)) byExercise.set(r.exercise_id, new Map());
    const byDate = byExercise.get(r.exercise_id)!;
    if (!byDate.has(r.workout_date)) byDate.set(r.workout_date, []);
    byDate.get(r.workout_date)!.push({ reps: r.reps, weightKg: r.weight_kg });
  }

  const result = new Map<number, SessionSummary[]>();
  for (const [exId, byDate] of byExercise) {
    const sessions: SessionSummary[] = [];
    for (const [date, sets] of byDate) {
      sessions.push({ date, sets });
      if (sessions.length >= count) break;
    }
    result.set(exId, sessions);
  }
  return result;
}

/**
 * Compute progression for multiple exercises at once, using a single DB query.
 */
export function computeProgressionBatch(
  exercises: { id: number; name: string }[],
  db: DB
): Map<number, ProgressionResult> {
  const ids = exercises.map(e => e.id);
  const sessionsByExercise = getRecentSessionsBatch(ids, db);
  const results = new Map<number, ProgressionResult>();

  for (const ex of exercises) {
    const classification = classifyExercise(ex.name);
    const repRange = getRepRange(classification);
    const defaultSets = classification === 'cardio' ? 1 : 3;
    const sessions = sessionsByExercise.get(ex.id) ?? [];

    if (sessions.length === 0) {
      const estimated = estimateWeightForNewExercise(ex.name, db);
      results.set(ex.id, {
        weightKg: estimated,
        reps: repRange.min + Math.floor((repRange.max - repRange.min) / 2),
        sets: defaultSets,
        directive: 'hold',
        repRange,
        classification,
        isEstimate: estimated > 0,
      });
      continue;
    }

    const latest = sessions[0];
    const lastWeight = latest.sets[0]?.weightKg ?? 0;
    const lastAvgReps = Math.round(latest.sets.reduce((s, x) => s + x.reps, 0) / latest.sets.length);

    if (classification === 'cardio') {
      results.set(ex.id, { weightKg: 0, reps: 1, sets: 1, directive: 'hold', repRange, classification });
      continue;
    }

    const hitTarget = sessions.map(session => session.sets.every(s => s.reps >= repRange.max));
    const missedMin = sessions.map(session => session.sets.some(s => s.reps < repRange.min));
    const hitCount = hitTarget.filter(Boolean).length;
    const missCount = missedMin.filter(Boolean).length;

    if (hitCount >= 2 && repRange.jump > 0) {
      results.set(ex.id, { weightKg: round(lastWeight + repRange.jump), reps: repRange.min, sets: defaultSets, directive: 'up', repRange, classification });
      continue;
    }

    if (missCount >= 2 && sessions.length >= 2) {
      results.set(ex.id, { weightKg: round(lastWeight * 0.9), reps: repRange.min + Math.floor((repRange.max - repRange.min) / 2), sets: defaultSets, directive: 'deload', repRange, classification });
      continue;
    }

    let suggestedReps = lastAvgReps;
    if (hitTarget[0] && suggestedReps < repRange.max) suggestedReps = repRange.max;
    suggestedReps = Math.max(repRange.min, Math.min(repRange.max, suggestedReps));

    if (classification === 'bodyweight' && hitCount >= 2) {
      results.set(ex.id, { weightKg: 0, reps: Math.min(repRange.max + 2, lastAvgReps + 1), sets: defaultSets, directive: 'up', repRange, classification });
      continue;
    }

    results.set(ex.id, { weightKg: round(lastWeight), reps: suggestedReps, sets: defaultSets, directive: 'hold', repRange, classification });
  }

  return results;
}

function round(kg: number): number {
  return Math.round(kg * 100) / 100;
}
