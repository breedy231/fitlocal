<script lang="ts">
  import { cachedGet } from '$lib/api-cache.svelte';

  interface MuscleRecovery {
    name: string;
    recoveryPct: number;
  }

  interface Workout {
    id: number;
    date: string;
    locationProfile?: string;
    notes?: string;
    exercises?: any[];
  }

  interface ActiveProgram {
    program: { id: number; name: string };
    dayIndex: number;
    totalDays: number;
    day: { name: string; musclesFocus: string | null };
  }

  const recovery = cachedGet<{ muscles: MuscleRecovery[] }>('/recovery-summary');
  const workoutCache = cachedGet<Workout[]>('/workouts?limit=5');
  const programCache = cachedGet<ActiveProgram>('/programs/active');

  let muscles = $derived(recovery.data?.muscles ?? []);
  let workouts = $derived(
    (Array.isArray(workoutCache.data) ? workoutCache.data : []).slice(-5).reverse()
  );
  let activeProgram = $derived(programCache.data);
  let loading = $derived(recovery.loading && workoutCache.loading && programCache.loading);

  function recoveryColor(pct: number): string {
    if (pct > 75) return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (pct > 40) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-red-500/20 text-red-400 border-red-500/30';
  }

  function formatDate(dateStr: string): string {
    // Append T12:00 to avoid UTC midnight → previous day in CDT
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
</script>

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  <h1 class="text-3xl font-bold mb-6">FitLocal</h1>

  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else}
    <!-- Recovery Section -->
    {#if muscles.length > 0}
      <section class="mb-6">
        <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Muscle Recovery</h2>
        <div class="flex flex-wrap gap-2">
          {#each muscles as muscle}
            <span class="px-3 py-1.5 rounded-full text-sm font-medium border {recoveryColor(muscle.recoveryPct)}">
              {muscle.name} {Math.round(muscle.recoveryPct)}%
            </span>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Active Program -->
    {#if activeProgram}
      <a href="/generate" class="block rounded-xl p-4 mb-4 border border-green-500/30" style="background-color: #22c55e08;">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-green-400 uppercase tracking-wider">{activeProgram.program.name}</span>
            <p class="font-medium mt-1">{activeProgram.day.name}</p>
            {#if activeProgram.day.musclesFocus}
              <p class="text-sm text-neutral-400 mt-0.5">{activeProgram.day.musclesFocus}</p>
            {/if}
          </div>
          <div class="text-right">
            <p class="text-xs text-neutral-600">Day {activeProgram.dayIndex + 1} of {activeProgram.totalDays}</p>
            <span class="text-sm text-green-400 font-medium">Start &rarr;</span>
          </div>
        </div>
      </a>
    {/if}

    <!-- Generate Button -->
    <a
      href="/generate"
      class="block w-full text-center font-semibold text-lg py-4 rounded-xl mb-6"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      {activeProgram ? 'Generate Freestyle Workout' : 'Generate Workout'}
    </a>

    <!-- Recent Workouts -->
    <section>
      <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Recent Workouts</h2>
      {#if workouts.length === 0}
        <div class="rounded-xl p-6 text-center" style="background-color: #1a1a1a;">
          <p class="text-neutral-500">No workouts yet. Import your data or generate one!</p>
        </div>
      {:else}
        <div class="space-y-2">
          {#each workouts as workout}
            <a href="/history/{workout.id}/edit" class="rounded-xl p-4 flex justify-between items-center active:opacity-70 transition-opacity" style="background-color: #1a1a1a; display: flex;">
              <div>
                <span class="font-medium">{formatDate(workout.date)}</span>
                {#if workout.notes}
                  <p class="text-sm text-neutral-500 mt-0.5">{workout.notes}</p>
                {/if}
              </div>
              <div class="flex items-center gap-2">
                {#if workout.locationProfile}
                  <span class="text-xs px-2 py-1 rounded bg-neutral-800 text-neutral-400">{workout.locationProfile}</span>
                {/if}
                <svg class="w-4 h-4 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                </svg>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>
