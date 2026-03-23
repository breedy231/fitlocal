<script lang="ts">
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';

  let workouts: any[] = $state([]);
  let loading = $state(true);

  import { onMount } from 'svelte';
  onMount(async () => {
    try {
      const data = await api<any[]>('/workouts');
      // Show recent incomplete workouts or prompt to generate
      workouts = [...data].reverse().slice(0, 5);
    } catch {}
    loading = false;
  });
</script>

<div class="p-4 max-w-lg mx-auto">
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
            <span class="font-medium">{new Date(w.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            {#if w.notes}
              <span class="ml-2 text-sm text-neutral-500">{w.notes}</span>
            {/if}
          </a>
        {/each}
      </div>
    {/if}
  {/if}
</div>
