import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';

// FitLocal is single-user (Brendan, America/Chicago). Workout `date` is stored
// as the user's local calendar date, so "is this workout happening today?" must
// be answered in that timezone, not the server's UTC.
const USER_TZ = 'America/Chicago';

// Local calendar date ("YYYY-MM-DD") for `at` in the user's timezone.
export function localDate(at: Date = new Date(), tz: string = USER_TZ): string {
  // en-CA formats as YYYY-MM-DD, which is exactly what we store.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at);
}

// started_at marks the real start of a *live* session so HR samples can be
// bucketed into its [started_at, ended_at] window (#59). Only stamp it when the
// workout's date is today in the user's tz — a back-logged workout (date in the
// past) would otherwise get a wrong-day window that silently swallows nothing
// and blocks HR matching forever. Back-logged → null (no false window).
export function startedAtForNewWorkout(date: string, now: Date = new Date()): string | null {
  return date === localDate(now) ? now.toISOString() : null;
}

// Server-side heartbeat: every logged set extends the workout's HR window to the
// last real activity. This replaces the flaky client-side markEnded() PATCH,
// which rode a fetch(keepalive) that iOS PWAs drop on background/swipe-kill —
// the reason ended_at was never persisting in practice. Only workouts that have
// a started_at (i.e. live ones) get a window; back-logged workouts stay
// windowless so they can't false-match HR.
export function touchWorkoutEnd(workoutExerciseId: number, now: Date = new Date()): void {
  const we = db
    .select({ workoutId: schema.workoutExercises.workoutId })
    .from(schema.workoutExercises)
    .where(eq(schema.workoutExercises.id, workoutExerciseId))
    .get();
  if (!we) return;
  bumpWorkoutEndById(we.workoutId, now);
}

export function bumpWorkoutEndById(workoutId: number, now: Date = new Date()): void {
  const w = db
    .select({ startedAt: schema.workouts.startedAt })
    .from(schema.workouts)
    .where(eq(schema.workouts.id, workoutId))
    .get();
  if (!w || !w.startedAt) return; // no live window to extend
  db.update(schema.workouts)
    .set({ endedAt: now.toISOString() })
    .where(eq(schema.workouts.id, workoutId))
    .run();
}
