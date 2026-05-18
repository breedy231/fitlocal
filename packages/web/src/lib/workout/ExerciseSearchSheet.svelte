<script lang="ts">
  interface SearchResult {
    id: number;
    name: string;
    primaryMuscles?: string[];
    equipment?: string[];
  }

  interface Props {
    open: boolean;
    title: string;
    query: string;
    results: SearchResult[];
    suggestions?: SearchResult[];
    onInput: (q: string) => void;
    onSelect: (result: SearchResult) => void;
    onClose: () => void;
  }

  let { open, title, query, results, suggestions = [], onInput, onSelect, onClose }: Props = $props();

  let showingSuggestions = $derived(query.length < 2 && suggestions.length > 0);
  let displayResults = $derived(showingSuggestions ? suggestions : results);
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-end justify-center"
    style="background-color: rgba(0,0,0,0.7); backdrop-filter: blur(4px);"
    onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
  >
    <div class="w-full max-w-lg rounded-t-2xl max-h-[80vh] flex flex-col" style="background-color: #242424;">
      <!-- Handle bar -->
      <div class="flex justify-center pt-3 pb-1">
        <div class="w-10 h-1 rounded-full bg-neutral-600"></div>
      </div>
      <div class="flex justify-between items-center px-5 pb-3">
        <h2 class="text-lg font-bold text-white">{title}</h2>
        <button onclick={onClose} class="w-11 h-11 flex items-center justify-center rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors touch-manipulation" aria-label="Close search">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
      <div class="px-5 pb-3">
        <input
          type="text"
          placeholder="Search exercises..."
          value={query}
          oninput={(e) => onInput(e.currentTarget.value)}
          class="w-full px-4 py-3.5 rounded-xl text-base text-white placeholder-neutral-500 border border-neutral-700 outline-none focus:border-green-500/50 transition-colors"
          style="background-color: #1a1a1a;"
          autofocus
        />
      </div>
      <div class="flex-1 overflow-y-auto px-5 pb-6" style="-webkit-overflow-scrolling: touch;">
        {#if displayResults.length > 0}
          {#if showingSuggestions}
            <p class="text-xs text-neutral-500 mb-2 px-1">Suggested — same muscle group</p>
          {/if}
          <div class="space-y-0.5">
            {#each displayResults as result}
              <button
                onclick={() => onSelect(result)}
                class="w-full text-left min-h-[56px] px-4 py-3.5 rounded-xl hover:bg-neutral-700/50 active:bg-neutral-700 transition-colors touch-manipulation"
              >
                <div class="font-medium text-[15px] text-white">{result.name}</div>
                {#if result.primaryMuscles && Array.isArray(result.primaryMuscles) && result.primaryMuscles.length > 0}
                  <div class="text-xs text-neutral-400 mt-0.5">{result.primaryMuscles.join(', ')}</div>
                {:else if result.equipment && Array.isArray(result.equipment) && result.equipment.length > 0}
                  <div class="text-xs text-neutral-500 mt-0.5">{result.equipment.join(', ')}</div>
                {/if}
              </button>
            {/each}
          </div>
        {:else if query.length >= 2}
          <p class="text-neutral-500 text-sm text-center py-8">No exercises found</p>
        {:else}
          <p class="text-neutral-600 text-sm text-center py-8">Type to search exercises</p>
        {/if}
      </div>
    </div>
  </div>
{/if}
