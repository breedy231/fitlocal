<script lang="ts">
  import { api } from '$lib/api';

  let equipment = $state(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('fitlocal-equipment') || 'full'
      : 'full'
  );
  let importStatus = $state('');
  let importing = $state(false);

  // Apple Health sync
  let syncStatus = $state('');
  let syncing = $state(false);
  let copied = $state(false);
  const apiBase = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? `http://${window.location.hostname}:3001`
    : 'http://localhost:3001';
  const syncUrl = `${apiBase}/health/sync`;
  const jsonTemplate = JSON.stringify({
    hrv: 45,
    restingHr: 58,
    sleepHours: 7.5,
    steps: 8200,
    bodyWeightKg: 82.1
  }, null, 2);

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

    <!-- Apple Health Sync -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-3">Apple Health Sync</h2>
      <p class="text-sm text-neutral-400 mb-3">
        Create an iOS Shortcut that runs on a schedule, reads health data, and POSTs to this URL.
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

      <!-- JSON Template -->
      <div class="mb-3">
        <label class="text-xs text-neutral-500 block mb-1">JSON Body Template</label>
        <pre class="text-xs text-neutral-400 bg-neutral-800 rounded-lg px-3 py-2 overflow-x-auto">{jsonTemplate}</pre>
      </div>

      <!-- Supported fields -->
      <div class="text-xs text-neutral-500 space-y-1 mb-3">
        <p>All fields are optional:</p>
        <ul class="list-disc list-inside ml-2 space-y-0.5">
          <li><span class="text-neutral-400">hrv</span> — Heart Rate Variability (ms)</li>
          <li><span class="text-neutral-400">restingHr</span> — Resting heart rate (bpm)</li>
          <li><span class="text-neutral-400">sleepHours</span> — Hours of sleep</li>
          <li><span class="text-neutral-400">steps</span> — Daily step count</li>
          <li><span class="text-neutral-400">bodyWeightKg</span> — Body weight (kg)</li>
        </ul>
      </div>

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
    </div>

    <!-- About -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-2">About</h2>
      <p class="text-sm text-neutral-500">FitLocal v0.1.0 — Self-hosted workout tracker</p>
    </div>
  </div>
</div>
