// Whether a workout opened on the log page is already under way, and when it
// started. Both come from data that survives an iOS PWA kill (the persisted
// sets, a localStorage stamp, the server's started_at), never from page load.

export interface StartedSet {
  completed?: boolean | null;
}

/**
 * Started once any set is ticked done, or the warm-up was already finished or
 * skipped on this device. The server's started_at can't decide this: it is
 * stamped when the workout is created, before the warm-up.
 */
export function isWorkoutStarted(exercises: { sets: StartedSet[] }[], warmupDoneAt: number | null): boolean {
  if (warmupDoneAt != null) return true;
  return exercises.some((ex) => ex.sets.some((s) => !!s.completed));
}

/**
 * Epoch ms the workout timer counts from: the moment the warm-up ended on this
 * device if known, else the server's started_at, else `now` (back-logged
 * workouts have no start). A start in the future is ignored.
 */
export function resolveStartTime(warmupDoneAt: number | null, startedAt: string | null | undefined, now: number): number {
  if (warmupDoneAt != null && warmupDoneAt <= now) return warmupDoneAt;
  const server = startedAt ? Date.parse(startedAt) : NaN;
  if (Number.isFinite(server) && server <= now) return server;
  return now;
}

const WARMUP_KEY_PREFIX = 'fitlocal-workout-warmup-done-';

export function readWarmupDoneAt(workoutId: string, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): number | null {
  try {
    const raw = storage?.getItem(WARMUP_KEY_PREFIX + workoutId);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeWarmupDoneAt(workoutId: string, at: number, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(WARMUP_KEY_PREFIX + workoutId, String(at));
  } catch { /* quota / private mode: worst case the warm-up shows once more */ }
}
