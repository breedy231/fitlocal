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

  import { browser } from '$app/environment';

  let detailExerciseId: number | null = $state(null);

  // Exercise search for swap/add
  let searchQuery = $state('');
  let searchResults: { id: number; name: string; primaryMuscles?: string[]; equipment?: string[] }[] = $state([]);
  let swappingExercise: WorkoutExercise | null = $state(null);
  let addingExercise = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Rest timer editor
  let editingRestExercise: WorkoutExercise | null = $state(null);
  const REST_PRESETS = [30, 45, 60, 90, 120, 180];

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

  // Exercise history (lazy-loaded per exercise)
  interface HistoryPoint { date: string; maxWeight: number; maxReps: number; sessionVolume: number }
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
      const res = await api<{ dataPoints: HistoryPoint[] }>(`/reports/exercise-progression?exerciseId=${exerciseId}`);
      exerciseHistory[exerciseId] = res.dataPoints.slice(-5);
    } catch {
      delete exerciseHistory[exerciseId];
    }
    exerciseHistory = { ...exerciseHistory };
  }

  interface SetData {
    id: number;
    reps: number | null;
    weightKg: number | null;
    isWarmup: boolean;
    rpe?: number | null;
    completed: boolean;
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

  interface ExerciseSummary {
    name: string;
    sets: number;
    avgWeightLbs: number;
    bestSetLbs: number;
    bestReps: number;
    isPR: boolean;
    avgRir: number | null;
  }

  interface WorkoutSummary {
    totalSets: number;
    totalVolumeLbs: number;
    exerciseCount: number;
    durationMin: number;
    prCount: number;
    exercises: ExerciseSummary[];
  }

  let summaryData: WorkoutSummary | null = $state(null);
  let effortRating = $state(5);

  function computeSummary(): WorkoutSummary {
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

  // Rest timer state — uses wall-clock end time so it survives tab switches
  let restTimeLeft = $state(0);
  let restTotalTime = $state(0);
  let restTimerActive = $state(false);
  let restTimerDone = $state(false); // "GO!" flash state after timer hits 0
  let restTimerInterval: ReturnType<typeof setInterval> | null = null;
  let restEndTime = 0; // ms timestamp when rest finishes
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

  // Require specific cardio equipment names — bare "rowing" would match "Barbell Rowing", etc.
  const CARDIO_PATTERN = /\b(treadmill|elliptical|rowing\s+machine|stationary\s+bike|stair\s*climber|air\s+bike|assault\s+bike)\b/i;
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
      ex.expanded = !ex.sets.every(s => s.completed);
      for (const s of ex.sets) {
        s.completed = !!s.completed;
      }
    }
  }

  onMount(async () => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
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

  // When user returns to app, check if rest timer expired while away
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && restTimerActive && restEndTime > 0) {
      const remaining = Math.ceil((restEndTime - Date.now()) / 1000);
      if (remaining <= 0) {
        fireRestCompleteNotification();
        dismissRestTimer();
      }
    }
  }

  onDestroy(() => {
    if (restTimerInterval) clearInterval(restTimerInterval);
    if (stretchTimerInterval) clearInterval(stretchTimerInterval);
    if (browser) document.removeEventListener('visibilitychange', handleVisibilityChange);
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
    // Persist completion state + set data to API
    try {
      await api(`/sets/${set.id}`, {
        method: 'PUT',
        body: JSON.stringify({ reps: set.reps, weightKg: set.weightKg, rpe: set.rpe, completed: set.completed }),
      });
    } catch {
      showToast('Failed to save set — will retry on finish', 'error');
    }
    if (set.completed) {
      // PR detection: check if this set's weight exceeds the all-time best
      if (set.weightKg && set.weightKg > 0 && ex.prWeightKg != null && set.weightKg > ex.prWeightKg) {
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
          startRestTimer(restSec, nextSetLabel);
        }
      }
    }
  }

  function requestNotificationPermission() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function sendSwMessage(msg: Record<string, unknown>) {
    navigator.serviceWorker?.controller?.postMessage(msg);
  }

  let restNextSetLabel = '';
  let restNotificationFired = false;

  function fireRestCompleteNotification() {
    if (restNotificationFired) return;
    restNotificationFired = true;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([300, 100, 300]);
    }
    // Fire notification from main thread as fallback (more reliable on iOS than SW setTimeout)
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('Rest Complete', {
          body: restNextSetLabel || 'Time for your next set',
          tag: 'rest-timer',
        });
      } catch {
        // Notification constructor may fail on some platforms — SW is the backup
      }
    }
  }

  function startRestTimer(seconds: number, nextSetLabel = '') {
    if (restTimerInterval) clearInterval(restTimerInterval);
    restTotalTime = seconds;
    restEndTime = Date.now() + seconds * 1000;
    restTimeLeft = seconds;
    restTimerActive = true;
    hasVibrated10s = false;
    restNotificationFired = false;
    restNextSetLabel = nextSetLabel;
    requestNotificationPermission();

    // Schedule notification via service worker as backup
    sendSwMessage({
      type: 'SCHEDULE_REST_NOTIFICATION',
      delayMs: seconds * 1000,
      title: 'Rest Complete',
      body: nextSetLabel || 'Time for your next set',
    });

    restTimerInterval = setInterval(() => {
      // Compute from wall clock so it stays accurate across tab switches
      const remaining = Math.ceil((restEndTime - Date.now()) / 1000);
      restTimeLeft = Math.max(0, remaining);
      if (restTimeLeft <= 10 && restTimeLeft > 0 && !hasVibrated10s) {
        hasVibrated10s = true;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
      }
      if (restTimeLeft <= 0) {
        fireRestCompleteNotification();
        // Show "GO!" flash for 2s before hiding the bar
        if (restTimerInterval) { clearInterval(restTimerInterval); restTimerInterval = null; }
        sendSwMessage({ type: 'CANCEL_REST_NOTIFICATION' });
        restTimerDone = true;
        setTimeout(() => {
          restTimerDone = false;
          restTimerActive = false;
          restTimeLeft = 0;
        }, 2000);
      }
    }, 250);
  }

  function dismissRestTimer() {
    restTimerActive = false;
    restTimerDone = false;
    restTimeLeft = 0;
    if (restTimerInterval) {
      clearInterval(restTimerInterval);
      restTimerInterval = null;
    }
    // Cancel any pending SW notification (e.g. user tapped Skip)
    sendSwMessage({ type: 'CANCEL_REST_NOTIFICATION' });
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
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

  async function swapExercise(newExerciseId: number, newExerciseName: string) {
    if (!swappingExercise || !workout) return;
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
          displayOrder: swappingExercise.sets.length > 0 ? workout.exercises.indexOf(swappingExercise) : 0,
          supersetGroup: swappingExercise.supersetGroup,
        }),
      });
      // Create sets matching the old exercise's set count, using last-performance weights when available
      const newSets: SetData[] = [];
      for (let i = 0; i < swappingExercise.sets.length; i++) {
        const oldSet = swappingExercise.sets[i];
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
      await api(`/workout-exercises/${swappingExercise.id}`, { method: 'DELETE' });
      // Replace in local state
      const idx = workout.exercises.indexOf(swappingExercise);
      workout.exercises[idx] = {
        id: newWe.id,
        exerciseId: newExerciseId,
        exercise: { id: newExerciseId, name: newExerciseName },
        sets: newSets,
        restSeconds: 60,
        expanded: true,
        supersetGroup: swappingExercise.supersetGroup,
      };
      workout.exercises = [...workout.exercises]; // trigger reactivity
      swappingExercise = null;
      searchQuery = '';
      searchResults = [];
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
      addingExercise = false;
      searchQuery = '';
      searchResults = [];
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
  {@const allExDone = ex.sets.length > 0 && ex.sets.every(s => s.completed)}
  <div
    class="w-full text-left p-4 flex justify-between items-center cursor-pointer {allExDone ? 'opacity-60' : ''}"
  >
    <div class="flex items-center gap-2 min-w-0">
      {#if allExDone}
        <svg class="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
        </svg>
      {/if}
      <span class="font-medium truncate">
        <button
          onclick={(e) => { e.stopPropagation(); detailExerciseId = ex.exerciseId; }}
          class="underline decoration-neutral-600 underline-offset-2 hover:text-green-400 transition-colors"
        >{ex.exercise?.name ?? 'Exercise'}</button>
      </span>
      {#if !isCardio(ex)}
        <button
          onclick={(e) => { e.stopPropagation(); editingRestExercise = editingRestExercise === ex ? null : ex; }}
          class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-800 text-neutral-500 hover:text-neutral-300 shrink-0"
          title="Edit rest time"
        >{(ex.restSeconds ?? 60) >= 60 ? `${Math.round((ex.restSeconds ?? 60) / 60)}m` : `${ex.restSeconds}s`}</button>
      {/if}
    </div>
    <div class="flex items-center gap-1 shrink-0">
      {#if !isCardio(ex)}
        <button
          onclick={(e) => { e.stopPropagation(); const firstSet = ex.sets[0]; if (firstSet) { plateCalcWeightLbs = kgToLbs(firstSet.weightKg); plateCalcSet = firstSet; } }}
          class="p-1.5 rounded-md text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
          title="Plate calculator"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
          </svg>
        </button>
        <button
          onclick={(e) => { e.stopPropagation(); toggleHistory(ex.exerciseId); }}
          class="p-1.5 rounded-md transition-colors {exerciseHistory[ex.exerciseId] ? 'text-green-400 bg-green-500/10' : 'text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800'}"
          title="View history"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
          </svg>
        </button>
      {/if}
      <button
        onclick={(e) => { e.stopPropagation(); swappingExercise = ex; searchQuery = ''; searchResults = []; }}
        class="p-1.5 rounded-md text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
        title="Swap exercise"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
        </svg>
      </button>
      <button
        onclick={(e) => { e.stopPropagation(); if (confirm(`Remove ${ex.exercise?.name}?`)) removeExercise(ex); }}
        class="p-1.5 rounded-md text-neutral-600 hover:text-red-400 hover:bg-neutral-800 transition-colors"
        title="Remove exercise"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
      <button
        onclick={() => ex.expanded = !ex.expanded}
        class="p-1"
      >
        <svg class="w-5 h-5 text-neutral-500 transition-transform {ex.expanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
        </svg>
      </button>
    </div>
  </div>

  <!-- Inline rest time editor -->
  {#if editingRestExercise === ex}
    <div class="px-4 pb-3 flex flex-wrap gap-2">
      {#each REST_PRESETS as sec}
        <button
          onclick={() => updateRestSeconds(ex, sec)}
          class="px-3 py-1.5 rounded-lg text-sm transition-colors {(ex.restSeconds ?? 60) === sec ? 'bg-green-500/20 text-green-400' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}"
        >{sec >= 60 ? `${sec / 60}m` : `${sec}s`}</button>
      {/each}
    </div>
  {/if}

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
                  <input
                    type="number"
                    value={set.reps ?? 0}
                    onchange={(e) => { set.reps = Math.max(0, parseInt(e.currentTarget.value) || 0); }}
                    class="w-9 text-center text-sm font-bold py-1 rounded-lg bg-neutral-800/50 text-white border-none outline-none"
                    inputmode="numeric"
                    min="0"
                  />
                  <button
                    onclick={() => adjustReps(set, 1)}
                    class="w-8 h-8 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-sm active:bg-neutral-700"
                  >+</button>
                </div>
              </div>
              <div>
                <label class="text-xs text-neutral-500 block mb-1">{isTreadmill(ex) ? 'Incline' : 'Resistance'}</label>
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
                <label class="text-xs text-neutral-500 block mb-1">Distance (mi)</label>
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
          <!-- Grid: [set#] [reps] [×] [weight] [✓] — 1fr columns keep checkbox on-card on all iPhones -->
          <div class="grid items-center gap-x-1 py-1.5 {idx > 0 ? 'border-t border-neutral-800/50' : ''}" style="grid-template-columns: 26px 1fr 12px 1fr 44px">
            <!-- Set number + last performance -->
            <div class="text-center">
              <span class="text-xs text-neutral-500">{idx + 1}</span>
              {#if lastSet}
                <div class="text-[9px] text-neutral-600 leading-tight mt-0.5" title="Last session">{kgToLbs(lastSet.weightKg)}×{lastSet.reps}</div>
              {/if}
            </div>

            <!-- Reps: −/input/+ -->
            <div class="flex items-center gap-0.5">
              <button
                onclick={() => adjustReps(set, -1)}
                class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700 shrink-0"
              >−</button>
              <input
                type="number"
                value={set.reps ?? 0}
                onchange={(e) => { set.reps = Math.max(0, parseInt(e.currentTarget.value) || 0); }}
                class="flex-1 min-w-0 text-center text-sm font-bold py-1.5 rounded-lg bg-neutral-800/50 text-white border-none outline-none"
                inputmode="numeric"
                min="0"
              />
              <button
                onclick={() => adjustReps(set, 1)}
                class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700 shrink-0"
              >+</button>
            </div>

            <!-- × separator -->
            <span class="text-neutral-600 text-xs text-center">×</span>

            <!-- Weight: −/input/+ -->
            <div class="flex items-center gap-0.5">
              <button
                onclick={() => adjustWeightLbs(set, -5)}
                class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700 shrink-0"
              >−</button>
              <input
                type="number"
                value={kgToLbs(set.weightKg)}
                onchange={(e) => updateWeightLbs(set, e.currentTarget.value)}
                class="flex-1 min-w-0 text-center text-sm font-bold py-1.5 rounded-lg bg-neutral-800/50 text-white border-none outline-none"
                step="2.5"
                inputmode="decimal"
              />
              <button
                onclick={() => adjustWeightLbs(set, 5)}
                class="w-9 h-9 rounded-lg bg-neutral-800 text-neutral-300 flex items-center justify-center text-lg active:bg-neutral-700 shrink-0"
              >+</button>
            </div>

            <!-- Complete button (PR badge overlaid) -->
            <div class="relative flex items-center justify-center">
              {#if set.isPR}
                <span class="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold px-1 rounded-full bg-amber-500/20 text-amber-400 whitespace-nowrap">PR</span>
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

      <!-- Per-exercise RIR: appears after all sets are complete -->
      {#if !isCardio(ex) && ex.sets.length > 0 && ex.sets.every(s => s.completed)}
        {@const lastSet = ex.sets[ex.sets.length - 1]}
        {@const currentRir = lastSet.rpe != null ? Math.round(10 - lastSet.rpe) : null}
        <div class="flex items-center gap-2 pt-2 mt-1 border-t border-neutral-800/50">
          <span class="text-xs text-neutral-500">How many reps left in the tank?</span>
          <div class="flex gap-1 ml-auto">
            {#each [3, 2, 1, 0] as rir}
              <button
                onclick={() => {
                  const rpe = 10 - rir;
                  for (const s of ex.sets) s.rpe = rpe;
                }}
                class="w-8 h-8 rounded-lg text-xs font-bold transition-colors
                  {currentRir === rir
                    ? (rir <= 0 ? 'bg-red-500/20 text-red-400' : rir <= 2 ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400')
                    : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'}"
              >{rir}</button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Exercise history panel -->
      {#if exerciseHistory[ex.exerciseId]}
        <div class="mt-2 pt-2 border-t border-neutral-800/50">
          {#if exerciseHistory[ex.exerciseId] === 'loading'}
            <div class="flex justify-center py-2">
              <div class="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          {:else}
            {@const history = exerciseHistory[ex.exerciseId] as HistoryPoint[]}
            {#if history.length === 0}
              <p class="text-xs text-neutral-500 text-center py-1">No history yet</p>
            {:else}
              <div class="space-y-1">
                {#each history as h}
                  <div class="flex justify-between items-center text-xs px-1">
                    <span class="text-neutral-500">{new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span class="text-neutral-300 font-medium">{kgToLbs(h.maxWeight)} lbs x {h.maxReps}</span>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
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

<div class="px-4 py-4 max-w-lg md:max-w-2xl mx-auto w-full overflow-x-hidden">
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

      <!-- PR callout -->
      {#if summaryData.prCount > 0}
        <div class="rounded-xl p-4 mb-4 border border-amber-500/30" style="background-color: #1a1a1a;">
          <div class="flex items-center gap-2 text-amber-400 font-bold">
            <span class="text-lg">NEW PR{summaryData.prCount > 1 ? 's' : ''}</span>
          </div>
          <div class="mt-2 space-y-1">
            {#each summaryData.exercises.filter(e => e.isPR) as ex}
              <div class="text-sm text-amber-300/80">{ex.name} — {ex.bestSetLbs} lbs x {ex.bestReps}</div>
            {/each}
          </div>
        </div>
      {/if}

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
            <div class="flex justify-between items-center text-sm gap-2">
              <div class="flex items-center gap-1.5 min-w-0">
                {#if ex.isPR}
                  <span class="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 shrink-0">PR</span>
                {/if}
                <span class="text-neutral-200 truncate">{ex.name}</span>
              </div>
              <div class="text-neutral-500 shrink-0 text-right">
                <span>{ex.sets}s @ {ex.bestSetLbs} lbs</span>
                {#if ex.avgRir != null}
                  <span class="text-neutral-600 ml-1">· {ex.avgRir} RIR</span>
                {/if}
              </div>
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
            <p class="mb-3 {idx === activeStretchIndex ? 'text-base text-neutral-200' : 'text-sm text-neutral-400'}">{stretch.instructions}</p>
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

    <!-- Add Exercise button -->
    <button
      onclick={() => { addingExercise = true; searchQuery = ''; searchResults = []; }}
      class="w-full py-3 rounded-xl text-sm font-medium text-neutral-400 bg-neutral-800/50 hover:bg-neutral-800 transition-colors mb-4"
    >
      + Add Exercise
    </button>

    <button
      onclick={finishWorkout}
      disabled={finishing}
      class="w-full font-semibold text-lg py-4 rounded-xl disabled:opacity-50 mb-24"
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

<!-- Exercise Search Modal (swap or add) -->
{#if swappingExercise || addingExercise}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-end justify-center"
    style="background-color: rgba(0,0,0,0.7); backdrop-filter: blur(4px);"
    onclick={(e) => { if (e.target === e.currentTarget) { swappingExercise = null; addingExercise = false; searchQuery = ''; searchResults = []; } }}
  >
    <div class="w-full max-w-lg rounded-t-2xl max-h-[80vh] flex flex-col" style="background-color: #242424;">
      <!-- Handle bar -->
      <div class="flex justify-center pt-3 pb-1">
        <div class="w-10 h-1 rounded-full bg-neutral-600"></div>
      </div>
      <div class="flex justify-between items-center px-5 pb-3">
        <h2 class="text-lg font-bold text-white">{swappingExercise ? `Replace ${swappingExercise.exercise?.name}` : 'Add Exercise'}</h2>
        <button onclick={() => { swappingExercise = null; addingExercise = false; searchQuery = ''; searchResults = []; }} class="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-white">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
      <div class="px-5 pb-3">
        <input
          type="text"
          placeholder="Search exercises..."
          value={searchQuery}
          oninput={(e) => onSearchInput(e.currentTarget.value)}
          class="w-full px-4 py-3.5 rounded-xl text-base text-white placeholder-neutral-500 border border-neutral-700 outline-none focus:border-green-500/50 transition-colors"
          style="background-color: #1a1a1a;"
          autofocus
        />
      </div>
      <div class="flex-1 overflow-y-auto px-5 pb-6" style="-webkit-overflow-scrolling: touch;">
        {#if searchResults.length > 0}
          <div class="space-y-0.5">
            {#each searchResults as result}
              <button
                onclick={() => swappingExercise ? swapExercise(result.id, result.name) : addExerciseToWorkout(result.id, result.name)}
                class="w-full text-left px-4 py-3.5 rounded-xl hover:bg-neutral-700/50 active:bg-neutral-700 transition-colors"
              >
                <div class="font-medium text-[15px] text-white">{result.name}</div>
                {#if result.primaryMuscles && Array.isArray(result.primaryMuscles) && result.primaryMuscles.length > 0}
                  <div class="text-xs text-neutral-400 mt-0.5">{result.primaryMuscles.join(', ')}</div>
                {:else if result.equipment && Array.isArray(result.equipment) && result.equipment.length > 0}
                  <div class="text-xs text-neutral-500 mt-0.5">{result.equipment.join(', ')}</div>
                {/if}
              </button>
            {/each}
          </div>
        {:else if searchQuery.length >= 2}
          <p class="text-neutral-500 text-sm text-center py-8">No exercises found</p>
        {:else}
          <p class="text-neutral-600 text-sm text-center py-8">Type to search exercises</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

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
{#if restTimerActive || restTimerDone}
  <div class="fixed bottom-20 left-0 right-0 z-40 flex justify-center pointer-events-none px-4">
    <div
      class="w-full max-w-lg rounded-xl px-4 py-3 pointer-events-auto shadow-lg transition-colors"
      style="background-color: #1a1a1a; border: 1px solid {restTimerDone ? '#22c55e' : '#333'};"
    >
      {#if restTimerDone}
        <!-- "GO!" flash — shown for 2s after timer hits 0 -->
        <div class="flex items-center justify-between">
          <span class="text-2xl font-bold text-green-400 animate-pulse">GO! 🔔</span>
          <button
            onclick={dismissRestTimer}
            class="text-xs font-medium text-neutral-400 hover:text-white transition-colors shrink-0 px-2 py-1 rounded-md hover:bg-neutral-800"
          >Dismiss</button>
        </div>
      {:else}
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
      {/if}
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
