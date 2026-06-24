<script lang="ts">
  import { api } from '$lib/api';
  import { cachedGet } from '$lib/api-cache.svelte';
  import BarChart from '$lib/BarChart.svelte';
  import LineChart from '$lib/LineChart.svelte';
  import BenchmarkBar from '$lib/BenchmarkBar.svelte';
  import VolumeHeatmap from '$lib/VolumeHeatmap.svelte';
  import WeightTrendChart from '$lib/WeightTrendChart.svelte';
  import Expandable from '$lib/Expandable.svelte';
  import type {
    SummaryReport as Summary,
    FrequencyReport,
    VolumeWorkout,
    VolumeReport,
    MuscleDistributionReport,
    PersonalRecord as PR,
    PersonalRecordsReport,
    BenchmarkExercise,
    BenchmarksReport,
    VolumeHeatmapWeek as VolumeWeek,
    VolumeHeatmapReport,
    ExerciseWithHistory as ExerciseOption,
    ExercisesWithHistoryReport,
    ExerciseDataPoint,
    HealthTrendSnapshot as HealthSnapshot,
    HealthTrendsReport,
  } from 'fitlocal-shared';

  type MuscleData = MuscleDistributionReport['muscles'][number];
  type FrequencyWeek = FrequencyReport['weeks'][number];

  let selectedExerciseId: number | null = $state(null);
  let exerciseProgression: ExerciseDataPoint[] = $state([]);
  let exerciseProgressionName: string = $state('');
  let activeTab: 'training' | 'health' = $state('training');
  let healthRange: '30' | '90' | '365' | 'all' = $state('90');
  let show1RM = $state(false);
  let benchmarkGender: 'male' | 'female' = $state('male');
  let showFrequencyDetail = $state(false);
  let showVolumeDetail = $state(false);
  let showMuscleDetail = $state(false);
  let showPRDetail = $state(false);

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

  const summaryCache = cachedGet<Summary>(withExclusions('/reports/summary'));
  const freqCache = cachedGet<FrequencyReport>(withExclusions('/reports/frequency'));
  const volCache = cachedGet<VolumeReport>(withExclusions('/reports/volume'));
  const muscleCache = cachedGet<MuscleDistributionReport>(withExclusions('/reports/muscle-distribution'));
  const prCache = cachedGet<PersonalRecordsReport>(withExclusions('/reports/personal-records'));
  const exCache = cachedGet<ExercisesWithHistoryReport>(withExclusions('/reports/exercises-with-history'));
  const healthCache = cachedGet<HealthTrendsReport>('/reports/health-trends');
  const volumeHeatmapCache = cachedGet<VolumeHeatmapReport>('/reports/volume-heatmap?weeks=4');

  // Fetch all available weight trend data (uses default 90d, but we request 365d to cover all filters)
  const weightTrendCache = cachedGet<import('fitlocal-shared').WeightTrend>('/goals/weight-trend?since=' + new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10));
  let weightTrendRaw = $derived(weightTrendCache.data);

  // Filter weight trend points by the same healthRange used for other health charts
  let weightTrend = $derived.by(() => {
    if (!weightTrendRaw) return null;
    let points = weightTrendRaw.points;
    if (healthRange !== 'all') {
      const days = parseInt(healthRange);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      points = points.filter(p => p.date >= cutoffStr);
    }
    if (points.length === 0) return null;

    // Recalculate weekly rate from filtered data
    const KG_TO_LBS = 2.20462;
    let weeklyRateLbs: number | null = null;
    if (points.length >= 2) {
      const latest = points[points.length - 1];
      const targetDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      let priorIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < points.length; i++) {
        const diff = Math.abs(points[i].date.localeCompare(targetDate));
        if (diff < bestDiff) { bestDiff = diff; priorIdx = i; }
      }
      if (priorIdx !== points.length - 1) {
        const daysDiff = (new Date(latest.date).getTime() - new Date(points[priorIdx].date).getTime()) / 86400000;
        if (daysDiff > 0) {
          weeklyRateLbs = Math.round((latest.trendKg - points[priorIdx].trendKg) / daysDiff * 7 * KG_TO_LBS * 10) / 10;
        }
      }
    }

    return {
      ...weightTrendRaw,
      points,
      weeklyRateLbs,
    };
  });

  const defaultSummary: Summary = { totalWorkouts: 0, totalWorkingSets: 0, totalVolumeKg: 0, currentStreak: 0, workoutsThisWeek: 0, workoutsThisMonth: 0 };

  let summary = $derived(summaryCache.data ?? defaultSummary);
  let frequency = $derived(freqCache.data?.weeks ?? []);
  let volume = $derived(volCache.data?.workouts ?? []);
  let muscles = $derived(muscleCache.data?.muscles ?? []);
  let records = $derived(prCache.data?.records ?? []);
  let exerciseOptions = $derived(exCache.data?.exercises ?? []);
  let healthSnapshots = $derived(healthCache.data?.snapshots ?? []);
  let benchmarks: BenchmarkExercise[] = $state([]);
  let bodyWeightKg: number | null = $state(null);
  let volumeHeatmap = $derived(volumeHeatmapCache.data);

  // Load benchmarks reactively when gender changes
  async function loadBenchmarks(gender: 'male' | 'female') {
    try {
      const result = await api<BenchmarksReport>(`/reports/benchmarks?gender=${gender}`);
      benchmarks = result.exercises;
      bodyWeightKg = result.bodyWeightKg;
    } catch { benchmarks = []; }
  }
  $effect(() => { loadBenchmarks(benchmarkGender); });
  let loading = $derived(
    summaryCache.loading && freqCache.loading && volCache.loading &&
    muscleCache.loading && prCache.loading && exCache.loading && healthCache.loading
  );

  // Exercise progression search
  let exerciseSearchOpen = $state(false);
  let exerciseSearchQuery = $state('');
  let filteredExerciseOptions = $derived(
    exerciseSearchQuery.trim()
      ? exerciseOptions.filter((ex: any) => ex.name.toLowerCase().includes(exerciseSearchQuery.toLowerCase()))
      : exerciseOptions
  );

  // Small-multiples gallery of the most-logged lifts
  let galleryCards = $state<{ id: number; name: string; points: ExerciseDataPoint[] }[]>([]);
  let galleryLoading = $state(false);
  let galleryLoaded = $state(false);

  // Load the gallery once exercise options become available (runs once)
  $effect(() => {
    if (exerciseOptions.length > 0 && !galleryLoaded) {
      galleryLoaded = true;
      loadGallery();
    }
  });

  async function loadGallery() {
    // Pull extra candidates so we can still fill 6 cards after dropping ones
    // with no weight progression (bodyweight moves graph as a flat 0-lb line).
    const candidates = exerciseOptions.slice(0, 12);
    galleryLoading = true;
    try {
      const results = await Promise.all(
        candidates.map((ex: ExerciseOption) =>
          api<import('fitlocal-shared').ExerciseProgressionReport>(
            withExclusions(`/reports/exercise-progression?exerciseId=${ex.id}`)
          )
            .then((result) => ({ id: ex.id, name: result.exerciseName || ex.name, points: result.dataPoints }))
            .catch(() => ({ id: ex.id, name: ex.name, points: [] as ExerciseDataPoint[] }))
        )
      );
      galleryCards = results
        .filter((c) => c.points.length >= 2 && c.points.some((p) => p.maxWeight > 0))
        .slice(0, 6);
    } finally {
      galleryLoading = false;
    }
  }

  // Trend direction comparing last vs first point's max weight
  function trend(points: ExerciseDataPoint[]): 'up' | 'down' | 'flat' {
    if (points.length < 2) return 'flat';
    const first = points[0].maxWeight;
    const last = points[points.length - 1].maxWeight;
    if (last > first) return 'up';
    if (last < first) return 'down';
    return 'flat';
  }

  async function loadExerciseProgression(exerciseId: number) {
    selectedExerciseId = exerciseId;
    try {
      const result = await api<import('fitlocal-shared').ExerciseProgressionReport>(
        withExclusions(`/reports/exercise-progression?exerciseId=${exerciseId}`)
      );
      exerciseProgression = result.dataPoints;
      exerciseProgressionName = result.exerciseName || '';
    } catch {
      exerciseProgression = [];
    }
  }
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
          <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Training Balance (30d)</h2>
          {#if muscles.length > 0}
            {@const totalSets = muscles.reduce((s, m) => s + m.sets, 0)}
            {@const maxPct = Math.max(...muscles.map((m) => m.sets / totalSets))}
            <div class="space-y-1.5">
              {#each muscles as muscle}
                {@const pct = Math.round((muscle.sets / totalSets) * 100)}
                <div class="flex items-center gap-2">
                  <span class="text-xs text-neutral-400 w-20 text-right capitalize">{muscle.name}</span>
                  <div class="flex-1 h-4 rounded overflow-hidden" style="background-color: #262626;">
                    <div
                      class="h-full rounded"
                      style="width: {(muscle.sets / totalSets / maxPct) * 100}%; background-color: {pct >= 12 ? '#22c55e' : pct >= 6 ? '#f59e0b' : '#ef4444'};"
                    ></div>
                  </div>
                  <span class="text-xs text-neutral-500 w-8 text-right">{pct}%</span>
                </div>
              {/each}
            </div>
            <p class="text-[10px] text-neutral-600 mt-2 text-center">{Math.round(totalSets)} total sets — color shows relative volume (green = well-trained, amber = moderate, red = undertrained)</p>
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
                  <span class="text-xs text-neutral-500 ml-1 w-14 text-right" title="Estimated 1RM">{kgToLbs(pr.estimated1RmKg)}e</span>
                  <span class="text-xs text-neutral-500 ml-1 w-14 text-right">{formatDate(pr.dateAchieved)}</span>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-neutral-500 text-sm text-center py-4">No records yet</p>
          {/if}
        </section>
      </div>

      <!-- Volume Heatmap + Benchmarks: side by side on desktop -->
      <div class="md:grid md:grid-cols-2 md:gap-5 md:mt-5">
        {#if volumeHeatmap && volumeHeatmap.weeks.length > 0}
          <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
            <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Volume by Muscle (4 wks)</h2>
            <VolumeHeatmap muscles={volumeHeatmap.muscles} weeks={volumeHeatmap.weeks} />
          </section>
        {/if}

        {#if benchmarks.length > 0}
          <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide">Strength Benchmarks</h2>
              <button
                onclick={() => benchmarkGender = benchmarkGender === 'male' ? 'female' : 'male'}
                class="text-[10px] px-2 py-0.5 rounded-full border border-neutral-700 text-neutral-500"
              >
                {benchmarkGender === 'male' ? '♂ Male' : '♀ Female'}
              </button>
            </div>
            {#if bodyWeightKg}
              <p class="text-[10px] text-neutral-600 mb-3">Based on {kgToLbs(bodyWeightKg)} lbs body weight</p>
            {/if}
            <div class="space-y-3">
              {#each benchmarks as bench}
                <div>
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-xs text-neutral-300">{bench.name}</span>
                    <span class="text-[10px] font-semibold capitalize px-1.5 py-0.5 rounded {
                      bench.level === 'elite' ? 'bg-red-500/20 text-red-400' :
                      bench.level === 'advanced' ? 'bg-orange-500/20 text-orange-400' :
                      bench.level === 'intermediate' ? 'bg-green-500/20 text-green-400' :
                      bench.level === 'novice' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-neutral-700 text-neutral-400'
                    }">{bench.level}</span>
                  </div>
                  <BenchmarkBar ratio={bench.ratio} thresholds={bench.thresholds} level={bench.level} />
                </div>
              {/each}
            </div>
          </section>
        {/if}
      </div>

      <!-- Exercise Progression: full width -->
      <section class="mt-5 mb-5 rounded-xl p-4" style="background-color: #1a1a1a;">
        <h2 class="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">Exercise Progression</h2>
        {#if exerciseOptions.length > 0}
          <!-- Small-multiples gallery of top lifts -->
          {#if galleryLoading}
            <div class="grid grid-cols-2 gap-2">
              {#each Array(4) as _}
                <div class="rounded-lg p-3 min-h-[44px] animate-pulse" style="background-color: #222;">
                  <div class="h-3 w-2/3 bg-neutral-700 rounded mb-3"></div>
                  <div class="h-12 bg-neutral-700/60 rounded"></div>
                </div>
              {/each}
            </div>
          {:else if galleryCards.length > 0}
            <div class="grid grid-cols-2 gap-2">
              {#each galleryCards as card (card.id)}
                {@const last = card.points[card.points.length - 1]}
                {@const dir = trend(card.points)}
                <button
                  onclick={() => loadExerciseProgression(card.id)}
                  class="rounded-lg p-3 min-h-[44px] text-left flex flex-col gap-1.5 border {card.id === selectedExerciseId ? 'border-green-500 ring-1 ring-green-500' : 'border-transparent'}"
                  style="background-color: #222;"
                >
                  <span class="text-xs font-medium text-neutral-200 truncate">{card.name}</span>
                  <LineChart
                    data={card.points.map((d) => ({ label: shortDate(d.date), value: kgToLbs(d.maxWeight) }))}
                    color="#3b82f6"
                    height={64}
                    unit=""
                    showDots={false}
                    minimal
                  />
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-semibold text-neutral-100">{kgToLbs(last.maxWeight)} lb</span>
                    <span class="text-sm {dir === 'up' ? 'text-green-400' : dir === 'down' ? 'text-red-400' : 'text-neutral-500'}">
                      {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'}
                    </span>
                  </div>
                </button>
              {/each}
            </div>
          {/if}

          <!-- Expanded detail for the selected lift -->
          {#if selectedExerciseId && exerciseProgression.length > 0}
            <div class="mt-4 pt-4 border-t border-neutral-800">
              <h3 class="text-sm font-semibold text-neutral-200 mb-2 truncate">{exerciseProgressionName}</h3>
              <div class="flex items-center justify-between mb-2">
                <p class="text-xs text-neutral-500">{show1RM ? 'Estimated 1RM per session' : 'Max weight per session'}</p>
                <button
                  onclick={() => show1RM = !show1RM}
                  class="text-[10px] px-2 py-0.5 rounded-full border {show1RM ? 'border-blue-500 text-blue-400 bg-blue-500/10' : 'border-neutral-700 text-neutral-500'}"
                >
                  Est. 1RM
                </button>
              </div>
              <LineChart
                data={exerciseProgression.map((d) => ({
                  label: shortDate(d.date),
                  value: show1RM ? kgToLbs(d.estimated1RmKg) : kgToLbs(d.maxWeight),
                }))}
                color={show1RM ? '#f59e0b' : '#3b82f6'}
                height={140}
                unit="lb"
              />
            </div>
          {/if}

          <!-- Search all lifts (access lifts outside the top 6) -->
          <div class="relative mt-4">
            <button
              onclick={() => { exerciseSearchOpen = !exerciseSearchOpen; exerciseSearchQuery = ''; }}
              class="w-full bg-neutral-800 text-neutral-200 rounded-lg px-3 py-2 text-sm border border-neutral-700 text-left flex items-center justify-between"
            >
              <span class="truncate">Search all lifts</span>
              <svg class="w-4 h-4 shrink-0 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </button>
            {#if exerciseSearchOpen}
              <div class="absolute z-20 left-0 right-0 top-full mt-1 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl max-h-64 flex flex-col">
                <div class="p-2 border-b border-neutral-700">
                  <input
                    type="text"
                    placeholder="Search exercises..."
                    bind:value={exerciseSearchQuery}
                    class="w-full px-2.5 py-1.5 rounded bg-neutral-900 text-white text-sm placeholder-neutral-500 border border-neutral-600 focus:outline-none focus:border-green-500"
                    autofocus
                  />
                </div>
                <div class="overflow-y-auto">
                  {#each filteredExerciseOptions as ex}
                    <button
                      onclick={() => { loadExerciseProgression(ex.id); exerciseSearchOpen = false; exerciseSearchQuery = ''; }}
                      class="w-full text-left px-3 py-2 text-sm hover:bg-neutral-700 transition-colors {ex.id === selectedExerciseId ? 'text-green-400' : 'text-neutral-200'}"
                    >
                      {ex.name} <span class="text-neutral-500">({ex.workoutCount})</span>
                    </button>
                  {/each}
                  {#if filteredExerciseOptions.length === 0}
                    <p class="px-3 py-2 text-sm text-neutral-500">No matches</p>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
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
        {#if weightTrend && weightTrend.points.length > 0}
          <section class="mb-5 md:mb-0 rounded-xl p-4" style="background-color: #1a1a1a;">
            <WeightTrendChart
              points={weightTrend.points}
              weeklyRateLbs={weightTrend.weeklyRateLbs}
              targetWeightKg={weightTrend.targetWeightKg}
              height={160}
            />
          </section>
        {:else if filteredHealth.some((s) => s.bodyWeightKg != null)}
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
