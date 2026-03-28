import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schemaTypes from '../schema/index.js';

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

  // No history — return defaults
  const sessions = getRecentSessions(exerciseId, db);
  if (sessions.length === 0) {
    return {
      weightKg: 0,
      reps: repRange.min + Math.floor((repRange.max - repRange.min) / 2),
      sets: defaultSets,
      directive: 'hold',
      repRange,
      classification,
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

function round(kg: number): number {
  return Math.round(kg * 100) / 100;
}
