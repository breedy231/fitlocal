import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';

import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../../fitlocal.db');
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Ensure performance indexes exist
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_we_workout_id ON workout_exercises(workout_id);
  CREATE INDEX IF NOT EXISTS idx_we_exercise_id ON workout_exercises(exercise_id);
  CREATE INDEX IF NOT EXISTS idx_sets_we_id ON sets(workout_exercise_id);
  CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
`);

export const db = drizzle(sqlite, { schema });
export { schema };
