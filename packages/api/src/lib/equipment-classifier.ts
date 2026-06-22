// Infers structured equipment tags from an exercise name.
//
// Background: exercises were imported from Fitbod with no equipment metadata
// (`equipment` is `[]` for every row). The workout generator historically
// matched a profile's available equipment against the exercise *name* via a
// loose regex, which is too crude — "dumbbell" matched "Dumbbell Incline Bench
// Press" even at a location with only a flat bench. See GitHub #33.
//
// This classifier produces the tag set an exercise *requires*. The generator's
// matchesEquipment() then treats an exercise as eligible only when its required
// tags are a subset of the profile's available equipment. Bodyweight exercises
// require nothing (empty set) and are therefore always eligible.
//
// Tags are intentionally a small, stable vocabulary (see EQUIPMENT_TAGS). When
// in doubt the classifier prefers under-tagging (fewer requirements) so an
// exercise stays eligible rather than being wrongly hidden — except for the
// bench distinction (flat vs incline vs decline), which is the whole point of
// the issue and is tagged precisely.

export const EQUIPMENT_TAGS = [
  'barbell',
  'dumbbell',
  'kettlebell',
  'cable',
  'machine',
  'smith-machine',
  'band',
  'suspension', // TRX-style suspension trainer
  'flat-bench',
  'incline-bench',
  'decline-bench',
  'pull-up-bar',
  'foam-roller',
  'stability-ball',
  'balance-trainer',
  'plate',
  'treadmill',
  'elliptical',
  'stationary-bike',
  'rowing-machine',
  'stair-stepper',
] as const;

export type EquipmentTag = (typeof EQUIPMENT_TAGS)[number];

const has = (s: string, re: RegExp) => re.test(s);

/**
 * Classify an exercise name into the set of equipment it requires.
 * Returns a de-duplicated, stably-ordered array. An empty array means the
 * exercise needs no equipment (bodyweight / outdoor) and is always eligible.
 */
export function classifyEquipment(name: string): EquipmentTag[] {
  const n = name.toLowerCase();
  const tags = new Set<EquipmentTag>();

  // --- Machine cardio (each its own piece of equipment) ---
  if (has(n, /\btreadmill\b/)) tags.add('treadmill');
  if (has(n, /\belliptical\b/)) tags.add('elliptical');
  if (has(n, /\bstair stepper\b/)) tags.add('stair-stepper');
  if (has(n, /\browing\b/)) tags.add('rowing-machine');
  if (has(n, /\bstationary\b/)) tags.add('stationary-bike');

  // --- Recovery / mobility tools ---
  if (has(n, /\bfoam roll/)) tags.add('foam-roller');
  if (has(n, /balance trainer/)) tags.add('balance-trainer');
  if (has(n, /exercise ball|stability ball|swiss ball/)) tags.add('stability-ball');

  // --- Free weights ---
  if (has(n, /\bdumbbell\b/)) tags.add('dumbbell');
  if (has(n, /\bkettlebell\b/)) tags.add('kettlebell');
  // Barbell family: barbell, EZ/SZ bar, T-bar, landmine all need a barbell + plates.
  if (has(n, /\bbarbell\b|\bez-?bar\b|\bt-bar\b|\blandmine\b/)) tags.add('barbell');
  if (has(n, /\bplate\b/)) tags.add('plate');

  // --- Machines & cable ---
  if (has(n, /smith machine/)) tags.add('smith-machine');
  if (has(n, /\bcable\b/)) tags.add('cable');
  // Selectorized / plate-loaded machines and assisted machines. Strip "smith
  // machine" first so it isn't double-counted as a generic machine too.
  const nNoSmith = n.replace(/smith machine/g, 'smith');
  if (
    has(
      nNoSmith,
      /\bmachine\b|hammerstrength|\bpulldown\b|pull down|leg press|leg extension|\bleg curl\b|hamstrings? curl|pec deck|\bassisted\b/,
    )
  ) {
    tags.add('machine');
  }

  // --- Bands & suspension ---
  if (has(n, /\bband\b|\bbanded\b/)) tags.add('band');
  if (has(n, /\btrx\b/)) tags.add('suspension');

  // --- Canonical free-weight movements that omit the implement in their name.
  // Fitbod names many staples ("Deadlift", "Back Squat") without the implement.
  // Tag the canonical implement so a dumbbell-only location doesn't wrongly
  // surface a barbell lift. Only applied when no implement was detected above.
  const noImplement = !['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'smith-machine', 'band', 'suspension'].some(
    (t) => tags.has(t as EquipmentTag),
  );
  if (noImplement) {
    if (has(n, /\bdeadlift\b|back squat|front squat|push press|good morning/)) {
      tags.add('barbell');
    } else if (
      has(n, /hammer curl|concentration curl|spider curl|zottman curl|waiter curl|arnold press|goblet squat|side laterals to front raise/)
    ) {
      tags.add('dumbbell');
    }
  }
  // A "bench press" with no detected implement is a barbell bench press.
  if (has(n, /bench press/) && !['dumbbell', 'machine', 'smith-machine', 'cable', 'kettlebell', 'band', 'suspension'].some((t) => tags.has(t as EquipmentTag))) {
    tags.add('barbell');
  }

  // --- Bench modifiers (the core of #33) ---
  // An incline/decline movement needs an adjustable bench set to that angle —
  // but only for free-weight movements. On a selectorized machine the angle is
  // built in, so don't demand a separate bench.
  if (!tags.has('machine')) {
    if (has(n, /\bincline\b/)) tags.add('incline-bench');
    if (has(n, /\bdecline\b/)) tags.add('decline-bench');
  }
  // A "bench press" or "bench dip" without an explicit angle needs a flat bench,
  // but a "floor press" explicitly does not, and a machine press has its own seat.
  if (
    !tags.has('incline-bench') &&
    !tags.has('decline-bench') &&
    !tags.has('machine') &&
    has(n, /bench press|bench dip/)
  ) {
    tags.add('flat-bench');
  }

  // --- Pull-up bar ---
  // Pull/chin ups need a bar — unless they're band- or machine-assisted, which
  // already added their own tag above.
  if (has(n, /pull up|pull-up|chin up|chin-up/) && !tags.has('machine') && !tags.has('band')) {
    tags.add('pull-up-bar');
  }

  // Preserve the canonical tag ordering for stable output.
  return EQUIPMENT_TAGS.filter((t) => tags.has(t));
}
