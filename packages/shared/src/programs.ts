/**
 * Program (multi-week training plan) response shapes.
 */

import type { ProgressionDirective, RepRange } from './exercises.js';

export interface ProgramExercise {
  id: number;
  programDayId: number;
  exerciseName: string;
  exerciseId: number | null;
  displayOrder: number;
  targetSets: number | null;
  targetReps: string | null;
  restSeconds: number | null;
  notes: string | null;
}

export interface ProgramDay {
  id: number;
  programId: number;
  name: string;
  dayOrder: number;
  musclesFocus: string | null;
}

export interface ProgramDayWithExercises extends ProgramDay {
  exercises: ProgramExercise[];
}

export interface Program {
  id: number;
  name: string;
  description: string | null;
  daysPerWeek: number | null;
  durationWeeks: number | null;
  source: string | null;
  cardioPlan: { week: number; sessions: number[] }[] | null;
  createdAt: string;
}

/** GET /programs — list item. */
export interface ProgramListItem extends Program {
  dayCount: number;
}

/** GET /programs/:id — full structure. */
export interface ProgramDetail extends Program {
  days: ProgramDayWithExercises[];
}

/** One program exercise enriched with progression for the active-program day. */
export interface ActiveProgramExercise extends ProgramExercise {
  progression: ProgressionDirective | null;
  suggestedWeightKg: number | null;
  suggestedReps: number | null;
  repRange: RepRange | null;
  isEstimate: boolean;
}

/** GET /programs/active */
export interface ActiveProgram {
  program: { id: number; name: string };
  dayIndex: number;
  totalDays: number;
  day: ProgramDay & { exercises: ActiveProgramExercise[] };
  cardio: {
    week: number;
    sessions: number[];
    completedThisWeek: number;
  } | null;
}

/** POST /programs/:id/activate */
export interface ActiveProgramActivateResponse {
  active: {
    id: number;
    programId: number;
    startDate: string;
    currentDayIndex: number;
  };
  program: Program;
}

/** POST /programs/active/advance */
export interface ActiveProgramAdvanceResponse {
  dayIndex: number;
  totalDays: number;
}

/** POST /programs/import-pdf and /programs/import-json */
export interface ProgramImportResponse {
  id: number;
  name: string;
  daysImported: number;
  exercisesImported: number;
  days?: { name: string; musclesFocus: string | null; exerciseCount: number }[];
}
