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
    const colors = ['#14532d', '#166534', '#15803d', '#16a34a', '#22c55e'];
    const ratio = value / maxSets;
    const idx = Math.min(Math.floor(ratio * colors.length), colors.length - 1);
    return colors[idx];
  }

  function formatWeekLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Total columns = weeks * 7
  let totalDays = $derived(weeks.length * 7);
</script>

<div class="overflow-x-auto">
  <!-- Week labels row -->
  <div class="flex mb-1" style="padding-left: 76px;">
    {#each weeks as week}
      <div class="text-[9px] text-neutral-600 text-center" style="width: {100 / weeks.length}%;">
        {formatWeekLabel(week.weekStart)}
      </div>
    {/each}
  </div>

  <!-- Heatmap grid -->
  {#each muscles as muscle}
    <div class="flex items-center mb-px">
      <span class="text-[10px] text-neutral-500 capitalize w-[72px] text-right pr-1 shrink-0 truncate">{muscle}</span>
      <div class="flex-1 flex gap-px">
        {#each weeks as week}
          {#each Array(7) as _, dayIdx}
            {@const day = week.days[dayIdx]}
            {@const value = day?.muscles[muscle] ?? 0}
            <div
              class="rounded-sm"
              style="background-color: {cellColor(value)}; flex: 1; aspect-ratio: 1; min-height: 14px;"
              title="{day?.date ?? ''} — {muscle}: {value > 0 ? Math.round(value * 10) / 10 + ' sets' : 'rest'}"
            ></div>
          {/each}
        {/each}
      </div>
    </div>
  {/each}

  <!-- Day-of-week labels -->
  <div class="flex mt-0.5" style="padding-left: 76px;">
    {#each weeks as _week}
      {#each ['M','T','W','T','F','S','S'] as d}
        <div class="text-[8px] text-neutral-700 text-center" style="flex: 1;">{d}</div>
      {/each}
    {/each}
  </div>
</div>
