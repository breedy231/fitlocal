/**
 * Epley formula for estimated 1-rep max.
 * Caps reps input at 12 to avoid overestimation with high-rep sets.
 */
export function epley1RM(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;
  const cappedReps = Math.min(reps, 12);
  return weightKg * (1 + cappedReps / 30);
}

/**
 * SQL equivalent of epley1RM(), for use inside raw SQL (reports routes etc.).
 * Takes COLUMN REFERENCES (trusted identifiers such as 's.weight_kg'), never
 * user input: the result is spliced into SQL text.
 *
 * Same rules as epley1RM(): 0 when weight<=0 or reps<=0, the bare weight when
 * reps = 1, else weight * (1 + min(reps, 12) / 30).
 * NULL weight or NULL reps yields NULL (not 0), matching the old inline SQL,
 * so MAX() ignores such rows instead of treating them as a zero lift.
 *
 * Keep in sync with epley1RM(); strength.sql.test.ts asserts parity.
 */
export function epley1RMSql(weightCol: string, repsCol: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(weightCol) || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(repsCol)) {
    throw new Error('epley1RMSql: arguments must be plain column references');
  }
  return `(CASE
    WHEN ${weightCol} <= 0 OR ${repsCol} <= 0 THEN 0
    WHEN ${repsCol} = 1 THEN ${weightCol}
    ELSE ${weightCol} * (1.0 + MIN(CAST(${repsCol} AS REAL), 12.0) / 30.0)
  END)`;
}
