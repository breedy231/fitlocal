import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const workouts = sqliteTable('workouts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  locationProfile: text('location_profile'),
  notes: text('notes'),
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
