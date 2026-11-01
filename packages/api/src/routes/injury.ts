import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { INJURY_PATTERNS, INJURY_MUSCLES, type InjuryRestriction, type InjuryRestrictionInput, type InjuryPreview } from 'fitlocal-shared';
import { db } from '../db.js';
import { getActiveRestriction, restrictionReasons } from '../lib/injury.js';

// Runtime validation (#82) — see routes/sets.ts for the conventions.
const rulesProperties = {
  avoidPatterns: { type: 'array', items: { type: 'string', enum: [...INJURY_PATTERNS] } },
  avoidMuscles: { type: 'array', items: { type: 'string', enum: [...INJURY_MUSCLES] } },
  avoidExerciseIds: { type: 'array', items: { type: 'integer' } },
  allowExerciseIds: { type: 'array', items: { type: 'integer' } },
} as const;

const restrictionBody = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'avoidPatterns', 'avoidMuscles', 'avoidExerciseIds', 'allowExerciseIds'],
  properties: {
    label: { type: 'string', minLength: 1 },
    notes: { type: ['string', 'null'] },
    ...rulesProperties,
  },
} as const;

const previewBody = {
  type: 'object',
  additionalProperties: false,
  required: ['avoidPatterns', 'avoidMuscles', 'avoidExerciseIds', 'allowExerciseIds'],
  properties: rulesProperties,
} as const;

function preview(r: InjuryRestriction): InjuryPreview {
  const all = db.all<{ id: number; name: string; equipment: string | null }>(
    sql`SELECT id, name, equipment FROM exercises ORDER BY name`
  );
  const excluded = all
    .map(e => ({ id: e.id, name: e.name, reasons: restrictionReasons(e, r) }))
    .filter(e => e.reasons.length > 0);
  return { excluded };
}

export async function injuryRoutes(app: FastifyInstance) {
  // The single active injury restriction, or null.
  app.get('/injury', async (): Promise<InjuryRestriction | null> => getActiveRestriction(db));

  // Create or replace the active restriction. One active injury at a time:
  // an existing active row is updated in place (keeps its start date).
  app.put<{ Body: InjuryRestrictionInput }>('/injury', { schema: { body: restrictionBody } }, async (req) => {
    const b = req.body;
    const cols = {
      label: b.label,
      notes: b.notes ?? null,
      patterns: JSON.stringify(b.avoidPatterns),
      muscles: JSON.stringify(b.avoidMuscles),
      avoidIds: JSON.stringify(b.avoidExerciseIds),
      allowIds: JSON.stringify(b.allowExerciseIds),
    };
    const active = getActiveRestriction(db);
    if (active) {
      db.run(sql`UPDATE injury_restrictions SET label = ${cols.label}, notes = ${cols.notes},
        avoid_patterns = ${cols.patterns}, avoid_muscles = ${cols.muscles},
        avoid_exercise_ids = ${cols.avoidIds}, allow_exercise_ids = ${cols.allowIds}
        WHERE id = ${active.id}`);
    } else {
      db.run(sql`INSERT INTO injury_restrictions (label, notes, avoid_patterns, avoid_muscles, avoid_exercise_ids, allow_exercise_ids)
        VALUES (${cols.label}, ${cols.notes}, ${cols.patterns}, ${cols.muscles}, ${cols.avoidIds}, ${cols.allowIds})`);
    }
    return getActiveRestriction(db);
  });

  // Clear the active restriction (the row is kept, stamped cleared_at).
  app.delete('/injury', async () => {
    db.run(sql`UPDATE injury_restrictions SET cleared_at = datetime('now') WHERE cleared_at IS NULL`);
    return { cleared: true };
  });

  // What the active restriction removes from the catalog.
  app.get('/injury/preview', async (): Promise<InjuryPreview> => {
    const active = getActiveRestriction(db);
    return active ? preview(active) : { excluded: [] };
  });

  // What a draft set of rules would remove — lets Settings preview before saving.
  app.post<{ Body: Omit<InjuryRestrictionInput, 'label' | 'notes'> }>(
    '/injury/preview',
    { schema: { body: previewBody } },
    async (req): Promise<InjuryPreview> =>
      preview({ id: 0, label: '', notes: null, startedAt: '', ...req.body }),
  );
}
