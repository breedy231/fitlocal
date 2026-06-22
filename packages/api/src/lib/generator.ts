import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schemaTypes from '../schema/index.js';
import { getMusclesForExercise, getGlobalRecoveryModifier } from './recovery.js';
import { computeProgressionBatch, type ProgressionDirective, type RepRange } from './progression.js';
import { matchesEquipment, normalizeAvailableEquipment } from './equipment-match.js';
import { CARDIO_PATTERN } from 'fitlocal-shared';

type DB = BetterSQLite3Database<typeof schemaTypes>;

export const DAY_TYPE_MUSCLES: Record<string, string[]> = {
  upper: ['chest', 'shoulders', 'triceps', 'back', 'biceps'],
  lower: ['quads', 'hamstrings', 'glutes', 'calves'],
  push: ['chest', 'shoulders', 'triceps'],
  pull: ['back', 'biceps', 'shoulders'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves'],
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

const PUSH_TARGETS: [string, number][] = [
  ['chest', 3],
  ['shoulders', 2],
  ['triceps', 2],
];

const PULL_TARGETS: [string, number][] = [
  ['back', 3],
  ['biceps', 2],
  ['shoulders', 2],
];

const LEGS_TARGETS: [string, number][] = [
  ['quads', 2],
  ['hamstrings', 2],
  ['glutes', 2],
  ['calves', 1],
];

// Trainer-prescribed exercises (LVAC PT) — prioritized during PPL generation
const TRAINER_EXERCISES: Record<string, string[]> = {
  push: [
    'Barbell Bench Press', 'Dumbbell Shoulder Press', 'Dumbbell Incline Bench Press',
    'Dumbbell Kickbacks', 'Machine Fly', 'Push Up',
  ],
  pull: [
    'Lat Pulldown', 'TRX Row', 'Dumbbell Row', 'Preacher Curl',
    'Assisted Pull Up', 'Dumbbell Rear Delt Raise',
  ],
  legs: [
    'Back Squat', 'Seated Leg Curl', 'Leg Extension', 'Barbell Hip Thrust',
    'Dumbbell Bulgarian Split Squat', 'Walking Lunge', 'Calf Raise',
  ],
};

// Exercise families — prevent multiple variants of the same movement in one workout
const EXERCISE_FAMILIES: [string, RegExp][] = [
  ['curl', /(?<!leg\s)curl(?!.*hammer)(?!.*preacher)/i],
  ['hammer', /hammer/i],
  ['preacher', /preacher/i],
  ['row', /(?:dumbbell|barbell|cable|seated|t-bar|pendlay|trx)\s*row(?!.*upright)/i],
  ['press', /(?:bench|incline|decline)\s*press/i],
  ['fly', /fly|flye|crossover|pec.?deck/i],
  ['pulldown', /pulldown|pull.?down/i],
  ['pullup', /pull.?up|chin.?up/i],
  ['raise', /(?:lateral|front|rear.?delt)\s*raise/i],
  ['extension', /(?:tricep|overhead|cable)\s*extension|skullcrusher|skull.?crusher/i],
  ['kickback', /kickback/i],
  ['dip', /dip(?!\s*belt)/i],
  ['squat', /squat(?!.*split)/i],
  ['lunge', /lunge|split.?squat|step.?up/i],
  ['deadlift', /deadlift|rdl|romanian/i],
  ['legCurl', /leg.?curl|hamstring.?curl/i],
  ['legExtension', /leg.?extension/i],
  ['hipThrust', /hip.?thrust|glute.?bridge/i],
  ['calfRaise', /calf.?raise/i],
];

function getExerciseFamily(name: string): string | null {
  for (const [family, pattern] of EXERCISE_FAMILIES) {
    if (pattern.test(name)) return family;
  }
  return null;
}

const CORE_KEYWORDS = /crunch|plank|dead.?bug|windshield.?wiper|reverse.?crunch|cable.?crunch|exercise.?ball.?crunch|russian.?twist|toe.?toucher|vertical.?knee.?raise/i;
const CARDIO_KEYWORDS = CARDIO_PATTERN;

// Parse the JSON equipment-tag array stored on an exercise row. Tolerates null
// and malformed values (treats them as "no equipment required").
function parseEquip(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

interface DurationProfile {
  maxStrength: number;
  coreCount: number;
  cardioDurationSec: number;
}

const DURATION_PROFILES: Record<number, DurationProfile> = {
  30: { maxStrength: 4, coreCount: 1, cardioDurationSec: 600 },
  45: { maxStrength: 6, coreCount: 1, cardioDurationSec: 900 },
  60: { maxStrength: 7, coreCount: 2, cardioDurationSec: 900 },
  75: { maxStrength: 9, coreCount: 2, cardioDurationSec: 1200 },
  90: { maxStrength: 10, coreCount: 2, cardioDurationSec: 1500 },
  120: { maxStrength: 13, coreCount: 3, cardioDurationSec: 1800 },
};

function getDurationProfile(minutes?: number): DurationProfile {
  if (!minutes) return DURATION_PROFILES[60];
  return DURATION_PROFILES[minutes] ?? DURATION_PROFILES[60];
}

/**
 * Scale muscle targets down to fit a max exercise count.
 * Trims by removing 1 from highest-count groups first, preserving muscle diversity.
 */
function scaleMuscleTargets(targets: [string, number][], maxCount: number): [string, number][] {
  const scaled = targets.map(([m, c]) => [m, c] as [string, number]);
  let total = scaled.reduce((sum, [, c]) => sum + c, 0);

  while (total > maxCount) {
    // Find the group with the highest count
    let maxIdx = 0;
    for (let i = 1; i < scaled.length; i++) {
      if (scaled[i][1] > scaled[maxIdx][1]) maxIdx = i;
    }
    if (scaled[maxIdx][1] <= 1) {
      // All groups at 1 — remove from the end
      scaled.pop();
    } else {
      scaled[maxIdx][1]--;
    }
    total--;
  }

  return scaled.filter(([, c]) => c > 0);
}

interface ExerciseRow {
  id: number;
  name: string;
  rest_seconds: number | null;
  equipment: string | null;
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
  isInCut: boolean;
  volumeReductionPct?: number;
  programDriven?: boolean;
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

/**
 * Batch-fetch last performed dates for a set of exercise IDs in a single query.
 */
function batchLastPerformed(exerciseIds: number[], db: DB): Map<number, string> {
  if (exerciseIds.length === 0) return new Map();
  const rows = db.all<{ exercise_id: number; last_date: string }>(sql`
    SELECT we.exercise_id, MAX(w.date) as last_date
    FROM workout_exercises we
    JOIN workouts w ON we.workout_id = w.id
    WHERE we.exercise_id IN (${sql.join(exerciseIds.map(id => sql`${id}`), sql`, `)})
    GROUP BY we.exercise_id
  `);
  const result = new Map<number, string>();
  for (const r of rows) {
    result.set(r.exercise_id, r.last_date);
  }
  return result;
}

function scoreExercisesWithDates(candidates: ExerciseRow[], lastDates: Map<number, string>): ScoredExercise[] {
  const now = Date.now();
  return candidates.map(e => {
    const lastDate = lastDates.get(e.id);
    let daysSince = 7;
    if (lastDate) {
      daysSince = (now - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24);
    }
    const score = Math.min(1, daysSince / 7);
    const muscles = getMusclesForExercise(e.name);
    return { ...e, score, daysSince, muscles };
  });
}

function pickByMuscleTargets(
  scored: ScoredExercise[],
  targets: [string, number][],
  trainerNames?: Set<string>,
): ScoredExercise[] {
  const selected: ScoredExercise[] = [];
  const usedIds = new Set<number>();
  const usedFamilies = new Set<string>();

  for (const [muscle, count] of targets) {
    const muscleExercises = scored
      .filter(e => !usedIds.has(e.id) && e.muscles.includes(muscle));

    // Trainer exercises first, then general pool — both sorted by recency score
    let ordered: ScoredExercise[];
    if (trainerNames && trainerNames.size > 0) {
      const trainer = muscleExercises.filter(e => trainerNames.has(e.name)).sort((a, b) => b.score - a.score);
      const others = muscleExercises.filter(e => !trainerNames.has(e.name)).sort((a, b) => b.score - a.score);
      ordered = [...trainer, ...others];
    } else {
      ordered = muscleExercises.sort((a, b) => b.score - a.score);
    }

    let picked = 0;
    for (const candidate of ordered) {
      if (picked >= count) break;
      const family = getExerciseFamily(candidate.name);
      if (family && usedFamilies.has(family)) continue;
      selected.push(candidate);
      usedIds.add(candidate.id);
      if (family) usedFamilies.add(family);
      picked++;
    }
  }

  return selected;
}

/**
 * Interleave exercises so consecutive exercises target different muscles.
 * Round-robins through muscle-group buckets for even distribution.
 */
function interleaveByMuscle(exercises: ScoredExercise[]): ScoredExercise[] {
  const buckets = new Map<string, ScoredExercise[]>();
  const bucketOrder: string[] = [];
  for (const ex of exercises) {
    const primary = ex.muscles[0] ?? 'other';
    if (!buckets.has(primary)) {
      buckets.set(primary, []);
      bucketOrder.push(primary);
    }
    buckets.get(primary)!.push(ex);
  }

  const result: ScoredExercise[] = [];
  let idx = 0;
  while (result.length < exercises.length) {
    if (bucketOrder.length === 0) break;
    const key = bucketOrder[idx % bucketOrder.length];
    const bucket = buckets.get(key)!;
    if (bucket.length > 0) {
      result.push(bucket.shift()!);
      idx++;
    }
    if (bucket.length === 0) {
      const removeIdx = bucketOrder.indexOf(key);
      bucketOrder.splice(removeIdx, 1);
      if (bucketOrder.length > 0) {
        idx = idx % bucketOrder.length;
      }
    }
  }
  return result;
}

export function generateWorkout(dayType: string, equipment: string[] | null, db: DB, options?: { supersets?: boolean; durationMinutes?: number; isInCut?: boolean }): GeneratedWorkout {
  const targetMuscles = DAY_TYPE_MUSCLES[dayType];
  if (!targetMuscles) {
    throw new Error(`Unknown day type: ${dayType}. Use upper, lower, or fullbody.`);
  }

  const allExercises = db.all<ExerciseRow>(sql`SELECT id, name, rest_seconds, equipment FROM exercises`);

  // Normalize the location's available equipment once (expands legacy aliases).
  const available = equipment && equipment.length > 0 ? normalizeAvailableEquipment(equipment) : null;

  // Filter to exercises matching target muscles (excluding core/cardio - those are added separately)
  let candidates = allExercises.filter(e => {
    if (CORE_KEYWORDS.test(e.name) || CARDIO_KEYWORDS.test(e.name)) return false;
    const muscles = getMusclesForExercise(e.name);
    return muscles.some(m => targetMuscles.includes(m));
  });

  if (available) {
    candidates = candidates.filter(e => matchesEquipment(parseEquip(e.equipment), available));
  }

  let coreCandidates = allExercises.filter(e => CORE_KEYWORDS.test(e.name));
  if (available) {
    // Bodyweight core (crunches, planks, …) requires nothing and stays eligible;
    // equipment-bound core (cable crunch, decline sit-up) respects availability.
    coreCandidates = coreCandidates.filter(e => matchesEquipment(parseEquip(e.equipment), available));
  }

  let cardioCandidates = allExercises.filter(e => CARDIO_KEYWORDS.test(e.name));

  // Batch-fetch lastPerformed for ALL candidate exercises in one query
  const allCandidateIds = [
    ...candidates.map(e => e.id),
    ...coreCandidates.map(e => e.id),
    ...cardioCandidates.map(e => e.id),
  ];
  const lastDates = batchLastPerformed(allCandidateIds, db);

  const scored = scoreExercisesWithDates(candidates, lastDates);
  const scoredCore = scoreExercisesWithDates(coreCandidates, lastDates).sort((a, b) => b.score - a.score);
  const scoredCardio = scoreExercisesWithDates(cardioCandidates, lastDates).sort((a, b) => b.score - a.score);

  // Pick exercises by muscle group targets, scaled by duration
  const profile = getDurationProfile(options?.durationMinutes);
  const isInCut = options?.isInCut ?? false;
  // In cut mode: add a second cardio, reduce one strength slot
  const cutCardioCount = isInCut ? 2 : 1;
  const maxStrength = Math.max(2, profile.maxStrength - (isInCut ? 1 : 0));

  let targets: [string, number][];
  if (dayType === 'upper') {
    targets = UPPER_TARGETS.map(([m, c]) => [m, c] as [string, number]);
  } else if (dayType === 'lower' || dayType === 'legs') {
    targets = LEGS_TARGETS.map(([m, c]) => [m, c] as [string, number]);
  } else if (dayType === 'push') {
    targets = PUSH_TARGETS.map(([m, c]) => [m, c] as [string, number]);
  } else if (dayType === 'pull') {
    targets = PULL_TARGETS.map(([m, c]) => [m, c] as [string, number]);
  } else {
    targets = [
      ['back', 1], ['chest', 1], ['shoulders', 1],
      ['quads', 1], ['hamstrings', 1], ['glutes', 1],
      ['biceps', 1],
    ];
  }
  targets = scaleMuscleTargets(targets, maxStrength);

  const trainerList = TRAINER_EXERCISES[dayType];
  const trainerNames = trainerList ? new Set(trainerList) : undefined;
  const selected = interleaveByMuscle(pickByMuscleTargets(scored, targets, trainerNames));
  const coreSelected = scoredCore.slice(0, profile.coreCount);
  const cardioSelected = scoredCardio.slice(0, cutCardioCount);

  const globalModifier = getGlobalRecoveryModifier(db);
  const suppressProgression = globalModifier < 0.85;

  // Batch-compute progression for all selected exercises
  const allSelected = [...selected, ...coreSelected, ...cardioSelected];
  const progressionMap = computeProgressionBatch(
    allSelected.map(e => ({ id: e.id, name: e.name })),
    db
  );

  const buildExercise = (e: ScoredExercise, isCardio: boolean): GeneratedExercise => {
    const prog = progressionMap.get(e.id)!;

    let suggestedSets = prog.sets;
    let suggestedReps = prog.reps;
    let suggestedWeightKg = prog.weightKg;
    let directive = prog.directive;

    // On bad recovery days, suppress progressions
    if (suppressProgression && directive === 'up') {
      directive = 'hold';
      suggestedWeightKg = Math.max(0, suggestedWeightKg - prog.repRange.jump);
      suggestedSets = Math.max(2, suggestedSets - 1);
    }

    // In cut mode: maintain current weights, don't progress
    if (isInCut && directive === 'up') {
      directive = 'hold';
      suggestedWeightKg = Math.max(0, suggestedWeightKg - prog.repRange.jump);
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
      ...(isCardio ? { suggestedDurationSec: profile.cardioDurationSec } : {}),
    };
  };

  const exercises: GeneratedExercise[] = [];

  // Main exercises — track best focus candidate
  let bestFocusScore = -1;
  let focusIndex = -1;

  for (const e of selected) {
    const ex = buildExercise(e, false);
    exercises.push(ex);

    if (ex.progression === 'up') {
      const focusScore = e.score + 1;
      if (focusScore > bestFocusScore) {
        bestFocusScore = focusScore;
        focusIndex = exercises.length - 1;
      }
    } else if (ex.progression === 'hold' && focusIndex < 0) {
      if (e.score > bestFocusScore) {
        bestFocusScore = e.score;
        focusIndex = exercises.length - 1;
      }
    }
  }

  for (const e of coreSelected) {
    exercises.push(buildExercise(e, false));
  }

  for (const e of cardioSelected) {
    exercises.push(buildExercise(e, true));
  }

  if (focusIndex >= 0) {
    exercises[focusIndex].isFocus = true;
  }

  if (options?.supersets !== false) {
    assignSupersets(exercises);
  }

  return { dayType, globalModifier, isInCut, exercises };
}

export interface ProgramExerciseInput {
  exerciseId: number | null;
  exerciseName: string;
  targetSets: number | null;
  targetReps: string | null; // '15' or 'AMRAP'
  restSeconds: number | null;
}

export function generateFromProgram(
  dayType: string,
  programExercises: ProgramExerciseInput[],
  db: DB,
  options?: { supersets?: boolean; isInCut?: boolean },
): GeneratedWorkout {
  const globalModifier = getGlobalRecoveryModifier(db);
  const suppressProgression = globalModifier < 0.85;
  const isInCut = options?.isInCut ?? false;

  // Look up exercises by ID, compute progression for weight suggestions
  const exerciseIds = programExercises
    .map(e => e.exerciseId)
    .filter((id): id is number => id != null);

  const exerciseRows = exerciseIds.length > 0
    ? db.all<{ id: number; name: string; rest_seconds: number | null }>(
        sql`SELECT id, name, rest_seconds FROM exercises WHERE id IN (${sql.join(exerciseIds.map(id => sql`${id}`), sql`, `)})`
      )
    : [];
  const exerciseMap = new Map(exerciseRows.map(r => [r.id, r]));

  const progressionMap = computeProgressionBatch(
    exerciseRows.map(e => ({ id: e.id, name: e.name })),
    db,
  );

  // Batch-fetch last performed dates
  const lastDates = batchLastPerformed(exerciseIds, db);
  const now = Date.now();

  const exercises: GeneratedExercise[] = [];
  let focusIndex = -1;
  let bestFocusScore = -1;

  for (const pe of programExercises) {
    const row = pe.exerciseId ? exerciseMap.get(pe.exerciseId) : null;
    if (!row) continue; // skip unlinked exercises

    const isCardio = CARDIO_KEYWORDS.test(row.name);
    const prog = progressionMap.get(row.id);
    if (!prog) continue;

    // Use program's target sets/reps as baseline, fall back to progression defaults
    const targetSets = pe.targetSets ?? prog.sets;
    const targetReps = pe.targetReps
      ? (pe.targetReps.toUpperCase() === 'AMRAP' ? prog.repRange.max : parseInt(pe.targetReps) || prog.reps)
      : prog.reps;

    let suggestedSets = targetSets;
    let suggestedReps = targetReps;
    let suggestedWeightKg = prog.weightKg;
    let directive = prog.directive;

    if (suppressProgression && directive === 'up') {
      directive = 'hold';
      suggestedWeightKg = Math.max(0, suggestedWeightKg - prog.repRange.jump);
      suggestedSets = Math.max(2, suggestedSets - 1);
    }

    if (isInCut && directive === 'up') {
      directive = 'hold';
      suggestedWeightKg = Math.max(0, suggestedWeightKg - prog.repRange.jump);
    }

    const lastDate = lastDates.get(row.id);
    let daysSince = 7;
    if (lastDate) {
      daysSince = (now - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24);
    }

    const ex: GeneratedExercise = {
      id: row.id,
      name: row.name,
      suggestedSets: isCardio ? 1 : suggestedSets,
      suggestedReps: isCardio ? 1 : suggestedReps,
      suggestedWeightKg: isCardio ? 0 : suggestedWeightKg,
      lastPerformedDaysAgo: Math.round(daysSince * 10) / 10,
      isFocus: false,
      isCardio,
      restSeconds: pe.restSeconds ?? row.rest_seconds ?? 60,
      progression: isCardio ? undefined : directive,
      repRange: isCardio ? undefined : { min: prog.repRange.min, max: prog.repRange.max },
    };

    exercises.push(ex);

    if (!isCardio && directive === 'up') {
      const score = Math.min(1, daysSince / 7) + 1;
      if (score > bestFocusScore) {
        bestFocusScore = score;
        focusIndex = exercises.length - 1;
      }
    }
  }

  if (focusIndex >= 0) {
    exercises[focusIndex].isFocus = true;
  }

  if (options?.supersets !== false) {
    assignSupersets(exercises);
  }

  return { dayType, globalModifier, isInCut, programDriven: true, exercises };
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
