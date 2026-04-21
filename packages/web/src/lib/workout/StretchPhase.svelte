<script lang="ts">
  import { onDestroy } from 'svelte';

  export interface StretchData {
    name: string;
    muscles: string[];
    duration: number;
    instructions: string;
  }

  interface Props {
    phase: 'warmup' | 'cooldown';
    stretches: StretchData[];
    onFinish: () => void;
    onSkip: () => void;
  }

  let { phase, stretches, onFinish, onSkip }: Props = $props();

  let activeStretchIndex = $state(0);
  let stretchTimeLeft = $state(stretches[0]?.duration ?? 0);
  let stretchTimerActive = $state(false);
  let stretchTimerInterval: ReturnType<typeof setInterval> | null = null;

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function startStretchTimer() {
    if (stretchTimerInterval) clearInterval(stretchTimerInterval);
    stretchTimerActive = true;
    stretchTimerInterval = setInterval(() => {
      stretchTimeLeft--;
      if (stretchTimeLeft <= 0) {
        clearInterval(stretchTimerInterval!);
        stretchTimerInterval = null;
        stretchTimerActive = false;
        advanceStretch();
      }
    }, 1000);
  }

  function advanceStretch() {
    if (stretchTimerInterval) {
      clearInterval(stretchTimerInterval);
      stretchTimerInterval = null;
    }
    stretchTimerActive = false;
    if (activeStretchIndex < stretches.length - 1) {
      activeStretchIndex++;
      stretchTimeLeft = stretches[activeStretchIndex].duration;
    } else {
      onFinish();
    }
  }

  function skip() {
    if (stretchTimerInterval) clearInterval(stretchTimerInterval);
    onSkip();
  }

  onDestroy(() => {
    if (stretchTimerInterval) clearInterval(stretchTimerInterval);
  });
</script>

<div class="py-6">
  <div class="flex items-center justify-between mb-8">
    <h1 class="text-2xl font-bold">{phase === 'warmup' ? 'Warm Up' : 'Cool Down'}</h1>
    <button onclick={skip} class="min-h-[44px] px-3 py-2 rounded-md text-sm text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors touch-manipulation">
      {phase === 'warmup' ? 'Skip to Workout' : 'Skip Cool Down'}
    </button>
  </div>

  <div class="space-y-4">
    {#each stretches as stretch, idx}
      <div class="rounded-xl p-5 transition-all {idx === activeStretchIndex ? 'ring-1 ring-green-500/50' : 'opacity-50'}" style="background-color: #1a1a1a;">
        <div class="flex items-start justify-between mb-2">
          <h3 class="font-semibold text-lg {idx === activeStretchIndex ? 'text-green-400' : 'text-neutral-300'}">{stretch.name}</h3>
          {#if idx === activeStretchIndex}
            <span class="text-2xl font-mono font-bold text-green-400">{formatTime(stretchTimeLeft)}</span>
          {:else if idx < activeStretchIndex}
            <span class="text-sm text-green-500">Done</span>
          {:else}
            <span class="text-sm text-neutral-600">{stretch.duration}s</span>
          {/if}
        </div>
        <p class="mb-3 {idx === activeStretchIndex ? 'text-base text-neutral-200' : 'text-sm text-neutral-400'}">{stretch.instructions}</p>
        <div class="flex gap-2 text-xs">
          {#each stretch.muscles as muscle}
            <span class="px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">{muscle}</span>
          {/each}
        </div>
        {#if idx === activeStretchIndex}
          <div class="mt-4 flex gap-3">
            {#if !stretchTimerActive}
              <button onclick={startStretchTimer} class="flex-1 min-h-[48px] py-3 rounded-lg font-semibold text-base active:opacity-80 transition-opacity touch-manipulation" style="background-color: #22c55e; color: #0f0f0f;">
                Start
              </button>
            {:else}
              <button onclick={advanceStretch} class="flex-1 min-h-[48px] py-3 rounded-lg font-semibold text-base bg-neutral-700 text-neutral-100 active:bg-neutral-600 transition-colors touch-manipulation">
                {#if idx < stretches.length - 1}
                  Next Stretch
                {:else if phase === 'warmup'}
                  Start Workout
                {:else}
                  Finish
                {/if}
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
