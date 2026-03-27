import Database from 'better-sqlite3';

const sqlite = new Database('fitlocal.db');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    location_profile TEXT,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    primary_muscles TEXT DEFAULT '[]',
    secondary_muscles TEXT DEFAULT '[]',
    equipment TEXT DEFAULT '[]',
    movement_type TEXT
  );

  CREATE TABLE IF NOT EXISTS workout_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    display_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
    reps INTEGER,
    weight_kg REAL,
    is_warmup INTEGER DEFAULT 0,
    rpe REAL,
    multiplier REAL DEFAULT 1.0
  );

  CREATE TABLE IF NOT EXISTS muscle_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS equipment_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    available_equipment TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS health_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    resting_hr INTEGER,
    hrv INTEGER,
    sleep_hours REAL,
    calories INTEGER,
    protein_g REAL
  );
`);

// Add multiplier column if not present (Phase 2 migration)
try {
  sqlite.exec(`ALTER TABLE sets ADD COLUMN multiplier REAL DEFAULT 1.0`);
} catch {
  // Column already exists
}

// Add exercise detail columns (exercise detail feature)
for (const col of [
  'ALTER TABLE exercises ADD COLUMN description TEXT',
  'ALTER TABLE exercises ADD COLUMN image_url TEXT',
  'ALTER TABLE exercises ADD COLUMN wger_id INTEGER',
]) {
  try { sqlite.exec(col); } catch { /* Column already exists */ }
}

// Add rest_seconds column (rest timer feature)
try { sqlite.exec('ALTER TABLE exercises ADD COLUMN rest_seconds INTEGER DEFAULT 60'); } catch { /* exists */ }

// Add steps and body_weight_kg to health_snapshots
for (const col of [
  'ALTER TABLE health_snapshots ADD COLUMN steps INTEGER',
  'ALTER TABLE health_snapshots ADD COLUMN body_weight_kg REAL',
]) {
  try { sqlite.exec(col); } catch { /* Column already exists */ }
}

// Set rest_seconds defaults by exercise type
sqlite.exec(`
  UPDATE exercises SET rest_seconds = 120
  WHERE lower(name) GLOB '*squat*' OR lower(name) GLOB '*deadlift*' OR lower(name) GLOB '*bench*'
    OR lower(name) GLOB '*row*' OR lower(name) GLOB '*pulldown*' OR lower(name) GLOB '*press*'
    OR lower(name) GLOB '*pull*up*' OR lower(name) GLOB '*chin*up*';

  UPDATE exercises SET rest_seconds = 45
  WHERE lower(name) GLOB '*crunch*' OR lower(name) GLOB '*plank*' OR lower(name) GLOB '*dead*bug*'
    OR lower(name) GLOB '*russian*twist*' OR lower(name) GLOB '*windshield*' OR lower(name) GLOB '*knee*raise*'
    OR lower(name) GLOB '*toe*toucher*';

  UPDATE exercises SET rest_seconds = 0
  WHERE lower(name) GLOB '*treadmill*' OR lower(name) GLOB '*elliptical*'
    OR lower(name) GLOB '*cycling*' OR lower(name) GLOB '*rowing*';

  UPDATE exercises SET rest_seconds = 60
  WHERE lower(name) GLOB '*curl*' OR lower(name) GLOB '*raise*' OR lower(name) GLOB '*extension*'
    OR lower(name) GLOB '*kickback*' OR lower(name) GLOB '*fly*' OR lower(name) GLOB '*flye*';
`);

// Add superset_group column to workout_exercises
try { sqlite.exec('ALTER TABLE workout_exercises ADD COLUMN superset_group INTEGER'); } catch { /* exists */ }

console.log('Database migrated successfully');
sqlite.close();
