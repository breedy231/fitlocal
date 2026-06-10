<script lang="ts">
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import ExerciseDetail from '$lib/ExerciseDetail.svelte';
  import PlateCalculator from '$lib/PlateCalculator.svelte';
  import { cachedGet } from '$lib/api-cache.svelte';
  import { showToast } from '$lib/toast';
  import type { NutritionData, LastPerformance, ExerciseProgressionReport, GeneratedAlternative } from 'fitlocal-shared';

  import RestTimer from '$lib/workout/RestTimer.svelte';
  import ExerciseCard, { type WorkoutExerciseLike } from '$lib/workout/ExerciseCard.svelte';
  import type { WorkoutSet } from '$lib/workout/SetRow.svelte';
  import StretchPhase, { type StretchData } from '$lib/workout/StretchPhase.svelte';
  import WorkoutSummary, { type WorkoutSummaryData, type ExerciseSummary } from '$lib/workout/WorkoutSummary.svelte';
  import CelebrationOverlay from '$lib/workout/CelebrationOverlay.svelte';
  import ExerciseSearchSheet from '$lib/workout/ExerciseSearchSheet.svelte';

  type SetData = WorkoutSet;

  interface WorkoutExercise extends WorkoutExerciseLike {
    exerciseId: number;
    sets: SetData[];
    lastPerformance?: LastPerformance | null;
  }

  interface Workout {
    id: number;
    date: string;
    notes?: string;
    exercises: WorkoutExercise[];
  }

  let detailExerciseId: number | null = $state(null);

  // Exercise search for add
  let searchQuery = $state('');
  let searchResults: { id: number; name: string; primaryMuscles?: string[]; equipment?: string[] }[] = $state([]);
  let addingExercise = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Inline swap UX state
  let swapInlineExercise: WorkoutExercise | null = $state(null);
  let swapReason: 'equipment' | 'variation' | null = $state(null);
  let swapCandidates: Record<number, GeneratedAlternative[] | 'loading'> = $state({});

  async function prefetchSwapCandidates(w: Workout) {
    await Promise.all(w.exercises.map(async (ex) => {
      try {
        swapCandidates[ex.exerciseId] = 'loading';
        swapCandidates = { ...swapCandidates };
        const excludeIds = w.exercises
          .filter(e => e.exerciseId !== ex.exerciseId)
          .map(e => e.exerciseId)
          .join(',');
        const res = await api<{ alternatives: GeneratedAlternative[] }>(
          `/generate-workout/replace?exerciseId=${ex.exerciseId}${excludeIds ? `&excludeIds=${excludeIds}` : ''}`
        );
        swapCandidates[ex.exerciseId] = res.alternatives.slice(0, 3);
      } catch {
        swapCandidates[ex.exerciseId] = [];
      }
      swapCandidates = { ...swapCandidates };
    }));
  }

  function openInlineSwap(ex: WorkoutExercise) {
    swapInlineExercise = ex;
    swapReason = null;
  }

  function closeInlineSwap() {
    swapInlineExercise = null;
    swapReason = null;
  }

  // Rest timer editor
  let editingRestExercise: WorkoutExercise | null = $state(null);

  // Daily nutrition for post-workout summary
  const nutritionCache = cachedGet<NutritionData>('/goals/daily-nutrition');
  let nutritionData = $derived(nutritionCache.data);
  let plateCalcWeightLbs: number | null = $state(null);
  let plateCalcSet: SetData | null = $state(null);

  // Exercise history (lazy-loaded per exercise)
  type HistoryPoint = ExerciseProgressionReport['dataPoints'][number];
  let exerciseHistory: Record<number, HistoryPoint[] | 'loading'> = $state({});

  async function toggleHistory(exerciseId: number) {
    if (exerciseHistory[exerciseId]) {
      delete exerciseHistory[exerciseId];
      exerciseHistory = { ...exerciseHistory };
      return;
    }
    exerciseHistory[exerciseId] = 'loading';
    exerciseHistory = { ...exerciseHistory };
    try {
      const res = await api<ExerciseProgressionReport>(`/reports/exercise-progression?exerciseId=${exerciseId}`);
      exerciseHistory[exerciseId] = res.dataPoints.slice(-5);
    } catch {
      delete exerciseHistory[exerciseId];
    }
    exerciseHistory = { ...exerciseHistory };
  }

  let workout: Workout | null = $state(null);
  let loading = $state(true);
  let finishing = $state(false);
  let restTimerRef: RestTimer | undefined = $state();

  // Completion tracking
  let startTime = $state(Date.now());
  let showCelebration = $state(false);
  let showPRCelebration = $state(false);
  let prExerciseName = $state('');
  let showSummary = $state(false);
  let hasCelebrated = false;

  // Only strength exercises count toward "all done" — cardio doesn't block or trigger completion
  let allComplete = $derived(
    workout !== null &&
    (workout as Workout).exercises.some((ex: WorkoutExercise) => !isCardio(ex)) &&
    (workout as Workout).exercises.filter((ex: WorkoutExercise) => !isCardio(ex)).every((ex: WorkoutExercise) => ex.sets.length > 0 && ex.sets.every((s: SetData) => s.completed))
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

  let summaryData: WorkoutSummaryData | null = $state(null);
  let effortRating = $state(5);

  function computeSummary(): WorkoutSummaryData {
    if (!workout) return { totalSets: 0, totalVolumeLbs: 0, exerciseCount: 0, durationMin: 0, prCount: 0, exercises: [] };
    let totalSets = 0;
    let totalVolumeLbs = 0;
    let prCount = 0;
    const exercises: ExerciseSummary[] = [];

    for (const ex of workout.exercises) {
      let exSets = 0;
      let exTotalWeight = 0;
      let bestSetLbs = 0;
      let bestReps = 0;
      let hasPR = false;
      let rirSum = 0;
      let rirCount = 0;
      for (const set of ex.sets) {
        totalSets++;
        exSets++;
        const weightLbs = kgToLbs(set.weightKg);
        totalVolumeLbs += weightLbs * (set.reps ?? 0);
        exTotalWeight += weightLbs;
        if (weightLbs > bestSetLbs) { bestSetLbs = weightLbs; bestReps = set.reps ?? 0; }
        if (set.isPR) hasPR = true;
        if (set.rpe != null) { rirSum += (10 - set.rpe); rirCount++; }
      }
      if (hasPR) prCount++;
      exercises.push({
        name: ex.exercise?.name ?? 'Exercise',
        sets: exSets,
        avgWeightLbs: exSets > 0 ? Math.round(exTotalWeight / exSets) : 0,
        bestSetLbs,
        bestReps,
        isPR: hasPR,
        avgRir: rirCount > 0 ? Math.round(rirSum / rirCount * 10) / 10 : null,
      });
    }

    const durationMin = Math.round((Date.now() - startTime) / 60000);
    return { totalSets, totalVolumeLbs: Math.round(totalVolumeLbs), exerciseCount: workout.exercises.length, durationMin, prCount, exercises };
  }

  // Stretch state (shared for warm-up and cool-down)
  let stretchPhase: 'warmup' | 'cooldown' | null = $state(null);
  let stretches: StretchData[] = $state([]);

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

  // Matches cardio machine exercises. "Cycling" and "Rowing" as standalone names refer to cardio
  // machines; barbell/cable rows use "Row" not "Rowing" so the word boundary is generally safe.
  const CARDIO_PATTERN = /\b(treadmill|elliptical|rowing\s+machine|stationary\s+bike|stair\s*climber|air\s+bike|assault\s+bike|cycling|rower|bike|rowing)\b/i;
  const TREADMILL_PATTERN = /treadmill|walking/i;

  function isCardio(ex: WorkoutExercise): boolean {
    return CARDIO_PATTERN.test(ex.exercise?.name ?? '');
  }

  function isTreadmill(ex: WorkoutExercise): boolean {
    return TREADMILL_PATTERN.test(ex.exercise?.name ?? '');
  }

  const KG_TO_LBS = 2.20462;

  function kgToLbs(kg: number | null): number {
    if (!kg) return 0;
    return Math.round((kg * KG_TO_LBS) / 2.5) * 2.5;
  }

  function lbsToKg(lbs: number): number {
    return lbs / KG_TO_LBS;
  }

  const PUSH_KEYWORDS = /bench|shoulder press|fly|push.?up|tricep|kickback|dip|lateral raise|overhead press|chest/i;
  const PULL_KEYWORDS = /row|pull.?up|pulldown|lat pull|curl|bicep|face pull|rear delt|deadlift/i;
  const LEGS_KEYWORDS = /squat|lunge|leg press|leg curl|leg extension|hip thrust|calf|glute|hamstring|bulgarian/i;

  function getWorkoutMuscles(): string[] {
    if (!workout) return [];
    // First try actual muscle data from exercises
    const muscles = new Set<string>();
    for (const ex of workout.exercises) {
      let pm = ex.exercise.primaryMuscles;
      // primaryMuscles may be a JSON string from SQLite — parse it
      if (typeof pm === 'string') {
        try { pm = JSON.parse(pm); } catch { pm = []; }
      }
      if (Array.isArray(pm)) {
        for (const m of pm) {
          if (typeof m === 'string' && m.length > 1) muscles.add(m);
        }
      }
    }
    if (muscles.size > 0) return [...muscles];

    // Infer split from exercise names when muscle data is empty
    const names = workout.exercises.map(e => e.exercise?.name ?? '');
    let pushScore = 0, pullScore = 0, legScore = 0;
    for (const n of names) {
      if (PUSH_KEYWORDS.test(n)) pushScore++;
      if (PULL_KEYWORDS.test(n)) pullScore++;
      if (LEGS_KEYWORDS.test(n)) legScore++;
    }
    if (legScore > pushScore && legScore > pullScore) return ['quads', 'hamstrings', 'glutes', 'calves'];
    if (pullScore > pushScore && pullScore > legScore) return ['back', 'biceps', 'shoulders'];
    if (pushScore > pullScore && pushScore > legScore) return ['chest', 'shoulders', 'triceps'];
    // Tie or all zero — fall back to legs (most common for generic exercises)
    return ['quads', 'hamstrings', 'glutes', 'calves'];
  }

  const FALLBACK_STRETCHES: StretchData[] = [
    { name: 'Chest Doorway Stretch', duration: 30, muscles: ['chest'], instructions: 'Place forearm on doorframe at 90°, lean forward gently.' },
    { name: 'Cross-Body Shoulder Stretch', duration: 30, muscles: ['shoulders'], instructions: 'Pull one arm across your chest and hold with the other arm.' },
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
  }

  async function loadAllLastPerformance(w: Workout, workoutId: number) {
    await Promise.all(w.exercises.map(async (ex) => {
      try {
        const perf = await api<LastPerformance>(
          `/exercises/${ex.exerciseId}/last-performance?excludeWorkoutId=${workoutId}`
        );
        if (perf.sets.length > 0) {
          ex.lastPerformance = perf;
        }
      } catch { /* no history — that's fine */ }
    }));
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
      ex.expanded = !ex.sets.every(s => s.completed);
      for (const s of ex.sets) {
        s.completed = !!s.completed;
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
        // Fetch last performance for each exercise (runs in parallel, non-blocking)
        loadAllLastPerformance(workout, parseInt(id));
        // Pre-fetch swap candidates for all exercises so inline swap is instant
        prefetchSwapCandidates(workout);
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

  // Persist workout state when app goes to background or is about to close
  function saveWorkoutState() {
    if (workout) {
      cacheWorkout($page.params.id!, workout);
    }
  }

  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  function debouncedSave() {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(saveWorkoutState, 500);
  }

  onMount(() => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', saveWorkoutState);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', saveWorkoutState);
    };
  });

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      saveWorkoutState();
    }
  }

  onDestroy(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveWorkoutState();
  });

  function adjustReps(set: SetData, delta: number) {
    set.reps = Math.max(0, (set.reps ?? 0) + delta);
    debouncedSave();
  }

  function adjustWeightLbs(set: SetData, deltaLbs: number) {
    const currentLbs = kgToLbs(set.weightKg);
    const newLbs = Math.max(0, currentLbs + deltaLbs);
    set.weightKg = lbsToKg(newLbs);
    debouncedSave();
  }

  function updateWeightLbs(set: SetData, lbsStr: string) {
    const lbs = parseFloat(lbsStr) || 0;
    set.weightKg = lbsToKg(lbs);
    debouncedSave();
  }

  async function toggleComplete(set: SetData, ex: WorkoutExercise) {
    set.completed = !set.completed;
    // Cache locally immediately so state survives app exit
    saveWorkoutState();
    // Persist completion state + set data to API
    try {
      await api(`/sets/${set.id}`, {
        method: 'PUT',
        body: JSON.stringify({ reps: set.reps, weightKg: set.weightKg, rpe: set.rpe, distanceMeters: set.distanceMeters, resistance: set.resistance, completed: set.completed }),
      });
    } catch {
      showToast('Failed to save set — will retry on finish', 'error');
    }
    if (set.completed) {
      // PR detection: check if this set's weight exceeds the all-time best (skip warm-up sets)
      if (!set.isWarmup && set.weightKg && set.weightKg > 0 && ex.prWeightKg != null && set.weightKg > ex.prWeightKg) {
        set.isPR = true;
        ex.prWeightKg = set.weightKg;
        prExerciseName = ex.exercise?.name ?? 'Exercise';
        showPRCelebration = true;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([100, 30, 100, 30, 100, 30, 200]);
        }
        setTimeout(() => { showPRCelebration = false; }, 2500);
      }

      // Check if all sets in this exercise are done
      const allExSetsComplete = ex.sets.every(s => s.completed);

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

      // Auto-collapse when all sets complete — delay is longer for strength so user can tap RIR
      if (allExSetsComplete && workout) {
        setTimeout(() => {
          ex.expanded = false;
          // Re-order: move completed exercises below incomplete ones (preserve order within each group)
          const incomplete = workout!.exercises.filter(e => !e.sets.every(s => s.completed));
          const complete = workout!.exercises.filter(e => e.sets.every(s => s.completed));
          workout!.exercises = [...incomplete, ...complete];
          // Scroll to next incomplete exercise
          const nextIncomplete = incomplete[0];
          if (nextIncomplete) {
            setTimeout(() => {
              document.getElementById(`exercise-${nextIncomplete.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
          }
        }, isCardio(ex) ? 600 : 4000);
      }

      // Start rest timer — between sets of same exercise, or between exercises
      const restSec = ex.supersetGroup ? SUPERSET_REST_SECONDS : (ex.restSeconds ?? 60);
      if (restSec > 0) {
        let nextSetLabel = '';
        let shouldStartTimer = false;

        if (!allExSetsComplete) {
          // More sets in this exercise
          shouldStartTimer = true;
          const nextSet = ex.sets.find(s => !s.completed);
          const nextSetIdx = nextSet ? ex.sets.indexOf(nextSet) + 1 : null;
          const exName = ex.exercise?.name ?? 'Exercise';
          nextSetLabel = nextSet && nextSetIdx
            ? `${exName} — Set ${nextSetIdx}: ${nextSet.reps ?? '?'} reps × ${kgToLbs(nextSet.weightKg)} lbs`
            : exName;
        } else if (workout) {
          // Last set of this exercise — timer before next exercise if one exists
          const nextEx = workout.exercises.find(e => e !== ex && !e.sets.every(s => s.completed));
          if (nextEx) {
            shouldStartTimer = true;
            const firstSet = nextEx.sets.find(s => !s.completed) ?? nextEx.sets[0];
            nextSetLabel = firstSet
              ? `${nextEx.exercise?.name ?? 'Next exercise'}: ${firstSet.reps ?? '?'} reps × ${kgToLbs(firstSet.weightKg)} lbs`
              : nextEx.exercise?.name ?? 'Next exercise';
          }
        }

        if (shouldStartTimer) {
          restTimerRef?.startRest(restSec, nextSetLabel);
        }
      }
    }
  }

  async function searchExercises(query: string) {
    if (query.length < 2) { searchResults = []; return; }
    try {
      searchResults = await api<typeof searchResults>(`/exercises/search?q=${encodeURIComponent(query)}`);
    } catch { searchResults = []; }
  }

  function onSearchInput(q: string) {
    searchQuery = q;
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => searchExercises(q), 250);
  }

  function closeSearchSheet() {
    addingExercise = false;
    searchQuery = '';
    searchResults = [];
  }

  async function swapExercise(ex: WorkoutExercise, newExerciseId: number, newExerciseName: string, reason?: string) {
    if (!workout) return;
    try {
      // Fetch last performance for the new exercise to populate weights
      let lastPerf: { sets: { reps: number; weightKg: number }[] } = { sets: [] };
      try {
        lastPerf = await api<typeof lastPerf>(
          `/exercises/${newExerciseId}/last-performance?excludeWorkoutId=${workout.id}`
        );
      } catch { /* no history — keep defaults */ }

      // Create new workout_exercise and copy sets
      const newWe = await api<{ id: number }>(`/workouts/${workout.id}/exercises`, {
        method: 'POST',
        body: JSON.stringify({
          exerciseId: newExerciseId,
          displayOrder: ex.sets.length > 0 ? workout.exercises.indexOf(ex) : 0,
          supersetGroup: ex.supersetGroup,
          swapReason: reason ?? null,
        }),
      });
      // Create sets matching the old exercise's set count, using last-performance weights when available
      const newSets: SetData[] = [];
      for (let i = 0; i < ex.sets.length; i++) {
        const oldSet = ex.sets[i];
        const histSet = lastPerf.sets[i];
        const reps = histSet?.reps ?? oldSet.reps;
        const weightKg = histSet?.weightKg ?? 0;
        const s = await api<SetData>('/sets', {
          method: 'POST',
          body: JSON.stringify({ workoutExerciseId: newWe.id, reps, weightKg }),
        });
        s.completed = false;
        newSets.push(s);
      }
      // Remove old exercise
      await api(`/workout-exercises/${ex.id}`, { method: 'DELETE' });
      // Replace in local state
      const idx = workout.exercises.indexOf(ex);
      workout.exercises[idx] = {
        id: newWe.id,
        exerciseId: newExerciseId,
        exercise: { id: newExerciseId, name: newExerciseName },
        sets: newSets,
        restSeconds: 60,
        expanded: true,
        supersetGroup: ex.supersetGroup,
      };
      workout.exercises = [...workout.exercises]; // trigger reactivity
      closeInlineSwap();
      showToast('Exercise swapped', 'info');
    } catch {
      showToast('Failed to swap exercise', 'error');
    }
  }

  async function addExerciseToWorkout(exerciseId: number, exerciseName: string) {
    if (!workout) return;
    try {
      const newWe = await api<{ id: number }>(`/workouts/${workout.id}/exercises`, {
        method: 'POST',
        body: JSON.stringify({
          exerciseId,
          displayOrder: workout.exercises.length,
        }),
      });
      // Create 3 default sets
      const newSets: SetData[] = [];
      for (let i = 0; i < 3; i++) {
        const s = await api<SetData>('/sets', {
          method: 'POST',
          body: JSON.stringify({ workoutExerciseId: newWe.id, reps: 10, weightKg: 0 }),
        });
        s.completed = false;
        newSets.push(s);
      }
      workout.exercises = [...workout.exercises, {
        id: newWe.id,
        exerciseId,
        exercise: { id: exerciseId, name: exerciseName },
        sets: newSets,
        restSeconds: 60,
        expanded: true,
        supersetGroup: null,
      }];
      closeSearchSheet();
      showToast(`Added ${exerciseName}`, 'info');
    } catch {
      showToast('Failed to add exercise', 'error');
    }
  }

  async function removeExercise(ex: WorkoutExercise) {
    if (!workout) return;
    try {
      await api(`/workout-exercises/${ex.id}`, { method: 'DELETE' });
      workout.exercises = workout.exercises.filter(e => e.id !== ex.id);
      showToast('Exercise removed', 'info');
    } catch {
      showToast('Failed to remove exercise', 'error');
    }
  }

  async function updateRestSeconds(ex: WorkoutExercise, seconds: number) {
    ex.restSeconds = seconds;
    editingRestExercise = null;
    try {
      await api(`/exercises/${ex.exerciseId}`, {
        method: 'PUT',
        body: JSON.stringify({ restSeconds: seconds }),
      });
    } catch {
      showToast('Failed to save rest time', 'error');
    }
  }

  async function addSet(exercise: WorkoutExercise, isWarmup = false) {
    try {
      const lastSet = exercise.sets[exercise.sets.length - 1];
      // Warm-up sets use lighter weight (50% of working weight) and fewer reps
      const workingWeight = lastSet?.weightKg ?? 0;
      const newSet = await api<SetData>('/sets', {
        method: 'POST',
        body: JSON.stringify({
          workoutExerciseId: exercise.id,
          reps: isWarmup ? Math.min(lastSet?.reps ?? 10, 8) : (lastSet?.reps ?? 10),
          weightKg: isWarmup ? Math.round(workingWeight * 0.5 * 100) / 100 : workingWeight,
          isWarmup,
        }),
      });
      newSet.completed = false;
      if (isWarmup) {
        // Insert warm-up sets before working sets
        const firstWorkingIdx = exercise.sets.findIndex(s => !s.isWarmup);
        if (firstWorkingIdx >= 0) {
          exercise.sets = [...exercise.sets.slice(0, firstWorkingIdx), newSet, ...exercise.sets.slice(firstWorkingIdx)];
        } else {
          exercise.sets = [...exercise.sets, newSet];
        }
      } else {
        exercise.sets = [...exercise.sets, newSet];
      }
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
            body: JSON.stringify({ reps: set.reps, weightKg: set.weightKg, rpe: set.rpe, distanceMeters: set.distanceMeters, resistance: set.resistance }),
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

  async function onDoneSummary() {
    if (workout) {
      await api(`/workouts/${workout.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ effortRating }),
      }).catch(() => {});
    }
    goto('/history');
  }
</script>

<div class="px-4 py-4 max-w-lg md:max-w-2xl mx-auto w-full overflow-x-hidden">
  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if showSummary && summaryData && workout}
    <WorkoutSummary
      summary={summaryData}
      workoutDate={workout.date}
      {nutritionData}
      {effortRating}
      onEffortChange={(r) => effortRating = r}
      onDone={onDoneSummary}
    />
  {:else if stretchPhase !== null}
    <StretchPhase
      phase={stretchPhase}
      {stretches}
      onFinish={finishStretchPhase}
      onSkip={finishStretchPhase}
    />
  {:else if workout}
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Workout</h1>
      <span class="text-sm text-neutral-500">{new Date(workout.date + 'T12:00:00').toLocaleDateString()}</span>
    </div>

    {#snippet inlineSwapPanel(ex: WorkoutExercise)}
      {#if swapInlineExercise === ex}
        <div class="border-t border-neutral-700 bg-neutral-900/80">
          {#if swapReason === null}
            <!-- Step 1: reason picker -->
            <div class="px-4 py-3">
              <p class="text-xs text-neutral-400 mb-2 uppercase tracking-wider">Why are you swapping?</p>
              <div class="flex gap-2">
                <button
                  onclick={() => swapReason = 'equipment'}
                  class="flex-1 min-h-[44px] rounded-lg text-sm font-medium text-white bg-neutral-700 active:bg-neutral-600 touch-manipulation"
                >
                  Equipment taken
                </button>
                <button
                  onclick={() => swapReason = 'variation'}
                  class="flex-1 min-h-[44px] rounded-lg text-sm font-medium text-white bg-neutral-700 active:bg-neutral-600 touch-manipulation"
                >
                  Want a variation
                </button>
              </div>
              <button
                onclick={closeInlineSwap}
                class="mt-2 w-full min-h-[36px] text-xs text-neutral-500 touch-manipulation"
              >Cancel</button>
            </div>
          {:else}
            <!-- Step 2: alternative cards -->
            <div class="px-4 py-3">
              <p class="text-xs text-neutral-400 mb-2 uppercase tracking-wider">Choose alternative</p>
              {#if swapCandidates[ex.exerciseId] === 'loading' || swapCandidates[ex.exerciseId] === undefined}
                <div class="text-sm text-neutral-400 py-2 text-center">Loading…</div>
              {:else if (swapCandidates[ex.exerciseId] as GeneratedAlternative[]).length === 0}
                <div class="text-sm text-neutral-400 py-2 text-center">No alternatives found</div>
              {:else}
                <div class="space-y-2">
                  {#each (swapCandidates[ex.exerciseId] as GeneratedAlternative[]) as alt}
                    <button
                      onclick={() => swapExercise(ex, alt.id, alt.name, swapReason!)}
                      class="w-full text-left px-3 py-3 min-h-[56px] rounded-lg bg-neutral-800 active:bg-neutral-700 touch-manipulation"
                    >
                      <div class="font-medium text-sm text-white leading-tight">{alt.name}</div>
                      <div class="text-xs text-neutral-400 mt-0.5">
                        {alt.lastPerformedDaysAgo === 0 ? 'Done recently' : `${alt.lastPerformedDaysAgo}d ago`}
                        {#if alt.suggestedWeightKg > 0}
                          · {Math.round(alt.suggestedWeightKg * 2.20462 / 2.5) * 2.5} lbs
                        {/if}
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
              <button
                onclick={closeInlineSwap}
                class="mt-2 w-full min-h-[36px] text-xs text-neutral-500 touch-manipulation"
              >Cancel</button>
            </div>
          {/if}
        </div>
      {/if}
    {/snippet}

    {#snippet exerciseCard(ex: WorkoutExercise)}
      <ExerciseCard
        {ex}
        isCardio={isCardio(ex)}
        isTreadmill={isTreadmill(ex)}
        restEditing={editingRestExercise === ex}
        historyState={exerciseHistory[ex.exerciseId]}
        {kgToLbs}
        {lbsToKg}
        {adjustReps}
        {adjustWeightLbs}
        {updateWeightLbs}
        onToggleComplete={(set) => toggleComplete(set, ex)}
        onToggleExpanded={() => ex.expanded = !ex.expanded}
        onOpenExerciseDetail={(id) => detailExerciseId = id}
        onEditRest={() => editingRestExercise = editingRestExercise === ex ? null : ex}
        onUpdateRestSeconds={(sec) => updateRestSeconds(ex, sec)}
        onOpenPlateCalc={(set) => { plateCalcWeightLbs = kgToLbs(set.weightKg); plateCalcSet = set; }}
        onToggleHistory={() => toggleHistory(ex.exerciseId)}
        onSwap={() => openInlineSwap(ex)}
        onRemove={() => removeExercise(ex)}
        onAddSet={(isWarmup) => addSet(ex, isWarmup)}
        onDeleteSet={(setId) => deleteSet(ex, setId)}
        onSetRir={(rpe) => { for (const s of ex.sets) s.rpe = rpe; }}
      />
    {/snippet}

    <div class="space-y-4 mb-6">
      {#each exerciseGroups as group}
        {#if group.supersetGroup !== null && group.exercises.length > 1}
          <!-- Superset group with visual bracket -->
          <div class="flex gap-0">
            <div class="w-1.5 shrink-0 rounded-full my-2" style="background-color: #3b82f6;"></div>
            <div class="flex-1 rounded-xl overflow-hidden border border-blue-500/30" style="background-color: #1a1a1a;">
              <div class="px-4 py-1.5 text-xs font-bold text-blue-400 uppercase tracking-wider border-b border-blue-500/20" style="background-color: #1e3a5f20;">
                Superset · 30s rest between
              </div>
              {#each group.exercises as ex, gIdx}
                <div id="exercise-{ex.id}" class="{gIdx > 0 ? 'border-t border-neutral-800' : ''}">
                  {@render exerciseCard(ex)}
                  {@render inlineSwapPanel(ex)}
                </div>
              {/each}
            </div>
          </div>
        {:else}
          {#each group.exercises as ex}
            <div id="exercise-{ex.id}" class="rounded-xl overflow-hidden" style="background-color: #1a1a1a;">
              {@render exerciseCard(ex)}
              {@render inlineSwapPanel(ex)}
            </div>
          {/each}
        {/if}
      {/each}
    </div>

    <!-- Add Exercise button -->
    <button
      onclick={() => { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10); addingExercise = true; searchQuery = ''; searchResults = []; }}
      class="w-full min-h-[48px] py-3.5 rounded-xl text-base font-medium text-neutral-300 bg-neutral-800/70 hover:bg-neutral-800 active:bg-neutral-700 transition-colors mb-4 touch-manipulation"
    >
      + Add Exercise
    </button>

    <button
      onclick={() => { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20); finishWorkout(); }}
      disabled={finishing}
      class="w-full font-semibold text-lg py-4 rounded-xl disabled:opacity-50 mb-24 active:opacity-80 transition-opacity touch-manipulation"
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

<ExerciseSearchSheet
  open={addingExercise}
  title="Add Exercise"
  query={searchQuery}
  results={searchResults}
  suggestions={[]}
  suggestionsLabel=""
  onInput={onSearchInput}
  onSelect={(r) => addExerciseToWorkout(r.id, r.name)}
  onClose={closeSearchSheet}
/>

{#if plateCalcWeightLbs !== null}
  <PlateCalculator
    weightLbs={plateCalcWeightLbs}
    onclose={() => { plateCalcWeightLbs = null; plateCalcSet = null; }}
    onapply={(lbs) => { if (plateCalcSet) { plateCalcSet.weightKg = lbsToKg(lbs); } }}
  />
{/if}

<CelebrationOverlay show={showCelebration} variant="all-done" />
<CelebrationOverlay show={showPRCelebration} variant="pr" {prExerciseName} />

<RestTimer bind:this={restTimerRef} />
