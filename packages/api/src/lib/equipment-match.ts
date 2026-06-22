// Equipment eligibility: an exercise is eligible at a location only when every
// tag it REQUIRES (from classifyEquipment, stored on exercises.equipment) is
// available at that location. Empty required set = bodyweight/outdoor = always
// eligible. See equipment-classifier.ts and GitHub #33.

/** Legacy/profile equipment terms that expand to canonical classifier tags. */
export const EQUIPMENT_ALIASES: Record<string, string[]> = {
  trx: ['suspension'],
  cardio: ['treadmill', 'elliptical', 'stationary-bike', 'rowing-machine', 'stair-stepper'],
};

/**
 * Normalize a profile's available-equipment list: lowercase/trim each entry and
 * expand legacy aliases (e.g. `trx` → `suspension`). Returns a de-duped Set,
 * ready to pass to matchesEquipment. `bodyweight` carries through harmlessly —
 * bodyweight exercises require nothing and match regardless.
 */
export function normalizeAvailableEquipment(available: string[]): Set<string> {
  const out = new Set<string>();
  for (const item of available) {
    const norm = item.toLowerCase().trim();
    if (!norm) continue;
    out.add(norm);
    for (const alias of EQUIPMENT_ALIASES[norm] ?? []) out.add(alias);
  }
  return out;
}

/**
 * True iff every tag in `required` is in `available` (a normalized Set from
 * normalizeAvailableEquipment). Empty `required` is always eligible.
 */
export function matchesEquipment(required: string[], available: Set<string>): boolean {
  if (required.length === 0) return true;
  return required.every((tag) => available.has(tag));
}
