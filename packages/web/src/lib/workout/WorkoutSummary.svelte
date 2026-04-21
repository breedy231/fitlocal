<script lang="ts">
  import NutritionCard from '$lib/NutritionCard.svelte';
  import type { NutritionData } from 'fitlocal-shared';

  export interface ExerciseSummary {
    name: string;
    sets: number;
    avgWeightLbs: number;
    bestSetLbs: number;
    bestReps: number;
    isPR: boolean;
    avgRir: number | null;
  }

  export interface WorkoutSummaryData {
    totalSets: number;
    totalVolumeLbs: number;
    exerciseCount: number;
    durationMin: number;
    prCount: number;
    exercises: ExerciseSummary[];
  }

  interface Props {
    summary: WorkoutSummaryData;
    workoutDate: string;
    nutritionData: NutritionData | null;
    effortRating: number;
    onEffortChange: (rating: number) => void;
    onDone: () => void;
  }

  let { summary, workoutDate, nutritionData, effortRating, onEffortChange, onDone }: Props = $props();

  async function generateShareCard() {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, 600, 800);

    // Header accent
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(0, 0, 600, 4);

    // Date
    ctx.fillStyle = '#6b7280';
    ctx.font = '16px system-ui, -apple-system, sans-serif';
    ctx.fillText(new Date(workoutDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), 32, 48);

    // Title
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 32px system-ui, -apple-system, sans-serif';
    ctx.fillText('Workout Complete', 32, 96);

    // Stats grid
    const stats = [
      { label: 'Sets', value: String(summary.totalSets) },
      { label: 'Volume', value: `${summary.totalVolumeLbs.toLocaleString()} lbs` },
      { label: 'Exercises', value: String(summary.exerciseCount) },
      { label: 'Duration', value: `${summary.durationMin} min` },
    ];

    let y = 140;
    for (let i = 0; i < stats.length; i += 2) {
      for (let j = 0; j < 2; j++) {
        const s = stats[i + j];
        const x = 32 + j * 280;
        // Card bg
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.roundRect(x, y, 256, 80, 12);
        ctx.fill();
        // Value
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
        ctx.fillText(s.value, x + 16, y + 40);
        // Label
        ctx.fillStyle = '#6b7280';
        ctx.font = '14px system-ui, -apple-system, sans-serif';
        ctx.fillText(s.label, x + 16, y + 64);
      }
      y += 96;
    }

    // Exercises
    y += 16;
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText('EXERCISES', 32, y);
    y += 24;

    for (const ex of summary.exercises.slice(0, 8)) {
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '16px system-ui, -apple-system, sans-serif';
      ctx.fillText(ex.name, 32, y);
      ctx.fillStyle = '#6b7280';
      ctx.font = '14px system-ui, -apple-system, sans-serif';
      const detail = `${ex.sets} sets @ ${ex.avgWeightLbs} lbs`;
      ctx.fillText(detail, 600 - 32 - ctx.measureText(detail).width, y);
      y += 32;
    }

    // Footer branding
    ctx.fillStyle = '#374151';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText('FitLocal', 32, 770);

    // Export
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({
            files: [new File([blob], 'workout.png', { type: 'image/png' })],
            title: 'Workout Complete',
          });
          return;
        } catch { /* user cancelled or share not supported */ }
      }
      // Fallback: download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workout-${workoutDate}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }
</script>

<div class="py-6">
  <div class="text-center mb-8">
    <div class="text-4xl mb-2">&#128170;</div>
    <h1 class="text-2xl font-bold text-green-400">Great Work!</h1>
  </div>

  <!-- PR callout -->
  {#if summary.prCount > 0}
    <div class="rounded-xl p-4 mb-4 border border-amber-500/30" style="background-color: #1a1a1a;">
      <div class="flex items-center gap-2 text-amber-400 font-bold">
        <span class="text-lg">NEW PR{summary.prCount > 1 ? 's' : ''}</span>
      </div>
      <div class="mt-2 space-y-1">
        {#each summary.exercises.filter(e => e.isPR) as ex}
          <div class="text-sm text-amber-300/80">{ex.name} — {ex.bestSetLbs} lbs x {ex.bestReps}</div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="grid grid-cols-2 gap-3 mb-6">
    <div class="rounded-xl p-4 text-center" style="background-color: #1a1a1a;">
      <div class="text-2xl font-bold text-green-400">{summary.totalSets}</div>
      <div class="text-xs text-neutral-500 mt-1">Total Sets</div>
    </div>
    <div class="rounded-xl p-4 text-center" style="background-color: #1a1a1a;">
      <div class="text-2xl font-bold text-green-400">{summary.totalVolumeLbs.toLocaleString()}</div>
      <div class="text-xs text-neutral-500 mt-1">Volume (lbs)</div>
    </div>
    <div class="rounded-xl p-4 text-center" style="background-color: #1a1a1a;">
      <div class="text-2xl font-bold text-green-400">{summary.exerciseCount}</div>
      <div class="text-xs text-neutral-500 mt-1">Exercises</div>
    </div>
    <div class="rounded-xl p-4 text-center" style="background-color: #1a1a1a;">
      <div class="text-2xl font-bold text-green-400">{summary.durationMin}</div>
      <div class="text-xs text-neutral-500 mt-1">Minutes</div>
    </div>
  </div>

  <div class="rounded-xl p-4 mb-6" style="background-color: #1a1a1a;">
    <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Exercises</h2>
    <div class="space-y-2">
      {#each summary.exercises as ex}
        <div class="flex justify-between items-center text-sm gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            {#if ex.isPR}
              <span class="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 shrink-0">PR</span>
            {/if}
            <span class="text-neutral-200 truncate">{ex.name}</span>
          </div>
          <div class="text-neutral-500 shrink-0 text-right">
            <span>{ex.sets}s @ {ex.bestSetLbs} lbs</span>
            {#if ex.avgRir != null}
              <span class="text-neutral-600 ml-1">· {ex.avgRir} RIR</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Daily Nutrition (if goals are set) -->
  {#if nutritionData && nutritionData.calories.target != null}
    <div class="mb-6">
      <NutritionCard data={nutritionData} />
    </div>
  {/if}

  <!-- Effort Rating -->
  <div class="rounded-xl p-4 mb-6" style="background-color: #1a1a1a;">
    <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">How hard was that?</h2>
    <div class="flex justify-between mb-2">
      {#each [1,2,3,4,5,6,7,8,9,10] as n}
        <button
          onclick={() => onEffortChange(n)}
          class="w-8 h-8 rounded-full text-xs font-bold transition-all {effortRating === n
            ? n <= 3 ? 'bg-green-500 text-black scale-110' : n <= 6 ? 'bg-yellow-500 text-black scale-110' : n <= 8 ? 'bg-orange-500 text-black scale-110' : 'bg-red-500 text-black scale-110'
            : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700'}"
        >{n}</button>
      {/each}
    </div>
    <div class="flex justify-between text-xs text-neutral-600">
      <span>Easy</span>
      <span>Moderate</span>
      <span>Max effort</span>
    </div>
  </div>

  <div class="flex gap-3">
    <button
      onclick={generateShareCard}
      class="py-4 px-6 rounded-xl text-sm font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors flex items-center gap-2"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
      </svg>
      Share
    </button>
    <button
      onclick={onDone}
      class="flex-1 font-semibold text-lg py-4 rounded-xl"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      Done
    </button>
  </div>
</div>
