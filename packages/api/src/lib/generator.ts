import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schemaTypes from '../schema/index.js';
import { getMusclesForExercise, getGlobalRecoveryModifier } from './recovery.js';
import { computeProgression, type ProgressionDirective, type RepRange } from './progression.js';

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
  rest_seconds: number | null;
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
  restSeconds: number;
  progression?: ProgressionDirective;
  repRange?: { min: number; max: number };
  supersetGroup?: number;
}

export interface GeneratedWorkout {
  dayType: string;
  globalModifier: number;
  exercises: GeneratedExercise[];
}

// Antagonist muscle pairs for superset matching
const ANTAGONIST_PAIRS: [string, string][] = [
  ['chest', 'back'],
  ['biceps', 'triceps'],
  ['quads', 'hamstrings'],
];

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

export function generateWorkout(dayType: string, equipment: string, db: DB, options?: { supersets?: boolean }): GeneratedWorkout {
  const targetMuscles = DAY_TYPE_MUSCLES[dayType];
  if (!targetMuscles) {
    throw new Error(`Unknown day type: ${dayType}. Use upper, lower, or fullbody.`);
  }

  const allExercises = db.all<ExerciseRow>(sql`SELECT id, name, rest_seconds FROM exercises`);

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
  const suppressProgression = globalModifier < 0.85;

  // Build exercise suggestions using progressive overload
  const buildExercise = (e: ScoredExercise, isCardio: boolean): GeneratedExercise => {
    const prog = computeProgression(e.id, e.name, db);

    let suggestedSets = prog.sets;
    let suggestedReps = prog.reps;
    let suggestedWeightKg = prog.weightKg;
    let directive = prog.directive;

    // On bad recovery days, suppress progressions
    if (suppressProgression && directive === 'up') {
      directive = 'hold';
      // Use last weight instead of progressed weight
      suggestedWeightKg = Math.max(0, suggestedWeightKg - prog.repRange.jump);
      suggestedSets = Math.max(2, suggestedSets - 1);
    }

    return {
      id: e.id,
      name: e.name,
      suggestedSets: isCardio ? 1 : suggestedSets,
      suggestedReps: isCardio ? 1 : suggestedReps,
      suggestedWeightKg: isCardio ? 0 : suggestedWeightKg,
      lastPerformedDaysAgo: Math.round(e.daysSince * 10) / 10,
      isFocus: false,
      isCardio,
      restSeconds: e.rest_seconds ?? 60,
      progression: isCardio ? undefined : directive,
      repRange: isCardio ? undefined : { min: prog.repRange.min, max: prog.repRange.max },
      ...(isCardio ? { suggestedDurationSec: 900 } : {}),
    };
  };

  const exercises: GeneratedExercise[] = [];

  // Main exercises — track best focus candidate
  let bestFocusScore = -1;
  let focusIndex = -1;

  for (const e of selected) {
    const ex = buildExercise(e, false);
    exercises.push(ex);

    // Focus = exercise that's progressing (or closest to it)
    if (ex.progression === 'up') {
      const focusScore = e.score + 1; // Progressing exercises get priority
      if (focusScore > bestFocusScore) {
        bestFocusScore = focusScore;
        focusIndex = exercises.length - 1;
      }
    } else if (ex.progression === 'hold' && focusIndex < 0) {
      // Fallback: pick the hold exercise with highest recovery score
      if (e.score > bestFocusScore) {
        bestFocusScore = e.score;
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

  // Assign superset pairs (max 3 per workout) unless disabled
  if (options?.supersets !== false) {
    assignSupersets(exercises);
  }

  return { dayType, globalModifier, exercises };
}

function getAntagonist(muscle: string): string | null {
  for (const [a, b] of ANTAGONIST_PAIRS) {
    if (muscle === a) return b;
    if (muscle === b) return a;
  }
  return null;
}

function assignSupersets(exercises: GeneratedExercise[]): void {
  const paired = new Set<number>();
  let groupNum = 1;
  const MAX_SUPERSETS = 3;

  for (let i = 0; i < exercises.length && groupNum <= MAX_SUPERSETS; i++) {
    if (paired.has(i) || exercises[i].isCardio) continue;
    const muscles = getMusclesForExercise(exercises[i].name);
    if (muscles.length === 0) continue;

    const primaryMuscle = muscles[0];
    const antagonist = getAntagonist(primaryMuscle);
    if (!antagonist) continue;

    // Find a partner exercise that targets the antagonist muscle
    for (let j = i + 1; j < exercises.length; j++) {
      if (paired.has(j) || exercises[j].isCardio) continue;
      const partnerMuscles = getMusclesForExercise(exercises[j].name);
      if (partnerMuscles.includes(antagonist)) {
        exercises[i].supersetGroup = groupNum;
        exercises[j].supersetGroup = groupNum;
        paired.add(i);
        paired.add(j);
        groupNum++;
        break;
      }
    }
  }
}
