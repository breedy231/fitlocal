// Hermetic tests for Apple cardio-session ingest (#93, step 4).
// POST /workout-sessions enriches / appends / creates cardio sets from Apple
// workout sessions. We point DATABASE_PATH at a throwaway file DB BEFORE
// importing db.js, build the full schema incl. the step-1 columns + set_splits,
// seed a few exercises, register the route, and drive it via inject.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-ws-${randomUUID()}.db`);

let app: FastifyInstance;
let raw: Database.Database; // direct handle for seeding + assertions

// Exercise ids, resolved after seed.
let idRunning: number;
let idCycling: number;
let idRunningTreadmill: number;
let idBench: number;

// America/Chicago is UTC-5 in June (CDT). 15:00Z = 10:00 local.
const DAY = '2026-06-25';

function post(payload: unknown) {
  return app.inject({ method: 'POST', url: '/workout-sessions', payload });
}

function insertWorkout(opts: {
  date: string;
  startedAt?: string | null;
  endedAt?: string | null;
  source?: string | null;
}): number {
  return (
    raw
      .prepare(
        `INSERT INTO workouts (date, started_at, ended_at, source) VALUES (?, ?, ?, ?) RETURNING id`
      )
      .get(opts.date, opts.startedAt ?? null, opts.endedAt ?? null, opts.source ?? null) as {
      id: number;
    }
  ).id;
}

function insertWorkoutExercise(workoutId: number, exerciseId: number, displayOrder = 0): number {
  return (
    raw
      .prepare(
        `INSERT INTO workout_exercises (workout_id, exercise_id, display_order) VALUES (?, ?, ?) RETURNING id`
      )
      .get(workoutId, exerciseId, displayOrder) as { id: number }
  ).id;
}

function insertSet(opts: {
  weId: number;
  reps?: number | null;
  weightKg?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  rpe?: number | null;
  isWarmup?: number;
  externalId?: string | null;
}): number {
  return (
    raw
      .prepare(
        `INSERT INTO sets
          (workout_exercise_id, reps, weight_kg, duration_seconds, distance_meters, rpe, is_warmup, external_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .get(
        opts.weId,
        opts.reps ?? null,
        opts.weightKg ?? null,
        opts.durationSeconds ?? null,
        opts.distanceMeters ?? null,
        opts.rpe ?? null,
        opts.isWarmup ?? 0,
        opts.externalId ?? null
      ) as { id: number }
  ).id;
}

const getSet = (id: number) => raw.prepare('SELECT * FROM sets WHERE id = ?').get(id) as any;
const getSplits = (setId: number) =>
  raw
    .prepare('SELECT * FROM set_splits WHERE set_id = ? ORDER BY split_index')
    .all(setId) as any[];

beforeAll(async () => {
  const seed = new Database(TMP_DB);
  seed.pragma('journal_mode = WAL');
  seed.pragma('foreign_keys = ON');
  seed.exec(`
    CREATE TABLE workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, location_profile TEXT, notes TEXT,
      effort_rating INTEGER, started_at TEXT, ended_at TEXT, source TEXT
    );
    CREATE TABLE exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      primary_muscles TEXT DEFAULT '[]', secondary_muscles TEXT DEFAULT '[]',
      equipment TEXT DEFAULT '[]', movement_type TEXT,
      description TEXT, image_url TEXT, wger_id INTEGER, rest_seconds INTEGER DEFAULT 60
    );
    CREATE TABLE workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      display_order INTEGER NOT NULL DEFAULT 0,
      superset_group INTEGER, swap_reason TEXT
    );
    CREATE TABLE sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
      reps INTEGER, weight_kg REAL, is_warmup INTEGER DEFAULT 0, rpe REAL,
      multiplier REAL DEFAULT 1.0, duration_seconds INTEGER, distance_meters REAL,
      resistance REAL, completed INTEGER DEFAULT 0,
      external_id TEXT, source TEXT, energy_kcal REAL
    );
    CREATE UNIQUE INDEX idx_sets_external_id ON sets(external_id) WHERE external_id IS NOT NULL;
    CREATE TABLE set_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
      split_index INTEGER NOT NULL,
      distance_meters REAL NOT NULL, duration_seconds REAL NOT NULL, avg_hr INTEGER
    );
    CREATE TABLE workout_hr_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL, t TEXT NOT NULL, bpm INTEGER NOT NULL
    );
    CREATE TABLE user_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, max_hr INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  seed.exec(`
    INSERT INTO exercises (name) VALUES
      ('Running'), ('Cycling'), ('Running - Treadmill'), ('Barbell Bench Press');
  `);
  seed.close();

  process.env.DATABASE_PATH = TMP_DB;
  await import('../db.js');
  const { workoutSessionRoutes } = await import('./workout-sessions.js');

  raw = new Database(TMP_DB);
  raw.pragma('foreign_keys = ON');
  idRunning = (raw.prepare("SELECT id FROM exercises WHERE name='Running'").get() as any).id;
  idCycling = (raw.prepare("SELECT id FROM exercises WHERE name='Cycling'").get() as any).id;
  idRunningTreadmill = (
    raw.prepare("SELECT id FROM exercises WHERE name='Running - Treadmill'").get() as any
  ).id;
  idBench = (
    raw.prepare("SELECT id FROM exercises WHERE name='Barbell Bench Press'").get() as any
  ).id;

  app = Fastify();
  await app.register(workoutSessionRoutes);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  raw?.close();
  for (const ext of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(TMP_DB + ext);
    } catch {
      /* ignore */
    }
  }
});

// Wipe mutable rows between tests (exercises stay). Order respects FKs.
beforeEach(() => {
  raw.exec(`
    DELETE FROM set_splits;
    DELETE FROM workout_hr_samples;
    DELETE FROM sets;
    DELETE FROM workout_exercises;
    DELETE FROM workouts;
  `);
});

describe('POST /workout-sessions', () => {
  it('enriches a hand-logged Running set, preserving rpe, and stores splits', async () => {
    const wId = insertWorkout({
      date: DAY,
      startedAt: `${DAY}T15:00:00.000Z`,
      endedAt: `${DAY}T16:00:00.000Z`,
    });
    const weId = insertWorkoutExercise(wId, idRunning, 0);
    const setId = insertSet({ weId, reps: 20, rpe: 8 }); // manual 20-min run, RPE 8

    const res = await post({
      externalId: 'apple-run-1',
      activityType: 'HKWorkoutActivityTypeRunning',
      start: `${DAY}T15:10:00.000Z`,
      end: `${DAY}T15:32:00.000Z`,
      durationSeconds: 1320, // 22 min
      distanceMeters: 4000,
      energyKcal: 300,
      splits: [
        { distanceMeters: 1609, durationSeconds: 500, avgHr: 150 },
        { distanceMeters: 1609, durationSeconds: 520, avgHr: 155 },
      ],
    });

    expect(res.statusCode).toBe(201);
    const r = res.json().results[0];
    expect(r).toMatchObject({ externalId: 'apple-run-1', status: 'enriched_set', workoutId: wId, setId });

    const s = getSet(setId);
    expect(s.reps).toBe(22); // round(1320/60)
    expect(s.duration_seconds).toBe(1320);
    expect(s.distance_meters).toBe(4000);
    expect(s.energy_kcal).toBe(300);
    expect(s.completed).toBe(1);
    expect(s.source).toBe('apple_health');
    expect(s.external_id).toBe('apple-run-1');
    expect(s.rpe).toBe(8); // preserved

    expect(getSplits(setId)).toHaveLength(2);
  });

  it('enriches a Running - Treadmill set from an outdoor Running session via family rule', async () => {
    const wId = insertWorkout({
      date: DAY,
      startedAt: `${DAY}T15:00:00.000Z`,
      endedAt: `${DAY}T16:00:00.000Z`,
    });
    const weId = insertWorkoutExercise(wId, idRunningTreadmill, 0);
    const setId = insertSet({ weId, reps: 25 });

    const res = await post({
      externalId: 'apple-run-fam',
      activityType: 'Outdoor Run', // maps to 'Running'
      start: `${DAY}T15:05:00.000Z`,
      end: `${DAY}T15:30:00.000Z`,
      durationSeconds: 1500,
      distanceMeters: 5000,
    });

    const r = res.json().results[0];
    expect(r.status).toBe('enriched_set');
    expect(r.setId).toBe(setId);
    expect(getSet(setId).reps).toBe(25); // round(1500/60)=25
  });

  it('appends a new cardio exercise when the overlapping workout is strength-only', async () => {
    const wId = insertWorkout({
      date: DAY,
      startedAt: `${DAY}T15:00:00.000Z`,
      endedAt: `${DAY}T16:00:00.000Z`,
    });
    const benchWe = insertWorkoutExercise(wId, idBench, 0);
    const benchSet = insertSet({ weId: benchWe, reps: 5, weightKg: 100 });

    const res = await post({
      externalId: 'apple-run-append',
      activityType: 'Running',
      start: `${DAY}T15:40:00.000Z`,
      end: `${DAY}T16:00:00.000Z`,
      durationSeconds: 1200,
      distanceMeters: 3000,
    });

    const r = res.json().results[0];
    expect(r.status).toBe('appended_set');
    expect(r.workoutId).toBe(wId);

    // Original bench set untouched.
    const bench = getSet(benchSet);
    expect(bench.external_id).toBeNull();
    expect(bench.weight_kg).toBe(100);

    // New workout_exercise at display_order max+1 (=1).
    const we = raw
      .prepare('SELECT * FROM workout_exercises WHERE exercise_id = ? AND workout_id = ?')
      .get(idRunning, wId) as any;
    expect(we.display_order).toBe(1);
    const newSet = getSet(r.setId);
    expect(newSet.reps).toBe(20);
    expect(newSet.source).toBe('apple_health');
  });

  it('does not enrich cross-modality: a Cycling-only workout gets an appended Running set', async () => {
    const wId = insertWorkout({
      date: DAY,
      startedAt: `${DAY}T15:00:00.000Z`,
      endedAt: `${DAY}T16:00:00.000Z`,
    });
    const cycleWe = insertWorkoutExercise(wId, idCycling, 0);
    const cycleSet = insertSet({ weId: cycleWe, reps: 30 });

    const res = await post({
      externalId: 'apple-run-nocross',
      activityType: 'Running',
      start: `${DAY}T15:10:00.000Z`,
      end: `${DAY}T15:35:00.000Z`,
      durationSeconds: 1500,
    });

    const r = res.json().results[0];
    expect(r.status).toBe('appended_set');
    // Cycling set untouched.
    const cyc = getSet(cycleSet);
    expect(cyc.reps).toBe(30);
    expect(cyc.external_id).toBeNull();
  });

  it('creates a standalone apple_health workout when nothing that day overlaps', async () => {
    const res = await post({
      externalId: 'apple-run-standalone',
      activityType: 'Running',
      start: `${DAY}T15:00:00.000Z`,
      end: `${DAY}T15:30:00.000Z`,
      durationSeconds: 1800,
      distanceMeters: 6000,
    });

    const r = res.json().results[0];
    expect(r.status).toBe('created_workout');

    const w = raw.prepare('SELECT * FROM workouts WHERE id = ?').get(r.workoutId) as any;
    expect(w.source).toBe('apple_health');
    expect(w.started_at).toBe(`${DAY}T15:00:00.000Z`);
    expect(w.ended_at).toBe(`${DAY}T15:30:00.000Z`);
    expect(w.date).toBe(DAY); // 15:00Z = 10:00 CDT, same local date

    const s = getSet(r.setId);
    expect(s.reps).toBe(30);
    expect(s.source).toBe('apple_health');
  });

  it('is idempotent: re-POSTing the same externalId returns updated with the same setId', async () => {
    const first = await post({
      externalId: 'apple-run-idem',
      activityType: 'Running',
      start: `${DAY}T15:00:00.000Z`,
      end: `${DAY}T15:30:00.000Z`,
      durationSeconds: 1800,
      distanceMeters: 6000,
      splits: [{ distanceMeters: 3000, durationSeconds: 900 }],
    });
    const firstR = first.json().results[0];
    expect(firstR.status).toBe('created_workout');
    const setId = firstR.setId;

    const second = await post({
      externalId: 'apple-run-idem',
      activityType: 'Running',
      start: `${DAY}T15:00:00.000Z`,
      end: `${DAY}T15:35:00.000Z`,
      durationSeconds: 2100, // 35 min now
      distanceMeters: 7000,
      splits: [{ distanceMeters: 3500, durationSeconds: 1050 }],
    });
    const secondR = second.json().results[0];
    expect(secondR.status).toBe('updated');
    expect(secondR.setId).toBe(setId);

    const s = getSet(setId);
    expect(s.reps).toBe(35);
    expect(s.distance_meters).toBe(7000);

    // Splits replaced, not duplicated. Only one row across the two POSTs.
    expect(getSplits(setId)).toHaveLength(1);

    // Exactly one set carries this external_id (unique index intact).
    const count = (
      raw.prepare("SELECT COUNT(*) AS c FROM sets WHERE external_id = 'apple-run-idem'").get() as any
    ).c;
    expect(count).toBe(1);
  });

  it('skips a strength activity type and writes nothing', async () => {
    const res = await post({
      externalId: 'apple-strength',
      activityType: 'traditionalStrengthTraining',
      start: `${DAY}T15:00:00.000Z`,
      end: `${DAY}T15:45:00.000Z`,
    });
    const r = res.json().results[0];
    expect(r.status).toBe('skipped_activity');

    expect((raw.prepare('SELECT COUNT(*) AS c FROM workouts').get() as any).c).toBe(0);
    expect((raw.prepare('SELECT COUNT(*) AS c FROM sets').get() as any).c).toBe(0);
  });

  it('assigns the local start date for a near-midnight session and matches a same-date workout', async () => {
    // 2026-06-26 04:40Z = 2026-06-25 23:40 America/Chicago (CDT, UTC-5).
    const localDay = '2026-06-25';
    const wId = insertWorkout({
      date: localDay,
      startedAt: '2026-06-26T04:35:00.000Z',
      endedAt: '2026-06-26T05:30:00.000Z',
    });
    const weId = insertWorkoutExercise(wId, idRunning, 0);
    const setId = insertSet({ weId, reps: 15 });

    const res = await post({
      externalId: 'apple-midnight',
      activityType: 'Running',
      start: '2026-06-26T04:40:00.000Z',
      end: '2026-06-26T05:05:00.000Z',
      durationSeconds: 1500,
    });

    const r = res.json().results[0];
    // Overlaps the live workout window → enriches its Running set.
    expect(r.status).toBe('enriched_set');
    expect(r.workoutId).toBe(wId);
    expect(r.setId).toBe(setId);
  });

  it('handles two runs the same day: first enriches the manual set, second appends', async () => {
    const wId = insertWorkout({
      date: DAY,
      startedAt: `${DAY}T15:00:00.000Z`,
      endedAt: `${DAY}T18:00:00.000Z`,
    });
    const weId = insertWorkoutExercise(wId, idRunning, 0);
    const manualSet = insertSet({ weId, reps: 20, rpe: 7 });

    const first = await post({
      externalId: 'apple-run-a',
      activityType: 'Running',
      start: `${DAY}T15:10:00.000Z`,
      end: `${DAY}T15:32:00.000Z`,
      durationSeconds: 1320,
    });
    expect(first.json().results[0]).toMatchObject({ status: 'enriched_set', setId: manualSet });

    const second = await post({
      externalId: 'apple-run-b',
      activityType: 'Running',
      start: `${DAY}T17:00:00.000Z`,
      end: `${DAY}T17:25:00.000Z`,
      durationSeconds: 1500,
    });
    const secondR = second.json().results[0];
    // Manual set now claimed → second run appends a new set to the same Running exercise.
    expect(secondR.status).toBe('appended_set');
    expect(secondR.workoutId).toBe(wId);
    expect(secondR.setId).not.toBe(manualSet);

    // Both sets live under the same Running workout_exercise.
    const setsForWe = raw
      .prepare('SELECT COUNT(*) AS c FROM sets WHERE workout_exercise_id = ?')
      .get(weId) as any;
    expect(setsForWe.c).toBe(2);
  });

  it('windowless fallback: enriches a back-logged (started_at NULL) workout by name + date', async () => {
    const wId = insertWorkout({ date: DAY, startedAt: null, endedAt: null }); // back-logged
    const weId = insertWorkoutExercise(wId, idRunning, 0);
    const setId = insertSet({ weId, reps: 18 });

    const res = await post({
      externalId: 'apple-run-backlog',
      activityType: 'Running',
      start: `${DAY}T15:00:00.000Z`,
      end: `${DAY}T15:25:00.000Z`,
      durationSeconds: 1500,
      distanceMeters: 4800,
    });

    const r = res.json().results[0];
    expect(r.status).toBe('enriched_set');
    expect(r.workoutId).toBe(wId);
    expect(r.setId).toBe(setId);
    expect(getSet(setId).reps).toBe(25);
  });

  it('windowed HR replace: out-of-window samples survive, in-window replaced, hrStored correct', async () => {
    const wId = insertWorkout({
      date: DAY,
      startedAt: `${DAY}T15:00:00.000Z`,
      endedAt: `${DAY}T16:00:00.000Z`,
    });
    const weId = insertWorkoutExercise(wId, idRunning, 0);
    insertSet({ weId, reps: 20 });

    // Pre-existing HR: one strength-portion sample BEFORE the cardio window, one AFTER.
    raw
      .prepare('INSERT INTO workout_hr_samples (workout_id, t, bpm) VALUES (?, ?, ?)')
      .run(wId, `${DAY}T15:05:00.000Z`, 110); // before cardio session start
    raw
      .prepare('INSERT INTO workout_hr_samples (workout_id, t, bpm) VALUES (?, ?, ?)')
      .run(wId, `${DAY}T15:40:00.000Z`, 115); // after cardio session end

    const hrCsv = [
      `${DAY}T15:10:00.000Z,140`,
      `${DAY}T15:10:05.000Z,142`, // same 10s bucket → downsampled out
      `${DAY}T15:10:30.000Z,150`,
      `${DAY}T15:20:00.000Z,160`,
      `${DAY}T15:35:00.000Z,999`, // out of session window (end 15:32) → dropped
    ].join('\n');

    const res = await post({
      externalId: 'apple-run-hr',
      activityType: 'Running',
      start: `${DAY}T15:10:00.000Z`,
      end: `${DAY}T15:32:00.000Z`,
      durationSeconds: 1320,
      hrSamples: hrCsv,
    });

    const r = res.json().results[0];
    expect(r.status).toBe('enriched_set');
    expect(r.hrStored).toBe(3); // 140, 150, 160

    const rows = raw
      .prepare('SELECT t, bpm FROM workout_hr_samples WHERE workout_id = ? ORDER BY t')
      .all(wId) as { t: string; bpm: number }[];
    const bpms = rows.map((x) => x.bpm);
    // Out-of-window strength samples preserved.
    expect(bpms).toContain(110);
    expect(bpms).toContain(115);
    // In-window replaced with the 3 downsampled cardio samples.
    expect(bpms).toContain(140);
    expect(bpms).toContain(150);
    expect(bpms).toContain(160);
    expect(bpms).not.toContain(999);
    expect(rows).toHaveLength(5);
  });

  it('tolerates { sessions: [...] } and reports invalid sessions without failing the batch', async () => {
    const res = await post({
      sessions: [
        {
          externalId: 'batch-ok',
          activityType: 'Running',
          start: `${DAY}T15:00:00.000Z`,
          end: `${DAY}T15:30:00.000Z`,
          durationSeconds: 1800,
        },
        { externalId: '', activityType: 'Running', start: 1, end: 2 }, // missing externalId
      ],
    });
    expect(res.statusCode).toBe(201);
    const results = res.json().results;
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('created_workout');
    expect(results[1].status).toBe('invalid');
  });

  it('returns 400 with a debug echo for a body with no parseable sessions', async () => {
    const res = await post({ garbage: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().debug).toBeTruthy();
  });
});
