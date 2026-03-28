import { FastifyInstance } from 'fastify';
import { sql, eq, asc } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { parseMASPdf } from '../lib/pdf-parser.js';
import { computeProgression } from '../lib/progression.js';

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
  app.post('/programs/import-pdf', async (req, reply) => {
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

        // Try to match to existing exercise in DB
        const match = db.all<{ id: number }>(sql`
          SELECT id FROM exercises WHERE lower(name) = lower(${pEx.name}) LIMIT 1
        `);

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

    // Enrich with progression data
    const enriched = exercises.map(ex => {
      if (ex.exerciseId) {
        const prog = computeProgression(ex.exerciseId, ex.exerciseName, db);
        return {
          ...ex,
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
