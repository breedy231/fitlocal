/**
 * Canonical cardio exercise name pattern.
 *
 * \b word boundaries are required — bare "run" matches inside "crunch". For the
 * same reason whole words are matched, not stems: "running" (not "run", which
 * hits crunch), "rowing"/"rower" (not "row", which hits every barbell/cable
 * row), "swimming" (not "swim", which hits "TRX Swimmer Pull"), "cycling" (not
 * "cycl", which hits "Bicycle Crunch"). "stair" must precede stepper/climber so
 * "Mountain Climber" stays strength. "walking" is excluded before "lunge" so
 * "Walking Lunge" stays a leg exercise ("Walkout" never matches "walking").
 *
 * Single source of truth — imported by:
 *   - packages/web/src/routes/log/[id]/+page.svelte
 *   - packages/web/src/routes/history/+page.svelte
 *   - packages/web/src/routes/history/[id]/edit/+page.svelte
 *   - packages/api/src/lib/generator.ts
 *   - packages/api/src/routes/generate.ts
 */
export const CARDIO_PATTERN =
  /\b(?:treadmill|elliptical|cycling|rowing|rower|stair\s*(?:stepper|climber|master)|bike|jog(?:ging)?|sprinting|running|swimming|hiking|walking(?!\s+lunge))\b/i;
