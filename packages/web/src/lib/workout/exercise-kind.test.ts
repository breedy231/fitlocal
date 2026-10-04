import { describe, expect, it } from 'vitest';
import { isCardioName, isTreadmillName } from './exercise-kind';

describe('isTreadmillName', () => {
  it.each(['Treadmill', 'Treadmill Walk', 'Incline Treadmill Walking', 'Walking', 'Incline Walking'])(
    '%s → treadmill UI',
    (name) => {
      expect(isTreadmillName(name)).toBe(true);
      expect(isCardioName(name)).toBe(true);
    }
  );

  it.each(['Walking Lunge', 'Walking Lunges', 'Dumbbell Walking Lunge', 'walking lunge'])(
    '%s → strength (weight input), not treadmill',
    (name) => {
      expect(isTreadmillName(name)).toBe(false);
      expect(isCardioName(name)).toBe(false);
    }
  );

  it.each(['Stationary Bike', 'Rowing Machine', 'Elliptical', 'Stair Climber'])(
    '%s → plain cardio, not treadmill',
    (name) => {
      expect(isCardioName(name)).toBe(true);
      expect(isTreadmillName(name)).toBe(false);
    }
  );

  it.each(['Barbell Squat', 'Farmer Walk', 'Walkout', 'Crunch'])('%s → strength', (name) => {
    expect(isTreadmillName(name)).toBe(false);
    expect(isCardioName(name)).toBe(false);
  });
});
