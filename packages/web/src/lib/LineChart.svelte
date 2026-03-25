<script lang="ts">
  interface DataPoint {
    label: string;
    value: number | null;
  }

  let { data, color = '#22c55e', height = 140, unit = '', showDots = true }: {
    data: DataPoint[];
    color?: string;
    height?: number;
    unit?: string;
    showDots?: boolean;
  } = $props();

  let filtered = $derived(data.filter((d) => d.value != null) as { label: string; value: number }[]);
  let maxVal = $derived(Math.max(...filtered.map((d) => d.value), 1));
  let minVal = $derived(Math.min(...filtered.map((d) => d.value), 0));
  let range = $derived(maxVal - minVal || 1);
  let padding = 24;
  let chartWidth = $derived(Math.max(filtered.length * 32, 200));

  function x(i: number): number {
    if (filtered.length <= 1) return chartWidth / 2;
    return padding + (i / (filtered.length - 1)) * (chartWidth - padding * 2);
  }

  function y(val: number): number {
    return height - padding - ((val - minVal) / range) * (height - padding * 2);
  }

  let pathD = $derived(
    filtered.length > 1
      ? filtered.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' ')
      : ''
  );
</script>

{#if filtered.length > 0}
  <div class="overflow-x-auto">
    <svg viewBox="0 0 {chartWidth} {height + 20}" class="w-full" style="min-width: {chartWidth}px; max-height: {height + 20}px;">
      <!-- Grid lines -->
      {#each [0, 0.25, 0.5, 0.75, 1] as pct}
        {@const val = minVal + range * pct}
        <line
          x1={padding}
          y1={y(val)}
          x2={chartWidth - padding}
          y2={y(val)}
          stroke="#262626"
          stroke-width="1"
        />
        <text x={2} y={y(val) + 3} fill="#525252" font-size="8">
          {Math.round(val)}{unit}
        </text>
      {/each}

      <!-- Line -->
      {#if pathD}
        <path d={pathD} fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      {/if}

      <!-- Dots -->
      {#if showDots}
        {#each filtered as point, i}
          <circle cx={x(i)} cy={y(point.value)} r="3" fill={color} />
        {/each}
      {/if}

      <!-- X labels (show every Nth to avoid clutter) -->
      {#each filtered as point, i}
        {@const step = Math.max(1, Math.floor(filtered.length / 8))}
        {#if i % step === 0 || i === filtered.length - 1}
          <text x={x(i)} y={height + 10} text-anchor="middle" fill="#525252" font-size="8">
            {point.label}
          </text>
        {/if}
      {/each}
    </svg>
  </div>
{:else}
  <p class="text-neutral-500 text-sm text-center py-4">No data yet</p>
{/if}
