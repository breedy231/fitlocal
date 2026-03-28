import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface ParsedExercise {
  name: string;
  sets: number;
  reps: string; // '15', 'AMRAP', etc.
  restSeconds: number | null;
  notes: string | null;
}

export interface ParsedDay {
  name: string; // 'Push A', 'Pull B', etc.
  musclesFocus: string | null; // 'Chest, Shoulders & Triceps'
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
  // '90 - 120 sec' → take the higher value
  const nums = rest.match(/\d+/g);
  if (!nums) return null;
  return parseInt(nums[nums.length - 1]);
}

// Known M&S day headers — lines that start a new workout day
const DAY_PATTERN = /^(Push|Pull|Legs|Upper|Lower|Chest|Back|Shoulders|Arms|Full Body|Day)\s*[A-Z0-9]?$/i;

// Muscle focus lines that follow exercise tables
const MUSCLE_FOCUS_PATTERN = /^(Chest|Back|Shoulders|Quads|Hamstrings|Arms|Biceps|Triceps|Calves|Traps|Glutes|Core|Legs)[,\s&]+/i;

export function parseMASPdf(pdfBuffer: Buffer): ParsedProgram {
  // Write buffer to temp file, run pdftotext, read output
  const tmpPath = join(tmpdir(), `fitlocal-pdf-${Date.now()}.pdf`);
  writeFileSync(tmpPath, pdfBuffer);

  let text: string;
  try {
    text = execSync(`pdftotext "${tmpPath}" -`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Extract program metadata from header
  let name = '';
  let description: string | null = null;
  let daysPerWeek: number | null = null;
  let durationWeeks: number | null = null;
  let source: string | null = null;

  for (const line of lines) {
    if (line.startsWith('Link to Workout:')) {
      source = line.replace('Link to Workout:', '').trim();
    }
    if (line.startsWith('Days Per Week:')) {
      const m = line.match(/(\d+)/);
      if (m) daysPerWeek = parseInt(m[1]);
    }
    if (line.startsWith('Program Duration:')) {
      const m = line.match(/(\d+)/);
      if (m) durationWeeks = parseInt(m[1]);
    }
  }

  // Find the program title — typically the largest text block before metadata
  // Look for ALL CAPS or multi-word title before the first day
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    // Skip nav items and short labels
    if (['Store', 'Workouts', 'Diet Plans', 'Expert Guides', 'Videos', 'Tools'].includes(line)) continue;
    if (line.startsWith('THE TOOLS') || line.startsWith('®') || line.startsWith('THE BODY')) continue;
    if (line.startsWith('Link to') || line.startsWith('Main Goal') || line.startsWith('Training Level')) continue;
    if (line.startsWith('Program Duration') || line.startsWith('Days Per Week') || line.startsWith('Time Per')) continue;
    if (line.startsWith('Equipment:') || line.startsWith('Author:')) continue;
    if (line.match(/muscleandstrength\.com/i)) continue;

    // Title is usually the first substantial non-boilerplate line
    if (line.length > 5 && !name) {
      name = line;
      // Check if next line continues the title or is a description
      if (i + 1 < lines.length && !lines[i + 1].startsWith('Link to') && !lines[i + 1].match(/^(Main Goal|Training|Program|Days|Time|Equipment|Author)/)) {
        const next = lines[i + 1];
        if (next.length > 20 && !DAY_PATTERN.test(next)) {
          description = next;
        }
      }
      break;
    }
  }

  // Parse workout days
  const days: ParsedDay[] = [];
  let i = 0;

  while (i < lines.length) {
    // Look for day headers
    if (DAY_PATTERN.test(lines[i]) || isCustomDayHeader(lines, i)) {
      const dayName = lines[i];
      i++;

      // Skip the table header row (Exercise, Sets, ...)
      if (i < lines.length && lines[i] === 'Exercise') {
        i++;
        // Skip column headers (Sets, Rep Goal Total, Rest, Reps, etc.)
        while (i < lines.length && /^(Sets|Reps|Rep Goal|Rest|Total)$/i.test(lines[i])) {
          i++;
        }
      }

      const exercises: ParsedExercise[] = [];
      let musclesFocus: string | null = null;

      // Parse exercise rows until we hit next day, footnotes, or muscle focus
      while (i < lines.length) {
        const line = lines[i];

        // Stop conditions
        if (DAY_PATTERN.test(line) || isCustomDayHeader(lines, i)) break;
        if (line.match(/^MUSCLEANDSTRENGTH/i)) break;

        // Muscle focus line
        if (MUSCLE_FOCUS_PATTERN.test(line) && !line.match(/^\d/)) {
          musclesFocus = line;
          i++;
          continue;
        }

        // Skip footnotes
        if (line.startsWith('*') || line.startsWith('**')) {
          i++;
          continue;
        }

        // Try to parse as an exercise row
        // Exercise names are followed by sets (number), reps (number or AMRAP), rest (time)
        const exercise = tryParseExerciseRow(lines, i);
        if (exercise) {
          exercises.push(exercise.exercise);
          i = exercise.nextIndex;
        } else {
          i++;
        }
      }

      if (exercises.length > 0) {
        days.push({ name: dayName, musclesFocus, exercises });
      }
    } else {
      i++;
    }
  }

  return { name, description, daysPerWeek, durationWeeks, source, days };
}

function isCustomDayHeader(lines: string[], i: number): boolean {
  // A day header is typically followed by 'Exercise' on the next line
  if (i + 1 >= lines.length) return false;
  return lines[i + 1] === 'Exercise' && !lines[i].match(/^\d/) && lines[i].length < 40;
}

interface ExerciseParseResult {
  exercise: ParsedExercise;
  nextIndex: number;
}

function tryParseExerciseRow(lines: string[], startIdx: number): ExerciseParseResult | null {
  // The M&S PDF format puts exercise name on one line (possibly spanning two if long),
  // followed by sets (number), reps (number/text), rest (time string) on subsequent lines.
  let i = startIdx;
  const line = lines[i];

  // Skip non-exercise lines
  if (!line || line.length < 3) return null;
  if (/^(Exercise|Sets|Reps|Rep Goal|Rest|Total|N\/A)$/i.test(line)) return null;
  if (/^\d+$/.test(line)) return null; // bare number
  if (line.match(/^\d+\s*(sec|min)/i)) return null; // bare rest time

  // The exercise name should not be purely numeric or a known header
  let exerciseName = line;
  i++;

  // Check if next line is a continuation of the name (e.g. "(Dumbbell, Rope, or EZ Bar)")
  if (i < lines.length && lines[i].startsWith('(') && !lines[i].match(/^\(\d/)) {
    exerciseName += ' ' + lines[i];
    i++;
  }

  // Now expect: sets (number), reps (number/AMRAP), rest (time)
  let sets: number | null = null;
  let reps: string | null = null;
  let restSeconds: number | null = null;
  let notes: string | null = null;

  // Collect next few values
  const remaining: string[] = [];
  while (i < lines.length && remaining.length < 4) {
    const l = lines[i];
    if (DAY_PATTERN.test(l) || isCustomDayHeader(lines, i)) break;
    if (MUSCLE_FOCUS_PATTERN.test(l)) break;
    if (l.startsWith('*')) break;
    // If it looks like another exercise name (long text, not a number/time)
    if (l.length > 15 && !l.match(/^\d/) && !l.match(/sec|min|N\/A|AMRAP|AMQRAP/i)) break;
    remaining.push(l);
    i++;
  }

  // Parse the collected values
  for (const val of remaining) {
    if (sets === null && /^\d+$/.test(val)) {
      sets = parseInt(val);
    } else if (reps === null && /^\d+$/.test(val)) {
      reps = val;
    } else if (reps === null && /AMRAP|AMQRAP/i.test(val)) {
      reps = 'AMRAP';
    } else if (/\d+\s*([-–]\s*\d+\s*)?(sec|min)/i.test(val) || val === 'N/A') {
      restSeconds = parseRestSeconds(val);
    }
  }

  // Must have at least sets to count as a valid exercise
  if (sets === null) return null;

  // Handle AMRAP lines with notes
  if (exerciseName.endsWith('*')) {
    exerciseName = exerciseName.replace(/\*+$/, '').trim();
    notes = 'Back-off set: 20% less weight';
  }

  return {
    exercise: {
      name: exerciseName,
      sets,
      reps: reps || '10',
      restSeconds,
      notes,
    },
    nextIndex: i,
  };
}
