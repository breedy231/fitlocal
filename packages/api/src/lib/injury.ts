import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schemaTypes from '../schema/index.js';
import type { InjuryPattern, InjuryRestriction } from 'fitlocal-shared';
import { getMusclesForExercise } from './recovery.js';

type DB = BetterSQLite3Database<typeof schemaTypes>;

/** Minimal exercise shape the classifier needs; equipment is the raw JSON column or a parsed list. */
export interface RestrictableExercise {
  id: number;
  name: string;
  equipment: string | string[] | null;
}

/** Answers true when the exercise may be used. */
export type ExerciseFilter = (ex: RestrictableExercise) => boolean;

// Anything with load above the head: presses, overhead extensions/curls,
// pullovers, Olympic-style lifts, overhead carries/lunges. Pull-ups and
// pulldowns are deliberately NOT here — they are pulling, not loading overhead.
const OVERHEAD = /overhead|shoulder.?press|military|\bohp\b|arnold|push.?press|jerk|thruster|snatch|landmine.?press|front.?press|\bz.?press|pike|handstand|pull.?over/i;

// Pushing movement words. Narrowed to upper-body push via muscle groups below,
// so leg press / calf press / glute kickback never match.
const PUSH_MOVE = /press|bench|fly|flye|crossover|push.?up|skull.?crusher|tricep.*extension|kickback|dip(?!\s*belt)/i;
const PUSH_MUSCLES = new Set(['chest', 'shoulders', 'triceps']);
// Fly variants that train the upper back, not the chest.
const NOT_PUSH = /rear|reverse|back.?fly/i;

const FREE_WEIGHT_TAGS = new Set(['barbell', 'dumbbell', 'kettlebell', 'plate', 'ez-bar']);
// Catalog equipment tags are incomplete ("Skullcrusher", "Floor Press" carry
// none), so the name is checked too.
const FREE_WEIGHT_NAME = /barbell|dumbbell|kettlebell|\bez.?bar|plate|skull.?crusher|floor.?press/i;

function parseEquipment(raw: string | string[] | null): string[] {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function isOverhead(name: string): boolean {
  return OVERHEAD.test(name);
}

export function isFreeWeightPush(name: string, equipment: string | string[] | null): boolean {
  if (!PUSH_MOVE.test(name) || NOT_PUSH.test(name)) return false;
  // Unclassified names ("Floor Press") count as push: when unsure, remove.
  const muscles = getMusclesForExercise(name);
  if (muscles.length > 0 && !muscles.some(m => PUSH_MUSCLES.has(m))) return false;
  const tags = parseEquipment(equipment);
  return tags.some(t => FREE_WEIGHT_TAGS.has(t)) || FREE_WEIGHT_NAME.test(name);
}

const PATTERN_TESTS: Record<InjuryPattern, { label: string; test: (ex: RestrictableExercise) => boolean }> = {
  overhead: { label: 'Overhead', test: ex => isOverhead(ex.name) },
  freeweight_push: { label: 'Free-weight pushing', test: ex => isFreeWeightPush(ex.name, ex.equipment) },
};

/** Why the restriction removes this exercise; empty means it stays. */
export function restrictionReasons(ex: RestrictableExercise, r: InjuryRestriction): string[] {
  if (r.avoidExerciseIds.includes(ex.id)) return ['Avoided exercise'];
  if (r.allowExerciseIds.includes(ex.id)) return [];

  const reasons: string[] = [];
  for (const p of r.avoidPatterns) {
    const def = PATTERN_TESTS[p];
    if (def?.test(ex)) reasons.push(def.label);
  }
  if (r.avoidMuscles.length > 0) {
    const muscles = getMusclesForExercise(ex.name);
    for (const m of r.avoidMuscles) {
      if (muscles.includes(m)) reasons.push(`Avoided muscle: ${m}`);
    }
  }
  return reasons;
}

export function buildExerciseFilter(r: InjuryRestriction | null): ExerciseFilter | undefined {
  if (!r) return undefined;
  return ex => restrictionReasons(ex, r).length === 0;
}

interface InjuryRow {
  id: number;
  label: string;
  notes: string | null;
  avoid_patterns: string;
  avoid_muscles: string;
  avoid_exercise_ids: string;
  allow_exercise_ids: string;
  started_at: string;
}

function parseList<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function getActiveRestriction(db: DB): InjuryRestriction | null {
  const rows = db.all<InjuryRow>(
    sql`SELECT id, label, notes, avoid_patterns, avoid_muscles, avoid_exercise_ids, allow_exercise_ids, started_at
        FROM injury_restrictions WHERE cleared_at IS NULL ORDER BY id DESC LIMIT 1`
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    label: row.label,
    notes: row.notes,
    avoidPatterns: parseList<InjuryPattern>(row.avoid_patterns),
    avoidMuscles: parseList<string>(row.avoid_muscles),
    avoidExerciseIds: parseList<number>(row.avoid_exercise_ids),
    allowExerciseIds: parseList<number>(row.allow_exercise_ids),
    startedAt: row.started_at,
  };
}
