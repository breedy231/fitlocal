import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface ParsedExercise {
  name: string;
  sets: number;
  reps: string; // '15', '8 - 10', 'AMRAP', '60 sec', etc.
  restSeconds: number | null;
  notes: string | null;
}

export interface ParsedDay {
  name: string;
  musclesFocus: string | null;
  exercises: ParsedExercise[];
}

export interface ParsedProgram {
  name: string;
  description: string | null;
  daysPerWeek: number | null;
  durationWeeks: number | null;
  source: string | null;
  days: ParsedDay[];
}

function parseRestSeconds(rest: string): number | null {
  if (!rest || rest === 'N/A') return null;
  const nums = rest.match(/\d+/g);
  if (!nums) return null;
  return parseInt(nums[nums.length - 1]);
}

// Lines that are NOT exercise names
const NOT_EXERCISE = /^(Exercise|Sets|Reps|Rep Goal|Rest|Total|N\/A|MUSCLEANDSTRENGTH)$/i;
const REP_RANGE = /^\d+\s*[-–]\s*\d+$/;
const DURATION_PATTERN = /^\d+\s*(sec|min)/i;
const DAY_LABEL = /^Day\s+\d+$/i;
// Match split labels like "Upper A", "Lower B" — must be exactly the label word + optional single letter
const SPLIT_LABEL = /^(Upper|Lower|Push|Pull|Legs|Chest|Back|Shoulders|Arms|Full Body)\s?[A-Z]?$/;

export function parseMASPdf(pdfBuffer: Buffer): ParsedProgram {
  const tmpPath = join(tmpdir(), `fitlocal-pdf-${Date.now()}.pdf`);
  writeFileSync(tmpPath, pdfBuffer);

  let text: string;
  try {
    text = execSync(`pdftotext "${tmpPath}" -`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Extract metadata
  let name = '';
  let description: string | null = null;
  let daysPerWeek: number | null = null;
  let durationWeeks: number | null = null;
  let source: string | null = null;

  for (const line of lines) {
    if (line.startsWith('Link to Workout:')) source = line.replace('Link to Workout:', '').trim();
    if (line.startsWith('Days Per Week:')) { const m = line.match(/(\d+)/); if (m) daysPerWeek = parseInt(m[1]); }
    if (line.startsWith('Program Duration:')) { const m = line.match(/(\d+)/); if (m) durationWeeks = parseInt(m[1]); }
  }

  // Find program title
  const BOILERPLATE = /^(Store|Workouts|Diet Plans|Expert Guides|Videos|Tools|THE TOOLS|®|THE BODY|Link to|Main Goal|Training Level|Program Duration|Days Per Week|Time Per|Equipment:|Author:)/i;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    if (BOILERPLATE.test(line)) continue;
    if (line.match(/muscleandstrength\.com/i)) continue;
    if (line.length > 5 && !name) {
      name = line;
      if (i + 1 < lines.length && !BOILERPLATE.test(lines[i + 1]) && lines[i + 1].length > 20) {
        description = lines[i + 1];
      }
      break;
    }
  }

  // Strategy: pdftotext may put all exercise tables first, then day labels at the bottom.
  // Split exercise tables by "Exercise" + "Sets" + "Reps" header sequences.
  // Each occurrence of this header starts a new day's table.

  // Collect day names from the bottom of the document (Day N + optional split label)
  const dayNames: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (DAY_LABEL.test(lines[i])) {
      let label = lines[i];
      // Check if next line is a split label (Upper A, Lower B, etc.)
      if (i + 1 < lines.length && SPLIT_LABEL.test(lines[i + 1])) {
        label += ' — ' + lines[i + 1];
      }
      dayNames.push(label);
    }
  }

  // Find all table start positions.
  // pdftotext may output: "Exercise" + "Sets" + "Reps" for the first table,
  // but only "Sets" + "Reps" for subsequent tables (no "Exercise" keyword).
  const tableStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^(Exercise|Sets)$/i.test(lines[i])) {
      // Check if "Sets" and "Reps" appear within the next 1-3 lines
      let hasSets = /^Sets$/i.test(lines[i]);
      let hasReps = false;
      for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
        if (/^Sets$/i.test(lines[j])) hasSets = true;
        if (/^Reps$/i.test(lines[j])) hasReps = true;
      }
      if (hasSets && hasReps) {
        tableStarts.push(i);
        // Skip past the header lines so we don't double-detect
        i += 2;
      }
    }
  }

  // If no table headers found, fall back to looking for "Day N" before exercise data
  if (tableStarts.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      if (DAY_LABEL.test(lines[i])) tableStarts.push(i);
    }
  }

  // Parse exercise rows between table starts
  const days: ParsedDay[] = [];

  for (let t = 0; t < tableStarts.length; t++) {
    let i = tableStarts[t];

    // Skip past the header lines (Exercise, Sets, Reps)
    while (i < lines.length && /^(Exercise|Sets|Reps|Rep Goal|Rest|Total)$/i.test(lines[i])) {
      i++;
    }

    // End is either the next table start or end of exercise data
    const end = t + 1 < tableStarts.length ? tableStarts[t + 1] : lines.length;

    const exercises: ParsedExercise[] = [];

    while (i < end) {
      const line = lines[i];

      // Stop if we hit day labels section at the bottom
      if (DAY_LABEL.test(line) && !exercises.length) break;
      if (DAY_LABEL.test(line) || SPLIT_LABEL.test(line) || /^MUSCLEANDSTRENGTH/i.test(line)) {
        i++;
        continue;
      }

      if (line.startsWith('*')) { i++; continue; }

      const exercise = tryParseExerciseRow(lines, i, end);
      if (exercise) {
        exercises.push(exercise.exercise);
        i = exercise.nextIndex;
      } else {
        i++;
      }
    }

    if (exercises.length > 0) {
      // Use collected day name, or generate one
      const dayName = dayNames[t] || `Day ${t + 1}`;
      days.push({ name: dayName, musclesFocus: null, exercises });
    }
  }

  return { name, description, daysPerWeek, durationWeeks, source, days };
}

interface ExerciseParseResult {
  exercise: ParsedExercise;
  nextIndex: number;
}

function tryParseExerciseRow(lines: string[], startIdx: number, endIdx: number): ExerciseParseResult | null {
  let i = startIdx;
  const line = lines[i];

  if (!line || line.length < 3) return null;
  if (NOT_EXERCISE.test(line)) return null;
  if (/^\d+$/.test(line)) return null;
  if (DURATION_PATTERN.test(line)) return null;
  if (REP_RANGE.test(line)) return null;
  if (DAY_LABEL.test(line)) return null;
  if (SPLIT_LABEL.test(line)) return null;

  let exerciseName = line;
  i++;

  // Continuation: "(Dumbbell, Rope, or EZ Bar)"
  if (i < endIdx && lines[i].startsWith('(') && !lines[i].match(/^\(\d/)) {
    exerciseName += ' ' + lines[i];
    i++;
  }

  let sets: number | null = null;
  let reps: string | null = null;
  let restSeconds: number | null = null;
  let notes: string | null = null;

  const remaining: string[] = [];
  while (i < endIdx && remaining.length < 4) {
    const l = lines[i];
    if (NOT_EXERCISE.test(l)) break; // hit next table header
    if (DAY_LABEL.test(l)) break;
    if (SPLIT_LABEL.test(l)) break;
    if (/^MUSCLEANDSTRENGTH/i.test(l)) break;
    if (l.startsWith('*')) break;
    // If it looks like another exercise name (has letters, not a number/time/range)
    if (!l.match(/^\d/) && !DURATION_PATTERN.test(l) && !REP_RANGE.test(l) && !/^AMRAP|AMQRAP$/i.test(l) && /[a-zA-Z]{2,}/.test(l)) break;
    remaining.push(l);
    i++;
  }

  for (const val of remaining) {
    if (sets === null && /^\d+$/.test(val)) {
      sets = parseInt(val);
    } else if (reps === null && /^\d+$/.test(val)) {
      reps = val;
    } else if (reps === null && REP_RANGE.test(val)) {
      reps = val;
    } else if (reps === null && /AMRAP|AMQRAP/i.test(val)) {
      reps = 'AMRAP';
    } else if (reps === null && DURATION_PATTERN.test(val)) {
      reps = val;
    } else if (/\d+\s*([-–]\s*\d+\s*)?(sec|min)/i.test(val) && reps !== null) {
      restSeconds = parseRestSeconds(val);
    }
  }

  if (sets === null) return null;

  if (exerciseName.endsWith('*')) {
    exerciseName = exerciseName.replace(/\*+$/, '').trim();
    notes = 'Back-off set: 20% less weight';
  }

  return {
    exercise: { name: exerciseName, sets, reps: reps || '10', restSeconds, notes },
    nextIndex: i,
  };
}
