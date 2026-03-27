<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  let { children } = $props();

  function isActive(href: string): boolean {
    const path = $page.url.pathname;
    if (href === '/') return path === '/';
    return path.startsWith(href);
  }
</script>

<div class="min-h-screen flex flex-col" style="background-color: #0f0f0f;">
  <main class="flex-1 pb-24">
    {@render children()}
  </main>

  <nav class="fixed bottom-0 left-0 right-0 border-t border-neutral-800 safe-area-pb" style="background-color: #1a1a1a;">
    <div class="flex justify-around items-center max-w-lg mx-auto" style="min-height: 64px;">
      <a href="/" class="flex flex-col items-center justify-center gap-1 text-xs min-h-[48px] min-w-[48px] px-3 {isActive('/') ? 'text-green-400' : 'text-neutral-500'}">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"></path></svg>
        Home
      </a>
      <a href="/generate" class="flex flex-col items-center justify-center gap-1 text-xs min-h-[48px] min-w-[48px] px-3 {isActive('/generate') ? 'text-green-400' : 'text-neutral-500'}">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
        Generate
      </a>
      <a href="/log" class="flex flex-col items-center justify-center gap-1 text-xs min-h-[48px] min-w-[48px] px-3 {isActive('/log') ? 'text-green-400' : 'text-neutral-500'}">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
        Log
      </a>
      <a href="/reports" class="flex flex-col items-center justify-center gap-1 text-xs min-h-[48px] min-w-[48px] px-3 {isActive('/reports') ? 'text-green-400' : 'text-neutral-500'}">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
        Reports
      </a>
      <a href="/history" class="flex flex-col items-center justify-center gap-1 text-xs min-h-[48px] min-w-[48px] px-3 {isActive('/history') ? 'text-green-400' : 'text-neutral-500'}">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        History
      </a>
    </div>
  </nav>
</div>

<style>
  .safe-area-pb {
    padding-bottom: env(safe-area-inset-bottom);
  }
</style>
