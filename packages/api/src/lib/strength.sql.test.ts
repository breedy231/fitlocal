import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { epley1RM, epley1RMSql } from './strength.js';

describe('epley1RMSql parity with epley1RM', () => {
  const db = new Database(':memory:');
  const weights = [0, -5, 20, 62.5, 100, 140.25];
  const reps = [-1, 0, 1, 2, 5, 11, 12, 13, 15, 30];
  const frag = epley1RMSql('weight_kg', 'reps');
  const q = db.prepare(`SELECT ${frag} AS v FROM (SELECT ? AS weight_kg, ? AS reps)`);

  for (const w of weights) {
    for (const r of reps) {
      it(`weight=${w} reps=${r}`, () => {
        const got = (q.get(w, r) as { v: number }).v;
        expect(got).toBeCloseTo(epley1RM(w, r), 9);
      });
    }
  }

  it('NULL reps yields NULL (ignored by MAX), as the old inline SQL did', () => {
    expect((q.get(100, null) as { v: unknown }).v).toBeNull();
  });
  it('NULL weight yields NULL', () => {
    expect((q.get(null, 5) as { v: unknown }).v).toBeNull();
  });
  it('works with table-qualified column names', () => {
    const f = epley1RMSql('s.weight_kg', 's.reps');
    const v = (db.prepare(`SELECT ${f} AS v FROM (SELECT 100 AS weight_kg, 1 AS reps) s`).get() as { v: number }).v;
    expect(v).toBe(100);
  });
});
