/**
 * DB writer for the Obsidian import endpoint (#35 part 2). Parses an Obsidian-
 * format workout block with the shared `parseObsidianWorkout`, then writes one
 * workout + its exercises + sets in a single transaction.
 *
 * Lives in lib/ (not the route file) so it can be unit-tested against an
 * in-memory db: the route's runtime `db` is imported here as a TYPE only
 * (`import type`), so loading this module never opens the live fitlocal.db.
 *
 * Unit boundary (CLAUDE.md rule): the parser emits lbs / miles / minutes and
 * RIR; the DB stores kg / meters / seconds and uses the `rpe` column. Convert
 * here, at the boundary.
 */
import { eq } from 'drizzle-orm';
import { parseObsidianWorkout } from 'fitlocal-shared';
import * as schema from '../schema/index.js';
import type { db } from '../db.js';

const LBS_TO_KG = 0.453592;
const MILES_TO_METERS = 1609.34;

export interface ObsidianImportResult {
  workoutsCreated: number;
  workoutsSkipped: number;
  setsCreated: number;
}

/**
 * Throws Error('NO_DATE') when the block has no parseable date — the route
 * surfaces that as a 400 and nothing is written. Idempotent per date: a second
 * import of the same date is skipped.
 */
export function importObsidianWorkout(database: typeof db, text: string): ObsidianImportResult {
  const parsed = parseObsidianWorkout(text);
  if (parsed.date === null) {
    throw new Error('NO_DATE');
  }
  const date = parsed.date;

  // Pre-cache all exercises to avoid N+1 lookups (mirrors the fitbod importer).
  const exerciseMap = new Map(
    database.select().from(schema.exercises).all().map((e) => [e.name, e])
  );

  let workoutsCreated = 0;
  let workoutsSkipped = 0;
  let setsCreated = 0;

  database.transaction((tx) => {
    // Skip if a workout already exists for this date (idempotent import).
    const existing = tx
      .select()
      .from(schema.workouts)
      .where(eq(schema.workouts.date, date))
      .get();
    if (existing) {
      workoutsSkipped++;
      return;
    }

    const workout = tx
      .insert(schema.workouts)
      .values({ date, notes: parsed.notes })
      .returning()
      .get();
    workoutsCreated++;

    let order = 0;
    for (const parsedExercise of parsed.exercises) {
      // Find or create exercise using the pre-cached map.
      let exercise = exerciseMap.get(parsedExercise.name);
      if (!exercise) {
        exercise = tx
          .insert(schema.exercises)
          .values({ name: parsedExercise.name })
          .returning()
          .get();
        exerciseMap.set(parsedExercise.name, exercise);
      }

      const we = tx
        .insert(schema.workoutExercises)
        .values({
          workoutId: workout.id,
          exerciseId: exercise.id,
          displayOrder: order++,
        })
        .returning()
        .get();

      for (const set of parsedExercise.sets) {
        tx.insert(schema.sets)
          .values({
            workoutExerciseId: we.id,
            reps: set.reps ?? null,
            weightKg: set.weightLbs !== undefined ? set.weightLbs * LBS_TO_KG : null,
            isWarmup: set.isWarmup ?? false,
            rpe: set.rir ?? null,
            durationSeconds:
              set.durationMin !== undefined ? Math.round(set.durationMin * 60) : null,
            distanceMeters:
              set.distanceMi !== undefined ? set.distanceMi * MILES_TO_METERS : null,
          })
          .run();
        setsCreated++;
      }
    }
  });

  return { workoutsCreated, workoutsSkipped, setsCreated };
}
