<script lang="ts">
  const KG_TO_LBS = 2.20462;

  interface WeightPoint {
    date: string;
    rawKg: number;
    trendKg: number;
  }

  let {
    points,
    weeklyRateLbs = null,
    targetWeightKg = null,
    height = 180,
  }: {
    points: WeightPoint[];
    weeklyRateLbs?: number | null;
    targetWeightKg?: number | null;
    height?: number;
  } = $props();

  function shortDate(d: string): string {
    const [, m, day] = d.split('-');
    return `${parseInt(m)}/${parseInt(day)}`;
  }

  // Convert to lbs for display
  let rawData = $derived(points.map(p => ({ date: p.date, value: Math.round(p.rawKg * KG_TO_LBS * 10) / 10 })));
  let trendData = $derived(points.map(p => ({ date: p.date, value: Math.round(p.trendKg * KG_TO_LBS * 10) / 10 })));
  let goalLbs = $derived(targetWeightKg != null ? Math.round(targetWeightKg * KG_TO_LBS * 10) / 10 : null);

  // Compute axis bounds from all data (raw + trend + goal)
  let allValues = $derived.by(() => {
    const vals = [...rawData.map(d => d.value), ...trendData.map(d => d.value)];
    if (goalLbs != null) vals.push(goalLbs);
    return vals;
  });
  let rawMin = $derived(allValues.length > 0 ? Math.min(...allValues) : 0);
  let rawMax = $derived(allValues.length > 0 ? Math.max(...allValues) : 1);

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

  let niceMin = $derived.by(() => {
    const spread = rawMax - rawMin;
    if (rawMin > spread * 2 && rawMin > 10) {
      const step = niceNumber(spread / 4) || 1;
      return Math.min(Math.floor((rawMin - spread * 0.3) / step) * step, rawMin);
    }
    return 0;
  });
  let niceMax = $derived.by(() => {
    let n = niceNumber(rawMax * 1.05);
    while (n < rawMax) n += niceNumber((rawMax - n) || 1);
    return n;
  });
  let range = $derived(niceMax - niceMin || 1);
  let tickStep = $derived(niceNumber(range / 4));
  let ticks = $derived.by(() => {
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
    if (rawData.length <= 1) return (chartWidth + yAxisWidth) / 2;
    return yAxisWidth + padding + (i / (rawData.length - 1)) * (chartWidth - yAxisWidth - padding * 2);
  }

  function y(val: number): number {
    return height - padding - ((val - niceMin) / range) * (height - padding * 2);
  }

  // SVG paths
  let rawPathD = $derived(
    rawData.length > 1
      ? rawData.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' ')
      : ''
  );
  let trendPathD = $derived(
    trendData.length > 1
      ? trendData.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' ')
      : ''
  );

  let goalY = $derived(goalLbs != null ? y(goalLbs) : null);

  let labelStep = $derived(Math.max(1, Math.floor(rawData.length / 8)));

  // Tooltip
  let hoveredIndex: number | null = $state(null);
  let svgEl: SVGSVGElement | undefined = $state(undefined);

  function handlePointerMove(e: PointerEvent) {
    if (!svgEl || rawData.length === 0) return;
    const rect = svgEl.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const scaleX = chartWidth / rect.width;
    const svgX = relX * scaleX;
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < rawData.length; i++) {
      const dist = Math.abs(x(i) - svgX);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    }
    hoveredIndex = closest;
  }

  function handlePointerLeave() { hoveredIndex = null; }
</script>

{#if rawData.length > 0}
  <!-- Rate badge -->
  <div class="flex items-center justify-between mb-2">
    <h3 class="text-sm font-medium text-neutral-400">Weight Trend</h3>
    <div class="flex items-center gap-2">
      {#if weeklyRateLbs != null}
        <span class="text-xs px-2 py-0.5 rounded-full {weeklyRateLbs < 0 ? 'bg-green-500/15 text-green-400' : weeklyRateLbs > 0 ? 'bg-red-500/15 text-red-400' : 'bg-neutral-500/15 text-neutral-400'}">
          {weeklyRateLbs > 0 ? '+' : ''}{weeklyRateLbs} lbs/wk
        </span>
      {/if}
      {#if goalLbs != null}
        <span class="text-xs text-neutral-500">Goal: {goalLbs} lbs</span>
      {/if}
    </div>
  </div>

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
      <!-- Grid lines -->
      {#each ticks as tick}
        {@const ty = y(tick)}
        <line x1={yAxisWidth} y1={ty} x2={chartWidth - padding} y2={ty} stroke="#262626" stroke-width="1" />
        <text x={yAxisWidth - 4} y={ty + 3} text-anchor="end" fill="#525252" font-size="8">
          {Number.isInteger(tick) ? tick : tick.toFixed(1)}
        </text>
      {/each}

      <!-- Goal weight line (dashed green) -->
      {#if goalY != null && goalY > padding && goalY < height - padding}
        <line
          x1={yAxisWidth} y1={goalY}
          x2={chartWidth - padding} y2={goalY}
          stroke="#22c55e" stroke-width="1" stroke-dasharray="6,4" opacity="0.5"
        />
        <text x={chartWidth - padding + 2} y={goalY + 3} fill="#22c55e" font-size="7" opacity="0.7">goal</text>
      {/if}

      <!-- Raw data line (faded amber) -->
      {#if rawPathD}
        <path d={rawPathD} fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.35" />
      {/if}

      <!-- Trend line (bold blue) -->
      {#if trendPathD}
        <path d={trendPathD} fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      {/if}

      <!-- Raw dots -->
      {#each rawData as point, i}
        <circle
          cx={x(i)} cy={y(point.value)} r={hoveredIndex === i ? 4 : 2}
          fill={hoveredIndex === i ? '#fff' : '#f59e0b'}
          stroke={hoveredIndex === i ? '#f59e0b' : 'none'}
          stroke-width="2"
          opacity={hoveredIndex === i ? 1 : 0.5}
        />
      {/each}

      <!-- Hover crosshair -->
      {#if hoveredIndex !== null}
        <line
          x1={x(hoveredIndex)} y1={padding / 2}
          x2={x(hoveredIndex)} y2={height - padding / 2}
          stroke="#525252" stroke-width="1" stroke-dasharray="3,3"
        />
      {/if}

      <!-- X labels -->
      {#each rawData as point, i}
        {#if i % labelStep === 0 || i === rawData.length - 1}
          <text x={x(i)} y={height + 10} text-anchor="middle" fill="#525252" font-size="8">
            {shortDate(point.date)}
          </text>
        {/if}
      {/each}
    </svg>

    <!-- Tooltip -->
    {#if hoveredIndex !== null}
      {@const pt = rawData[hoveredIndex]}
      {@const trend = trendData[hoveredIndex]}
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
        {pt.value} lbs
        {#if trend && Math.abs(trend.value - pt.value) >= 0.1}
          <span style="color: #3b82f6;">avg {trend.value}</span>
        {/if}
        <span style="color: #737373;">{shortDate(pt.date)}</span>
      </div>
    {/if}
  </div>

  <!-- Legend -->
  <div class="flex items-center gap-4 mt-1.5 text-xs text-neutral-500">
    <span class="flex items-center gap-1">
      <span class="inline-block w-3 h-0.5 rounded" style="background-color: #f59e0b; opacity: 0.5;"></span>
      Daily
    </span>
    <span class="flex items-center gap-1">
      <span class="inline-block w-3 h-0.5 rounded" style="background-color: #3b82f6;"></span>
      7-day avg
    </span>
    {#if goalLbs != null}
      <span class="flex items-center gap-1">
        <span class="inline-block w-3 h-0.5 rounded border-dashed" style="border-bottom: 1px dashed #22c55e;"></span>
        Goal
      </span>
    {/if}
  </div>
{:else}
  <p class="text-neutral-500 text-sm text-center py-4">No weight data yet</p>
{/if}
