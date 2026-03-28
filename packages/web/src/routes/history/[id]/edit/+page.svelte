<script lang="ts">
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import ExerciseSearch from '$lib/ExerciseSearch.svelte';
  import { showToast } from '$lib/toast';

  interface SetData {
    id: number;
    reps: number | null;
    weightKg: number | null;
    isWarmup: boolean;
    dirty?: boolean;
  }

  interface WorkoutExercise {
    id: number;
    exerciseId: number;
    exercise: { id: number; name: string };
    sets: SetData[];
  }

  interface Workout {
    id: number;
    date: string;
    notes?: string;
    exercises: WorkoutExercise[];
  }

  const KG_TO_LBS = 2.20462;

  function kgToLbs(kg: number | null): number {
    if (!kg) return 0;
    return Math.round((kg * KG_TO_LBS) / 2.5) * 2.5;
  }

  function lbsToKg(lbs: number): number {
    return lbs / KG_TO_LBS;
  }

  let workout: Workout | null = $state(null);
  let loading = $state(true);
  let saving = $state(false);
  let showSearch = $state(false);
  let originalDate = '';
  let deleteConfirm = $state(false);
  let deleting = $state(false);

  onMount(async () => {
    try {
      const id = $page.params.id;
      workout = await api<Workout>(`/workouts/${id}`);
      originalDate = workout.date;
    } catch {
      showToast('Could not load workout', 'error');
    } finally {
      loading = false;
    }
  });

  function updateWeight(set: SetData, lbsStr: string) {
    const lbs = parseFloat(lbsStr) || 0;
    set.weightKg = lbsToKg(lbs);
    set.dirty = true;
  }

  function updateReps(set: SetData, repsStr: string) {
    set.reps = parseInt(repsStr) || 0;
    set.dirty = true;
  }

  async function addSet(exercise: WorkoutExercise) {
    try {
      const lastSet = exercise.sets[exercise.sets.length - 1];
      const newSet = await api<SetData>(`/workout-exercises/${exercise.id}/sets`, {
        method: 'POST',
        body: JSON.stringify({
          reps: lastSet?.reps ?? 10,
          weightKg: lastSet?.weightKg ?? 0,
        }),
      });
      exercise.sets = [...exercise.sets, newSet];
    } catch {
      showToast('Failed to add set', 'error');
    }
  }

  async function deleteSet(exercise: WorkoutExercise, setId: number) {
    try {
      await api(`/sets/${setId}`, { method: 'DELETE' });
      exercise.sets = exercise.sets.filter(s => s.id !== setId);
    } catch {
      showToast('Failed to delete set', 'error');
    }
  }

  async function removeExercise(we: WorkoutExercise) {
    if (!workout) return;
    try {
      await api(`/workout-exercises/${we.id}`, { method: 'DELETE' });
      workout.exercises = workout.exercises.filter(e => e.id !== we.id);
    } catch {
      showToast('Failed to remove exercise', 'error');
    }
  }

  async function addExercise(exercise: { id: number; name: string }) {
    if (!workout) return;
    try {
      const we = await api<{ id: number; exerciseId: number; displayOrder: number }>(
        `/workouts/${workout.id}/exercises`,
        {
          method: 'POST',
          body: JSON.stringify({ exerciseId: exercise.id, displayOrder: workout.exercises.length }),
        }
      );
      workout.exercises = [
        ...workout.exercises,
        { id: we.id, exerciseId: exercise.id, exercise: { id: exercise.id, name: exercise.name }, sets: [] },
      ];
    } catch {
      showToast('Failed to add exercise', 'error');
    }
  }

  async function save() {
    if (!workout) return;
    saving = true;
    try {
      // Update date if changed
      if (workout.date !== originalDate) {
        await api(`/workouts/${workout.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ date: workout.date }),
        });
      }
      // Update dirty sets
      for (const ex of workout.exercises) {
        for (const set of ex.sets) {
          if (set.dirty) {
            await api(`/sets/${set.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ reps: set.reps, weightKg: set.weightKg }),
            });
          }
        }
      }
      goto('/history');
    } catch {
      showToast('Failed to save changes', 'error');
    } finally {
      saving = false;
    }
  }

  async function deleteWorkout() {
    if (!workout) return;
    deleting = true;
    try {
      await api(`/workouts/${workout.id}`, { method: 'DELETE' });
      goto('/history');
    } catch {
      showToast('Failed to delete workout', 'error');
    } finally {
      deleting = false;
    }
  }
</script>

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if workout}
    <div class="flex items-center justify-between mb-6">
      <a href="/history" class="text-neutral-400 hover:text-white text-sm">← Back</a>
      <h1 class="text-xl font-bold">Edit Workout</h1>
      <div class="w-12"></div>
    </div>

    <!-- Date picker -->
    <div class="mb-6">
      <label class="block text-xs text-neutral-500 uppercase tracking-wider mb-2">Date</label>
      <input
        type="date"
        bind:value={workout.date}
        class="w-full px-4 py-3 rounded-xl text-sm text-white border-none outline-none"
        style="background-color: #1a1a1a; color-scheme: dark;"
      />
    </div>

    <!-- Exercises -->
    <div class="space-y-4 mb-6">
      {#each workout.exercises as we, exIdx}
        <div class="rounded-xl overflow-hidden" style="background-color: #1a1a1a;">
          <div class="p-4 flex justify-between items-center">
            <span class="font-medium text-sm">{we.exercise?.name ?? 'Exercise'}</span>
            <button
              onclick={() => removeExercise(we)}
              class="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-300"
              title="Remove exercise"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>

          <div class="px-4 pb-4 space-y-2">
            <!-- Header -->
            <div class="grid grid-cols-[1fr_70px_70px_36px] gap-2 text-xs text-neutral-500 px-1">
              <span>SET</span>
              <span class="text-center">REPS</span>
              <span class="text-center">LBS</span>
              <span></span>
            </div>

            {#each we.sets as set, idx}
              <div class="grid grid-cols-[1fr_70px_70px_36px] gap-2 items-center">
                <span class="text-sm text-neutral-400 pl-1">{idx + 1}</span>
                <input
                  type="number"
                  value={set.reps ?? 0}
                  onchange={(e) => updateReps(set, e.currentTarget.value)}
                  class="w-full text-center text-sm py-1.5 rounded bg-neutral-800 text-white border-none outline-none"
                />
                <input
                  type="number"
                  value={kgToLbs(set.weightKg)}
                  onchange={(e) => updateWeight(set, e.currentTarget.value)}
                  class="w-full text-center text-sm py-1.5 rounded bg-neutral-800 text-white border-none outline-none"
                  step="2.5"
                />
                <button
                  onclick={() => deleteSet(we, set.id)}
                  class="w-8 h-8 rounded flex items-center justify-center text-neutral-600 hover:text-red-400 transition-colors"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                </button>
              </div>
            {/each}

            <button
              onclick={() => addSet(we)}
              class="w-full py-2 rounded-lg text-sm text-neutral-400 bg-neutral-800/50 hover:bg-neutral-800 transition-colors mt-1"
            >
              + Add Set
            </button>
          </div>
        </div>
      {/each}
    </div>

    <!-- Add exercise button -->
    <button
      onclick={() => showSearch = true}
      class="w-full py-3 rounded-xl text-sm font-medium mb-6 border border-dashed border-neutral-700 text-neutral-400 hover:border-green-500/50 hover:text-green-400 transition-colors"
    >
      + Add Exercise
    </button>

    <!-- Save button -->
    <button
      onclick={save}
      disabled={saving}
      class="w-full font-semibold text-lg py-4 rounded-xl disabled:opacity-50 mb-4"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      {saving ? 'Saving...' : 'Save Changes'}
    </button>

    <!-- Delete button -->
    <button
      onclick={() => deleteConfirm = true}
      class="w-full py-3 rounded-xl text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
    >
      Delete Workout
    </button>

    <ExerciseSearch bind:visible={showSearch} onselect={addExercise} />
  {:else}
    <div class="text-center py-12">
      <p class="text-neutral-500">Workout not found</p>
      <a href="/history" class="text-green-400 mt-2 inline-block">← Back</a>
    </div>
  {/if}
</div>

<!-- Delete confirmation -->
{#if deleteConfirm}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    style="background-color: rgba(0,0,0,0.6); backdrop-filter: blur(4px);"
    onclick={() => deleteConfirm = false}
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
          onclick={() => deleteConfirm = false}
          class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-neutral-700 text-neutral-200"
        >
          Cancel
        </button>
        <button
          onclick={deleteWorkout}
          disabled={deleting}
          class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
{/if}
