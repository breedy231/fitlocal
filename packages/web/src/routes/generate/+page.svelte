<script lang="ts">
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import ExerciseDetail from '$lib/ExerciseDetail.svelte';

  let detailExerciseId: number | null = $state(null);

  interface GeneratedExercise {
    id: number;
    name: string;
    suggestedSets: number;
    suggestedReps: number;
    suggestedWeightKg: number;
    lastPerformedDaysAgo: number;
    isFocus: boolean;
    isCardio: boolean;
    suggestedDurationSec?: number;
  }

  interface GeneratedWorkout {
    dayType: string;
    globalModifier: number;
    exercises: GeneratedExercise[];
  }

  let swapTargetId: number | null = $state(null);
  let swapAlternatives: GeneratedExercise[] = $state([]);
  let loadingAlternatives = $state(false);

  let dayType = $state('');
  let equipment = $state(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('fitlocal-equipment') || 'full'
      : 'full'
  );
  let workout: GeneratedWorkout | null = $state(null);
  let loading = $state(false);
  let starting = $state(false);

  function kgToLbs(kg: number): string {
    const lbs = kg * 2.20462;
    return String(Math.round(lbs / 2.5) * 2.5);
  }

  function formatDuration(sec: number): string {
    const min = Math.round(sec / 60);
    return `${min} min`;
  }

  async function generate() {
    loading = true;
    workout = null;
    try {
      workout = await api<GeneratedWorkout>(`/generate-workout?dayType=${dayType}&equipment=${equipment}`);
    } catch (e: any) {
      alert(e.message || 'Failed to generate workout');
    } finally {
      loading = false;
    }
  }

  async function startWorkout() {
    if (!workout) return;
    starting = true;
    try {
      const d = new Date();
      const now = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const created = await api<{ id: number }>('/workouts', {
        method: 'POST',
        body: JSON.stringify({ date: now, notes: `${workout.dayType} day` }),
      });

      // Create workout exercises and sets
      for (const ex of workout.exercises) {
        const we = await api<{ id: number }>('/workout-exercises', {
          method: 'POST',
          body: JSON.stringify({ workoutId: created.id, exerciseId: ex.id, displayOrder: 0 }),
        });
        for (let i = 0; i < ex.suggestedSets; i++) {
          await api('/sets', {
            method: 'POST',
            body: JSON.stringify({
              workoutExerciseId: we.id,
              reps: ex.suggestedReps,
              weightKg: ex.suggestedWeightKg,
            }),
          });
        }
      }

      goto(`/log/${created.id}`);
    } catch (e: any) {
      alert(e.message || 'Failed to start workout');
    } finally {
      starting = false;
    }
  }

  function selectDay(type: string) {
    dayType = type;
    generate();
  }

  async function openSwapSheet(exerciseId: number) {
    if (!workout) return;
    swapTargetId = exerciseId;
    swapAlternatives = [];
    loadingAlternatives = true;
    try {
      const excludeIds = workout.exercises.map(e => e.id).join(',');
      const result = await api<{ alternatives: GeneratedExercise[] }>(
        `/generate-workout/replace?exerciseId=${exerciseId}&dayType=${dayType}&equipment=${equipment}&excludeIds=${excludeIds}`
      );
      swapAlternatives = result.alternatives;
    } catch (e: any) {
      alert(e.message || 'No alternatives found');
      swapTargetId = null;
    } finally {
      loadingAlternatives = false;
    }
  }

  function pickAlternative(alt: GeneratedExercise) {
    if (!workout || swapTargetId === null) return;
    const idx = workout.exercises.findIndex(e => e.id === swapTargetId);
    if (idx !== -1) {
      workout.exercises[idx] = { ...alt, isFocus: workout.exercises[idx].isFocus };
    }
    swapTargetId = null;
    swapAlternatives = [];
  }

  function closeSwapSheet() {
    swapTargetId = null;
    swapAlternatives = [];
  }

  function toggleEquipment() {
    equipment = equipment === 'full' ? 'travel' : 'full';
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('fitlocal-equipment', equipment);
    }
    if (dayType) generate();
  }
</script>

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  <h1 class="text-2xl font-bold mb-6">Generate Workout</h1>

  <!-- Equipment Toggle -->
  <div class="flex items-center justify-between mb-4 rounded-xl p-4" style="background-color: #1a1a1a;">
    <span class="text-sm font-medium text-neutral-300">Equipment</span>
    <button
      onclick={toggleEquipment}
      class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {equipment === 'full' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}"
    >
      {equipment === 'full' ? '🏋️ Full Gym' : '🧳 Travel'}
    </button>
  </div>

  <!-- Day Type Buttons -->
  <div class="grid grid-cols-3 gap-3 mb-6">
    {#each [['upper', 'Upper'], ['lower', 'Lower'], ['fullbody', 'Full Body']] as [type, label]}
      <button
        onclick={() => selectDay(type)}
        class="py-4 rounded-xl text-center font-semibold transition-all min-h-[48px]
          {dayType === type ? 'ring-2 ring-green-500 text-green-400' : 'text-neutral-300 hover:text-white'}"
        style="background-color: {dayType === type ? '#22c55e15' : '#1a1a1a'};"
      >
        {label}
      </button>
    {/each}
  </div>

  <!-- Loading -->
  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {/if}

  <!-- Workout Result -->
  {#if workout && !loading}
    <div class="mb-4 flex items-center justify-between">
      <span class="text-sm text-neutral-400">
        Recovery modifier: <span class="text-green-400 font-medium">{Math.round(workout.globalModifier * 100)}%</span>
      </span>
      <button
        onclick={generate}
        class="text-sm px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white"
      >
        🔄 Regenerate
      </button>
    </div>

    <div class="space-y-3 mb-6">
      {#each workout.exercises as ex}
        <div class="rounded-xl p-4 relative" style="background-color: #1a1a1a;">
          <div class="absolute top-3 right-3 flex items-center gap-2">
            {#if ex.isFocus}
              <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background-color: #f59e0b20; color: #f59e0b;">
                FOCUS
              </span>
            {/if}
            <button
              onclick={() => openSwapSheet(ex.id)}
              class="w-7 h-7 rounded-lg flex items-center justify-center bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
              title="Swap exercise"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
            </button>
          </div>
          <button
            onclick={() => detailExerciseId = ex.id}
            class="font-medium mb-1 text-left underline decoration-neutral-600 underline-offset-2 hover:text-green-400 transition-colors"
          >{ex.name}</button>
          <div class="text-sm text-neutral-400">
            {#if ex.isCardio && ex.suggestedDurationSec}
              {formatDuration(ex.suggestedDurationSec)}
            {:else}
              {ex.suggestedSets} × {ex.suggestedReps}
              {#if ex.suggestedWeightKg > 0}
                @ {kgToLbs(ex.suggestedWeightKg)} lbs
              {/if}
            {/if}
          </div>
          <div class="text-xs text-neutral-600 mt-1">
            Last done: {ex.lastPerformedDaysAgo < 1 ? 'today' : `${Math.round(ex.lastPerformedDaysAgo)}d ago`}
          </div>
        </div>
      {/each}
    </div>

    <button
      onclick={startWorkout}
      disabled={starting}
      class="w-full font-semibold text-lg py-4 rounded-xl disabled:opacity-50"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      {starting ? 'Starting...' : 'Start Workout'}
    </button>
  {/if}

  <ExerciseDetail bind:exerciseId={detailExerciseId} />

  <!-- Swap Exercise Sheet -->
  {#if swapTargetId !== null}
    <div class="fixed inset-0 z-50 flex items-end justify-center">
      <button class="absolute inset-0 bg-black/60" onclick={closeSwapSheet} aria-label="Close"></button>
      <div class="relative w-full max-w-lg bg-neutral-900 rounded-t-2xl p-4 pb-8 max-h-[70vh] flex flex-col">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold">Swap Exercise</h2>
          <button onclick={closeSwapSheet} class="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800" aria-label="Close">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        {#if loadingAlternatives}
          <div class="flex justify-center py-12">
            <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        {:else if swapAlternatives.length === 0}
          <p class="text-neutral-400 text-center py-8">No alternatives found</p>
        {:else}
          <div class="overflow-y-auto space-y-2">
            {#each swapAlternatives as alt}
              <button
                onclick={() => pickAlternative(alt)}
                class="w-full text-left rounded-xl p-3 hover:bg-neutral-700 transition-colors"
                style="background-color: #1a1a1a;"
              >
                <div class="font-medium">{alt.name}</div>
                <div class="text-sm text-neutral-400">
                  {#if alt.isCardio && alt.suggestedDurationSec}
                    {formatDuration(alt.suggestedDurationSec)}
                  {:else}
                    {alt.suggestedSets} &times; {alt.suggestedReps}
                    {#if alt.suggestedWeightKg > 0}
                      @ {kgToLbs(alt.suggestedWeightKg)} lbs
                    {/if}
                  {/if}
                  <span class="text-neutral-600 ml-2">
                    {alt.lastPerformedDaysAgo < 1 ? 'today' : `${Math.round(alt.lastPerformedDaysAgo)}d ago`}
                  </span>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
