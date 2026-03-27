<script lang="ts">
  interface BarData {
    label: string;
    value: number;
  }

  let { data, color = '#22c55e', height = 160, unit = '' }: {
    data: BarData[];
    color?: string;
    height?: number;
    unit?: string;
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

  let maxVal = $derived(Math.max(...data.map((d) => d.value), 1));
  let niceMax = $derived(niceNumber(maxVal * 1.1));
  let tickStep = $derived(niceNumber(niceMax / 4));
  let ticks = $derived(() => {
    const t: number[] = [];
    for (let v = 0; v <= niceMax; v += tickStep) {
      t.push(Math.round(v * 100) / 100);
    }
    if (t[t.length - 1] < niceMax) t.push(niceMax);
    return t;
  });

  let yAxisWidth = 36;
</script>

{#if data.length > 0}
  {@const tickArr = ticks()}
  <svg viewBox="0 0 {data.length * 40 + 20 + yAxisWidth} {height + 30}" class="w-full" style="max-height: {height + 40}px;">
    <!-- Y-axis grid lines and labels -->
    {#each tickArr as tick}
      {@const ty = height - (tick / niceMax) * height}
      <line
        x1={yAxisWidth}
        y1={ty}
        x2={data.length * 40 + 20 + yAxisWidth}
        y2={ty}
        stroke="#262626"
        stroke-width="1"
      />
      <text
        x={yAxisWidth - 4}
        y={ty + 3}
        text-anchor="end"
        fill="#525252"
        font-size="8"
      >
        {Number.isInteger(tick) ? tick : tick.toFixed(1)}{unit && tick === tickArr[tickArr.length - 1] ? unit : ''}
      </text>
    {/each}

    {#each data as bar, i}
      {@const barHeight = (bar.value / niceMax) * height}
      <rect
        x={i * 40 + 14 + yAxisWidth}
        y={height - barHeight}
        width="24"
        rx="4"
        height={barHeight}
        fill={color}
        opacity="0.85"
      />
      <text
        x={i * 40 + 26 + yAxisWidth}
        y={height - barHeight - 4}
        text-anchor="middle"
        fill="#a3a3a3"
        font-size="10"
      >
        {Math.round(bar.value)}{unit}
      </text>
      <text
        x={i * 40 + 26 + yAxisWidth}
        y={height + 14}
        text-anchor="middle"
        fill="#525252"
        font-size="9"
      >
        {bar.label}
      </text>
    {/each}
  </svg>
{:else}
  <p class="text-neutral-500 text-sm text-center py-4">No data yet</p>
{/if}
