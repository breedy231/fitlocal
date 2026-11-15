import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import {
  CARDIO_PATTERN,
  MOBILITY_PATTERN,
  INJURY_PATTERN_LABELS,
  computeReentry,
  type ReentryResponse,
} from 'fitlocal-shared';
import { db } from '../db.js';
import { getActiveRestriction } from '../lib/injury.js';
import { localDate } from '../lib/session-window.js';

/** Dates of workouts with at least one logged set on a strength exercise. */
export function strengthWorkoutDates(): string[] {
  const rows = db.all<{ date: string; name: string }>(sql`
    SELECT DISTINCT w.date, e.name
      FROM workouts w
      JOIN workout_exercises we ON we.workout_id = w.id
      JOIN exercises e ON e.id = we.exercise_id
     WHERE EXISTS (SELECT 1 FROM sets s WHERE s.workout_exercise_id = we.id)
  `);
  // Cardio and mobility are classified in JS with the shared patterns (CLAUDE.md).
  return [...new Set(rows
    .filter(r => !CARDIO_PATTERN.test(r.name) && !MOBILITY_PATTERN.test(r.name))
    .map(r => r.date))];
}

export function getReentry(today: string = localDate()): ReentryResponse {
  const status = computeReentry(strengthWorkoutDates(), today);
  const r = getActiveRestriction(db);
  let injury: ReentryResponse['injury'] = null;
  if (r) {
    const ids = r.avoidExerciseIds;
    const names = ids.length
      ? db.all<{ name: string }>(sql`SELECT name FROM exercises WHERE id IN ${ids} ORDER BY name`).map(x => x.name)
      : [];
    injury = {
      label: r.label,
      avoid: r.avoidPatterns.map(p => INJURY_PATTERN_LABELS[p] ?? p),
      avoidMuscles: r.avoidMuscles,
      avoidExercises: names,
      notes: r.notes,
    };
  }
  return { status, injury };
}

export async function reentryRoutes(app: FastifyInstance) {
  // Return-to-training phase (inferred defaults) + the active PT restriction.
  app.get('/reentry', async (): Promise<ReentryResponse> => getReentry());
}
