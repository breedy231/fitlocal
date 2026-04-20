<script lang="ts">
  interface Props {
    ratio: number;
    thresholds: Record<string, number>;
    level: string;
  }

  let { ratio, thresholds, level }: Props = $props();

  const LEVELS = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'] as const;
  const COLORS: Record<string, string> = {
    beginner: '#6b7280',
    novice: '#3b82f6',
    intermediate: '#22c55e',
    advanced: '#f59e0b',
    elite: '#ef4444',
  };

  let fillColor = $derived(COLORS[level] ?? '#6b7280');

  // Scale: 0 to elite threshold. Dot and tick marks on the same linear scale.
  let maxVal = $derived(thresholds.elite);

  // Dot position as percentage of the full bar
  let dotPct = $derived(Math.min((ratio / maxVal) * 100, 100));

  // Tick positions for each level threshold
  let ticks = $derived(
    LEVELS.map((lvl) => ({
      lvl,
      pct: (thresholds[lvl] / maxVal) * 100,
      label: lvl.slice(0, 3).replace(/^./, c => c.toUpperCase()),
    }))
  );
</script>

<div class="w-full">
  <!-- Bar -->
  <div class="relative h-3 rounded-full overflow-hidden" style="background-color: #262626;">
    <!-- Filled portion up to the dot -->
    <div
      class="h-full rounded-full"
      style="width: {dotPct}%; background-color: {fillColor};"
    ></div>
    <!-- Tick marks at each threshold -->
    {#each ticks as tick}
      <div
        class="absolute top-0 h-full w-px"
        style="left: {tick.pct}%; background-color: #404040;"
      ></div>
    {/each}
    <!-- Dot -->
    <div
      class="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-lg"
      style="left: {dotPct}%; transform: translate(-50%, -50%); background-color: {fillColor};"
    ></div>
  </div>
  <!-- Labels at tick marks -->
  <div class="relative mt-1 h-3">
    {#each ticks as tick}
      <span
        class="absolute text-[9px] -translate-x-1/2 {level === tick.lvl ? 'text-neutral-200 font-bold' : 'text-neutral-600'}"
        style="left: {tick.pct}%;"
      >{tick.label}</span>
    {/each}
  </div>
</div>
