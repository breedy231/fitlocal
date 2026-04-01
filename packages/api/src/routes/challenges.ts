import { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';

const CHALLENGE_TYPES = ['workouts', 'sets', 'volume'] as const;
type ChallengeType = (typeof CHALLENGE_TYPES)[number];
const STRETCH_FACTOR = 1.12;

const KG_TO_LBS = 2.20462;

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7); // '2026-04'
}

function getMonthName(monthStr: string): string {
  const [y, m] = monthStr.split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return names[parseInt(m) - 1];
}

function pickChallengeType(month: string): ChallengeType {
  // Rotate based on month number
  const monthNum = parseInt(month.split('-')[1]);
  return CHALLENGE_TYPES[monthNum % CHALLENGE_TYPES.length];
}

function compute4WeekAvg(type: ChallengeType): number | null {
  const since = new Date();
  since.setDate(since.getDate() - 28);
  const sinceStr = since.toISOString().slice(0, 10);

  if (type === 'workouts') {
    const rows = db.all(sql`
      SELECT COUNT(DISTINCT id) as count FROM workouts WHERE date >= ${sinceStr}
    `) as { count: number }[];
    return rows[0]?.count || null;
  }

  if (type === 'sets') {
    const rows = db.all(sql`
      SELECT COUNT(*) as count
      FROM sets s
      JOIN workout_exercises we ON we.id = s.workout_exercise_id
      JOIN workouts w ON w.id = we.workout_id
      WHERE s.is_warmup = 0 AND w.date >= ${sinceStr}
    `) as { count: number }[];
    return rows[0]?.count || null;
  }

  if (type === 'volume') {
    const rows = db.all(sql`
      SELECT COALESCE(SUM(s.reps * s.weight_kg * s.multiplier), 0) as total
      FROM sets s
      JOIN workout_exercises we ON we.id = s.workout_exercise_id
      JOIN workouts w ON w.id = we.workout_id
      WHERE s.is_warmup = 0 AND w.date >= ${sinceStr}
    `) as { total: number }[];
    return rows[0]?.total || null;
  }

  return null;
}

function computeCurrentValue(type: ChallengeType, month: string): number {
  const startDate = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const endDate = `${y}-${String(m).padStart(2, '0')}-31`;

  if (type === 'workouts') {
    const rows = db.all(sql`
      SELECT COUNT(DISTINCT id) as count FROM workouts
      WHERE date >= ${startDate} AND date <= ${endDate}
    `) as { count: number }[];
    return rows[0]?.count || 0;
  }

  if (type === 'sets') {
    const rows = db.all(sql`
      SELECT COUNT(*) as count
      FROM sets s
      JOIN workout_exercises we ON we.id = s.workout_exercise_id
      JOIN workouts w ON w.id = we.workout_id
      WHERE s.is_warmup = 0 AND w.date >= ${startDate} AND w.date <= ${endDate}
    `) as { count: number }[];
    return rows[0]?.count || 0;
  }

  if (type === 'volume') {
    const rows = db.all(sql`
      SELECT COALESCE(SUM(s.reps * s.weight_kg * s.multiplier), 0) as total
      FROM sets s
      JOIN workout_exercises we ON we.id = s.workout_exercise_id
      JOIN workouts w ON w.id = we.workout_id
      WHERE s.is_warmup = 0 AND w.date >= ${startDate} AND w.date <= ${endDate}
    `) as { total: number }[];
    return rows[0]?.total || 0;
  }

  return 0;
}

function generateChallenge(month: string) {
  const type = pickChallengeType(month);
  const avg = compute4WeekAvg(type);
  if (!avg || avg === 0) return null;

  const target = Math.round(avg * STRETCH_FACTOR);
  const monthName = getMonthName(month);
  let description: string;
  let unit: string;

  switch (type) {
    case 'workouts':
      description = `Complete ${target} workouts in ${monthName}`;
      unit = 'workouts';
      break;
    case 'sets':
      description = `Hit ${target} working sets in ${monthName}`;
      unit = 'sets';
      break;
    case 'volume':
      const lbs = Math.round(target * KG_TO_LBS);
      description = `Lift ${lbs.toLocaleString()} lbs in ${monthName}`;
      unit = 'lbs';
      break;
  }

  return db.insert(schema.challenges).values({
    month,
    type,
    description: description!,
    targetValue: type === 'volume' ? Math.round(target * KG_TO_LBS) : target,
    unit: unit!,
  }).returning().get();
}

export async function challengeRoutes(app: FastifyInstance) {
  // Get current month's challenge (auto-generate if needed)
  app.get('/challenges/current', async () => {
    const month = getCurrentMonth();

    let challenge = db.select().from(schema.challenges)
      .where(eq(schema.challenges.month, month))
      .get();

    if (!challenge) {
      // Check minimum data requirement (4 weeks)
      const fourWeeksAgo = new Date();
      fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
      const rows = db.all(sql`
        SELECT COUNT(DISTINCT id) as count FROM workouts
        WHERE date >= ${fourWeeksAgo.toISOString().slice(0, 10)}
      `) as { count: number }[];

      if ((rows[0]?.count || 0) < 4) {
        return { challenge: null, reason: 'Need at least 4 weeks of data' };
      }

      const generated = generateChallenge(month);
      if (!generated) return { challenge: null, reason: 'Not enough data to generate' };
      challenge = generated;
    }

    const currentValue = computeCurrentValue(challenge.type as ChallengeType, month);

    // Auto-complete if target reached
    if (currentValue >= challenge.targetValue && !challenge.completed) {
      db.update(schema.challenges)
        .set({ completed: true, completedAt: new Date().toISOString() })
        .where(eq(schema.challenges.id, challenge.id))
        .run();
      challenge = { ...challenge, completed: true, completedAt: new Date().toISOString() };
    }

    return {
      challenge: {
        ...challenge,
        currentValue,
      },
    };
  });

  // Challenge history (badges)
  app.get('/challenges/history', async () => {
    const rows = db.select().from(schema.challenges).orderBy(schema.challenges.month);
    return { challenges: rows };
  });
}
