import { describe, it, expect } from 'vitest';
import {
  pickPriorWeightPoint,
  weeklyWeightRateLbs,
  WEEKLY_RATE_TOLERANCE_DAYS,
  KG_TO_LBS,
} from 'fitlocal-shared';

const pt = (date: string, trendKg: number) => ({ date, trendKg });

describe('pickPriorWeightPoint', () => {
  it('picks the nearest point by day distance, not the first in range', () => {
    // Today 2026-11-09 -> target 2026-11-02. No weigh-in on the 2nd.
    const points = [
      pt('2026-09-01', 90),
      pt('2026-10-15', 88),
      pt('2026-11-01', 86),
      pt('2026-11-03', 85.5),
      pt('2026-11-09', 85),
    ];
    // 11-01 and 11-03 are both 1 day away; ties resolve to the earlier point.
    expect(pickPriorWeightPoint(points, '2026-11-09')?.date).toBe('2026-11-01');
  });

  it('prefers an exact hit on the target date', () => {
    const points = [pt('2026-10-31', 80), pt('2026-11-02', 79), pt('2026-11-04', 78), pt('2026-11-09', 77)];
    expect(pickPriorWeightPoint(points, '2026-11-09')?.date).toBe('2026-11-02');
  });

  it('returns null when the nearest prior point is outside tolerance (sparse data)', () => {
    const points = [pt('2026-09-01', 90), pt('2026-10-01', 88), pt('2026-11-09', 85)];
    expect(pickPriorWeightPoint(points, '2026-11-09')).toBeNull();
  });

  it('accepts a point exactly at the tolerance edge', () => {
    const points = [pt('2026-10-30', 80), pt('2026-11-09', 79)]; // target 11-02, 3 days off
    expect(WEEKLY_RATE_TOLERANCE_DAYS).toBe(3);
    expect(pickPriorWeightPoint(points, '2026-11-09')?.date).toBe('2026-10-30');
  });

  it('never picks the latest point itself', () => {
    const points = [pt('2026-10-01', 80), pt('2026-11-09', 79)];
    expect(pickPriorWeightPoint(points, '2026-11-09')).toBeNull();
  });

  it('returns null when the span to the latest point is too short', () => {
    // Latest weigh-in is old: prior is near target but only 2 days before latest.
    const points = [pt('2026-11-01', 80), pt('2026-11-03', 79.5)];
    expect(pickPriorWeightPoint(points, '2026-11-09')).toBeNull();
  });

  it('returns null for fewer than 2 points', () => {
    expect(pickPriorWeightPoint([], '2026-11-09')).toBeNull();
    expect(pickPriorWeightPoint([pt('2026-11-09', 80)], '2026-11-09')).toBeNull();
  });

  it('uses calendar days, so month and DST boundaries do not skew distance', () => {
    const points = [pt('2026-10-28', 80), pt('2026-11-05', 79)];
    // today 11-04 -> target 10-28 (exact), across the Nov 1 DST change in the US.
    expect(pickPriorWeightPoint(points, '2026-11-04')?.date).toBe('2026-10-28');
  });
});

describe('weeklyWeightRateLbs', () => {
  it('computes lbs/week over the real span between the two points', () => {
    // 7 days apart, -1 kg
    const points = [pt('2026-11-02', 80), pt('2026-11-09', 79)];
    expect(weeklyWeightRateLbs(points, '2026-11-09')).toBeCloseTo(-1 * KG_TO_LBS, 1);
  });

  it('scales by the actual span when the prior point is not exactly 7 days back', () => {
    // 5 days apart, -1 kg -> -1.4 kg/wk
    const points = [pt('2026-11-04', 80), pt('2026-11-09', 79)];
    expect(weeklyWeightRateLbs(points, '2026-11-09')).toBeCloseTo((-1 / 5) * 7 * KG_TO_LBS, 1);
  });

  it('is null for sparse data', () => {
    expect(weeklyWeightRateLbs([pt('2026-09-01', 90), pt('2026-11-09', 85)], '2026-11-09')).toBeNull();
  });

  it('does not use a UTC date: a Chicago evening "today" is still that evening', () => {
    // 2026-11-09 22:00 Chicago is already 11-10 in UTC. The caller passes the
    // local date; the function must treat it as given.
    const points = [pt('2026-11-02', 80), pt('2026-11-09', 79)];
    expect(weeklyWeightRateLbs(points, '2026-11-09')).toBeCloseTo(-1 * KG_TO_LBS, 1);
  });
});
