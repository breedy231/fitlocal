<script lang="ts">
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  interface Workout {
    id: number;
    date: string;
    notes?: string;
    exerciseCount: number;
    setCount: number;
    exercises?: { exercise?: { name: string }; sets?: any[] }[];
  }

  let workouts: Workout[] = $state([]);
  let loading = $state(true);
  let expandedId: number | null = $state(null);
  let deleteConfirmId: number | null = $state(null);
  let deleting = $state(false);
  let searchQuery = $state('');
  let searching = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  const KG_TO_LBS = 2.20462;
  function kgToLbs(kg: number | null): number {
    if (!kg) return 0;
    return Math.round((kg * KG_TO_LBS) / 2.5) * 2.5;
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function toggleExpand(id: number) {
    expandedId = expandedId === id ? null : id;
  }

  async function loadWorkouts(exerciseName?: string) {
    try {
      const params = exerciseName ? `?exerciseName=${encodeURIComponent(exerciseName)}` : '';
      const data = await api<Workout[]>(`/workouts${params}`);
      workouts = data;
      // Fetch details for expanded views
      const detailed = await Promise.all(
        workouts.slice(0, 20).map(w => api<Workout>(`/workouts/${w.id}`).catch(() => w))
      );
      for (const d of detailed) {
        const idx = workouts.findIndex(w => w.id === d.id);
        if (idx !== -1) workouts[idx] = { ...workouts[idx], ...d };
      }
    } catch {
      // API not running
    } finally {
      loading = false;
      searching = false;
    }
  }

  function onSearchInput(value: string) {
    searchQuery = value;
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searching = true;
      loadWorkouts(searchQuery || undefined);
    }, 300);
  }

  function clearSearch() {
    searchQuery = '';
    searching = true;
    loadWorkouts();
  }

  async function deleteWorkout(id: number) {
    deleting = true;
    try {
      await api(`/workouts/${id}`, { method: 'DELETE' });
      workouts = workouts.filter(w => w.id !== id);
      deleteConfirmId = null;
    } catch {
      alert('Failed to delete workout');
    } finally {
      deleting = false;
    }
  }

  onMount(loadWorkouts);
</script>

<div class="p-4 max-w-lg mx-auto">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold">History</h1>
    <a
      href="/history/new"
      class="px-4 py-2 rounded-xl text-sm font-medium"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      + Log Workout
    </a>
  </div>

  <!-- Search -->
  <div class="relative mb-4">
    <input
      type="text"
      placeholder="Search by exercise name..."
      value={searchQuery}
      oninput={(e) => onSearchInput(e.currentTarget.value)}
      class="w-full px-4 py-2.5 pr-10 rounded-xl text-sm bg-neutral-800 text-neutral-200 border border-neutral-700 outline-none focus:border-green-500/50 placeholder-neutral-500"
    />
    {#if searchQuery}
      <button
        onclick={clearSearch}
        class="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
    {/if}
    {#if searching}
      <div class="absolute right-3 top-1/2 -translate-y-1/2">
        <div class="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    {/if}
  </div>

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
        <div class="rounded-xl overflow-hidden" style="background-color: #1a1a1a;">
          <button
            onclick={() => toggleExpand(workout.id)}
            class="w-full text-left p-4"
          >
            <div class="flex justify-between items-center">
              <div>
                <span class="font-medium">{formatDate(workout.date)}</span>
                {#if workout.notes}
                  <span class="ml-2 text-sm text-neutral-500">{workout.notes}</span>
                {/if}
              </div>
              <div class="flex items-center gap-3 text-sm text-neutral-500">
                <span>{workout.exerciseCount ?? workout.exercises?.length ?? 0} exercises</span>
                <span>{workout.setCount ?? workout.exercises?.reduce((sum, e) => sum + (e.sets?.length ?? 0), 0) ?? 0} sets</span>
                <svg class="w-4 h-4 transition-transform {expandedId === workout.id ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                </svg>
              </div>
            </div>
          </button>

          {#if expandedId === workout.id}
            <div class="px-4 pb-4">
              {#if workout.exercises}
                <div class="pt-2 pb-3 border-t border-neutral-800 space-y-3">
                  {#each workout.exercises as we}
                    <div>
                      <div class="text-sm font-medium text-neutral-300 mb-1">
                        {#if searchQuery && we.exercise?.name?.toLowerCase().includes(searchQuery.toLowerCase())}
                          {@const name = we.exercise.name}
                          {@const idx = name.toLowerCase().indexOf(searchQuery.toLowerCase())}
                          {name.slice(0, idx)}<span class="text-green-400 font-semibold">{name.slice(idx, idx + searchQuery.length)}</span>{name.slice(idx + searchQuery.length)}
                        {:else}
                          {we.exercise?.name ?? 'Unknown exercise'}
                        {/if}
                      </div>
                      {#if we.sets && we.sets.length > 0}
                        <div class="space-y-0.5 pl-2">
                          {#each we.sets as set, idx}
                            <div class="text-xs {set.isWarmup ? 'text-neutral-600' : 'text-neutral-400'} font-mono">
                              {#if set.isWarmup}<span class="text-neutral-600 mr-1">W</span>{:else}<span class="text-neutral-600 mr-1">{idx + 1}</span>{/if}
                              {set.reps ?? 0} reps
                              {#if set.weightKg && set.weightKg > 0}
                                @ {kgToLbs(set.weightKg)} lbs
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}

              <div class="flex gap-2 pt-2 border-t border-neutral-800">
                <a
                  href="/history/{workout.id}/edit"
                  class="flex-1 py-2 rounded-lg text-sm font-medium text-center bg-neutral-800 text-neutral-200 hover:bg-neutral-700 transition-colors"
                >
                  Edit
                </a>
                <button
                  onclick={() => deleteConfirmId = workout.id}
                  class="flex-1 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Delete confirmation dialog -->
{#if deleteConfirmId !== null}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    style="background-color: rgba(0,0,0,0.6); backdrop-filter: blur(4px);"
    onclick={() => deleteConfirmId = null}
  >
    <div
      class="mx-4 w-full max-w-sm rounded-2xl p-6"
      style="background-color: #1a1a1a;"
      onclick={(e) => e.stopPropagation()}
    >
      <h3 class="text-lg font-semibold mb-2">Delete Workout</h3>
      <p class="text-sm text-neutral-400 mb-6">Delete this workout? This cannot be undone.</p>
      <div class="flex gap-3">
        <button
          onclick={() => deleteConfirmId = null}
          class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-neutral-700 text-neutral-200"
        >
          Cancel
        </button>
        <button
          onclick={() => deleteConfirmId !== null && deleteWorkout(deleteConfirmId)}
          disabled={deleting}
          class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
{/if}
