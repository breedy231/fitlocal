<script lang="ts">
  interface DayData {
    date: string;
    muscles: Record<string, number>;
  }

  interface WeekData {
    weekStart: string;
    days: DayData[];
  }

  interface Props {
    muscles: string[];
    weeks: WeekData[];
  }

  let { muscles, weeks }: Props = $props();

  const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  // Find global max for color scaling
  let maxSets = $derived.by(() => {
    let max = 1;
    for (const week of weeks) {
      for (const day of week.days) {
        for (const m of muscles) {
          if (day.muscles[m] > max) max = day.muscles[m];
        }
      }
    }
    return max;
  });

  function cellColor(value: number): string {
    if (value === 0) return '#1a1a1a';
    const steps = [0.2, 0.4, 0.6, 0.8, 1.0];
    const colors = ['#14532d', '#166534', '#15803d', '#16a34a', '#22c55e'];
    const ratio = value / maxSets;
    const idx = Math.min(Math.floor(ratio * steps.length), steps.length - 1);
    return colors[idx];
  }

  function formatWeekLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
</script>

<div class="overflow-x-auto">
  <table class="w-full text-[10px]">
    <thead>
      <tr>
        <th class="text-right pr-2 text-neutral-600 font-normal w-20"></th>
        {#each DAY_LABELS as label}
          <th class="text-center text-neutral-600 font-normal pb-1 w-8">{label}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each weeks as week, weekIdx}
        {#if weekIdx > 0}
          <tr><td colspan="8" class="h-1"></td></tr>
        {/if}
        <tr>
          <td colspan="8" class="text-[9px] text-neutral-600 pb-0.5 pt-1">{formatWeekLabel(week.weekStart)}</td>
        </tr>
        {#each muscles as muscle}
          <tr>
            <td class="text-right pr-2 text-neutral-500 capitalize whitespace-nowrap">{muscle}</td>
            {#each Array(7) as _, dayIdx}
              {@const day = week.days[dayIdx]}
              {@const value = day?.muscles[muscle] ?? 0}
              <td class="p-0.5">
                <div
                  class="w-full aspect-square rounded-sm"
                  style="background-color: {cellColor(value)};"
                  title="{muscle}: {Math.round(value * 10) / 10} sets"
                ></div>
              </td>
            {/each}
          </tr>
        {/each}
      {/each}
    </tbody>
  </table>
</div>
