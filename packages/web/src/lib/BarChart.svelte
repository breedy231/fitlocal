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

  let maxVal = $derived(Math.max(...data.map((d) => d.value), 1));
</script>

{#if data.length > 0}
  <svg viewBox="0 0 {data.length * 40 + 20} {height + 30}" class="w-full" style="max-height: {height + 40}px;">
    {#each data as bar, i}
      {@const barHeight = (bar.value / maxVal) * height}
      <rect
        x={i * 40 + 14}
        y={height - barHeight}
        width="24"
        rx="4"
        height={barHeight}
        fill={color}
        opacity="0.85"
      />
      <text
        x={i * 40 + 26}
        y={height - barHeight - 4}
        text-anchor="middle"
        fill="#a3a3a3"
        font-size="10"
      >
        {Math.round(bar.value)}{unit}
      </text>
      <text
        x={i * 40 + 26}
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
