<script lang="ts">
  import { api } from '$lib/api';
  import { onMount } from 'svelte';
  import { showToast } from '$lib/toast';

  interface Program {
    id: number;
    name: string;
    daysPerWeek: number | null;
    durationWeeks: number | null;
    source: string | null;
    dayCount: number;
  }

  interface ActiveProgram {
    program: { id: number; name: string };
    dayIndex: number;
    totalDays: number;
    day: { name: string; musclesFocus: string | null };
  }

  let programs: Program[] = $state([]);
  let active: ActiveProgram | null = $state(null);
  let loading = $state(true);
  let importing = $state(false);
  let importResult = $state('');

  function getApiBase(): string {
    if (typeof window === 'undefined') return 'http://localhost:3001';
    const { hostname, port, protocol } = window.location;
    if (port === '5173') return '/api';
    return `${protocol}//${hostname}${port ? ':' + port : ''}/api`;
  }

  async function loadData() {
    try {
      const [programList, activeData] = await Promise.all([
        api<Program[]>('/programs'),
        api<ActiveProgram>('/programs/active').catch(() => null),
      ]);
      programs = programList;
      active = activeData;
    } catch {
      showToast('Failed to load programs', 'error');
    } finally {
      loading = false;
    }
  }

  onMount(loadData);

  async function handlePdfImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    importing = true;
    importResult = '';
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(`${getApiBase()}/programs/import-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: buffer,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `Import failed: ${res.status}`);
      }
      const result = await res.json();
      importResult = `Imported "${result.name}" — ${result.daysImported} days, ${result.exercisesImported} exercises`;
      showToast(importResult, 'success');
      await loadData();
    } catch (err: any) {
      importResult = err.message || 'Import failed';
      showToast(importResult, 'error');
    } finally {
      importing = false;
      input.value = '';
    }
  }

  async function activate(id: number) {
    try {
      await api(`/programs/${id}/activate`, { method: 'POST' });
      showToast('Program activated', 'success');
      await loadData();
    } catch {
      showToast('Failed to activate program', 'error');
    }
  }

  async function deactivate() {
    try {
      await api('/programs/active', { method: 'DELETE' });
      active = null;
      showToast('Program deactivated', 'info');
    } catch {
      showToast('Failed to deactivate', 'error');
    }
  }

  async function deleteProgram(id: number, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await api(`/programs/${id}`, { method: 'DELETE' });
      if (active?.program.id === id) active = null;
      programs = programs.filter(p => p.id !== id);
      showToast('Program deleted', 'info');
    } catch {
      showToast('Failed to delete program', 'error');
    }
  }
</script>

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  <div class="flex items-center gap-3 mb-6">
    <a href="/generate" class="w-8 h-8 rounded-lg flex items-center justify-center bg-neutral-800 text-neutral-400 hover:text-white">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
      </svg>
    </a>
    <h1 class="text-2xl font-bold">Programs</h1>
  </div>

  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else}
    <!-- Active program banner -->
    {#if active}
      <div class="rounded-xl p-4 mb-4 border border-green-500/30" style="background-color: #22c55e08;">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-bold text-green-400 uppercase tracking-wider">Active Program</span>
          <button onclick={deactivate} class="text-xs text-neutral-500 hover:text-red-400">Deactivate</button>
        </div>
        <p class="font-medium">{active.program.name}</p>
        <p class="text-sm text-neutral-400 mt-1">
          Next: <span class="text-neutral-200">{active.day.name}</span>
          <span class="text-neutral-600 ml-2">Day {active.dayIndex + 1} of {active.totalDays}</span>
        </p>
        <a
          href="/programs/{active.program.id}"
          class="inline-block mt-2 text-sm text-green-400 hover:text-green-300"
        >View program &rarr;</a>
      </div>
    {/if}

    <!-- Import PDF -->
    <div class="rounded-xl p-4 mb-4" style="background-color: #1a1a1a;">
      <h2 class="font-medium mb-2">Import Program</h2>
      <p class="text-sm text-neutral-400 mb-3">Upload a workout PDF from muscleandstrength.com</p>
      <label class="block w-full cursor-pointer">
        <div class="py-3 px-4 rounded-lg bg-neutral-800 text-center text-neutral-300 min-h-[48px] flex items-center justify-center">
          {#if importing}
            <div class="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2"></div>
            Importing...
          {:else}
            Select PDF File
          {/if}
        </div>
        <input type="file" accept=".pdf" onchange={handlePdfImport} class="hidden" disabled={importing} />
      </label>
      {#if importResult && !importing}
        <p class="text-sm mt-2 {importResult.startsWith('Imported') ? 'text-green-400' : 'text-red-400'}">
          {importResult}
        </p>
      {/if}
    </div>

    <!-- Program list -->
    {#if programs.length === 0}
      <p class="text-neutral-500 text-center py-8">No programs imported yet</p>
    {:else}
      <div class="space-y-3">
        {#each programs as program}
          <div class="rounded-xl p-4 relative" style="background-color: #1a1a1a;">
            <a href="/programs/{program.id}" class="block">
              <div class="flex items-start justify-between">
                <div class="pr-16">
                  <p class="font-medium">{program.name}</p>
                  <p class="text-sm text-neutral-400 mt-1">
                    {program.dayCount} days{program.daysPerWeek ? ` / ${program.daysPerWeek} per week` : ''}
                    {#if program.durationWeeks}
                      <span class="text-neutral-600 ml-1">&middot; {program.durationWeeks} weeks</span>
                    {/if}
                  </p>
                  {#if program.source}
                    <p class="text-xs text-neutral-600 mt-1 truncate">{program.source}</p>
                  {/if}
                </div>
              </div>
            </a>
            <div class="absolute top-4 right-4 flex items-center gap-2">
              {#if active?.program.id === program.id}
                <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background-color: #22c55e20; color: #22c55e;">
                  Active
                </span>
              {:else}
                <button
                  onclick={() => activate(program.id)}
                  class="text-xs px-2 py-1 rounded-lg bg-neutral-700 text-neutral-300 hover:bg-green-500/20 hover:text-green-400"
                >Activate</button>
              {/if}
              <button
                onclick={() => deleteProgram(program.id, program.name)}
                class="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-600 hover:text-red-400 hover:bg-neutral-800"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
