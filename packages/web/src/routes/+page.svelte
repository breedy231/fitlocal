<script lang="ts">
  import { api } from '$lib/api';
  import { onMount } from 'svelte';

  let workouts: any[] = $state([]);
  let loading = $state(true);

  onMount(async () => {
    try {
      workouts = await api('/workouts');
    } catch {
      // API not running yet
    } finally {
      loading = false;
    }
  });
</script>

<div class="p-4 max-w-lg mx-auto">
  <h1 class="text-2xl font-bold mb-6">FitLocal</h1>

  {#if loading}
    <p class="text-slate-400">Loading...</p>
  {:else if workouts.length === 0}
    <div class="text-center py-12">
      <p class="text-slate-400 mb-4">No workouts yet</p>
      <a href="/log" class="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg">
        Start a Workout
      </a>
    </div>
  {:else}
    <div class="space-y-3">
      {#each workouts as workout}
        <a href="/workouts/{workout.id}" class="block bg-slate-800 rounded-lg p-4 hover:bg-slate-750">
          <div class="flex justify-between items-center">
            <span class="font-medium">{workout.date}</span>
            {#if workout.locationProfile}
              <span class="text-xs bg-slate-700 px-2 py-1 rounded">{workout.locationProfile}</span>
            {/if}
          </div>
          {#if workout.notes}
            <p class="text-sm text-slate-400 mt-1">{workout.notes}</p>
          {/if}
        </a>
      {/each}
    </div>
  {/if}
</div>
