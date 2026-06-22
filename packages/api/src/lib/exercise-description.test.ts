import { describe, it, expect } from 'vitest';
import {
  isLatinText,
  isInstructional,
  pickBestDescription,
} from 'fitlocal-shared';

describe('isLatinText', () => {
  it('accepts plain English', () => {
    expect(isLatinText('Place feet shoulder width apart and lower.')).toBe(true);
  });

  it('accepts accented Latin text', () => {
    expect(isLatinText('Curl à la française with résistance')).toBe(true);
  });

  it('rejects predominantly non-Latin text', () => {
    expect(isLatinText('تمرين الضغط بالدمبل')).toBe(false); // Arabic
    expect(isLatinText('Жим штанги лёжа')).toBe(false); // Cyrillic
    expect(isLatinText('ベンチプレス')).toBe(false); // Japanese
  });

  // Pins the draft bug: counting only [a-zA-Z] as the denominator made any
  // string with a single ASCII letter pass, even if mostly non-Latin.
  it('rejects mostly non-Latin text with a stray Latin letter', () => {
    expect(isLatinText('تمرين الضغط بالدمبل a')).toBe(false);
  });

  it('returns false for empty / whitespace', () => {
    expect(isLatinText('')).toBe(false);
    expect(isLatinText('   ')).toBe(false);
  });

  it('returns false when there are no letters at all', () => {
    expect(isLatinText('123 ... !!!')).toBe(false);
  });
});

describe('isInstructional', () => {
  it('detects instructional cue words as whole words', () => {
    expect(isInstructional('Lower until your thighs are parallel.')).toBe(true);
    expect(isInstructional('Keep your back straight and hold.')).toBe(true);
  });

  it('does not flag general-info blurbs', () => {
    expect(
      isInstructional(
        'The bench press is a compound exercise that builds upper-body strength.'
      )
    ).toBe(false);
  });

  it('requires whole-word matches', () => {
    expect(isInstructional('Standardize your grip width gradually')).toBe(true); // "grip"
    expect(isInstructional('Sitting position overview')).toBe(false); // not "sit"
  });
});

describe('pickBestDescription', () => {
  it('prefers an instructional description over a general-info one', () => {
    const general =
      'The bench press is a compound exercise that builds strength.';
    const instructional =
      'Place your feet flat, lower the bar to your chest, then press up.';
    expect(pickBestDescription([general, instructional])).toBe(instructional);
  });

  it('skips non-Latin candidates and returns the English one', () => {
    const arabic = 'تمرين الضغط بالدمبل';
    const english = 'Hold the dumbbells and raise them overhead.';
    expect(pickBestDescription([arabic, english])).toBe(english);
  });

  it('falls back to the first Latin candidate when none are instructional', () => {
    const a = 'A great movement for overall fitness.';
    const b = 'Another general description of the movement.';
    expect(pickBestDescription([a, b])).toBe(a);
  });

  it('trims and drops empty candidates', () => {
    expect(pickBestDescription(['', '   ', '  Lower slowly.  '])).toBe(
      'Lower slowly.'
    );
  });

  it('returns null when nothing usable remains', () => {
    expect(pickBestDescription([])).toBe(null);
    expect(pickBestDescription(['', '   '])).toBe(null);
    expect(pickBestDescription(['تمرين الضغط بالدمبل'])).toBe(null);
  });
});
