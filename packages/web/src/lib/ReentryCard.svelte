<script lang="ts">
  import Expandable from '$lib/Expandable.svelte';
  import { cachedGet } from '$lib/api-cache.svelte';
  import { formatTimeOff, type ReentryResponse } from 'fitlocal-shared';

  // Return-to-training plan (inferred defaults) + the PT restriction, in one place.
  // Renders nothing when there's neither an active return plan nor an injury.
  const reentry = cachedGet<ReentryResponse>('/reentry');
  let expanded = $state(false);

  let status = $derived(reentry.data?.status ?? null);
  let injury = $derived(reentry.data?.injury ?? null);

  // Stored YYYY-MM-DD parsed at local noon (CLAUDE.md: never bare new Date(date)).
  function shortDate(d: string): string {
    return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  let headline = $derived(
    status
      ? `Back from ${formatTimeOff(status.gapDays)} off · ${status.phase.name} wk ${status.week}/${status.totalWeeks}`
      : injury ? `PT restriction: ${injury.label}` : ''
  );
  let avoidList = $derived(
    injury ? [...injury.avoid.map(a => a.split(' — ')[0]), ...injury.avoidMuscles, ...injury.avoidExercises] : []
  );
</script>

{#if status || injury}
  <div class="rounded-xl p-4 border border-sky-500/30" style="background-color: #0c1a2a;">
    <button class="w-full min-h-[44px] text-left" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
      <div class="flex items-center justify-between gap-2">
        <div>
          <h3 class="text-sm font-medium text-sky-300">{headline}</h3>
          {#if status}
            <p class="text-xs text-neutral-400 mt-0.5">
              {status.phase.rir}{injury ? ` · ${injury.label} restriction on` : ''}
            </p>
          {/if}
        </div>
        <span class="text-neutral-500 text-xs">{expanded ? '▲' : '▼'}</span>
      </div>
    </button>

    <Expandable {expanded}>
      <div class="mt-3 pt-3 border-t border-neutral-800 space-y-2 text-sm text-neutral-300 leading-relaxed">
        {#if status}
          <p>
            <span class="text-neutral-500">Time off:</span>
            {formatTimeOff(status.gapDays)} since {shortDate(status.lastBeforeGap)}.
            {#if status.returnDate}
              Back since {shortDate(status.returnDate)} ({status.sessionsSinceReturn} session{status.sessionsSinceReturn === 1 ? '' : 's'}).
            {:else}
              Next session is your first one back.
            {/if}
          </p>
          <p><span class="text-neutral-500">Effort:</span> {status.phase.rir}.</p>
          <p><span class="text-neutral-500">Load:</span> {status.phase.load}</p>
          <p><span class="text-neutral-500">Progression:</span> {status.phase.progression}</p>
          <p><span class="text-neutral-500">Symptoms:</span> {status.symptomRule}</p>
        {/if}
        {#if injury}
          <p>
            <span class="text-neutral-500">PT ({injury.label}) — avoid:</span>
            {avoidList.length ? avoidList.join('; ') : 'see notes'}.
          </p>
          {#if injury.notes}
            <p><span class="text-neutral-500">PT notes:</span> {injury.notes}</p>
          {/if}
        {/if}
        {#if status}
          <p class="text-xs text-neutral-500">Effort, load and progression steps are inferred defaults, not from your PT.</p>
        {/if}
      </div>
    </Expandable>
  </div>
{/if}
