<script lang="ts">
  import { cachedGet } from '$lib/api-cache.svelte';

  const workoutCache = cachedGet<any[]>('/workouts');
  let workouts = $derived(
    [...(workoutCache.data ?? [])].reverse().slice(0, 5)
  );
  let loading = $derived(workoutCache.loading);
</script>

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  <h1 class="text-2xl font-bold mb-6">Log Workout</h1>

  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else}
    <a
      href="/generate"
      class="block w-full text-center font-semibold py-4 rounded-xl mb-6"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      Generate New Workout
    </a>

    {#if workouts.length > 0}
      <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Continue a Workout</h2>
      <div class="space-y-2">
        {#each workouts as w}
          <a
            href="/log/{w.id}"
            class="block rounded-xl p-4 hover:ring-1 hover:ring-green-500/30 transition-all"
            style="background-color: #1a1a1a;"
          >
            <span class="font-medium">{new Date(w.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            {#if w.notes}
              <span class="ml-2 text-sm text-neutral-500">{w.notes}</span>
            {/if}
          </a>
        {/each}
      </div>
    {/if}
  {/if}
</div>
