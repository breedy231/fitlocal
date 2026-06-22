/**
 * Selection of the best exercise description from wger API candidates.
 *
 * wger returns a mix of (a) non-English translations, (b) instructional
 * how-to text, and (c) general marketing/info blurbs. We prefer English,
 * instructional descriptions. See GitHub issue #2.
 *
 * Pure functions, no dependencies — consumed by the enrichment path
 * (packages/api/src/enrich-exercises.ts).
 */

/**
 * True if `text` is predominantly Latin-script (English-compatible).
 *
 * Counts ALL letters (via \p{L}) as the denominator and treats any letter
 * with a code point above the Latin blocks (> U+024F: covers Latin Extended-B)
 * as non-Latin. Accented Latin letters (À-ÿ, Latin Extended-A/B) stay allowed.
 * Returns false if >10% of letters are non-Latin, or if there are no letters.
 */
export function isLatinText(text: string): boolean {
  if (!text.trim()) return false;

  const letters = text.match(/\p{L}/gu);
  if (!letters) return false;

  const nonLatin = letters.filter((ch) => (ch.codePointAt(0) ?? 0) > 0x024f);
  return nonLatin.length / letters.length <= 0.1;
}

/**
 * Instructional cue words — imperative motion verbs that signal how-to text.
 * Deliberately excludes exercise-noun verbs (press/push/pull/extend/row) that
 * routinely appear in general-info blurbs ("The bench press is a compound...").
 */
const INSTRUCTIONAL_PATTERN =
  /\b(keep|lower|raise|hold|place|stand|sit|bend|squeeze|grip|lean|tuck|brace|exhale|inhale|slowly)\b/i;

/**
 * True if `text` contains at least one instructional keyword as a whole word.
 */
export function isInstructional(text: string): boolean {
  return INSTRUCTIONAL_PATTERN.test(text);
}

/**
 * Pick the best description from already-HTML-stripped candidate strings.
 *
 * 1. Trim and drop empty candidates.
 * 2. Keep only Latin-script (English-compatible) candidates.
 * 3. Return the first instructional candidate if any.
 * 4. Otherwise the first Latin candidate.
 * 5. null if nothing usable remains.
 */
export function pickBestDescription(candidates: string[]): string | null {
  const latin = candidates
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .filter(isLatinText);

  if (latin.length === 0) return null;

  return latin.find(isInstructional) ?? latin[0];
}
