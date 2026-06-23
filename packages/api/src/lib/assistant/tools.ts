// Assistant tools — executed server-side inside the agentic loop. These are
// what let the assistant ACT (log weight, look up history, suggest swaps)
// rather than just answer. Each executor returns a plain string fed back to
// the model as the tool_result.
import Anthropic from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { db } from '../../db.js';
import { kgToLbs, lbsToKg, CARDIO_PATTERN } from 'fitlocal-shared';
import { getMusclesForExercise } from '../recovery.js';

const round1 = (n: number) => Math.round(n * 10) / 10;
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Tool definitions sent to the model. Keep this list stable (order + content)
// so prompt caching of the tools block stays valid across turns.
export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'log_body_weight',
    description:
      "Record the user's body weight for today. Call this when the user states their current weight (e.g. \"I weighed 181 this morning\"). Weight is in pounds.",
    input_schema: {
      type: 'object',
      properties: {
        lbs: { type: 'number', description: 'Body weight in pounds' },
      },
      required: ['lbs'],
    },
  },
  {
    name: 'get_exercise_history',
    description:
      'Look up the user\'s logged history for a specific exercise (sets, reps, weight, dates) beyond the recent workouts already in context. Use this to answer "what did I bench last month?" or to check progression on a lift.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exercise name, e.g. "Bench Press" (matched loosely)' },
        limit: { type: 'number', description: 'Max number of past sessions to return (default 5)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_swap_suggestions',
    description:
      'Suggest alternative exercises that train the same muscle group as a given exercise. Use when the user wants to substitute a movement (equipment unavailable, injury, variety).',
    input_schema: {
      type: 'object',
      properties: {
        exerciseName: { type: 'string', description: 'The exercise to find substitutes for' },
      },
      required: ['exerciseName'],
    },
  },
];

// Mutating tools must be surfaced to the user. The endpoint reads this set to
// decide whether a tool event should be echoed in the stream.
export const MUTATING_TOOLS = new Set(['log_body_weight']);

// --- executors ---

function logBodyWeight(lbs: number): string {
  if (typeof lbs !== 'number' || !isFinite(lbs) || lbs <= 0) {
    return 'Error: a positive weight in pounds is required.';
  }
  const date = todayLocal();
  const kg = Math.round(lbsToKg(lbs) * 100) / 100;
  // Idempotent upsert by today's date — same logic as POST /health/sync.
  const existing = db.all<{ id: number }>(
    sql`SELECT id FROM health_snapshots WHERE date = ${date} LIMIT 1`
  );
  if (existing.length > 0) {
    db.run(sql`UPDATE health_snapshots SET body_weight_kg = ${kg} WHERE date = ${date}`);
  } else {
    db.run(sql`INSERT INTO health_snapshots (date, body_weight_kg) VALUES (${date}, ${kg})`);
  }
  return `Logged body weight: ${round1(lbs)} lbs for ${date}.`;
}

function getExerciseHistory(name: string, limit = 5): string {
  if (!name || typeof name !== 'string') return 'Error: an exercise name is required.';
  const lim = Math.max(1, Math.min(Math.floor(limit) || 5, 20));
  const like = `%${name.trim().toLowerCase()}%`;

  const match = db.get<{ id: number; name: string }>(
    sql`SELECT id, name FROM exercises WHERE lower(name) LIKE ${like} ORDER BY length(name) ASC LIMIT 1`
  );
  if (!match) return `No exercise found matching "${name}".`;

  const rows = db.all<{
    date: string;
    reps: number | null;
    weight_kg: number | null;
    duration_seconds: number | null;
  }>(sql`
    SELECT w.date, s.reps, s.weight_kg, s.duration_seconds
    FROM sets s
    JOIN workout_exercises we ON s.workout_exercise_id = we.id
    JOIN workouts w ON we.workout_id = w.id
    WHERE we.exercise_id = ${match.id} AND s.completed = 1
    ORDER BY w.date DESC, s.id ASC
  `);
  if (rows.length === 0) return `No logged sets found for ${match.name}.`;

  // Group by date, newest first, cap to `lim` sessions.
  const byDate = new Map<string, string[]>();
  for (const r of rows) {
    if (!byDate.has(r.date)) {
      if (byDate.size >= lim) continue;
      byDate.set(r.date, []);
    }
    const bucket = byDate.get(r.date);
    if (!bucket) continue;
    if (r.weight_kg != null && r.reps != null) bucket.push(`${r.reps} x ${round1(kgToLbs(r.weight_kg))} lbs`);
    else if (r.duration_seconds) bucket.push(`${Math.round(r.duration_seconds / 60)} min`);
    else if (r.reps != null) bucket.push(`${r.reps} reps`);
  }

  const lines = [...byDate.entries()].map(([date, sets]) => `${date}: ${sets.join(', ')}`);
  return `History for ${match.name}:\n${lines.join('\n')}`;
}

function getSwapSuggestions(exerciseName: string): string {
  if (!exerciseName || typeof exerciseName !== 'string') return 'Error: an exercise name is required.';
  const like = `%${exerciseName.trim().toLowerCase()}%`;
  const original = db.get<{ id: number; name: string }>(
    sql`SELECT id, name FROM exercises WHERE lower(name) LIKE ${like} ORDER BY length(name) ASC LIMIT 1`
  );
  if (!original) return `No exercise found matching "${exerciseName}".`;

  const isCardio = CARDIO_PATTERN.test(original.name);
  const targetMuscles = getMusclesForExercise(original.name);

  const all = db.all<{ id: number; name: string }>(sql`SELECT id, name FROM exercises`);
  const candidates = all
    .filter((e) => e.id !== original.id)
    .filter((e) => {
      const cardio = CARDIO_PATTERN.test(e.name);
      if (isCardio) return cardio; // cardio swaps for cardio only
      if (cardio) return false;
      const muscles = getMusclesForExercise(e.name);
      return muscles.some((m) => targetMuscles.includes(m));
    })
    .map((e) => e.name)
    .sort()
    .slice(0, 8);

  if (candidates.length === 0) return `No good substitutes found for ${original.name}.`;
  return `Substitutes for ${original.name} (same muscle group):\n${candidates.map((n) => `- ${n}`).join('\n')}`;
}

// Dispatch a tool call by name. Returns the tool_result string.
export function executeAssistantTool(name: string, input: Record<string, unknown>): string {
  try {
    switch (name) {
      case 'log_body_weight':
        return logBodyWeight(input.lbs as number);
      case 'get_exercise_history':
        return getExerciseHistory(input.name as string, input.limit as number | undefined);
      case 'get_swap_suggestions':
        return getSwapSuggestions(input.exerciseName as string);
      default:
        return `Error: unknown tool "${name}".`;
    }
  } catch (err) {
    return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Short human-readable summary for the streamed `tool` event chip.
export function summarizeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'log_body_weight':
      return `logged ${input.lbs} lbs`;
    case 'get_exercise_history':
      return `looked up ${input.name} history`;
    case 'get_swap_suggestions':
      return `found swaps for ${input.exerciseName}`;
    default:
      return name;
  }
}
