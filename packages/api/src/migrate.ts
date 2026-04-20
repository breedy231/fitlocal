import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../../fitlocal.db');
const sqlite = new Database(dbPath);
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

// Migration tracking table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    key TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Set rest_seconds defaults by exercise classification (runs once)
const restMigrationApplied = sqlite.prepare("SELECT 1 FROM migrations WHERE key = 'rest_defaults_v4'").get();
if (!restMigrationApplied) {
  function classifyForRest(name: string): number {
    const n = name.toLowerCase();
    if (/treadmill|elliptical|cycling|rowing\s*machine|stationary/i.test(n)) return 0;
    if (/crunch|plank|dead.?bug|russian.?twist|windshield|knee.?raise|toe.?toucher|ab\s|v.?up/i.test(n)) return 45;
    if (/barbell|squat\s*\(|bench\s*press|deadlift|pendlay|back\s*squat|front\s*squat|overhead\s*press/i.test(n)) return 120;
    if (/dumbbell\s*(press|row|lunge|bench|squat|shoulder)|arnold\s*press/i.test(n)) return 90;
    if (/pull.?up|chin.?up|dip(?!.*cable)/i.test(n)) return 90;
    if (/pulldown|lat\s*pull|leg\s*press|hack\s*squat|smith/i.test(n)) return 90;
    return 60; // accessories: TRX, cable, curls, raises, extensions, etc.
  }

  const exercises = sqlite.prepare('SELECT id, name, rest_seconds FROM exercises').all() as { id: number; name: string; rest_seconds: number | null }[];
  const updateStmt = sqlite.prepare('UPDATE exercises SET rest_seconds = ? WHERE id = ?');

  const txn = sqlite.transaction(() => {
    for (const ex of exercises) {
      const rest = classifyForRest(ex.name);
      updateStmt.run(rest, ex.id);
    }
    sqlite.prepare("INSERT INTO migrations (key) VALUES ('rest_defaults_v4')").run();
  });
  txn();
}

// Add superset_group column to workout_exercises
try { sqlite.exec('ALTER TABLE workout_exercises ADD COLUMN superset_group INTEGER'); } catch { /* exists */ }

// Program / routine template tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    days_per_week INTEGER,
    duration_weeks INTEGER,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS program_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    day_order INTEGER NOT NULL,
    muscles_focus TEXT
  );

  CREATE TABLE IF NOT EXISTS program_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_day_id INTEGER NOT NULL REFERENCES program_days(id) ON DELETE CASCADE,
    exercise_name TEXT NOT NULL,
    exercise_id INTEGER REFERENCES exercises(id),
    display_order INTEGER NOT NULL DEFAULT 0,
    target_sets INTEGER,
    target_reps TEXT,
    rest_seconds INTEGER,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS active_program (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    current_day_index INTEGER NOT NULL DEFAULT 0
  );
`);

// Add effort_rating to workouts (post-workout RPE, 1-10)
try { sqlite.exec('ALTER TABLE workouts ADD COLUMN effort_rating INTEGER'); } catch { /* exists */ }

// Add cardio_plan JSON column to programs
try { sqlite.exec('ALTER TABLE programs ADD COLUMN cardio_plan TEXT'); } catch { /* exists */ }

// Achievements table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,
    unlocked_at TEXT
  );
`);

// Monthly challenges table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    target_value REAL NOT NULL,
    unit TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    completed_at TEXT
  );
`);

// User goals (single-row table for cut/bulk phase tracking)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS user_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    maintenance_calories INTEGER,
    target_calories INTEGER,
    target_protein_g REAL,
    target_weight_kg REAL,
    cut_start_date TEXT,
    cut_end_date TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add duration_seconds column to sets (cardio tracking)
try { sqlite.exec('ALTER TABLE sets ADD COLUMN duration_seconds INTEGER'); } catch { /* exists */ }

// Routines table (lightweight trainer-provided exercise lists)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    exercises TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add completed column to sets (persists set completion state across reloads)
try { sqlite.exec('ALTER TABLE sets ADD COLUMN completed INTEGER DEFAULT 0'); } catch { /* exists */ }

// Performance indexes for JOIN-heavy queries
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_we_workout_id ON workout_exercises(workout_id);
  CREATE INDEX IF NOT EXISTS idx_we_exercise_id ON workout_exercises(exercise_id);
  CREATE INDEX IF NOT EXISTS idx_sets_we_id ON sets(workout_exercise_id);
  CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
`);

// Exercise data cleanup: fix German text, 'Is english' artifacts, embedded markup, mismatched descriptions
sqlite.exec(`
  UPDATE exercises SET description = 'Lie face down and place a foam roller under your hip flexors. Roll slowly from the hip crease to just above the knee, pausing on tight areas.'
  WHERE description LIKE '%Is english%' AND lower(name) LIKE '%hip flexor%';

  UPDATE exercises SET description = 'Place a foam roller under your chest near the armpit. Roll slowly across the pec muscles, pausing on tender areas.'
  WHERE id = 14 AND description LIKE '%calves%';

  DELETE FROM exercises WHERE name IN ('10 - 12', '8 - 10')
    AND id NOT IN (SELECT exercise_id FROM workout_exercises);

  UPDATE exercises SET description = 'The cable face pull targets the rear deltoids, rhomboids, and external rotators. Attach a rope to a cable machine at upper-chest height. Grip the rope with both hands, palms facing down, and step back to create tension. Pull the rope toward your face, separating the ends past your ears while squeezing your shoulder blades together. Hold briefly, then return with control. Keep your elbows high throughout the movement.'
  WHERE id = 74 AND name = 'Cable Face Pull';
`);

console.log('Database migrated successfully');
sqlite.close();
