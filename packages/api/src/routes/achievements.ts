import { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';

interface AchievementDef {
  key: string;
  name: string;
  description: string;
  icon: string;
  check: () => boolean;
}

function totalWorkouts(): number {
  const r = db.all(sql`SELECT COUNT(*) as cnt FROM workouts`) as { cnt: number }[];
  return r[0]?.cnt || 0;
}

function totalSets(): number {
  const r = db.all(sql`SELECT COUNT(*) as cnt FROM sets WHERE is_warmup = 0`) as { cnt: number }[];
  return r[0]?.cnt || 0;
}

function currentStreak(): number {
  const dates = db.all(sql`
    SELECT DISTINCT date FROM workouts ORDER BY date DESC
  `) as { date: string }[];

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let checkDate = today;

  for (const row of dates) {
    const wDate = new Date(row.date + 'T00:00:00');
    const diff = Math.round((checkDate.getTime() - wDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diff <= 2) {
      streak++;
      checkDate = new Date(wDate);
      checkDate.setDate(checkDate.getDate() - 1);
    } else break;
  }
  return streak;
}

function totalVolumeLbs(): number {
  const r = db.all(sql`
    SELECT COALESCE(SUM(s.reps * s.weight_kg * s.multiplier * 2.20462), 0) as total
    FROM sets s WHERE s.is_warmup = 0
  `) as { total: number }[];
  return r[0]?.total || 0;
}

function distinctExercisesUsed(): number {
  const r = db.all(sql`
    SELECT COUNT(DISTINCT exercise_id) as cnt FROM workout_exercises
  `) as { cnt: number }[];
  return r[0]?.cnt || 0;
}

function challengesCompleted(): number {
  const r = db.all(sql`SELECT COUNT(*) as cnt FROM challenges WHERE completed = 1`) as { cnt: number }[];
  return r[0]?.cnt || 0;
}

const DEFINITIONS: AchievementDef[] = [
  // Workout milestones
  { key: 'workouts_10', name: 'Getting Started', description: 'Complete 10 workouts', icon: '🏋️', check: () => totalWorkouts() >= 10 },
  { key: 'workouts_50', name: 'Consistent', description: 'Complete 50 workouts', icon: '💪', check: () => totalWorkouts() >= 50 },
  { key: 'workouts_100', name: 'Centurion', description: 'Complete 100 workouts', icon: '🔥', check: () => totalWorkouts() >= 100 },
  { key: 'workouts_250', name: 'Iron Regular', description: 'Complete 250 workouts', icon: '⚡', check: () => totalWorkouts() >= 250 },
  { key: 'workouts_500', name: 'Gym Rat', description: 'Complete 500 workouts', icon: '🏆', check: () => totalWorkouts() >= 500 },
  { key: 'workouts_1000', name: 'Legend', description: 'Complete 1,000 workouts', icon: '👑', check: () => totalWorkouts() >= 1000 },

  // Streak milestones
  { key: 'streak_4', name: 'Week Warrior', description: '4-week training streak', icon: '📅', check: () => currentStreak() >= 4 },
  { key: 'streak_8', name: 'Two Month Strong', description: '8-week training streak', icon: '🗓️', check: () => currentStreak() >= 8 },
  { key: 'streak_16', name: 'Quarter Champion', description: '16-week training streak', icon: '🎯', check: () => currentStreak() >= 16 },
  { key: 'streak_52', name: 'Year Round', description: '52-week training streak', icon: '🌟', check: () => currentStreak() >= 52 },

  // Volume milestones (lbs)
  { key: 'volume_100k', name: 'Heavy Lifter', description: 'Lift 100,000 total lbs', icon: '🪨', check: () => totalVolumeLbs() >= 100000 },
  { key: 'volume_500k', name: 'Half Ton Club', description: 'Lift 500,000 total lbs', icon: '🏔️', check: () => totalVolumeLbs() >= 500000 },
  { key: 'volume_1m', name: 'Million Pound Club', description: 'Lift 1,000,000 total lbs', icon: '💎', check: () => totalVolumeLbs() >= 1000000 },

  // Set milestones
  { key: 'sets_500', name: 'Set Machine', description: 'Complete 500 working sets', icon: '🔢', check: () => totalSets() >= 500 },
  { key: 'sets_2500', name: 'Volume King', description: 'Complete 2,500 working sets', icon: '📊', check: () => totalSets() >= 2500 },
  { key: 'sets_10000', name: 'Ten Thousand', description: 'Complete 10,000 working sets', icon: '🎖️', check: () => totalSets() >= 10000 },

  // Variety
  { key: 'exercises_20', name: 'Well Rounded', description: 'Use 20 different exercises', icon: '🎪', check: () => distinctExercisesUsed() >= 20 },
  { key: 'exercises_50', name: 'Exercise Explorer', description: 'Use 50 different exercises', icon: '🗺️', check: () => distinctExercisesUsed() >= 50 },

  // Challenges
  { key: 'challenges_1', name: 'Challenger', description: 'Complete your first monthly challenge', icon: '🏅', check: () => challengesCompleted() >= 1 },
  { key: 'challenges_6', name: 'Half Year Hero', description: 'Complete 6 monthly challenges', icon: '🥇', check: () => challengesCompleted() >= 6 },
  { key: 'challenges_12', name: 'Year of Challenges', description: 'Complete 12 monthly challenges', icon: '🏆', check: () => challengesCompleted() >= 12 },
];

export async function achievementRoutes(app: FastifyInstance) {
  // Get all achievements with unlock status
  app.get('/achievements', async () => {
    // Ensure all achievement rows exist
    for (const def of DEFINITIONS) {
      const existing = db.select().from(schema.achievements)
        .where(eq(schema.achievements.key, def.key))
        .get();
      if (!existing) {
        db.insert(schema.achievements).values({
          key: def.key,
          name: def.name,
          description: def.description,
          icon: def.icon,
        }).run();
      }
    }

    // Check for newly unlocked achievements
    const now = new Date().toISOString();
    for (const def of DEFINITIONS) {
      const row = db.select().from(schema.achievements)
        .where(eq(schema.achievements.key, def.key))
        .get();
      if (row && !row.unlockedAt && def.check()) {
        db.update(schema.achievements)
          .set({ unlockedAt: now })
          .where(eq(schema.achievements.key, def.key))
          .run();
      }
    }

    const all = db.select().from(schema.achievements).all();
    const unlocked = all.filter(a => a.unlockedAt).length;

    return {
      total: DEFINITIONS.length,
      unlocked,
      achievements: DEFINITIONS.map(def => {
        const row = all.find(a => a.key === def.key);
        return {
          key: def.key,
          name: def.name,
          description: def.description,
          icon: def.icon,
          unlockedAt: row?.unlockedAt || null,
        };
      }),
    };
  });
}
