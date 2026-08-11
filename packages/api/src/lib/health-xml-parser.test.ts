import { describe, it, expect } from 'vitest';
import {
  mergeAndSumSleepHours,
  pickBestSourceIntervals,
  groupSleepByDate,
  computeSleepHoursForDate,
  type SleepInterval,
} from './health-xml-parser.js';

// Helper: build a SleepInterval from wall-clock strings
function makeInterval(
  startIso: string,
  endIso: string,
  sourceName: string,
  creationDate?: string,
): SleepInterval {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  return {
    date: '',
    startMs,
    endMs,
    creationDate: creationDate ?? endIso,
    sourceName,
  };
}

describe('mergeAndSumSleepHours', () => {
  it('returns 0 for empty array', () => {
    expect(mergeAndSumSleepHours([])).toBe(0);
  });

  it('merges overlapping segments from one source into ~8 hours', () => {
    // Staged sleep: 3 × 2.5h segments that partially overlap → total span ≈ 7h
    const intervals: SleepInterval[] = [
      makeInterval('2026-03-25T23:00:00Z', '2026-03-26T01:30:00Z', 'Apple Watch'),
      makeInterval('2026-03-26T01:00:00Z', '2026-03-26T03:30:00Z', 'Apple Watch'),
      makeInterval('2026-03-26T03:00:00Z', '2026-03-26T07:00:00Z', 'Apple Watch'),
    ];
    // Non-overlapping span: 23:00→01:30 + 01:30→03:30 + 03:30→07:00 = 8h
    expect(mergeAndSumSleepHours(intervals)).toBeCloseTo(8, 1);
  });

  it('sums non-overlapping segments (nap + overnight)', () => {
    const intervals: SleepInterval[] = [
      makeInterval('2026-03-25T14:00:00Z', '2026-03-25T15:00:00Z', 'Apple Watch'), // 1h nap
      makeInterval('2026-03-25T23:00:00Z', '2026-03-26T06:00:00Z', 'Apple Watch'), // 7h overnight
    ];
    expect(mergeAndSumSleepHours(intervals)).toBeCloseTo(8, 5);
  });
});

describe('pickBestSourceIntervals', () => {
  it('returns all intervals when there is only one source', () => {
    const intervals = [
      makeInterval('2026-03-25T23:00:00Z', '2026-03-26T07:00:00Z', 'Apple Watch'),
    ];
    expect(pickBestSourceIntervals(intervals)).toHaveLength(1);
  });

  it('picks the source with the most merged hours when two sources overlap', () => {
    // Apple Watch: 23:00→07:00 = 8h
    // SleepCycle:  23:30→07:30 = 8h but slightly offset
    const appleWatchIntervals = [
      makeInterval('2026-03-25T23:00:00Z', '2026-03-26T07:00:00Z', 'Apple Watch'),
    ];
    const sleepCycleIntervals = [
      makeInterval('2026-03-25T23:30:00Z', '2026-03-26T07:30:00Z', 'SleepCycle'),
    ];
    const all = [...appleWatchIntervals, ...sleepCycleIntervals];
    const picked = pickBestSourceIntervals(all);

    // All picked intervals must belong to the same source
    const sources = new Set(picked.map(i => i.sourceName));
    expect(sources.size).toBe(1);

    // The result should represent ~8 hours, not ~16
    expect(mergeAndSumSleepHours(picked)).toBeCloseTo(8, 0);
  });

  it('tie-breaks by lexicographically smallest sourceName', () => {
    // Both sources have exactly 7h
    const aIntervals = [
      makeInterval('2026-03-25T23:00:00Z', '2026-03-26T06:00:00Z', 'A Source'),
    ];
    const bIntervals = [
      makeInterval('2026-03-25T23:00:00Z', '2026-03-26T06:00:00Z', 'B Source'),
    ];
    const picked = pickBestSourceIntervals([...aIntervals, ...bIntervals]);
    expect(picked[0].sourceName).toBe('A Source');
  });
});

describe('computeSleepHoursForDate', () => {
  it('core regression: two sources recording the same night → ~8h, NOT ~16h', () => {
    // Apple Watch records 23:00→07:00; third-party app records 22:50→07:10 (slightly offset)
    const intervals: SleepInterval[] = [
      makeInterval('2026-03-25T23:00:00Z', '2026-03-26T07:00:00Z', 'Apple Watch'),
      makeInterval('2026-03-25T22:50:00Z', '2026-03-26T07:10:00Z', 'AutoSleep'),
    ];
    const hours = computeSleepHoursForDate(intervals);
    expect(hours).toBeCloseTo(8, 0);
    expect(hours).toBeLessThan(10); // definitely not doubled
  });

  it('nap + overnight from the same source → ~8h (both retained)', () => {
    const intervals: SleepInterval[] = [
      makeInterval('2026-03-25T14:00:00Z', '2026-03-25T15:00:00Z', 'Apple Watch'), // 1h nap
      makeInterval('2026-03-25T23:00:00Z', '2026-03-26T06:00:00Z', 'Apple Watch'), // 7h overnight
    ];
    expect(computeSleepHoursForDate(intervals)).toBeCloseTo(8, 5);
  });

  it('single source with overlapping fragmented staged-sleep → merges to ~8h, no double count', () => {
    // Three overlapping segments (Apple Watch stages): total merged span = 8h
    const intervals: SleepInterval[] = [
      makeInterval('2026-03-25T23:00:00Z', '2026-03-26T02:00:00Z', 'Apple Watch'),
      makeInterval('2026-03-26T01:30:00Z', '2026-03-26T04:30:00Z', 'Apple Watch'),
      makeInterval('2026-03-26T04:00:00Z', '2026-03-26T07:00:00Z', 'Apple Watch'),
    ];
    // Merged: 23:00→02:00, then extended to 04:30, then extended to 07:00 → 8h total
    expect(computeSleepHoursForDate(intervals)).toBeCloseTo(8, 1);
  });

  it('clamp guard: many non-overlapping same-source blocks summing >16h → clamped to 16', () => {
    // 18 × 1h non-overlapping blocks = 18h raw → should be clamped to 16
    const intervals: SleepInterval[] = Array.from({ length: 18 }, (_, i) =>
      makeInterval(
        `2026-03-25T${String(i).padStart(2, '0')}:00:00Z`,
        `2026-03-25T${String(i).padStart(2, '0')}:59:00Z`,
        'Apple Watch',
      ),
    );
    expect(computeSleepHoursForDate(intervals)).toBe(16);
  });
});

describe('groupSleepByDate', () => {
  it('groups segments from the same session under the wake-up date', () => {
    // Two segments with the same creationDate (same session), wake-up on 2026-03-26
    const creationDate = '2026-03-26 07:05:00 -0500';
    const intervals: SleepInterval[] = [
      { ...makeInterval('2026-03-25T23:00:00Z', '2026-03-26T03:00:00Z', 'Apple Watch'), creationDate },
      { ...makeInterval('2026-03-26T03:00:00Z', '2026-03-26T07:00:00Z', 'Apple Watch'), creationDate },
    ];
    const grouped = groupSleepByDate(intervals);
    expect(grouped.size).toBe(1);
    // The one group should contain both segments
    const [, segs] = [...grouped.entries()][0];
    expect(segs).toHaveLength(2);
  });

  it('separates sessions with different creationDates into different dates', () => {
    const intervals: SleepInterval[] = [
      {
        ...makeInterval('2026-03-24T23:00:00Z', '2026-03-25T07:00:00Z', 'Apple Watch'),
        creationDate: '2026-03-25 07:05:00 -0500',
      },
      {
        ...makeInterval('2026-03-25T23:00:00Z', '2026-03-26T07:00:00Z', 'Apple Watch'),
        creationDate: '2026-03-26 07:05:00 -0500',
      },
    ];
    const grouped = groupSleepByDate(intervals);
    expect(grouped.size).toBe(2);
  });
});
