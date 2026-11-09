import { KG_TO_LBS } from './units.js';

/** How far back the "prior" point should sit, in days. */
export const WEEKLY_RATE_LOOKBACK_DAYS = 7;
/** The nearest prior point may be at most this many days from the lookback target, else no rate. */
export const WEEKLY_RATE_TOLERANCE_DAYS = 3;
/** Minimum span between prior and latest point; shorter spans extrapolate noise to a week. */
export const WEEKLY_RATE_MIN_SPAN_DAYS = 4;

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  trendKg: number;
}

// Whole days since epoch for a YYYY-MM-DD string. Pure calendar math (no
// timezone involved), so it can't be skewed by UTC vs. America/Chicago.
function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * Pick the point nearest (by real day distance) to `today - 7 days`, among
 * points strictly before the latest point. Returns null when there is no such
 * point within WEEKLY_RATE_TOLERANCE_DAYS of the target, or when it is too close
 * to the latest point to give a meaningful weekly rate.
 *
 * `today` must be the user's local calendar date (API: `localDate()`; browser:
 * local getters, never toISOString). `points` must be sorted ascending by date.
 */
export function pickPriorWeightPoint<T extends { date: string }>(
  points: T[],
  today: string,
): T | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const latestDay = dayNumber(latest.date);
  const target = dayNumber(today) - WEEKLY_RATE_LOOKBACK_DAYS;

  let best: T | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const day = dayNumber(p.date);
    if (day >= latestDay) continue;
    const dist = Math.abs(day - target);
    if (dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  if (!best || bestDist > WEEKLY_RATE_TOLERANCE_DAYS) return null;
  if (latestDay - dayNumber(best.date) < WEEKLY_RATE_MIN_SPAN_DAYS) return null;
  return best;
}

/** Weekly weight change in lbs/week (1 decimal), or null if the data is too sparse. */
export function weeklyWeightRateLbs(points: TrendPoint[], today: string): number | null {
  const prior = pickPriorWeightPoint(points, today);
  if (!prior) return null;
  const latest = points[points.length - 1];
  const days = dayNumber(latest.date) - dayNumber(prior.date);
  const kgPerDay = (latest.trendKg - prior.trendKg) / days;
  return Math.round(kgPerDay * 7 * KG_TO_LBS * 10) / 10;
}
