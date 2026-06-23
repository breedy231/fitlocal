<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import Toast from '$lib/Toast.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { onQueueChange } from '$lib/offline-queue';
  let { children } = $props();

  let isOffline = $state(false);
  let queuedCount = $state(0);

  let unsubQueue: (() => void) | null = null;

  onMount(() => {
    isOffline = !navigator.onLine;
    const goOffline = () => { isOffline = true; };
    const goOnline = () => { isOffline = false; };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    unsubQueue = onQueueChange((count) => { queuedCount = count; });
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  });

  onDestroy(() => {
    unsubQueue?.();
  });

  function isActive(href: string): boolean {
    const path = $page.url.pathname;
    if (href === '/') return path === '/';
    return path.startsWith(href);
  }

  const navItems = [
    { href: '/', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z' },
    { href: '/generate', label: 'Generate', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { href: '/log', label: 'Log', icon: 'M12 4v16m8-8H4' },
    { href: '/reports', label: 'Reports', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    { href: '/assistant', label: 'Coach', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z' },
    { href: '/history', label: 'History', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  ];
</script>

<div class="min-h-screen flex flex-col" style="background-color: #0f0f0f;">
  <!-- Settings gear: mobile only (floating overlay) -->
  <a
    href="/settings"
    class="md:hidden fixed top-3 right-4 z-20 p-2 rounded-full text-neutral-600 hover:text-neutral-300 transition-colors"
    aria-label="Settings"
    style="background-color: rgba(15,15,15,0.7); backdrop-filter: blur(4px);"
  >
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
    </svg>
  </a>

  <!-- Desktop sidebar nav -->
  <aside class="hidden md:flex fixed left-0 top-0 bottom-0 w-[200px] flex-col z-30 border-r border-neutral-800" style="background-color: #1a1a1a;">
    <div class="px-5 py-5">
      <span class="text-lg font-bold text-green-400">FitLocal</span>
    </div>
    <nav class="flex-1 flex flex-col gap-1 px-3">
      {#each navItems as item}
        <a
          href={item.href}
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors {isActive(item.href) ? 'text-green-400 bg-green-500/10' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}"
        >
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.icon}></path></svg>
          {item.label}
        </a>
      {/each}
    </nav>
    <div class="px-3 pb-4">
      <a
        href="/settings"
        class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors {isActive('/settings') ? 'text-green-400 bg-green-500/10' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}"
      >
        <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
        </svg>
        Settings
      </a>
    </div>
  </aside>

  {#if isOffline}
    <div class="md:ml-[200px] flex items-center justify-center gap-2 text-xs py-1.5 bg-amber-600/20 text-amber-400 border-b border-amber-600/30">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728M8.464 15.536a5 5 0 010-7.072M15.536 8.464a5 5 0 010 7.072"></path></svg>
      Offline{queuedCount > 0 ? ` · ${queuedCount} queued` : ''}
    </div>
  {/if}

  <main class="flex-1 pb-32 md:pb-0 md:ml-[200px]">
    {@render children()}
  </main>

  <Toast />

  <!-- Mobile bottom nav -->
  <nav class="md:hidden fixed bottom-0 left-0 right-0 border-t border-neutral-800 safe-area-pb" style="background-color: #1a1a1a;">
    <div class="flex justify-around items-center max-w-lg mx-auto" style="min-height: 64px;">
      {#each navItems as item}
        <a href={item.href} class="flex flex-col items-center justify-center gap-1 text-xs min-h-[48px] min-w-[48px] px-2 {isActive(item.href) ? 'text-green-400' : 'text-neutral-500'}">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.icon}></path></svg>
          {item.label}
        </a>
      {/each}
    </div>
  </nav>
</div>

<style>
  .safe-area-pb {
    padding-bottom: env(safe-area-inset-bottom);
  }
</style>
