<script lang="ts">
  import Expandable from '$lib/Expandable.svelte';
  import type { WeeklyProgress } from 'fitlocal-shared';

  type InCutProgress = Extract<WeeklyProgress, { isInCut: true }>;

  let { data }: { data: InCutProgress } = $props();
  let expanded = $state(false);

  const paceConfig = {
    on_track: { label: 'On Track', color: '#22c55e', bg: 'bg-green-500/15' },
    ahead: { label: 'Too Fast', color: '#ef4444', bg: 'bg-red-500/15' },
    behind: { label: 'Behind', color: '#f59e0b', bg: 'bg-amber-500/15' },
  };

  let pace = $derived(data.pace ? paceConfig[data.pace] : null);
</script>

<div class="rounded-xl p-4" style="background-color: #1a1a1a;">
  <button class="w-full" onclick={() => expanded = !expanded}>
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-neutral-400 uppercase tracking-wide">Weekly Cut Progress</h3>
      <div class="flex items-center gap-2">
        {#if pace}
          <span class="text-xs px-2 py-0.5 rounded-full {pace.bg}" style="color: {pace.color};">
            {pace.label}
          </span>
        {:else}
          <span class="text-xs text-neutral-600">Not enough data</span>
        {/if}
        <span class="text-neutral-500 text-xs">{expanded ? '▲' : '▼'}</span>
      </div>
    </div>
  </button>

  <Expandable {expanded}>
    <div class="mt-3 pt-3 border-t border-neutral-800 space-y-2">
      {#if data.week.avgDeficit != null}
        <div class="flex justify-between text-sm">
          <span class="text-neutral-400">Avg deficit</span>
          <span class="text-neutral-200">{data.week.avgDeficit} cal/day</span>
        </div>
      {/if}

      {#if data.weight.changeLbs != null}
        <div class="flex justify-between text-sm">
          <span class="text-neutral-400">Weight trend</span>
          <span class="{data.weight.changeLbs <= 0 ? 'text-green-400' : 'text-amber-400'}">
            {data.weight.changeLbs > 0 ? '+' : ''}{data.weight.changeLbs} lbs this week
          </span>
        </div>
      {/if}

      {#if data.weight.weeklyTargetLbs != null}
        <div class="flex justify-between text-sm">
          <span class="text-neutral-400">Target pace</span>
          <span class="text-neutral-200">{data.weight.weeklyTargetLbs} lbs/week</span>
        </div>
      {/if}

      <div class="flex justify-between text-sm">
        <span class="text-neutral-400">Days logged</span>
        <span class="text-neutral-{data.week.daysLogged >= 5 ? '200' : '500'}">{data.week.daysLogged} of 7</span>
      </div>

      {#if data.pace === 'ahead'}
        <p class="text-xs text-red-400/70 mt-1">Losing weight too quickly can sacrifice muscle. Consider increasing calories slightly.</p>
      {/if}
    </div>
  </Expandable>
</div>
