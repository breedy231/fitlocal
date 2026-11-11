import { describe, it, expect } from 'vitest';
import { planFinish, unfinishedSummary, type FinishExercise } from './unfinished-sets';

const ex = (id: number, isCardio: boolean, done: boolean[]): FinishExercise => ({
  id,
  isCardio,
  sets: done.map((c, i) => ({ id: id * 10 + i, completed: c })),
});

describe('planFinish', () => {
  it('everything done: nothing unfinished', () => {
    const p = planFinish([ex(1, false, [true, true]), ex(2, false, [true])]);
    expect(p).toMatchObject({ unfinishedSetCount: 0, unfinishedExerciseCount: 0, completedSetCount: 3 });
    expect(p.removeSetIds).toEqual([]);
    expect(p.removeExerciseIds).toEqual([]);
  });

  it('partially done exercise: remove only its unfinished sets', () => {
    const p = planFinish([ex(1, false, [true, false, false])]);
    expect(p.unfinishedSetCount).toBe(2);
    expect(p.unfinishedExerciseCount).toBe(1);
    expect(p.removeSetIds).toEqual([11, 12]);
    expect(p.removeExerciseIds).toEqual([]);
  });

  it('exercise with no done sets is removed whole, not set by set', () => {
    const p = planFinish([ex(1, false, [false, false, false]), ex(2, false, [true])]);
    expect(p.removeExerciseIds).toEqual([1]);
    expect(p.removeSetIds).toEqual([]);
    expect(p.unfinishedSetCount).toBe(3);
    expect(p.completedSetCount).toBe(1);
  });

  it('counts sets across exercises', () => {
    const p = planFinish([ex(1, false, [true, false]), ex(2, false, [false, false]), ex(3, false, [true])]);
    expect(p.unfinishedSetCount).toBe(3);
    expect(p.unfinishedExerciseCount).toBe(2);
  });

  it('cardio sets are never unfinished; unticked ones are auto-completed', () => {
    const p = planFinish([ex(1, true, [false]), ex(2, false, [true, true])]);
    expect(p.unfinishedSetCount).toBe(0);
    expect(p.autoCompleteSetIds).toEqual([10]);
    expect(p.removeSetIds).toEqual([]);
    expect(p.removeExerciseIds).toEqual([]);
  });

  it('cardio-only workout never triggers the sheet', () => {
    expect(planFinish([ex(1, true, [false, false])]).unfinishedSetCount).toBe(0);
  });

  it('treats null/undefined completed as not done', () => {
    const p = planFinish([{ id: 1, isCardio: false, sets: [{ id: 5, completed: null }, { id: 6 }, { id: 7, completed: true }] }]);
    expect(p.removeSetIds).toEqual([5, 6]);
  });

  it('exercise with no sets is left alone', () => {
    const p = planFinish([ex(1, false, [])]);
    expect(p.unfinishedSetCount).toBe(0);
    expect(p.removeExerciseIds).toEqual([]);
  });

  it('nothing done at all: completedSetCount is 0', () => {
    expect(planFinish([ex(1, false, [false])]).completedSetCount).toBe(0);
  });
});

describe('unfinishedSummary', () => {
  it('pluralizes', () => {
    expect(unfinishedSummary({ unfinishedSetCount: 3, unfinishedExerciseCount: 2 })).toBe("3 sets across 2 exercises aren't marked done.");
    expect(unfinishedSummary({ unfinishedSetCount: 1, unfinishedExerciseCount: 1 })).toBe("1 set across 1 exercise isn't marked done.");
  });
});
