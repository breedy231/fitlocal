import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schemaTypes from '../schema/index.js';
import { getMusclesForExercise, getGlobalRecoveryModifier } from './recovery.js';

type DB = BetterSQLite3Database<typeof schemaTypes>;

const DAY_TYPE_MUSCLES: Record<string, string[]> = {
  upper: ['chest', 'shoulders', 'triceps', 'back', 'biceps'],
  lower: ['quads', 'hamstrings', 'glutes', 'calves'],
  fullbody: ['chest', 'shoulders', 'triceps', 'back', 'biceps', 'quads', 'hamstrings', 'glutes', 'calves'],
};

// Muscle group targets per day type: [muscle, count]
const UPPER_TARGETS: [string, number][] = [
  ['back', 2],
  ['chest', 2],
  ['shoulders', 1],
  ['biceps', 1],
  ['triceps', 1],
];

const LOWER_TARGETS: [string, number][] = [
  ['quads', 2],
  ['hamstrings', 2],
  ['glutes', 2],
  ['calves', 1],
];

const CORE_KEYWORDS = /crunch|plank|dead.?bug|windshield.?wiper|reverse.?crunch|cable.?crunch|exercise.?ball.?crunch|russian.?twist|toe.?toucher|vertical.?knee.?raise/i;
const CARDIO_KEYWORDS = /treadmill|elliptical|cycling|rowing/i;

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
  isFocus: boolean;
  isCardio: boolean;
  suggestedDurationSec?: number;
}

export interface GeneratedWorkout {
  dayType: string;
  globalModifier: number;
  exercises: GeneratedExercise[];
}

interface ScoredExercise extends ExerciseRow {
  score: number;
  daysSince: number;
  muscles: string[];
}

function scoreExercises(candidates: ExerciseRow[], db: DB): ScoredExercise[] {
  const now = Date.now();
  return candidates.map(e => {
    const lastPerformed = db.all<LastPerformedRow>(sql`
      SELECT w.date FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      WHERE we.exercise_id = ${e.id}
      ORDER BY w.date DESC
      LIMIT 1
    `);

    let daysSince = 7;
    if (lastPerformed.length > 0) {
      daysSince = (now - new Date(lastPerformed[0].date).getTime()) / (1000 * 60 * 60 * 24);
    }

    const score = Math.min(1, daysSince / 7);
    const muscles = getMusclesForExercise(e.name);
    return { ...e, score, daysSince, muscles };
  });
}

function pickByMuscleTargets(
  scored: ScoredExercise[],
  targets: [string, number][],
): ScoredExercise[] {
  const selected: ScoredExercise[] = [];
  const usedIds = new Set<number>();

  for (const [muscle, count] of targets) {
    const muscleExercises = scored
      .filter(e => !usedIds.has(e.id) && e.muscles.includes(muscle))
      .sort((a, b) => b.score - a.score);

    for (let i = 0; i < count && i < muscleExercises.length; i++) {
      selected.push(muscleExercises[i]);
      usedIds.add(muscleExercises[i].id);
    }
  }

  return selected;
}

function getLastSetInfo(exerciseId: number, db: DB): LastSetRow | null {
  const lastSet = db.all<LastSetRow>(sql`
    SELECT s.reps, s.weight_kg FROM sets s
    JOIN workout_exercises we ON s.workout_exercise_id = we.id
    WHERE we.exercise_id = ${exerciseId}
      AND s.is_warmup = 0
    ORDER BY s.id DESC
    LIMIT 1
  `);
  return lastSet.length > 0 ? lastSet[0] : null;
}

export function generateWorkout(dayType: string, equipment: string, db: DB): GeneratedWorkout {
  const targetMuscles = DAY_TYPE_MUSCLES[dayType];
  if (!targetMuscles) {
    throw new Error(`Unknown day type: ${dayType}. Use upper, lower, or fullbody.`);
  }

  const allExercises = db.all<ExerciseRow>(sql`SELECT id, name FROM exercises`);

  // Filter to exercises matching target muscles (excluding core/cardio - those are added separately)
  let candidates = allExercises.filter(e => {
    if (CORE_KEYWORDS.test(e.name) || CARDIO_KEYWORDS.test(e.name)) return false;
    const muscles = getMusclesForExercise(e.name);
    return muscles.some(m => targetMuscles.includes(m));
  });

  if (equipment === 'travel') {
    candidates = candidates.filter(e => TRAVEL_KEYWORDS.test(e.name));
  }

  const scored = scoreExercises(candidates, db);

  // Pick exercises by muscle group targets
  let targets: [string, number][];
  if (dayType === 'upper') {
    targets = UPPER_TARGETS;
  } else if (dayType === 'lower') {
    targets = LOWER_TARGETS;
  } else {
    // fullbody: mix of upper and lower
    targets = [
      ['back', 1], ['chest', 1], ['shoulders', 1],
      ['quads', 1], ['hamstrings', 1], ['glutes', 1],
      ['biceps', 1], ['triceps', 1],
    ];
  }

  const selected = pickByMuscleTargets(scored, targets);

  // Pick core exercises (2)
  let coreCandidates = allExercises.filter(e => CORE_KEYWORDS.test(e.name));
  if (equipment === 'travel') {
    coreCandidates = coreCandidates.filter(e => TRAVEL_KEYWORDS.test(e.name) || /crunch|plank|dead.?bug|russian.?twist|toe.?toucher/i.test(e.name));
  }
  const scoredCore = scoreExercises(coreCandidates, db).sort((a, b) => b.score - a.score);
  const coreSelected = scoredCore.slice(0, 2);

  // Pick cardio exercise (1)
  let cardioCandidates = allExercises.filter(e => CARDIO_KEYWORDS.test(e.name));
  const scoredCardio = scoreExercises(cardioCandidates, db).sort((a, b) => b.score - a.score);
  const cardioSelected = scoredCardio.slice(0, 1);

  const globalModifier = getGlobalRecoveryModifier(db);

  // Build exercise suggestions and find focus exercise
  let bestProgressionScore = -1;
  let focusIndex = -1;

  const buildExercise = (e: ScoredExercise, isCardio: boolean): GeneratedExercise => {
    const lastSet = getLastSetInfo(e.id, db);
    const suggestedReps = lastSet?.reps ?? 10;
    const suggestedWeightKg = lastSet?.weight_kg ?? 0;

    return {
      id: e.id,
      name: e.name,
      suggestedSets: isCardio ? 1 : 3,
      suggestedReps: isCardio ? 1 : suggestedReps,
      suggestedWeightKg: isCardio ? 0 : Math.round(suggestedWeightKg * 100) / 100,
      lastPerformedDaysAgo: Math.round(e.daysSince * 10) / 10,
      isFocus: false,
      isCardio,
      ...(isCardio ? { suggestedDurationSec: 900 } : {}),
    };
  };

  const exercises: GeneratedExercise[] = [];

  // Main exercises
  for (const e of selected) {
    const ex = buildExercise(e, false);
    exercises.push(ex);

    // Check progression opportunity: last reps >= suggested reps means ready to progress
    const lastSet = getLastSetInfo(e.id, db);
    if (lastSet?.reps && lastSet.reps >= ex.suggestedReps) {
      const progressionScore = e.score + (lastSet.reps - ex.suggestedReps) * 0.1;
      if (progressionScore > bestProgressionScore) {
        bestProgressionScore = progressionScore;
        focusIndex = exercises.length - 1;
      }
    }
  }

  // Core exercises
  for (const e of coreSelected) {
    exercises.push(buildExercise(e, false));
  }

  // Cardio
  for (const e of cardioSelected) {
    exercises.push(buildExercise(e, true));
  }

  // Mark focus exercise
  if (focusIndex >= 0) {
    exercises[focusIndex].isFocus = true;
  }

  return { dayType, globalModifier, exercises };
}
