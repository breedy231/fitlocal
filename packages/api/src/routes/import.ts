import { FastifyInstance } from 'fastify';
import { parse } from 'csv-parse/sync';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db.js';

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

function shouldSkip(row: FitbodRow): boolean {
  const name = row.Exercise.toLowerCase();
  const weight = parseFloat(row['Weight(kg)']) || 0;
  const reps = parseInt(row.Reps) || 0;
  const duration = parseFloat(row['Duration(s)']) || 0;

  // Skip foam roll / stretch exercises (zero weight, zero reps with duration)
  if ((name.includes('foam roll') || name.includes('stretch')) && weight === 0 && reps === 0 && duration > 0) {
    return true;
  }
  return false;
}

export async function importRoutes(app: FastifyInstance) {
  app.post('/import/fitbod', async (req, reply) => {
    const csvData = req.body as string;

    const records: FitbodRow[] = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // Group rows by date
    const byDate = new Map<string, FitbodRow[]>();
    for (const row of records) {
      if (shouldSkip(row)) continue;
      const date = row.Date.split(' ')[0]; // take date part only
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(row);
    }

    let workoutsCreated = 0;
    let workoutsSkipped = 0;
    let setsCreated = 0;

    for (const [date, rows] of byDate) {
      // Skip if a workout already exists for this date (idempotent import)
      const existing = await db
        .select()
        .from(schema.workouts)
        .where(eq(schema.workouts.date, date))
        .get();

      if (existing) {
        workoutsSkipped++;
        continue;
      }

      // Create workout
      const workout = db.insert(schema.workouts).values({ date }).returning().get();
      workoutsCreated++;

      // Group rows by exercise name to create workout_exercises
      const byExercise = new Map<string, FitbodRow[]>();
      for (const row of rows) {
        if (!byExercise.has(row.Exercise)) byExercise.set(row.Exercise, []);
        byExercise.get(row.Exercise)!.push(row);
      }

      let order = 0;
      for (const [exerciseName, exerciseRows] of byExercise) {
        // Find or create exercise
        let exercise = await db
          .select()
          .from(schema.exercises)
          .where(eq(schema.exercises.name, exerciseName))
          .get();

        if (!exercise) {
          exercise = db.insert(schema.exercises).values({ name: exerciseName }).returning().get();
        }

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

        // Create sets
        for (const row of exerciseRows) {
          const reps = parseInt(row.Reps) || null;
          const weightKg = parseFloat(row['Weight(kg)']) || null;
          const isWarmup = row.isWarmup === '1' || row.isWarmup?.toLowerCase() === 'true';

          db.insert(schema.sets)
            .values({
              workoutExerciseId: we.id,
              reps,
              weightKg,
              isWarmup,
            })
            .run();
          setsCreated++;
        }
      }
    }

    return reply.status(201).send({
      message: 'Import complete',
      workoutsCreated,
      workoutsSkipped,
      setsCreated,
    });
  });
}
