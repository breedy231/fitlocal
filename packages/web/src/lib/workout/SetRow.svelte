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

  // Haptic feedback for gloved users — fires on every +/- and complete press.
  function vibrate(ms = 10) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(ms);
    }
  }

  // Press-and-hold helpers: after 500ms, repeatedly fire a larger increment
  // so the user can dial in a big weight jump without spamming taps.
  let holdTimeout: ReturnType<typeof setTimeout> | null = null;
  let holdInterval: ReturnType<typeof setInterval> | null = null;

  function clearHold() {
    if (holdTimeout) { clearTimeout(holdTimeout); holdTimeout = null; }
    if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
  }

  function startHold(onRepeat: () => void) {
    clearHold();
    holdTimeout = setTimeout(() => {
      vibrate(20);
      onRepeat();
      holdInterval = setInterval(() => {
        onRepeat();
        vibrate(5);
      }, 120);
    }, 500);
  }

  function pressReps(delta: number) {
    vibrate();
    adjustReps(set, delta);
    // Long-press: larger jumps (±5 reps) once held past 500ms
    startHold(() => adjustReps(set, delta * 5));
  }

  function pressWeight(deltaLbs: number) {
    vibrate();
    adjustWeightLbs(set, deltaLbs);
    // Long-press: jumps by ±25 lbs once held past 500ms
    startHold(() => adjustWeightLbs(set, deltaLbs * 5));
  }

  function handleComplete() {
    vibrate(15);
    onToggleComplete();
  }
</script>

{#if mode === 'cardio' || mode === 'treadmill'}
  <div class="space-y-2 py-2 {index > 0 ? 'border-t border-neutral-800' : ''}">
    <div class="grid grid-cols-[1fr_1fr_1fr_56px] gap-2 items-center">
      <div>
        <label class="text-xs text-neutral-500 block mb-1">Duration (min)</label>
        <div class="flex items-center justify-center gap-1">
          <button
            onpointerdown={() => pressReps(-1)}
            onpointerup={clearHold}
            onpointerleave={clearHold}
            onpointercancel={clearHold}
            class="w-12 h-12 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700 shrink-0 touch-manipulation select-none"
          >−</button>
          <input
            type="number"
            value={set.reps ?? 0}
            onchange={(e) => { set.reps = Math.max(0, parseInt(e.currentTarget.value) || 0); }}
            class="w-12 text-center text-base font-bold py-2 rounded-lg bg-neutral-800/50 text-white border-none outline-none"
            inputmode="numeric"
            min="0"
          />
          <button
            onpointerdown={() => pressReps(1)}
            onpointerup={clearHold}
            onpointerleave={clearHold}
            onpointercancel={clearHold}
            class="w-12 h-12 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700 shrink-0 touch-manipulation select-none"
          >+</button>
        </div>
      </div>
      <div>
        <label class="text-xs text-neutral-500 block mb-1">{mode === 'treadmill' ? 'Incline' : 'Resistance'}</label>
        <input
          type="number"
          value={set.resistance ?? ''}
          onchange={(e) => { set.resistance = parseFloat(e.currentTarget.value) || 0; }}
          placeholder="level"
          class="w-full h-12 text-center text-base py-2 rounded-lg bg-neutral-800 text-white border-none outline-none"
          step="1"
          min="0"
          max="30"
        />
      </div>
      <div>
        <label class="text-xs text-neutral-500 block mb-1">Distance (mi)</label>
        <input
          type="number"
          value={set.distanceMeters != null ? Math.round((set.distanceMeters / 1609.344) * 100) / 100 : ''}
          onchange={(e) => {
            const mi = parseFloat(e.currentTarget.value);
            set.distanceMeters = isNaN(mi) ? null : Math.round(mi * 1609.344);
          }}
          placeholder="opt."
          class="w-full h-12 text-center text-base py-2 rounded-lg bg-neutral-800 text-white border-none outline-none"
          step="0.1"
        />
      </div>
      <div class="pt-5">
        <button
          onclick={handleComplete}
          class="w-12 h-12 rounded-lg flex items-center justify-center transition-colors touch-manipulation
            {set.completed ? 'bg-green-500/20 text-green-400' : 'bg-neutral-700 text-neutral-400 border border-neutral-600'}"
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
  <!-- 4c sizing: 48px tap targets per iOS HIG 44pt minimum (rounded up) -->
  <div class="grid items-center gap-x-1 py-2 {index > 0 ? 'border-t border-neutral-800/50' : ''} {set.isWarmup ? 'opacity-70' : ''}" style="grid-template-columns: 28px 1fr 10px 1fr 48px">
    <!-- Set number + last performance -->
    <div class="text-center">
      {#if set.isWarmup}
        <span class="text-[10px] font-bold text-amber-500/80">W</span>
      {:else}
        <span class="text-xs text-neutral-500">{index + 1}</span>
      {/if}
      {#if lastSet}
        <div class="text-[9px] text-neutral-600 leading-tight mt-0.5" title="Last session">{lastSet.weightKg > 0 ? `${kgToLbs(lastSet.weightKg)}×` : ''}{lastSet.reps}</div>
      {/if}
    </div>

    <!-- Reps: −/input/+ -->
    <div class="flex items-center gap-0.5">
      <button
        onpointerdown={() => pressReps(-1)}
        onpointerup={clearHold}
        onpointerleave={clearHold}
        onpointercancel={clearHold}
        class="w-12 h-12 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-xl active:bg-neutral-700 shrink-0 touch-manipulation select-none"
        aria-label="Decrease reps"
      >−</button>
      <input
        type="number"
        value={set.reps ?? 0}
        onchange={(e) => { set.reps = Math.max(0, parseInt(e.currentTarget.value) || 0); }}
        class="flex-1 min-w-0 h-12 text-center text-base font-bold rounded-lg bg-neutral-800/50 text-white border-none outline-none"
        inputmode="numeric"
        min="0"
      />
      <button
        onpointerdown={() => pressReps(1)}
        onpointerup={clearHold}
        onpointerleave={clearHold}
        onpointercancel={clearHold}
        class="w-12 h-12 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-xl active:bg-neutral-700 shrink-0 touch-manipulation select-none"
        aria-label="Increase reps"
      >+</button>
    </div>

    <!-- × separator -->
    <span class="text-neutral-600 text-xs text-center">×</span>

    <!-- Weight: −/input/+ -->
    <div class="flex items-center gap-0.5">
      <button
        onpointerdown={() => pressWeight(-5)}
        onpointerup={clearHold}
        onpointerleave={clearHold}
        onpointercancel={clearHold}
        class="w-12 h-12 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-xl active:bg-neutral-700 shrink-0 touch-manipulation select-none"
        aria-label="Decrease weight"
      >−</button>
      <input
        type="number"
        value={kgToLbs(set.weightKg)}
        onchange={(e) => updateWeightLbs(set, e.currentTarget.value)}
        class="flex-1 min-w-0 h-12 text-center text-base font-bold rounded-lg bg-neutral-800/50 text-white border-none outline-none"
        step="2.5"
        inputmode="decimal"
      />
      <button
        onpointerdown={() => pressWeight(5)}
        onpointerup={clearHold}
        onpointerleave={clearHold}
        onpointercancel={clearHold}
        class="w-12 h-12 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-xl active:bg-neutral-700 shrink-0 touch-manipulation select-none"
        aria-label="Increase weight"
      >+</button>
    </div>

    <!-- Complete button (PR badge overlaid) -->
    <div class="relative flex items-center justify-center">
      {#if set.isPR}
        <span class="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold px-1 rounded-full bg-amber-500/20 text-amber-400 whitespace-nowrap z-10">PR</span>
      {/if}
      <button
        onclick={handleComplete}
        class="w-12 h-12 rounded-lg flex items-center justify-center transition-colors touch-manipulation
          {set.completed ? 'bg-green-500/20 text-green-400' : 'bg-neutral-700 text-neutral-400 border border-neutral-600'}"
        aria-label={set.completed ? 'Mark set incomplete' : 'Mark set complete'}
      >
        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
        </svg>
      </button>
    </div>
  </div>
{/if}
