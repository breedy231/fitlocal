import { describe, it, expect } from 'vitest';
import { epley1RM } from './strength.js';

describe('epley1RM', () => {
  it('returns weight itself for 1 rep', () => {
    expect(epley1RM(100, 1)).toBe(100);
    expect(epley1RM(60, 1)).toBe(60);
  });

  it('estimates 1RM higher than input weight for multi-rep sets', () => {
    // 100 kg × 5 reps → 1RM should be > 100 kg
    const result = epley1RM(100, 5);
    expect(result).toBeGreaterThan(100);
  });

  it('gives correct Epley value for known input', () => {
    // 100 kg × 10 reps: 100 * (1 + 10/30) = 133.33...
    expect(epley1RM(100, 10)).toBeCloseTo(133.33, 1);
  });

  it('returns 0 for zero weight', () => {
    expect(epley1RM(0, 10)).toBe(0);
  });

  it('returns 0 for zero reps', () => {
    expect(epley1RM(100, 0)).toBe(0);
  });

  it('caps at 12 reps to avoid overestimation', () => {
    // Reps 12 and 20 should produce same result (capped at 12)
    expect(epley1RM(80, 12)).toBe(epley1RM(80, 20));
  });

  it('more reps at same weight → higher 1RM estimate (within cap)', () => {
    expect(epley1RM(80, 8)).toBeLessThan(epley1RM(80, 10));
  });
});
