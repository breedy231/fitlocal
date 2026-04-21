<script lang="ts">
  import type { Challenge } from 'fitlocal-shared';

  interface Props {
    challenge: Challenge & { currentValue: number };
  }

  let { challenge }: Props = $props();

  const SIZE = 72;
  const STROKE = 6;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  let pct = $derived(Math.min(challenge.currentValue / challenge.targetValue, 1));
  let offset = $derived(CIRCUMFERENCE * (1 - pct));
  let color = $derived(challenge.completed ? '#22c55e' : '#3b82f6');
</script>

<div class="rounded-xl p-4 flex items-center gap-4" style="background-color: #1a1a1a;">
  <div class="relative shrink-0" style="width: {SIZE}px; height: {SIZE}px;">
    <svg width={SIZE} height={SIZE} class="transform -rotate-90">
      <circle
        cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
        fill="none" stroke="#262626" stroke-width={STROKE}
      />
      <circle
        cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
        fill="none" stroke={color} stroke-width={STROKE}
        stroke-linecap="round"
        stroke-dasharray={CIRCUMFERENCE}
        stroke-dashoffset={offset}
        style="transition: stroke-dashoffset 1s ease-out;"
      />
    </svg>
    <div class="absolute inset-0 flex items-center justify-center">
      {#if challenge.completed}
        <svg class="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
        </svg>
      {:else}
        <span class="text-xs font-bold" style="color: {color};">{Math.round(pct * 100)}%</span>
      {/if}
    </div>
  </div>

  <div class="flex-1 min-w-0">
    <p class="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-0.5">
      {challenge.completed ? 'Completed!' : 'Monthly Challenge'}
    </p>
    <p class="text-sm font-medium text-neutral-200">{challenge.description}</p>
    <p class="text-xs text-neutral-500 mt-1">
      {Math.round(challenge.currentValue)} / {Math.round(challenge.targetValue)} {challenge.unit}
    </p>
  </div>
</div>
