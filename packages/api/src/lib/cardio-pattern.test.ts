import { describe, it, expect } from 'vitest';
import { CARDIO_PATTERN } from 'fitlocal-shared';

// CARDIO_PATTERN is the single source of truth for cardio-vs-strength, used by
// the web log/history pages and the generator/swap. These cases are drawn from
// the real exercise corpus (#49).
describe('CARDIO_PATTERN', () => {
  const CARDIO = [
    'Cycling',
    'Cycling - Stationary',
    'Elliptical',
    'Hiking',
    'Jog In Place',
    'Rowing',
    'Running',
    'Running - Treadmill',
    'Stair Stepper',
    'Swimming',
    'Walking',
    'Walking - Treadmill',
  ];

  // Strength/core/mobility names that contain a cardio-ish substring and must
  // NOT be classified as cardio.
  const NOT_CARDIO = [
    'Walking Lunge',
    'Dumbbell Walking Lunge',
    'Crunches',
    'Cable Crunch',
    'Bicycle Crunch', // "cycl" inside bicycle
    'Reverse Crunch',
    'Cable Row',
    'Dumbbell Row',
    'T-Bar Row',
    'Gorilla Rows',
    'Mountain Climber',
    'Mini Loop Band Mountain Climber',
    'Walkout',
    'Walkout to Push Up',
    "Runner's Butt Kicks",
    'TRX Hamstring Runner',
    'TRX Swimmer Pull', // "swim" inside swimmer
    'Push Up',
    'Barbell Bench Press',
  ];

  it.each(CARDIO)('classifies %s as cardio', (name) => {
    expect(CARDIO_PATTERN.test(name)).toBe(true);
  });

  it.each(NOT_CARDIO)('does not classify %s as cardio', (name) => {
    expect(CARDIO_PATTERN.test(name)).toBe(false);
  });

  it('is not stateful across calls (no global flag)', () => {
    // a /g flag would make .test() toggle via lastIndex
    expect(CARDIO_PATTERN.test('Running')).toBe(true);
    expect(CARDIO_PATTERN.test('Running')).toBe(true);
  });
});
