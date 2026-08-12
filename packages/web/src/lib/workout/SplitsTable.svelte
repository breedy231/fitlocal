<script lang="ts">
  import type { SetSplit } from 'fitlocal-shared';
  import { metersToMiles } from 'fitlocal-shared';

  interface Props {
    splits: SetSplit[];
  }

  let { splits }: Props = $props();

  // Format seconds as m:ss (used for both time and pace).
  function mmss(totalSeconds: number): string {
    const s = Math.round(totalSeconds);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
  }

  interface Row {
    idx: number;
    miles: number;
    seconds: number;
    /** pace in seconds per mile, or null when distance is ~0 */
    paceSecPerMile: number | null;
  }

  let rows = $derived<Row[]>(
    splits.map((s) => {
      const miles = metersToMiles(s.distanceMeters);
      return {
        idx: s.splitIndex,
        miles,
        seconds: s.durationSeconds,
        paceSecPerMile: miles > 0.001 ? s.durationSeconds / miles : null,
      };
    })
  );
</script>

{#if rows.length > 0}
  <div class="rounded-lg overflow-hidden text-xs" style="background-color: #171717;">
    <div class="grid grid-cols-[28px_1fr_1fr_1fr] gap-1 px-2 py-1.5 text-[10px] font-medium text-neutral-500 border-b border-neutral-800">
      <span>#</span>
      <span class="text-right">Dist (mi)</span>
      <span class="text-right">Time</span>
      <span class="text-right">Pace /mi</span>
    </div>
    {#each rows as row (row.idx)}
      <div class="grid grid-cols-[28px_1fr_1fr_1fr] gap-1 px-2 py-1.5 text-neutral-300 font-mono border-b border-neutral-800/50 last:border-b-0">
        <span class="text-neutral-500">{row.idx}</span>
        <span class="text-right tabular-nums">{row.miles.toFixed(2)}</span>
        <span class="text-right tabular-nums">{mmss(row.seconds)}</span>
        <span class="text-right tabular-nums">{row.paceSecPerMile != null ? mmss(row.paceSecPerMile) : '—'}</span>
      </div>
    {/each}
  </div>
{/if}
