<script lang="ts">
  import { subscribeToasts } from './toast';
  import { onDestroy } from 'svelte';

  interface ToastMessage {
    id: number;
    text: string;
    type: 'error' | 'success' | 'info';
  }

  let toasts: ToastMessage[] = $state([]);

  const unsub = subscribeToasts((t) => { toasts = t; });
  onDestroy(unsub);
</script>

{#if toasts.length > 0}
  <div class="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[90vw] max-w-md pointer-events-none">
    {#each toasts as toast (toast.id)}
      <div
        class="pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg backdrop-blur-sm animate-slide-in
          {toast.type === 'error' ? 'bg-red-500/90 text-white' : toast.type === 'success' ? 'bg-green-500/90 text-white' : 'bg-neutral-700/90 text-neutral-100'}"
      >
        {toast.text}
      </div>
    {/each}
  </div>
{/if}

<style>
  @keyframes slide-in {
    from { transform: translateY(-1rem); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  :global(.animate-slide-in) {
    animation: slide-in 0.2s ease-out;
  }
</style>
