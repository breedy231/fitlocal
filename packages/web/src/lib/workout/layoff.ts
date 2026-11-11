/** Hint shown next to an exercise whose weight was lowered for a return from layoff. */
export function layoffHint(days: number): string {
  const weeks = Math.max(1, Math.round(days / 7));
  return `Back after ${weeks} ${weeks === 1 ? 'week' : 'weeks'}: lighter start`;
}
