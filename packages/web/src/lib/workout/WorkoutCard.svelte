<script lang="ts">
  import type { WorkoutDetail, WorkoutExercise, Set } from 'fitlocal-shared';
  import { CARDIO_PATTERN, deriveWorkoutType, WORKOUT_THEMES, type WorkoutType } from 'fitlocal-shared';

  interface Props {
    workout: WorkoutDetail;
  }

  let { workout }: Props = $props();

  const KG_TO_LBS = 2.20462;
  const M_TO_MI = 1 / 1609.344;

  function kgToLbs(kg: number | null): number {
    if (!kg) return 0;
    return Math.round((kg * KG_TO_LBS) / 2.5) * 2.5;
  }

  function isCardio(ex: WorkoutExercise): boolean {
    return CARDIO_PATTERN.test(ex.exercise?.name ?? '');
  }

  function isWarmupSet(s: Set): boolean {
    return !!s.isWarmup;
  }

  const TYPE_LABEL: Record<WorkoutType, string> = {
    push: 'Push',
    pull: 'Pull',
    legs: 'Legs',
    cardio: 'Cardio',
    full_body: 'Full Body',
  };

  let workoutType = $derived(deriveWorkoutType(workout.exercises));
  let theme = $derived(WORKOUT_THEMES[workoutType]);

  let dateLabel = $derived(
    new Date(workout.date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }),
  );

  // Progress across all sets (full when viewing history, live during a workout).
  let totalSets = $derived(workout.exercises.reduce((n, e) => n + (e.sets?.length ?? 0), 0));
  let completedSets = $derived(
    workout.exercises.reduce((n, e) => n + (e.sets?.filter((s) => s.completed).length ?? 0), 0),
  );
  let progressPct = $derived(totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0);

  // Any exercise with at least one warm-up set contributes to the warm-up block.
  let warmupRows = $derived(
    workout.exercises
      .map((e) => ({ name: e.exercise?.name ?? 'Exercise', sets: (e.sets ?? []).filter(isWarmupSet) }))
      .filter((r) => r.sets.length > 0),
  );

  let cardioExercises = $derived(workout.exercises.filter(isCardio));

  // Strength exercises grouped by first primary muscle; warm-up sets stripped out.
  let muscleGroups = $derived.by(() => {
    const groups = new Map<string, { name: string; sets: Set[] }[]>();
    for (const e of workout.exercises) {
      if (isCardio(e)) continue;
      const working = (e.sets ?? []).filter((s) => !isWarmupSet(s));
      if (working.length === 0) continue;
      const muscle = e.exercise?.primaryMuscles?.[0]?.toLowerCase() || 'main work';
      const key = muscle.charAt(0).toUpperCase() + muscle.slice(1);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ name: e.exercise?.name ?? 'Exercise', sets: working });
    }
    return [...groups.entries()].map(([muscle, exercises]) => ({ muscle, exercises }));
  });

  function setSummary(s: Set): string {
    const reps = s.reps ?? 0;
    if (s.weightKg && s.weightKg > 0) return `${reps} × ${kgToLbs(s.weightKg)} lb`;
    return `${reps} reps`;
  }

  function cardioSummary(s: Set): string {
    const parts: string[] = [`${s.reps ?? 0} min`];
    if (s.distanceMeters && s.distanceMeters > 0) parts.push(`${(s.distanceMeters * M_TO_MI).toFixed(2)} mi`);
    if (s.resistance) parts.push(`res ${s.resistance}`);
    return parts.join(' · ');
  }
</script>

<div
  class="workout-card rounded-2xl overflow-hidden"
  style="--accent: {theme.accent}; --secondary: {theme.secondary}; background-color: #0d0d0d;"
>
  <!-- Accent top bar -->
  <div class="h-1.5" style="background: linear-gradient(90deg, var(--accent), var(--secondary));"></div>

  <div class="p-5">
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="metadata text-xs uppercase tracking-[0.2em] text-neutral-500">
          {dateLabel}{#if workout.locationProfile} · {workout.locationProfile}{/if}
        </div>
        <h2 class="display text-3xl leading-none mt-1 text-white tracking-wide">Workout Complete</h2>
      </div>
      <span
        class="display shrink-0 text-lg leading-none px-3 py-1.5 rounded-lg tracking-wider"
        style="background-color: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent);"
      >
        {TYPE_LABEL[workoutType]}
      </span>
    </div>

    <!-- Progress bar -->
    <div class="mt-4">
      <div class="flex justify-between metadata text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">
        <span>{completedSets}/{totalSets} sets</span>
        <span>{progressPct}%</span>
      </div>
      <div class="h-2 rounded-full overflow-hidden" style="background-color: #1f1f1f;">
        <div
          class="h-full rounded-full transition-all"
          style="width: {progressPct}%; background: linear-gradient(90deg, var(--accent), var(--secondary));"
        ></div>
      </div>
    </div>

    <!-- Warm-up -->
    {#if warmupRows.length > 0}
      <section class="mt-5">
        <h3 class="metadata text-[11px] uppercase tracking-[0.2em] text-neutral-500 mb-2">Warm-up</h3>
        <div class="space-y-1">
          {#each warmupRows as row}
            <div class="flex justify-between items-baseline gap-2 text-sm">
              <span class="text-neutral-300 truncate">{row.name}</span>
              <span class="metadata text-xs text-neutral-500 shrink-0">
                {row.sets.map(setSummary).join(', ')}
              </span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Main work, grouped by muscle -->
    {#each muscleGroups as group}
      <section class="mt-5">
        <h3 class="metadata text-[11px] uppercase tracking-[0.2em] mb-2" style="color: var(--accent);">
          {group.muscle}
        </h3>
        <div class="space-y-2.5">
          {#each group.exercises as ex}
            <div>
              <div class="text-sm font-medium text-neutral-100">{ex.name}</div>
              <div class="metadata text-xs text-neutral-500 mt-0.5">
                {ex.sets.length} × {ex.sets.map(setSummary).join(', ')}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/each}

    <!-- Cardio finisher -->
    {#if cardioExercises.length > 0}
      <section class="mt-5">
        <h3 class="metadata text-[11px] uppercase tracking-[0.2em] mb-2" style="color: var(--secondary);">
          Cardio Finisher
        </h3>
        <div class="space-y-2.5">
          {#each cardioExercises as ex}
            <div>
              <div class="text-sm font-medium text-neutral-100">{ex.exercise?.name}</div>
              <div class="metadata text-xs text-neutral-500 mt-0.5">
                {(ex.sets ?? []).map(cardioSummary).join(' · ')}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Notes / goal callout -->
    {#if workout.notes}
      <div
        class="mt-5 rounded-xl p-3 text-sm text-neutral-300"
        style="background-color: color-mix(in srgb, var(--accent) 8%, #141414); border-left: 3px solid var(--accent);"
      >
        {workout.notes}
      </div>
    {/if}

    <!-- Footer branding -->
    <div class="mt-5 flex items-center justify-between">
      <span class="display text-xl tracking-wider" style="color: var(--accent);">FITLOCAL</span>
      <span class="metadata text-[10px] uppercase tracking-[0.2em] text-neutral-600">
        {workout.exercises.length} exercises
      </span>
    </div>
  </div>
</div>

<style>
  .display {
    font-family: var(--font-display);
  }
  .metadata {
    font-family: var(--font-mono);
  }
</style>
