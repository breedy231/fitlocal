import { describe, it, expect } from 'vitest';
import { isWorkoutStarted, resolveStartTime, readWarmupDoneAt, writeWarmupDoneAt } from './session-state';

describe('isWorkoutStarted', () => {
  it('fresh workout (no sets done, no warm-up stamp) is not started', () => {
    expect(isWorkoutStarted([{ sets: [{ completed: false }, {}] }], null)).toBe(false);
    expect(isWorkoutStarted([], null)).toBe(false);
  });
  it('any completed set means started', () => {
    expect(isWorkoutStarted([{ sets: [{ completed: false }] }, { sets: [{ completed: true }] }], null)).toBe(true);
  });
  it('a finished warm-up means started even with no sets done', () => {
    expect(isWorkoutStarted([{ sets: [{ completed: false }] }], 1000)).toBe(true);
  });
});

describe('resolveStartTime', () => {
  const now = Date.parse('2026-11-10T20:00:00Z');
  it('prefers the warm-up end stamp', () => {
    expect(resolveStartTime(now - 600_000, '2026-11-10T18:00:00Z', now)).toBe(now - 600_000);
  });
  it('falls back to the server started_at', () => {
    expect(resolveStartTime(null, '2026-11-10T19:00:00Z', now)).toBe(Date.parse('2026-11-10T19:00:00Z'));
  });
  it('falls back to now when nothing usable', () => {
    expect(resolveStartTime(null, null, now)).toBe(now);
    expect(resolveStartTime(null, 'garbage', now)).toBe(now);
  });
  it('ignores a start in the future', () => {
    expect(resolveStartTime(now + 1000, '2026-11-11T00:00:00Z', now)).toBe(now);
  });
  it('elapsed time is derived from the stamp, not from load time', () => {
    const start = resolveStartTime(null, '2026-11-10T19:15:00Z', now);
    expect(Math.round((now - start) / 60000)).toBe(45);
  });
});

describe('warm-up stamp storage', () => {
  it('round-trips and tolerates missing/bad values', () => {
    const data: Record<string, string> = {};
    const store = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
    expect(readWarmupDoneAt('7', store)).toBeNull();
    writeWarmupDoneAt('7', 12345, store);
    expect(readWarmupDoneAt('7', store)).toBe(12345);
    data['fitlocal-workout-warmup-done-8'] = 'abc';
    expect(readWarmupDoneAt('8', store)).toBeNull();
  });
});
