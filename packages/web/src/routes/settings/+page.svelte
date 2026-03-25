<script lang="ts">
  import { api } from '$lib/api';

  let equipment = $state(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('fitlocal-equipment') || 'full'
      : 'full'
  );
  let importStatus = $state('');
  let importing = $state(false);

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
</script>

<div class="p-4 max-w-lg mx-auto">
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

    <!-- CSV Import -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-3">Import Data</h2>
      <label class="block w-full cursor-pointer">
        <div class="py-3 px-4 rounded-lg bg-neutral-800 text-center text-neutral-300 min-h-[48px] flex items-center justify-center">
          {#if importing}
            Importing...
          {:else}
            📂 Select Fitbod CSV File
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

    <!-- Apple Health -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-3">Apple Health Sync</h2>
      <p class="text-sm text-neutral-400 mb-2">
        Set up an iOS Shortcut to sync health data daily via <code class="text-neutral-300">POST /health/sync</code>.
      </p>
      <div class="text-xs text-neutral-500 space-y-1">
        <p>Supported fields:</p>
        <ul class="list-disc list-inside ml-2 space-y-0.5">
          <li><span class="text-neutral-400">hrv</span> — Heart Rate Variability (ms)</li>
          <li><span class="text-neutral-400">restingHr</span> — Resting heart rate (bpm)</li>
          <li><span class="text-neutral-400">sleepHours</span> — Hours of sleep</li>
          <li><span class="text-neutral-400">steps</span> — Daily step count</li>
          <li><span class="text-neutral-400">bodyWeightKg</span> — Body weight (kg)</li>
        </ul>
      </div>
    </div>

    <!-- About -->
    <div class="rounded-xl p-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-2">About</h2>
      <p class="text-sm text-neutral-500">FitLocal v0.1.0 — Self-hosted workout tracker</p>
    </div>
  </div>
</div>
