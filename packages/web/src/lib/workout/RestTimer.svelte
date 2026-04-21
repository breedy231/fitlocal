<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  // Rest timer wall-clock state — all owned by this component so the
  // visibility-change handler, main-thread notification fallback, and SW
  // backup stay co-located.
  let restTimeLeft = $state(0);
  let restTotalTime = $state(0);
  let restTimerActive = $state(false);
  let restTimerDone = $state(false);
  let restTimerInterval: ReturnType<typeof setInterval> | null = null;
  let restEndTime = 0;
  let hasVibrated10s = false;
  let restNextSetLabel = '';
  let restNotificationFired = false;

  function requestNotificationPermission() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function sendSwMessage(msg: Record<string, unknown>) {
    if (typeof navigator !== 'undefined') {
      navigator.serviceWorker?.controller?.postMessage(msg);
    }
  }

  function fireRestCompleteNotification() {
    if (restNotificationFired) return;
    restNotificationFired = true;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([300, 100, 300]);
    }
    // Fire notification from main thread as fallback (more reliable on iOS than SW setTimeout)
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('Rest Complete', {
          body: restNextSetLabel || 'Time for your next set',
          tag: 'rest-timer',
        });
      } catch {
        // Notification constructor may fail on some platforms — SW is the backup
      }
    }
  }

  export function startRest(seconds: number, nextSetLabel = '') {
    if (restTimerInterval) clearInterval(restTimerInterval);
    restTotalTime = seconds;
    restEndTime = Date.now() + seconds * 1000;
    restTimeLeft = seconds;
    restTimerActive = true;
    hasVibrated10s = false;
    restNotificationFired = false;
    restNextSetLabel = nextSetLabel;
    requestNotificationPermission();

    // Schedule notification via service worker as backup
    sendSwMessage({
      type: 'SCHEDULE_REST_NOTIFICATION',
      delayMs: seconds * 1000,
      title: 'Rest Complete',
      body: nextSetLabel || 'Time for your next set',
    });

    restTimerInterval = setInterval(() => {
      // Compute from wall clock so it stays accurate across tab switches
      const remaining = Math.ceil((restEndTime - Date.now()) / 1000);
      restTimeLeft = Math.max(0, remaining);
      if (restTimeLeft <= 10 && restTimeLeft > 0 && !hasVibrated10s) {
        hasVibrated10s = true;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
      }
      if (restTimeLeft <= 0) {
        fireRestCompleteNotification();
        // Show "GO!" flash for 2s before hiding the bar
        if (restTimerInterval) { clearInterval(restTimerInterval); restTimerInterval = null; }
        sendSwMessage({ type: 'CANCEL_REST_NOTIFICATION' });
        restTimerDone = true;
        setTimeout(() => {
          restTimerDone = false;
          restTimerActive = false;
          restTimeLeft = 0;
        }, 2000);
      }
    }, 250);
  }

  export function dismissRestTimer() {
    restTimerActive = false;
    restTimerDone = false;
    restTimeLeft = 0;
    if (restTimerInterval) {
      clearInterval(restTimerInterval);
      restTimerInterval = null;
    }
    // Cancel any pending SW notification (e.g. user tapped Skip)
    sendSwMessage({ type: 'CANCEL_REST_NOTIFICATION' });
  }

  // When user returns to app, check if rest timer expired while away
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && restTimerActive && restEndTime > 0) {
      const remaining = Math.ceil((restEndTime - Date.now()) / 1000);
      if (remaining <= 0) {
        fireRestCompleteNotification();
        dismissRestTimer();
      }
    }
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  if (browser) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  onDestroy(() => {
    if (restTimerInterval) clearInterval(restTimerInterval);
    if (browser) document.removeEventListener('visibilitychange', handleVisibilityChange);
  });
</script>

{#if restTimerActive || restTimerDone}
  <div class="fixed bottom-20 left-0 right-0 z-40 flex justify-center pointer-events-none px-4">
    <div
      class="w-full max-w-lg rounded-xl px-4 py-3 pointer-events-auto shadow-lg transition-colors"
      style="background-color: #1a1a1a; border: 1px solid {restTimerDone ? '#22c55e' : '#333'};"
    >
      {#if restTimerDone}
        <!-- "GO!" flash — shown for 2s after timer hits 0 -->
        <div class="flex items-center justify-between">
          <span class="text-2xl font-bold text-green-400 animate-pulse">GO! 🔔</span>
          <button
            onclick={dismissRestTimer}
            class="text-xs font-medium text-neutral-400 hover:text-white transition-colors shrink-0 px-2 py-1 rounded-md hover:bg-neutral-800"
          >Dismiss</button>
        </div>
      {:else}
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <span class="text-xs text-neutral-500 uppercase tracking-wider shrink-0">Rest</span>
            <span class="text-2xl font-mono font-bold text-white">{formatTime(restTimeLeft)}</span>
          </div>
          <div class="flex-1 mx-2">
            <div class="h-1 rounded-full bg-neutral-800 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-1000 ease-linear"
                style="width: {restTotalTime > 0 ? ((restTotalTime - restTimeLeft) / restTotalTime) * 100 : 0}%; background-color: #22c55e;"
              ></div>
            </div>
          </div>
          <button
            onclick={dismissRestTimer}
            class="text-xs font-medium text-neutral-400 hover:text-white transition-colors shrink-0 px-2 py-1 rounded-md hover:bg-neutral-800"
          >
            Skip
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
