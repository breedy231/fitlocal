import { describe, it, expect } from 'vitest';
import { matchesEquipment, normalizeAvailableEquipment, EQUIPMENT_ALIASES } from './equipment-match.js';

describe('normalizeAvailableEquipment', () => {
  it('lowercases and trims entries', () => {
    const out = normalizeAvailableEquipment([' Dumbbell ', 'FLAT-BENCH']);
    expect(out).toEqual(new Set(['dumbbell', 'flat-bench']));
  });

  it('expands the trx alias to suspension', () => {
    expect(normalizeAvailableEquipment(['trx']).has('suspension')).toBe(true);
  });

  it('expands the cardio alias to the cardio-machine tags', () => {
    const out = normalizeAvailableEquipment(['cardio']);
    for (const t of EQUIPMENT_ALIASES.cardio) expect(out.has(t)).toBe(true);
  });

  it('drops empty strings and de-dupes', () => {
    expect(normalizeAvailableEquipment(['dumbbell', '', 'dumbbell', '  '])).toEqual(new Set(['dumbbell']));
  });
});

describe('matchesEquipment', () => {
  const moms = normalizeAvailableEquipment(['dumbbell', 'flat-bench', 'kettlebell', 'bodyweight']);

  it('treats an empty requirement as always eligible (bodyweight)', () => {
    expect(matchesEquipment([], moms)).toBe(true);
    expect(matchesEquipment([], normalizeAvailableEquipment([]))).toBe(true);
  });

  it('requires every tag to be available (subset, not intersection)', () => {
    expect(matchesEquipment(['dumbbell'], moms)).toBe(true);
    expect(matchesEquipment(['dumbbell', 'flat-bench'], moms)).toBe(true);
    expect(matchesEquipment(['dumbbell', 'incline-bench'], moms)).toBe(false); // no incline
    expect(matchesEquipment(['barbell'], moms)).toBe(false);
  });

  it('matches a suspension exercise against a legacy trx profile', () => {
    const travel = normalizeAvailableEquipment(['dumbbell', 'bodyweight', 'band', 'trx', 'cardio']);
    expect(matchesEquipment(['suspension'], travel)).toBe(true);
    expect(matchesEquipment(['treadmill'], travel)).toBe(true); // via cardio alias
    expect(matchesEquipment(['barbell'], travel)).toBe(false);
  });
});
