<script lang="ts">
  import { api } from '$lib/api';
  import { showToast } from '$lib/toast';

  interface Routine {
    id: number;
    name: string;
    exercises: { exerciseName: string; exerciseId: number | null; targetSets: number; targetReps: string }[];
    createdAt: string;
  }

  let routines: Routine[] = $state([]);
  let loading = $state(true);

  // New routine form
  let showForm = $state(false);
  let newName = $state('');
  let newText = $state('');
  let creating = $state(false);

  async function loadRoutines() {
    loading = true;
    try {
      routines = await api<Routine[]>('/routines');
    } catch {
      showToast('Failed to load routines', 'error');
    } finally {
      loading = false;
    }
  }

  async function createRoutine() {
    if (!newName.trim() || !newText.trim()) return;
    creating = true;
    try {
      const result = await api<{ id: number; matched: number; unmatched: number }>('/routines', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), text: newText.trim() }),
      });
      showToast(`Created routine — ${result.matched} matched, ${result.unmatched} unmatched`, 'success');
      showForm = false;
      newName = '';
      newText = '';
      await loadRoutines();
    } catch (e: any) {
      showToast(e.message || 'Failed to create routine', 'error');
    } finally {
      creating = false;
    }
  }

  async function deleteRoutine(id: number) {
    try {
      await api(`/routines/${id}`, { method: 'DELETE' });
      routines = routines.filter(r => r.id !== id);
      showToast('Routine deleted', 'success');
    } catch {
      showToast('Failed to delete routine', 'error');
    }
  }

  $effect(() => { loadRoutines(); });
</script>

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold">Routines</h1>
    <button
      onclick={() => showForm = !showForm}
      class="px-4 py-2 rounded-xl text-sm font-medium transition-colors {showForm ? 'bg-neutral-700 text-neutral-300' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'}"
    >
      {showForm ? 'Cancel' : '+ New Routine'}
    </button>
  </div>

  {#if showForm}
    <div class="rounded-xl p-4 mb-6 space-y-3" style="background-color: #1a1a1a;">
      <input
        type="text"
        placeholder="Routine name (e.g. Trainer Upper Day)"
        bind:value={newName}
        class="w-full px-3 py-2 rounded-lg bg-neutral-800 text-white text-sm placeholder-neutral-500 border border-neutral-700 focus:outline-none focus:border-green-500"
      />
      <textarea
        placeholder={"Paste exercises, one per line:\n\nBench Press\n3x12 Dumbbell Row\nLateral Raise 3x15\nBicep Curl"}
        bind:value={newText}
        rows="8"
        class="w-full px-3 py-2 rounded-lg bg-neutral-800 text-white text-sm placeholder-neutral-500 border border-neutral-700 focus:outline-none focus:border-green-500 resize-none font-mono"
      ></textarea>
      <p class="text-xs text-neutral-500">
        Optionally prefix or suffix with sets x reps (e.g. "3x10 Bench Press"). Defaults to 3x10 if omitted.
      </p>
      <button
        onclick={createRoutine}
        disabled={creating || !newName.trim() || !newText.trim()}
        class="w-full py-3 rounded-xl font-semibold disabled:opacity-50 transition-colors"
        style="background-color: #22c55e; color: #0f0f0f;"
      >
        {creating ? 'Creating...' : 'Create Routine'}
      </button>
    </div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if routines.length === 0}
    <div class="text-center py-12">
      <p class="text-neutral-400 mb-2">No routines yet</p>
      <p class="text-sm text-neutral-600">Create one from a text message or exercise list from your trainer</p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each routines as routine}
        <div class="rounded-xl p-4 relative" style="background-color: #1a1a1a;">
          <button
            onclick={() => deleteRoutine(routine.id)}
            class="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center text-neutral-600 hover:text-red-400 hover:bg-neutral-800 transition-colors"
            title="Delete routine"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
          <h3 class="font-medium mb-1 pr-10">{routine.name}</h3>
          <p class="text-sm text-neutral-400">
            {routine.exercises.length} exercises
            <span class="text-neutral-600 ml-1">
              ({routine.exercises.filter(e => e.exerciseId != null).length} matched)
            </span>
          </p>
          <div class="mt-2 text-xs text-neutral-500 space-y-0.5">
            {#each routine.exercises.slice(0, 5) as ex}
              <div class="flex items-center gap-1">
                {#if ex.exerciseId}
                  <span class="text-green-500/60">&#x2713;</span>
                {:else}
                  <span class="text-amber-500/60">?</span>
                {/if}
                {ex.exerciseName}
                <span class="text-neutral-600">{ex.targetSets}x{ex.targetReps}</span>
              </div>
            {/each}
            {#if routine.exercises.length > 5}
              <div class="text-neutral-600">+{routine.exercises.length - 5} more</div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <p class="text-center text-sm text-neutral-600 mt-6">
    <a href="/generate" class="hover:text-green-400">&larr; Back to Generate</a>
  </p>
</div>
