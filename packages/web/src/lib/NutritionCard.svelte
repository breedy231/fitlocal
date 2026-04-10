<script lang="ts">
  interface NutritionData {
    date: string;
    snapshotDate?: string;
    isStale?: boolean;
    calories: { current: number | null; target: number | null };
    protein: { current: number | null; target: number | null };
    isInCut: boolean;
    deficitMagnitude: number | null;
    deficitPct: number | null;
  }

  let { data }: { data: NutritionData } = $props();

  function pct(current: number | null, target: number | null): number {
    if (current == null || target == null || target <= 0) return 0;
    return Math.min(current / target, 1.5);
  }

  function barColor(current: number | null, target: number | null, isProtein: boolean): string {
    if (current == null || target == null) return '#525252';
    const ratio = current / target;
    if (isProtein) {
      return ratio >= 0.9 ? '#22c55e' : ratio >= 0.7 ? '#f59e0b' : '#ef4444';
    }
    // Calories: on target is green, over is amber, way under is red
    if (ratio > 1.1) return '#f59e0b';
    if (ratio < 0.7) return '#ef4444';
    return '#22c55e';
  }
</script>

<div class="rounded-xl p-4" style="background-color: #1a1a1a;">
  <div class="flex items-center justify-between mb-3">
    <div>
      <h3 class="text-sm font-medium text-neutral-400 uppercase tracking-wide">Daily Nutrition</h3>
      {#if data.isStale && data.snapshotDate}
        <p class="text-xs text-neutral-500 mt-0.5">as of {new Date(data.snapshotDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
      {/if}
    </div>
    {#if data.deficitMagnitude != null && data.deficitMagnitude > 0}
      <span class="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">
        -{data.deficitMagnitude} cal deficit
      </span>
    {:else if data.deficitMagnitude != null && data.deficitMagnitude < 0}
      <span class="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
        +{Math.abs(data.deficitMagnitude)} cal surplus
      </span>
    {/if}
  </div>

  <div class="space-y-3">
    <!-- Calories -->
    <div>
      <div class="flex justify-between text-sm mb-1">
        <span class="text-neutral-300">Calories</span>
        <span class="text-neutral-400">
          {#if data.calories.current != null}
            <span class="text-neutral-200">{data.calories.current}</span>
            {#if data.calories.target} / {data.calories.target}{/if}
          {:else}
            <span class="text-neutral-500">No data yet</span>
          {/if}
        </span>
      </div>
      <div class="h-2 rounded-full overflow-hidden" style="background-color: #262626;">
        <div
          class="h-full rounded-full transition-all duration-500"
          style="width: {Math.min(pct(data.calories.current, data.calories.target) * 100, 100)}%; background-color: {barColor(data.calories.current, data.calories.target, false)};"
        ></div>
      </div>
    </div>

    <!-- Protein -->
    <div>
      <div class="flex justify-between text-sm mb-1">
        <span class="text-neutral-300">Protein</span>
        <span class="text-neutral-400">
          {#if data.protein.current != null}
            <span class="text-neutral-200">{data.protein.current}g</span>
            {#if data.protein.target} / {data.protein.target}g{/if}
          {:else}
            <span class="text-neutral-500">No data yet</span>
          {/if}
        </span>
      </div>
      <div class="h-2 rounded-full overflow-hidden" style="background-color: #262626;">
        <div
          class="h-full rounded-full transition-all duration-500"
          style="width: {Math.min(pct(data.protein.current, data.protein.target) * 100, 100)}%; background-color: {barColor(data.protein.current, data.protein.target, true)};"
        ></div>
      </div>
    </div>
  </div>
</div>
