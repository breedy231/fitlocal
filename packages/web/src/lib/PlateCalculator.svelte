<script lang="ts">
  let { weightLbs = 0, onclose, onapply }: { weightLbs: number; onclose: () => void; onapply?: (lbs: number) => void } = $props();

  const BAR_WEIGHT_LBS = 45;
  const PLATES = [45, 35, 25, 10, 5, 2.5];
  const PLATE_COLORS: Record<number, string> = {
    45: '#ef4444',
    35: '#f59e0b',
    25: '#22c55e',
    10: '#3b82f6',
    5: '#8b5cf6',
    2.5: '#ec4899',
  };

  interface PlateCount {
    weight: number;
    count: number;
    color: string;
  }

  let targetLbs = $state(weightLbs);

  let plates = $derived.by((): PlateCount[] => {
    let remaining = (targetLbs - BAR_WEIGHT_LBS) / 2;
    if (remaining <= 0) return [];
    const result: PlateCount[] = [];
    for (const plate of PLATES) {
      const count = Math.floor(remaining / plate);
      if (count > 0) {
        result.push({ weight: plate, count, color: PLATE_COLORS[plate] });
        remaining -= count * plate;
      }
    }
    return result;
  });

  let achievable = $derived(
    plates.reduce((sum, p) => sum + p.weight * p.count, 0) * 2 + BAR_WEIGHT_LBS
  );

  function adjustTarget(delta: number) {
    targetLbs = Math.max(BAR_WEIGHT_LBS, targetLbs + delta);
  }
</script>

<div class="fixed inset-0 z-50 flex items-end justify-center">
  <button class="absolute inset-0 bg-black/60" onclick={onclose} aria-label="Close"></button>
  <div class="relative w-full max-w-lg bg-neutral-900 rounded-t-2xl p-5 pb-8">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">Plate Calculator</h2>
      <button onclick={onclose} class="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800" aria-label="Close">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
    </div>

    <!-- Weight adjuster -->
    <div class="flex items-center justify-center gap-4 mb-6">
      <button
        onclick={() => adjustTarget(-5)}
        class="w-10 h-10 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-xl active:bg-neutral-700"
      >−</button>
      <div class="text-center">
        <div class="text-3xl font-bold text-white">{targetLbs}</div>
        <div class="text-xs text-neutral-500">lbs total</div>
      </div>
      <button
        onclick={() => adjustTarget(5)}
        class="w-10 h-10 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-xl active:bg-neutral-700"
      >+</button>
    </div>

    {#if targetLbs <= BAR_WEIGHT_LBS}
      <p class="text-center text-neutral-500 text-sm">Bar only ({BAR_WEIGHT_LBS} lbs)</p>
    {:else}
      <!-- Visual plate diagram -->
      <div class="flex items-center justify-center gap-1 mb-5 h-24">
        <!-- Left plates -->
        <div class="flex items-center gap-0.5">
          {#each plates as plate}
            {#each Array(plate.count) as _}
              <div
                class="rounded-sm flex items-center justify-center text-white font-bold text-xs"
                style="background-color: {plate.color}; width: {plate.weight >= 25 ? '20px' : '14px'}; height: {Math.max(40, plate.weight * 1.8)}px;"
              >
                {plate.weight}
              </div>
            {/each}
          {/each}
        </div>

        <!-- Bar -->
        <div class="h-3 rounded-full bg-neutral-500" style="width: 80px;"></div>

        <!-- Right plates (mirrored) -->
        <div class="flex items-center gap-0.5">
          {#each [...plates].reverse() as plate}
            {#each Array(plate.count) as _}
              <div
                class="rounded-sm flex items-center justify-center text-white font-bold text-xs"
                style="background-color: {plate.color}; width: {plate.weight >= 25 ? '20px' : '14px'}; height: {Math.max(40, plate.weight * 1.8)}px;"
              >
                {plate.weight}
              </div>
            {/each}
          {/each}
        </div>
      </div>

      <!-- Plate list -->
      <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
        <p class="text-xs text-neutral-500 mb-3 uppercase tracking-wider">Per side</p>
        <div class="space-y-2">
          {#each plates as plate}
            <div class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-2">
                <div class="w-4 h-4 rounded-sm" style="background-color: {plate.color};"></div>
                <span class="text-neutral-200">{plate.weight} lbs</span>
              </div>
              <span class="text-neutral-400 font-mono">× {plate.count}</span>
            </div>
          {/each}
        </div>
        {#if achievable !== targetLbs}
          <p class="text-xs text-amber-400 mt-3">Closest loadable: {achievable} lbs</p>
        {/if}
      </div>
    {/if}

    {#if onapply && targetLbs !== weightLbs}
      <button
        onclick={() => { onapply?.(achievable); onclose(); }}
        class="w-full mt-4 py-3 rounded-xl text-sm font-semibold transition-colors"
        style="background-color: #22c55e; color: #0f0f0f;"
      >
        Apply {achievable} lbs
      </button>
    {/if}
  </div>
</div>
