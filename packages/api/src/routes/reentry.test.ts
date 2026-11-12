// GET /reentry: phase from strength workouts only, plus the PT restriction.
// Schema comes from migrate.ts on a temp DB. Values are made up.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-reentry-${randomUUID()}.db`);
let getReentry: (today?: string) => import('fitlocal-shared').ReentryResponse;

beforeAll(async () => {
  process.env.DATABASE_PATH = TMP_DB;
  await import('../migrate.js');
  const raw = new Database(TMP_DB);
  raw.exec(`
    INSERT INTO exercises (id, name) VALUES (1, 'Lat Pulldown'), (2, 'Treadmill'), (3, 'Dumbbell Bench Press');
    INSERT INTO workouts (id, date) VALUES (1, '2026-09-13'), (2, '2026-10-20'), (3, '2026-11-11'), (4, '2026-11-12');
    INSERT INTO workout_exercises (id, workout_id, exercise_id) VALUES (1, 1, 1), (2, 2, 2), (3, 3, 1), (4, 4, 1);
    INSERT INTO sets (workout_exercise_id, reps, weight_kg) VALUES (1, 10, 50), (2, 30, 0), (3, 10, 40);
    INSERT INTO injury_restrictions (label, notes, avoid_patterns, avoid_exercise_ids)
      VALUES ('Neck', 'Rehab: shoulder squeezes', '["overhead"]', '[3]');
  `);
  raw.close();
  ({ getReentry } = await import('./reentry.js'));
});

afterAll(() => {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

describe('GET /reentry', () => {
  it('ignores cardio-only and set-less workouts when finding the return', () => {
    // Oct 20 is treadmill only; Nov 12 has no sets. The return is Nov 11.
    const { status } = getReentry('2026-11-14');
    expect(status).toMatchObject({ lastBeforeGap: '2026-09-13', returnDate: '2026-11-11', gapDays: 59, sessionsSinceReturn: 1 });
    expect(status!.phase.key).toBe('reentry');
  });

  it('includes the PT restriction with readable avoid labels and exercise names', () => {
    const { injury } = getReentry('2026-11-14');
    expect(injury).toMatchObject({ label: 'Neck', avoidExercises: ['Dumbbell Bench Press'], notes: 'Rehab: shoulder squeezes' });
    expect(injury!.avoid[0]).toMatch(/^Overhead/);
  });
});
