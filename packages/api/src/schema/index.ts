import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const workouts = sqliteTable('workouts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  locationProfile: text('location_profile'),
  notes: text('notes'),
  effortRating: integer('effort_rating'),
});

export const exercises = sqliteTable('exercises', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  primaryMuscles: text('primary_muscles', { mode: 'json' }).$type<string[]>().default(sql`'[]'`),
  secondaryMuscles: text('secondary_muscles', { mode: 'json' }).$type<string[]>().default(sql`'[]'`),
  equipment: text('equipment', { mode: 'json' }).$type<string[]>().default(sql`'[]'`),
  movementType: text('movement_type'),
  description: text('description'),
  imageUrl: text('image_url'),
  wgerId: integer('wger_id'),
  restSeconds: integer('rest_seconds').default(60),
});

export const workoutExercises = sqliteTable('workout_exercises', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workoutId: integer('workout_id').notNull().references(() => workouts.id, { onDelete: 'cascade' }),
  exerciseId: integer('exercise_id').notNull().references(() => exercises.id),
  displayOrder: integer('display_order').notNull().default(0),
  supersetGroup: integer('superset_group'),
});

export const sets = sqliteTable('sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workoutExerciseId: integer('workout_exercise_id').notNull().references(() => workoutExercises.id, { onDelete: 'cascade' }),
  reps: integer('reps'),
  weightKg: real('weight_kg'),
  isWarmup: integer('is_warmup', { mode: 'boolean' }).default(false),
  rpe: real('rpe'),
  multiplier: real('multiplier').default(1.0),
  durationSeconds: integer('duration_seconds'),
  completed: integer('completed', { mode: 'boolean' }).default(false),
});

export const muscleGroups = sqliteTable('muscle_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const equipmentProfiles = sqliteTable('equipment_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  availableEquipment: text('available_equipment', { mode: 'json' }).$type<string[]>().default(sql`'[]'`),
});

export const programs = sqliteTable('programs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  daysPerWeek: integer('days_per_week'),
  durationWeeks: integer('duration_weeks'),
  source: text('source'), // e.g. 'muscleandstrength.com'
  cardioPlan: text('cardio_plan', { mode: 'json' }).$type<{ week: number; sessions: number[] }[]>(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const programDays = sqliteTable('program_days', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  programId: integer('program_id').notNull().references(() => programs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // e.g. 'Push A', 'Pull B'
  dayOrder: integer('day_order').notNull(), // 0-based position in the cycle
  musclesFocus: text('muscles_focus'), // e.g. 'Chest, Shoulders & Triceps'
});

export const programExercises = sqliteTable('program_exercises', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  programDayId: integer('program_day_id').notNull().references(() => programDays.id, { onDelete: 'cascade' }),
  exerciseName: text('exercise_name').notNull(), // raw name from PDF
  exerciseId: integer('exercise_id').references(() => exercises.id), // linked after matching
  displayOrder: integer('display_order').notNull().default(0),
  targetSets: integer('target_sets'),
  targetReps: text('target_reps'), // '15' or 'AMRAP' — text to handle special notations
  restSeconds: integer('rest_seconds'),
  notes: text('notes'), // e.g. '20% less weight than working sets'
});

export const activeProgram = sqliteTable('active_program', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  programId: integer('program_id').notNull().references(() => programs.id, { onDelete: 'cascade' }),
  startDate: text('start_date').notNull(),
  currentDayIndex: integer('current_day_index').notNull().default(0), // which program_day is next
});

export const achievements = sqliteTable('achievements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(), // e.g. 'workouts_100', 'streak_4'
  name: text('name').notNull(),
  description: text('description').notNull(),
  icon: text('icon').notNull(), // emoji
  unlockedAt: text('unlocked_at'),
});

export const challenges = sqliteTable('challenges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  month: text('month').notNull(), // '2026-04'
  type: text('type').notNull(), // 'workouts' | 'sets' | 'volume'
  description: text('description').notNull(),
  targetValue: real('target_value').notNull(),
  unit: text('unit').notNull(),
  completed: integer('completed', { mode: 'boolean' }).default(false),
  completedAt: text('completed_at'),
});

export const healthSnapshots = sqliteTable('health_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  restingHr: integer('resting_hr'),
  hrv: integer('hrv'),
  sleepHours: real('sleep_hours'),
  calories: integer('calories'),
  proteinG: real('protein_g'),
  steps: integer('steps'),
  bodyWeightKg: real('body_weight_kg'),
});

export const routines = sqliteTable('routines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  exercises: text('exercises', { mode: 'json' }).$type<{ exerciseName: string; exerciseId: number | null; targetSets: number; targetReps: string }[]>().notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const userGoals = sqliteTable('user_goals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  maintenanceCalories: integer('maintenance_calories'),
  targetCalories: integer('target_calories'),
  targetProteinG: real('target_protein_g'),
  targetWeightKg: real('target_weight_kg'),
  cutStartDate: text('cut_start_date'),
  cutEndDate: text('cut_end_date'),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
