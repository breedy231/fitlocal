<script lang="ts">
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { cachedGet } from '$lib/api-cache.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { showToast } from '$lib/toast';
  import type { ProgramDetail } from 'fitlocal-shared';

  const activeCache = cachedGet<{ program: { id: number } }>('/programs/active');
  let program: ProgramDetail | null = $state(null);
  let isActive = $derived.by(() => {
    const a = activeCache.data;
    return a != null && program != null && a.program.id === program.id;
  });
  let loading = $state(true);

  onMount(async () => {
    const id = $page.params.id;
    try {
      program = await api<ProgramDetail>(`/programs/${id}`);
    } catch {
      showToast('Failed to load program', 'error');
    } finally {
      loading = false;
    }
  });

  async function activate() {
    if (!program) return;
    try {
      await api(`/programs/${program.id}/activate`, { method: 'POST' });
      isActive = true;
      showToast('Program activated', 'success');
    } catch {
      showToast('Failed to activate', 'error');
    }
  }

  async function deactivate() {
    try {
      await api('/programs/active', { method: 'DELETE' });
      isActive = false;
      showToast('Program deactivated', 'info');
    } catch {
      showToast('Failed to deactivate', 'error');
    }
  }

  async function deleteProgram() {
    if (!program || !confirm(`Delete "${program.name}"? This cannot be undone.`)) return;
    try {
      await api(`/programs/${program.id}`, { method: 'DELETE' });
      showToast('Program deleted', 'info');
      goto('/programs');
    } catch {
      showToast('Failed to delete', 'error');
    }
  }

  function formatRest(seconds: number | null): string {
    if (!seconds) return '';
    if (seconds >= 60) return `${Math.round(seconds / 60)}m rest`;
    return `${seconds}s rest`;
  }
</script>

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if program}
    <!-- Header -->
    <div class="flex items-center gap-3 mb-2">
      <a href="/programs" class="w-8 h-8 rounded-lg flex items-center justify-center bg-neutral-800 text-neutral-400 hover:text-white">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
        </svg>
      </a>
      <h1 class="text-2xl font-bold flex-1">{program.name}</h1>
    </div>

    <!-- Metadata -->
    <div class="text-sm text-neutral-400 mb-4 ml-11">
      {#if program.daysPerWeek}
        <span>{program.daysPerWeek} days/week</span>
      {/if}
      {#if program.durationWeeks}
        <span class="ml-2">&middot; {program.durationWeeks} weeks</span>
      {/if}
      {#if program.source}
        <p class="text-xs text-neutral-600 mt-1 truncate">{program.source}</p>
      {/if}
    </div>

    <!-- Activate / Deactivate -->
    {#if isActive}
      <button
        onclick={deactivate}
        class="w-full py-3 rounded-xl text-sm font-medium bg-neutral-800 text-neutral-300 mb-4 min-h-[48px]"
      >Deactivate Program</button>
    {:else}
      <button
        onclick={activate}
        class="w-full py-3 rounded-xl text-sm font-semibold mb-4 min-h-[48px]"
        style="background-color: #22c55e; color: #0f0f0f;"
      >Activate Program</button>
    {/if}

    <!-- Days -->
    <div class="space-y-4">
      {#each program.days as day, idx}
        <div class="rounded-xl overflow-hidden" style="background-color: #1a1a1a;">
          <div class="px-4 py-3 border-b border-neutral-800">
            <div class="flex items-center justify-between">
              <span class="font-medium">{day.name}</span>
              <span class="text-xs text-neutral-600">Day {idx + 1}</span>
            </div>
            {#if day.musclesFocus}
              <p class="text-xs text-neutral-500 mt-0.5">{day.musclesFocus}</p>
            {/if}
          </div>
          <div class="divide-y divide-neutral-800/50">
            {#each day.exercises as ex}
              <div class="px-4 py-2.5">
                <div class="flex items-start justify-between">
                  <p class="text-sm text-neutral-200">{ex.exerciseName}</p>
                  <div class="text-xs text-neutral-500 text-right shrink-0 ml-3">
                    {#if ex.targetSets && ex.targetReps}
                      <span>{ex.targetSets} &times; {ex.targetReps}</span>
                    {/if}
                    {#if ex.restSeconds}
                      <span class="ml-1.5 text-neutral-600">{formatRest(ex.restSeconds)}</span>
                    {/if}
                  </div>
                </div>
                {#if ex.notes}
                  <p class="text-xs text-neutral-600 mt-0.5">{ex.notes}</p>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <!-- Delete -->
    <button
      onclick={deleteProgram}
      class="w-full py-3 mt-6 rounded-xl text-sm text-red-400 hover:text-red-300 bg-neutral-800/50 min-h-[48px]"
    >Delete Program</button>
  {/if}
</div>
