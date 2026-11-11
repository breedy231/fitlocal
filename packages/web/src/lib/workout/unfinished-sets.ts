// Decides what "Finish Workout" does about sets that were never ticked done.
// Kept pure so the rules are unit-tested without the page.

export interface FinishSet {
  id: number;
  completed?: boolean | null;
}

export interface FinishExercise {
  id: number;
  isCardio: boolean;
  sets: FinishSet[];
}

export interface FinishPlan {
  /** Strength sets not marked done (what the confirmation sheet counts). */
  unfinishedSetCount: number;
  /** Exercises with at least one unfinished set. */
  unfinishedExerciseCount: number;
  /** Sets that remain once the unfinished ones are removed. */
  completedSetCount: number;
  /** "Remove": delete just these sets (their exercise keeps other done sets). */
  removeSetIds: number[];
  /** "Remove": delete these whole exercises (every set was unfinished). */
  removeExerciseIds: number[];
  /**
   * Cardio sets that were never ticked. They are not counted as unfinished
   * (cardio is often run without tapping the check) and are marked done on
   * finish in both branches, so the workout never reads as active (#73).
   */
  autoCompleteSetIds: number[];
}

export function planFinish(exercises: FinishExercise[]): FinishPlan {
  const plan: FinishPlan = {
    unfinishedSetCount: 0,
    unfinishedExerciseCount: 0,
    completedSetCount: 0,
    removeSetIds: [],
    removeExerciseIds: [],
    autoCompleteSetIds: [],
  };

  for (const ex of exercises) {
    if (ex.isCardio) {
      for (const s of ex.sets) {
        if (!s.completed) plan.autoCompleteSetIds.push(s.id);
        plan.completedSetCount++;
      }
      continue;
    }
    const unfinished = ex.sets.filter((s) => !s.completed);
    plan.completedSetCount += ex.sets.length - unfinished.length;
    if (unfinished.length === 0) continue;
    plan.unfinishedSetCount += unfinished.length;
    plan.unfinishedExerciseCount++;
    if (unfinished.length === ex.sets.length) plan.removeExerciseIds.push(ex.id);
    else plan.removeSetIds.push(...unfinished.map((s) => s.id));
  }
  return plan;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 sets across 2 exercises aren't marked done." */
export function unfinishedSummary(plan: Pick<FinishPlan, 'unfinishedSetCount' | 'unfinishedExerciseCount'>): string {
  const { unfinishedSetCount: s, unfinishedExerciseCount: e } = plan;
  return `${pluralize(s, 'set')} across ${pluralize(e, 'exercise')} ${s === 1 ? "isn't" : "aren't"} marked done.`;
}
