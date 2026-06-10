/**
 * Canonical cardio exercise name pattern.
 *
 * \b word boundaries are required — bare "run" matches inside "crunch",
 * and bare "cycling" without boundaries would be fine but consistency matters.
 *
 * Single source of truth — imported by:
 *   - packages/web/src/routes/log/[id]/+page.svelte
 *   - packages/web/src/routes/history/+page.svelte
 *   - packages/web/src/routes/history/[id]/edit/+page.svelte
 *   - packages/api/src/lib/generator.ts
 *   - packages/api/src/routes/generate.ts
 */
export const CARDIO_PATTERN =
  /\b(treadmill|elliptical|cycling|rowing\s+machine|stationary\s+bike|stair\s*climber|air\s+bike|assault\s+bike|rower|bike|rowing|jogging|sprinting|walking)\b/i;
