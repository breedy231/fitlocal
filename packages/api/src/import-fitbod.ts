import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from './schema/index.js';

const CSV_PATH = '/Users/brendanreed/.openclaw/media/inbound/a43f0c7a-2364-4b09-8484-9806a1aeeb7d.csv';

// Run migrations first
await import('./migrate.js');

const sqlite = new Database('fitlocal.db');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

interface FitbodRow {
  Date: string;
  Exercise: string;
  Reps: string;
  'Weight(kg)': string;
  'Duration(s)': string;
  'Distance(m)': string;
  Incline: string;
  Resistance: string;
  isWarmup: string;
  Note: string;
  multiplier: string;
}

const csvData = readFileSync(CSV_PATH, 'utf-8');
const records: FitbodRow[] = parse(csvData, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
});

// Group rows by Date timestamp
const byDate = new Map<string, FitbodRow[]>();
for (const row of records) {
  const weight = parseFloat(row['Weight(kg)']) || 0;
  const reps = parseInt(row.Reps) || 0;

  const duration = parseFloat(row['Duration(s)']) || 0;
  const name = row.Exercise.toLowerCase();
  const isCardio = /treadmill|elliptical|cycling|rowing|stationary|walking/.test(name);
  
  // Keep cardio even if weight=0 and reps=0 (they use duration instead)
  // Skip pure stretches/holds (weight=0, reps=0, not cardio)
  if (weight === 0 && reps === 0 && !isCardio) continue;

  const date = row.Date.split(' ')[0]; // take date part only
  if (!byDate.has(date)) byDate.set(date, []);
  byDate.get(date)!.push(row);
}

let workoutsCreated = 0;
let exercisesCreated = 0;
let setsCreated = 0;
const exerciseNames = new Set<string>();

for (const [date, rows] of byDate) {
  // Skip if workout for this date already exists (idempotent import)
  const existing = db.select().from(schema.workouts).where(eq(schema.workouts.date, date)).get();
  if (existing) continue;

  // Create workout
  const workout = db.insert(schema.workouts).values({ date }).returning().get();
  workoutsCreated++;

  // Group rows by exercise name
  const byExercise = new Map<string, FitbodRow[]>();
  for (const row of rows) {
    if (!byExercise.has(row.Exercise)) byExercise.set(row.Exercise, []);
    byExercise.get(row.Exercise)!.push(row);
  }

  let order = 0;
  for (const [exerciseName, exerciseRows] of byExercise) {
    // Upsert exercise
    let exercise = db
      .select()
      .from(schema.exercises)
      .where(eq(schema.exercises.name, exerciseName))
      .get();

    if (!exercise) {
      exercise = db.insert(schema.exercises).values({ name: exerciseName }).returning().get();
      exercisesCreated++;
    }
    exerciseNames.add(exerciseName);

    // Create workout_exercise
    const we = db
      .insert(schema.workoutExercises)
      .values({
        workoutId: workout.id,
        exerciseId: exercise.id,
        displayOrder: order++,
      })
      .returning()
      .get();

    // Create sets with multiplier
    for (const row of exerciseRows) {
      const reps = parseInt(row.Reps) || null;
      const weightKg = parseFloat(row['Weight(kg)']) || null;
      const isWarmup = row.isWarmup === '1' || row.isWarmup?.toLowerCase() === 'true';
      const multiplier = parseFloat(row.multiplier) || 1.0;

      db.insert(schema.sets)
        .values({
          workoutExerciseId: we.id,
          reps,
          weightKg,
          isWarmup,
          multiplier,
        })
        .run();
      setsCreated++;
    }
  }
}

console.log(`Imported ${workoutsCreated} workouts, ${exerciseNames.size} exercises, ${setsCreated} sets`);
sqlite.close();
