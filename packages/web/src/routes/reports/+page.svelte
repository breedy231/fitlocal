<script lang="ts">
  import { api } from '$lib/api';
  import { onMount } from 'svelte';
  import BarChart from '$lib/BarChart.svelte';
  import LineChart from '$lib/LineChart.svelte';

  interface Summary {
    totalWorkouts: number;
    totalWorkingSets: number;
    totalVolumeKg: number;
    currentStreak: number;
    workoutsThisWeek: number;
    workoutsThisMonth: number;
  }

  interface FrequencyWeek { week: string; weekStart: string; count: number }
  interface VolumeWorkout { id: number; date: string; notes: string | null; totalVolume: number; exerciseCount: number; setCount: number }
  interface MuscleData { name: string; sets: number }
  interface PR { exerciseName: string; maxWeightKg: number; repsAtMax: number; dateAchieved: string }
  interface ExerciseOption { id: number; name: string; workoutCount: number }
  interface ExerciseDataPoint { date: string; maxWeight: number; maxReps: number; sessionVolume: number }
  interface HealthSnapshot {
    date: string;
    restingHr: number | null;
    hrv: number | null;
    sleepHours: number | null;
    calories: number | null;
    proteinG: number | null;
    steps: number | null;
    bodyWeightKg: number | null;
  }

  let loading = $state(true);
  let summary: Summary = $state({ totalWorkouts: 0, totalWorkingSets: 0, totalVolumeKg: 0, currentStreak: 0, workoutsThisWeek: 0, workoutsThisMonth: 0 });
  let frequency: FrequencyWeek[] = $state([]);
  let volume: VolumeWorkout[] = $state([]);
  let muscles: MuscleData[] = $state([]);
  let records: PR[] = $state([]);
  let exerciseOptions: ExerciseOption[] = $state([]);
  let selectedExerciseId: number | null = $state(null);
  let exerciseProgression: ExerciseDataPoint[] = $state([]);
  let exerciseProgressionName: string = $state('');
  let healthSnapshots: HealthSnapshot[] = $state([]);
  let activeTab: 'training' | 'health' = $state('training');
  let healthRange: '30' | '90' | '365' | 'all' = $state('90');

  // Filter + downsample health data based on selected range
  let filteredHealth = $derived.by(() => {
    let data = healthSnapshots;

    // Filter by date range
    if (healthRange !== 'all') {
      const days = parseInt(healthRange);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      data = data.filter(s => s.date >= cutoffStr);
    }

    // Downsample: >200 points → weekly averages
    if (data.length > 200) {
      return downsampleWeekly(data);
    }
    return data;
  });

  function downsampleWeekly(data: HealthSnapshot[]): HealthSnapshot[] {
    const weeks = new Map<string, HealthSnapshot[]>();
    for (const s of data) {
      // Group by ISO week start (Monday)
      const d = new Date(s.date + 'T12:00:00');
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(d.setDate(diff)).toISOString().slice(0, 10);
      if (!weeks.has(weekStart)) weeks.set(weekStart, []);
      weeks.get(weekStart)!.push(s);
    }

    const result: HealthSnapshot[] = [];
    for (const [weekDate, entries] of weeks) {
      result.push({
        date: weekDate,
        hrv: avg(entries.map(e => e.hrv)),
        restingHr: avg(entries.map(e => e.restingHr)),
        sleepHours: avg(entries.map(e => e.sleepHours), 1),
        steps: avg(entries.map(e => e.steps)),
        bodyWeightKg: avg(entries.map(e => e.bodyWeightKg), 1),
        calories: avg(entries.map(e => e.calories)),
        proteinG: avg(entries.map(e => e.proteinG), 1),
      });
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }

  function avg(values: (number | null)[], decimals = 0): number | null {
    const valid = values.filter((v): v is number => v != null && v > 0);
    if (valid.length === 0) return null;
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const factor = Math.pow(10, decimals);
    return Math.round(mean * factor) / factor;
  }

  function kgToLbs(kg: number): number {
    return Math.round(kg * 2.20462);
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function shortDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  }

  // Read excluded exercise IDs from localStorage
  let excludeParam = '';
  if (typeof localStorage !== 'undefined') {
    try {
      const ids: number[] = JSON.parse(localStorage.getItem('fitlocal-report-exclusions') || '[]');
      if (ids.length > 0) {
        excludeParam = `excludeExerciseIds=${ids.join(',')}`;
      }
    } catch { /* ignore */ }
  }

  function withExclusions(url: string): string {
    if (!excludeParam) return url;
    return url + (url.includes('?') ? '&' : '?') + excludeParam;
  }

  async function loadExerciseProgression(exerciseId: number) {
    selectedExerciseId = exerciseId;
    try {
      const result = await api<{ exerciseName: string; dataPoints: ExerciseDataPoint[] }>(
        withExclusions(`/reports/exercise-progression?exerciseId=${exerciseId}`)
      );
      exerciseProgression = result.dataPoints;
      exerciseProgressionName = result.exerciseName || '';
    } catch {
      exerciseProgression = [];
    }
  }

  onMount(async () => {
    try {
      const [summaryData, freqData, volData, muscleData, prData, exData, healthData] = await Promise.all([
        api<Summary>(withExclusions('/reports/summary')).catch(() => summary),
        api<{ weeks: FrequencyWeek[] }>(withExclusions('/reports/frequency')).catch(() => ({ weeks: [] })),
        api<{ workouts: VolumeWorkout[] }>(withExclusions('/reports/volume')).catch(() => ({ workouts: [] })),
        api<{ muscles: MuscleData[] }>(withExclusions('/reports/muscle-distribution')).catch(() => ({ muscles: [] })),
        api<{ records: PR[] }>(withExclusions('/reports/personal-records')).catch(() => ({ records: [] })),
        api<{ exercises: ExerciseOption[] }>(withExclusions('/reports/exercises-with-history')).catch(() => ({ exercises: [] })),
        api<{ snapshots: HealthSnapshot[] }>('/reports/health-trends').catch(() => ({ snapshots: [] })),
      ]);

      summary = summaryData;
      frequency = freqData.weeks;
      volume = volData.workouts;
      muscles = muscleData.muscles;
      records = prData.records;
      exerciseOptions = exData.exercises;
      healthSnapshots = healthData.snapshots;

      if (exerciseOptions.length > 0) {
        await loadExerciseProgression(exerciseOptions[0].id);
      }
    } catch {
      // API not running
    } finally {
      loading = false;
    }
  });
</script>

<div class="p-4 max-w-lg md:max-w-5xl mx-auto">
  <h1 class="text-2xl font-bold mb-4">Reports</h1>

  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else}
    <!-- Tab Switcher -->
    <div class="flex gap-2 mb-5">
      <button
        onclick={() => activeTab = 'training'}
        class="flex-1 py-2 rounded-lg text-sm font-medium transition-colors border-2 {activeTab === 'training' ? 'bg-green-500/20 text-green-400 border-green-500' : 'bg-neutral-800 text-neutral-400 border-transparent hover:border-neutral-700'}"
      >
        Training
      </button>
      <button
        onclick={() => activeTab = 'health'}
        class="flex-1 py-2 rounded-lg text-sm font-medium transition-colors border-2 {activeTab === 'health' ? 'bg-blue-500/20 text-blue-400 border-blue-500' : 'bg-neutral-800 text-neutral-400 border-transparent hover:border-neutral-700'}"
      >
        Health
      </button>
    </div>

    {#if activeTab === 'training'}
      <!-- Summary Cards -->
      <div class="grid grid-cols-3 gap-2 mb-5">
        <div class="rounded-xl p-3 text-center" style="background-color: #1a1a1a;">
          <div class="text-2xl font-bold text-green-400">{summary.currentStreak}</div>
          <div class="text-xs text-neutral-500 mt-1">Streak</div>
        </div>
        <div class="rounded-xl p-3 text-center" style="background-color: #1a1a1a;">
          <div class="text-2xl font-bold text-green-400">{summary.workoutsThisWeek}</div>
          <div class="text-xs text-neutral-500 mt-1">This Week</div>
        </div>
        <div class="rounded-xl p-3 text-center" style="background-color: #1a1a1a;">
          <div class="text-2xl font-bold text-green-400">{summary.workoutsThisMonth}</div>
          <div class="text-xs text-neutral-500 mt-1">This Month</div>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 mb-5">
        <div class="rounded-xl p-3 text-center" style="background-color: #1a1a1a;">
          <div class="text-lg font-bold">{summary.totalWorkouts}</div>
          <div class="text-xs text-neutral-500 mt-1">Total Workouts</div>
        </div>
        <div class="rounded-xl p-3 text-center" style="background-color: #1a1a1a;">
          <div class="text-lg font-bold">{summary.totalWorkingSets.toLocaleString()}</div>
          <div class="text-xs text-neutral-500 mt-1">Working Sets</div>
        </div>
        <div class="rounded-xl p-3 text-center" style="background-color: #1a1a1a;">
          <div class="text-lg font-bold">{(summary.totalVolumeKg > 1000 ? (kgToLbs(summary.totalVolumeKg) / 1000).toFixed(0) + 'k' : kgToLbs(summary.totalVolumeKg).toLocaleString())}</div>
          <div class="text-xs text-neutral-500 mt-1">Total lbs</div>
        </div>
      </div>

      <!-- Frequency + Volume: side by side on desktop -->
      <div class="md:grid md:grid-cols-2 md:gap-5">
        <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
          <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Weekly Frequency</h2>
          <BarChart
            data={frequency.map((w) => ({
              label: shortDate(w.weekStart),
              value: w.count,
            }))}
            height={120}
          />
        </section>

        <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
          <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Volume per Workout (lbs)</h2>
          <LineChart
            data={volume.map((w) => ({
              label: shortDate(w.date),
              value: kgToLbs(w.totalVolume),
            }))}
            height={140}
            showDots={volume.length <= 20}
          />
        </section>
      </div>

      <!-- Muscle Distribution + PRs: side by side on desktop -->
      <div class="md:grid md:grid-cols-2 md:gap-5 md:mt-5">
        <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
          <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Muscle Distribution (30d)</h2>
          {#if muscles.length > 0}
            {@const maxSets = Math.max(...muscles.map((m) => m.sets))}
            <div class="space-y-2">
              {#each muscles as muscle}
                <div class="flex items-center gap-3">
                  <span class="text-xs text-neutral-400 w-24 text-right capitalize">{muscle.name}</span>
                  <div class="flex-1 h-5 rounded-full overflow-hidden" style="background-color: #262626;">
                    <div
                      class="h-full rounded-full"
                      style="width: {(muscle.sets / maxSets) * 100}%; background-color: #22c55e; opacity: {0.5 + (muscle.sets / maxSets) * 0.5};"
                    ></div>
                  </div>
                  <span class="text-xs text-neutral-500 w-8">{Math.round(muscle.sets)}</span>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-neutral-500 text-sm text-center py-4">No data yet</p>
          {/if}
        </section>

        <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
          <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Personal Records</h2>
          {#if records.length > 0}
            <div class="space-y-2">
              {#each records.slice(0, 10) as pr}
                <div class="flex justify-between items-center py-1.5 border-b border-neutral-800 last:border-0">
                  <span class="text-sm text-neutral-200 flex-1">{pr.exerciseName}</span>
                  <span class="text-sm font-semibold text-green-400 ml-2">{kgToLbs(pr.maxWeightKg)} lbs</span>
                  <span class="text-xs text-neutral-500 ml-2 w-16 text-right">{formatDate(pr.dateAchieved)}</span>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-neutral-500 text-sm text-center py-4">No records yet</p>
          {/if}
        </section>
      </div>

      <!-- Exercise Progression: full width -->
      <section class="mt-5 mb-5 rounded-xl p-4" style="background-color: #1a1a1a;">
        <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Exercise Progression</h2>
        {#if exerciseOptions.length > 0}
          <select
            class="w-full bg-neutral-800 text-neutral-200 rounded-lg px-3 py-2 mb-3 text-sm border border-neutral-700"
            onchange={(e) => {
              const target = e.target as HTMLSelectElement;
              loadExerciseProgression(parseInt(target.value));
            }}
          >
            {#each exerciseOptions as ex}
              <option value={ex.id} selected={ex.id === selectedExerciseId}>{ex.name} ({ex.workoutCount})</option>
            {/each}
          </select>

          {#if exerciseProgression.length > 0}
            <p class="text-xs text-neutral-500 mb-2">Max weight per session</p>
            <LineChart
              data={exerciseProgression.map((d) => ({
                label: shortDate(d.date),
                value: kgToLbs(d.maxWeight),
              }))}
              color="#3b82f6"
              height={140}
              unit="lb"
            />
          {:else}
            <p class="text-neutral-500 text-sm text-center py-4">No progression data</p>
          {/if}
        {:else}
          <p class="text-neutral-500 text-sm text-center py-4">Need 2+ sessions of an exercise to show progression</p>
        {/if}
      </section>

    {:else}
      <!-- Health Tab -->

      <!-- Time Range Picker -->
      <div class="flex rounded-xl overflow-hidden mb-5" style="background-color: #1a1a1a;">
        {#each [['30', '30d'], ['90', '90d'], ['365', '1y'], ['all', 'All']] as [value, label]}
          <button
            onclick={() => healthRange = value as any}
            class="flex-1 py-2.5 text-sm font-medium text-center transition-colors {healthRange === value ? 'bg-green-500/20 text-green-400' : 'text-neutral-400 hover:text-neutral-200'}"
          >{label}</button>
        {/each}
      </div>

      {#if filteredHealth.length > 200}
        <p class="text-xs text-neutral-600 mb-3 text-center">Showing weekly averages ({filteredHealth.length} weeks)</p>
      {/if}

      <div class="md:grid md:grid-cols-2 md:gap-5">
        {#if filteredHealth.some((s) => s.bodyWeightKg != null)}
          <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
            <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Body Weight (lbs)</h2>
            <LineChart
              data={filteredHealth
                .filter((s) => s.bodyWeightKg != null)
                .map((s) => ({ label: shortDate(s.date), value: kgToLbs(s.bodyWeightKg!) }))}
              color="#f59e0b"
              height={140}
              unit="lb"
            />
          </section>
        {/if}

        {#if filteredHealth.some((s) => s.steps != null)}
          <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
            <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Daily Steps</h2>
            <BarChart
              data={filteredHealth
                .filter((s) => s.steps != null)
                .map((s) => ({ label: shortDate(s.date), value: s.steps! }))}
              color="#3b82f6"
              height={120}
            />
          </section>
        {/if}

        {#if filteredHealth.some((s) => s.hrv != null)}
          <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
            <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">HRV</h2>
            <LineChart
              data={filteredHealth
                .filter((s) => s.hrv != null)
                .map((s) => ({ label: shortDate(s.date), value: s.hrv }))}
              color="#22c55e"
              height={140}
              unit="ms"
            />
          </section>
        {/if}

        {#if filteredHealth.some((s) => s.restingHr != null)}
          <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
            <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Resting Heart Rate</h2>
            <LineChart
              data={filteredHealth
                .filter((s) => s.restingHr != null)
                .map((s) => ({ label: shortDate(s.date), value: s.restingHr }))}
              color="#ef4444"
              height={140}
              unit="bpm"
            />
          </section>
        {/if}

        {#if filteredHealth.some((s) => s.sleepHours != null)}
          <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
            <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Sleep (hours)</h2>
            <BarChart
              data={filteredHealth
                .filter((s) => s.sleepHours != null)
                .map((s) => ({ label: shortDate(s.date), value: s.sleepHours! }))}
              color="#8b5cf6"
              height={120}
              unit="h"
            />
          </section>
        {/if}

        {#if filteredHealth.some((s) => s.calories != null)}
          <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
            <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Calories & Protein</h2>
            <div class="mb-3">
              <p class="text-xs text-neutral-500 mb-1">Calories</p>
              <LineChart
                data={filteredHealth
                  .filter((s) => s.calories != null)
                  .map((s) => ({ label: shortDate(s.date), value: s.calories }))}
                color="#f97316"
                height={100}
                unit="cal"
              />
            </div>
            {#if filteredHealth.some((s) => s.proteinG != null)}
              <div>
                <p class="text-xs text-neutral-500 mb-1">Protein</p>
                <LineChart
                  data={filteredHealth
                    .filter((s) => s.proteinG != null)
                    .map((s) => ({ label: shortDate(s.date), value: s.proteinG }))}
                  color="#06b6d4"
                  height={100}
                  unit="g"
                />
              </div>
            {/if}
          </section>
        {/if}
      </div>

      {#if !healthSnapshots.some((s) => s.bodyWeightKg != null || s.steps != null || s.hrv != null || s.restingHr != null || s.sleepHours != null)}
        <div class="rounded-xl p-6 text-center" style="background-color: #1a1a1a;">
          <p class="text-neutral-400 mb-2">No health data yet</p>
          <p class="text-sm text-neutral-500">Import your Apple Health data in Settings to see trends here.</p>
          <a href="/settings" class="inline-block mt-3 text-green-400 text-sm">Go to Settings</a>
        </div>
      {/if}
    {/if}
  {/if}
</div>
