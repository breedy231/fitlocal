import { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { generateWorkout, generateFromProgram, DAY_TYPE_MUSCLES, type ProgramExerciseInput } from '../lib/generator.js';
import { computeProgressionBatch } from '../lib/progression.js';
import { getMusclesForExercise } from '../lib/recovery.js';
import { matchesEquipment, normalizeAvailableEquipment } from '../lib/equipment-match.js';
import { CARDIO_PATTERN } from 'fitlocal-shared';

// Resolve equipment filter: profileId takes priority, then legacy equipment param
function resolveEquipment(profileId?: string, equipment?: string): string[] | null {
  if (profileId) {
    const profile = db.select().from(schema.equipmentProfiles).where(eq(schema.equipmentProfiles.id, parseInt(profileId))).get();
    if (profile) {
      const equip = profile.availableEquipment as string[] | null;
      return equip && equip.length > 0 ? equip : null;
    }
  }
  // Legacy backward compat
  if (equipment === 'travel') return ['dumbbell', 'bodyweight', 'band', 'trx', 'cardio'];
  return null; // 'full' or default = no restriction
}

function detectCutPhase(today: string): boolean {
  const cutGoals = db.all<{ cut_start_date: string | null; cut_end_date: string | null }>(
    sql`SELECT cut_start_date, cut_end_date FROM user_goals LIMIT 1`
  );
  return cutGoals.length > 0
    && cutGoals[0].cut_start_date != null
    && cutGoals[0].cut_end_date != null
    && today >= cutGoals[0].cut_start_date
    && today <= cutGoals[0].cut_end_date;
}

function loadActiveProgramExercises(dayType: string): ProgramExerciseInput[] | null {
  const activeRow = db.all<{ program_id: number; current_day_index: number }>(
    sql`SELECT program_id, current_day_index FROM active_program LIMIT 1`
  );
  if (activeRow.length === 0) return null;

  const active = activeRow[0];
  const days = db.all<{ id: number; name: string; day_order: number }>(
    sql`SELECT id, name, day_order FROM program_days WHERE program_id = ${active.program_id} ORDER BY day_order`
  );
  const currentDay = days[active.current_day_index % days.length];
  if (!currentDay || !currentDay.name.toLowerCase().includes(dayType.toLowerCase())) return null;

  const rows = db.all<{ exercise_id: number | null; exercise_name: string; target_sets: number | null; target_reps: string | null; rest_seconds: number | null }>(
    sql`SELECT exercise_id, exercise_name, target_sets, target_reps, rest_seconds FROM program_exercises WHERE program_day_id = ${currentDay.id} ORDER BY display_order`
  );
  if (rows.length === 0) return null;

  return rows.map(r => ({
    exerciseId: r.exercise_id,
    exerciseName: r.exercise_name,
    targetSets: r.target_sets,
    targetReps: r.target_reps,
    restSeconds: r.rest_seconds,
  }));
}

function applyNutritionVolumeReduction(workout: ReturnType<typeof generateWorkout>, today: string): void {
  const goals = db.all<{ maintenance_calories: number | null }>(
    sql`SELECT maintenance_calories FROM user_goals LIMIT 1`
  );
  const maintenance = goals.length > 0 && goals[0].maintenance_calories
    ? goals[0].maintenance_calories
    : (Number(process.env.MAINTENANCE_CALORIES) || 2200);
  const snapshot = db.all<{ calories: number | null }>(
    sql`SELECT calories FROM health_snapshots WHERE date = ${today} LIMIT 1`
  );
  if (snapshot.length > 0 && snapshot[0].calories && snapshot[0].calories > 0) {
    const deficitPct = (maintenance - snapshot[0].calories) / maintenance;
    // Graduated: no reduction below 10%, linear up to 20% reduction at 30%+ deficit
    if (deficitPct > 0.10) {
      const volumeMultiplier = 1.0 - Math.min((deficitPct - 0.10) / 0.20, 1.0) * 0.20;
      for (const ex of workout.exercises) {
        ex.suggestedSets = Math.max(2, Math.round(ex.suggestedSets * volumeMultiplier));
      }
      workout.volumeReductionPct = Math.round((1.0 - volumeMultiplier) * 100);
    }
  }
}

export async function generateRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { dayType: string; equipment?: string; profileId?: string; supersets?: string; duration?: string } }>(
    '/generate-workout',
    async (req, reply) => {
      let { dayType, equipment = 'full', profileId, supersets: supersetsParam, duration: durationParam } = req.query;
      if (!dayType) {
        return reply.status(400).send({ error: 'dayType query param required (push, pull, legs, upper, lower, or fullbody)' });
      }
      const supersets = supersetsParam !== 'false';
      const durationMinutes = durationParam ? parseInt(durationParam) : undefined;
      const today = new Date().toISOString().slice(0, 10);

      const isInCut = detectCutPhase(today);
      const programExercises = loadActiveProgramExercises(dayType);

      try {
        const equipmentList = resolveEquipment(profileId, equipment);
        const workout = programExercises
          ? generateFromProgram(dayType, programExercises, db, { supersets, isInCut })
          : generateWorkout(dayType, equipmentList, db, { supersets, durationMinutes, isInCut });

        applyNutritionVolumeReduction(workout, today);

        return workout;
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // Replace a single exercise with an alternative of the same muscle group
  app.get<{
    Querystring: { exerciseId: string; dayType?: string; equipment?: string; profileId?: string; excludeIds?: string };
  }>('/generate-workout/replace', async (req, reply) => {
    const exerciseId = parseInt(req.query.exerciseId);
    const equipmentList = resolveEquipment(req.query.profileId, req.query.equipment || 'full');
    const excludeIds = (req.query.excludeIds || '')
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n));

    if (!exerciseId) {
      return reply.status(400).send({ error: 'exerciseId is required' });
    }

    // Get the exercise to replace and its muscles
    const original = db.all<{ id: number; name: string }>(
      sql`SELECT id, name FROM exercises WHERE id = ${exerciseId}`
    );
    if (original.length === 0) {
      return reply.status(404).send({ error: 'Exercise not found' });
    }

    const originalName = original[0].name;
    const CARDIO_KEYWORDS = CARDIO_PATTERN;
    const isCardio = CARDIO_KEYWORDS.test(originalName);

    let targetMuscles = getMusclesForExercise(originalName);

    // Fall back to day type muscles if we can't determine muscles from exercise name
    const dayType = req.query.dayType || 'fullbody';
    if (targetMuscles.length === 0 && !isCardio) {
      targetMuscles = DAY_TYPE_MUSCLES[dayType] || DAY_TYPE_MUSCLES.fullbody;
    }

    // Get all exercises and find alternatives with overlapping muscles
    const allExercises = db.all<{ id: number; name: string; rest_seconds: number | null; equipment: string | null }>(
      sql`SELECT id, name, rest_seconds, equipment FROM exercises`
    );

    const excludeSet = new Set([exerciseId, ...excludeIds]);

    // Equipment filter helper for this request: subset-match the exercise's
    // required tags against the location's (normalized) available equipment.
    const available = equipmentList && equipmentList.length > 0 ? normalizeAvailableEquipment(equipmentList) : null;
    const matchesEquip = (equipment: string | null) => {
      if (!available) return true;
      let tags: string[] = [];
      if (equipment) {
        try { const v = JSON.parse(equipment); if (Array.isArray(v)) tags = v; } catch { /* treat as none */ }
      }
      return matchesEquipment(tags, available);
    };

    let candidates;

    if (isCardio) {
      // For cardio: only return other cardio exercises the location can do
      // (matchesEquip is a no-op when no equipment restriction is set).
      candidates = allExercises.filter(e => {
        if (excludeSet.has(e.id)) return false;
        return CARDIO_KEYWORDS.test(e.name) && matchesEquip(e.equipment);
      });
    } else {
      candidates = allExercises.filter(e => {
        if (excludeSet.has(e.id)) return false;
        const muscles = getMusclesForExercise(e.name);
        if (CARDIO_KEYWORDS.test(e.name)) return false;
        return muscles.some(m => targetMuscles.includes(m));
      });

      if (available) {
        candidates = candidates.filter(e => matchesEquip(e.equipment));
      }
    }

    // If no muscle-matched candidates, fall back to any exercise not in exclude list
    if (candidates.length === 0) {
      candidates = allExercises.filter(e => {
        if (excludeSet.has(e.id)) return false;
        if (isCardio) return CARDIO_KEYWORDS.test(e.name) && matchesEquip(e.equipment);
        if (CARDIO_KEYWORDS.test(e.name)) return false;
        if (!matchesEquip(e.equipment)) return false;
        return true;
      });
    }

    if (candidates.length === 0) {
      return reply.status(404).send({ error: 'No alternative exercises found' });
    }

    // Batch-fetch last performed dates and progression for all candidates
    const candidateIds = candidates.map(e => e.id);
    const lastPerformedRows = candidateIds.length > 0
      ? db.all<{ exercise_id: number; last_date: string }>(sql`
          SELECT we.exercise_id, MAX(w.date) as last_date
          FROM workout_exercises we
          JOIN workouts w ON we.workout_id = w.id
          WHERE we.exercise_id IN (${sql.join(candidateIds.map(id => sql`${id}`), sql`, `)})
          GROUP BY we.exercise_id
        `)
      : [];
    const lastDates = new Map(lastPerformedRows.map(r => [r.exercise_id, r.last_date]));

    const progressionMap = computeProgressionBatch(
      candidates.map(e => ({ id: e.id, name: e.name })),
      db
    );

    const now = Date.now();
    const enriched = candidates.map(e => {
      const lastDate = lastDates.get(e.id);
      let daysSince = 999;
      if (lastDate) {
        daysSince = (now - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24);
      }

      const prog = progressionMap.get(e.id)!;

      return {
        id: e.id,
        name: e.name,
        suggestedSets: prog.sets,
        suggestedReps: prog.reps,
        suggestedWeightKg: prog.weightKg,
        lastPerformedDaysAgo: Math.round(daysSince * 10) / 10,
        isFocus: false,
        isCardio: false,
        restSeconds: e.rest_seconds ?? 60,
        progression: prog.directive,
        repRange: { min: prog.repRange.min, max: prog.repRange.max },
        _daysSince: daysSince,
      };
    });

    // Sort: most recently performed first, then alphabetically
    enriched.sort((a, b) => {
      if (a._daysSince !== b._daysSince) return a._daysSince - b._daysSince;
      return a.name.localeCompare(b.name);
    });

    const alternatives = enriched.slice(0, 12).map(({ _daysSince, ...rest }) => rest);

    return { alternatives };
  });
}
