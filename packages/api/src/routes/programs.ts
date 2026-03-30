import { FastifyInstance } from 'fastify';
import { sql, eq, asc } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { parseMASPdf } from '../lib/pdf-parser.js';
import { computeProgression } from '../lib/progression.js';

// Normalize exercise name for fuzzy matching: lowercase, strip parentheticals, common prefixes, plurals
function normalizeExName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, '') // remove parentheticals
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

// Find best matching exercise from DB by fuzzy name comparison
// Prefers exercises with workout history over exact-name matches with none
function fuzzyMatchExercise(name: string, allExercises: { id: number; name: string; workouts: number }[]): { id: number; name: string; workouts: number } | null {
  const norm = normalizeExName(name);
  if (!norm) return null;

  // Collect all normalized matches
  const exactNormMatches = allExercises.filter(ex => normalizeExName(ex.name) === norm);
  if (exactNormMatches.length > 0) {
    // Prefer the one with most workout history
    exactNormMatches.sort((a, b) => b.workouts - a.workouts);
    return exactNormMatches[0];
  }

  // Fuzzy: word overlap scoring, with history as tiebreaker
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

export async function programRoutes(app: FastifyInstance) {

  // List all programs
  app.get('/programs', async () => {
    const programs = db.select().from(schema.programs).all();
    return programs.map(p => {
      const days = db.select().from(schema.programDays)
        .where(eq(schema.programDays.programId, p.id))
        .orderBy(asc(schema.programDays.dayOrder))
        .all();
      return { ...p, dayCount: days.length };
    });
  });

  // Get a single program with full structure
  app.get<{ Params: { id: string } }>('/programs/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    const program = db.select().from(schema.programs).where(eq(schema.programs.id, id)).get();
    if (!program) return reply.status(404).send({ error: 'Program not found' });

    const days = db.select().from(schema.programDays)
      .where(eq(schema.programDays.programId, id))
      .orderBy(asc(schema.programDays.dayOrder))
      .all();

    const daysWithExercises = days.map(day => {
      const exercises = db.select().from(schema.programExercises)
        .where(eq(schema.programExercises.programDayId, day.id))
        .orderBy(asc(schema.programExercises.displayOrder))
        .all();
      return { ...day, exercises };
    });

    return { ...program, days: daysWithExercises };
  });

  // Import program from M&S PDF
  app.post('/programs/import-pdf', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const pdfBuffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body as string, 'binary');

    if (pdfBuffer.length < 100) {
      return reply.status(400).send({ error: 'Invalid PDF data' });
    }

    const parsed = parseMASPdf(pdfBuffer);

    if (parsed.days.length === 0) {
      return reply.status(400).send({ error: 'No workout days found in PDF' });
    }

    // Insert program
    const program = db.insert(schema.programs).values({
      name: parsed.name || 'Imported Program',
      description: parsed.description,
      daysPerWeek: parsed.daysPerWeek ?? parsed.days.length,
      durationWeeks: parsed.durationWeeks,
      source: parsed.source || 'muscleandstrength.com',
    }).returning().get();

    let totalExercises = 0;

    for (let dayIdx = 0; dayIdx < parsed.days.length; dayIdx++) {
      const pDay = parsed.days[dayIdx];

      const day = db.insert(schema.programDays).values({
        programId: program.id,
        name: pDay.name,
        dayOrder: dayIdx,
        musclesFocus: pDay.musclesFocus,
      }).returning().get();

      for (let exIdx = 0; exIdx < pDay.exercises.length; exIdx++) {
        const pEx = pDay.exercises[exIdx];

        // Try to match to existing exercise in DB (exact first, then fuzzy)
        const allExercises = db.all<{ id: number; name: string; workouts: number }>(sql`
          SELECT e.id, e.name, COUNT(DISTINCT we.workout_id) as workouts
          FROM exercises e
          LEFT JOIN workout_exercises we ON we.exercise_id = e.id
          GROUP BY e.id`);
        // Prefer exact name match WITH history, then fuzzy match with history
        const exactMatches = allExercises.filter(e => e.name.toLowerCase() === pEx.name.toLowerCase());
        exactMatches.sort((a, b) => b.workouts - a.workouts);
        const match = exactMatches.length > 0 ? [exactMatches[0]] : [];
        if (match.length === 0 || match[0].workouts === 0) {
          const fuzzy = fuzzyMatchExercise(pEx.name, allExercises);
          if (fuzzy && fuzzy.workouts > (match[0]?.workouts ?? 0)) {
            match[0] = fuzzy;
          }
        }

        db.insert(schema.programExercises).values({
          programDayId: day.id,
          exerciseName: pEx.name,
          exerciseId: match.length > 0 ? match[0].id : null,
          displayOrder: exIdx,
          targetSets: pEx.sets,
          targetReps: pEx.reps,
          restSeconds: pEx.restSeconds,
          notes: pEx.notes,
        }).run();

        totalExercises++;
      }
    }

    return reply.status(201).send({
      id: program.id,
      name: program.name,
      daysImported: parsed.days.length,
      exercisesImported: totalExercises,
      days: parsed.days.map(d => ({ name: d.name, musclesFocus: d.musclesFocus, exerciseCount: d.exercises.length })),
    });
  });

  // Delete a program
  app.delete<{ Params: { id: string } }>('/programs/:id', async (req, reply) => {
    const id = parseInt(req.params.id);
    db.delete(schema.programs).where(eq(schema.programs.id, id)).run();
    return reply.status(204).send();
  });

  // Activate a program (set it as the current program to follow)
  app.post<{ Params: { id: string } }>('/programs/:id/activate', async (req, reply) => {
    const id = parseInt(req.params.id);
    const program = db.select().from(schema.programs).where(eq(schema.programs.id, id)).get();
    if (!program) return reply.status(404).send({ error: 'Program not found' });

    // Clear any existing active program
    db.delete(schema.activeProgram).run();

    const today = new Date().toISOString().slice(0, 10);
    const active = db.insert(schema.activeProgram).values({
      programId: id,
      startDate: today,
      currentDayIndex: 0,
    }).returning().get();

    return { active, program };
  });

  // Deactivate the current program
  app.delete('/programs/active', async (_req, reply) => {
    db.delete(schema.activeProgram).run();
    return reply.status(204).send();
  });

  // Get the current active program and next workout day
  app.get('/programs/active', async (_req, reply) => {
    const active = db.select().from(schema.activeProgram).get();
    if (!active) return reply.status(404).send({ error: 'No active program' });

    const program = db.select().from(schema.programs).where(eq(schema.programs.id, active.programId)).get();
    if (!program) return reply.status(404).send({ error: 'Program not found' });

    const days = db.select().from(schema.programDays)
      .where(eq(schema.programDays.programId, program.id))
      .orderBy(asc(schema.programDays.dayOrder))
      .all();

    const currentDay = days[active.currentDayIndex % days.length];
    if (!currentDay) return reply.status(500).send({ error: 'Invalid day index' });

    const exercises = db.select().from(schema.programExercises)
      .where(eq(schema.programExercises.programDayId, currentDay.id))
      .orderBy(asc(schema.programExercises.displayOrder))
      .all();

    // Enrich with progression data — fuzzy match unlinked exercises on the fly
    const allExercises = db.all<{ id: number; name: string; workouts: number }>(sql`
      SELECT e.id, e.name, COUNT(DISTINCT we.workout_id) as workouts
      FROM exercises e
      LEFT JOIN workout_exercises we ON we.exercise_id = e.id
      GROUP BY e.id`);
    const enriched = exercises.map(ex => {
      let exerciseId = ex.exerciseId;

      // If no linked exercise, try fuzzy match
      if (!exerciseId) {
        const fuzzy = fuzzyMatchExercise(ex.exerciseName, allExercises);
        if (fuzzy) {
          exerciseId = fuzzy.id;
          // Persist the link for future lookups
          db.run(sql`UPDATE program_exercises SET exercise_id = ${fuzzy.id} WHERE id = ${ex.id}`);
        }
      }

      if (exerciseId) {
        const prog = computeProgression(exerciseId, ex.exerciseName, db);
        return {
          ...ex,
          exerciseId,
          progression: prog.directive,
          suggestedWeightKg: prog.weightKg,
          suggestedReps: prog.reps,
          repRange: prog.repRange,
        };
      }
      return { ...ex, progression: null, suggestedWeightKg: null, suggestedReps: null, repRange: null };
    });

    return {
      program: { id: program.id, name: program.name },
      dayIndex: active.currentDayIndex,
      totalDays: days.length,
      day: { ...currentDay, exercises: enriched },
    };
  });

  // Advance to the next day in the program
  app.post('/programs/active/advance', async (_req, reply) => {
    const active = db.select().from(schema.activeProgram).get();
    if (!active) return reply.status(404).send({ error: 'No active program' });

    const days = db.select().from(schema.programDays)
      .where(eq(schema.programDays.programId, active.programId))
      .all();

    const nextIndex = (active.currentDayIndex + 1) % days.length;
    db.update(schema.activeProgram)
      .set({ currentDayIndex: nextIndex })
      .where(eq(schema.activeProgram.id, active.id))
      .run();

    return { dayIndex: nextIndex, totalDays: days.length };
  });
}
