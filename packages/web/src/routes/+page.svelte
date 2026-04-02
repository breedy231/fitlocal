<script lang="ts">
  import { cachedGet } from '$lib/api-cache.svelte';
  import TrainingRings from '$lib/TrainingRings.svelte';
  import ChallengeCard from '$lib/ChallengeCard.svelte';
  import NutritionCard from '$lib/NutritionCard.svelte';
  import Expandable from '$lib/Expandable.svelte';
  import BarChart from '$lib/BarChart.svelte';

  interface MuscleRecovery {
    name: string;
    recoveryPct: number;
  }

  interface Workout {
    id: number;
    date: string;
    locationProfile?: string;
    notes?: string;
    exercises?: any[];
  }

  interface ActiveProgram {
    program: { id: number; name: string };
    dayIndex: number;
    totalDays: number;
    day: { name: string; musclesFocus: string | null };
  }

  interface TrainingLoad {
    label: 'well_below' | 'below' | 'steady' | 'above' | 'well_above';
    ratio: number;
    currentLoad: number;
    baselineLoad: number;
  }

  const recovery = cachedGet<{ muscles: MuscleRecovery[] }>('/recovery-summary');
  const workoutCache = cachedGet<Workout[]>('/workouts?limit=5');
  const programCache = cachedGet<ActiveProgram>('/programs/active');
  const trainingLoadCache = cachedGet<TrainingLoad>('/training-load');

  interface WeeklyGoals {
    volume: { current: number; target: number };
    consistency: { current: number; target: number };
    recovery: { current: number; target: number };
  }

  const weeklyGoalsCache = cachedGet<WeeklyGoals>('/weekly-goals');
  const deloadCache = cachedGet<{ suggest: boolean; consecutiveWeeks: number; message: string | null }>('/deload-check');
  let deloadSuggestion = $derived(deloadCache.data);
  let deloadDismissed = $state(false);

  interface NutritionData {
    date: string;
    calories: { current: number | null; target: number | null };
    protein: { current: number | null; target: number | null };
    isInCut: boolean;
    deficitMagnitude: number | null;
    deficitPct: number | null;
  }
  const nutritionCache = cachedGet<NutritionData>('/goals/daily-nutrition');
  let nutritionData = $derived(nutritionCache.data);

  interface Challenge {
    id: number;
    month: string;
    type: string;
    description: string;
    targetValue: number;
    currentValue: number;
    unit: string;
    completed: boolean;
    completedAt: string | null;
  }

  const challengeCache = cachedGet<{ challenge: Challenge | null }>('/challenges/current');
  let challenge = $derived(challengeCache.data?.challenge);
  let ringsExpanded = $state(false);
  let loadExpanded = $state(false);

  let trainingLoad = $derived(trainingLoadCache.data);
  let weeklyGoals = $derived(weeklyGoalsCache.data);
  let weeklyRings = $derived.by(() => {
    if (!weeklyGoals) return null;
    return [
      { label: 'Sets', current: weeklyGoals.volume.current, target: weeklyGoals.volume.target, color: '#22c55e' },
      { label: 'Days', current: weeklyGoals.consistency.current, target: weeklyGoals.consistency.target, color: '#3b82f6' },
      { label: 'Recovery', current: weeklyGoals.recovery.current, target: weeklyGoals.recovery.target, color: '#f59e0b', unit: '%' },
    ];
  });

  let muscles = $derived(recovery.data?.muscles ?? []);
  let workouts = $derived(
    (Array.isArray(workoutCache.data) ? workoutCache.data : []).slice(-5).reverse()
  );
  let activeProgram = $derived(programCache.data);
  let loading = $derived(recovery.loading && workoutCache.loading && programCache.loading);

  function recoveryColor(pct: number): string {
    if (pct > 75) return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (pct > 40) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-red-500/20 text-red-400 border-red-500/30';
  }

  function formatDate(dateStr: string): string {
    // Append T12:00 to avoid UTC midnight → previous day in CDT
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
</script>

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  <h1 class="text-3xl font-bold mb-6">FitLocal</h1>

  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else}
    <!-- Weekly Training Rings (Layer 1: rings, Layer 2: tap to see daily detail) -->
    {#if weeklyRings}
      <section class="mb-6">
        <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">This Week</h2>
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="rounded-xl p-4 cursor-pointer" style="background-color: #1a1a1a;" onclick={() => ringsExpanded = !ringsExpanded}>
          <TrainingRings rings={weeklyRings} />
          <Expandable expanded={ringsExpanded}>
            <div class="mt-3 pt-3 border-t border-neutral-800">
              <p class="text-[10px] text-neutral-600 mb-1">Volume: {weeklyRings[0].current} / {weeklyRings[0].target} sets &middot; Consistency: {weeklyRings[1].current} / {weeklyRings[1].target} days &middot; Recovery: {weeklyRings[2].current}%</p>
              <a href="/reports" class="text-xs text-green-400 mt-1 inline-block">See detailed reports &rarr;</a>
            </div>
          </Expandable>
        </div>
      </section>
    {/if}

    <!-- Daily Nutrition (during cut or when goals are configured) -->
    {#if nutritionData && (nutritionData.isInCut || (nutritionData.calories.target != null))}
      <section class="mb-6">
        <NutritionCard data={nutritionData} />
      </section>
    {/if}

    <!-- Monthly Challenge -->
    {#if challenge}
      <section class="mb-6">
        <ChallengeCard {challenge} />
      </section>
    {/if}

    <!-- Recovery Section -->
    {#if muscles.length > 0}
      <section class="mb-6">
        <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Muscle Recovery</h2>
        <div class="flex flex-wrap gap-2">
          {#each muscles as muscle}
            <span class="px-3 py-1.5 rounded-full text-sm font-medium border {recoveryColor(muscle.recoveryPct)}">
              {muscle.name} {Math.round(muscle.recoveryPct)}%
            </span>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Training Load (Layer 1: bar, Layer 2: tap for detail) -->
    {#if trainingLoad}
      {@const labels = ['well_below', 'below', 'steady', 'above', 'well_above'] as const}
      {@const displayLabels = ['Well Below', 'Below', 'Steady', 'Above', 'Well Above']}
      {@const colors = ['#3b82f6', '#60a5fa', '#22c55e', '#f59e0b', '#ef4444']}
      {@const activeIdx = labels.indexOf(trainingLoad.label)}
      <section class="mb-6">
        <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Training Load</h2>
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="rounded-xl p-4 cursor-pointer" style="background-color: #1a1a1a;" onclick={() => loadExpanded = !loadExpanded}>
          <div class="flex gap-1 mb-2">
            {#each labels as label, idx}
              <div class="flex-1 h-2 rounded-full {idx === activeIdx ? '' : 'opacity-30'}" style="background-color: {colors[idx]};"></div>
            {/each}
          </div>
          <div class="flex justify-between text-[10px] text-neutral-600">
            {#each displayLabels as label, idx}
              <span class="{idx === activeIdx ? 'text-neutral-200 font-bold' : ''}">{label}</span>
            {/each}
          </div>
          <Expandable expanded={loadExpanded}>
            <div class="mt-2 pt-2 border-t border-neutral-800">
              <p class="text-xs text-neutral-500">Ratio: {trainingLoad.ratio.toFixed(2)}x baseline</p>
              <a href="/reports" class="text-xs text-green-400 mt-1 inline-block">See full trends &rarr;</a>
            </div>
          </Expandable>
        </div>
      </section>
    {/if}

    <!-- Deload Suggestion -->
    {#if deloadSuggestion?.suggest && !deloadDismissed}
      <section class="mb-6">
        <div class="rounded-xl p-4 border border-amber-500/30" style="background-color: #78350f10;">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2 mb-1">
              <svg class="w-5 h-5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
              </svg>
              <span class="text-sm font-medium text-amber-400">Deload Suggested</span>
            </div>
            <button onclick={() => deloadDismissed = true} class="text-neutral-600 hover:text-neutral-400 p-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <p class="text-xs text-neutral-400">{deloadSuggestion.message}</p>
        </div>
      </section>
    {/if}

    <!-- Active Program -->
    {#if activeProgram}
      <a href="/generate" class="block rounded-xl p-4 mb-4 border border-green-500/30" style="background-color: #22c55e08;">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-green-400 uppercase tracking-wider">{activeProgram.program.name}</span>
            <p class="font-medium mt-1">{activeProgram.day.name}</p>
            {#if activeProgram.day.musclesFocus}
              <p class="text-sm text-neutral-400 mt-0.5">{activeProgram.day.musclesFocus}</p>
            {/if}
          </div>
          <div class="text-right">
            <p class="text-xs text-neutral-600">Day {activeProgram.dayIndex + 1} of {activeProgram.totalDays}</p>
            <span class="text-sm text-green-400 font-medium">Start &rarr;</span>
          </div>
        </div>
      </a>
    {/if}

    <!-- Generate Button -->
    <a
      href="/generate"
      class="block w-full text-center font-semibold text-lg py-4 rounded-xl mb-6"
      style="background-color: #22c55e; color: #0f0f0f;"
    >
      {activeProgram ? 'Generate Freestyle Workout' : 'Generate Workout'}
    </a>

    <!-- Achievements link -->
    <a
      href="/achievements"
      class="block rounded-xl p-3 mb-6 flex items-center justify-between"
      style="background-color: #1a1a1a;"
    >
      <span class="text-sm text-neutral-400">Achievements</span>
      <svg class="w-4 h-4 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
      </svg>
    </a>

    <!-- Recent Workouts -->
    <section>
      <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Recent Workouts</h2>
      {#if workouts.length === 0}
        <div class="rounded-xl p-6 text-center" style="background-color: #1a1a1a;">
          <p class="text-neutral-500">No workouts yet. Import your data or generate one!</p>
        </div>
      {:else}
        <div class="space-y-2">
          {#each workouts as workout}
            <a href="/history/{workout.id}/edit" class="rounded-xl p-4 flex justify-between items-center active:opacity-70 transition-opacity" style="background-color: #1a1a1a; display: flex;">
              <div>
                <span class="font-medium">{formatDate(workout.date)}</span>
                {#if workout.notes}
                  <p class="text-sm text-neutral-500 mt-0.5">{workout.notes}</p>
                {/if}
              </div>
              <div class="flex items-center gap-2">
                {#if workout.locationProfile}
                  <span class="text-xs px-2 py-1 rounded bg-neutral-800 text-neutral-400">{workout.locationProfile}</span>
                {/if}
                <svg class="w-4 h-4 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                </svg>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>
