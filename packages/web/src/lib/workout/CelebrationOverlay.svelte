<script lang="ts">
  interface Props {
    show: boolean;
    variant: 'all-done' | 'pr';
    prExerciseName?: string;
  }

  let { show, variant, prExerciseName = '' }: Props = $props();
</script>

{#if show && variant === 'all-done'}
  <div class="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center celebration-flash">
    <div class="text-6xl font-bold text-green-400 celebration-text">ALL SETS DONE!</div>
    {#each Array(20) as _, i}
      <div
        class="absolute w-2 h-2 rounded-full confetti-piece"
        style="
          left: {20 + Math.random() * 60}%;
          background-color: {['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5]};
          animation-delay: {Math.random() * 0.5}s;
        "
      ></div>
    {/each}
  </div>
{/if}

{#if show && variant === 'pr'}
  <div class="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center celebration-flash" style="animation: pr-flash-anim 2.5s ease-out forwards;">
    <div class="text-center">
      <div class="text-5xl font-bold text-amber-400 celebration-text" style="animation: celebration-text-anim 2.5s ease-out forwards;">NEW PR!</div>
      <div class="text-lg text-amber-300/80 mt-2" style="animation: celebration-text-anim 2.5s ease-out 0.2s forwards; opacity: 0;">{prExerciseName}</div>
    </div>
    {#each Array(25) as _, i}
      <div
        class="absolute w-2.5 h-2.5 rounded-full confetti-piece"
        style="
          left: {15 + Math.random() * 70}%;
          background-color: {['#f59e0b', '#fbbf24', '#d97706', '#22c55e', '#8b5cf6'][i % 5]};
          animation-delay: {Math.random() * 0.5}s;
        "
      ></div>
    {/each}
  </div>
{/if}

<style>
  @keyframes celebration-flash-anim {
    0% { background-color: rgba(34, 197, 94, 0.3); }
    50% { background-color: rgba(34, 197, 94, 0.1); }
    100% { background-color: transparent; }
  }
  @keyframes pr-flash-anim {
    0% { background-color: rgba(245, 158, 11, 0.3); }
    50% { background-color: rgba(245, 158, 11, 0.1); }
    100% { background-color: transparent; }
  }
  @keyframes celebration-text-anim {
    0% { transform: scale(0.5); opacity: 0; }
    30% { transform: scale(1.1); opacity: 1; }
    70% { transform: scale(1); opacity: 1; }
    100% { transform: scale(0.8); opacity: 0; }
  }
  @keyframes confetti-fall {
    0% { top: -10%; opacity: 1; transform: rotate(0deg); }
    100% { top: 100%; opacity: 0; transform: rotate(720deg); }
  }
  :global(.celebration-flash) {
    animation: celebration-flash-anim 2s ease-out forwards;
  }
  :global(.celebration-text) {
    animation: celebration-text-anim 2s ease-out forwards;
  }
  :global(.confetti-piece) {
    animation: confetti-fall 2s ease-in forwards;
  }
</style>
