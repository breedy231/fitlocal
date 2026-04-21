<script lang="ts">
  import type { ExerciseProgressionReport } from 'fitlocal-shared';

  type HistoryPoint = ExerciseProgressionReport['dataPoints'][number];

  interface Props {
    state: HistoryPoint[] | 'loading' | undefined;
    kgToLbs: (kg: number | null) => number;
  }

  let { state, kgToLbs }: Props = $props();
</script>

{#if state}
  <div class="mt-2 pt-2 border-t border-neutral-800/50">
    {#if state === 'loading'}
      <div class="flex justify-center py-2">
        <div class="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    {:else}
      {#if state.length === 0}
        <p class="text-xs text-neutral-500 text-center py-1">No history yet</p>
      {:else}
        <div class="space-y-1">
          {#each state as h}
            <div class="flex justify-between items-center text-xs px-1">
              <span class="text-neutral-500">{new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              <span class="text-neutral-300 font-medium">{kgToLbs(h.maxWeight)} lbs x {h.maxReps}</span>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/if}
