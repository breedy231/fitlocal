// Hermetic tests for the assistant tool executors. The executors use the
// module-level `db` singleton, so we point DATABASE_PATH at a throwaway file
// BEFORE importing db.js, build the tables we need, seed, then import tools.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';

const TMP_DB = path.join(os.tmpdir(), `fitlocal-tools-${randomUUID()}.db`);

let sqlite: DatabaseType.Database;
let tools: typeof import('./tools.js');

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeAll(async () => {
  // db.ts creates indexes on these tables at import time, so they must exist
  // first. Build + seed on a pre-connection, then let the singleton open it.
  const seed = new Database(TMP_DB);
  seed.pragma('journal_mode = WAL');
  seed.exec(`
    CREATE TABLE workouts (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, notes TEXT);
    CREATE TABLE exercises (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
    CREATE TABLE workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL, exercise_id INTEGER NOT NULL, display_order INTEGER DEFAULT 0
    );
    CREATE TABLE sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workout_exercise_id INTEGER NOT NULL,
      reps INTEGER, weight_kg REAL, duration_seconds INTEGER, distance_meters REAL, completed INTEGER DEFAULT 0
    );
    CREATE TABLE health_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, body_weight_kg REAL
    );
  `);

  // Seed: a bench press with two completed sessions.
  seed.exec(`
    INSERT INTO exercises (id, name) VALUES
      (1, 'Barbell Bench Press'),
      (2, 'Dumbbell Bench Press'),
      (3, 'Back Squat');
    INSERT INTO workouts (id, date, notes) VALUES
      (1, '2026-06-01', 'push'),
      (2, '2026-06-08', 'push');
    INSERT INTO workout_exercises (id, workout_id, exercise_id) VALUES (1, 1, 1), (2, 2, 1);
    INSERT INTO sets (workout_exercise_id, reps, weight_kg, completed) VALUES
      (1, 5, 60, 1), (1, 5, 60, 1),
      (2, 5, 62.5, 1);
  `);
  seed.close();

  process.env.DATABASE_PATH = TMP_DB;
  const dbmod = await import('../../db.js');
  sqlite = dbmod.sqlite;
  tools = await import('./tools.js');
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* ignore */ }
  }
});

describe('log_body_weight', () => {
  it('upserts today\'s weight as kg and is idempotent', () => {
    const out = tools.executeAssistantTool('log_body_weight', { lbs: 181 });
    expect(out).toContain('181');
    const row = sqlite.prepare('SELECT body_weight_kg FROM health_snapshots WHERE date = ?').get(today()) as { body_weight_kg: number };
    expect(row.body_weight_kg).toBeCloseTo(82.1, 1); // 181 * 0.45359237

    // Second call overwrites, does not insert a duplicate row.
    tools.executeAssistantTool('log_body_weight', { lbs: 179 });
    const count = sqlite.prepare('SELECT COUNT(*) AS c FROM health_snapshots WHERE date = ?').get(today()) as { c: number };
    expect(count.c).toBe(1);
    const updated = sqlite.prepare('SELECT body_weight_kg FROM health_snapshots WHERE date = ?').get(today()) as { body_weight_kg: number };
    expect(updated.body_weight_kg).toBeCloseTo(81.2, 1); // 179 * 0.45359237
  });

  it('rejects invalid input', () => {
    expect(tools.executeAssistantTool('log_body_weight', { lbs: -5 })).toMatch(/Error/);
    expect(tools.executeAssistantTool('log_body_weight', {})).toMatch(/Error/);
  });
});

describe('get_exercise_history', () => {
  it('returns completed sets in lbs, newest session first', () => {
    const out = tools.executeAssistantTool('get_exercise_history', { name: 'bench press' });
    expect(out).toContain('Barbell Bench Press');
    expect(out).toContain('2026-06-08');
    expect(out).toContain('2026-06-01');
    // 60 kg -> 132.3 lbs, 62.5 kg -> 137.8 lbs
    expect(out).toMatch(/132\.3 lbs/);
    expect(out).toMatch(/137\.8 lbs/);
    // Newest date should appear before the older one.
    expect(out.indexOf('2026-06-08')).toBeLessThan(out.indexOf('2026-06-01'));
  });

  it('reports when no exercise matches', () => {
    expect(tools.executeAssistantTool('get_exercise_history', { name: 'zercher carry' })).toMatch(/No exercise found/);
  });
});

describe('get_swap_suggestions', () => {
  it('suggests same-muscle alternatives, excluding the original', () => {
    const out = tools.executeAssistantTool('get_swap_suggestions', { exerciseName: 'Barbell Bench Press' });
    expect(out).toContain('Dumbbell Bench Press'); // shares chest
    expect(out).not.toContain('Back Squat');       // legs, different group
    expect(out).not.toMatch(/- Barbell Bench Press/); // original excluded from the list
  });
});

describe('executeAssistantTool', () => {
  it('returns an error string for an unknown tool', () => {
    expect(tools.executeAssistantTool('frobnicate', {})).toMatch(/unknown tool/);
  });
});
