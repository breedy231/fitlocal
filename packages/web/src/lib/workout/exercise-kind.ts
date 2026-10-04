import { CARDIO_PATTERN } from 'fitlocal-shared';

// Treadmill-style cardio gets the Duration / Incline / Distance inputs. \b
// boundaries so "treadmill"/"walking" only match as whole words, and only ever
// applied on top of CARDIO_PATTERN: that pattern already keeps "Walking Lunge"
// a strength exercise, and a treadmill exercise must be cardio in the first
// place. The bare /treadmill|walking/ this replaces sent "Walking Lunge" to the
// treadmill UI with no weight input.
const TREADMILL_PATTERN = /\b(?:treadmill|walking)\b/i;

export function isCardioName(name: string): boolean {
  return CARDIO_PATTERN.test(name);
}

export function isTreadmillName(name: string): boolean {
  return isCardioName(name) && TREADMILL_PATTERN.test(name);
}
