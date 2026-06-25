import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db.js';
import { KG_TO_LBS } from 'fitlocal-shared';

export async function goalRoutes(app: FastifyInstance) {
  // GET /goals — returns current goals or empty defaults
  app.get('/goals', async () => {
    const row = db.all(sql`SELECT * FROM user_goals LIMIT 1`) as any[];
    if (row.length === 0) {
      return {
        maintenanceCalories: null,
        targetCalories: null,
        targetProteinG: null,
        targetWeightKg: null,
        cutStartDate: null,
        cutEndDate: null,
        maxHr: null,
      };
    }
    const g = row[0];
    return {
      maintenanceCalories: g.maintenance_calories,
      targetCalories: g.target_calories,
      targetProteinG: g.target_protein_g,
      targetWeightKg: g.target_weight_kg,
      cutStartDate: g.cut_start_date,
      cutEndDate: g.cut_end_date,
      maxHr: g.max_hr,
    };
  });

  // PUT /goals — upsert the single goals row
  app.put<{
    Body: {
      maintenanceCalories?: number;
      targetCalories?: number;
      targetProteinG?: number;
      targetWeightKg?: number;
      cutStartDate?: string;
      cutEndDate?: string;
      maxHr?: number;
    };
  }>('/goals', async (req) => {
    const { maintenanceCalories, targetCalories, targetProteinG, targetWeightKg, cutStartDate, cutEndDate, maxHr } = req.body;

    const existing = db.all(sql`SELECT id FROM user_goals LIMIT 1`) as any[];

    if (existing.length === 0) {
      db.run(sql`
        INSERT INTO user_goals (maintenance_calories, target_calories, target_protein_g, target_weight_kg, cut_start_date, cut_end_date, max_hr, updated_at)
        VALUES (${maintenanceCalories ?? null}, ${targetCalories ?? null}, ${targetProteinG ?? null}, ${targetWeightKg ?? null}, ${cutStartDate ?? null}, ${cutEndDate ?? null}, ${maxHr ?? null}, datetime('now'))
      `);
    } else {
      db.run(sql`
        UPDATE user_goals SET
          maintenance_calories = COALESCE(${maintenanceCalories ?? null}, maintenance_calories),
          target_calories = COALESCE(${targetCalories ?? null}, target_calories),
          target_protein_g = COALESCE(${targetProteinG ?? null}, target_protein_g),
          target_weight_kg = COALESCE(${targetWeightKg ?? null}, target_weight_kg),
          cut_start_date = COALESCE(${cutStartDate ?? null}, cut_start_date),
          cut_end_date = COALESCE(${cutEndDate ?? null}, cut_end_date),
          max_hr = COALESCE(${maxHr ?? null}, max_hr),
          updated_at = datetime('now')
        WHERE id = ${existing[0].id}
      `);
    }

    // Return the saved goals
    const saved = db.all(sql`SELECT * FROM user_goals LIMIT 1`) as any[];
    const g = saved[0];
    return {
      maintenanceCalories: g.maintenance_calories,
      targetCalories: g.target_calories,
      targetProteinG: g.target_protein_g,
      targetWeightKg: g.target_weight_kg,
      cutStartDate: g.cut_start_date,
      cutEndDate: g.cut_end_date,
      maxHr: g.max_hr,
    };
  });

  // GET /goals/daily-nutrition — today's intake vs targets
  app.get('/goals/daily-nutrition', async () => {
    const goals = db.all(sql`SELECT * FROM user_goals LIMIT 1`) as any[];
    if (goals.length === 0) return { isInCut: false };

    const g = goals[0];
    const today = new Date().toISOString().slice(0, 10);

    const isInCut = g.cut_start_date && g.cut_end_date &&
      today >= g.cut_start_date && today <= g.cut_end_date;

    let snapshot = db.all<{ date: string; calories: number | null; protein_g: number | null }>(
      sql`SELECT date, calories, protein_g FROM health_snapshots WHERE date = ${today} LIMIT 1`
    );

    // Fall back to most recent snapshot if today's hasn't synced yet
    let snapshotDate = today;
    let isStale = false;
    if (snapshot.length === 0 || (snapshot[0].calories == null && snapshot[0].protein_g == null)) {
      const fallback = db.all<{ date: string; calories: number | null; protein_g: number | null }>(
        sql`SELECT date, calories, protein_g FROM health_snapshots
            WHERE calories IS NOT NULL AND calories > 0
            ORDER BY date DESC LIMIT 1`
      );
      if (fallback.length > 0) {
        snapshot = fallback;
        snapshotDate = fallback[0].date;
        isStale = true;
      }
    }

    const maintenance = g.maintenance_calories || 2200;
    const currentCalories = snapshot.length > 0 && snapshot[0].calories
      ? Math.round(snapshot[0].calories)
      : null;
    const currentProtein = snapshot.length > 0 ? snapshot[0].protein_g : null;

    const deficitMagnitude = currentCalories != null && currentCalories > 0
      ? Math.round(maintenance - currentCalories)
      : null;
    const deficitPct = deficitMagnitude != null
      ? Math.round((deficitMagnitude / maintenance) * 100) / 100
      : null;

    return {
      date: today,
      snapshotDate,
      isStale,
      calories: {
        current: currentCalories,
        target: g.target_calories,
      },
      protein: {
        current: currentProtein != null ? Math.round(currentProtein) : null,
        target: g.target_protein_g,
      },
      isInCut: !!isInCut,
      deficitMagnitude,
      deficitPct,
    };
  });

  // GET /goals/weight-trend — weight data with 7-day moving average and rate
  app.get<{ Querystring: { since?: string } }>('/goals/weight-trend', async (req) => {
    const goals = db.all(sql`SELECT * FROM user_goals LIMIT 1`) as any[];
    const g = goals.length > 0 ? goals[0] : null;

    // Default to 90 days of data
    const since = req.query.since || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

    // Fetch extra 7 days before 'since' to seed the moving average
    const seedDate = new Date(new Date(since).getTime() - 7 * 86400000).toISOString().slice(0, 10);

    const rows = db.all<{ date: string; body_weight_kg: number }>(sql`
      SELECT date, body_weight_kg
      FROM health_snapshots
      WHERE body_weight_kg IS NOT NULL AND body_weight_kg > 0
        AND date >= ${seedDate}
      ORDER BY date ASC
    `);

    if (rows.length === 0) {
      return { points: [], weeklyRateLbs: null, targetWeightKg: g?.target_weight_kg, cutStartDate: g?.cut_start_date, cutEndDate: g?.cut_end_date };
    }

    // Build a map of date -> weight for fast lookups
    const weightByDate = new Map<string, number>();
    for (const r of rows) {
      weightByDate.set(r.date, r.body_weight_kg);
    }

    // Compute 7-day moving average for each point
    const points: { date: string; rawKg: number; trendKg: number }[] = [];

    for (const r of rows) {
      if (r.date < since) continue; // skip seed data from output

      // Collect weights from the 7 days ending on this date
      const windowWeights: number[] = [];
      for (let d = 0; d < 7; d++) {
        const checkDate = new Date(new Date(r.date + 'T12:00:00').getTime() - d * 86400000)
          .toISOString().slice(0, 10);
        const w = weightByDate.get(checkDate);
        if (w != null) windowWeights.push(w);
      }

      const trendKg = windowWeights.length > 0
        ? Math.round((windowWeights.reduce((a, b) => a + b, 0) / windowWeights.length) * 10) / 10
        : r.body_weight_kg;

      points.push({ date: r.date, rawKg: r.body_weight_kg, trendKg });
    }

    // Calculate weekly rate: compare latest 7-day avg to 7-day avg from 7 days prior
    let weeklyRateLbs: number | null = null;
    if (points.length >= 2) {
      const latest = points[points.length - 1].trendKg;
      // Find point closest to 7 days ago
      const targetDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const priorPoint = points.reduce((best, p) =>
        Math.abs(p.date.localeCompare(targetDate)) < Math.abs(best.date.localeCompare(targetDate)) ? p : best
      );
      if (priorPoint && priorPoint.date !== points[points.length - 1].date) {
        const daysDiff = (new Date(points[points.length - 1].date).getTime() - new Date(priorPoint.date).getTime()) / 86400000;
        if (daysDiff > 0) {
          const kgPerDay = (latest - priorPoint.trendKg) / daysDiff;
          weeklyRateLbs = Math.round(kgPerDay * 7 * KG_TO_LBS * 10) / 10;
        }
      }
    }

    return {
      points,
      weeklyRateLbs,
      targetWeightKg: g?.target_weight_kg ?? null,
      cutStartDate: g?.cut_start_date ?? null,
      cutEndDate: g?.cut_end_date ?? null,
    };
  });

  // GET /goals/weekly-progress — weekly cut progress summary
  app.get('/goals/weekly-progress', async () => {
    const goals = db.all(sql`SELECT * FROM user_goals LIMIT 1`) as any[];
    if (goals.length === 0) return { isInCut: false };

    const g = goals[0];
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const isInCut = g.cut_start_date && g.cut_end_date &&
      todayStr >= g.cut_start_date && todayStr <= g.cut_end_date;
    if (!isInCut) return { isInCut: false };

    // Monday of current week
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    const mondayStr = monday.toISOString().slice(0, 10);

    const maintenance = g.maintenance_calories || 2200;
    const targetCalories = g.target_calories || maintenance;
    const targetDeficit = maintenance - targetCalories;

    // This week's nutrition data
    const calRows = db.all<{ calories: number; protein_g: number | null }>(sql`
      SELECT calories, protein_g FROM health_snapshots
      WHERE date >= ${mondayStr} AND date <= ${todayStr}
        AND calories IS NOT NULL AND calories > 0
    `);

    const daysLogged = calRows.length;
    const avgCalories = daysLogged > 0
      ? Math.round(calRows.reduce((s, r) => s + r.calories, 0) / daysLogged)
      : null;
    const avgDeficit = avgCalories != null ? maintenance - avgCalories : null;

    // Weight trend: compare current 7-day avg to 7 days ago
    const weightRows = db.all<{ date: string; body_weight_kg: number }>(sql`
      SELECT date, body_weight_kg FROM health_snapshots
      WHERE body_weight_kg IS NOT NULL AND body_weight_kg > 0
        AND date >= date(${todayStr}, '-14 days')
      ORDER BY date ASC
    `);

    const weightByDate = new Map<string, number>();
    for (const r of weightRows) weightByDate.set(r.date, r.body_weight_kg);

    function trendAvg(refDate: Date): number | null {
      const weights: number[] = [];
      for (let d = 0; d < 7; d++) {
        const checkDate = new Date(refDate.getTime() - d * 86400000).toISOString().slice(0, 10);
        const w = weightByDate.get(checkDate);
        if (w != null) weights.push(w);
      }
      return weights.length >= 2 ? weights.reduce((a, b) => a + b, 0) / weights.length : null;
    }

    const currentTrendKg = trendAvg(today);
    const weekAgoTrendKg = trendAvg(new Date(today.getTime() - 7 * 86400000));

    let changeLbs: number | null = null;
    if (currentTrendKg != null && weekAgoTrendKg != null) {
      changeLbs = Math.round((currentTrendKg - weekAgoTrendKg) * KG_TO_LBS * 10) / 10;
    }

    // Target pace: lbs/week needed to reach goal by end date
    let weeklyTargetLbs: number | null = null;
    if (g.target_weight_kg && g.cut_end_date && currentTrendKg) {
      const weeksRemaining = Math.max(1,
        (new Date(g.cut_end_date).getTime() - today.getTime()) / (7 * 86400000)
      );
      weeklyTargetLbs = Math.round((g.target_weight_kg - currentTrendKg) * KG_TO_LBS / weeksRemaining * 10) / 10;
    }

    // Pace classification
    let pace: string | null = null;
    if (changeLbs != null && daysLogged >= 3) {
      if (changeLbs < -2.0) {
        pace = 'ahead'; // losing too fast
      } else if (changeLbs <= 0 && avgDeficit != null && avgDeficit >= targetDeficit * 0.8) {
        pace = 'on_track';
      } else if (changeLbs > 0) {
        pace = 'behind';
      } else if (avgDeficit != null && avgDeficit >= targetDeficit * 0.5) {
        pace = 'on_track';
      } else {
        pace = 'behind';
      }
    }

    return {
      isInCut: true,
      week: {
        avgCalories,
        avgDeficit,
        targetDeficit,
        daysLogged,
      },
      weight: {
        currentTrendLbs: currentTrendKg != null ? Math.round(currentTrendKg * KG_TO_LBS * 10) / 10 : null,
        changeLbs,
        weeklyTargetLbs,
      },
      pace,
    };
  });
}
