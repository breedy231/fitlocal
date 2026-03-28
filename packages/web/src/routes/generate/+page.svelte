<script lang="ts">
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import ExerciseDetail from '$lib/ExerciseDetail.svelte';
  import { showToast } from '$lib/toast';

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
    progression?: 'up' | 'deload' | 'hold';
    repRange?: { min: number; max: number };
    supersetGroup?: number;
  }

  interface GeneratedWorkout {
    dayType: string;
    globalModifier: number;
    exercises: GeneratedExercise[];
  }

  interface ProgramExercise {
    id: number;
    exerciseName: string;
    exerciseId: number | null;
    displayOrder: number;
    targetSets: number | null;
    targetReps: string | null;
    restSeconds: number | null;
    notes: string | null;
    progression: 'up' | 'deload' | 'hold' | null;
    suggestedWeightKg: number | null;
    suggestedReps: number | null;
    repRange: { min: number; max: number } | null;
  }

  interface ActiveProgram {
    program: { id: number; name: string };
    dayIndex: number;
    totalDays: number;
    day: {
      id: number;
      name: string;
      musclesFocus: string | null;
      exercises: ProgramExercise[];
    };
  }

  // Program state
  let activeProgram: ActiveProgram | null = $state(null);
  let mode: 'program' | 'freestyle' = $state('freestyle');
  let startingProgram = $state(false);
  let programLoading = $state(true);

  onMount(async () => {
    try {
      activeProgram = await api<ActiveProgram>('/programs/active');
      mode = 'program';
    } catch {
      activeProgram = null;
      mode = 'freestyle';
    } finally {
      programLoading = false;
    }
  });

  let swapTargetId: number | null = $state(null);
  let swapAlternatives: GeneratedExercise[] = $state([]);
  let loadingAlternatives = $state(false);
  let swapSearch = $state('');

  let filteredAlternatives = $derived(
    swapSearch.trim()
      ? swapAlternatives.filter(a => a.name.toLowerCase().includes(swapSearch.toLowerCase()))
      : swapAlternatives
  );

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
      showToast(e.message || 'Failed to generate workout — is the server running?', 'error');
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
      for (let i = 0; i < workout.exercises.length; i++) {
        const ex = workout.exercises[i];
        const we = await api<{ id: number }>('/workout-exercises', {
          method: 'POST',
          body: JSON.stringify({ workoutId: created.id, exerciseId: ex.id, displayOrder: i, supersetGroup: ex.supersetGroup ?? null }),
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
      showToast(e.message || 'Failed to start workout', 'error');
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
      showToast(e.message || 'No alternatives found', 'error');
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
    swapSearch = '';
  }

  // Group exercises: superset partners together, solo exercises as single-item groups
  let groupedExercises = $derived.by(() => {
    if (!workout) return [];
    const groups: GeneratedExercise[][] = [];
    const assigned = new Set<number>();
    const exercises = workout.exercises;

    for (let i = 0; i < exercises.length; i++) {
      if (assigned.has(i)) continue;
      const ex = exercises[i];
      if (ex.supersetGroup) {
        const partners = exercises
          .map((e, idx) => ({ e, idx }))
          .filter(({ e, idx }) => e.supersetGroup === ex.supersetGroup && !assigned.has(idx));
        const group: GeneratedExercise[] = [];
        for (const { e, idx } of partners) {
          group.push(e);
          assigned.add(idx);
        }
        groups.push(group);
      } else {
        assigned.add(i);
        groups.push([ex]);
      }
    }
    return groups;
  });

  function toggleEquipment() {
    equipment = equipment === 'full' ? 'travel' : 'full';
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('fitlocal-equipment', equipment);
    }
    if (dayType) generate();
  }

  function parseTargetReps(reps: string | null): number {
    if (!reps) return 10;
    if (/amrap/i.test(reps)) return 1;
    const num = parseInt(reps);
    return isNaN(num) ? 10 : num;
  }

  async function startProgramWorkout() {
    if (!activeProgram) return;
    startingProgram = true;
    try {
      const d = new Date();
      const now = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const created = await api<{ id: number }>('/workouts', {
        method: 'POST',
        body: JSON.stringify({ date: now, notes: `${activeProgram.program.name} — ${activeProgram.day.name}` }),
      });

      for (let i = 0; i < activeProgram.day.exercises.length; i++) {
        const ex = activeProgram.day.exercises[i];

        // Resolve exerciseId — create exercise if unmatched
        let exerciseId = ex.exerciseId;
        if (!exerciseId) {
          const created = await api<{ id: number }>('/exercises', {
            method: 'POST',
            body: JSON.stringify({ name: ex.exerciseName }),
          });
          exerciseId = created.id;
        }

        const we = await api<{ id: number }>('/workout-exercises', {
          method: 'POST',
          body: JSON.stringify({ workoutId: created.id, exerciseId, displayOrder: i }),
        });

        const sets = ex.targetSets || 3;
        const reps = ex.suggestedReps ?? parseTargetReps(ex.targetReps);
        const weightKg = ex.suggestedWeightKg ?? 0;

        for (let s = 0; s < sets; s++) {
          await api('/sets', {
            method: 'POST',
            body: JSON.stringify({ workoutExerciseId: we.id, reps, weightKg }),
          });
        }
      }

      // Advance to next day in program
      await api('/programs/active/advance', { method: 'POST' }).catch(() => {});

      goto(`/log/${created.id}`);
    } catch (e: any) {
      showToast(e.message || 'Failed to start workout', 'error');
    } finally {
      startingProgram = false;
    }
  }
</script>

{#snippet exerciseCard(ex: GeneratedExercise)}
  <div class="absolute top-3 right-3 flex items-center gap-2">
    {#if ex.progression === 'up'}
      <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background-color: #22c55e20; color: #22c55e;">
        ↑ PROGRESS
      </span>
    {:else if ex.progression === 'deload'}
      <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background-color: #ef444420; color: #ef4444;">
        ↓ DELOAD
      </span>
    {/if}
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
    {#if ex.repRange && !ex.isCardio}
      <span class="ml-2 text-neutral-500">target: {ex.repRange.min}–{ex.repRange.max} reps</span>
    {/if}
  </div>
{/snippet}

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  <h1 class="text-2xl font-bold mb-6">Generate Workout</h1>

  {#if programLoading}
    <div class="flex justify-center py-4 mb-4">
      <div class="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if activeProgram}
    <!-- Mode Toggle -->
    <div class="flex rounded-xl overflow-hidden mb-4" style="background-color: #1a1a1a;">
      <button
        onclick={() => mode = 'program'}
        class="flex-1 py-2.5 text-sm font-medium text-center transition-colors {mode === 'program' ? 'bg-green-500/20 text-green-400' : 'text-neutral-400 hover:text-neutral-200'}"
      >Program</button>
      <button
        onclick={() => mode = 'freestyle'}
        class="flex-1 py-2.5 text-sm font-medium text-center transition-colors {mode === 'freestyle' ? 'bg-green-500/20 text-green-400' : 'text-neutral-400 hover:text-neutral-200'}"
      >Freestyle</button>
    </div>
  {/if}

  <!-- Program Mode -->
  {#if mode === 'program' && activeProgram && !programLoading}
    <div class="rounded-xl p-4 mb-4" style="background-color: #1a1a1a;">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs text-neutral-500">{activeProgram.program.name}</span>
        <a href="/programs/{activeProgram.program.id}" class="text-xs text-neutral-500 hover:text-green-400">View program</a>
      </div>
      <h2 class="text-xl font-bold">{activeProgram.day.name}</h2>
      {#if activeProgram.day.musclesFocus}
        <p class="text-sm text-neutral-400 mt-0.5">{activeProgram.day.musclesFocus}</p>
      {/if}
      <p class="text-xs text-neutral-600 mt-1">Day {activeProgram.dayIndex + 1} of {activeProgram.totalDays}</p>
    </div>

    <div class="space-y-2 mb-6">
      {#each activeProgram.day.exercises as ex}
        <div class="rounded-xl p-4 relative" style="background-color: #1a1a1a;">
          <div class="absolute top-3 right-3 flex items-center gap-2">
            {#if ex.progression === 'up'}
              <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background-color: #22c55e20; color: #22c55e;">
                ↑ PROGRESS
              </span>
            {:else if ex.progression === 'deload'}
              <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background-color: #ef444420; color: #ef4444;">
                ↓ DELOAD
              </span>
            {/if}
          </div>
          <p class="font-medium mb-1 pr-24">{ex.exerciseName}</p>
          <div class="text-sm text-neutral-400">
            {ex.targetSets || 3} &times; {ex.targetReps || '10'}
            {#if ex.suggestedWeightKg && ex.suggestedWeightKg > 0}
              @ {kgToLbs(ex.suggestedWeightKg)} lbs
            {/if}
          </div>
          {#if ex.restSeconds}
            <span class="text-xs text-neutral-600">
              {ex.restSeconds >= 60 ? `${Math.round(ex.restSeconds / 60)}m` : `${ex.restSeconds}s`} rest
            </span>
          {/if}
          {#if ex.notes}
            <p class="text-xs text-neutral-500 mt-1">{ex.notes}</p>
          {/if}
          {#if ex.repRange}
            <span class="text-xs text-neutral-600 ml-2">target: {ex.repRange.min}–{ex.repRange.max} reps</span>
          {/if}
        </div>
      {/each}
    </div>

    <button
      onclick={startProgramWorkout}
      disabled={startingProgram}
      class="w-full font-semibold text-lg py-4 rounded-xl disabled:opacity-50"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      {startingProgram ? 'Starting...' : 'Start Workout'}
    </button>
  {/if}

  <!-- Freestyle Mode -->
  {#if mode === 'freestyle' && !programLoading}
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
      {#each groupedExercises as group}
        {#if group.length > 1}
          <!-- Superset group -->
          <div class="rounded-xl overflow-hidden border border-blue-500/30" style="background-color: #1a1a1a;">
            <div class="px-4 py-1.5 text-xs font-bold text-blue-400 uppercase tracking-wider border-b border-blue-500/20" style="background-color: #1e3a5f20;">
              Superset
            </div>
            {#each group as ex, idx}
              <div class="p-4 relative {idx > 0 ? 'border-t border-neutral-800' : ''}">
                {@render exerciseCard(ex)}
              </div>
            {/each}
          </div>
        {:else}
          <div class="rounded-xl p-4 relative" style="background-color: #1a1a1a;">
            {@render exerciseCard(group[0])}
          </div>
        {/if}
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

        {#if !loadingAlternatives}
          <div class="relative mb-3">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0"></path>
            </svg>
            <input
              type="text"
              placeholder="Search exercises..."
              bind:value={swapSearch}
              class="w-full pl-9 pr-3 py-2 rounded-lg bg-neutral-800 text-white text-sm placeholder-neutral-500 border border-neutral-700 focus:outline-none focus:border-green-500"
            />
          </div>
        {/if}

        {#if loadingAlternatives}
          <div class="flex justify-center py-12">
            <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        {:else if filteredAlternatives.length === 0}
          <p class="text-neutral-400 text-center py-8">{swapSearch ? 'No matches' : 'No alternatives found'}</p>
        {:else}
          <div class="overflow-y-auto space-y-2">
            {#each filteredAlternatives as alt}
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

  {#if !activeProgram}
    <p class="text-center text-sm text-neutral-600 mt-6">
      <a href="/programs" class="hover:text-green-400">Have a program? Manage programs &rarr;</a>
    </p>
  {/if}
  {/if}
</div>
