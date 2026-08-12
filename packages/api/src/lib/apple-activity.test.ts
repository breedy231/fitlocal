import { describe, it, expect } from 'vitest';
import { CARDIO_PATTERN } from 'fitlocal-shared';
import {
  mapAppleActivity,
  cardioFamily,
  sameFamily,
  pickClosestSetByDuration,
} from './apple-activity.js';

// Apple activity → cardio exercise mapping (#93). Pure logic; no DB/HTTP.
describe('mapAppleActivity', () => {
  it('maps outdoor running variants', () => {
    expect(mapAppleActivity('Outdoor Run')).toBe('Running');
    expect(mapAppleActivity('Running')).toBe('Running');
    expect(mapAppleActivity('running')).toBe('Running');
    expect(mapAppleActivity('HKWorkoutActivityTypeRunning')).toBe('Running');
  });

  it('maps indoor running to treadmill', () => {
    expect(mapAppleActivity('Indoor Run')).toBe('Running - Treadmill');
    expect(mapAppleActivity('Treadmill Run')).toBe('Running - Treadmill');
    expect(mapAppleActivity('Running', true)).toBe('Running - Treadmill');
  });

  it('maps walking variants', () => {
    expect(mapAppleActivity('Outdoor Walk')).toBe('Walking');
    expect(mapAppleActivity('Walking')).toBe('Walking');
    expect(mapAppleActivity('HKWorkoutActivityTypeWalking')).toBe('Walking');
    expect(mapAppleActivity('Indoor Walk')).toBe('Walking - Treadmill');
    expect(mapAppleActivity('Walking', true)).toBe('Walking - Treadmill');
  });

  it('maps hiking (no indoor variant)', () => {
    expect(mapAppleActivity('Hiking')).toBe('Hiking');
    expect(mapAppleActivity('HKWorkoutActivityTypeHiking')).toBe('Hiking');
    expect(mapAppleActivity('Hiking', true)).toBe('Hiking');
  });

  it('maps cycling / cycle / biking variants', () => {
    expect(mapAppleActivity('Outdoor Cycle')).toBe('Cycling');
    expect(mapAppleActivity('Cycling')).toBe('Cycling');
    expect(mapAppleActivity('Biking')).toBe('Cycling');
    expect(mapAppleActivity('HKWorkoutActivityTypeCycling')).toBe('Cycling');
    expect(mapAppleActivity('Indoor Cycle')).toBe('Cycling - Stationary');
    expect(mapAppleActivity('Cycling', true)).toBe('Cycling - Stationary');
  });

  it('maps elliptical', () => {
    expect(mapAppleActivity('Elliptical')).toBe('Elliptical');
    expect(mapAppleActivity('HKWorkoutActivityTypeElliptical')).toBe('Elliptical');
  });

  it('maps rowing / rower', () => {
    expect(mapAppleActivity('Rowing')).toBe('Rowing');
    expect(mapAppleActivity('Rower')).toBe('Rowing');
    expect(mapAppleActivity('HKWorkoutActivityTypeRowing')).toBe('Rowing');
  });

  it('maps stair variants', () => {
    expect(mapAppleActivity('Stair Stepper')).toBe('Stair Stepper');
    expect(mapAppleActivity('Stairs')).toBe('Stair Stepper');
    expect(mapAppleActivity('Stepper')).toBe('Stair Stepper');
    expect(mapAppleActivity('HKWorkoutActivityTypeStairClimbing')).toBe('Stair Stepper');
    expect(mapAppleActivity('HKWorkoutActivityTypeStairStepper')).toBe('Stair Stepper');
  });

  it('maps swimming / swim', () => {
    expect(mapAppleActivity('Swimming')).toBe('Swimming');
    expect(mapAppleActivity('Swim')).toBe('Swimming');
    expect(mapAppleActivity('HKWorkoutActivityTypeSwimming')).toBe('Swimming');
  });

  it('returns null for strength types', () => {
    expect(mapAppleActivity('traditionalStrengthTraining')).toBeNull();
    expect(mapAppleActivity('functionalStrengthTraining')).toBeNull();
    expect(mapAppleActivity('coreTraining')).toBeNull();
    expect(mapAppleActivity('HKWorkoutActivityTypeTraditionalStrengthTraining')).toBeNull();
    expect(mapAppleActivity('flexibility')).toBeNull();
    expect(mapAppleActivity('yoga')).toBeNull();
    expect(mapAppleActivity('cooldown')).toBeNull();
  });

  it('returns null for HIIT-family types (locked decision #1)', () => {
    expect(mapAppleActivity('hiit')).toBeNull();
    expect(mapAppleActivity('highIntensityIntervalTraining')).toBeNull();
    expect(mapAppleActivity('HKWorkoutActivityTypeHighIntensityIntervalTraining')).toBeNull();
    expect(mapAppleActivity('crossTraining')).toBeNull();
    expect(mapAppleActivity('mixedCardio')).toBeNull();
  });

  it('returns null for unknown / empty input', () => {
    expect(mapAppleActivity('curling')).toBeNull();
    expect(mapAppleActivity('basketball')).toBeNull();
    expect(mapAppleActivity('')).toBeNull();
  });

  it('infers indoor from name but explicit arg wins', () => {
    // name says indoor, no explicit arg → treadmill
    expect(mapAppleActivity('Indoor Run')).toBe('Running - Treadmill');
    // name says outdoor, no explicit arg → outdoor
    expect(mapAppleActivity('Outdoor Run')).toBe('Running');
    // explicit false overrides "Indoor" in name
    expect(mapAppleActivity('Indoor Run', false)).toBe('Running');
    // explicit true overrides "Outdoor" in name
    expect(mapAppleActivity('Outdoor Run', true)).toBe('Running - Treadmill');
  });

  it('every mapped exercise name matches CARDIO_PATTERN (footgun guard)', () => {
    const inputs = [
      'Outdoor Run',
      'Indoor Run',
      'Outdoor Walk',
      'Indoor Walk',
      'Hiking',
      'Outdoor Cycle',
      'Indoor Cycle',
      'Elliptical',
      'Rowing',
      'Stair Stepper',
      'Swimming',
    ];
    for (const input of inputs) {
      const name = mapAppleActivity(input);
      expect(name).not.toBeNull();
      expect(CARDIO_PATTERN.test(name as string)).toBe(true);
    }
  });
});

describe('cardioFamily', () => {
  it('drops the " - " suffix', () => {
    expect(cardioFamily('Running')).toBe('running');
    expect(cardioFamily('Running - Treadmill')).toBe('running');
    expect(cardioFamily('Cycling')).toBe('cycling');
    expect(cardioFamily('Cycling - Stationary')).toBe('cycling');
    expect(cardioFamily('Walking - Treadmill')).toBe('walking');
  });

  it('lowercases single-word cardio', () => {
    expect(cardioFamily('Rowing')).toBe('rowing');
    expect(cardioFamily('Elliptical')).toBe('elliptical');
    expect(cardioFamily('Stair Stepper')).toBe('stair stepper');
  });
});

describe('sameFamily', () => {
  it('is true within a family across variants', () => {
    expect(sameFamily('Running', 'Running - Treadmill')).toBe(true);
    expect(sameFamily('Cycling', 'Cycling - Stationary')).toBe(true);
    expect(sameFamily('Rowing', 'Rowing')).toBe(true);
  });

  it('is false across modalities', () => {
    expect(sameFamily('Running', 'Cycling')).toBe(false);
    expect(sameFamily('Running - Treadmill', 'Cycling - Stationary')).toBe(false);
    expect(sameFamily('Swimming', 'Rowing')).toBe(false);
  });
});

describe('pickClosestSetByDuration', () => {
  it('picks the duration-closest set', () => {
    const sets = [
      { id: 1, durationSeconds: 300, reps: null },
      { id: 2, durationSeconds: 1200, reps: null },
      { id: 3, durationSeconds: 900, reps: null },
    ];
    expect(pickClosestSetByDuration(sets, 1000)).toBe(3);
  });

  it('breaks ties to the lowest id', () => {
    const sets = [
      { id: 5, durationSeconds: 600, reps: null },
      { id: 2, durationSeconds: 600, reps: null },
      { id: 9, durationSeconds: 600, reps: null },
    ];
    expect(pickClosestSetByDuration(sets, 600)).toBe(2);
  });

  it('falls back to reps*60 when durationSeconds is null', () => {
    const sets = [
      { id: 1, durationSeconds: null, reps: 5 }, // 300s
      { id: 2, durationSeconds: null, reps: 20 }, // 1200s
    ];
    expect(pickClosestSetByDuration(sets, 1100)).toBe(2);
    expect(pickClosestSetByDuration(sets, 250)).toBe(1);
  });

  it('treats a set with neither duration nor reps as Infinity (loses)', () => {
    const sets = [
      { id: 1, durationSeconds: null, reps: null },
      { id: 2, durationSeconds: 700, reps: null },
    ];
    expect(pickClosestSetByDuration(sets, 600)).toBe(2);
  });

  it('returns null for an empty list', () => {
    expect(pickClosestSetByDuration([], 600)).toBeNull();
  });
});
