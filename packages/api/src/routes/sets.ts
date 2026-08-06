import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { touchWorkoutEnd } from '../lib/session-window.js';
import { idParams } from '../lib/http.js';

// Runtime validation (#82). additionalProperties: false + Fastify's default
// AJV removeAdditional strips unknown keys before they reach Drizzle — so a
// body can't overwrite `id` or re-parent a set via `workoutExerciseId` (the
// UI never moves sets between exercises). Fields are nullable because the
// client sends null to clear a value.
const setFields = {
  reps: { type: ['integer', 'null'] },
  weightKg: { type: ['number', 'null'] },
  isWarmup: { type: ['boolean', 'null'] },
  rpe: { type: ['number', 'null'] },
  multiplier: { type: ['number', 'null'] },
  durationSeconds: { type: ['number', 'null'] },
  distanceMeters: { type: ['number', 'null'] },
  resistance: { type: ['number', 'null'] },
  completed: { type: ['boolean', 'null'] },
} as const;

const createSetBody = {
  type: 'object',
  additionalProperties: false,
  required: ['workoutExerciseId'],
  properties: { workoutExerciseId: { type: 'integer' }, ...setFields },
} as const;

// minProperties: a body that strips down to {} would make Drizzle's .set({})
// throw — reject it as a 400 instead.
const updateSetBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: setFields,
} as const;

export async function setRoutes(app: FastifyInstance) {
  // Add set to a workout exercise
  app.post<{
    Body: { workoutExerciseId: number; reps?: number; weightKg?: number; isWarmup?: boolean; rpe?: number };
  }>('/sets', { schema: { body: createSetBody } }, async (req, reply) => {
    const result = db.insert(schema.sets).values(req.body).returning().get();
    // Heartbeat: extend the workout's HR window to this activity (#59).
    touchWorkoutEnd(result.workoutExerciseId);
    return reply.status(201).send(result);
  });

  // Update set (PUT)
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/sets/:id', { schema: { params: idParams, body: updateSetBody } }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const result = db.update(schema.sets).set(req.body).where(eq(schema.sets.id, id)).returning().get();
    if (!result) return reply.status(404).send({ error: 'Not found' });
    touchWorkoutEnd(result.workoutExerciseId);
    return result;
  });

  // Update set (PATCH)
  app.patch<{ Params: { id: string }; Body: { reps?: number; weightKg?: number; rpe?: number; durationSeconds?: number; distanceMeters?: number; resistance?: number } }>('/sets/:id', { schema: { params: idParams, body: updateSetBody } }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const result = db.update(schema.sets).set(req.body).where(eq(schema.sets.id, id)).returning().get();
    if (!result) return reply.status(404).send({ error: 'Not found' });
    touchWorkoutEnd(result.workoutExerciseId);
    return result;
  });

  // Delete set
  app.delete<{ Params: { id: string } }>('/sets/:id', { schema: { params: idParams } }, async (req, reply) => {
    const id = parseInt(req.params.id);
    db.delete(schema.sets).where(eq(schema.sets.id, id)).run();
    return reply.status(204).send();
  });
}
