<script lang="ts">
  // Small "Apple Health" chip shown on Apple-ingested workouts/sets (#93).
  interface Props {
    /** when true, render just the glyph without the text label (tight rows). */
    compact?: boolean;
  }

  let { compact = false }: Props = $props();
</script>

<span
  class="inline-flex items-center gap-1 rounded-full bg-neutral-800 text-neutral-400 align-middle {compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5'}"
  title="Imported from Apple Health"
>
  <!-- Apple glyph -->
  <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.02-3.77-2.05-1.6-.16-3.13.94-3.94.94-.82 0-2.07-.92-3.41-.9-1.75.03-3.37 1.02-4.27 2.59-1.83 3.17-.47 7.85 1.31 10.42.87 1.26 1.9 2.66 3.25 2.61 1.31-.05 1.8-.84 3.38-.84 1.57 0 2.02.84 3.4.82 1.4-.03 2.29-1.28 3.14-2.54.99-1.45 1.4-2.86 1.42-2.93-.03-.01-2.72-1.04-2.75-4.13M14.6 4.42c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.09 3.18 1.15.09 2.32-.58 3.04-1.45"/>
  </svg>
  {#if !compact}<span class="text-[10px] font-medium leading-none">Apple Health</span>{/if}
</span>
