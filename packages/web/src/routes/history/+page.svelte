<script lang="ts">
  import { api } from '$lib/api';
  import { onMount } from 'svelte';

  interface Workout {
    id: number;
    date: string;
    notes?: string;
    exercises?: { exercise?: { name: string }; sets?: any[] }[];
  }

  let workouts: Workout[] = $state([]);
  let loading = $state(true);
  let expandedId: number | null = $state(null);

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function toggleExpand(id: number) {
    expandedId = expandedId === id ? null : id;
  }

  onMount(async () => {
    try {
      const data = await api<Workout[]>('/workouts');
      // Reverse for newest first
      workouts = [...data].reverse();
      // Fetch details for display
      const detailed = await Promise.all(
        workouts.slice(0, 20).map(w => api<Workout>(`/workouts/${w.id}`).catch(() => w))
      );
      for (const d of detailed) {
        const idx = workouts.findIndex(w => w.id === d.id);
        if (idx !== -1) workouts[idx] = d;
      }
    } catch {
      // API not running
    } finally {
      loading = false;
    }
  });
</script>

<div class="p-4 max-w-lg mx-auto">
  <h1 class="text-2xl font-bold mb-6">History</h1>

  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if workouts.length === 0}
    <div class="rounded-xl p-6 text-center" style="background-color: #1a1a1a;">
      <p class="text-neutral-500">No workout history yet.</p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each workouts as workout}
        <button
          onclick={() => toggleExpand(workout.id)}
          class="w-full text-left rounded-xl p-4 transition-colors"
          style="background-color: #1a1a1a;"
        >
          <div class="flex justify-between items-center">
            <div>
              <span class="font-medium">{formatDate(workout.date)}</span>
              {#if workout.notes}
                <span class="ml-2 text-sm text-neutral-500">{workout.notes}</span>
              {/if}
            </div>
            <div class="flex items-center gap-3 text-sm text-neutral-500">
              {#if workout.exercises}
                <span>{workout.exercises.length} exercises</span>
                <span>{workout.exercises.reduce((sum, e) => sum + (e.sets?.length ?? 0), 0)} sets</span>
              {/if}
              <svg class="w-4 h-4 transition-transform {expandedId === workout.id ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </div>
          </div>

          {#if expandedId === workout.id && workout.exercises}
            <div class="mt-3 pt-3 border-t border-neutral-800 space-y-1">
              {#each workout.exercises as we}
                <div class="text-sm text-neutral-400">
                  {we.exercise?.name ?? 'Unknown exercise'}
                  {#if we.sets && we.sets.length > 0}
                    <span class="text-neutral-600">— {we.sets.length} sets</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
