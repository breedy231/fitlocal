/**
 * In-memory SQLite fixture helpers for algorithm unit tests.
 * Must NOT use the live fitlocal.db — all tests are hermetic.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema/index.js';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // Minimal DDL matching the real schema + all migrations that the tests need
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      location_profile TEXT,
      notes TEXT,
      effort_rating INTEGER
    );

    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      primary_muscles TEXT DEFAULT '[]',
      secondary_muscles TEXT DEFAULT '[]',
      equipment TEXT DEFAULT '[]',
      movement_type TEXT,
      description TEXT,
      image_url TEXT,
      wger_id INTEGER,
      rest_seconds INTEGER DEFAULT 60
    );

    CREATE TABLE IF NOT EXISTS workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      display_order INTEGER NOT NULL DEFAULT 0,
      superset_group INTEGER,
      swap_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
      reps INTEGER,
      weight_kg REAL,
      is_warmup INTEGER DEFAULT 0,
      rpe REAL,
      multiplier REAL DEFAULT 1.0,
      completed INTEGER DEFAULT 0,
      duration_seconds INTEGER,
      distance_meters REAL,
      resistance REAL
    );

    CREATE TABLE IF NOT EXISTS health_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      resting_hr INTEGER,
      hrv REAL,
      sleep_hours REAL,
      calories INTEGER,
      protein_g REAL,
      steps INTEGER,
      body_weight_kg REAL
    );

    CREATE TABLE IF NOT EXISTS goal_phases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phase TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      target_weight_kg REAL,
      weekly_deficit_kcal INTEGER
    );
  `);

  const db = drizzle(sqlite, { schema });

  // --- Seed helpers ---

  function seedExercise(name: string, restSeconds = 60, equipment: string[] = []): number {
    const result = sqlite.prepare(
      'INSERT OR IGNORE INTO exercises (name, rest_seconds, equipment) VALUES (?, ?, ?) RETURNING id'
    ).get(name, restSeconds, JSON.stringify(equipment)) as { id: number } | undefined;
    if (result) return result.id;
    return (sqlite.prepare('SELECT id FROM exercises WHERE name = ?').get(name) as { id: number }).id;
  }

  function seedWorkout(date: string): number {
    return (sqlite.prepare(
      'INSERT INTO workouts (date) VALUES (?) RETURNING id'
    ).get(date) as { id: number }).id;
  }

  function seedWorkoutExercise(workoutId: number, exerciseId: number): number {
    return (sqlite.prepare(
      'INSERT INTO workout_exercises (workout_id, exercise_id, display_order) VALUES (?, ?, 0) RETURNING id'
    ).get(workoutId, exerciseId) as { id: number }).id;
  }

  function seedSet(workoutExerciseId: number, reps: number, weightKg: number, isWarmup = 0): number {
    return (sqlite.prepare(
      'INSERT INTO sets (workout_exercise_id, reps, weight_kg, is_warmup, multiplier) VALUES (?, ?, ?, ?, 1.0) RETURNING id'
    ).get(workoutExerciseId, reps, weightKg, isWarmup) as { id: number }).id;
  }

  function seedHealthSnapshot(date: string, hrv: number | null, restingHr: number | null): void {
    sqlite.prepare(
      'INSERT OR REPLACE INTO health_snapshots (date, hrv, resting_hr) VALUES (?, ?, ?)'
    ).run(date, hrv, restingHr);
  }

  /**
   * Seed N sessions for an exercise hitting a given rep/weight.
   * Sessions are seeded on consecutive days counting back from today.
   */
  function seedSessions(
    exerciseId: number,
    sessions: { daysAgo: number; sets: { reps: number; weightKg: number }[] }[]
  ): void {
    for (const session of sessions) {
      const d = new Date();
      d.setDate(d.getDate() - session.daysAgo);
      const dateStr = d.toISOString().split('T')[0];
      const wId = seedWorkout(dateStr);
      const weId = seedWorkoutExercise(wId, exerciseId);
      for (const s of session.sets) {
        seedSet(weId, s.reps, s.weightKg);
      }
    }
  }

  function cleanup(): void {
    sqlite.close();
  }

  return { db, sqlite, seedExercise, seedWorkout, seedWorkoutExercise, seedSet, seedHealthSnapshot, seedSessions, cleanup };
}
