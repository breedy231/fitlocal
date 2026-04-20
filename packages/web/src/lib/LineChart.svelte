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
  let rawMax = $derived(filtered.length > 0 ? Math.max(...filtered.map((d) => d.value)) : 1);
  let rawMin = $derived(filtered.length > 0 ? Math.min(...filtered.map((d) => d.value)) : 0);

  // Use tight axis when data clusters far from zero (e.g. weight 170-185)
  // but start at 0 when data is near zero or has wide spread
  let niceMin = $derived.by(() => {
    if (rawMin < 0) return -niceNumber(Math.abs(rawMin));
    if (rawMin === 0) return 0;
    const spread = rawMax - rawMin;
    // If the minimum is more than 2x the spread above zero, tighten the axis
    if (rawMin > spread * 2 && rawMin > 10) {
      const step = niceNumber(spread / 4) || 1;
      const result = Math.floor((rawMin - spread * 0.3) / step) * step;
      // Safety: never exceed rawMin
      return Math.min(result, rawMin);
    }
    return 0;
  });
  // niceNumber can round down, so ensure niceMax always exceeds rawMax
  let niceMax = $derived.by(() => {
    let n = niceNumber(rawMax * 1.05);
    while (n < rawMax) n += niceNumber((rawMax - n) || 1);
    return n;
  });
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
  let containerWidth = $state(300);
  let chartWidth = $derived(Math.max(containerWidth, 100));

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

  let labelStep = $derived(Math.max(1, Math.floor(filtered.length / 8)));

  // Tooltip state
  let hoveredIndex: number | null = $state(null);
  let svgEl: SVGSVGElement | undefined = $state(undefined);

  function handlePointerMove(e: PointerEvent) {
    if (!svgEl || filtered.length === 0) return;
    const rect = svgEl.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const scaleX = chartWidth / rect.width;
    const svgX = relX * scaleX;

    // Find closest point
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < filtered.length; i++) {
      const dist = Math.abs(x(i) - svgX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    }
    hoveredIndex = closest;
  }

  function handlePointerLeave() {
    hoveredIndex = null;
  }

  function formatValue(v: number): string {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(1);
  }
</script>

{#if filtered.length > 0}
  {@const tickArr = ticks()}
  <div bind:clientWidth={containerWidth} style="overflow-x: hidden; position: relative;">
    <svg
      bind:this={svgEl}
      width="100%"
      viewBox="0 0 {chartWidth} {height + 20}"
      preserveAspectRatio="xMidYMid meet"
      style="max-height: {height + 20}px; touch-action: pan-y;"
      onpointermove={handlePointerMove}
      onpointerleave={handlePointerLeave}
    >
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
          <circle
            cx={x(i)} cy={y(point.value)} r={hoveredIndex === i ? 5 : 3}
            fill={hoveredIndex === i ? '#fff' : color}
            stroke={hoveredIndex === i ? color : 'none'}
            stroke-width="2"
          />
        {/each}
      {/if}

      <!-- Hover crosshair -->
      {#if hoveredIndex !== null}
        <line
          x1={x(hoveredIndex)} y1={padding / 2}
          x2={x(hoveredIndex)} y2={height - padding / 2}
          stroke="#525252" stroke-width="1" stroke-dasharray="3,3"
        />
      {/if}

      <!-- X labels -->
      {#each filtered as point, i}
        {#if i % labelStep === 0 || i === filtered.length - 1}
          <text x={x(i)} y={height + 10} text-anchor="middle" fill="#525252" font-size="8">
            {point.label}
          </text>
        {/if}
      {/each}
    </svg>

    <!-- Tooltip -->
    {#if hoveredIndex !== null}
      {@const pt = filtered[hoveredIndex]}
      {@const tipX = x(hoveredIndex)}
      {@const pct = tipX / chartWidth * 100}
      <div
        class="absolute pointer-events-none px-2 py-1 rounded-lg text-xs font-medium shadow-lg"
        style="
          background-color: #262626;
          color: #e5e5e5;
          top: 0;
          left: {pct}%;
          transform: translateX({pct > 75 ? '-100%' : pct < 25 ? '0%' : '-50%'});
          white-space: nowrap;
        "
      >
        {formatValue(pt.value)}{unit ? ` ${unit}` : ''} <span style="color: #737373;">{pt.label}</span>
      </div>
    {/if}
  </div>
{:else}
  <p class="text-neutral-500 text-sm text-center py-4">No data yet</p>
{/if}
