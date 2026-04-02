<script lang="ts">
  import { api } from '$lib/api';
  import { cachedGet } from '$lib/api-cache.svelte';
  import { invalidateAfterMutation } from '$lib/api-cache.svelte';
  import { showToast } from '$lib/toast';

  const KG_TO_LBS = 2.20462;
  const LBS_TO_KG = 1 / KG_TO_LBS;

  // Cut phase goals
  interface Goals {
    maintenanceCalories: number | null;
    targetCalories: number | null;
    targetProteinG: number | null;
    targetWeightKg: number | null;
    cutStartDate: string | null;
    cutEndDate: string | null;
  }
  const goalsCache = cachedGet<Goals>('/goals');
  let goalsLoaded = $state(false);
  let cutMaintenance = $state('');
  let cutTargetCal = $state('');
  let cutTargetProtein = $state('');
  let cutTargetWeightLbs = $state('');
  let cutStartDate = $state('');
  let cutEndDate = $state('');
  let cutSaving = $state(false);

  $effect(() => {
    const g = goalsCache.data;
    if (g && !goalsLoaded) {
      goalsLoaded = true;
      cutMaintenance = g.maintenanceCalories?.toString() ?? '';
      cutTargetCal = g.targetCalories?.toString() ?? '';
      cutTargetProtein = g.targetProteinG?.toString() ?? '';
      cutTargetWeightLbs = g.targetWeightKg ? Math.round(g.targetWeightKg * KG_TO_LBS).toString() : '';
      cutStartDate = g.cutStartDate ?? '';
      cutEndDate = g.cutEndDate ?? '';
    }
  });

  async function saveCutGoals() {
    cutSaving = true;
    try {
      await api('/goals', {
        method: 'PUT',
        body: JSON.stringify({
          maintenanceCalories: cutMaintenance ? parseInt(cutMaintenance) : null,
          targetCalories: cutTargetCal ? parseInt(cutTargetCal) : null,
          targetProteinG: cutTargetProtein ? parseFloat(cutTargetProtein) : null,
          targetWeightKg: cutTargetWeightLbs ? parseFloat(cutTargetWeightLbs) * LBS_TO_KG : null,
          cutStartDate: cutStartDate || null,
          cutEndDate: cutEndDate || null,
        }),
      });
      invalidateAfterMutation('/goals');
      showToast('Cut goals saved!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      cutSaving = false;
    }
  }

  function setDefaultDates() {
    if (!cutStartDate) {
      // Default to next Monday
      const d = new Date();
      const daysUntilMon = (8 - d.getDay()) % 7 || 7;
      d.setDate(d.getDate() + daysUntilMon);
      cutStartDate = d.toISOString().slice(0, 10);
    }
    if (!cutEndDate && cutStartDate) {
      // Default to 12 weeks from start
      const end = new Date(cutStartDate + 'T12:00:00');
      end.setDate(end.getDate() + 84);
      cutEndDate = end.toISOString().slice(0, 10);
    }
  }

  let equipment = $state(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('fitlocal-equipment') || 'full'
      : 'full'
  );
  let importStatus = $state('');
  let importing = $state(false);

  // Report exclusions
  interface ExerciseResult { id: number; name: string }
  let exclusionSearch = $state('');
  let exclusionResults: ExerciseResult[] = $state([]);
  let excludedExercises: ExerciseResult[] = $state([]);
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  function loadExclusions() {
    if (typeof localStorage === 'undefined') return;
    try {
      const ids: number[] = JSON.parse(localStorage.getItem('fitlocal-report-exclusions') || '[]');
      if (ids.length === 0) return;
      // Load names for excluded IDs
      Promise.all(ids.map(id => api<ExerciseResult>(`/exercises/${id}`).catch(() => null)))
        .then(results => {
          excludedExercises = results.filter((r): r is ExerciseResult => r !== null);
        });
    } catch { /* ignore */ }
  }

  function saveExclusions() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('fitlocal-report-exclusions', JSON.stringify(excludedExercises.map(e => e.id)));
  }

  function addExclusion(ex: ExerciseResult) {
    if (excludedExercises.some(e => e.id === ex.id)) return;
    excludedExercises = [...excludedExercises, ex];
    saveExclusions();
    exclusionSearch = '';
    exclusionResults = [];
  }

  function removeExclusion(id: number) {
    excludedExercises = excludedExercises.filter(e => e.id !== id);
    saveExclusions();
  }

  async function searchExercises(query: string) {
    if (!query.trim()) { exclusionResults = []; return; }
    try {
      exclusionResults = await api<ExerciseResult[]>(`/exercises/search?q=${encodeURIComponent(query)}`);
    } catch { exclusionResults = []; }
  }

  // Load exclusions on init
  if (typeof localStorage !== 'undefined') {
    loadExclusions();
  }

  // Apple Health sync
  let syncStatus = $state('');
  let syncing = $state(false);
  let copied = $state(false);
  let showSteps = $state(false);
  let showBackfill = $state(false);
  let healthImporting = $state(false);
  let healthImportResult = $state('');

  function getApiBase(): string {
    if (typeof window === 'undefined') return 'http://localhost:3001';
    const { hostname, port, protocol } = window.location;
    if (port === '5173') return '/api';
    return `${protocol}//${hostname}${port ? ':' + port : ''}/api`;
  }

  const apiBase = getApiBase();
  const syncUrl = `${apiBase}/health/sync`;
  const importUrl = `${apiBase}/health/import-samples`;

  async function handleHealthExport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    healthImporting = true;
    healthImportResult = '';
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(`${apiBase}/health/import-apple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: buffer,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `Import failed: ${res.status}`);
      }
      const result = await res.json();
      const counts = result.sampleCounts || {};
      const details = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ');
      healthImportResult = `Imported ${result.daysProcessed} days (${result.dateRange}). ${result.inserted} new, ${result.updated} updated. Samples: ${details}`;
      showToast('Health data imported!', 'success');
    } catch (err: any) {
      healthImportResult = err.message || 'Import failed';
      showToast(healthImportResult, 'error');
    } finally {
      healthImporting = false;
      input.value = '';
    }
  }

  function toggleEquipment() {
    equipment = equipment === 'full' ? 'travel' : 'full';
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('fitlocal-equipment', equipment);
    }
  }

  async function handleFileImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    importing = true;
    importStatus = '';
    try {
      const csvText = await file.text();
      const result = await api<{ message: string; workoutsCreated: number; setsCreated: number }>(
        '/import/fitbod',
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/csv' },
          body: csvText,
        }
      );
      importStatus = `Imported ${result.workoutsCreated} workouts, ${result.setsCreated} sets`;
    } catch (err: any) {
      importStatus = `Error: ${err.message}`;
    } finally {
      importing = false;
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(syncUrl);
      copied = true;
      setTimeout(() => copied = false, 2000);
    } catch {}
  }

  async function testSync() {
    syncing = true;
    syncStatus = '';
    try {
      await api('/health/sync', {
        method: 'POST',
        body: JSON.stringify({
          hrv: 0,
          restingHr: 0,
          sleepHours: 0,
          steps: 0,
          bodyWeightKg: 0
        }),
      });
      syncStatus = 'Connection successful!';
    } catch (err: any) {
      syncStatus = `Error: ${err.message}`;
    } finally {
      syncing = false;
    }
  }
</script>

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  <h1 class="text-2xl font-bold mb-6">Settings</h1>
  <div class="space-y-4">
    <!-- Cut Phase -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-3">Cut Phase</h2>
      <p class="text-sm text-neutral-400 mb-4">Set your caloric deficit targets for the cut. These drive the nutrition card on the home page and adjust workout volume automatically.</p>

      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-neutral-500 block mb-1">Maintenance (cal)</label>
            <input
              type="number"
              bind:value={cutMaintenance}
              placeholder="2200"
              class="w-full px-3 py-2 rounded-lg bg-neutral-800 text-neutral-200 text-sm border-none outline-none"
            />
          </div>
          <div>
            <label class="text-xs text-neutral-500 block mb-1">Daily Target (cal)</label>
            <input
              type="number"
              bind:value={cutTargetCal}
              placeholder="1800"
              class="w-full px-3 py-2 rounded-lg bg-neutral-800 text-neutral-200 text-sm border-none outline-none"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-neutral-500 block mb-1">Protein Target (g)</label>
            <input
              type="number"
              bind:value={cutTargetProtein}
              placeholder="180"
              class="w-full px-3 py-2 rounded-lg bg-neutral-800 text-neutral-200 text-sm border-none outline-none"
            />
          </div>
          <div>
            <label class="text-xs text-neutral-500 block mb-1">Goal Weight (lbs)</label>
            <input
              type="number"
              bind:value={cutTargetWeightLbs}
              placeholder="175"
              class="w-full px-3 py-2 rounded-lg bg-neutral-800 text-neutral-200 text-sm border-none outline-none"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-neutral-500 block mb-1">Start Date</label>
            <input
              type="date"
              bind:value={cutStartDate}
              onfocus={setDefaultDates}
              class="w-full px-3 py-2 rounded-lg bg-neutral-800 text-neutral-200 text-sm border-none outline-none"
            />
          </div>
          <div>
            <label class="text-xs text-neutral-500 block mb-1">End Date</label>
            <input
              type="date"
              bind:value={cutEndDate}
              onfocus={setDefaultDates}
              class="w-full px-3 py-2 rounded-lg bg-neutral-800 text-neutral-200 text-sm border-none outline-none"
            />
          </div>
        </div>

        <button
          onclick={saveCutGoals}
          disabled={cutSaving}
          class="w-full py-3 px-4 rounded-lg bg-green-600 text-white font-medium text-sm min-h-[48px] disabled:opacity-50"
        >
          {cutSaving ? 'Saving...' : 'Save Cut Goals'}
        </button>
      </div>
    </div>

    <!-- Equipment Preference -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-3">Equipment Preference</h2>
      <button
        onclick={toggleEquipment}
        class="w-full flex items-center justify-between py-3 px-4 rounded-lg bg-neutral-800 min-h-[48px]"
      >
        <span class="text-neutral-300">Mode</span>
        <span class="{equipment === 'full' ? 'text-green-400' : 'text-blue-400'} font-medium">
          {equipment === 'full' ? '🏋️ Full Gym' : '🧳 Travel'}
        </span>
      </button>
    </div>

    <!-- Fitbod Import -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-3">Fitbod Import</h2>
      <p class="text-sm text-neutral-400 mb-3">Upload a Fitbod CSV export to import workout history. Re-importing is safe — duplicates are created as new entries.</p>
      <label class="block w-full cursor-pointer">
        <div class="py-3 px-4 rounded-lg bg-neutral-800 text-center text-neutral-300 min-h-[48px] flex items-center justify-center">
          {#if importing}
            Importing...
          {:else}
            Select Fitbod CSV File
          {/if}
        </div>
        <input type="file" accept=".csv" onchange={handleFileImport} class="hidden" disabled={importing} />
      </label>
      {#if importStatus}
        <p class="text-sm mt-2 {importStatus.startsWith('Error') ? 'text-red-400' : 'text-green-400'}">
          {importStatus}
        </p>
      {/if}
    </div>

    <!-- Apple Health Import -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-3">Apple Health Import</h2>
      <p class="text-sm text-neutral-400 mb-3">
        Import your full health history from the Apple Health app. Go to <strong>Health &gt; Profile (top right) &gt; Export All Health Data</strong>, then AirDrop the zip to your Mac and upload it here.
      </p>

      <label class="block w-full cursor-pointer mb-3">
        <div class="py-3 px-4 rounded-lg bg-neutral-800 text-center text-neutral-300 min-h-[48px] flex items-center justify-center">
          {#if healthImporting}
            <div class="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2"></div>
            Importing (this may take a minute)...
          {:else}
            Select Apple Health Export (.zip)
          {/if}
        </div>
        <input type="file" accept=".zip" onchange={handleHealthExport} class="hidden" disabled={healthImporting} />
      </label>
      {#if healthImportResult}
        <p class="text-xs mt-2 {healthImportResult.startsWith('Imported') ? 'text-green-400' : 'text-red-400'} leading-relaxed">
          {healthImportResult}
        </p>
      {/if}

      <p class="text-xs text-neutral-600 mt-2">Imports HRV, resting heart rate, sleep, steps, body weight, calories, and protein. Safe to re-import — data is merged by date.</p>
    </div>

    <!-- Apple Health Sync (Advanced) -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-3">Daily Sync (Advanced)</h2>
      <p class="text-sm text-neutral-400 mb-3">
        For ongoing daily sync via iOS Shortcuts. Re-export from Health periodically, or set up a Shortcut automation.
      </p>

      <!-- Sync URL -->
      <div class="mb-3">
        <label class="text-xs text-neutral-500 block mb-1">Sync Endpoint</label>
        <div class="flex items-center gap-2">
          <code class="flex-1 text-xs text-neutral-300 bg-neutral-800 rounded-lg px-3 py-2 break-all">{syncUrl}</code>
          <button
            onclick={copyUrl}
            class="px-3 py-2 rounded-lg bg-neutral-800 text-xs text-neutral-300 min-h-[36px] shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <!-- Setup Guide Toggle -->
      <button
        onclick={() => showSteps = !showSteps}
        class="w-full flex items-center justify-between py-3 px-4 rounded-lg bg-neutral-800 text-sm text-neutral-300 mb-3 min-h-[48px]"
      >
        <span>Shortcut Setup Guide</span>
        <span class="text-neutral-500">{showSteps ? '▲' : '▼'}</span>
      </button>

      {#if showSteps}
        <div class="space-y-3 mb-3 text-sm">
          <div class="rounded-lg bg-neutral-800/50 p-3">
            <p class="text-neutral-300 font-medium mb-2">1. Create the Shortcut</p>
            <p class="text-neutral-400 text-xs">Open <strong>Shortcuts</strong> app → tap <strong>+</strong> → name it <strong>FitLocal Sync</strong></p>
          </div>

          <div class="rounded-lg bg-neutral-800/50 p-3">
            <p class="text-neutral-300 font-medium mb-2">2. Add Health queries</p>
            <p class="text-neutral-400 text-xs mb-2">Add a <strong>Find Health Samples</strong> action for each metric below. Set each to sort by <strong>Start Date (newest first)</strong>, limit to <strong>1</strong> (except calories/protein — see note).</p>
            <div class="text-xs text-neutral-500 space-y-1 ml-2">
              <p>• <span class="text-neutral-400">Heart Rate Variability</span> → save to variable <code class="text-green-400/80">hrv</code></p>
              <p>• <span class="text-neutral-400">Resting Heart Rate</span> → save to variable <code class="text-green-400/80">restingHr</code></p>
              <p>• <span class="text-neutral-400">Sleep Analysis</span> → save to variable <code class="text-green-400/80">sleep</code></p>
              <p>• <span class="text-neutral-400">Steps</span> (start date = today) → save to variable <code class="text-green-400/80">steps</code></p>
              <p>• <span class="text-neutral-400">Body Mass</span> → save to variable <code class="text-green-400/80">weight</code></p>
              <p>• <span class="text-neutral-400">Dietary Energy</span> (start date = today) → use <strong>Calculate Statistics</strong> (Sum) → save to variable <code class="text-green-400/80">calories</code></p>
              <p>• <span class="text-neutral-400">Protein</span> (start date = today) → use <strong>Calculate Statistics</strong> (Sum) → save to variable <code class="text-green-400/80">protein</code></p>
            </div>
            <p class="text-neutral-500 text-xs mt-1.5">Calories and protein have multiple entries per day (one per meal from MyFitnessPal). Use <strong>Calculate Statistics → Sum</strong> to get the daily total.</p>
          </div>

          <div class="rounded-lg bg-neutral-800/50 p-3">
            <p class="text-neutral-300 font-medium mb-2">3. Build the JSON dictionary</p>
            <p class="text-neutral-400 text-xs mb-2">Add a <strong>Dictionary</strong> action with these keys:</p>
            <pre class="text-xs text-neutral-400 bg-neutral-900 rounded px-2 py-1.5 overflow-x-auto">hrv: <span class="text-green-400/80">hrv</span> (number)
restingHr: <span class="text-green-400/80">restingHr</span> (number)
sleepHours: <span class="text-green-400/80">sleep</span> (number)
steps: <span class="text-green-400/80">steps</span> (number)
bodyWeightKg: <span class="text-green-400/80">weight</span> (number)
calories: <span class="text-green-400/80">calories</span> (number)
proteinG: <span class="text-green-400/80">protein</span> (number)</pre>
            <p class="text-neutral-500 text-xs mt-1.5">For sleep: use the duration value in hours. For weight: Shortcuts gives kg if your Health app is set to metric — otherwise add a <strong>Convert Measurement</strong> action first.</p>
          </div>

          <div class="rounded-lg bg-neutral-800/50 p-3">
            <p class="text-neutral-300 font-medium mb-2">4. POST to FitLocal</p>
            <p class="text-neutral-400 text-xs">Add <strong>Get Contents of URL</strong>:</p>
            <div class="text-xs text-neutral-500 ml-2 space-y-0.5 mt-1">
              <p>• URL: <code class="text-green-400/80 break-all">{syncUrl}</code></p>
              <p>• Method: <strong>POST</strong></p>
              <p>• Request Body: <strong>JSON</strong> → set to the Dictionary from step 3</p>
            </div>
          </div>

          <div class="rounded-lg bg-neutral-800/50 p-3">
            <p class="text-neutral-300 font-medium mb-2">5. Automate it (run twice daily)</p>
            <p class="text-neutral-400 text-xs">Go to <strong>Automation</strong> tab → create <strong>two</strong> automations that both run <strong>FitLocal Sync</strong>:</p>
            <div class="text-xs text-neutral-500 ml-2 space-y-0.5 mt-1">
              <p>• <strong>Morning (~7 AM)</strong> — captures sleep, HRV, resting HR, weight</p>
              <p>• <strong>Evening (~10 PM)</strong> — captures the full day's calories, protein, and steps</p>
            </div>
            <p class="text-neutral-500 text-xs mt-1.5">Set both to <strong>Run Immediately</strong>. The endpoint merges data — running twice is safe and ensures nutrition totals are complete for the day.</p>
          </div>
        </div>
      {/if}

      <!-- Test Sync -->
      <button
        onclick={testSync}
        disabled={syncing}
        class="w-full py-3 px-4 rounded-lg bg-neutral-800 text-neutral-300 text-sm min-h-[48px] disabled:opacity-50"
      >
        {syncing ? 'Testing...' : 'Test Sync Connection'}
      </button>
      {#if syncStatus}
        <p class="text-sm mt-2 {syncStatus.startsWith('Error') ? 'text-red-400' : 'text-green-400'}">
          {syncStatus}
        </p>
      {/if}

      <!-- Backfill Guide -->
      <button
        onclick={() => showBackfill = !showBackfill}
        class="w-full flex items-center justify-between py-3 px-4 rounded-lg bg-neutral-800 text-sm text-neutral-300 mt-3 min-h-[48px]"
      >
        <span>Historical Backfill (one-time)</span>
        <span class="text-neutral-500">{showBackfill ? '▲' : '▼'}</span>
      </button>

      {#if showBackfill}
        <div class="space-y-3 mt-3 text-sm">
          <p class="text-xs text-neutral-400">Import years of Apple Health history. Create a separate <strong>FitLocal Backfill</strong> shortcut — run it once, then delete it.</p>

          <div class="rounded-lg bg-neutral-800/50 p-3">
            <p class="text-neutral-300 font-medium mb-2">1. For each metric, repeat these 3 actions:</p>
            <p class="text-neutral-400 text-xs mb-2">You'll add a block of 3 actions per metric (5 blocks total).</p>

            <div class="rounded bg-neutral-900 p-2 mb-2">
              <p class="text-xs text-neutral-300 font-medium mb-1">Block A — HRV</p>
              <div class="text-xs text-neutral-500 space-y-0.5 ml-2">
                <p>① <strong>Find Health Samples</strong>: Type = <span class="text-neutral-300">Heart Rate Variability</span>, Start Date is after <span class="text-neutral-300">3 years ago</span>, Sort by Start Date (oldest first)</p>
                <p>② <strong>Repeat with Each</strong>: build a list of dictionaries — each with <code class="text-green-400/80">date</code> (Repeat Item's Start Date, formatted <span class="text-neutral-300">yyyy-MM-dd</span>) and <code class="text-green-400/80">value</code> (Repeat Item's Value)</p>
                <p>③ <strong>Get Contents of URL</strong>: POST to <code class="text-green-400/80 break-all">{importUrl}</code> with JSON body: <code class="text-green-400/80">{`{"type":"hrv","samples":[list from ②]}`}</code></p>
              </div>
            </div>

            <div class="rounded bg-neutral-900 p-2 mb-2">
              <p class="text-xs text-neutral-300 font-medium mb-1">Block B — Resting Heart Rate</p>
              <p class="text-xs text-neutral-500 ml-2">Same pattern. Type = <span class="text-neutral-300">Resting Heart Rate</span>. POST type: <code class="text-green-400/80">"restingHr"</code></p>
            </div>

            <div class="rounded bg-neutral-900 p-2 mb-2">
              <p class="text-xs text-neutral-300 font-medium mb-1">Block C — Sleep</p>
              <p class="text-xs text-neutral-500 ml-2">Type = <span class="text-neutral-300">Sleep Analysis</span>. For value, use the <span class="text-neutral-300">duration in hours</span>. POST type: <code class="text-green-400/80">"sleep"</code></p>
            </div>

            <div class="rounded bg-neutral-900 p-2 mb-2">
              <p class="text-xs text-neutral-300 font-medium mb-1">Block D — Steps</p>
              <p class="text-xs text-neutral-500 ml-2">Type = <span class="text-neutral-300">Steps</span>. POST type: <code class="text-green-400/80">"steps"</code></p>
            </div>

            <div class="rounded bg-neutral-900 p-2">
              <p class="text-xs text-neutral-300 font-medium mb-1">Block E — Body Weight</p>
              <p class="text-xs text-neutral-500 ml-2">Type = <span class="text-neutral-300">Body Mass</span>. POST type: <code class="text-green-400/80">"bodyWeight"</code></p>
            </div>
          </div>

          <div class="rounded-lg bg-neutral-800/50 p-3">
            <p class="text-neutral-300 font-medium mb-2">2. Run it</p>
            <p class="text-neutral-400 text-xs">Tap play. It may take 1–2 minutes for large datasets. The server aggregates multiple readings per day automatically (averages HR/HRV, sums steps/sleep). Safe to re-run — data merges without duplicating.</p>
          </div>

          <div class="mb-1">
            <label class="text-xs text-neutral-500 block mb-1">Import Endpoint</label>
            <code class="text-xs text-neutral-300 bg-neutral-800 rounded-lg px-3 py-2 break-all block">{importUrl}</code>
          </div>
        </div>
      {/if}
    </div>

    <!-- Report Exclusions -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-3">Report Exclusions</h2>
      <p class="text-sm text-neutral-400 mb-3">Exclude specific exercises from all report calculations.</p>
      <input
        type="text"
        bind:value={exclusionSearch}
        oninput={(e) => {
          const q = (e.target as HTMLInputElement).value;
          if (searchTimeout) clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => searchExercises(q), 300);
        }}
        placeholder="Search exercises..."
        class="w-full px-3 py-2 rounded-lg bg-neutral-800 text-neutral-200 text-sm border-none outline-none mb-2"
      />
      {#if exclusionResults.length > 0}
        <div class="rounded-lg bg-neutral-800 mb-3 max-h-40 overflow-y-auto">
          {#each exclusionResults as ex}
            <button
              onclick={() => addExclusion(ex)}
              class="w-full text-left px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700 flex justify-between items-center"
            >
              <span>{ex.name}</span>
              {#if excludedExercises.some(e => e.id === ex.id)}
                <span class="text-xs text-neutral-500">excluded</span>
              {:else}
                <span class="text-xs text-green-400">+ exclude</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
      {#if excludedExercises.length > 0}
        <div class="space-y-1">
          {#each excludedExercises as ex}
            <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-neutral-800">
              <span class="text-sm text-neutral-300">{ex.name}</span>
              <button
                onclick={() => removeExclusion(ex.id)}
                class="text-xs text-red-400 hover:text-red-300"
              >Remove</button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-xs text-neutral-500">No exercises excluded</p>
      {/if}
    </div>

    <!-- About -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-2">About</h2>
      <p class="text-sm text-neutral-500">FitLocal v0.1.0 — Self-hosted workout tracker</p>
    </div>
  </div>
</div>
