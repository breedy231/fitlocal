<script lang="ts">
  import type { WorkoutHr } from 'fitlocal-shared';
  import { getWorkoutHr } from '$lib/api';

  interface Props {
    workoutId: number;
  }

  let { workoutId }: Props = $props();

  let hr = $state<WorkoutHr | null>(null);
  let loading = $state(true);

  // Per-zone accent colors (Z1 easy → Z5 max). Mirrors the 5-zone %-of-max
  // model the API uses in /workouts/:id/hr.
  const ZONE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444'];

  function mmss(totalSeconds: number): string {
    const s = Math.round(totalSeconds);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
  }

  let zoneTotal = $derived(
    hr?.zones ? hr.zones.reduce((sum, z) => sum + z.seconds, 0) : 0
  );

  $effect(() => {
    // capture id so the async result can't land against a stale prop
    const id = workoutId;
    loading = true;
    getWorkoutHr(id)
      .then((data) => {
        if (id === workoutId) hr = data;
      })
      .catch(() => {
        if (id === workoutId) hr = null;
      })
      .finally(() => {
        if (id === workoutId) loading = false;
      });
  });
</script>

{#if !loading && hr && hr.sampleCount > 0}
  <div class="rounded-lg p-3 space-y-2" style="background-color: #171717;">
    <div class="flex items-center gap-4 text-xs">
      <span class="text-neutral-500">Heart rate</span>
      <span class="text-neutral-300"><span class="font-semibold text-white">{hr.avgHr}</span> avg</span>
      <span class="text-neutral-300"><span class="font-semibold text-white">{hr.maxHr}</span> max</span>
      <span class="text-neutral-600">bpm</span>
    </div>

    {#if hr.zones && zoneTotal > 0}
      <div class="space-y-1">
        {#each hr.zones as zone (zone.zone)}
          {@const pct = (zone.seconds / zoneTotal) * 100}
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-neutral-400 w-24 shrink-0 truncate">{zone.label}</span>
            <div class="flex-1 h-3 rounded-full overflow-hidden" style="background-color: #262626;">
              <div
                class="h-full rounded-full"
                style="width: {pct}%; background-color: {ZONE_COLORS[zone.zone - 1] ?? '#737373'};"
              ></div>
            </div>
            <span class="text-[10px] text-neutral-400 w-10 shrink-0 text-right tabular-nums font-mono">{mmss(zone.seconds)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
