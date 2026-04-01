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
