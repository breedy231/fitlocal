// Per-request context for the AI assistant. Pure: reads real data from the DB
// and renders it as a plain-text block for the LLM system prompt. No nutrition
// numbers are hardcoded here — everything comes from the DB (see Phase 2 audit).
import { sql } from 'drizzle-orm';
import { db } from '../../db.js';
import { kgToLbs, metersToMiles } from 'fitlocal-shared';

// Drizzle's sql template binds an array as a single param, so an `IN (list)`
// clause must be built from individual placeholders.
const inList = (ids: number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

const round1 = (n: number) => Math.round(n * 10) / 10;

export function assembleContext(): string {
  const _d = new Date();
  const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;

  const goals = db.get<{
    maintenance_calories: number | null;
    target_calories: number | null;
    target_protein_g: number | null;
    target_weight_kg: number | null;
    cut_start_date: string | null;
    cut_end_date: string | null;
  }>(sql`SELECT maintenance_calories, target_calories, target_protein_g, target_weight_kg, cut_start_date, cut_end_date FROM user_goals LIMIT 1`);

  const workouts = db.all<{ id: number; date: string; notes: string | null }>(
    sql`SELECT id, date, notes FROM workouts ORDER BY date DESC LIMIT 7`
  );
  const workoutIds = workouts.map((w) => w.id);

  const workoutExercises = workoutIds.length
    ? db.all<{ id: number; workout_id: number; exercise_id: number; display_order: number }>(
        sql`SELECT id, workout_id, exercise_id, display_order FROM workout_exercises
            WHERE workout_id IN (${inList(workoutIds)}) ORDER BY workout_id, display_order`
      )
    : [];

  const exerciseIds = [...new Set(workoutExercises.map((we) => we.exercise_id))];
  const exerciseNames = new Map<number, string>(
    (exerciseIds.length
      ? db.all<{ id: number; name: string }>(
          sql`SELECT id, name FROM exercises WHERE id IN (${inList(exerciseIds)})`
        )
      : []
    ).map((e) => [e.id, e.name])
  );

  const weIds = workoutExercises.map((we) => we.id);
  const sets = weIds.length
    ? db.all<{
        workout_exercise_id: number;
        reps: number | null;
        weight_kg: number | null;
        duration_seconds: number | null;
        distance_meters: number | null;
      }>(sql`SELECT workout_exercise_id, reps, weight_kg, duration_seconds, distance_meters
             FROM sets WHERE workout_exercise_id IN (${inList(weIds)}) AND completed = 1
             ORDER BY workout_exercise_id, id`)
    : [];

  const health = db.all<{
    date: string;
    hrv: number | null;
    sleep_hours: number | null;
    calories: number | null;
    protein_g: number | null;
    body_weight_kg: number | null;
  }>(sql`SELECT date, hrv, sleep_hours, calories, protein_g, body_weight_kg
         FROM health_snapshots ORDER BY date DESC LIMIT 30`);

  const lines: string[] = [];
  lines.push(`Current date: ${today}`);

  // Goals / nutrition targets — only what the DB actually has.
  lines.push('');
  if (goals) {
    const g: string[] = [];
    if (goals.target_calories != null) g.push(`target calories ${goals.target_calories}`);
    if (goals.maintenance_calories != null) g.push(`maintenance ${goals.maintenance_calories}`);
    if (goals.target_protein_g != null) g.push(`protein ${goals.target_protein_g}g`);
    if (goals.target_weight_kg != null) g.push(`goal weight ${round1(kgToLbs(goals.target_weight_kg))} lbs`);
    lines.push(`Nutrition targets: ${g.length ? g.join(', ') : 'none set'}`);
    if (goals.cut_start_date && goals.cut_end_date) {
      lines.push(`Cut window: ${goals.cut_start_date} → ${goals.cut_end_date}`);
    }
  } else {
    lines.push('No goals configured.');
  }

  // Recent workouts.
  lines.push('');
  lines.push('Recent workouts (last 7):');
  if (workouts.length === 0) lines.push('  (none logged yet)');
  for (const w of workouts) {
    lines.push(`${w.date}${w.notes ? ` — ${w.notes}` : ''}`);
    const wes = workoutExercises.filter((we) => we.workout_id === w.id);
    for (const we of wes) {
      const name = exerciseNames.get(we.exercise_id);
      if (!name) continue;
      const exSets = sets.filter((s) => s.workout_exercise_id === we.id);
      if (exSets.length === 0) continue;
      const summary = exSets
        .map((s) => {
          if (s.weight_kg != null && s.reps != null) return `${s.reps} x ${round1(kgToLbs(s.weight_kg))} lbs`;
          if (s.reps != null && s.weight_kg == null && !s.duration_seconds && !s.distance_meters) return `${s.reps} reps`;
          if (s.duration_seconds) return `${Math.round(s.duration_seconds / 60)} min`;
          if (s.distance_meters) return `${round1(metersToMiles(s.distance_meters))} mi`;
          return null;
        })
        .filter((x): x is string => x !== null);
      if (summary.length) lines.push(`  ${name}: ${summary.join(', ')}`);
    }
  }

  // Recent health.
  lines.push('');
  lines.push('Recent health (last 30 days):');
  if (health.length === 0) lines.push('  (no data)');
  for (const h of health) {
    const parts: string[] = [];
    if (h.body_weight_kg != null) parts.push(`weight ${round1(kgToLbs(h.body_weight_kg))} lbs`);
    if (h.calories != null) parts.push(`${h.calories} cal`);
    if (h.protein_g != null) parts.push(`${h.protein_g}g protein`);
    if (h.hrv != null) parts.push(`HRV ${h.hrv}`);
    if (h.sleep_hours != null) parts.push(`${h.sleep_hours}h sleep`);
    if (parts.length) lines.push(`  ${h.date}: ${parts.join(', ')}`);
  }

  return lines.join('\n');
}
