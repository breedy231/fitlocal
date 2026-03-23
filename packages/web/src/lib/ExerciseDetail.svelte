<script lang="ts">
  import { api } from '$lib/api';

  interface ExerciseInfo {
    id: number;
    name: string;
    description: string | null;
    imageUrl: string | null;
    primaryMuscles: string[];
    secondaryMuscles: string[];
    equipment: string[];
  }

  let {
    exerciseId = $bindable(null),
  }: {
    exerciseId: number | null;
  } = $props();

  let exercise: ExerciseInfo | null = $state(null);
  let loading = $state(false);
  let visible = $state(false);

  $effect(() => {
    if (exerciseId) {
      open(exerciseId);
    }
  });

  async function open(id: number) {
    loading = true;
    exercise = null;
    visible = true;
    try {
      exercise = await api<ExerciseInfo>(`/exercises/${id}`);
    } catch {
      exercise = null;
    } finally {
      loading = false;
    }
  }

  function close() {
    visible = false;
    exerciseId = null;
    exercise = null;
  }

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  const muscleColors: Record<string, string> = {
    chest: '#ef4444',
    back: '#3b82f6',
    shoulders: '#f59e0b',
    biceps: '#8b5cf6',
    triceps: '#ec4899',
    forearms: '#6366f1',
    quads: '#22c55e',
    hamstrings: '#14b8a6',
    glutes: '#f97316',
    calves: '#06b6d4',
    core: '#eab308',
    abs: '#eab308',
    cardio: '#ef4444',
    lats: '#3b82f6',
    traps: '#6366f1',
  };

  function getMuscleColor(muscle: string): string {
    const key = muscle.toLowerCase();
    for (const [name, color] of Object.entries(muscleColors)) {
      if (key.includes(name)) return color;
    }
    return '#6b7280';
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-end justify-center"
    style="background-color: rgba(0,0,0,0.6); backdrop-filter: blur(4px);"
    onclick={handleBackdrop}
  >
    <div
      class="w-full max-w-lg rounded-t-2xl overflow-hidden max-h-[85vh] flex flex-col"
      style="background-color: #1a1a1a;"
    >
      <!-- Handle bar -->
      <div class="flex justify-center pt-3 pb-2">
        <div class="w-10 h-1 rounded-full bg-neutral-600"></div>
      </div>

      <!-- Close button -->
      <div class="flex justify-end px-4">
        <button onclick={close} class="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-white">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      {#if loading}
        <div class="flex justify-center py-16">
          <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      {:else if exercise}
        <div class="overflow-y-auto px-5 pb-8 space-y-5">
          <!-- Image -->
          {#if exercise.imageUrl}
            <div class="rounded-xl overflow-hidden bg-neutral-900">
              <img
                src={exercise.imageUrl}
                alt={exercise.name}
                class="w-full h-48 object-contain"
              />
            </div>
          {:else}
            <div class="rounded-xl bg-neutral-900 h-32 flex items-center justify-center">
              <svg class="w-16 h-16 text-neutral-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
              </svg>
            </div>
          {/if}

          <!-- Name -->
          <h2 class="text-xl font-bold">{exercise.name}</h2>

          <!-- Muscles -->
          {#if exercise.primaryMuscles?.length || exercise.secondaryMuscles?.length}
            <div class="space-y-2">
              {#if exercise.primaryMuscles?.length}
                <div class="flex flex-wrap gap-2">
                  {#each exercise.primaryMuscles as muscle}
                    <span
                      class="text-xs font-medium px-2.5 py-1 rounded-full"
                      style="background-color: {getMuscleColor(muscle)}20; color: {getMuscleColor(muscle)};"
                    >
                      {muscle}
                    </span>
                  {/each}
                </div>
              {/if}
              {#if exercise.secondaryMuscles?.length}
                <div class="flex flex-wrap gap-2">
                  {#each exercise.secondaryMuscles as muscle}
                    <span
                      class="text-xs px-2.5 py-1 rounded-full border"
                      style="border-color: {getMuscleColor(muscle)}40; color: {getMuscleColor(muscle)}80;"
                    >
                      {muscle}
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          <!-- Equipment -->
          {#if exercise.equipment?.length}
            <div>
              <span class="text-xs text-neutral-500 uppercase tracking-wider">Equipment</span>
              <p class="text-sm text-neutral-300 mt-1">{exercise.equipment.join(', ')}</p>
            </div>
          {/if}

          <!-- Description -->
          <div>
            <span class="text-xs text-neutral-500 uppercase tracking-wider">Instructions</span>
            <p class="text-sm text-neutral-300 mt-1 leading-relaxed">
              {exercise.description || 'No description available'}
            </p>
          </div>
        </div>
      {:else}
        <div class="flex justify-center py-16 text-neutral-500">
          Could not load exercise details
        </div>
      {/if}
    </div>
  </div>
{/if}
