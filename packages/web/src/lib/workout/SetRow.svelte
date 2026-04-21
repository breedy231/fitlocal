<script lang="ts">
  import type { Set, LastPerformance } from 'fitlocal-shared';

  // Extends the shared Set shape with client-side PR flag computed after save.
  export type WorkoutSet = Set & { isPR?: boolean };

  interface Props {
    set: WorkoutSet;
    index: number;
    mode: 'strength' | 'cardio' | 'treadmill';
    lastPerformance?: LastPerformance | null;
    kgToLbs: (kg: number | null) => number;
    updateWeightLbs: (set: Set, lbsStr: string) => void;
    adjustReps: (set: Set, delta: number) => void;
    adjustWeightLbs: (set: Set, deltaLbs: number) => void;
    onToggleComplete: () => void;
  }

  let { set, index, mode, lastPerformance, kgToLbs, updateWeightLbs, adjustReps, adjustWeightLbs, onToggleComplete }: Props = $props();

  let lastSet = $derived(lastPerformance?.sets[index]);
</script>

{#if mode === 'cardio' || mode === 'treadmill'}
  <div class="space-y-2 py-2 {index > 0 ? 'border-t border-neutral-800' : ''}">
    <div class="grid grid-cols-[1fr_1fr_1fr_48px] gap-2 items-center">
      <div>
        <label class="text-xs text-neutral-500 block mb-1">Duration (min)</label>
        <div class="flex items-center justify-center gap-1">
          <button
            onclick={() => adjustReps(set, -1)}
            class="w-8 h-8 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-sm active:bg-neutral-700"
          >−</button>
          <input
            type="number"
            value={set.reps ?? 0}
            onchange={(e) => { set.reps = Math.max(0, parseInt(e.currentTarget.value) || 0); }}
            class="w-9 text-center text-sm font-bold py-1 rounded-lg bg-neutral-800/50 text-white border-none outline-none"
            inputmode="numeric"
            min="0"
          />
          <button
            onclick={() => adjustReps(set, 1)}
            class="w-8 h-8 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-sm active:bg-neutral-700"
          >+</button>
        </div>
      </div>
      <div>
        <label class="text-xs text-neutral-500 block mb-1">{mode === 'treadmill' ? 'Incline' : 'Resistance'}</label>
        <input
          type="number"
          value={set.rpe ?? ''}
          onchange={(e) => { set.rpe = parseFloat(e.currentTarget.value) || 0; }}
          placeholder="level"
          class="w-full text-center text-sm py-1.5 rounded bg-neutral-800 text-white border-none outline-none"
          step="1"
          min="0"
          max="30"
        />
      </div>
      <div>
        <label class="text-xs text-neutral-500 block mb-1">Distance (mi)</label>
        <input
          type="number"
          value={set.weightKg ?? ''}
          onchange={(e) => { set.weightKg = parseFloat(e.currentTarget.value) || 0; }}
          placeholder="opt."
          class="w-full text-center text-sm py-1.5 rounded bg-neutral-800 text-white border-none outline-none"
          step="0.1"
        />
      </div>
      <div class="pt-4">
        <button
          onclick={onToggleComplete}
          class="w-11 h-11 rounded-lg flex items-center justify-center transition-colors
            {set.completed ? 'bg-green-500/20 text-green-400' : 'bg-neutral-800 text-neutral-600'}"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
          </svg>
        </button>
      </div>
    </div>
  </div>
{:else}
  <!-- Grid: [set#] [reps] [×] [weight] [✓] — 1fr columns keep checkbox on-card on all iPhones -->
  <div class="grid items-center gap-x-1 py-1.5 {index > 0 ? 'border-t border-neutral-800/50' : ''}" style="grid-template-columns: 26px 1fr 12px 1fr 44px">
    <!-- Set number + last performance -->
    <div class="text-center">
      <span class="text-xs text-neutral-500">{index + 1}</span>
      {#if lastSet}
        <div class="text-[9px] text-neutral-600 leading-tight mt-0.5" title="Last session">{kgToLbs(lastSet.weightKg)}×{lastSet.reps}</div>
      {/if}
    </div>

    <!-- Reps: −/input/+ -->
    <div class="flex items-center gap-0.5">
      <button
        onclick={() => adjustReps(set, -1)}
        class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700 shrink-0"
      >−</button>
      <input
        type="number"
        value={set.reps ?? 0}
        onchange={(e) => { set.reps = Math.max(0, parseInt(e.currentTarget.value) || 0); }}
        class="flex-1 min-w-0 text-center text-sm font-bold py-1.5 rounded-lg bg-neutral-800/50 text-white border-none outline-none"
        inputmode="numeric"
        min="0"
      />
      <button
        onclick={() => adjustReps(set, 1)}
        class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700 shrink-0"
      >+</button>
    </div>

    <!-- × separator -->
    <span class="text-neutral-600 text-xs text-center">×</span>

    <!-- Weight: −/input/+ -->
    <div class="flex items-center gap-0.5">
      <button
        onclick={() => adjustWeightLbs(set, -5)}
        class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700 shrink-0"
      >−</button>
      <input
        type="number"
        value={kgToLbs(set.weightKg)}
        onchange={(e) => updateWeightLbs(set, e.currentTarget.value)}
        class="flex-1 min-w-0 text-center text-sm font-bold py-1.5 rounded-lg bg-neutral-800/50 text-white border-none outline-none"
        step="2.5"
        inputmode="decimal"
      />
      <button
        onclick={() => adjustWeightLbs(set, 5)}
        class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700 shrink-0"
      >+</button>
    </div>

    <!-- Complete button (PR badge overlaid) -->
    <div class="relative flex items-center justify-center">
      {#if set.isPR}
        <span class="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold px-1 rounded-full bg-amber-500/20 text-amber-400 whitespace-nowrap">PR</span>
      {/if}
      <button
        onclick={onToggleComplete}
        class="w-11 h-11 rounded-lg flex items-center justify-center transition-colors
          {set.completed ? 'bg-green-500/20 text-green-400' : 'bg-neutral-800 text-neutral-600'}"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
        </svg>
      </button>
    </div>
  </div>
{/if}
