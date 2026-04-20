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
  let niceMax = $derived(Math.max(niceNumber(maxVal * 1.1), maxVal + 1));
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
  let containerWidth = $state(300);
  let chartWidth = $derived(Math.max(containerWidth, 100));
  let barAreaWidth = $derived(chartWidth - yAxisWidth - 10);
  let barSlotWidth = $derived(data.length > 0 ? barAreaWidth / data.length : 40);
  let barWidth = $derived(Math.max(Math.min(barSlotWidth * 0.6, 28), 6));
  let labelStep = $derived(
    data.length > 8 ? Math.ceil(data.length / 8) : 1
  );

  // Tooltip state
  let hoveredIndex: number | null = $state(null);
  let svgEl: SVGSVGElement | undefined = $state(undefined);

  function handlePointerMove(e: PointerEvent) {
    if (!svgEl || data.length === 0) return;
    const rect = svgEl.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const scaleX = chartWidth / rect.width;
    const svgX = relX * scaleX;

    // Find which bar slot we're in
    const idx = Math.floor((svgX - yAxisWidth) / barSlotWidth);
    hoveredIndex = idx >= 0 && idx < data.length ? idx : null;
  }

  function handlePointerLeave() {
    hoveredIndex = null;
  }

  function formatValue(v: number): string {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(1);
  }
</script>

{#if data.length > 0}
  {@const tickArr = ticks()}
  {@const topPad = 20}
  <div bind:clientWidth={containerWidth} style="overflow: visible; position: relative;">
    <svg
      bind:this={svgEl}
      width="100%"
      viewBox="0 0 {chartWidth} {height + topPad + 30}"
      preserveAspectRatio="xMidYMid meet"
      style="max-height: {height + topPad + 40}px; touch-action: pan-y;"
      onpointermove={handlePointerMove}
      onpointerleave={handlePointerLeave}
    >
      <!-- Y-axis grid lines and labels -->
      {#each tickArr as tick}
        {@const ty = topPad + height - (tick / niceMax) * height}
        <line
          x1={yAxisWidth}
          y1={ty}
          x2={chartWidth}
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
        {@const barX = yAxisWidth + i * barSlotWidth + (barSlotWidth - barWidth) / 2}
        {@const barCenter = yAxisWidth + i * barSlotWidth + barSlotWidth / 2}
        {@const barHeight = (bar.value / niceMax) * height}
        <rect
          x={barX}
          y={topPad + height - barHeight}
          width={barWidth}
          rx="4"
          height={barHeight}
          fill={color}
          opacity={hoveredIndex === i ? 1 : 0.85}
        />
        <!-- Show value above bar only when hovered or few bars -->
        {#if hoveredIndex === i || data.length <= 14}
          <text
            x={barCenter}
            y={topPad + height - barHeight - 4}
            text-anchor="middle"
            fill={hoveredIndex === i ? '#e5e5e5' : '#a3a3a3'}
            font-size={hoveredIndex === i ? '11' : '10'}
            font-weight={hoveredIndex === i ? '600' : '400'}
          >
            {formatValue(bar.value)}{unit}
          </text>
        {/if}
        {#if i % labelStep === 0 || i === data.length - 1}
          <text
            x={barCenter}
            y={topPad + height + 14}
            text-anchor="middle"
            fill="#525252"
            font-size="9"
          >
            {bar.label}
          </text>
        {/if}
      {/each}
    </svg>

    <!-- Tooltip for many-bar charts -->
    {#if hoveredIndex !== null && data.length > 14}
      {@const bar = data[hoveredIndex]}
      {@const barCenter = yAxisWidth + hoveredIndex * barSlotWidth + barSlotWidth / 2}
      {@const pct = barCenter / chartWidth * 100}
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
        {formatValue(bar.value)}{unit ? ` ${unit}` : ''} <span style="color: #737373;">{bar.label}</span>
      </div>
    {/if}
  </div>
{:else}
  <p class="text-neutral-500 text-sm text-center py-4">No data yet</p>
{/if}
