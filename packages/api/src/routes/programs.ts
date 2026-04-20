import { FastifyInstance } from 'fastify';
import { sql, eq, asc } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { parseMASPdf } from '../lib/pdf-parser.js';
import { computeProgression, estimateWeightForNewExercise, classifyExercise, getRepRange } from '../lib/progression.js';

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

  // Export program as JSON
  app.get<{ Params: { id: string } }>('/programs/:id/export', async (req, reply) => {
    const id = parseInt(req.params.id);
    const program = db.select().from(schema.programs).where(eq(schema.programs.id, id)).get();
    if (!program) return reply.status(404).send({ error: 'Program not found' });

    const days = db.select().from(schema.programDays)
      .where(eq(schema.programDays.programId, id))
      .orderBy(asc(schema.programDays.dayOrder))
      .all();

    const exported = {
      version: 1,
      name: program.name,
      description: program.description,
      daysPerWeek: program.daysPerWeek,
      durationWeeks: program.durationWeeks,
      source: program.source,
      cardioPlan: program.cardioPlan,
      days: days.map(day => {
        const exercises = db.select().from(schema.programExercises)
          .where(eq(schema.programExercises.programDayId, day.id))
          .orderBy(asc(schema.programExercises.displayOrder))
          .all();
        return {
          name: day.name,
          musclesFocus: day.musclesFocus,
          exercises: exercises.map(ex => ({
            name: ex.exerciseName,
            sets: ex.targetSets,
            reps: ex.targetReps,
            restSeconds: ex.restSeconds,
            notes: ex.notes,
          })),
        };
      }),
    };

    reply.header('Content-Disposition', `attachment; filename="${program.name.replace(/[^a-zA-Z0-9]/g, '_')}.json"`);
    return exported;
  });

  // Import program from JSON
  app.post('/programs/import-json', async (req, reply) => {
    const data = req.body as any;
    if (!data?.name || !data?.days?.length) {
      return reply.status(400).send({ error: 'Invalid program JSON: requires name and days' });
    }

    // Fetch all exercises for matching
    const allExercises = db.all<{ id: number; name: string; workouts: number }>(sql`
      SELECT e.id, e.name, COUNT(DISTINCT we.workout_id) as workouts
      FROM exercises e
      LEFT JOIN workout_exercises we ON we.exercise_id = e.id
      GROUP BY e.id`);

    const program = db.insert(schema.programs).values({
      name: data.name,
      description: data.description || null,
      daysPerWeek: data.daysPerWeek || data.days.length,
      durationWeeks: data.durationWeeks || null,
      source: data.source || 'json-import',
      cardioPlan: data.cardioPlan || null,
    }).returning().get();

    let totalExercises = 0;

    for (let dayIdx = 0; dayIdx < data.days.length; dayIdx++) {
      const pDay = data.days[dayIdx];
      const day = db.insert(schema.programDays).values({
        programId: program.id,
        name: pDay.name || `Day ${dayIdx + 1}`,
        dayOrder: dayIdx,
        musclesFocus: pDay.musclesFocus || null,
      }).returning().get();

      for (let exIdx = 0; exIdx < (pDay.exercises?.length || 0); exIdx++) {
        const pEx = pDay.exercises[exIdx];
        const match = fuzzyMatchExercise(pEx.name, allExercises);

        db.insert(schema.programExercises).values({
          programDayId: day.id,
          exerciseName: pEx.name,
          exerciseId: match?.id || null,
          displayOrder: exIdx,
          targetSets: pEx.sets || null,
          targetReps: pEx.reps || null,
          restSeconds: pEx.restSeconds || null,
          notes: pEx.notes || null,
        }).run();

        totalExercises++;
      }
    }

    return reply.status(201).send({
      id: program.id,
      name: program.name,
      daysImported: data.days.length,
      exercisesImported: totalExercises,
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
          isEstimate: prog.isEstimate ?? false,
        };
      }

      // No matched exercise — try muscle-group estimation from name alone
      const estimated = estimateWeightForNewExercise(ex.exerciseName, db);
      const classification = classifyExercise(ex.exerciseName);
      const repRange = getRepRange(classification);
      return {
        ...ex,
        progression: null,
        suggestedWeightKg: estimated,
        suggestedReps: repRange.min + Math.floor((repRange.max - repRange.min) / 2),
        repRange,
        isEstimate: estimated > 0,
      };
    });

    // Compute cardio plan info for current week
    let cardio: { week: number; sessions: number[]; completedThisWeek: number } | null = null;
    if (program.cardioPlan) {
      const plan = program.cardioPlan as { week: number; sessions: number[] }[];
      const startDate = new Date(active.startDate);
      const now = new Date();
      const daysSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.min(Math.floor(daysSinceStart / 7) + 1, plan.length);
      const weekPlan = plan.find(p => p.week === currentWeek);

      if (weekPlan) {
        // Count cardio workouts this calendar week (Mon-Sun)
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0=Sun
        const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const monday = new Date(today);
        monday.setDate(today.getDate() - mondayOffset);
        const mondayStr = monday.toISOString().slice(0, 10);

        const cardioCount = db.all<{ cnt: number }>(sql`
          SELECT COUNT(DISTINCT w.id) as cnt
          FROM workouts w
          JOIN workout_exercises we ON we.workout_id = w.id
          JOIN exercises e ON we.exercise_id = e.id
          WHERE w.date >= ${mondayStr}
            AND (lower(e.name) GLOB '*treadmill*'
              OR lower(e.name) GLOB '*elliptical*'
              OR lower(e.name) GLOB '*cycling*'
              OR lower(e.name) GLOB '*rowing*'
              OR lower(e.name) GLOB '*cardio*'
              OR lower(e.name) GLOB '*swimming*')
        `);

        cardio = {
          week: currentWeek,
          sessions: weekPlan.sessions,
          completedThisWeek: cardioCount[0]?.cnt ?? 0,
        };
      }
    }

    return {
      program: { id: program.id, name: program.name },
      dayIndex: active.currentDayIndex,
      totalDays: days.length,
      day: { ...currentDay, exercises: enriched },
      cardio,
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
