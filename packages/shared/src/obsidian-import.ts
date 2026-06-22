/**
 * Parser for the "Obsidian format" workout block — the same text FitLocal emits
 * for pasting into Obsidian. Turns it back into structured data for import (#35).
 *
 * Units are kept as written (lbs / miles / minutes) and RIR as RIR — the import
 * endpoint converts to the DB's metric + rpe at the boundary.
 *
 * Drafted by the local LLM (qwen3-coder) then corrected: the draft misparsed
 * cardio lines as exercises, applied RIR to only the first set, and never set
 * the warmup flag. This version classifies each line by pattern instead.
 */

export interface ParsedSet {
  reps?: number;
  weightLbs?: number;
  isWarmup?: boolean;
  rir?: number;
  durationMin?: number;
  distanceMi?: number;
}

export interface ParsedExercise {
  name: string;
  sets: ParsedSet[];
}

export interface ParsedWorkout {
  date: string | null;
  notes: string | null;
  exercises: ParsedExercise[];
}

// "3 sets x 8 reps x 135 lbs"  |  "3 sets x 15 reps" (bodyweight)
const WORKING_RE = /^(\d+)\s*sets?\s*x\s*(\d+)\s*reps?(?:\s*x\s*([\d.]+)\s*lbs?)?\s*$/i;
// "8 reps x 95 lbs" — a single set line (warmup when it precedes the working line)
const SINGLE_RE = /^(\d+)\s*reps?\s*x\s*([\d.]+)\s*lbs?\s*$/i;
// "1 reps in reserve" / "2 RIR"
const RIR_RE = /^(\d+)\s*(?:reps?\s+in\s+reserve|rir)\b/i;
// cardio: "48 mins", "4.45 mi"
const MINS_RE = /^([\d.]+)\s*min(?:ute)?s?\b/i;
const MILES_RE = /^([\d.]+)\s*mi(?:les?)?\b/i;
// lines we intentionally ignore as set data (e.g. "1.0 incline")
const IGNORE_RE = /^[\d.]+\s*incline\b/i;
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

/** Apply an RIR value to the working (non-warmup) sets of an exercise. */
function applyRir(ex: ParsedExercise, rir: number): void {
  for (const set of ex.sets) {
    if (!set.isWarmup && set.reps !== undefined) set.rir = rir;
  }
}

export function parseObsidianWorkout(text: string): ParsedWorkout {
  const lines = text.split('\n').map((l) => l.trim());

  let date: string | null = null;
  let notes: string | null = null;
  const exercises: ParsedExercise[] = [];
  let current: ParsedExercise | null = null;

  // First non-empty line is the title (day name and/or date).
  let started = false;
  for (const line of lines) {
    if (!line) continue;

    if (!started) {
      started = true;
      notes = line;
      const m = line.match(DATE_RE);
      date = m ? m[1] : null;
      continue;
    }

    if (IGNORE_RE.test(line)) continue;

    let m: RegExpMatchArray | null;

    if ((m = line.match(WORKING_RE))) {
      const numSets = parseInt(m[1], 10);
      const reps = parseInt(m[2], 10);
      const weightLbs = m[3] !== undefined ? parseFloat(m[3]) : undefined;
      if (!current) current = { name: 'Unknown', sets: [] };
      for (let i = 0; i < numSets; i++) {
        const set: ParsedSet = { reps };
        if (weightLbs !== undefined) set.weightLbs = weightLbs;
        current.sets.push(set);
      }
      continue;
    }

    if ((m = line.match(RIR_RE))) {
      if (current) applyRir(current, parseInt(m[1], 10));
      continue;
    }

    if ((m = line.match(MINS_RE))) {
      if (current) current.sets.push({ durationMin: parseFloat(m[1]) });
      continue;
    }

    if ((m = line.match(MILES_RE))) {
      if (current) current.sets.push({ distanceMi: parseFloat(m[1]) });
      continue;
    }

    // A bare "reps x lbs" line is a warmup set when it appears before the
    // working line (i.e. no sets logged for this exercise yet).
    if ((m = line.match(SINGLE_RE)) && current && current.sets.length === 0) {
      current.sets.push({
        reps: parseInt(m[1], 10),
        weightLbs: parseFloat(m[2]),
        isWarmup: true,
      });
      continue;
    }

    // Anything else starts a new exercise.
    if (current) exercises.push(current);
    current = { name: line, sets: [] };
  }

  if (current) exercises.push(current);
  return { date, notes, exercises };
}
