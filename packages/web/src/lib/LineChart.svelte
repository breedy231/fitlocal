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

  function niceNumber(val: number): number {
    if (val <= 0) return 1;
    const exp = Math.floor(Math.log10(val));
    const frac = val / Math.pow(10, exp);
    let nice: number;
    if (frac <= 1.5) nice = 1;
    else if (frac <= 3) nice = 2;
    else if (frac <= 7) nice = 5;
    else nice = 10;
    return nice * Math.pow(10, exp);
  }

  let filtered = $derived(data.filter((d) => d.value != null) as { label: string; value: number }[]);
  let rawMax = $derived(Math.max(...filtered.map((d) => d.value), 1));
  let rawMin = $derived(Math.min(...filtered.map((d) => d.value), 0));

  // Compute nice Y-axis bounds
  let niceMin = $derived(rawMin >= 0 ? 0 : -niceNumber(Math.abs(rawMin)));
  let niceMax = $derived(niceNumber(rawMax * 1.1));
  let range = $derived(niceMax - niceMin || 1);
  let tickStep = $derived(niceNumber(range / 4));
  let ticks = $derived(() => {
    const t: number[] = [];
    for (let v = niceMin; v <= niceMax + tickStep * 0.01; v += tickStep) {
      t.push(Math.round(v * 100) / 100);
    }
    return t;
  });

  let padding = 24;
  let yAxisWidth = 36;
  let chartWidth = $derived(Math.max(filtered.length * 32, 200) + yAxisWidth);

  function x(i: number): number {
    if (filtered.length <= 1) return (chartWidth + yAxisWidth) / 2;
    return yAxisWidth + padding + (i / (filtered.length - 1)) * (chartWidth - yAxisWidth - padding * 2);
  }

  function y(val: number): number {
    return height - padding - ((val - niceMin) / range) * (height - padding * 2);
  }

  let pathD = $derived(
    filtered.length > 1
      ? filtered.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' ')
      : ''
  );
</script>

{#if filtered.length > 0}
  {@const tickArr = ticks()}
  <div class="overflow-x-auto">
    <svg viewBox="0 0 {chartWidth} {height + 20}" class="w-full" style="min-width: {chartWidth}px; max-height: {height + 20}px;">
      <!-- Grid lines with nice Y-axis labels -->
      {#each tickArr as tick}
        {@const ty = y(tick)}
        <line
          x1={yAxisWidth}
          y1={ty}
          x2={chartWidth - padding}
          y2={ty}
          stroke="#262626"
          stroke-width="1"
        />
        <text x={yAxisWidth - 4} y={ty + 3} text-anchor="end" fill="#525252" font-size="8">
          {Number.isInteger(tick) ? tick : tick.toFixed(1)}{unit && tick === tickArr[tickArr.length - 1] ? unit : ''}
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
