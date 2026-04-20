<script lang="ts">
  import { cachedGet } from '$lib/api-cache.svelte';

  interface Achievement {
    key: string;
    name: string;
    description: string;
    icon: string;
    unlockedAt: string | null;
  }

  const cache = cachedGet<{ total: number; unlocked: number; achievements: Achievement[] }>('/achievements');
  let data = $derived(cache.data);
  let achievements = $derived(data?.achievements ?? []);
  let loading = $derived(cache.loading);

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
</script>

<div class="p-4 max-w-lg md:max-w-2xl mx-auto">
  <div class="flex items-center gap-3 mb-6">
    <a href="/" class="w-8 h-8 rounded-lg flex items-center justify-center bg-neutral-800 text-neutral-400 hover:text-white">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
      </svg>
    </a>
    <h1 class="text-2xl font-bold">Achievements</h1>
    {#if data}
      <span class="text-sm text-neutral-500 ml-auto">{data.unlocked} / {data.total}</span>
    {/if}
  </div>

  {#if loading}
    <div class="flex justify-center py-12">
      <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else}
    <div class="grid grid-cols-3 gap-3">
      {#each achievements as achievement}
        {@const unlocked = !!achievement.unlockedAt}
        <div
          class="rounded-xl p-3 text-center transition-opacity {unlocked ? '' : 'opacity-30'}"
          style="background-color: #1a1a1a;"
          title={unlocked ? `Unlocked ${formatDate(achievement.unlockedAt!)}` : achievement.description}
        >
          <div class="text-3xl mb-1.5">{achievement.icon}</div>
          <p class="text-[11px] font-medium text-neutral-200 leading-tight">{achievement.name}</p>
          <p class="text-[9px] text-neutral-500 mt-0.5 leading-tight">{achievement.description}</p>
          {#if unlocked}
            <p class="text-[8px] text-green-500 mt-1">{formatDate(achievement.unlockedAt!)}</p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
