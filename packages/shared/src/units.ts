// Unit conversion helpers. The database stores kilograms and meters; the UI
// works in pounds and miles. Convert at the boundary using these helpers
// rather than scattering magic factors across the codebase.

export const LBS_TO_KG = 0.45359237;
export const KG_TO_LBS = 2.2046226218;
export const MILES_TO_METERS = 1609.344;
export const METERS_TO_MILES = 0.0006213711922;

/** Pounds → kilograms. */
export function lbsToKg(lbs: number): number {
  return lbs * LBS_TO_KG;
}

/** Kilograms → pounds. */
export function kgToLbs(kg: number): number {
  return kg * KG_TO_LBS;
}

/** Miles → meters. */
export function milesToMeters(mi: number): number {
  return mi * MILES_TO_METERS;
}

/** Meters → miles. */
export function metersToMiles(m: number): number {
  return m * METERS_TO_MILES;
}
