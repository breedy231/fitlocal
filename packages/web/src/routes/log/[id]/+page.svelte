<script lang="ts">
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import ExerciseDetail from '$lib/ExerciseDetail.svelte';
  import PlateCalculator from '$lib/PlateCalculator.svelte';
  import NutritionCard from '$lib/NutritionCard.svelte';
  import { cachedGet } from '$lib/api-cache.svelte';
  import { showToast } from '$lib/toast';

  let detailExerciseId: number | null = $state(null);

  // Daily nutrition for post-workout summary
  interface NutritionData {
    calories: { current: number | null; target: number | null };
    protein: { current: number | null; target: number | null };
    isInCut: boolean;
    deficitMagnitude: number | null;
    deficitPct: number | null;
    date: string;
    snapshotDate?: string;
    isStale?: boolean;
  }
  const nutritionCache = cachedGet<NutritionData>('/goals/daily-nutrition');
  let nutritionData = $derived(nutritionCache.data);
  let plateCalcWeightLbs: number | null = $state(null);
  let plateCalcSet: SetData | null = $state(null);

  interface SetData {
    id: number;
    reps: number | null;
    weightKg: number | null;
    isWarmup: boolean;
    rpe?: number | null;
    completed?: boolean;
    isPR?: boolean;
  }

  interface LastPerformance {
    date: string;
    sets: { reps: number; weightKg: number }[];
  }

  interface WorkoutExercise {
    id: number;
    exerciseId: number;
    exercise: { id: number; name: string; primaryMuscles?: string[] };
    sets: SetData[];
    restSeconds?: number;
    expanded?: boolean;
    supersetGroup?: number | null;
    lastPerformance?: LastPerformance | null;
    prWeightKg?: number | null;
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
  let showPRCelebration = $state(false);
  let prExerciseName = $state('');
  let showSummary = $state(false);
  let allSetsCompleted = $state(false);
  let hasCelebrated = false;

  let allComplete = $derived(
    workout !== null &&
    (workout as Workout).exercises.length > 0 &&
    (workout as Workout).exercises.every((ex: WorkoutExercise) => ex.sets.length > 0 && ex.sets.every((s: SetData) => s.completed))
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
  let effortRating = $state(5);

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
  let restTotalTime = $state(0);
  let restTimerActive = $state(false);
  let restTimerInterval: ReturnType<typeof setInterval> | null = null;
  let hasVibrated10s = false;

  // Stretch state (shared for warm-up and cool-down)
  let stretchPhase: 'warmup' | 'cooldown' | null = $state(null);
  let stretches: StretchData[] = $state([]);
  let activeStretchIndex = $state(0);
  let stretchTimeLeft = $state(0);
  let stretchTimerActive = $state(false);
  let stretchTimerInterval: ReturnType<typeof setInterval> | null = null;

  // Keep old name for the $effect check
  let showCoolDown = $derived(stretchPhase === 'cooldown');

  // Group exercises for superset display
  type ExerciseGroup = { supersetGroup: number | null; exercises: WorkoutExercise[] };

  let exerciseGroups = $derived.by((): ExerciseGroup[] => {
    if (!workout) return [];
    const groups: ExerciseGroup[] = [];
    const assigned = new Set<number>();
    for (let i = 0; i < workout.exercises.length; i++) {
      if (assigned.has(i)) continue;
      const ex = workout.exercises[i];
      if (ex.supersetGroup) {
        const partners = workout.exercises
          .map((e, idx) => ({ e, idx }))
          .filter(({ e, idx }) => e.supersetGroup === ex.supersetGroup && !assigned.has(idx));
        const group: WorkoutExercise[] = [];
        for (const { e, idx } of partners) {
          group.push(e);
          assigned.add(idx);
        }
        groups.push({ supersetGroup: ex.supersetGroup, exercises: group });
      } else {
        assigned.add(i);
        groups.push({ supersetGroup: null, exercises: [ex] });
      }
    }
    return groups;
  });

  const SUPERSET_REST_SECONDS = 30;

  const CARDIO_PATTERN = /treadmill|elliptical|cycling|rowing/i;

  function isCardio(ex: WorkoutExercise): boolean {
    return CARDIO_PATTERN.test(ex.exercise?.name ?? '');
  }

  const KG_TO_LBS = 2.20462;

  function kgToLbs(kg: number | null): number {
    if (!kg) return 0;
    return Math.round((kg * KG_TO_LBS) / 2.5) * 2.5;
  }

  function lbsToKg(lbs: number): number {
    return lbs / KG_TO_LBS;
  }

  function getWorkoutMuscles(): string[] {
    if (!workout) return [];
    const muscles = new Set<string>();
    for (const ex of workout.exercises) {
      if (ex.exercise.primaryMuscles) {
        for (const m of ex.exercise.primaryMuscles) muscles.add(m);
      }
    }
    return [...muscles];
  }

  const FALLBACK_STRETCHES: StretchData[] = [
    { name: 'Standing Quad Stretch', duration: 30, muscles: ['quads'], instructions: 'Stand on one leg, pull opposite foot to glutes. Hold and switch.' },
    { name: 'Chest Doorway Stretch', duration: 30, muscles: ['chest'], instructions: 'Place forearm on doorframe at 90°, lean forward gently.' },
    { name: 'Seated Hamstring Stretch', duration: 30, muscles: ['hamstrings'], instructions: 'Sit with one leg extended, reach toward toes. Hold and switch.' },
    { name: "Child's Pose", duration: 45, muscles: ['back'], instructions: 'Kneel, sit back on heels, extend arms forward on the floor.' },
  ];

  async function loadStretches(muscleGroups: string[]): Promise<StretchData[]> {
    if (muscleGroups.length === 0) return FALLBACK_STRETCHES;
    try {
      const result = await api<StretchData[]>(`/stretches?muscleGroups=${muscleGroups.join(',')}`);
      return result.length > 0 ? result : FALLBACK_STRETCHES;
    } catch {
      return FALLBACK_STRETCHES;
    }
  }

  function beginStretchPhase(phase: 'warmup' | 'cooldown', stretchList: StretchData[]) {
    stretches = stretchList;
    stretchPhase = phase;
    activeStretchIndex = 0;
    stretchTimeLeft = stretchList[0].duration;
    stretchTimerActive = false;
  }

  const CACHE_PREFIX = 'fitlocal-workout-';

  function cacheWorkout(id: string, data: Workout) {
    try { localStorage.setItem(CACHE_PREFIX + id, JSON.stringify(data)); } catch { /* quota */ }
  }

  function getCachedWorkout(id: string): Workout | null {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function initWorkout(w: Workout) {
    for (const ex of w.exercises) {
      ex.expanded = true;
      for (const s of ex.sets) {
        s.completed = false;
      }
    }
  }

  onMount(async () => {
    const id = $page.params.id!;
    try {
      workout = await api<Workout>(`/workouts/${id}`);
      if (workout?.exercises) {
        cacheWorkout(id, workout);
        initWorkout(workout);
        const muscles = getWorkoutMuscles();
        const stretchList = await loadStretches(muscles);
        beginStretchPhase('warmup', stretchList);
      }
    } catch (e: any) {
      // Try loading from cache if offline
      const cached = getCachedWorkout(id);
      if (cached) {
        workout = cached;
        initWorkout(workout);
        showToast('Loaded from offline cache', 'info');
      } else {
        showToast('Could not load workout — check that the server is running', 'error');
      }
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

  function adjustWeightLbs(set: SetData, deltaLbs: number) {
    const currentLbs = kgToLbs(set.weightKg);
    const newLbs = Math.max(0, currentLbs + deltaLbs);
    set.weightKg = lbsToKg(newLbs);
  }

  function updateWeightLbs(set: SetData, lbsStr: string) {
    const lbs = parseFloat(lbsStr) || 0;
    set.weightKg = lbsToKg(lbs);
  }

  async function toggleComplete(set: SetData, ex: WorkoutExercise) {
    set.completed = !set.completed;
    // Save set to API immediately when completing
    if (set.completed) {
      try {
        await api(`/sets/${set.id}`, {
          method: 'PUT',
          body: JSON.stringify({ reps: set.reps, weightKg: set.weightKg, rpe: set.rpe }),
        });
      } catch {
        showToast('Failed to save set — will retry on finish', 'error');
      }
      // PR detection: check if this set's weight exceeds the all-time best
      if (set.weightKg && set.weightKg > 0 && ex.prWeightKg != null && set.weightKg > ex.prWeightKg) {
        set.isPR = true;
        ex.prWeightKg = set.weightKg; // Update so subsequent equal sets don't re-trigger
        prExerciseName = ex.exercise?.name ?? 'Exercise';
        showPRCelebration = true;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([100, 30, 100, 30, 100, 30, 200]);
        }
        setTimeout(() => { showPRCelebration = false; }, 2500);
      }

      // Superset auto-cycling: scroll to the partner exercise
      if (ex.supersetGroup && workout) {
        const partners = workout.exercises.filter(e => e.supersetGroup === ex.supersetGroup);
        const currentIdx = partners.indexOf(ex);
        const nextPartner = partners[(currentIdx + 1) % partners.length];
        if (nextPartner && nextPartner.id !== ex.id) {
          setTimeout(() => {
            document.getElementById(`exercise-${nextPartner.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 300);
        }
      }

      // Start rest timer — shorter rest between superset partners
      // For supersets, only start the full rest after ALL partners have a completed set in the current round
      const restSec = ex.supersetGroup ? SUPERSET_REST_SECONDS : (ex.restSeconds ?? 60);
      if (restSec > 0) {
        startRestTimer(restSec);
      }
    }
  }

  function requestNotificationPermission() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function startRestTimer(seconds: number) {
    if (restTimerInterval) clearInterval(restTimerInterval);
    restTimeLeft = seconds;
    restTotalTime = seconds;
    restTimerActive = true;
    hasVibrated10s = false;
    requestNotificationPermission();
    restTimerInterval = setInterval(() => {
      restTimeLeft--;
      if (restTimeLeft === 10 && !hasVibrated10s) {
        hasVibrated10s = true;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
      }
      if (restTimeLeft <= 0) {
        // Fire notification for rest complete
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Rest Complete', { body: 'Time for your next set', tag: 'rest-timer' });
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([300, 100, 300]);
        }
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

  async function finishWorkout() {
    if (!workout) return;
    finishing = true;
    try {
      for (const ex of workout.exercises) {
        for (const set of ex.sets) {
          await api(`/sets/${set.id}`, {
            method: 'PUT',
            body: JSON.stringify({ reps: set.reps, weightKg: set.weightKg, rpe: set.rpe }),
          });
        }
      }
      await api(`/workouts/${workout.id}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: workout.notes || 'Completed' }),
      });

      // Load stretches for cool-down
      const muscles = getWorkoutMuscles();
      const stretchList = await loadStretches(muscles);
      beginStretchPhase('cooldown', stretchList);
    } catch (e: any) {
      showToast('Failed to save workout — check connection and try again', 'error');
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
      finishStretchPhase();
    }
  }

  function finishStretchPhase() {
    const phase = stretchPhase;
    stretchPhase = null;
    if (phase === 'warmup') {
      // Warm-up done — start the workout timer now
      startTime = Date.now();
    } else {
      // Cool-down done — show summary
      summaryData = computeSummary();
      showSummary = true;
    }
  }

  async function generateShareCard() {
    if (!summaryData || !workout) return;
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, 600, 800);

    // Header accent
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(0, 0, 600, 4);

    // Date
    ctx.fillStyle = '#6b7280';
    ctx.font = '16px system-ui, -apple-system, sans-serif';
    ctx.fillText(new Date(workout.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), 32, 48);

    // Title
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 32px system-ui, -apple-system, sans-serif';
    ctx.fillText('Workout Complete', 32, 96);

    // Stats grid
    const stats = [
      { label: 'Sets', value: String(summaryData.totalSets) },
      { label: 'Volume', value: `${summaryData.totalVolumeLbs.toLocaleString()} lbs` },
      { label: 'Exercises', value: String(summaryData.exerciseCount) },
      { label: 'Duration', value: `${summaryData.durationMin} min` },
    ];

    let y = 140;
    for (let i = 0; i < stats.length; i += 2) {
      for (let j = 0; j < 2; j++) {
        const s = stats[i + j];
        const x = 32 + j * 280;
        // Card bg
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.roundRect(x, y, 256, 80, 12);
        ctx.fill();
        // Value
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
        ctx.fillText(s.value, x + 16, y + 40);
        // Label
        ctx.fillStyle = '#6b7280';
        ctx.font = '14px system-ui, -apple-system, sans-serif';
        ctx.fillText(s.label, x + 16, y + 64);
      }
      y += 96;
    }

    // Exercises
    y += 16;
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText('EXERCISES', 32, y);
    y += 24;

    for (const ex of summaryData.exercises.slice(0, 8)) {
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '16px system-ui, -apple-system, sans-serif';
      ctx.fillText(ex.name, 32, y);
      ctx.fillStyle = '#6b7280';
      ctx.font = '14px system-ui, -apple-system, sans-serif';
      const detail = `${ex.sets} sets @ ${ex.avgWeightLbs} lbs`;
      ctx.fillText(detail, 600 - 32 - ctx.measureText(detail).width, y);
      y += 32;
    }

    // Footer branding
    ctx.fillStyle = '#374151';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText('FitLocal', 32, 770);

    // Export
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({
            files: [new File([blob], 'workout.png', { type: 'image/png' })],
            title: 'Workout Complete',
          });
          return;
        } catch { /* user cancelled or share not supported */ }
      }
      // Fallback: download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workout-${workout!.date}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  function skipStretches() {
    if (stretchTimerInterval) clearInterval(stretchTimerInterval);
    finishStretchPhase();
  }
</script>

{#snippet exerciseBlock(ex: WorkoutExercise)}
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
      {#if isCardio(ex)}
        {#each ex.sets as set, idx}
          <div class="space-y-2 py-2 {idx > 0 ? 'border-t border-neutral-800' : ''}">
            <div class="grid grid-cols-[1fr_1fr_1fr_48px] gap-2 items-center">
              <div>
                <label class="text-xs text-neutral-500 block mb-1">Duration (min)</label>
                <div class="flex items-center justify-center gap-1">
                  <button
                    onclick={() => adjustReps(set, -1)}
                    class="w-8 h-8 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-sm active:bg-neutral-700"
                  >−</button>
                  <span class="w-7 text-center text-sm font-bold">{set.reps ?? 0}</span>
                  <button
                    onclick={() => adjustReps(set, 1)}
                    class="w-8 h-8 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-sm active:bg-neutral-700"
                  >+</button>
                </div>
              </div>
              <div>
                <label class="text-xs text-neutral-500 block mb-1">Resistance</label>
                <input
                  type="number"
                  value={set.rpe ?? ''}
                  onchange={(e) => { set.rpe = parseFloat(e.currentTarget.value) || 0; }}
                  placeholder="level"
                  class="w-full text-center text-sm py-1.5 rounded bg-neutral-800 text-white border-none outline-none"
                  step="1"
                  min="0"
                  max="30"
                />
              </div>
              <div>
                <label class="text-xs text-neutral-500 block mb-1">Distance (km)</label>
                <input
                  type="number"
                  value={set.weightKg ?? ''}
                  onchange={(e) => { set.weightKg = parseFloat(e.currentTarget.value) || 0; }}
                  placeholder="opt."
                  class="w-full text-center text-sm py-1.5 rounded bg-neutral-800 text-white border-none outline-none"
                  step="0.1"
                />
              </div>
              <div class="pt-4">
                <button
                  onclick={() => toggleComplete(set, ex)}
                  class="w-11 h-11 rounded-lg flex items-center justify-center transition-colors
                    {set.completed ? 'bg-green-500/20 text-green-400' : 'bg-neutral-800 text-neutral-600'}"
                >
                  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        {/each}
      {:else}
        {#each ex.sets as set, idx}
          {@const lastSet = ex.lastPerformance?.sets[idx]}
          <div class="flex items-center gap-2 py-1.5 {idx > 0 ? 'border-t border-neutral-800/50' : ''}">
            <div class="w-6 text-center shrink-0">
              <span class="text-xs text-neutral-500">{idx + 1}</span>
              {#if lastSet}
                <div class="text-[9px] text-neutral-600 leading-tight mt-0.5" title="Last session">{kgToLbs(lastSet.weightKg)}×{lastSet.reps}</div>
              {/if}
            </div>

            <div class="flex items-center gap-1 shrink-0">
              <button
                onclick={() => adjustReps(set, -1)}
                class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700"
              >−</button>
              <span class="w-8 text-center text-sm font-bold">{set.reps ?? 0}</span>
              <button
                onclick={() => adjustReps(set, 1)}
                class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700"
              >+</button>
            </div>

            <span class="text-neutral-600 text-xs shrink-0">×</span>

            <div class="flex items-center gap-1 shrink-0">
              <button
                onclick={() => adjustWeightLbs(set, -5)}
                class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700"
              >−</button>
              <input
                type="number"
                value={kgToLbs(set.weightKg)}
                onchange={(e) => updateWeightLbs(set, e.currentTarget.value)}
                class="w-14 text-center text-sm font-bold py-1.5 rounded-lg bg-neutral-800/50 text-white border-none outline-none"
                step="2.5"
                inputmode="decimal"
              />
              <button
                onclick={() => adjustWeightLbs(set, 5)}
                class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700"
              >+</button>
            </div>

            <button
              onclick={() => { plateCalcWeightLbs = kgToLbs(set.weightKg); plateCalcSet = set; }}
              class="w-7 h-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700 transition-colors shrink-0"
              title="Plate calculator"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
              </svg>
            </button>

            <div class="flex items-center gap-1 shrink-0 ml-auto">
              {#if set.isPR}
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 animate-pulse">PR</span>
              {/if}
              <button
                onclick={() => toggleComplete(set, ex)}
                class="w-11 h-11 rounded-lg flex items-center justify-center transition-colors
                  {set.completed ? 'bg-green-500/20 text-green-400' : 'bg-neutral-800 text-neutral-600'}"
              >
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
                </svg>
              </button>
            </div>
          </div>
        {/each}
      {/if}

      <div class="flex gap-2 mt-2">
        <button
          onclick={() => addSet(ex)}
          class="flex-1 py-2 rounded-lg text-sm text-neutral-400 bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
        >
          + Add Set
        </button>
        {#if ex.sets.length > 1}
          <button
            onclick={() => { const last = ex.sets[ex.sets.length - 1]; if (last && !last.completed) deleteSet(ex, last.id); }}
            class="px-3 py-2 rounded-lg text-sm text-red-400/70 bg-neutral-800/50 hover:bg-red-500/10 transition-colors"
            title="Remove last set"
          >
            − Set
          </button>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
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

      <!-- Daily Nutrition (if goals are set) -->
      {#if nutritionData && nutritionData.calories.target != null}
        <div class="mb-6">
          <NutritionCard data={nutritionData} />
        </div>
      {/if}

      <!-- Effort Rating -->
      <div class="rounded-xl p-4 mb-6" style="background-color: #1a1a1a;">
        <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">How hard was that?</h2>
        <div class="flex justify-between mb-2">
          {#each [1,2,3,4,5,6,7,8,9,10] as n}
            <button
              onclick={() => effortRating = n}
              class="w-8 h-8 rounded-full text-xs font-bold transition-all {effortRating === n
                ? n <= 3 ? 'bg-green-500 text-black scale-110' : n <= 6 ? 'bg-yellow-500 text-black scale-110' : n <= 8 ? 'bg-orange-500 text-black scale-110' : 'bg-red-500 text-black scale-110'
                : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700'}"
            >{n}</button>
          {/each}
        </div>
        <div class="flex justify-between text-xs text-neutral-600">
          <span>Easy</span>
          <span>Moderate</span>
          <span>Max effort</span>
        </div>
      </div>

      <div class="flex gap-3">
        <button
          onclick={generateShareCard}
          class="py-4 px-6 rounded-xl text-sm font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors flex items-center gap-2"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
          </svg>
          Share
        </button>
        <button
          onclick={async () => {
            if (workout) {
              await api(`/workouts/${workout.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ effortRating }),
              }).catch(() => {});
            }
            goto('/history');
          }}
          class="flex-1 font-semibold text-lg py-4 rounded-xl"
          style="background-color: #22c55e; color: #0f0f0f;"
        >
          Done
        </button>
      </div>
    </div>
  {:else if stretchPhase !== null}
    <!-- Stretch Screen (warm-up or cool-down) -->
    <div class="py-6">
      <div class="flex items-center justify-between mb-8">
        <h1 class="text-2xl font-bold">{stretchPhase === 'warmup' ? 'Warm Up' : 'Cool Down'}</h1>
        <button onclick={skipStretches} class="text-sm text-neutral-500 hover:text-neutral-300">
          {stretchPhase === 'warmup' ? 'Skip to Workout' : 'Skip Cool Down'}
        </button>
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
                    {#if idx < stretches.length - 1}
                      Next Stretch
                    {:else if stretchPhase === 'warmup'}
                      Start Workout
                    {:else}
                      Finish
                    {/if}
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
      <span class="text-sm text-neutral-500">{new Date(workout.date + 'T12:00:00').toLocaleDateString()}</span>
    </div>

    <div class="space-y-4 mb-6">
      {#each exerciseGroups as group}
        {#if group.supersetGroup !== null && group.exercises.length > 1}
          <!-- Superset group with visual bracket -->
          <div class="flex gap-0">
            <!-- Bracket -->
            <div class="w-1.5 shrink-0 rounded-full my-2" style="background-color: #3b82f6;"></div>
          <div class="flex-1 rounded-xl overflow-hidden border border-blue-500/30" style="background-color: #1a1a1a;">
            <div class="px-4 py-1.5 text-xs font-bold text-blue-400 uppercase tracking-wider border-b border-blue-500/20" style="background-color: #1e3a5f20;">
              Superset · 30s rest between
            </div>
            {#each group.exercises as ex, gIdx}
              <div id="exercise-{ex.id}" class="{gIdx > 0 ? 'border-t border-neutral-800' : ''}">
                {@render exerciseBlock(ex)}
              </div>
            {/each}
          </div>
          </div>
        {:else}
          {#each group.exercises as ex}
            <div id="exercise-{ex.id}" class="rounded-xl overflow-hidden" style="background-color: #1a1a1a;">
              {@render exerciseBlock(ex)}
            </div>
          {/each}
        {/if}
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

{#if plateCalcWeightLbs !== null}
  <PlateCalculator
    weightLbs={plateCalcWeightLbs}
    onclose={() => { plateCalcWeightLbs = null; plateCalcSet = null; }}
    onapply={(lbs) => { if (plateCalcSet) { plateCalcSet.weightKg = lbsToKg(lbs); } }}
  />
{/if}

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

<!-- PR Celebration Animation -->
{#if showPRCelebration}
  <div class="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center celebration-flash" style="animation: pr-flash-anim 2.5s ease-out forwards;">
    <div class="text-center">
      <div class="text-5xl font-bold text-amber-400 celebration-text" style="animation: celebration-text-anim 2.5s ease-out forwards;">NEW PR!</div>
      <div class="text-lg text-amber-300/80 mt-2" style="animation: celebration-text-anim 2.5s ease-out 0.2s forwards; opacity: 0;">{prExerciseName}</div>
    </div>
    {#each Array(25) as _, i}
      <div
        class="absolute w-2.5 h-2.5 rounded-full confetti-piece"
        style="
          left: {15 + Math.random() * 70}%;
          background-color: {['#f59e0b', '#fbbf24', '#d97706', '#22c55e', '#8b5cf6'][i % 5]};
          animation-delay: {Math.random() * 0.5}s;
        "
      ></div>
    {/each}
  </div>
{/if}

<!-- Non-blocking Rest Timer Bar -->
{#if restTimerActive}
  <div class="fixed bottom-20 left-0 right-0 z-40 flex justify-center pointer-events-none px-4">
    <div class="w-full max-w-lg rounded-xl px-4 py-3 pointer-events-auto shadow-lg" style="background-color: #1a1a1a; border: 1px solid #333;">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <span class="text-xs text-neutral-500 uppercase tracking-wider shrink-0">Rest</span>
          <span class="text-2xl font-mono font-bold text-white">{formatTime(restTimeLeft)}</span>
        </div>
        <div class="flex-1 mx-2">
          <div class="h-1 rounded-full bg-neutral-800 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-1000 ease-linear"
              style="width: {restTotalTime > 0 ? ((restTotalTime - restTimeLeft) / restTotalTime) * 100 : 0}%; background-color: #22c55e;"
            ></div>
          </div>
        </div>
        <button
          onclick={dismissRestTimer}
          class="text-xs font-medium text-neutral-400 hover:text-white transition-colors shrink-0 px-2 py-1 rounded-md hover:bg-neutral-800"
        >
          Skip
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes celebration-flash-anim {
    0% { background-color: rgba(34, 197, 94, 0.3); }
    50% { background-color: rgba(34, 197, 94, 0.1); }
    100% { background-color: transparent; }
  }
  @keyframes pr-flash-anim {
    0% { background-color: rgba(245, 158, 11, 0.3); }
    50% { background-color: rgba(245, 158, 11, 0.1); }
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
