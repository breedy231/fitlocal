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

  // Multi-select edit mode
  let editMode = $state(false);
  let selectedIds: Set<number> = $state(new Set());
  let bulkDeleteConfirm = $state(false);

  // Error toast
  let errorMessage = $state('');
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;

  function showError(msg: string) {
    errorMessage = msg;
    if (errorTimeout) clearTimeout(errorTimeout);
    errorTimeout = setTimeout(() => { errorMessage = ''; }, 3000);
  }

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

  function toggleSelect(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  function toggleEditMode() {
    editMode = !editMode;
    if (!editMode) {
      selectedIds = new Set();
    }
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showError(`Failed to delete workout: ${msg}`);
    } finally {
      deleting = false;
    }
  }

  async function bulkDelete() {
    const ids = [...selectedIds];
    deleting = true;
    try {
      await api('/workouts/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      workouts = workouts.filter(w => !selectedIds.has(w.id));
      selectedIds = new Set();
      editMode = false;
      bulkDeleteConfirm = false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showError(`Failed to delete workouts: ${msg}`);
    } finally {
      deleting = false;
    }
  }

  onMount(loadWorkouts);
</script>

<div class="p-4 max-w-lg mx-auto pb-20">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold">History</h1>
    <div class="flex items-center gap-2">
      <button
        onclick={toggleEditMode}
        class="px-4 py-2 rounded-xl text-sm font-medium {editMode ? 'bg-neutral-700 text-white' : 'bg-neutral-800 text-neutral-300'}"
      >
        {editMode ? 'Done' : 'Edit'}
      </button>
      <a
        href="/history/new"
        class="px-4 py-2 rounded-xl text-sm font-medium"
        style="background-color: #22c55e; color: #0f0f0f;"
      >
        + Log Workout
      </a>
    </div>
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
            onclick={() => editMode ? toggleSelect(workout.id) : toggleExpand(workout.id)}
            class="w-full text-left p-4"
          >
            <div class="flex justify-between items-center">
              <div class="flex items-center gap-3">
                {#if editMode}
                  <div class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 {selectedIds.has(workout.id) ? 'bg-green-500 border-green-500' : 'border-neutral-600'}">
                    {#if selectedIds.has(workout.id)}
                      <svg class="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
                      </svg>
                    {/if}
                  </div>
                {/if}
                <div>
                  <span class="font-medium">{formatDate(workout.date)}</span>
                  {#if workout.notes}
                    <span class="ml-2 text-sm text-neutral-500">{workout.notes}</span>
                  {/if}
                </div>
              </div>
              <div class="flex items-center gap-3 text-sm text-neutral-500">
                <span>{workout.exerciseCount ?? workout.exercises?.length ?? 0} exercises</span>
                <span>{workout.setCount ?? workout.exercises?.reduce((sum, e) => sum + (e.sets?.length ?? 0), 0) ?? 0} sets</span>
                {#if !editMode}
                  <svg class="w-4 h-4 transition-transform {expandedId === workout.id ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                {/if}
              </div>
            </div>
          </button>

          {#if !editMode && expandedId === workout.id}
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

<!-- Sticky bulk delete bar -->
{#if editMode && workouts.length > 0}
  <div class="fixed bottom-0 left-0 right-0 p-4 z-40" style="background: linear-gradient(transparent, #0f0f0f 30%);">
    <div class="max-w-lg mx-auto">
      <button
        onclick={() => bulkDeleteConfirm = true}
        disabled={selectedIds.size === 0}
        class="w-full py-3 rounded-xl text-sm font-medium transition-colors {selectedIds.size > 0 ? 'bg-red-500 text-white' : 'bg-neutral-800 text-neutral-600 cursor-not-allowed'}"
      >
        Delete Selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
      </button>
    </div>
  </div>
{/if}

<!-- Error toast -->
{#if errorMessage}
  <div class="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500/90 text-white shadow-lg max-w-sm text-center">
    {errorMessage}
  </div>
{/if}

<!-- Single delete confirmation dialog -->
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

<!-- Bulk delete confirmation dialog -->
{#if bulkDeleteConfirm}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    style="background-color: rgba(0,0,0,0.6); backdrop-filter: blur(4px);"
    onclick={() => bulkDeleteConfirm = false}
  >
    <div
      class="mx-4 w-full max-w-sm rounded-2xl p-6"
      style="background-color: #1a1a1a;"
      onclick={(e) => e.stopPropagation()}
    >
      <h3 class="text-lg font-semibold mb-2">Delete {selectedIds.size} Workouts</h3>
      <p class="text-sm text-neutral-400 mb-6">Delete {selectedIds.size} workouts? This cannot be undone.</p>
      <div class="flex gap-3">
        <button
          onclick={() => bulkDeleteConfirm = false}
          class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-neutral-700 text-neutral-200"
        >
          Cancel
        </button>
        <button
          onclick={bulkDelete}
          disabled={deleting}
          class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : `Delete ${selectedIds.size}`}
        </button>
      </div>
    </div>
  </div>
{/if}
