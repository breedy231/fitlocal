<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { showToast } from '$lib/toast';
  import {
    INJURY_PATTERNS,
    INJURY_PATTERN_LABELS,
    INJURY_MUSCLES,
    type InjuryPattern,
    type InjuryRestriction,
    type InjuryPreview,
  } from 'fitlocal-shared';

  interface ExerciseResult { id: number; name: string }

  let active: InjuryRestriction | null = $state(null);
  let loaded = $state(false);
  let saving = $state(false);

  let label = $state('');
  let notes = $state('');
  let patterns: InjuryPattern[] = $state([]);
  let muscles: string[] = $state([]);
  let avoidList: ExerciseResult[] = $state([]);
  let allowList: ExerciseResult[] = $state([]);

  let preview: InjuryPreview['excluded'] = $state([]);
  let showPreview = $state(false);

  let search = $state('');
  let searchResults: ExerciseResult[] = $state([]);
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  let previewTimeout: ReturnType<typeof setTimeout> | null = null;

  async function namesFor(ids: number[]): Promise<ExerciseResult[]> {
    const rows = await Promise.all(ids.map(id => api<ExerciseResult>(`/exercises/${id}`).catch(() => null)));
    return rows.filter((r): r is ExerciseResult => r !== null).map(r => ({ id: r.id, name: r.name }));
  }

  function fill(r: InjuryRestriction | null) {
    label = r?.label ?? '';
    notes = r?.notes ?? '';
    patterns = r ? [...r.avoidPatterns] : [];
    muscles = r ? [...r.avoidMuscles] : [];
  }

  onMount(async () => {
    try {
      active = await api<InjuryRestriction | null>('/injury');
      fill(active);
      if (active) {
        [avoidList, allowList] = await Promise.all([namesFor(active.avoidExerciseIds), namesFor(active.allowExerciseIds)]);
      }
    } catch { /* offline — card stays empty */ }
    loaded = true;
    refreshPreview();
  });

  function rules() {
    return {
      avoidPatterns: patterns,
      avoidMuscles: muscles,
      avoidExerciseIds: avoidList.map(e => e.id),
      allowExerciseIds: allowList.map(e => e.id),
    };
  }

  function refreshPreview() {
    if (previewTimeout) clearTimeout(previewTimeout);
    previewTimeout = setTimeout(async () => {
      try {
        const res = await api<InjuryPreview>('/injury/preview', { method: 'POST', body: JSON.stringify(rules()) });
        preview = res.excluded;
      } catch { /* keep last preview */ }
    }, 250);
  }

  function togglePattern(p: InjuryPattern) {
    patterns = patterns.includes(p) ? patterns.filter(x => x !== p) : [...patterns, p];
    refreshPreview();
  }

  function toggleMuscle(m: string) {
    muscles = muscles.includes(m) ? muscles.filter(x => x !== m) : [...muscles, m];
    refreshPreview();
  }

  async function runSearch(q: string) {
    if (!q.trim()) { searchResults = []; return; }
    try {
      searchResults = await api<ExerciseResult[]>(`/exercises/search?q=${encodeURIComponent(q)}`);
    } catch { searchResults = []; }
  }

  function addTo(list: 'avoid' | 'allow', ex: ExerciseResult) {
    const item = { id: ex.id, name: ex.name };
    // An exercise lives in at most one list.
    avoidList = avoidList.filter(e => e.id !== ex.id);
    allowList = allowList.filter(e => e.id !== ex.id);
    if (list === 'avoid') avoidList = [...avoidList, item];
    else allowList = [...allowList, item];
    search = '';
    searchResults = [];
    refreshPreview();
  }

  function removeFrom(list: 'avoid' | 'allow', id: number) {
    if (list === 'avoid') avoidList = avoidList.filter(e => e.id !== id);
    else allowList = allowList.filter(e => e.id !== id);
    refreshPreview();
  }

  async function save() {
    if (!label.trim()) { showToast('Give the injury a name', 'error'); return; }
    saving = true;
    try {
      active = await api<InjuryRestriction>('/injury', {
        method: 'PUT',
        body: JSON.stringify({ label: label.trim(), notes: notes.trim() || null, ...rules() }),
      });
      showToast('Injury restrictions saved', 'success');
    } catch {
      showToast('Failed to save injury restrictions', 'error');
    } finally {
      saving = false;
    }
  }

  async function clearInjury() {
    if (!confirm('Clear this injury? Generated workouts go back to the full exercise catalog.')) return;
    saving = true;
    try {
      await api('/injury', { method: 'DELETE' });
      active = null;
      fill(null);
      avoidList = [];
      allowList = [];
      refreshPreview();
      showToast('Injury cleared', 'success');
    } catch {
      showToast('Failed to clear injury', 'error');
    } finally {
      saving = false;
    }
  }
</script>

<div class="rounded-xl p-4" style="background-color: #1a1a1a;">
  <div class="flex items-center justify-between mb-1">
    <h2 class="font-medium">Injury Restrictions</h2>
    {#if active}
      <span class="text-xs px-2 py-1 rounded-full bg-amber-900/60 text-amber-300">Active since {active.startedAt.slice(0, 10)}</span>
    {/if}
  </div>
  <p class="text-sm text-neutral-400 mb-4">
    Exercises matching these rules are removed from generated workouts, program days and swap suggestions. Your own routines are left alone.
  </p>

  {#if !loaded}
    <p class="text-sm text-neutral-500">Loading…</p>
  {:else}
    <div class="space-y-4">
      <input
        type="text"
        bind:value={label}
        placeholder="Injury (e.g. Neck / upper back)"
        class="w-full px-3 py-3 rounded-lg bg-neutral-800 text-neutral-200 text-sm border-none outline-none"
      />
      <textarea
        bind:value={notes}
        rows="3"
        placeholder="PT notes (optional)"
        class="w-full px-3 py-2 rounded-lg bg-neutral-800 text-neutral-200 text-sm border-none outline-none"
      ></textarea>

      <div>
        <p class="text-xs uppercase tracking-wide text-neutral-500 mb-2">Avoid movements</p>
        <div class="space-y-2">
          {#each INJURY_PATTERNS as p (p)}
            <button
              onclick={() => togglePattern(p)}
              class="w-full text-left px-3 py-3 rounded-lg text-sm min-h-[44px] flex items-start gap-3 {patterns.includes(p) ? 'bg-red-950/60 text-red-200' : 'bg-neutral-800 text-neutral-300'}"
            >
              <span class="mt-0.5 shrink-0 w-4 h-4 rounded border {patterns.includes(p) ? 'bg-red-500 border-red-500' : 'border-neutral-500'}"></span>
              <span>{INJURY_PATTERN_LABELS[p]}</span>
            </button>
          {/each}
        </div>
      </div>

      <div>
        <p class="text-xs uppercase tracking-wide text-neutral-500 mb-2">Avoid muscles</p>
        <div class="flex flex-wrap gap-2">
          {#each INJURY_MUSCLES as m (m)}
            <button
              onclick={() => toggleMuscle(m)}
              class="px-3 rounded-full text-sm min-h-[44px] capitalize {muscles.includes(m) ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-300'}"
            >{m}</button>
          {/each}
        </div>
      </div>

      <div>
        <p class="text-xs uppercase tracking-wide text-neutral-500 mb-2">Specific exercises</p>
        <input
          type="text"
          bind:value={search}
          oninput={(e) => {
            const q = (e.target as HTMLInputElement).value;
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => runSearch(q), 300);
          }}
          placeholder="Search exercises to avoid or allow…"
          class="w-full px-3 py-3 rounded-lg bg-neutral-800 text-neutral-200 text-sm border-none outline-none mb-2"
        />
        {#if searchResults.length > 0}
          <div class="rounded-lg bg-neutral-800 mb-3 max-h-56 overflow-y-auto">
            {#each searchResults as ex (ex.id)}
              <div class="flex items-center justify-between px-3 py-1 text-sm text-neutral-300">
                <span class="py-2">{ex.name}</span>
                <span class="flex gap-1 shrink-0">
                  <button onclick={() => addTo('avoid', ex)} class="px-3 min-h-[44px] text-xs text-red-400">Avoid</button>
                  <button onclick={() => addTo('allow', ex)} class="px-3 min-h-[44px] text-xs text-green-400">Allow</button>
                </span>
              </div>
            {/each}
          </div>
        {/if}
        {#each [{ key: 'avoid', title: 'Always avoid', items: avoidList, tone: 'text-red-300' }, { key: 'allow', title: 'Always allow (overrides the rules above)', items: allowList, tone: 'text-green-300' }] as group (group.key)}
          {#if group.items.length > 0}
            <p class="text-xs text-neutral-500 mt-2 mb-1">{group.title}</p>
            <div class="space-y-1">
              {#each group.items as ex (ex.id)}
                <div class="flex items-center justify-between px-3 rounded-lg bg-neutral-800">
                  <span class="text-sm {group.tone} py-2">{ex.name}</span>
                  <button
                    onclick={() => removeFrom(group.key as 'avoid' | 'allow', ex.id)}
                    class="text-xs text-neutral-400 px-2 min-h-[44px]"
                  >Remove</button>
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      </div>

      <div>
        <button
          onclick={() => (showPreview = !showPreview)}
          class="w-full text-left text-sm text-neutral-300 min-h-[44px] flex justify-between items-center"
        >
          <span>{preview.length} exercise{preview.length === 1 ? '' : 's'} removed</span>
          <span class="text-neutral-500">{showPreview ? 'Hide' : 'Show'}</span>
        </button>
        {#if showPreview}
          <div class="rounded-lg bg-neutral-800 max-h-72 overflow-y-auto">
            {#each preview as ex (ex.id)}
              <div class="px-3 py-2 text-sm border-b border-neutral-700/50 last:border-0">
                <div class="text-neutral-200">{ex.name}</div>
                <div class="text-xs text-neutral-500">{ex.reasons.join(' · ')}</div>
              </div>
            {:else}
              <p class="px-3 py-2 text-sm text-neutral-500">Nothing removed</p>
            {/each}
          </div>
        {/if}
      </div>

      <div class="flex gap-2">
        <button
          onclick={save}
          disabled={saving}
          class="flex-1 py-3 px-4 rounded-lg bg-green-600 text-white font-medium text-sm min-h-[48px] disabled:opacity-50"
        >{saving ? 'Saving…' : active ? 'Update Restrictions' : 'Save Restrictions'}</button>
        {#if active}
          <button
            onclick={clearInjury}
            disabled={saving}
            class="py-3 px-4 rounded-lg bg-neutral-800 text-neutral-300 text-sm min-h-[48px] disabled:opacity-50"
          >Clear</button>
        {/if}
      </div>
    </div>
  {/if}
</div>
