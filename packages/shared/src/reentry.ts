// Return-to-training plan after a layoff.
//
// The per-exercise layoff weights (LAYOFF_BANDS in the API's progression.ts)
// only apply until an exercise has been done once. This module tracks the
// return as a whole, from the most recent long gap between strength workouts,
// so "back after ~8 weeks off" stays visible for the weeks after the first
// session, not just on it.
//
// The phase numbers below are INFERRED defaults, not PT guidance. The PT's
// instructions are the injury restriction's avoid rules and notes; they are
// shown alongside, never overridden.

/** A gap this long between strength workouts starts a return-to-training plan. */
export const REENTRY_MIN_GAP_DAYS = 21;
/** From this gap length, phase 2 runs two extra weeks. */
export const REENTRY_LONG_GAP_DAYS = 84;

export type ReentryPhaseKey = 'reentry' | 'rebuild';

export interface ReentryPhase {
  key: ReentryPhaseKey;
  name: string;
  /** Target effort for every working set, as reps in reserve. */
  rir: string;
  load: string;
  progression: string;
}

export const REENTRY_PHASES: Record<ReentryPhaseKey, ReentryPhase> = {
  reentry: {
    key: 'reentry',
    name: 'Re-entry',
    rir: '3-4 reps in reserve',
    load: 'Planned weights are already lowered for the time off. Use them as given.',
    progression: 'Add no sets, weight or extra cardio.',
  },
  rebuild: {
    key: 'rebuild',
    name: 'Rebuild',
    rir: '2-3 reps in reserve',
    load: 'Work back toward your old weights.',
    progression: 'Add weight at most once a week per exercise, and only after every set hits the top of its rep range.',
  },
};

/** Applies in every phase while an injury restriction is active. */
export const REENTRY_SYMPTOM_RULE =
  'Stop a set if it brings on neck or upper-back symptoms. If symptoms are worse the next morning, repeat the last weights instead of adding.';

export interface ReentryStatus {
  /** Days between the last workout before the gap and the return (or today, if not back yet). */
  gapDays: number;
  /** Last strength workout before the gap. */
  lastBeforeGap: string;
  /** First strength workout after the gap, or null if not back yet. */
  returnDate: string | null;
  /** Strength workouts since returning (0 if not back yet). */
  sessionsSinceReturn: number;
  /** 1-based week of the return; week 1 starts on the return date (or today). */
  week: number;
  /** Last week of the plan; after it the status goes away. */
  totalWeeks: number;
  phase: ReentryPhase;
  symptomRule: string;
  /** Always 'inferred' today: the PT gave restrictions, not numbers. */
  source: 'inferred';
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/**
 * Where the user is in a return from layoff, or null when no plan applies.
 *
 * @param strengthDates dates (YYYY-MM-DD) of workouts with at least one strength exercise, any order, duplicates ok
 * @param today the user's calendar date (America/Chicago), YYYY-MM-DD
 */
export function computeReentry(strengthDates: string[], today: string): ReentryStatus | null {
  const dates = [...new Set(strengthDates)].filter(d => d <= today).sort();
  if (dates.length === 0) return null;

  let lastBeforeGap: string;
  let returnDate: string | null;
  let gapDays: number;

  const last = dates[dates.length - 1];
  const sinceLast = dayDiff(last, today);
  if (sinceLast >= REENTRY_MIN_GAP_DAYS) {
    // Still away: the next session is the return.
    lastBeforeGap = last;
    returnDate = null;
    gapDays = sinceLast;
  } else {
    let i = dates.length - 1;
    while (i > 0 && dayDiff(dates[i - 1], dates[i]) < REENTRY_MIN_GAP_DAYS) i--;
    if (i === 0) return null; // no long gap in the history
    lastBeforeGap = dates[i - 1];
    returnDate = dates[i];
    gapDays = dayDiff(lastBeforeGap, returnDate);
  }

  const totalWeeks = gapDays >= REENTRY_LONG_GAP_DAYS ? 6 : 4;
  const week = returnDate ? Math.floor(dayDiff(returnDate, today) / 7) + 1 : 1;
  if (week > totalWeeks) return null;

  return {
    gapDays,
    lastBeforeGap,
    returnDate,
    sessionsSinceReturn: returnDate ? dates.filter(d => d >= returnDate).length : 0,
    week,
    totalWeeks,
    phase: week <= 2 ? REENTRY_PHASES.reentry : REENTRY_PHASES.rebuild,
    symptomRule: REENTRY_SYMPTOM_RULE,
    source: 'inferred',
  };
}

/** "8 weeks" / "25 days": human length of the time off. */
export function formatTimeOff(gapDays: number): string {
  return gapDays >= 14 ? `${Math.round(gapDays / 7)} weeks` : `${gapDays} days`;
}

/** GET /reentry: the return-to-training status plus the active PT restriction, for one display. */
export interface ReentryResponse {
  status: ReentryStatus | null;
  injury: {
    label: string;
    /** Human labels of the avoided movement patterns. */
    avoid: string[];
    avoidMuscles: string[];
    /** Names of individually avoided exercises. */
    avoidExercises: string[];
    /** PT notes, including the rehab routine. */
    notes: string | null;
  } | null;
}
