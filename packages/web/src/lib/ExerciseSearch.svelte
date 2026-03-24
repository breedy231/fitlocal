<script lang="ts">
  import { api } from '$lib/api';

  interface Exercise {
    id: number;
    name: string;
    primaryMuscles: string[];
    equipment: string[];
  }

  let {
    visible = $bindable(false),
    onselect,
  }: {
    visible: boolean;
    onselect: (exercise: Exercise) => void;
  } = $props();

  let query = $state('');
  let results: Exercise[] = $state([]);
  let searching = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (visible) {
      query = '';
      results = [];
    }
  });

  function handleInput(value: string) {
    query = value;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!value.trim()) {
      results = [];
      return;
    }
    debounceTimer = setTimeout(async () => {
      searching = true;
      try {
        results = await api<Exercise[]>(`/exercises/search?q=${encodeURIComponent(value.trim())}`);
      } catch {
        results = [];
      } finally {
        searching = false;
      }
    }, 300);
  }

  function select(exercise: Exercise) {
    onselect(exercise);
    visible = false;
  }

  function close() {
    visible = false;
  }

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-end justify-center"
    style="background-color: rgba(0,0,0,0.6); backdrop-filter: blur(4px);"
    onclick={handleBackdrop}
  >
    <div
      class="w-full max-w-lg rounded-t-2xl overflow-hidden flex flex-col"
      style="background-color: #1a1a1a; max-height: 80vh;"
    >
      <!-- Handle bar -->
      <div class="flex justify-center pt-3 pb-2">
        <div class="w-10 h-1 rounded-full bg-neutral-600"></div>
      </div>

      <div class="px-4 pb-3 flex items-center justify-between">
        <h3 class="text-lg font-semibold">Add Exercise</h3>
        <button onclick={close} class="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-white">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      <!-- Search input -->
      <div class="px-4 pb-3">
        <input
          type="text"
          placeholder="Search exercises..."
          value={query}
          oninput={(e) => handleInput(e.currentTarget.value)}
          class="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-neutral-500 border-none outline-none"
          style="background-color: #2a2a2a;"
          autofocus
        />
      </div>

      <!-- Results -->
      <div class="flex-1 overflow-y-auto px-4 pb-6">
        {#if searching}
          <div class="flex justify-center py-8">
            <div class="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        {:else if results.length === 0 && query.trim()}
          <p class="text-center text-neutral-500 py-8 text-sm">No exercises found</p>
        {:else}
          <div class="space-y-1">
            {#each results as exercise}
              <button
                onclick={() => select(exercise)}
                class="w-full text-left px-4 py-3 rounded-xl hover:bg-neutral-800 transition-colors"
              >
                <div class="font-medium text-sm">{exercise.name}</div>
                {#if exercise.primaryMuscles?.length}
                  <div class="text-xs text-neutral-500 mt-0.5">{exercise.primaryMuscles.join(', ')}</div>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
