/**
 * Apple Health workout activity → FitLocal cardio exercise mapping (issue #93).
 *
 * Pure, dependency-light logic consumed by the upcoming `/workout-sessions`
 * ingest route. No DB, no HTTP — just string mapping and set tie-break helpers.
 *
 * Locked decisions:
 *   #1 — the allowlist deliberately maps ONLY the steady-state cardio modalities
 *        below. Strength (traditional/functional/core), flexibility/yoga/cooldown,
 *        AND HIIT-family types (hiit / highIntensityIntervalTraining /
 *        crossTraining / mixedCardio) return null → caller marks `skipped_activity`.
 *   #2 — when several manual cardio sets could be enriched, pick the one whose
 *        duration is closest to the Apple workout duration (pickClosestSetByDuration).
 *
 * Every exercise name returned here MUST match CARDIO_PATTERN in
 * packages/shared/src/cardio.ts (asserted in the test) — do not add a mapping
 * whose target name the shared pattern would classify as strength.
 */

/**
 * Map an Apple Health workout activity type to a FitLocal cardio exercise name.
 *
 * Case-insensitive. Accepts Shortcut display names ("Outdoor Run",
 * "Indoor Cycle"), `HKWorkoutActivityType*` identifiers (the prefix is stripped),
 * and raw enum words ("traditionalStrengthTraining").
 *
 * `indoor` explicitly passed wins over inference from the name. When `indoor` is
 * undefined it is inferred from the name ("indoor"/"treadmill"/"stationary" →
 * true, "outdoor" → false, otherwise the outdoor default).
 *
 * Returns null for anything outside the cardio allowlist.
 */
export function mapAppleActivity(activityType: string, indoor?: boolean): string | null {
  if (!activityType) return null;

  // Strip the HK identifier prefix, lowercase, collapse to plain letters.
  const raw = activityType.replace(/^HKWorkoutActivityType/i, '');
  const norm = raw.toLowerCase().replace(/[^a-z]/g, '');

  const isIndoor = indoor ?? inferIndoor(norm) ?? false;

  // Skip HIIT-family explicitly (locked decision #1) before any cardio matching.
  if (
    norm.includes('highintensityinterval') ||
    norm.includes('hiit') ||
    norm.includes('crosstraining') ||
    norm.includes('mixedcardio')
  ) {
    return null;
  }

  if (norm.includes('running') || norm.includes('run')) {
    return isIndoor ? 'Running - Treadmill' : 'Running';
  }
  if (norm.includes('hiking') || norm.includes('hike')) {
    return 'Hiking';
  }
  if (norm.includes('walking') || norm.includes('walk')) {
    return isIndoor ? 'Walking - Treadmill' : 'Walking';
  }
  if (
    norm.includes('cycling') ||
    norm.includes('cycle') ||
    norm.includes('biking') ||
    norm.includes('bike')
  ) {
    return isIndoor ? 'Cycling - Stationary' : 'Cycling';
  }
  if (norm.includes('elliptical')) {
    return 'Elliptical';
  }
  if (norm.includes('rowing') || norm.includes('rower') || norm === 'row') {
    return 'Rowing';
  }
  if (
    norm.includes('stairstepper') ||
    norm.includes('stairclimbing') ||
    norm.includes('stairs') ||
    norm.includes('stepper') ||
    norm.includes('stair')
  ) {
    return 'Stair Stepper';
  }
  if (norm.includes('swimming') || norm.includes('swim')) {
    return 'Swimming';
  }

  return null;
}

/** Infer indoor/outdoor from the normalized (letters-only) name. undefined when unknown. */
function inferIndoor(norm: string): boolean | undefined {
  if (norm.includes('indoor') || norm.includes('treadmill') || norm.includes('stationary')) {
    return true;
  }
  if (norm.includes('outdoor')) {
    return false;
  }
  return undefined;
}

/**
 * Family key for enrich-matching: lowercase the name and drop any ` - `-suffixed
 * variant. `Running` and `Running - Treadmill` → `running`; `Cycling` /
 * `Cycling - Stationary` → `cycling`; single-word cardio maps to itself
 * lowercased (`Rowing` → `rowing`).
 */
export function cardioFamily(exerciseName: string): string {
  return exerciseName.split(' - ')[0].trim().toLowerCase();
}

/**
 * Same modality family? Prevents cross-modality enrich (never enrich a Cycling
 * set with running data).
 */
export function sameFamily(a: string, b: string): boolean {
  return cardioFamily(a) === cardioFamily(b);
}

/**
 * Among manual cardio set candidates, return the id of the one whose effective
 * duration (`durationSeconds ?? reps*60 ?? Infinity`) is closest to the Apple
 * workout duration (locked decision #2). Ties break to the lowest id. Empty
 * list → null.
 */
export function pickClosestSetByDuration(
  candidates: Array<{ id: number; durationSeconds: number | null; reps: number | null }>,
  appleDurationSec: number,
): number | null {
  if (candidates.length === 0) return null;

  let bestId: number | null = null;
  let bestDelta = Infinity;

  for (const c of candidates) {
    const effective =
      c.durationSeconds != null ? c.durationSeconds : c.reps != null ? c.reps * 60 : Infinity;
    const delta = Math.abs(effective - appleDurationSec);
    if (delta < bestDelta || (delta === bestDelta && (bestId == null || c.id < bestId))) {
      bestDelta = delta;
      bestId = c.id;
    }
  }

  return bestId;
}
