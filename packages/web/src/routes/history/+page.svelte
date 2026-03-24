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

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function toggleExpand(id: number) {
    expandedId = expandedId === id ? null : id;
  }

  async function loadWorkouts() {
    try {
      const data = await api<Workout[]>('/workouts');
      workouts = [...data].reverse();
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
    }
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
                <div class="pt-2 pb-3 border-t border-neutral-800 space-y-1">
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
