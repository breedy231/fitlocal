<script lang="ts">
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
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
    exercise: { id: number; name: string; primaryMuscles?: string[] };
    sets: SetData[];
    restSeconds?: number;
    expanded?: boolean;
  }

  interface Workout {
    id: number;
    date: string;
    notes?: string;
    exercises: WorkoutExercise[];
  }

  interface StretchData {
    name: string;
    muscles: string[];
    duration: number;
    instructions: string;
  }

  let workout: Workout | null = $state(null);
  let loading = $state(true);
  let finishing = $state(false);

  // Completion tracking
  let startTime = $state(Date.now());
  let showCelebration = $state(false);
  let showSummary = $state(false);
  let allSetsCompleted = $state(false);
  let hasCelebrated = false;

  let allComplete = $derived(
    workout != null &&
    workout.exercises.length > 0 &&
    workout.exercises.every(ex => ex.sets.length > 0 && ex.sets.every(s => s.completed))
  );

  // Watch for all-complete and trigger celebration
  $effect(() => {
    if (allComplete && !hasCelebrated && !showCoolDown && !showSummary) {
      hasCelebrated = true;
      showCelebration = true;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([100, 50, 100, 50, 200]);
      }
      setTimeout(() => { showCelebration = false; }, 2000);
    }
  });

  interface WorkoutSummary {
    totalSets: number;
    totalVolumeLbs: number;
    exerciseCount: number;
    durationMin: number;
    exercises: { name: string; sets: number; avgWeightLbs: number }[];
  }

  let summaryData: WorkoutSummary | null = $state(null);

  function computeSummary(): WorkoutSummary {
    if (!workout) return { totalSets: 0, totalVolumeLbs: 0, exerciseCount: 0, durationMin: 0, exercises: [] };
    let totalSets = 0;
    let totalVolumeLbs = 0;
    const exercises: { name: string; sets: number; avgWeightLbs: number }[] = [];

    for (const ex of workout.exercises) {
      let exSets = 0;
      let exTotalWeight = 0;
      for (const set of ex.sets) {
        totalSets++;
        exSets++;
        const weightLbs = kgToLbs(set.weightKg);
        totalVolumeLbs += weightLbs * (set.reps ?? 0);
        exTotalWeight += weightLbs;
      }
      exercises.push({
        name: ex.exercise?.name ?? 'Exercise',
        sets: exSets,
        avgWeightLbs: exSets > 0 ? Math.round(exTotalWeight / exSets) : 0,
      });
    }

    const durationMin = Math.round((Date.now() - startTime) / 60000);
    return { totalSets, totalVolumeLbs: Math.round(totalVolumeLbs), exerciseCount: workout.exercises.length, durationMin, exercises };
  }

  // Rest timer state
  let restTimeLeft = $state(0);
  let restTimerActive = $state(false);
  let restTimerInterval: ReturnType<typeof setInterval> | null = null;
  let hasVibrated10s = false;

  // Cool-down state
  let showCoolDown = $state(false);
  let stretches: StretchData[] = $state([]);
  let activeStretchIndex = $state(0);
  let stretchTimeLeft = $state(0);
  let stretchTimerActive = $state(false);
  let stretchTimerInterval: ReturnType<typeof setInterval> | null = null;

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

  onDestroy(() => {
    if (restTimerInterval) clearInterval(restTimerInterval);
    if (stretchTimerInterval) clearInterval(stretchTimerInterval);
  });

  function adjustReps(set: SetData, delta: number) {
    set.reps = Math.max(0, (set.reps ?? 0) + delta);
  }

  function updateWeightLbs(set: SetData, lbsStr: string) {
    const lbs = parseFloat(lbsStr) || 0;
    set.weightKg = lbsToKg(lbs);
  }

  function toggleComplete(set: SetData, ex: WorkoutExercise) {
    set.completed = !set.completed;
    // Start rest timer when completing a set
    if (set.completed && ex.restSeconds && ex.restSeconds > 0) {
      startRestTimer(ex.restSeconds);
    }
  }

  function startRestTimer(seconds: number) {
    if (restTimerInterval) clearInterval(restTimerInterval);
    restTimeLeft = seconds;
    restTimerActive = true;
    hasVibrated10s = false;
    restTimerInterval = setInterval(() => {
      restTimeLeft--;
      if (restTimeLeft === 10 && !hasVibrated10s) {
        hasVibrated10s = true;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
      }
      if (restTimeLeft <= 0) {
        dismissRestTimer();
      }
    }, 1000);
  }

  function dismissRestTimer() {
    restTimerActive = false;
    restTimeLeft = 0;
    if (restTimerInterval) {
      clearInterval(restTimerInterval);
      restTimerInterval = null;
    }
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
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

      // Load stretches for cool-down
      const muscles = new Set<string>();
      for (const ex of workout.exercises) {
        if (ex.exercise.primaryMuscles) {
          for (const m of ex.exercise.primaryMuscles) muscles.add(m);
        }
      }
      if (muscles.size > 0) {
        try {
          stretches = await api<StretchData[]>(`/stretches?muscleGroups=${[...muscles].join(',')}`);
        } catch {
          stretches = [];
        }
      }

      if (stretches.length > 0) {
        showCoolDown = true;
        activeStretchIndex = 0;
        stretchTimeLeft = stretches[0].duration;
        stretchTimerActive = false;
      } else {
        summaryData = computeSummary();
        showSummary = true;
      }
    } catch (e: any) {
      alert('Failed to save workout');
    } finally {
      finishing = false;
    }
  }

  function startStretchTimer() {
    if (stretchTimerInterval) clearInterval(stretchTimerInterval);
    stretchTimerActive = true;
    stretchTimerInterval = setInterval(() => {
      stretchTimeLeft--;
      if (stretchTimeLeft <= 0) {
        clearInterval(stretchTimerInterval!);
        stretchTimerInterval = null;
        stretchTimerActive = false;
        advanceStretch();
      }
    }, 1000);
  }

  function advanceStretch() {
    if (stretchTimerInterval) {
      clearInterval(stretchTimerInterval);
      stretchTimerInterval = null;
    }
    stretchTimerActive = false;
    if (activeStretchIndex < stretches.length - 1) {
      activeStretchIndex++;
      stretchTimeLeft = stretches[activeStretchIndex].duration;
    } else {
      showCoolDown = false;
      summaryData = computeSummary();
      showSummary = true;
    }
  }

  function skipCoolDown() {
    if (stretchTimerInterval) clearInterval(stretchTimerInterval);
    showCoolDown = false;
    summaryData = computeSummary();
    showSummary = true;
  }
</script>

<div class="p-4 max-w-lg mx-auto">
  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if showSummary && summaryData}
    <!-- Workout Summary Screen -->
    <div class="py-6">
      <div class="text-center mb-8">
        <div class="text-4xl mb-2">&#128170;</div>
        <h1 class="text-2xl font-bold text-green-400">Great Work!</h1>
      </div>

      <div class="grid grid-cols-2 gap-3 mb-6">
        <div class="rounded-xl p-4 text-center" style="background-color: #1a1a1a;">
          <div class="text-2xl font-bold text-green-400">{summaryData.totalSets}</div>
          <div class="text-xs text-neutral-500 mt-1">Total Sets</div>
        </div>
        <div class="rounded-xl p-4 text-center" style="background-color: #1a1a1a;">
          <div class="text-2xl font-bold text-green-400">{summaryData.totalVolumeLbs.toLocaleString()}</div>
          <div class="text-xs text-neutral-500 mt-1">Volume (lbs)</div>
        </div>
        <div class="rounded-xl p-4 text-center" style="background-color: #1a1a1a;">
          <div class="text-2xl font-bold text-green-400">{summaryData.exerciseCount}</div>
          <div class="text-xs text-neutral-500 mt-1">Exercises</div>
        </div>
        <div class="rounded-xl p-4 text-center" style="background-color: #1a1a1a;">
          <div class="text-2xl font-bold text-green-400">{summaryData.durationMin}</div>
          <div class="text-xs text-neutral-500 mt-1">Minutes</div>
        </div>
      </div>

      <div class="rounded-xl p-4 mb-6" style="background-color: #1a1a1a;">
        <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Exercises</h2>
        <div class="space-y-2">
          {#each summaryData.exercises as ex}
            <div class="flex justify-between items-center text-sm">
              <span class="text-neutral-200">{ex.name}</span>
              <span class="text-neutral-500">{ex.sets} sets @ {ex.avgWeightLbs} lbs avg</span>
            </div>
          {/each}
        </div>
      </div>

      <button
        onclick={() => goto('/history')}
        class="w-full font-semibold text-lg py-4 rounded-xl"
        style="background-color: #22c55e; color: #0f0f0f;"
      >
        Done
      </button>
    </div>
  {:else if showCoolDown}
    <!-- Cool Down Screen -->
    <div class="py-6">
      <div class="flex items-center justify-between mb-8">
        <h1 class="text-2xl font-bold">Cool Down</h1>
        <button onclick={skipCoolDown} class="text-sm text-neutral-500 hover:text-neutral-300">Skip Cool Down</button>
      </div>

      <div class="space-y-4">
        {#each stretches as stretch, idx}
          <div class="rounded-xl p-5 transition-all {idx === activeStretchIndex ? 'ring-1 ring-green-500/50' : 'opacity-50'}" style="background-color: #1a1a1a;">
            <div class="flex items-start justify-between mb-2">
              <h3 class="font-semibold text-lg {idx === activeStretchIndex ? 'text-green-400' : 'text-neutral-300'}">{stretch.name}</h3>
              {#if idx === activeStretchIndex}
                <span class="text-2xl font-mono font-bold text-green-400">{formatTime(stretchTimeLeft)}</span>
              {:else if idx < activeStretchIndex}
                <span class="text-sm text-green-500">Done</span>
              {:else}
                <span class="text-sm text-neutral-600">{stretch.duration}s</span>
              {/if}
            </div>
            <p class="text-sm text-neutral-400 mb-3">{stretch.instructions}</p>
            <div class="flex gap-2 text-xs">
              {#each stretch.muscles as muscle}
                <span class="px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">{muscle}</span>
              {/each}
            </div>
            {#if idx === activeStretchIndex}
              <div class="mt-4 flex gap-3">
                {#if !stretchTimerActive}
                  <button onclick={startStretchTimer} class="flex-1 py-2.5 rounded-lg font-medium text-sm" style="background-color: #22c55e; color: #0f0f0f;">
                    Start
                  </button>
                {:else}
                  <button onclick={advanceStretch} class="flex-1 py-2.5 rounded-lg font-medium text-sm bg-neutral-700 text-neutral-200">
                    {idx < stretches.length - 1 ? 'Next Stretch' : 'Finish'}
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {:else if workout}
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Workout</h1>
      <span class="text-sm text-neutral-500">{new Date(workout.date).toLocaleDateString()}</span>
    </div>

    <div class="space-y-4 mb-6">
      {#each workout.exercises as ex}
        <div class="rounded-xl overflow-hidden" style="background-color: #1a1a1a;">
          <div
            class="w-full text-left p-4 flex justify-between items-center cursor-pointer"
          >
            <span class="font-medium">
              <button
                onclick={(e) => { e.stopPropagation(); detailExerciseId = ex.exerciseId; }}
                class="underline decoration-neutral-600 underline-offset-2 hover:text-green-400 transition-colors"
              >{ex.exercise?.name ?? 'Exercise'}</button>
            </span>
            <button
              onclick={() => ex.expanded = !ex.expanded}
              class="p-1"
            >
              <svg class="w-5 h-5 text-neutral-500 transition-transform {ex.expanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </button>
          </div>

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
                    onclick={() => toggleComplete(set, ex)}
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

<!-- Celebration Animation -->
{#if showCelebration}
  <div class="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center celebration-flash">
    <div class="text-6xl font-bold text-green-400 celebration-text">ALL SETS DONE!</div>
    <!-- CSS confetti -->
    {#each Array(20) as _, i}
      <div
        class="absolute w-2 h-2 rounded-full confetti-piece"
        style="
          left: {20 + Math.random() * 60}%;
          background-color: {['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5]};
          animation-delay: {Math.random() * 0.5}s;
        "
      ></div>
    {/each}
  </div>
{/if}

<!-- Rest Timer Bottom Sheet -->
{#if restTimerActive}
  <div class="fixed inset-0 z-50 flex items-end justify-center" style="background-color: rgba(0,0,0,0.5);">
    <div class="w-full max-w-lg rounded-t-2xl p-6 pb-10 text-center" style="background-color: #1a1a1a;">
      <p class="text-sm text-neutral-400 uppercase tracking-wider mb-2">Rest</p>
      <p class="text-6xl font-mono font-bold text-white mb-6">{formatTime(restTimeLeft)}</p>
      <button
        onclick={dismissRestTimer}
        class="px-8 py-3 rounded-xl font-medium text-sm bg-neutral-700 text-neutral-200 hover:bg-neutral-600 transition-colors"
      >
        Skip Rest
      </button>
    </div>
  </div>
{/if}

<style>
  @keyframes celebration-flash-anim {
    0% { background-color: rgba(34, 197, 94, 0.3); }
    50% { background-color: rgba(34, 197, 94, 0.1); }
    100% { background-color: transparent; }
  }
  @keyframes celebration-text-anim {
    0% { transform: scale(0.5); opacity: 0; }
    30% { transform: scale(1.1); opacity: 1; }
    70% { transform: scale(1); opacity: 1; }
    100% { transform: scale(0.8); opacity: 0; }
  }
  @keyframes confetti-fall {
    0% { top: -10%; opacity: 1; transform: rotate(0deg); }
    100% { top: 100%; opacity: 0; transform: rotate(720deg); }
  }
  :global(.celebration-flash) {
    animation: celebration-flash-anim 2s ease-out forwards;
  }
  :global(.celebration-text) {
    animation: celebration-text-anim 2s ease-out forwards;
  }
  :global(.confetti-piece) {
    animation: confetti-fall 2s ease-in forwards;
  }
</style>
