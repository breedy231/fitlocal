<script lang="ts">
  interface Props {
    ratio: number;
    thresholds: Record<string, number>;
    level: string;
  }

  let { ratio, thresholds, level }: Props = $props();

  const LEVELS = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'] as const;
  const COLORS = ['#6b7280', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444'];
  const LABELS = ['Beg', 'Nov', 'Int', 'Adv', 'Elite'];

  let markerPct = $derived.by(() => {
    const maxThreshold = thresholds.elite * 1.2;
    return Math.min((ratio / maxThreshold) * 100, 98);
  });
</script>

<div class="w-full">
  <div class="flex gap-0.5 h-3 rounded-full overflow-hidden relative">
    {#each LEVELS as lvl, idx}
      {@const prevThreshold = idx === 0 ? 0 : Object.values(thresholds)[idx - 1]}
      {@const thisThreshold = Object.values(thresholds)[idx]}
      {@const maxT = thresholds.elite * 1.2}
      {@const widthPct = ((thisThreshold - prevThreshold) / maxT) * 100}
      <div
        class="h-full {level === lvl ? 'opacity-100' : 'opacity-30'}"
        style="background-color: {COLORS[idx]}; width: {widthPct}%;"
      ></div>
    {/each}
    <!-- Marker dot -->
    <div
      class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow-lg"
      style="left: {markerPct}%; background-color: {COLORS[LEVELS.indexOf(level as any)] ?? '#22c55e'};"
    ></div>
  </div>
  <div class="flex justify-between mt-1">
    {#each LABELS as label, idx}
      <span class="text-[9px] {level === LEVELS[idx] ? 'text-neutral-200 font-bold' : 'text-neutral-600'}">{label}</span>
    {/each}
  </div>
</div>
