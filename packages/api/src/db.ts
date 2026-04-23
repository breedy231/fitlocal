import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';

import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../../fitlocal.db');
const sqlite: Database.Database = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
// Aggressive WAL checkpoint: default is 1000 pages (~4 MB). The Apr 21 incident
// had 1000+ pages pending when the DB corrupted, which meant losing that window
// of writes would have cost days of data. With 100 pages (~400 KB), the worst-
// case loss between checkpoints is minutes, not days. Trade-off is slightly
// more frequent fsync; at our write volume (a few rows per set, a few sets per
// workout) this is imperceptible.
sqlite.pragma('wal_autocheckpoint = 100');

// Ensure performance indexes exist
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_we_workout_id ON workout_exercises(workout_id);
  CREATE INDEX IF NOT EXISTS idx_we_exercise_id ON workout_exercises(exercise_id);
  CREATE INDEX IF NOT EXISTS idx_sets_we_id ON sets(workout_exercise_id);
  CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
`);

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };
