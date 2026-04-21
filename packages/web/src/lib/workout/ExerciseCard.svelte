<script lang="ts">
  import type { ExerciseProgressionReport } from 'fitlocal-shared';
  import SetRow, { type WorkoutSet } from './SetRow.svelte';
  import ExerciseHistoryPanel from './ExerciseHistoryPanel.svelte';

  type HistoryPoint = ExerciseProgressionReport['dataPoints'][number];

  // Local shape — the page composes workout state with client-only fields
  // (expanded, prWeightKg) so we accept a superset of the shared WorkoutExercise.
  export interface WorkoutExerciseLike {
    id: number;
    exerciseId: number;
    exercise: { id: number; name: string; primaryMuscles?: string[] };
    sets: WorkoutSet[];
    restSeconds?: number;
    expanded?: boolean;
    supersetGroup?: number | null;
    lastPerformance?: { sets: { reps: number; weightKg: number }[] } | null;
    prWeightKg?: number | null;
  }

  interface Props {
    ex: WorkoutExerciseLike;
    isCardio: boolean;
    isTreadmill: boolean;
    restEditing: boolean;
    historyState: HistoryPoint[] | 'loading' | undefined;
    kgToLbs: (kg: number | null) => number;
    lbsToKg: (lbs: number) => number;
    adjustReps: (set: WorkoutSet, delta: number) => void;
    adjustWeightLbs: (set: WorkoutSet, deltaLbs: number) => void;
    updateWeightLbs: (set: WorkoutSet, lbsStr: string) => void;
    onToggleComplete: (set: WorkoutSet) => void;
    onToggleExpanded: () => void;
    onOpenExerciseDetail: (exerciseId: number) => void;
    onEditRest: () => void;
    onUpdateRestSeconds: (seconds: number) => void;
    onOpenPlateCalc: (set: WorkoutSet) => void;
    onToggleHistory: () => void;
    onSwap: () => void;
    onRemove: () => void;
    onAddSet: () => void;
    onDeleteSet: (setId: number) => void;
    onSetRir: (rpe: number) => void;
  }

  let {
    ex,
    isCardio,
    isTreadmill,
    restEditing,
    historyState,
    kgToLbs,
    lbsToKg,
    adjustReps,
    adjustWeightLbs,
    updateWeightLbs,
    onToggleComplete,
    onToggleExpanded,
    onOpenExerciseDetail,
    onEditRest,
    onUpdateRestSeconds,
    onOpenPlateCalc,
    onToggleHistory,
    onSwap,
    onRemove,
    onAddSet,
    onDeleteSet,
    onSetRir,
  }: Props = $props();

  const REST_PRESETS = [30, 45, 60, 90, 120, 180];

  let allExDone = $derived(ex.sets.length > 0 && ex.sets.every(s => s.completed));
  let mode = $derived<'strength' | 'cardio' | 'treadmill'>(
    isTreadmill ? 'treadmill' : isCardio ? 'cardio' : 'strength'
  );
  let lastStrengthSet = $derived(ex.sets[ex.sets.length - 1]);
  let currentRir = $derived(
    lastStrengthSet && lastStrengthSet.rpe != null ? Math.round(10 - lastStrengthSet.rpe) : null
  );
</script>

<div
  class="w-full text-left p-4 flex justify-between items-center cursor-pointer {allExDone ? 'opacity-60' : ''}"
>
  <div class="flex items-center gap-2 min-w-0">
    {#if allExDone}
      <svg class="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
      </svg>
    {/if}
    <span class="font-medium truncate">
      <button
        onclick={(e) => { e.stopPropagation(); onOpenExerciseDetail(ex.exerciseId); }}
        class="underline decoration-neutral-600 underline-offset-2 hover:text-green-400 transition-colors"
      >{ex.exercise?.name ?? 'Exercise'}</button>
    </span>
    {#if !isCardio}
      <button
        onclick={(e) => { e.stopPropagation(); onEditRest(); }}
        class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-800 text-neutral-500 hover:text-neutral-300 shrink-0"
        title="Edit rest time"
      >{(ex.restSeconds ?? 60) >= 60 ? `${Math.round((ex.restSeconds ?? 60) / 60)}m` : `${ex.restSeconds}s`}</button>
    {/if}
  </div>
  <div class="flex items-center gap-1 shrink-0">
    {#if !isCardio}
      <button
        onclick={(e) => { e.stopPropagation(); const firstSet = ex.sets[0]; if (firstSet) onOpenPlateCalc(firstSet); }}
        class="p-1.5 rounded-md text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
        title="Plate calculator"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
        </svg>
      </button>
      <button
        onclick={(e) => { e.stopPropagation(); onToggleHistory(); }}
        class="p-1.5 rounded-md transition-colors {historyState ? 'text-green-400 bg-green-500/10' : 'text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800'}"
        title="View history"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
        </svg>
      </button>
    {/if}
    <button
      onclick={(e) => { e.stopPropagation(); onSwap(); }}
      class="p-1.5 rounded-md text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
      title="Swap exercise"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
      </svg>
    </button>
    <button
      onclick={(e) => { e.stopPropagation(); if (confirm(`Remove ${ex.exercise?.name}?`)) onRemove(); }}
      class="p-1.5 rounded-md text-neutral-600 hover:text-red-400 hover:bg-neutral-800 transition-colors"
      title="Remove exercise"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    </button>
    <button
      onclick={onToggleExpanded}
      class="p-1"
    >
      <svg class="w-5 h-5 text-neutral-500 transition-transform {ex.expanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
      </svg>
    </button>
  </div>
</div>

<!-- Inline rest time editor -->
{#if restEditing}
  <div class="px-4 pb-3 flex flex-wrap gap-2">
    {#each REST_PRESETS as sec}
      <button
        onclick={() => onUpdateRestSeconds(sec)}
        class="px-3 py-1.5 rounded-lg text-sm transition-colors {(ex.restSeconds ?? 60) === sec ? 'bg-green-500/20 text-green-400' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}"
      >{sec >= 60 ? `${sec / 60}m` : `${sec}s`}</button>
    {/each}
  </div>
{/if}

{#if ex.expanded}
  <div class="px-4 pb-4 space-y-2">
    {#each ex.sets as set, idx (set.id)}
      <SetRow
        {set}
        index={idx}
        {mode}
        lastPerformance={ex.lastPerformance as any}
        {kgToLbs}
        {updateWeightLbs}
        {adjustReps}
        {adjustWeightLbs}
        onToggleComplete={() => onToggleComplete(set)}
      />
    {/each}

    <!-- Per-exercise RIR: appears after all sets are complete -->
    {#if !isCardio && ex.sets.length > 0 && ex.sets.every(s => s.completed)}
      <div class="flex items-center gap-2 pt-2 mt-1 border-t border-neutral-800/50">
        <span class="text-xs text-neutral-500">How many reps left in the tank?</span>
        <div class="flex gap-1 ml-auto">
          {#each [3, 2, 1, 0] as rir}
            <button
              onclick={() => onSetRir(10 - rir)}
              class="w-8 h-8 rounded-lg text-xs font-bold transition-colors
                {currentRir === rir
                  ? (rir <= 0 ? 'bg-red-500/20 text-red-400' : rir <= 2 ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400')
                  : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'}"
            >{rir}</button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Exercise history panel -->
    <ExerciseHistoryPanel state={historyState} {kgToLbs} />

    <div class="flex gap-2 mt-2">
      <button
        onclick={onAddSet}
        class="flex-1 py-2 rounded-lg text-sm text-neutral-400 bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
      >
        + Add Set
      </button>
      {#if ex.sets.length > 1}
        <button
          onclick={() => { const last = ex.sets[ex.sets.length - 1]; if (last && !last.completed) onDeleteSet(last.id); }}
          class="px-3 py-2 rounded-lg text-sm text-red-400/70 bg-neutral-800/50 hover:bg-red-500/10 transition-colors"
          title="Remove last set"
        >
          − Set
        </button>
      {/if}
    </div>
  </div>
{/if}
