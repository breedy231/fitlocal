<script lang="ts">
  interface RingData {
    label: string;
    current: number;
    target: number;
    color: string;
    unit?: string;
  }

  let { rings }: { rings: RingData[] } = $props();

  const SIZE = 90;
  const STROKE = 8;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  function pct(current: number, target: number): number {
    if (target <= 0) return 0;
    return Math.min(current / target, 1.5); // cap at 150% for overflow visual
  }

  function offset(current: number, target: number): number {
    return CIRCUMFERENCE * (1 - Math.min(pct(current, target), 1));
  }
</script>

<div class="flex justify-around items-start gap-2">
  {#each rings as ring}
    {@const fill = pct(ring.current, ring.target)}
    {@const isComplete = fill >= 1}
    <div class="flex flex-col items-center gap-1.5">
      <div class="relative" style="width: {SIZE}px; height: {SIZE}px;">
        <svg width={SIZE} height={SIZE} class="transform -rotate-90">
          <!-- Background track -->
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none" stroke="#262626" stroke-width={STROKE}
          />
          <!-- Fill arc -->
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none" stroke={ring.color} stroke-width={STROKE}
            stroke-linecap="round"
            stroke-dasharray={CIRCUMFERENCE}
            stroke-dashoffset={offset(ring.current, ring.target)}
            style="transition: stroke-dashoffset 1s ease-out;"
            opacity={isComplete ? 1 : 0.85}
          />
          <!-- Overflow arc (>100%) -->
          {#if fill > 1}
            <circle
              cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
              fill="none" stroke={ring.color} stroke-width={STROKE}
              stroke-linecap="round"
              stroke-dasharray={CIRCUMFERENCE}
              stroke-dashoffset={CIRCUMFERENCE * (1 - (fill - 1))}
              style="transition: stroke-dashoffset 1s ease-out;"
              opacity="0.5"
            />
          {/if}
        </svg>
        <!-- Center text -->
        <div class="absolute inset-0 flex items-center justify-center">
          <span class="text-sm font-bold" style="color: {ring.color};">
            {ring.current}{ring.unit ?? ''}/{ring.target}
          </span>
        </div>
      </div>
      <span class="text-[11px] text-neutral-500 font-medium">{ring.label}</span>
    </div>
  {/each}
</div>
