<script lang="ts">
  import { api } from '$lib/api';
  import { cachedGet } from '$lib/api-cache.svelte';
  import { goto } from '$app/navigation';
  import ExerciseDetail from '$lib/ExerciseDetail.svelte';
  import ExerciseSearchSheet from '$lib/workout/ExerciseSearchSheet.svelte';
  import { showToast } from '$lib/toast';
  import type {
    GeneratedExercise,
    GeneratedWorkout,
    GenerateReplaceResponse,
    ActiveProgram,
    ActiveProgramExercise as ProgramExercise,
    Routine as RoutineSummary,
    RoutineDetail,
    EquipmentProfile,
  } from 'fitlocal-shared';
  import { CARDIO_PATTERN } from 'fitlocal-shared';
  import { onMount } from 'svelte';

  let detailExerciseId: number | null = $state(null);

  // Program state — cached so revisiting this page is instant
  const programCached = cachedGet<ActiveProgram>('/programs/active');
  let activeProgram: ActiveProgram | null = $derived(programCached.data);
  let startingProgram = $state(false);
  let programLoading = $derived(programCached.loading);

  const routinesCached = cachedGet<RoutineSummary[]>('/routines');
  let routinesList: RoutineSummary[] = $derived(routinesCached.data ?? []);
  let selectedRoutineId: number | null = $state(null);
  let routineDetail: RoutineDetail | null = $state(null);
  let routineLoading = $state(false);
  let startingRoutine = $state(false);

  // Mode: program > routine (if routines exist) > freestyle
  let mode: 'program' | 'routine' | 'freestyle' = $derived(
    programCached.data ? 'program' : (routinesList.length > 0 ? 'routine' : 'freestyle')
  );

  let swapTargetId: number | null = $state(null);
  let swapAlternatives: GeneratedExercise[] = $state([]);
  let loadingAlternatives = $state(false);
  let swapSearch = $state('');

  // Add exercise to program day
  let addExerciseOpen = $state(false);
  let addExerciseSearch = $state('');
  let addExerciseResults: { id: number; name: string }[] = $state([]);
  let addSearchTimer: ReturnType<typeof setTimeout> | undefined;

  let filteredAlternatives = $derived(
    swapSearch.trim()
      ? swapAlternatives.filter(a => a.name.toLowerCase().includes(swapSearch.toLowerCase()))
      : swapAlternatives
  );

  let dayType = $state('');
  let lastDayType = $state(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('fitlocal-last-day-type') || ''
      : ''
  );
  let duration = $state(
    typeof localStorage !== 'undefined'
      ? parseInt(localStorage.getItem('fitlocal-duration') || '60') || 60
      : 60
  );
  // Gym profiles
  let profiles: EquipmentProfile[] = $state([]);
  let selectedProfileId = $state(
    typeof localStorage !== 'undefined'
      ? parseInt(localStorage.getItem('fitlocal-profile-id') || '0') || 0
      : 0
  );
  let selectedProfile = $derived(profiles.find(p => p.id === selectedProfileId) ?? profiles[0] ?? null);

  onMount(async () => {
    // Migrate from old binary equipment to profile-based
    if (typeof localStorage !== 'undefined') {
      const oldEquipment = localStorage.getItem('fitlocal-equipment');
      if (oldEquipment && !localStorage.getItem('fitlocal-profile-id')) {
        localStorage.setItem('fitlocal-profile-id', oldEquipment === 'travel' ? '2' : '1');
        localStorage.removeItem('fitlocal-equipment');
      }
    }
    try {
      profiles = await api<EquipmentProfile[]>('/equipment-profiles');
      if (!selectedProfileId && profiles.length > 0) {
        selectedProfileId = profiles[0].id;
      }
    } catch { /* profiles not available yet */ }
  });

  function selectProfile(id: number) {
    selectedProfileId = id;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('fitlocal-profile-id', id.toString());
    }
  }

  let supersets = $state(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('fitlocal-supersets') !== 'false'
      : true
  );
  let workout: GeneratedWorkout | null = $state(null);
  let loading = $state(false);
  let starting = $state(false);
  let quickStarting = $state(false);

  // Estimated total cardio minutes from generated workout
  let estimatedCardioMin = $derived.by(() => {
    if (!workout) return 0;
    return workout.exercises
      .filter(ex => CARDIO_PATTERN.test(ex.name))
      .reduce((sum, ex) => sum + (ex.suggestedDurationSec ?? 0), 0) / 60;
  });
  let cardioWarning = $derived(workout !== null && !loading && estimatedCardioMin < 45);

  const DAY_TYPE_LABELS: Record<string, string> = {
    push: 'Push',
    pull: 'Pull',
    legs: 'Legs',
    upper: 'Upper',
    lower: 'Lower',
    fullbody: 'Full Body',
  };

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
      workout = await api<GeneratedWorkout>(`/generate-workout?dayType=${dayType}&profileId=${selectedProfileId}&supersets=${supersets}&duration=${duration}`);
    } catch (e: any) {
      showToast(e.message || 'Failed to generate workout — is the server running?', 'error');
    } finally {
      loading = false;
    }
  }

  async function startWorkout() {
    if (!workout) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('Connect to Wi-Fi to start workout', 'error');
      return;
    }
    starting = true;
    try {
      const d = new Date();
      const now = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const created = await api<{ id: number }>('/workouts/start', {
        method: 'POST',
        body: JSON.stringify({
          date: now,
          notes: `${workout.dayType} day`,
          locationProfile: selectedProfile?.name ?? null,
          exercises: workout.exercises.map((ex, i) => ({
            exerciseId: ex.id,
            displayOrder: i,
            supersetGroup: ex.supersetGroup ?? null,
            sets: Array.from({ length: ex.suggestedSets }, () => ({
              reps: ex.suggestedReps,
              weightKg: ex.suggestedWeightKg,
            })),
          })),
        }),
      });

      goto(`/log/${created.id}`);
    } catch (e: any) {
      showToast(e.message || 'Failed to start workout', 'error');
    } finally {
      starting = false;
    }
  }

  function selectDay(type: string) {
    dayType = type;
    lastDayType = type;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('fitlocal-last-day-type', type);
    }
    generate();
  }

  // Quick Start (freestyle): generate + start with zero intermediate screens.
  // Uses last-used day type (or 'fullbody' fallback), equipment, duration, supersets from localStorage.
  async function quickStartFreestyle() {
    const type = lastDayType || 'fullbody';
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('Connect to Wi-Fi to start workout', 'error');
      return;
    }
    quickStarting = true;
    try {
      const generated = await api<GeneratedWorkout>(
        `/generate-workout?dayType=${type}&profileId=${selectedProfileId}&supersets=${supersets}&duration=${duration}`
      );

      // Show the exercises so the user can see what they're about to do
      dayType = type;
      lastDayType = type;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('fitlocal-last-day-type', type);
      }
      workout = generated;

      const d = new Date();
      const now = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const created = await api<{ id: number }>('/workouts/start', {
        method: 'POST',
        body: JSON.stringify({
          date: now,
          notes: `${generated.dayType} day`,
          locationProfile: selectedProfile?.name ?? null,
          exercises: generated.exercises.map((ex, i) => ({
            exerciseId: ex.id,
            displayOrder: i,
            supersetGroup: ex.supersetGroup ?? null,
            sets: Array.from({ length: ex.suggestedSets }, () => ({
              reps: ex.suggestedReps,
              weightKg: ex.suggestedWeightKg,
            })),
          })),
        }),
      });

      goto(`/log/${created.id}`);
    } catch (e: any) {
      showToast(e.message || 'Failed to start workout', 'error');
    } finally {
      quickStarting = false;
    }
  }

  async function openSwapSheet(exerciseId: number) {
    if (!workout) return;
    swapTargetId = exerciseId;
    swapAlternatives = [];
    loadingAlternatives = true;
    try {
      const excludeIds = workout.exercises.map(e => e.id).join(',');
      const result = await api<GenerateReplaceResponse>(
        `/generate-workout/replace?exerciseId=${exerciseId}&dayType=${dayType}&profileId=${selectedProfileId}&excludeIds=${excludeIds}`
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

  function openAddExercise() {
    addExerciseOpen = true;
    addExerciseSearch = '';
    addExerciseResults = [];
  }

  function closeAddExercise() {
    addExerciseOpen = false;
    addExerciseSearch = '';
    addExerciseResults = [];
  }

  async function searchExercisesForAdd(q: string) {
    if (!q.trim()) { addExerciseResults = []; return; }
    addExerciseLoading = true;
    try {
      addExerciseResults = await api<{ id: number; name: string }[]>(`/exercises/search?q=${encodeURIComponent(q)}`);
    } catch {
      addExerciseResults = [];
    } finally {
      addExerciseLoading = false;
    }
  }

  function onAddExerciseInput(q: string) {
    addExerciseSearch = q;
    clearTimeout(addSearchTimer);
    addSearchTimer = setTimeout(() => searchExercisesForAdd(q), 250);
  }

  function pickExerciseToAdd(exercise: { id: number; name: string }) {
    if (!activeProgram) return;
    const nextOrder = activeProgram.day.exercises.length;
    // Add to the local list immediately
    activeProgram.day.exercises = [...activeProgram.day.exercises, {
      id: -Date.now(), // temp id
      programDayId: activeProgram.day.id,
      exerciseName: exercise.name,
      exerciseId: exercise.id,
      displayOrder: nextOrder,
      targetSets: 3,
      targetReps: null,
      restSeconds: null,
      notes: null,
      progression: null,
      suggestedWeightKg: null,
      suggestedReps: null,
      repRange: null,
      isEstimate: false,
    }];
    // Fetch progression for this exercise in the background
    api<any>(`/exercises/${exercise.id}/progression`).then(prog => {
      if (!activeProgram) return;
      const idx = activeProgram.day.exercises.findIndex(ex => ex.exerciseId === exercise.id && ex.id < 0);
      if (idx !== -1) {
        activeProgram.day.exercises[idx] = {
          ...activeProgram.day.exercises[idx],
          suggestedWeightKg: prog.weightKg,
          suggestedReps: prog.reps,
          repRange: prog.repRange,
          progression: prog.directive,
          isEstimate: prog.isEstimate ?? false,
        };
        activeProgram.day.exercises = [...activeProgram.day.exercises];
      }
    }).catch(() => {});
    closeAddExercise();
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

  function toggleSupersets() {
    supersets = !supersets;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('fitlocal-supersets', String(supersets));
    }
    if (dayType) generate();
  }

  async function loadRoutineDetail(id: number) {
    selectedRoutineId = id;
    routineLoading = true;
    routineDetail = null;
    try {
      routineDetail = await api<RoutineDetail>(`/routines/${id}`);
    } catch (e: any) {
      showToast(e.message || 'Failed to load routine', 'error');
    } finally {
      routineLoading = false;
    }
  }

  async function startRoutineWorkout() {
    if (!routineDetail) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('Connect to Wi-Fi to start workout', 'error');
      return;
    }
    startingRoutine = true;
    try {
      const d = new Date();
      const now = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      // Create exercises for any that don't have IDs
      const resolvedExercises = await Promise.all(
        routineDetail.exercises.map(async (ex) => {
          let exerciseId = ex.exerciseId;
          if (!exerciseId) {
            const created = await api<{ id: number }>('/exercises', {
              method: 'POST',
              body: JSON.stringify({ name: ex.exerciseName }),
            });
            exerciseId = created.id;
          }
          return { ...ex, exerciseId };
        })
      );

      const created = await api<{ id: number }>('/workouts/start', {
        method: 'POST',
        body: JSON.stringify({
          date: now,
          notes: `Routine: ${routineDetail.name}`,
          locationProfile: selectedProfile?.name ?? null,
          exercises: resolvedExercises.map((ex, i) => ({
            exerciseId: ex.exerciseId,
            displayOrder: i,
            sets: Array.from({ length: ex.targetSets || 3 }, () => ({
              reps: ex.suggestedReps ?? (parseInt(ex.targetReps) || 10),
              weightKg: ex.suggestedWeightKg ?? 0,
            })),
          })),
        }),
      });

      goto(`/log/${created.id}`);
    } catch (e: any) {
      showToast(e.message || 'Failed to start workout', 'error');
    } finally {
      startingRoutine = false;
    }
  }

  function selectDuration(min: number) {
    duration = min;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('fitlocal-duration', String(min));
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
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('Connect to Wi-Fi to start workout', 'error');
      return;
    }
    startingProgram = true;
    try {
      const d = new Date();
      const now = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      // Resolve any unmatched exercises first
      const resolvedExercises = await Promise.all(
        activeProgram.day.exercises.map(async (ex) => {
          let exerciseId = ex.exerciseId;
          if (!exerciseId) {
            const created = await api<{ id: number }>('/exercises', {
              method: 'POST',
              body: JSON.stringify({ name: ex.exerciseName }),
            });
            exerciseId = created.id;
          }
          return { ...ex, exerciseId };
        })
      );

      const created = await api<{ id: number }>('/workouts/start', {
        method: 'POST',
        body: JSON.stringify({
          date: now,
          notes: `${activeProgram.program.name} — ${activeProgram.day.name}`,
          locationProfile: selectedProfile?.name ?? null,
          exercises: resolvedExercises.map((ex, i) => ({
            exerciseId: ex.exerciseId,
            displayOrder: i,
            sets: Array.from({ length: ex.targetSets || 3 }, () => ({
              reps: ex.suggestedReps ?? parseTargetReps(ex.targetReps),
              weightKg: ex.suggestedWeightKg ?? 0,
            })),
          })),
        }),
      });

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
  {:else if activeProgram || routinesList.length > 0}
    <!-- Mode Toggle -->
    <div class="flex rounded-xl overflow-hidden mb-4" style="background-color: #1a1a1a;">
      {#if activeProgram}
        <button
          onclick={() => mode = 'program'}
          class="flex-1 py-2.5 text-sm font-medium text-center transition-colors {mode === 'program' ? 'bg-green-500/20 text-green-400' : 'text-neutral-400 hover:text-neutral-200'}"
        >Program</button>
      {/if}
      {#if routinesList.length > 0}
        <button
          onclick={() => mode = 'routine'}
          class="flex-1 py-2.5 text-sm font-medium text-center transition-colors {mode === 'routine' ? 'bg-green-500/20 text-green-400' : 'text-neutral-400 hover:text-neutral-200'}"
        >Routine</button>
      {/if}
      <button
        onclick={() => mode = 'freestyle'}
        class="flex-1 py-2.5 text-sm font-medium text-center transition-colors {mode === 'freestyle' ? 'bg-green-500/20 text-green-400' : 'text-neutral-400 hover:text-neutral-200'}"
      >Freestyle</button>
    </div>
  {/if}

  <!-- Program Mode -->
  {#if mode === 'program' && activeProgram && !programLoading}
    <!-- Quick Start — one tap goes straight into the workout -->
    <button
      onclick={startProgramWorkout}
      disabled={startingProgram}
      class="w-full font-semibold text-lg py-5 rounded-xl mb-4 disabled:opacity-50"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      {startingProgram ? 'Starting...' : `⚡ Quick Start: ${activeProgram.day.name}`}
    </button>

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

    {#if activeProgram.cardio}
      <div class="rounded-xl p-4 mb-4 border border-blue-500/20" style="background-color: #1a1a1a;">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-blue-400">Week {activeProgram.cardio.week} Cardio</p>
            <p class="text-xs text-neutral-400 mt-0.5">
              {activeProgram.cardio.sessions.length} sessions: {activeProgram.cardio.sessions.map(m => `${m} min`).join(', ')}
            </p>
          </div>
          <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background-color: {activeProgram.cardio.completedThisWeek >= activeProgram.cardio.sessions.length ? '#22c55e20' : '#3b82f620'}; color: {activeProgram.cardio.completedThisWeek >= activeProgram.cardio.sessions.length ? '#22c55e' : '#3b82f6'};">
            {activeProgram.cardio.completedThisWeek}/{activeProgram.cardio.sessions.length}
          </span>
        </div>
      </div>
    {/if}

    <div class="space-y-2 mb-6">
      {#each activeProgram.day.exercises as ex}
        <div class="rounded-xl p-4 relative" style="background-color: #1a1a1a;">
          <div class="absolute top-3 right-3 flex items-center gap-2">
            {#if ex.isEstimate}
              <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background-color: #8b5cf620; color: #8b5cf6;">
                ~ EST
              </span>
            {:else if ex.progression === 'up'}
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

      <button
        onclick={openAddExercise}
        class="w-full py-3 rounded-xl border border-dashed border-neutral-600 text-neutral-400 hover:text-green-400 hover:border-green-500/50 transition-colors text-sm font-medium"
      >
        + Add Exercise
      </button>
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

  <!-- Routine Mode -->
  {#if mode === 'routine' && !programLoading}
    {#if !selectedRoutineId || !routineDetail}
      <!-- Routine Picker -->
      <div class="space-y-2 mb-6">
        {#each routinesList as routine}
          <button
            onclick={() => loadRoutineDetail(routine.id)}
            class="w-full text-left rounded-xl p-4 hover:bg-neutral-700 transition-colors"
            style="background-color: #1a1a1a;"
          >
            <p class="font-medium">{routine.name}</p>
            <p class="text-sm text-neutral-400 mt-0.5">{routine.exercises.length} exercises</p>
          </button>
        {/each}
      </div>
      <p class="text-center text-sm text-neutral-600">
        <a href="/routines" class="hover:text-green-400">Manage routines &rarr;</a>
      </p>
    {:else if routineLoading}
      <div class="flex justify-center py-12">
        <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    {:else}
      <div class="rounded-xl p-4 mb-4" style="background-color: #1a1a1a;">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-xl font-bold">{routineDetail.name}</h2>
            <p class="text-xs text-neutral-500 mt-0.5">{routineDetail.exercises.length} exercises</p>
          </div>
          <button
            onclick={() => { selectedRoutineId = null; routineDetail = null; }}
            class="text-xs text-neutral-500 hover:text-green-400"
          >Change</button>
        </div>
      </div>

      <div class="space-y-2 mb-6">
        {#each routineDetail.exercises as ex}
          <div class="rounded-xl p-4 relative" style="background-color: #1a1a1a;">
            <div class="absolute top-3 right-3 flex items-center gap-2">
              {#if ex.isEstimate}
                <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background-color: #8b5cf620; color: #8b5cf6;">
                  ~ EST
                </span>
              {:else if ex.progression === 'up'}
                <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background-color: #22c55e20; color: #22c55e;">
                  &#8593; PROGRESS
                </span>
              {:else if ex.progression === 'deload'}
                <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background-color: #ef444420; color: #ef4444;">
                  &#8595; DELOAD
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
            {#if !ex.exerciseId}
              <span class="text-xs text-amber-500/60 mt-1">Unmatched — will create new exercise</span>
            {/if}
            {#if ex.repRange}
              <span class="text-xs text-neutral-600 mt-1">target: {ex.repRange.min}–{ex.repRange.max} reps</span>
            {/if}
          </div>
        {/each}
      </div>

      <button
        onclick={startRoutineWorkout}
        disabled={startingRoutine}
        class="w-full font-semibold text-lg py-4 rounded-xl disabled:opacity-50"
        style="background-color: #22c55e; color: #0f0f0f;"
      >
        {startingRoutine ? 'Starting...' : 'Start Workout'}
      </button>
    {/if}
  {/if}

  <!-- Freestyle Mode -->
  {#if mode === 'freestyle' && !programLoading}
  {#if lastDayType}
    <!-- Quick Start — generate + start in one tap using last-used defaults -->
    <button
      onclick={quickStartFreestyle}
      disabled={quickStarting}
      class="w-full font-semibold text-lg py-5 rounded-xl mb-4 disabled:opacity-50"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      {quickStarting ? 'Starting...' : `⚡ Quick Start: ${DAY_TYPE_LABELS[lastDayType] ?? lastDayType}`}
    </button>
    <p class="text-xs text-neutral-500 text-center -mt-2 mb-4">
      {DAY_TYPE_LABELS[lastDayType] ?? lastDayType} · {duration} min · {selectedProfile?.name ?? 'Full Gym'}{supersets ? ' · Supersets' : ''}
    </p>
  {/if}

  <!-- Gym Profile Selector -->
  {#if profiles.length > 0}
    <div class="mb-2 rounded-xl p-4" style="background-color: #1a1a1a;">
      <span class="text-sm font-medium text-neutral-300 block mb-2">Gym Profile</span>
      <div class="flex flex-wrap gap-2">
        {#each profiles as profile}
          <button
            onclick={() => { selectProfile(profile.id); if (dayType) generate(); }}
            class="px-4 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation
              {selectedProfileId === profile.id ? 'bg-green-500/20 text-green-400' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}"
          >{profile.name}</button>
        {/each}
      </div>
    </div>
  {/if}
  <div class="flex items-center justify-between mb-4 rounded-xl p-4" style="background-color: #1a1a1a;">
    <span class="text-sm font-medium text-neutral-300">Supersets</span>
    <button
      onclick={toggleSupersets}
      class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {supersets ? 'bg-blue-500/20 text-blue-400' : 'bg-neutral-700 text-neutral-400'}"
    >
      {supersets ? 'On' : 'Off'}
    </button>
  </div>

  <!-- Duration Selector -->
  <div class="grid grid-cols-3 gap-2 mb-4">
    {#each [30, 45, 60, 75, 90, 120] as min}
      <button
        onclick={() => selectDuration(min)}
        class="py-2.5 rounded-xl text-center text-sm font-medium transition-all
          {duration === min ? 'ring-2 ring-green-500 text-green-400' : 'text-neutral-400 hover:text-white'}"
        style="background-color: {duration === min ? '#22c55e15' : '#1a1a1a'};"
      >
        {min} min
      </button>
    {/each}
  </div>

  <!-- Day Type Buttons -->
  <p class="text-xs text-neutral-500 uppercase tracking-wider mb-1.5">PPL Split</p>
  <div class="grid grid-cols-3 gap-3 mb-3">
    {#each [['push', 'Push'], ['pull', 'Pull'], ['legs', 'Legs']] as [type, label]}
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
  <p class="text-xs text-neutral-500 uppercase tracking-wider mb-1.5">Classic</p>
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
    {#if workout.volumeReductionPct}
      <div class="mb-3 rounded-xl px-4 py-2.5 border border-amber-500/40" style="background-color: #78350f30;">
        <span class="text-sm font-medium text-amber-400">Volume reduced {workout.volumeReductionPct}% — calorie deficit</span>
      </div>
    {:else if workout.isInCut}
      <div class="mb-3 rounded-xl px-4 py-2.5 border border-amber-500/30" style="background-color: #78350f20;">
        <span class="text-sm font-medium text-amber-400">Cut mode — maintaining weights, extra cardio</span>
      </div>
    {/if}

    {#if cardioWarning}
      <div class="mb-3 rounded-xl px-4 py-2.5 border border-yellow-500/40" style="background-color: #71350020;">
        <span class="text-sm font-medium text-yellow-400">
          Cardio: ~{Math.round(estimatedCardioMin)} min — below 45 min target
        </span>
        <button
          onclick={() => {
            if (!workout) return;
            workout.exercises = [...workout.exercises, {
              id: 0, name: 'Treadmill', suggestedSets: 1, suggestedReps: 1,
              suggestedWeightKg: 0, lastPerformedDaysAgo: 0, isFocus: false,
              isCardio: true, suggestedDurationSec: 2700, restSeconds: 0,
            }];
          }}
          class="ml-3 text-xs px-2 py-0.5 rounded-lg bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 transition-colors"
        >+ Add cardio</button>
      </div>
    {/if}

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

  <!-- Add Exercise Sheet (program mode) -->
  <ExerciseSearchSheet
    open={addExerciseOpen}
    title="Add Exercise"
    query={addExerciseSearch}
    results={addExerciseResults}
    onInput={onAddExerciseInput}
    onSelect={pickExerciseToAdd}
    onClose={closeAddExercise}
  />

  {#if !activeProgram}
    <p class="text-center text-sm text-neutral-600 mt-6">
      <a href="/programs" class="hover:text-green-400">Programs</a>
      <span class="mx-2">&middot;</span>
      <a href="/routines" class="hover:text-green-400">Routines</a>
    </p>
  {/if}
  {/if}
</div>
