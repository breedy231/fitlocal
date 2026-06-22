import { describe, it, expect } from 'vitest';
import { lbsToKg, kgToLbs, milesToMeters, metersToMiles } from 'fitlocal-shared';

describe('unit conversions', () => {
  it('converts pounds to kilograms', () => {
    expect(lbsToKg(100)).toBeCloseTo(45.359237, 6);
    expect(lbsToKg(0)).toBe(0);
  });

  it('converts kilograms to pounds', () => {
    expect(kgToLbs(100)).toBeCloseTo(220.46226, 5);
  });

  it('round-trips lbs <-> kg', () => {
    expect(kgToLbs(lbsToKg(185))).toBeCloseTo(185, 6);
  });

  it('converts miles to meters', () => {
    expect(milesToMeters(1)).toBeCloseTo(1609.344, 3);
    expect(milesToMeters(3.1)).toBeCloseTo(4988.966, 2);
  });

  it('converts meters to miles', () => {
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 6);
  });

  it('round-trips miles <-> meters', () => {
    expect(metersToMiles(milesToMeters(5))).toBeCloseTo(5, 6);
  });
});
