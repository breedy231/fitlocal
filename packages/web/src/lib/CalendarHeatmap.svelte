<script lang="ts">
  interface DayData {
    date: string;
    workoutCount: number;
    totalSets: number;
    primaryMuscles: string[];
  }

  interface Props {
    year: number;
    month: number;
    days: DayData[];
    onNavigate: (year: number, month: number) => void;
    onDayClick?: (date: string) => void;
  }

  let { year, month, days, onNavigate, onDayClick }: Props = $props();

  const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let dayMap = $derived(new Map(days.map(d => [d.date, d])));
  let maxSets = $derived(Math.max(1, ...days.map(d => d.totalSets)));

  let calendarCells = $derived.by(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    let startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0

    const cells: { day: number | null; date: string | null }[] = [];
    for (let i = 0; i < startOffset; i++) cells.push({ day: null, date: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, date: dateStr });
    }
    return cells;
  });

  function prevMonth() {
    let m = month - 1, y = year;
    if (m < 1) { m = 12; y--; }
    onNavigate(y, m);
  }

  function nextMonth() {
    let m = month + 1, y = year;
    if (m > 12) { m = 1; y++; }
    onNavigate(y, m);
  }

  function cellBg(dateStr: string | null): string {
    if (!dateStr) return 'transparent';
    const data = dayMap.get(dateStr);
    if (!data) return '#1f1f1f';
    const intensity = 0.3 + (data.totalSets / maxSets) * 0.7;
    return `rgba(34, 197, 94, ${intensity})`;
  }

  function handleDayClick(date: string | null) {
    if (!date || !dayMap.has(date)) return;
    onDayClick?.(date);
  }
</script>

<div>
  <!-- Header -->
  <div class="flex items-center justify-between mb-2">
    <button onclick={prevMonth} class="p-1 text-neutral-500 hover:text-neutral-300">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
      </svg>
    </button>
    <span class="text-xs font-medium text-neutral-300">{MONTH_NAMES[month - 1]} {year}</span>
    <button onclick={nextMonth} class="p-1 text-neutral-500 hover:text-neutral-300">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
      </svg>
    </button>
  </div>

  <!-- Grid -->
  <div class="grid grid-cols-7 gap-1">
    <!-- Day labels -->
    {#each DAY_LABELS as label}
      <div class="text-[9px] text-neutral-600 text-center py-0.5">{label}</div>
    {/each}

    <!-- Day cells -->
    {#each calendarCells as cell}
      {#if cell.day === null}
        <div></div>
      {:else}
        <button
          onclick={() => handleDayClick(cell.date)}
          class="aspect-square rounded-md flex items-center justify-center text-[10px] transition-colors {dayMap.has(cell.date ?? '') ? 'text-white font-bold cursor-pointer active:opacity-70' : 'text-neutral-600 cursor-default'}"
          style="background-color: {cellBg(cell.date)};"
          disabled={!cell.date || !dayMap.has(cell.date)}
        >
          {cell.day}
        </button>
      {/if}
    {/each}
  </div>
</div>
