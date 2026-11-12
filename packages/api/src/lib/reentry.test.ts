import { describe, it, expect } from 'vitest';
import { computeReentry, formatTimeOff, REENTRY_PHASES } from 'fitlocal-shared';

describe('computeReentry', () => {
  it('returns null with no history or no long gap', () => {
    expect(computeReentry([], '2026-11-11')).toBeNull();
    expect(computeReentry(['2026-11-01', '2026-11-05', '2026-11-09'], '2026-11-11')).toBeNull();
  });

  it('still away: next session is the return, phase 1, week 1', () => {
    const s = computeReentry(['2026-08-20', '2026-09-13'], '2026-11-11')!;
    expect(s).toMatchObject({ gapDays: 59, lastBeforeGap: '2026-09-13', returnDate: null, sessionsSinceReturn: 0, week: 1, totalWeeks: 4 });
    expect(s.phase).toBe(REENTRY_PHASES.reentry);
    expect(s.source).toBe('inferred');
  });

  it('keeps the plan after the first session back (the per-exercise layoff rule does not)', () => {
    const s = computeReentry(['2026-09-13', '2026-11-11', '2026-11-13'], '2026-11-14')!;
    expect(s).toMatchObject({ gapDays: 59, returnDate: '2026-11-11', sessionsSinceReturn: 2, week: 1 });
    expect(s.phase.key).toBe('reentry');
  });

  it('moves to rebuild in week 3 and ends after week 4', () => {
    const dates = ['2026-09-13', '2026-11-11', '2026-11-18', '2026-11-25', '2026-12-02', '2026-12-08'];
    expect(computeReentry(dates, '2026-11-24')!.phase.key).toBe('reentry'); // day 13, week 2
    expect(computeReentry(dates, '2026-11-25')!.phase.key).toBe('rebuild'); // day 14, week 3
    expect(computeReentry(dates, '2026-12-08')!.week).toBe(4);
    expect(computeReentry(dates, '2026-12-09')).toBeNull(); // week 5
  });

  it('runs 6 weeks after a gap of 12+ weeks', () => {
    const dates = ['2026-06-01', '2026-09-01', '2026-09-15', '2026-09-29', '2026-10-10'];
    expect(computeReentry(dates, '2026-10-12')).toMatchObject({ week: 6, totalWeeks: 6 });
    expect(computeReentry(dates, '2026-10-13')).toBeNull();
  });

  it('a new 3-week break after returning starts over', () => {
    const s = computeReentry(['2026-09-13', '2026-11-11'], '2026-12-09')!;
    expect(s).toMatchObject({ lastBeforeGap: '2026-11-11', returnDate: null, gapDays: 28, week: 1 });
  });

  it('uses the most recent long gap, and ignores dates after today', () => {
    const s = computeReentry(['2026-01-01', '2026-03-01', '2026-03-03', '2026-04-10', '2026-12-01'], '2026-04-12')!;
    expect(s).toMatchObject({ lastBeforeGap: '2026-03-03', returnDate: '2026-04-10', gapDays: 38 });
  });
});

describe('formatTimeOff', () => {
  it('uses weeks from 2 weeks up', () => {
    expect(formatTimeOff(59)).toBe('8 weeks');
    expect(formatTimeOff(10)).toBe('10 days');
  });
});
