<script lang="ts">
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import ExerciseDetail from '$lib/ExerciseDetail.svelte';

  let detailExerciseId: number | null = $state(null);

  interface SetData {
    id: number;
    reps: number | null;
    weightKg: number | null;
    isWarmup: boolean;
    completed?: boolean;
  }

  interface WorkoutExercise {
    id: number;
    exerciseId: number;
    exercise: { id: number; name: string };
    sets: SetData[];
    expanded?: boolean;
  }

  interface Workout {
    id: number;
    date: string;
    notes?: string;
    exercises: WorkoutExercise[];
  }

  let workout: Workout | null = $state(null);
  let loading = $state(true);
  let finishing = $state(false);

  const KG_TO_LBS = 2.20462;

  function kgToLbs(kg: number | null): number {
    if (!kg) return 0;
    return Math.round((kg * KG_TO_LBS) / 2.5) * 2.5;
  }

  function lbsToKg(lbs: number): number {
    return lbs / KG_TO_LBS;
  }

  onMount(async () => {
    try {
      const id = $page.params.id;
      workout = await api<Workout>(`/workouts/${id}`);
      // Initialize UI state
      if (workout?.exercises) {
        for (const ex of workout.exercises) {
          ex.expanded = true;
          for (const s of ex.sets) {
            s.completed = false;
          }
        }
      }
    } catch (e: any) {
      alert('Could not load workout');
    } finally {
      loading = false;
    }
  });

  function adjustReps(set: SetData, delta: number) {
    set.reps = Math.max(0, (set.reps ?? 0) + delta);
  }

  function updateWeightLbs(set: SetData, lbsStr: string) {
    const lbs = parseFloat(lbsStr) || 0;
    set.weightKg = lbsToKg(lbs);
  }

  function toggleComplete(set: SetData) {
    set.completed = !set.completed;
  }

  async function addSet(exercise: WorkoutExercise) {
    try {
      const lastSet = exercise.sets[exercise.sets.length - 1];
      const newSet = await api<SetData>('/sets', {
        method: 'POST',
        body: JSON.stringify({
          workoutExerciseId: exercise.id,
          reps: lastSet?.reps ?? 10,
          weightKg: lastSet?.weightKg ?? 0,
        }),
      });
      newSet.completed = false;
      exercise.sets = [...exercise.sets, newSet];
    } catch (e: any) {
      alert('Failed to add set');
    }
  }

  async function finishWorkout() {
    if (!workout) return;
    finishing = true;
    try {
      // Save all set data
      for (const ex of workout.exercises) {
        for (const set of ex.sets) {
          await api(`/sets/${set.id}`, {
            method: 'PUT',
            body: JSON.stringify({ reps: set.reps, weightKg: set.weightKg }),
          });
        }
      }
      await api(`/workouts/${workout.id}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: workout.notes || 'Completed' }),
      });
      goto('/history');
    } catch (e: any) {
      alert('Failed to save workout');
    } finally {
      finishing = false;
    }
  }
</script>

<div class="p-4 max-w-lg mx-auto">
  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if workout}
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Workout</h1>
      <span class="text-sm text-neutral-500">{new Date(workout.date).toLocaleDateString()}</span>
    </div>

    <div class="space-y-4 mb-6">
      {#each workout.exercises as ex}
        <div class="rounded-xl overflow-hidden" style="background-color: #1a1a1a;">
          <button
            onclick={() => ex.expanded = !ex.expanded}
            class="w-full text-left p-4 flex justify-between items-center"
          >
            <span class="font-medium">
              <button
                onclick={(e) => { e.stopPropagation(); detailExerciseId = ex.exerciseId; }}
                class="underline decoration-neutral-600 underline-offset-2 hover:text-green-400 transition-colors"
              >{ex.exercise?.name ?? 'Exercise'}</button>
            </span>
            <svg class="w-5 h-5 text-neutral-500 transition-transform {ex.expanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </button>

          {#if ex.expanded}
            <div class="px-4 pb-4 space-y-2">
              <!-- Header -->
              <div class="grid grid-cols-[1fr_80px_80px_48px] gap-2 text-xs text-neutral-500 px-1">
                <span>SET</span>
                <span class="text-center">REPS</span>
                <span class="text-center">LBS</span>
                <span></span>
              </div>

              {#each ex.sets as set, idx}
                <div class="grid grid-cols-[1fr_80px_80px_48px] gap-2 items-center">
                  <span class="text-sm text-neutral-400 pl-1">{idx + 1}</span>

                  <!-- Reps +/- -->
                  <div class="flex items-center justify-center gap-1">
                    <button
                      onclick={() => adjustReps(set, -1)}
                      class="w-7 h-7 rounded bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg"
                    >−</button>
                    <span class="w-8 text-center text-sm font-medium">{set.reps ?? 0}</span>
                    <button
                      onclick={() => adjustReps(set, 1)}
                      class="w-7 h-7 rounded bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg"
                    >+</button>
                  </div>

                  <!-- Weight input (lbs) -->
                  <input
                    type="number"
                    value={kgToLbs(set.weightKg)}
                    onchange={(e) => updateWeightLbs(set, e.currentTarget.value)}
                    class="w-full text-center text-sm py-1.5 rounded bg-neutral-800 text-white border-none outline-none"
                    step="2.5"
                  />

                  <!-- Checkmark -->
                  <button
                    onclick={() => toggleComplete(set)}
                    class="w-10 h-10 rounded-lg flex items-center justify-center transition-colors
                      {set.completed ? 'bg-green-500/20 text-green-400' : 'bg-neutral-800 text-neutral-600'}"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                  </button>
                </div>
              {/each}

              <button
                onclick={() => addSet(ex)}
                class="w-full py-2 rounded-lg text-sm text-neutral-400 bg-neutral-800/50 hover:bg-neutral-800 transition-colors mt-2"
              >
                + Add Set
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <button
      onclick={finishWorkout}
      disabled={finishing}
      class="w-full font-semibold text-lg py-4 rounded-xl disabled:opacity-50"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      {finishing ? 'Saving...' : 'Finish Workout'}
    </button>
  {:else}
    <div class="text-center py-12">
      <p class="text-neutral-500">Workout not found</p>
      <a href="/log" class="text-green-400 mt-2 inline-block">← Back</a>
    </div>
  {/if}

  <ExerciseDetail bind:exerciseId={detailExerciseId} />
</div>
