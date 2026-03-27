<script lang="ts">
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import ExerciseSearch from '$lib/ExerciseSearch.svelte';

  interface LocalSet {
    tempId: number;
    reps: number;
    weightLbs: number;
  }

  interface LocalExercise {
    exerciseId: number;
    name: string;
    sets: LocalSet[];
  }

  const KG_TO_LBS = 2.20462;

  let date = $state((() => { const _d = new Date(); return `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`; })());
  let exercises: LocalExercise[] = $state([]);
  let showSearch = $state(false);
  let saving = $state(false);
  let nextTempId = 0;

  function addExercise(exercise: { id: number; name: string }) {
    exercises = [
      ...exercises,
      {
        exerciseId: exercise.id,
        name: exercise.name,
        sets: [{ tempId: nextTempId++, reps: 10, weightLbs: 0 }],
      },
    ];
  }

  function addSet(ex: LocalExercise) {
    const lastSet = ex.sets[ex.sets.length - 1];
    ex.sets = [
      ...ex.sets,
      { tempId: nextTempId++, reps: lastSet?.reps ?? 10, weightLbs: lastSet?.weightLbs ?? 0 },
    ];
  }

  function removeSet(ex: LocalExercise, tempId: number) {
    ex.sets = ex.sets.filter(s => s.tempId !== tempId);
  }

  function removeExercise(exerciseIdx: number) {
    exercises = exercises.filter((_, i) => i !== exerciseIdx);
  }

  async function saveWorkout() {
    if (exercises.length === 0) {
      alert('Add at least one exercise');
      return;
    }
    saving = true;
    try {
      // Create workout
      const workout = await api<{ id: number }>('/workouts', {
        method: 'POST',
        body: JSON.stringify({ date }),
      });

      // Add exercises and sets
      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];
        const we = await api<{ id: number }>(`/workouts/${workout.id}/exercises`, {
          method: 'POST',
          body: JSON.stringify({ exerciseId: ex.exerciseId, displayOrder: i }),
        });

        for (const set of ex.sets) {
          await api(`/workout-exercises/${we.id}/sets`, {
            method: 'POST',
            body: JSON.stringify({
              reps: set.reps,
              weightKg: set.weightLbs / KG_TO_LBS,
            }),
          });
        }
      }

      goto('/history');
    } catch {
      alert('Failed to save workout');
    } finally {
      saving = false;
    }
  }
</script>

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <a href="/history" class="text-neutral-400 hover:text-white text-sm">← Back</a>
    <h1 class="text-xl font-bold">Log Workout</h1>
    <div class="w-12"></div>
  </div>

  <!-- Date picker -->
  <div class="mb-6">
    <label class="block text-xs text-neutral-500 uppercase tracking-wider mb-2">Date</label>
    <input
      type="date"
      bind:value={date}
      class="w-full px-4 py-3 rounded-xl text-sm text-white border-none outline-none"
      style="background-color: #1a1a1a; color-scheme: dark;"
    />
  </div>

  <!-- Exercises -->
  {#if exercises.length > 0}
    <div class="space-y-4 mb-6">
      {#each exercises as ex, exIdx}
        <div class="rounded-xl overflow-hidden" style="background-color: #1a1a1a;">
          <div class="p-4 flex justify-between items-center">
            <span class="font-medium text-sm">{ex.name}</span>
            <button
              onclick={() => removeExercise(exIdx)}
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

            {#each ex.sets as set, idx}
              <div class="grid grid-cols-[1fr_70px_70px_36px] gap-2 items-center">
                <span class="text-sm text-neutral-400 pl-1">{idx + 1}</span>
                <input
                  type="number"
                  bind:value={set.reps}
                  class="w-full text-center text-sm py-1.5 rounded bg-neutral-800 text-white border-none outline-none"
                />
                <input
                  type="number"
                  bind:value={set.weightLbs}
                  class="w-full text-center text-sm py-1.5 rounded bg-neutral-800 text-white border-none outline-none"
                  step="2.5"
                />
                <button
                  onclick={() => removeSet(ex, set.tempId)}
                  class="w-8 h-8 rounded flex items-center justify-center text-neutral-600 hover:text-red-400 transition-colors"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                </button>
              </div>
            {/each}

            <button
              onclick={() => addSet(ex)}
              class="w-full py-2 rounded-lg text-sm text-neutral-400 bg-neutral-800/50 hover:bg-neutral-800 transition-colors mt-1"
            >
              + Add Set
            </button>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="rounded-xl p-8 text-center mb-6" style="background-color: #1a1a1a;">
      <p class="text-neutral-500 text-sm">No exercises added yet</p>
    </div>
  {/if}

  <!-- Add exercise button -->
  <button
    onclick={() => showSearch = true}
    class="w-full py-3 rounded-xl text-sm font-medium mb-6 border border-dashed border-neutral-700 text-neutral-400 hover:border-green-500/50 hover:text-green-400 transition-colors"
  >
    + Add Exercise
  </button>

  <!-- Save button -->
  {#if exercises.length > 0}
    <button
      onclick={saveWorkout}
      disabled={saving}
      class="w-full font-semibold text-lg py-4 rounded-xl disabled:opacity-50"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      {saving ? 'Saving...' : 'Save Workout'}
    </button>
  {/if}

  <ExerciseSearch bind:visible={showSearch} onselect={addExercise} />
</div>
