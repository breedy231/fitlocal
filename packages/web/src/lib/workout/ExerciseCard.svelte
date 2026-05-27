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
    onAddSet: (isWarmup?: boolean) => void;
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

  // Haptic tick for all card-level taps (edit rest, tools, RIR, add/remove set).
  function vibrate(ms = 10) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(ms);
    }
  }

  let allExDone = $derived(ex.sets.length > 0 && ex.sets.every(s => s.completed));
  let mode = $derived<'strength' | 'cardio' | 'treadmill'>(
    isTreadmill ? 'treadmill' : isCardio ? 'cardio' : 'strength'
  );
  let lastStrengthSet = $derived(ex.sets[ex.sets.length - 1]);
  let currentRir = $derived(
    lastStrengthSet && lastStrengthSet.rpe != null ? Math.round(10 - lastStrengthSet.rpe) : null
  );
</script>

<!-- Header row: name + rest pill + collapse. Tools move to expanded body for more name room. -->
<button
  onclick={() => { vibrate(); onToggleExpanded(); }}
  class="w-full text-left px-4 pt-4 pb-2 flex justify-between items-center cursor-pointer {allExDone ? 'opacity-60' : ''} touch-manipulation"
>
  <div class="flex items-center gap-2 min-w-0">
    {#if allExDone}
      <svg class="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
      </svg>
    {/if}
    <span class="font-medium truncate text-base">
      <span
        role="link"
        tabindex="-1"
        onclick={(e: MouseEvent) => { e.stopPropagation(); onOpenExerciseDetail(ex.exerciseId); }}
        onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.stopPropagation(); onOpenExerciseDetail(ex.exerciseId); } }}
        class="underline decoration-neutral-600 underline-offset-2 hover:text-green-400 transition-colors"
      >{ex.exercise?.name ?? 'Exercise'}</span>
    </span>
    {#if !isCardio}
      <span
        role="button"
        tabindex="-1"
        onclick={(e: MouseEvent) => { e.stopPropagation(); vibrate(); onEditRest(); }}
        onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.stopPropagation(); vibrate(); onEditRest(); } }}
        class="min-h-[36px] text-xs px-3 py-1.5 rounded-full bg-neutral-800 text-neutral-400 hover:text-neutral-200 shrink-0 touch-manipulation inline-flex items-center"
        title="Edit rest time"
      >{(ex.restSeconds ?? 60) >= 60
          ? (ex.restSeconds ?? 60) % 60 === 0
            ? `${(ex.restSeconds ?? 60) / 60}m`
            : `${Math.floor((ex.restSeconds ?? 60) / 60)}m ${(ex.restSeconds ?? 60) % 60}s`
          : `${ex.restSeconds}s`}</span>
    {/if}
  </div>
  <div class="flex items-center shrink-0 ml-2">
    <svg class="w-5 h-5 text-neutral-500 transition-transform {ex.expanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
    </svg>
  </div>
</button>

<!-- Inline rest time editor -->
{#if restEditing}
  <div class="px-4 pb-3 flex flex-wrap gap-2">
    {#each REST_PRESETS as sec}
      <button
        onclick={() => { vibrate(); onUpdateRestSeconds(sec); }}
        class="min-h-[44px] min-w-[60px] px-4 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation {(ex.restSeconds ?? 60) === sec ? 'bg-green-500/20 text-green-400' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}"
      >{sec >= 60 ? (sec % 60 === 0 ? `${sec / 60}m` : `${Math.floor(sec / 60)}m ${sec % 60}s`) : `${sec}s`}</button>
    {/each}
  </div>
{/if}

{#if ex.expanded}
  <div class="px-4 pb-4 space-y-2">
    <!-- Tool buttons -->
    <div class="flex items-center gap-1 pb-1">
      {#if !isCardio}
        <button
          onclick={() => { vibrate(); const firstSet = ex.sets[0]; if (firstSet) onOpenPlateCalc(firstSet); }}
          class="h-9 px-2.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors touch-manipulation flex items-center gap-1.5 text-xs"
          title="Plate calculator"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
          Plates
        </button>
        <button
          onclick={() => { vibrate(); onToggleHistory(); }}
          class="h-9 px-2.5 rounded-md transition-colors touch-manipulation flex items-center gap-1.5 text-xs {historyState ? 'text-green-400 bg-green-500/10' : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'}"
          title="View history"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
          History
        </button>
      {/if}
      <button
        onclick={() => { vibrate(); onSwap(); }}
        class="h-9 px-2.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors touch-manipulation flex items-center gap-1.5 text-xs"
        title="Swap exercise"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path></svg>
        Swap
      </button>
      <button
        onclick={() => { vibrate(20); if (confirm(`Remove ${ex.exercise?.name}?`)) onRemove(); }}
        class="h-9 px-2.5 rounded-md text-neutral-500 hover:text-red-400 hover:bg-neutral-800 transition-colors touch-manipulation flex items-center gap-1.5 text-xs ml-auto"
        title="Remove exercise"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    </div>

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
              onclick={() => { vibrate(); onSetRir(10 - rir); }}
              class="w-11 h-11 rounded-lg text-sm font-bold transition-colors touch-manipulation
                {currentRir === rir
                  ? (rir <= 0 ? 'bg-red-500/20 text-red-400' : rir <= 2 ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400')
                  : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}"
            >{rir}</button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Exercise history panel -->
    <ExerciseHistoryPanel state={historyState} {kgToLbs} />

    <div class="flex gap-2 mt-3">
      {#if !isCardio}
        <button
          onclick={() => { vibrate(); onAddSet(true); }}
          class="min-h-[48px] px-4 py-3 rounded-lg text-sm font-medium text-amber-500/80 bg-neutral-800/70 hover:bg-neutral-800 active:bg-neutral-700 transition-colors touch-manipulation"
          title="Add warm-up set"
        >
          + Warm-up
        </button>
      {/if}
      <button
        onclick={() => { vibrate(); onAddSet(); }}
        class="flex-1 min-h-[48px] py-3 rounded-lg text-base font-medium text-neutral-300 bg-neutral-800/70 hover:bg-neutral-800 active:bg-neutral-700 transition-colors touch-manipulation"
      >
        + Add Set
      </button>
      {#if ex.sets.length > 1}
        <button
          onclick={() => { vibrate(15); const last = ex.sets[ex.sets.length - 1]; if (last && !last.completed) onDeleteSet(last.id); }}
          class="min-h-[48px] min-w-[72px] px-4 py-3 rounded-lg text-base font-medium text-red-400/80 bg-neutral-800/70 hover:bg-red-500/10 active:bg-red-500/20 transition-colors touch-manipulation"
          title="Remove last set"
        >
          − Set
        </button>
      {/if}
    </div>
  </div>
{/if}
