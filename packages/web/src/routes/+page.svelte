<script lang="ts">
  import { api } from '$lib/api';
  import { onMount } from 'svelte';

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

  let muscles: MuscleRecovery[] = $state([]);
  let workouts: Workout[] = $state([]);
  let loading = $state(true);

  function recoveryColor(pct: number): string {
    if (pct > 75) return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (pct > 40) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-red-500/20 text-red-400 border-red-500/30';
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  onMount(async () => {
    try {
      const [recoveryData, workoutData] = await Promise.all([
        api<{ muscles: MuscleRecovery[] }>('/recovery-summary').catch(() => ({ muscles: [] })),
        api<Workout[]>('/workouts?limit=5').catch(() => []),
      ]);
      muscles = recoveryData.muscles || [];
      workouts = (Array.isArray(workoutData) ? workoutData : []).slice(-5).reverse();
    } catch {
      // API not running
    } finally {
      loading = false;
    }
  });
</script>

<div class="p-4 max-w-lg mx-auto">
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

    <!-- Generate Button -->
    <a
      href="/generate"
      class="block w-full text-center font-semibold text-lg py-4 rounded-xl mb-6"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      Generate Workout
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
            <div class="rounded-xl p-4 flex justify-between items-center" style="background-color: #1a1a1a;">
              <div>
                <span class="font-medium">{formatDate(workout.date)}</span>
                {#if workout.notes}
                  <p class="text-sm text-neutral-500 mt-0.5">{workout.notes}</p>
                {/if}
              </div>
              {#if workout.locationProfile}
                <span class="text-xs px-2 py-1 rounded bg-neutral-800 text-neutral-400">{workout.locationProfile}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>
