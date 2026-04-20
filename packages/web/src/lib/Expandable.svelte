<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    expanded: boolean;
    children: Snippet;
  }

  let { expanded, children }: Props = $props();
</script>

<div
  class="grid transition-[grid-template-rows] duration-300 ease-out"
  style="grid-template-rows: {expanded ? '1fr' : '0fr'};"
>
  <div class="overflow-hidden">
    {@render children()}
  </div>
</div>
