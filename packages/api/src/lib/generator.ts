import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schemaTypes from '../schema/index.js';
import { getMusclesForExercise, getGlobalRecoveryModifier } from './recovery.js';

type DB = BetterSQLite3Database<typeof schemaTypes>;

const DAY_TYPE_MUSCLES: Record<string, string[]> = {
  push: ['chest', 'shoulders', 'triceps'],
  pull: ['back', 'biceps'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves'],
};

const TRAVEL_KEYWORDS = /dumbbell|bodyweight|band|trx|cardio/i;

interface ExerciseRow {
  id: number;
  name: string;
}

interface LastSetRow {
  reps: number | null;
  weight_kg: number | null;
}

interface LastPerformedRow {
  date: string;
}

export interface GeneratedExercise {
  id: number;
  name: string;
  suggestedSets: number;
  suggestedReps: number;
  suggestedWeightKg: number;
  lastPerformedDaysAgo: number;
}

export interface GeneratedWorkout {
  dayType: string;
  globalModifier: number;
  exercises: GeneratedExercise[];
}

export function generateWorkout(dayType: string, equipment: string, db: DB): GeneratedWorkout {
  const targetMuscles = DAY_TYPE_MUSCLES[dayType];
  if (!targetMuscles) {
    throw new Error(`Unknown day type: ${dayType}. Use push, pull, or legs.`);
  }

  // Get all exercises
  const allExercises = db.all<ExerciseRow>(sql`SELECT id, name FROM exercises`);

  // Filter to exercises matching target muscles
  let candidates = allExercises.filter(e => {
    const muscles = getMusclesForExercise(e.name);
    return muscles.some(m => targetMuscles.includes(m));
  });

  // Equipment filter for travel mode
  if (equipment === 'travel') {
    candidates = candidates.filter(e => TRAVEL_KEYWORDS.test(e.name));
  }

  const now = Date.now();

  // Score each candidate: days_since_last_performed / 7, clamped 0-1
  const scored = candidates.map(e => {
    const lastPerformed = db.all<LastPerformedRow>(sql`
      SELECT w.date FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      WHERE we.exercise_id = ${e.id}
      ORDER BY w.date DESC
      LIMIT 1
    `);

    let daysSince = 7; // default if never performed
    if (lastPerformed.length > 0) {
      daysSince = (now - new Date(lastPerformed[0].date).getTime()) / (1000 * 60 * 60 * 24);
    }

    const score = Math.min(1, daysSince / 7);
    const muscles = getMusclesForExercise(e.name);
    return { ...e, score, daysSince, muscles };
  });

  // Sort by score descending (prefer not recently done)
  scored.sort((a, b) => b.score - a.score);

  // Pick top 6-8, max 2 per muscle group
  const selected: typeof scored = [];
  const muscleCount: Record<string, number> = {};

  for (const candidate of scored) {
    if (selected.length >= 8) break;

    // Check muscle group limits
    const canAdd = candidate.muscles.every(m => (muscleCount[m] ?? 0) < 2);
    if (!canAdd) continue;

    selected.push(candidate);
    for (const m of candidate.muscles) {
      muscleCount[m] = (muscleCount[m] ?? 0) + 1;
    }
  }

  // Ensure at least 6 if possible (relax muscle limit)
  if (selected.length < 6) {
    for (const candidate of scored) {
      if (selected.length >= 6) break;
      if (selected.find(s => s.id === candidate.id)) continue;
      selected.push(candidate);
    }
  }

  const globalModifier = getGlobalRecoveryModifier(db);

  // Build exercise suggestions
  const exercises: GeneratedExercise[] = selected.map(e => {
    // Look up last non-warmup set
    const lastSet = db.all<LastSetRow>(sql`
      SELECT s.reps, s.weight_kg FROM sets s
      JOIN workout_exercises we ON s.workout_exercise_id = we.id
      WHERE we.exercise_id = ${e.id}
        AND s.is_warmup = 0
      ORDER BY s.id DESC
      LIMIT 1
    `);

    const suggestedReps = lastSet.length > 0 && lastSet[0].reps ? lastSet[0].reps : 10;
    const suggestedWeightKg = lastSet.length > 0 && lastSet[0].weight_kg ? lastSet[0].weight_kg : 0;

    return {
      id: e.id,
      name: e.name,
      suggestedSets: 3,
      suggestedReps,
      suggestedWeightKg: Math.round(suggestedWeightKg * 100) / 100,
      lastPerformedDaysAgo: Math.round(e.daysSince * 10) / 10,
    };
  });

  return { dayType, globalModifier, exercises };
}
