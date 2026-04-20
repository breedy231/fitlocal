import { FastifyInstance } from 'fastify';
import { sql, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { computeProgressionBatch, estimateWeightForNewExercise, classifyExercise, getRepRange } from '../lib/progression.js';

// Normalize exercise name for fuzzy matching (shared logic with programs)
function normalizeExName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/^(barbell|dumbbell|cable|machine|smith machine|ez bar|flat|seated|standing|weighted)\s+/g, '')
    .replace(/\s+(barbell|dumbbell|cable|machine)\s*/g, ' ')
    .replace(/deadlifts/g, 'deadlift')
    .replace(/squats/g, 'squat')
    .replace(/curls/g, 'curl')
    .replace(/raises/g, 'raise')
    .replace(/extensions/g, 'extension')
    .replace(/presses/g, 'press')
    .replace(/rows/g, 'row')
    .replace(/\s+/g, ' ')
    .trim();
}

function fuzzyMatchExercise(name: string, allExercises: { id: number; name: string; workouts: number }[]): { id: number; name: string; workouts: number } | null {
  const norm = normalizeExName(name);
  if (!norm) return null;

  const exactNormMatches = allExercises.filter(ex => normalizeExName(ex.name) === norm);
  if (exactNormMatches.length > 0) {
    exactNormMatches.sort((a, b) => b.workouts - a.workouts);
    return exactNormMatches[0];
  }

  const normWords = norm.split(' ').filter(w => w.length > 2);
  let bestMatch: { id: number; name: string; workouts: number } | null = null;
  let bestScore = 0;
  let bestWorkouts = 0;

  for (const ex of allExercises) {
    const exNorm = normalizeExName(ex.name);
    const exWords = exNorm.split(' ').filter(w => w.length > 2);
    const overlap = normWords.filter(w => exWords.includes(w)).length;
    const score = overlap / Math.max(normWords.length, exWords.length);
    if (score >= 0.5 && (score > bestScore || (score === bestScore && ex.workouts > bestWorkouts))) {
      bestScore = score;
      bestMatch = ex;
      bestWorkouts = ex.workouts;
    }
  }

  return bestMatch;
}

interface RoutineExercise {
  exerciseName: string;
  exerciseId: number | null;
  targetSets: number;
  targetReps: string;
}

export async function routineRoutes(app: FastifyInstance) {

  // List all routines
  app.get('/routines', async () => {
    return db.select().from(schema.routines).all();
  });

  // Get routine with progression data
  app.get<{ Params: { id: string } }>('/routines/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const routine = db.select().from(schema.routines).where(eq(schema.routines.id, id)).get();
    if (!routine) return reply.status(404).send({ error: 'Routine not found' });

    // Fetch all exercises with workout counts for fuzzy matching
    const allExercises = db.all<{ id: number; name: string; workouts: number }>(sql`
      SELECT e.id, e.name, COUNT(DISTINCT we.workout_id) as workouts
      FROM exercises e
      LEFT JOIN workout_exercises we ON we.exercise_id = e.id
      GROUP BY e.id
    `);

    const exercises = routine.exercises as RoutineExercise[];

    // Resolve exercise IDs via fuzzy match where needed
    for (const ex of exercises) {
      if (!ex.exerciseId) {
        const match = fuzzyMatchExercise(ex.exerciseName, allExercises);
        if (match) ex.exerciseId = match.id;
      }
    }

    // Compute progression for matched exercises
    const matched = exercises.filter(ex => ex.exerciseId != null);
    const progressionMap = matched.length > 0
      ? computeProgressionBatch(
          matched.map(ex => ({ id: ex.exerciseId!, name: ex.exerciseName })),
          db
        )
      : new Map();

    const enriched = exercises.map(ex => {
      const prog = ex.exerciseId ? progressionMap.get(ex.exerciseId) : null;
      const isEstimate = prog ? false : true;
      let suggestedWeightKg: number | null = null;
      let suggestedReps: number | null = null;
      let repRange: { min: number; max: number } | null = null;
      let directive: string | null = null;

      if (prog) {
        suggestedWeightKg = prog.weightKg;
        suggestedReps = prog.reps;
        repRange = { min: prog.repRange.min, max: prog.repRange.max };
        directive = prog.directive;
      } else if (ex.exerciseId) {
        // New exercise — estimate weight
        const est = estimateWeightForNewExercise(ex.exerciseName, db);
        const cls = classifyExercise(ex.exerciseName);
        const range = getRepRange(cls);
        suggestedWeightKg = est;
        suggestedReps = range.min;
        repRange = { min: range.min, max: range.max };
        directive = 'hold';
      }

      return {
        exerciseName: ex.exerciseName,
        exerciseId: ex.exerciseId,
        targetSets: ex.targetSets,
        targetReps: ex.targetReps,
        suggestedWeightKg,
        suggestedReps,
        repRange,
        progression: directive,
        isEstimate,
      };
    });

    return { ...routine, exercises: enriched };
  });

  // Create routine from text (exercise names, one per line)
  app.post<{ Body: { name: string; text: string } }>('/routines', async (req, reply) => {
    const { name, text } = req.body as { name?: string; text?: string };
    if (!name || !text) {
      return reply.status(400).send({ error: 'name and text are required' });
    }

    // Fetch all exercises with workout counts
    const allExercises = db.all<{ id: number; name: string; workouts: number }>(sql`
      SELECT e.id, e.name, COUNT(DISTINCT we.workout_id) as workouts
      FROM exercises e
      LEFT JOIN workout_exercises we ON we.exercise_id = e.id
      GROUP BY e.id
    `);

    // Parse lines: "exercise name" or "3x10 exercise name" or "exercise name 3x10"
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const setsRepsPattern = /^(\d+)\s*[x×]\s*(\d+)\s+(.+)$|^(.+?)\s+(\d+)\s*[x×]\s*(\d+)$/i;

    const exercises: RoutineExercise[] = lines.map(line => {
      const match = setsRepsPattern.exec(line);
      let exerciseName: string;
      let targetSets = 3;
      let targetReps = '10';

      if (match) {
        if (match[1]) {
          // "3x10 exercise name"
          targetSets = parseInt(match[1]);
          targetReps = match[2];
          exerciseName = match[3].trim();
        } else {
          // "exercise name 3x10"
          exerciseName = match[4].trim();
          targetSets = parseInt(match[5]);
          targetReps = match[6];
        }
      } else {
        exerciseName = line;
      }

      const fuzzy = fuzzyMatchExercise(exerciseName, allExercises);
      return {
        exerciseName: fuzzy ? fuzzy.name : exerciseName,
        exerciseId: fuzzy ? fuzzy.id : null,
        targetSets,
        targetReps,
      };
    });

    const result = db.insert(schema.routines).values({
      name,
      exercises: exercises as any,
    }).returning().get();

    return reply.status(201).send({
      id: result.id,
      name: result.name,
      exercises,
      matched: exercises.filter(e => e.exerciseId != null).length,
      unmatched: exercises.filter(e => e.exerciseId == null).length,
    });
  });

  // Delete routine
  app.delete<{ Params: { id: string } }>('/routines/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    db.delete(schema.routines).where(eq(schema.routines.id, id)).run();
    return reply.status(204).send();
  });
}
