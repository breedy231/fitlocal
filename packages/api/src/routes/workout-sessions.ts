import { FastifyInstance } from 'fastify';
import { sqlite } from '../db.js';
import {
  MAX_ACTIVE_WINDOW_MS,
  ParsedSample,
  coerceMs,
  downsample,
  parseSamples,
} from '../lib/hr-samples.js';
import {
  cardioFamily,
  mapAppleActivity,
  pickClosestSetByDuration,
  sameFamily,
} from '../lib/apple-activity.js';
import { localDate } from '../lib/session-window.js';

// Grace window (locked decision #4): an Apple session that starts up to 15 min
// before a workout's window opens (or ends 15 min after it closes) still counts
// as overlapping. Absorbs clock skew between the watch and the phone-logged set.
const OVERLAP_GRACE_MS = 15 * 60_000;

// One Apple session's split leg, already validated.
interface SplitInput {
  distanceMeters: number;
  durationSeconds: number;
  avgHr: number | null;
}

// A session parsed from the request body (not yet validated).
interface SessionInput {
  externalId?: unknown;
  activityType?: unknown;
  start?: unknown;
  end?: unknown;
  durationSeconds?: unknown;
  distanceMeters?: unknown;
  energyKcal?: unknown;
  indoor?: unknown;
  splits?: unknown;
  hrSamples?: unknown;
}

type SessionStatus =
  | 'created_workout'
  | 'enriched_set'
  | 'appended_set'
  | 'updated'
  | 'skipped_activity'
  | 'invalid';

interface SessionResult {
  externalId: string;
  status: SessionStatus;
  workoutId?: number;
  setId?: number;
  hrStored?: number;
  reason?: string;
}

// Unwrap { sessions: [...] } | single object | array into a flat session list.
function extractSessions(body: unknown): SessionInput[] | null {
  if (body == null || typeof body !== 'object') return null;
  if (Array.isArray(body)) return body as SessionInput[];
  const obj = body as Record<string, unknown>;
  if (Array.isArray(obj.sessions)) return obj.sessions as SessionInput[];
  // A single session object posted directly.
  if ('externalId' in obj || 'activityType' in obj) return [obj as SessionInput];
  return null;
}

function normalizeSplits(raw: unknown): SplitInput[] {
  if (!Array.isArray(raw)) return [];
  const out: SplitInput[] = [];
  for (const s of raw) {
    if (s == null || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const distance = Number(o.distanceMeters);
    const duration = Number(o.durationSeconds);
    if (!Number.isFinite(distance) || !Number.isFinite(duration)) continue;
    const avgHrRaw = o.avgHr;
    const avgHr =
      avgHrRaw == null || !Number.isFinite(Number(avgHrRaw)) ? null : Math.round(Number(avgHrRaw));
    out.push({ distanceMeters: distance, durationSeconds: duration, avgHr });
  }
  return out;
}

interface WorkoutWindow {
  id: number;
  date: string;
  startMs: number;
  endMs: number;
}

// A cardio workout_exercise inside a candidate workout, with its claimable sets.
interface ExerciseRow {
  weId: number;
  exerciseId: number;
  name: string;
}

export async function workoutSessionRoutes(app: FastifyInstance) {
  // Ingest Apple cardio workout sessions (#93). Each session is enriched into an
  // overlapping manual workout, appended to it, or turned into a standalone
  // workout. Idempotent per externalId. Mirrors /hr-samples' tolerance for a
  // single object OR { sessions: [...] } and its per-item error isolation.
  app.post('/workout-sessions', async (req, reply) => {
    const body: unknown = req.body;
    const sessions = extractSessions(body);

    if (!sessions || sessions.length === 0) {
      const debug = {
        contentType: req.headers['content-type'] ?? null,
        bodyType: Array.isArray(body) ? 'array' : typeof body,
        topLevelKeys:
          body && typeof body === 'object' && !Array.isArray(body)
            ? Object.keys(body).slice(0, 10)
            : null,
        preview:
          typeof body === 'string'
            ? body.slice(0, 200)
            : JSON.stringify(body ?? null).slice(0, 300),
      };
      req.log.warn(debug, 'workout-sessions: no parseable sessions in payload');
      return reply.status(400).send({ error: 'No valid workout sessions in payload', debug });
    }

    const now = Date.now();
    const results: SessionResult[] = [];

    for (const session of sessions) {
      try {
        results.push(processSession(session, now));
      } catch (err) {
        req.log.error({ err }, 'workout-sessions: session processing failed');
        const externalId = typeof session?.externalId === 'string' ? session.externalId : '';
        results.push({ externalId, status: 'invalid', reason: 'internal_error' });
      }
    }

    return reply.status(201).send({ results });
  });
}

function processSession(session: SessionInput, now: number): SessionResult {
  // --- 1. Validate ---
  const externalId = typeof session.externalId === 'string' ? session.externalId.trim() : '';
  if (!externalId) {
    return { externalId: '', status: 'invalid', reason: 'missing_external_id' };
  }

  const startMs = coerceMs(session.start);
  const endMs = coerceMs(session.end);
  if (startMs == null || endMs == null) {
    return { externalId, status: 'invalid', reason: 'unparseable_timestamps' };
  }
  if (endMs <= startMs) {
    return { externalId, status: 'invalid', reason: 'end_not_after_start' };
  }
  if (endMs - startMs > MAX_ACTIVE_WINDOW_MS) {
    return { externalId, status: 'invalid', reason: 'window_too_long' };
  }

  const durationSeconds =
    session.durationSeconds != null && Number.isFinite(Number(session.durationSeconds))
      ? Number(session.durationSeconds)
      : (endMs - startMs) / 1000;
  const distanceMeters =
    session.distanceMeters != null && Number.isFinite(Number(session.distanceMeters))
      ? Number(session.distanceMeters)
      : null;
  const energyKcal =
    session.energyKcal != null && Number.isFinite(Number(session.energyKcal))
      ? Number(session.energyKcal)
      : null;
  const indoor = typeof session.indoor === 'boolean' ? session.indoor : undefined;
  const splits = normalizeSplits(session.splits);
  const minutes = Math.round(durationSeconds / 60);

  // --- 2. Map activity → exercise name → exercise id ---
  const activityType = typeof session.activityType === 'string' ? session.activityType : '';
  const mappedName = mapAppleActivity(activityType, indoor);
  if (mappedName == null) {
    return { externalId, status: 'skipped_activity' };
  }
  const exerciseRow = sqlite
    .prepare('SELECT id FROM exercises WHERE name = ?')
    .get(mappedName) as { id: number } | undefined;
  if (!exerciseRow) {
    return { externalId, status: 'invalid', reason: 'exercise_not_found' };
  }
  const exerciseId = exerciseRow.id;

  // HR samples kept in-window (parsed once, used by whichever branch wins).
  const keptHr = prepareHrSamples(session.hrSamples, startMs, endMs);

  // Prepared HR window bounds (ISO, matching workout_hr_samples.t storage format).
  const hrLoIso = new Date(startMs).toISOString();
  const hrHiIso = new Date(endMs).toISOString();

  const tx = sqlite.transaction((): SessionResult => {
    // --- 3. Idempotency short-circuit ---
    const existing = sqlite
      .prepare(
        `SELECT s.id AS setId, we.workout_id AS workoutId
         FROM sets s
         JOIN workout_exercises we ON s.workout_exercise_id = we.id
         WHERE s.external_id = ?`
      )
      .get(externalId) as { setId: number; workoutId: number } | undefined;

    if (existing) {
      sqlite
        .prepare(
          `UPDATE sets
           SET duration_seconds = ?, distance_meters = ?, energy_kcal = ?, reps = ?,
               completed = 1, source = 'apple_health'
           WHERE id = ?`
        )
        .run(durationSeconds, distanceMeters, energyKcal, minutes, existing.setId);
      replaceSplits(existing.setId, splits);
      const hrStored = attachHr(existing.workoutId, keptHr, hrLoIso, hrHiIso);
      return {
        externalId,
        status: 'updated',
        workoutId: existing.workoutId,
        setId: existing.setId,
        hrStored,
      };
    }

    // --- 4. Find overlapping workout ---
    const target = findOverlappingWorkout(startMs, endMs, now, mappedName);

    if (target) {
      // --- 5. Choose exercise to enrich, else append ---
      const cardioExercises = getCardioExercises(target.id, mappedName);
      const chosen = chooseExercise(cardioExercises, mappedName);

      if (chosen) {
        const candidates = sqlite
          .prepare(
            `SELECT id, duration_seconds AS durationSeconds, reps
             FROM sets
             WHERE workout_exercise_id = ? AND external_id IS NULL`
          )
          .all(chosen.weId) as { id: number; durationSeconds: number | null; reps: number | null }[];

        const setId = pickClosestSetByDuration(candidates, durationSeconds);
        if (setId != null) {
          // Enrich: overwrite MEASURED fields, preserve SUBJECTIVE (rpe, resistance, is_warmup).
          sqlite
            .prepare(
              `UPDATE sets
               SET duration_seconds = ?, distance_meters = ?, energy_kcal = ?, reps = ?,
                   completed = 1, source = 'apple_health', external_id = ?
               WHERE id = ?`
            )
            .run(durationSeconds, distanceMeters, energyKcal, minutes, externalId, setId);
          replaceSplits(setId, splits);
          const hrStored = attachHr(target.id, keptHr, hrLoIso, hrHiIso);
          return { externalId, status: 'enriched_set', workoutId: target.id, setId, hrStored };
        }
        // Chosen exercise exists but all its sets are already claimed → append a new set to it.
        const newSetId = insertCardioSet(chosen.weId, minutes, durationSeconds, distanceMeters, energyKcal, externalId);
        replaceSplits(newSetId, splits);
        const hrStored = attachHr(target.id, keptHr, hrLoIso, hrHiIso);
        return { externalId, status: 'appended_set', workoutId: target.id, setId: newSetId, hrStored };
      }

      // --- Append: workout has no matching cardio exercise ---
      const weId = appendWorkoutExercise(target.id, exerciseId);
      const newSetId = insertCardioSet(weId, minutes, durationSeconds, distanceMeters, energyKcal, externalId);
      replaceSplits(newSetId, splits);
      const hrStored = attachHr(target.id, keptHr, hrLoIso, hrHiIso);
      return { externalId, status: 'appended_set', workoutId: target.id, setId: newSetId, hrStored };
    }

    // --- 6. Standalone create ---
    const workoutId = (
      sqlite
        .prepare(
          `INSERT INTO workouts (date, started_at, ended_at, source)
           VALUES (?, ?, ?, 'apple_health') RETURNING id`
        )
        .get(
          localDate(new Date(startMs)),
          new Date(startMs).toISOString(),
          new Date(endMs).toISOString()
        ) as { id: number }
    ).id;
    const weId = appendWorkoutExercise(workoutId, exerciseId);
    const newSetId = insertCardioSet(weId, minutes, durationSeconds, distanceMeters, energyKcal, externalId);
    replaceSplits(newSetId, splits);
    const hrStored = attachHr(workoutId, keptHr, hrLoIso, hrHiIso);
    return { externalId, status: 'created_workout', workoutId, setId: newSetId, hrStored };
  });

  return tx();
}

// Parse hrSamples, keep only those inside [startMs, endMs], downsample.
function prepareHrSamples(raw: unknown, startMs: number, endMs: number): ParsedSample[] {
  if (raw == null) return [];
  const parsed = parseSamples(raw);
  const inWindow = parsed.filter((s) => s.ms >= startMs && s.ms <= endMs);
  return downsample(inWindow);
}

// Windowed HR replace on a workout: only touch samples inside [loIso, hiIso], so
// an enriched gym workout keeps HR from its strength portion. Returns count stored.
function attachHr(
  workoutId: number,
  kept: ParsedSample[],
  loIso: string,
  hiIso: string
): number | undefined {
  if (kept.length === 0) return undefined;
  sqlite
    .prepare('DELETE FROM workout_hr_samples WHERE workout_id = ? AND t >= ? AND t <= ?')
    .run(workoutId, loIso, hiIso);
  const ins = sqlite.prepare('INSERT INTO workout_hr_samples (workout_id, t, bpm) VALUES (?, ?, ?)');
  for (const s of kept) ins.run(workoutId, s.iso, s.bpm);
  return kept.length;
}

// Replace a set's splits (DELETE then INSERT) so a re-post doesn't duplicate them.
function replaceSplits(setId: number, splits: SplitInput[]): void {
  sqlite.prepare('DELETE FROM set_splits WHERE set_id = ?').run(setId);
  if (splits.length === 0) return;
  const ins = sqlite.prepare(
    `INSERT INTO set_splits (set_id, split_index, distance_meters, duration_seconds, avg_hr)
     VALUES (?, ?, ?, ?, ?)`
  );
  splits.forEach((sp, i) => {
    ins.run(setId, i + 1, sp.distanceMeters, sp.durationSeconds, sp.avgHr);
  });
}

// Insert a cardio set. Cardio convention: reps holds MINUTES; also stores exact
// duration_seconds and distance_meters.
function insertCardioSet(
  workoutExerciseId: number,
  minutes: number,
  durationSeconds: number,
  distanceMeters: number | null,
  energyKcal: number | null,
  externalId: string
): number {
  return (
    sqlite
      .prepare(
        `INSERT INTO sets
           (workout_exercise_id, reps, duration_seconds, distance_meters, energy_kcal,
            completed, source, external_id)
         VALUES (?, ?, ?, ?, ?, 1, 'apple_health', ?) RETURNING id`
      )
      .get(workoutExerciseId, minutes, durationSeconds, distanceMeters, energyKcal, externalId) as {
      id: number;
    }
  ).id;
}

// Append a new workout_exercise at display_order = max+1 in the workout.
function appendWorkoutExercise(workoutId: number, exerciseId: number): number {
  const maxRow = sqlite
    .prepare('SELECT MAX(display_order) AS maxOrder FROM workout_exercises WHERE workout_id = ?')
    .get(workoutId) as { maxOrder: number | null };
  const displayOrder = (maxRow.maxOrder ?? -1) + 1;
  return (
    sqlite
      .prepare(
        'INSERT INTO workout_exercises (workout_id, exercise_id, display_order) VALUES (?, ?, ?) RETURNING id'
      )
      .get(workoutId, exerciseId, displayOrder) as { id: number }
  ).id;
}

// Find the workout an Apple session belongs to. First the windowed overlap
// (workouts with a live started_at window, ±GRACE). If none, the windowless
// fallback: a same-local-date workout that already has a matching cardio
// exercise with an unclaimed set (back-logged workouts have started_at NULL, so
// their window is invisible — locked decision #3).
function findOverlappingWorkout(
  startMs: number,
  endMs: number,
  now: number,
  mappedName: string
): { id: number } | null {
  const loDate = localDate(new Date(startMs - 86_400_000));
  const hiDate = localDate(new Date(startMs + 86_400_000));

  const rawWindows = sqlite
    .prepare(
      `SELECT id, date, started_at AS startedAt, ended_at AS endedAt
       FROM workouts
       WHERE started_at IS NOT NULL AND date >= ? AND date <= ?`
    )
    .all(loDate, hiDate) as {
    id: number;
    date: string;
    startedAt: string;
    endedAt: string | null;
  }[];

  const windows: WorkoutWindow[] = rawWindows
    .map((w) => {
      const wStart = new Date(w.startedAt).getTime();
      const wEnd = w.endedAt
        ? new Date(w.endedAt).getTime()
        : Math.min(now, wStart + MAX_ACTIVE_WINDOW_MS);
      return { id: w.id, date: w.date, startMs: wStart, endMs: wEnd };
    })
    .filter((w) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.endMs >= w.startMs);

  // Overlap test with grace; rank by overlap duration, tie → latest start.
  let best: { id: number; overlap: number; startMs: number } | null = null;
  for (const w of windows) {
    if (startMs <= w.endMs + OVERLAP_GRACE_MS && endMs >= w.startMs - OVERLAP_GRACE_MS) {
      const overlap = Math.min(endMs, w.endMs) - Math.max(startMs, w.startMs);
      if (
        best == null ||
        overlap > best.overlap ||
        (overlap === best.overlap && w.startMs > best.startMs)
      ) {
        best = { id: w.id, overlap, startMs: w.startMs };
      }
    }
  }
  if (best) return { id: best.id };

  // --- Windowless fallback (locked decision #3) ---
  const localStartDate = localDate(new Date(startMs));
  const fallbackRows = sqlite
    .prepare(
      `SELECT DISTINCT w.id AS id
       FROM workouts w
       JOIN workout_exercises we ON we.workout_id = w.id
       JOIN exercises e ON we.exercise_id = e.id
       JOIN sets s ON s.workout_exercise_id = we.id
       WHERE w.date = ? AND s.external_id IS NULL`
    )
    .all(localStartDate) as { id: number }[];

  for (const row of fallbackRows) {
    const cardioExercises = getCardioExercises(row.id, mappedName);
    // Require an exact-or-family cardio match with at least one unclaimed set.
    for (const ex of cardioExercises) {
      const isMatch =
        ex.name.toLowerCase() === mappedName.toLowerCase() || sameFamily(ex.name, mappedName);
      if (!isMatch) continue;
      const unclaimed = sqlite
        .prepare(
          'SELECT 1 FROM sets WHERE workout_exercise_id = ? AND external_id IS NULL LIMIT 1'
        )
        .get(ex.weId);
      if (unclaimed) return { id: row.id };
    }
  }

  return null;
}

// Cardio workout_exercises in a workout that are in the same family as the
// mapped name (so we never consider cross-modality exercises for enrich).
function getCardioExercises(workoutId: number, mappedName: string): ExerciseRow[] {
  const rows = sqlite
    .prepare(
      `SELECT we.id AS weId, we.exercise_id AS exerciseId, e.name AS name
       FROM workout_exercises we
       JOIN exercises e ON we.exercise_id = e.id
       WHERE we.workout_id = ?
       ORDER BY we.display_order, we.id`
    )
    .all(workoutId) as ExerciseRow[];
  const family = cardioFamily(mappedName);
  return rows.filter((r) => cardioFamily(r.name) === family);
}

// Among same-family cardio exercises: prefer an exact name match, else the first
// family match. Returns null when there is no cardio exercise to enrich (append).
function chooseExercise(cardioExercises: ExerciseRow[], mappedName: string): ExerciseRow | null {
  const lower = mappedName.toLowerCase();
  const exact = cardioExercises.find((e) => e.name.toLowerCase() === lower);
  if (exact) return exact;
  return cardioExercises[0] ?? null;
}
