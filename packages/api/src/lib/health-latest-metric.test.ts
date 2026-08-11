import { describe, it, expect } from 'vitest';
import { computeLatestByMetric, DaySnapshot } from './health-xml-parser.js';

function makeSnapshot(overrides: Partial<DaySnapshot> & { date: string }): DaySnapshot {
  return {
    date: overrides.date,
    hrv: overrides.hrv ?? null,
    restingHr: overrides.restingHr ?? null,
    sleepHours: overrides.sleepHours ?? null,
    steps: overrides.steps ?? null,
    bodyWeightKg: overrides.bodyWeightKg ?? null,
    calories: overrides.calories ?? null,
    proteinG: overrides.proteinG ?? null,
  };
}

describe('computeLatestByMetric', () => {
  it('returns correct latest date per metric from sorted snapshots', () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({ date: '2026-06-24', bodyWeightKg: 80 }),
      makeSnapshot({ date: '2026-08-01', steps: 9000, calories: 2000 }),
      makeSnapshot({ date: '2026-08-10', steps: 8000, hrv: 45 }),
    ];

    const result = computeLatestByMetric(snapshots);

    expect(result['bodyWeight']).toBe('2026-06-24');
    expect(result['steps']).toBe('2026-08-10');
    expect(result['calories']).toBe('2026-08-01');
    expect(result['hrv']).toBe('2026-08-10');

    // Keys with no data should be absent
    expect('protein' in result).toBe(false);
    expect('restingHr' in result).toBe(false);
    expect('sleep' in result).toBe(false);
  });

  it('returns correct max date even with unsorted input', () => {
    // Intentionally out of order — the function must NOT rely on sorted input
    const snapshots: DaySnapshot[] = [
      makeSnapshot({ date: '2026-08-10', steps: 8000, hrv: 45 }),
      makeSnapshot({ date: '2026-06-24', bodyWeightKg: 80 }),
      makeSnapshot({ date: '2026-08-01', steps: 9000, calories: 2000 }),
    ];

    const result = computeLatestByMetric(snapshots);

    expect(result['bodyWeight']).toBe('2026-06-24');
    expect(result['steps']).toBe('2026-08-10');
    expect(result['calories']).toBe('2026-08-01');
    expect(result['hrv']).toBe('2026-08-10');
    expect('protein' in result).toBe(false);
    expect('restingHr' in result).toBe(false);
    expect('sleep' in result).toBe(false);
  });

  it('returns empty object for empty snapshots array', () => {
    expect(computeLatestByMetric([])).toEqual({});
  });

  it('maps sleepHours to sleep key', () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({ date: '2026-07-15', sleepHours: 7.5 }),
    ];
    const result = computeLatestByMetric(snapshots);
    expect(result['sleep']).toBe('2026-07-15');
  });

  it('maps restingHr and proteinG correctly', () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({ date: '2026-07-01', restingHr: 58, proteinG: 150 }),
    ];
    const result = computeLatestByMetric(snapshots);
    expect(result['restingHr']).toBe('2026-07-01');
    expect(result['protein']).toBe('2026-07-01');
  });
});
