// Query strategy: Drizzle ORM is used for schema definition and type generation
// only. All queries are raw SQL via db.all()/db.get()/db.run() for explicitness
// and SQLite-specific idiom support. This is intentional — not a migration-in-progress.
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';

import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, '../../../fitlocal.db');
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

// No schema work here: this module is imported (via the route modules) before
// server.ts runs migrate.ts, so any DDL touching a table crashes a fresh DB with
// "no such table". Tables and indexes all live in migrate.ts.

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };
