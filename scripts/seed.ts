#!/usr/bin/env tsx
/**
 * Demo seed script (GitHub #86).
 *
 *   npm run seed                              # seeds ./fitlocal.db (must be empty)
 *   DATABASE_PATH=/tmp/demo.db npm run seed   # seeds a throwaway DB
 *
 * Populates a FRESH database with:
 *   1. The wger-sourced exercise catalog from scripts/seed-data/exercises.json
 *      (committed — this script never hits the network; re-generate it with
 *      scripts/build-seed-exercises.mjs).
 *   2. ~6 weeks of deterministic synthetic history: a PPL rotation of ~24
 *      workouts with sets that progress week over week, plus one
 *      health_snapshots row per day showing a gentle cut.
 *
 * SAFETY: refuses to run when the target DB already holds exercises or
 * workouts. It never deletes anything — not even with --force, which only
 * allows inserting alongside existing rows.
 *
 * This is a bootstrap script, so it talks to SQLite directly (the "always go
 * through the API" rule doesn't apply — the API isn't running yet).
 */

import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyEquipment } from '../packages/api/src/lib/equipment-classifier.js';
// Imported from source (not the fitlocal-shared package entry) so seeding works
// on a fresh clone where packages/shared hasn't been built yet.
import { CARDIO_PATTERN } from '../packages/shared/src/cardio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const FORCE = process.argv.includes('--force');

/** Muscle vocabulary the generator + recovery grid understand. */
const MUSCLE_VOCABULARY = [
  'chest',
  'shoulders',
  'triceps',
  'back',
  'biceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
  'core',
];

const WEEKS = 6;
const WORKOUT_DAY_OFFSETS = [0, 1, 3, 5]; // 4 sessions/week
const PPL: DayType[] = ['push', 'pull', 'legs'];
const RNG_SEED = 0x5eed; // fixed — the demo data is byte-identical run to run

type DayType = 'push' | 'pull' | 'legs';

interface SeedExercise {
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  movementType: string;
  restSeconds: number;
  description: string | null;
  imageUrl: string | null;
  wgerId: number | null;
}

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) — no bare Math.random anywhere in this script.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(RNG_SEED);
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const jitter = (spread: number) => (rand() * 2 - 1) * spread;

// ---------------------------------------------------------------------------
// Workout templates. Each slot lists interchangeable variants; the week index
// picks one, so the history has variety without random exercise soup.
// ---------------------------------------------------------------------------
const TEMPLATES: Record<DayType, string[][]> = {
  push: [
    ['Barbell Bench Press', 'Dumbbell Bench Press', 'Dumbbell Incline Bench Press'],
    ['Machine Fly', 'Cable Crossover', 'Pec Deck'],
    ['Dumbbell Shoulder Press', 'Machine Shoulder Press', 'Barbell Shoulder Press'],
    ['Dumbbell Lateral Raise', 'Cable Lateral Raise', 'Machine Lateral Raise'],
    ['Tricep Pushdown', 'Skull Crusher', 'Overhead Tricep Extension'],
  ],
  pull: [
    ['Lat Pulldown', 'Wide Grip Lat Pulldown', 'Assisted Pull Up'],
    ['Bent Over Barbell Row', 'Seated Cable Row', 'Dumbbell Row'],
    ['T-Bar Row', 'Machine Row', 'Inverted Row'],
    ['Barbell Curl', 'EZ Bar Curl', 'Cable Curl'],
    ['Hammer Curl', 'Preacher Curl', 'Incline Dumbbell Curl'],
  ],
  legs: [
    ['Back Squat', 'Front Squat', 'Hack Squat'],
    ['Romanian Deadlift', 'Stiff Leg Deadlift', 'Dumbbell Romanian Deadlift'],
    ['Leg Press', 'Leg Extension', 'Smith Machine Squat'],
    ['Seated Leg Curl', 'Lying Leg Curl', 'Standing Leg Curl'],
    ['Barbell Hip Thrust', 'Glute Bridge', 'Cable Pull Through'],
    ['Standing Calf Raise', 'Seated Calf Raise', 'Machine Calf Raise'],
  ],
};

const CORE_SLOT: Record<DayType, string[]> = {
  push: ['Cable Crunch', 'Plank', 'Russian Twist'],
  pull: ['Reverse Crunch', 'Dead Bug', 'Side Plank'],
  legs: ['Crunch', 'Bicycle Crunch', 'Vertical Knee Raise'],
};

const CARDIO_SLOT: Record<DayType, string[]> = {
  push: ['Treadmill Run', 'Stair Climber', 'Rowing Machine'],
  pull: ['Stationary Bike', 'Elliptical Trainer', 'Rowing Machine'],
  legs: ['Treadmill Incline Walk', 'Stair Climber', 'Outdoor Running'],
};

/** Rough m/s pace per cardio movement, used to derive distance from duration. */
const CARDIO_SPEED_MPS: Record<string, number> = {
  'Treadmill Run': 2.8,
  'Outdoor Running': 2.9,
  'Treadmill Incline Walk': 1.4,
  'Stationary Bike': 6.0,
  'Outdoor Cycling': 6.5,
  'Rowing Machine': 3.2,
  'Elliptical Trainer': 2.2,
  'Stair Climber': 0.6,
};

/** Week-1 working weight in KILOGRAMS (the DB is metric; the UI converts). */
const BASE_WEIGHT_KG: Record<string, number> = {
  'Barbell Bench Press': 70,
  'Dumbbell Bench Press': 30,
  'Dumbbell Incline Bench Press': 27.5,
  'Machine Fly': 45,
  'Cable Crossover': 20,
  'Pec Deck': 45,
  'Dumbbell Shoulder Press': 22.5,
  'Machine Shoulder Press': 40,
  'Barbell Shoulder Press': 45,
  'Dumbbell Lateral Raise': 10,
  'Cable Lateral Raise': 10,
  'Machine Lateral Raise': 25,
  'Tricep Pushdown': 30,
  'Skull Crusher': 25,
  'Overhead Tricep Extension': 25,
  'Lat Pulldown': 55,
  'Wide Grip Lat Pulldown': 55,
  'Assisted Pull Up': 25,
  'Bent Over Barbell Row': 60,
  'Seated Cable Row': 55,
  'Dumbbell Row': 32.5,
  'T-Bar Row': 50,
  'Machine Row': 50,
  'Inverted Row': 0,
  'Barbell Curl': 30,
  'EZ Bar Curl': 27.5,
  'Cable Curl': 25,
  'Hammer Curl': 15,
  'Preacher Curl': 22.5,
  'Incline Dumbbell Curl': 12.5,
  'Back Squat': 90,
  'Front Squat': 60,
  'Hack Squat': 80,
  'Romanian Deadlift': 80,
  'Stiff Leg Deadlift': 70,
  'Dumbbell Romanian Deadlift': 30,
  'Leg Press': 140,
  'Leg Extension': 55,
  'Smith Machine Squat': 70,
  'Seated Leg Curl': 45,
  'Lying Leg Curl': 45,
  'Standing Leg Curl': 35,
  'Barbell Hip Thrust': 90,
  'Glute Bridge': 60,
  'Cable Pull Through': 35,
  'Standing Calf Raise': 70,
  'Seated Calf Raise': 60,
  'Machine Calf Raise': 65,
  'Cable Crunch': 35,
  'Russian Twist': 10,
  'Reverse Crunch': 0,
  'Crunch': 0,
  'Bicycle Crunch': 0,
  'Plank': 0,
  'Side Plank': 0,
  'Dead Bug': 0,
  'Vertical Knee Raise': 0,
};

const roundToPlate = (kg: number) => Math.round(kg / 1.25) * 1.25;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

// ---------------------------------------------------------------------------
// Validation — the seed data is only useful if the app's own classifiers agree
// with it, so assert that up front instead of shipping a silently-broken demo.
// ---------------------------------------------------------------------------
function validate(catalog: SeedExercise[]): void {
  const problems: string[] = [];
  const names = new Set<string>();

  for (const ex of catalog) {
    if (names.has(ex.name)) problems.push(`duplicate exercise name: ${ex.name}`);
    names.add(ex.name);

    for (const m of [...ex.primaryMuscles, ...ex.secondaryMuscles]) {
      if (!MUSCLE_VOCABULARY.includes(m)) {
        problems.push(`${ex.name}: muscle "${m}" is outside the generator's vocabulary`);
      }
    }

    const isCardioName = CARDIO_PATTERN.test(ex.name);
    if (ex.movementType === 'cardio' && !isCardioName) {
      problems.push(`${ex.name}: tagged cardio but does not match CARDIO_PATTERN`);
    }
    if (ex.movementType !== 'cardio' && isCardioName) {
      problems.push(`${ex.name}: matches CARDIO_PATTERN but is not tagged cardio`);
    }
  }

  // Every muscle the PPL generator targets needs a deep enough bench.
  const counts = new Map<string, number>();
  for (const ex of catalog) {
    for (const m of ex.primaryMuscles) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  for (const m of MUSCLE_VOCABULARY) {
    if ((counts.get(m) ?? 0) < 6) {
      problems.push(`only ${counts.get(m) ?? 0} exercises for "${m}" (need ≥6)`);
    }
  }

  // Every templated exercise must exist in the catalog.
  const templated = [
    ...Object.values(TEMPLATES).flat(2),
    ...Object.values(CORE_SLOT).flat(),
    ...Object.values(CARDIO_SLOT).flat(),
  ];
  for (const name of new Set(templated)) {
    if (!names.has(name)) problems.push(`workout template references unknown exercise: ${name}`);
  }

  if (problems.length > 0) {
    console.error('Seed data failed validation:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Safety rail
// ---------------------------------------------------------------------------
function assertEmpty(dbPath: string): void {
  if (!fs.existsSync(dbPath)) return;

  const probe = new Database(dbPath, { readonly: true });
  let exerciseCount = 0;
  let workoutCount = 0;
  try {
    const tables = new Set(
      (probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (t) => t.name,
      ),
    );
    if (tables.has('exercises')) {
      exerciseCount = (probe.prepare('SELECT COUNT(*) AS n FROM exercises').get() as { n: number }).n;
    }
    if (tables.has('workouts')) {
      workoutCount = (probe.prepare('SELECT COUNT(*) AS n FROM workouts').get() as { n: number }).n;
    }
  } finally {
    probe.close();
  }

  if (exerciseCount === 0 && workoutCount === 0) return;

  if (FORCE) {
    console.warn(
      `WARNING: ${dbPath} already has ${exerciseCount} exercise(s) and ${workoutCount} workout(s).\n` +
        '         --force given: seeding ALONGSIDE the existing data (nothing is deleted).',
    );
    return;
  }

  console.error(
    `\nRefusing to seed: ${dbPath} is not empty ` +
      `(${exerciseCount} exercise(s), ${workoutCount} workout(s)).\n\n` +
      'This DB already holds real training data. Seed a throwaway copy instead:\n\n' +
      '  DATABASE_PATH=/tmp/demo.db npm run seed\n\n' +
      'Pass --force only if you truly want demo rows added alongside the existing data.\n' +
      '(This script never deletes anything.)\n',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const dbPath = path.resolve(process.env.DATABASE_PATH ?? './fitlocal.db');
  // Pin the migration run to the exact same file this script seeds.
  process.env.DATABASE_PATH = dbPath;

  const catalogPath = path.join(__dirname, 'seed-data', 'exercises.json');
  const catalogFile = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
    attribution: Record<string, string>;
    exercises: SeedExercise[];
  };
  const catalog = catalogFile.exercises;

  validate(catalog);
  assertEmpty(dbPath);

  // packages/shared has to be compiled before the API's migrate module (which
  // imports fitlocal-shared) can load — a fresh clone hasn't built it yet.
  if (!fs.existsSync(path.join(REPO_ROOT, 'packages/shared/dist/index.js'))) {
    console.log('Building packages/shared (required by the migrations)…');
    execFileSync('npm', ['run', 'build', '-w', 'packages/shared'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
  }

  console.log(`Seeding ${dbPath}`);
  // Side-effecting import: creates the schema / applies migrations on DATABASE_PATH.
  await import('../packages/api/src/migrate.js');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // OR IGNORE so a --force run alongside an existing catalog keeps the existing
  // row (names are UNIQUE) instead of blowing up mid-transaction.
  const insertExercise = db.prepare(`
    INSERT OR IGNORE INTO exercises
      (name, primary_muscles, secondary_muscles, equipment, movement_type, description, image_url, wger_id, rest_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectExerciseId = db.prepare('SELECT id FROM exercises WHERE name = ?');
  const insertMuscleGroup = db.prepare('INSERT OR IGNORE INTO muscle_groups (name) VALUES (?)');
  const insertWorkout = db.prepare(`
    INSERT INTO workouts (date, location_profile, notes, effort_rating, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertWorkoutExercise = db.prepare(`
    INSERT INTO workout_exercises (workout_id, exercise_id, display_order) VALUES (?, ?, ?)
  `);
  const insertSet = db.prepare(`
    INSERT INTO sets (workout_exercise_id, reps, weight_kg, is_warmup, duration_seconds, distance_meters, completed)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const insertSnapshot = db.prepare(`
    INSERT INTO health_snapshots (date, resting_hr, hrv, sleep_hours, calories, protein_g, steps, body_weight_kg)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const exerciseIds = new Map<string, number>();
  let workoutCount = 0;
  let setCount = 0;

  const seedAll = db.transaction(() => {
    // --- muscle groups ---
    for (const m of MUSCLE_VOCABULARY) insertMuscleGroup.run(m);

    // --- exercise catalog ---
    for (const ex of catalog) {
      insertExercise.run(
        ex.name,
        JSON.stringify(ex.primaryMuscles),
        JSON.stringify(ex.secondaryMuscles),
        // Equipment tags come from the canonical classifier so they match what
        // the generator's equipment filter expects.
        JSON.stringify(classifyEquipment(ex.name)),
        ex.movementType,
        ex.description,
        ex.imageUrl,
        ex.wgerId,
        ex.restSeconds,
      );
      const row = selectExerciseId.get(ex.name) as { id: number };
      exerciseIds.set(ex.name, row.id);
    }

    // --- 6 weeks of history, ending yesterday ---
    const yesterday = addDays(new Date(), -1);
    const start = addDays(yesterday, -(WEEKS * 7 - 1));

    let sessionIndex = 0;
    for (let week = 0; week < WEEKS; week++) {
      for (const offset of WORKOUT_DAY_OFFSETS) {
        const day = addDays(start, week * 7 + offset);
        if (day > yesterday) continue;

        const dayType = PPL[sessionIndex % PPL.length];
        sessionIndex++;

        const startedAt = new Date(day);
        startedAt.setHours(17, randInt(0, 45), 0, 0);
        const durationMin = randInt(60, 75);
        const endedAt = new Date(startedAt.getTime() + durationMin * 60_000);

        const workoutId = Number(
          insertWorkout.run(
            isoDate(day),
            'Full Gym',
            `${dayType} day`,
            randInt(6, 9),
            startedAt.toISOString(),
            endedAt.toISOString(),
          ).lastInsertRowid,
        );
        workoutCount++;

        // Strength slots (one variant per slot, rotating by week) + core + cardio.
        const names = TEMPLATES[dayType].map((slot) => slot[week % slot.length]);
        names.push(CORE_SLOT[dayType][week % 3]);
        const withCardio = sessionIndex % 2 === 1;
        if (withCardio) names.push(CARDIO_SLOT[dayType][week % 3]);

        let order = 0;
        for (const name of names) {
          const exerciseId = exerciseIds.get(name)!;
          const weId = Number(insertWorkoutExercise.run(workoutId, exerciseId, order++).lastInsertRowid);

          if (CARDIO_PATTERN.test(name)) {
            const durationSeconds = randInt(12, 25) * 60;
            const meters = Math.round(durationSeconds * (CARDIO_SPEED_MPS[name] ?? 2.5));
            insertSet.run(weId, null, null, 0, durationSeconds, meters);
            setCount++;
            continue;
          }

          const base = BASE_WEIGHT_KG[name] ?? 20;
          // ~2%/week of linear progression so the exercise charts trend up.
          const working = base === 0 ? 0 : roundToPlate(base * (1 + 0.02 * week));
          // Heavy movements get a warm-up set on top of the 3 working sets.
          const isCompound = base >= 40;
          const workingSets = 3;
          const reps = isCompound ? randInt(5, 8) : randInt(9, 12);

          if (isCompound) {
            // Warm-up set: same movement, ~55% load, higher reps.
            insertSet.run(weId, 10, roundToPlate(working * 0.55), 1, null, null);
            setCount++;
          }
          for (let s = 0; s < workingSets; s++) {
            // Last set drops a rep or two — normal fatigue.
            const setReps = Math.max(4, reps - (s === workingSets - 1 ? randInt(0, 2) : 0));
            insertSet.run(weId, setReps, working, 0, null, null);
            setCount++;
          }
        }
      }
    }

    // --- daily health snapshots: a gentle cut, 88 kg → 86 kg ---
    const yesterdaySnap = addDays(new Date(), -1);
    const totalDays = WEEKS * 7;
    for (let i = 0; i < totalDays; i++) {
      const day = addDays(yesterdaySnap, -(totalDays - 1 - i));
      const trend = 88 - (2 * i) / (totalDays - 1);
      insertSnapshot.run(
        isoDate(day),
        randInt(52, 60),
        randInt(45, 75),
        Math.round((6.2 + rand() * 2.3) * 10) / 10,
        randInt(2050, 2450),
        Math.round(randInt(150, 190)),
        randInt(6000, 13000),
        Math.round((trend + jitter(0.35)) * 10) / 10,
      );
    }

    // --- goals, so the home cut card and nutrition targets render ---
    const hasGoals = (db.prepare('SELECT COUNT(*) AS n FROM user_goals').get() as { n: number }).n;
    if (hasGoals === 0) {
      db.prepare(
        `INSERT INTO user_goals
           (maintenance_calories, target_calories, target_protein_g, target_weight_kg, cut_start_date, cut_end_date, max_hr)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        2750,
        2250,
        180,
        82,
        isoDate(addDays(new Date(), -(WEEKS * 7))),
        isoDate(addDays(new Date(), 56)),
        185,
      );
    }
  });

  seedAll();
  db.close();

  console.log(
    `Seeded ${catalog.length} exercises, ${workoutCount} workouts, ${setCount} sets, ` +
      `${WEEKS * 7} daily health snapshots.`,
  );
  console.log(`Exercise data: ${catalogFile.attribution.source} (${catalogFile.attribution.license})`);
  console.log('\nNext: npm run dev');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
