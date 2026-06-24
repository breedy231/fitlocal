/**
 * Canonical stretching / mobility / foam-rolling exercise name pattern.
 *
 * These are warm-up and cooldown movements — not trained lifts — so they should
 * be excluded from training reports (frequency, volume, muscle distribution,
 * PRs, progression). Unlike strength exercises they carry no weight, and most
 * have no muscle tags, so the name is the only reliable signal.
 *
 * The DB names give no structural tag, so this is a curated pattern validated
 * against the full exercise table. It must stay conservative — loaded or
 * conditioning movements that happen to share a word are deliberately kept:
 *   - "Bird Dog Rows" (weighted) stays — `bird dog` requires no trailing "row"
 *   - "Kettlebell Swing" / "Dumbbell Hang Snatch" / "Weighted Wall Sit" /
 *     "Bear Crawl" are strength/conditioning and never matched.
 * `\bcircle` covers arm/ankle/hip/leg circles; "(up|down)ward? dog" covers the
 * yoga poses; `\bpose\b` covers child's/pigeon/crab/cobra poses.
 *
 * Single source of truth — imported by:
 *   - packages/api/src/routes/reports.ts
 */
export const MOBILITY_PATTERN =
  /stretch|foam roll|cat[\s-]?cow|child'?s pose|(?:up|down)(?:ward)? dog|cobra pose|\bpigeon\b|\bcrab pose\b|\bpose\b|\bcircle|leg swing|\binchworm\b|world'?s greatest|thread the needle|90\/90|\bscorpion\b|dead hang|hip flexor|bird dog(?!\s*row)/i;
