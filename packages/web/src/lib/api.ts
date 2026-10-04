import { enqueue, fetchWithTimeout, getQueueSize, replayQueue, QUEUEABLE_METHODS, type ReplayResult } from './offline-queue';
import { showToast } from './toast';
import { invalidateAfterMutation } from './api-cache.svelte';

export function getApiBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:3001';
  const { hostname, port, protocol } = window.location;
  if (port === '5173') {
    // Dev mode — proxy through Vite to avoid mixed-content (HTTPS frontend → HTTP API)
    return '/api';
  }
  // Production — same origin, /api prefix
  return `${protocol}//${hostname}${port ? ':' + port : ''}/api`;
}

const API_BASE = getApiBase();

// A write on a dead-but-"connected" gym signal can hang for a minute or more.
// Time it out so it gets queued instead. Only idempotent writes get a timeout:
// a PUT/PATCH/DELETE that did land is harmless to replay, a POST is not.
const WRITE_TIMEOUT_MS = 15_000;

export function getAuthHeaders(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  const key = localStorage.getItem('fitlocal_api_key');
  if (!key) return {};
  return { 'Authorization': `Bearer ${key}` };
}

/**
 * Whether an error thrown by fetch() means the server couldn't be reached
 * (offline, dropped connection, DNS) as opposed to an HTTP error response.
 * fetch() only rejects with a TypeError for network failures, and the message
 * differs per engine — WebKit/iOS "Load failed", Chrome "Failed to fetch",
 * Firefox "NetworkError when attempting to fetch resource." — so match the
 * type, never the text. navigator.onLine === false is a secondary signal.
 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Thrown when a write that can't be queued (a POST) is attempted offline. */
export class OfflineError extends Error {
  constructor(message = "You're offline — reconnect and try again") {
    super(message);
    this.name = 'OfflineError';
  }
}

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

async function queueWrite(method: string, path: string, options?: RequestInit): Promise<void> {
  const body = typeof options?.body === 'string' ? options.body : null;
  await enqueue(method, path, body);
  showToast('Saved offline — will sync when connected', 'info');
}

// Idempotent writes to the same path go out one at a time, in call order.
// Otherwise a write stuck on a dead signal that finally fails and gets queued
// would replay after — and overwrite — a newer write to the same row that went
// straight through once the signal came back.
const writeChains = new Map<string, Promise<void>>();

function inPathOrder<T>(path: string, run: () => Promise<T>): Promise<T> {
  const result = (writeChains.get(path) ?? Promise.resolve()).then(run);
  const settled = result.then(() => {}, () => {});
  writeChains.set(path, settled);
  settled.then(() => {
    if (writeChains.get(path) === settled) writeChains.delete(path);
  });
  return result;
}

export function api<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase();
  if (QUEUEABLE_METHODS.has(method)) return inPathOrder(path, () => send<T>(path, method, options));
  return send<T>(path, method, options);
}

async function send<T>(path: string, method: string, options?: RequestInit): Promise<T> {
  const mutation = isMutation(method);
  const queueable = QUEUEABLE_METHODS.has(method);

  if (queueable && (await getQueueSize()) > 0) {
    // Older offline writes haven't reached the server yet. Sending this one
    // directly would let them replay after it and overwrite it, so queue it
    // behind them and kick a replay to flush everything in order.
    await queueWrite(method, path, options);
    void syncOfflineQueue();
    return undefined as T;
  }

  const hasBody = options?.body != null;
  const url = `${API_BASE}${path}`;
  const init: RequestInit = {
    // api-cache.svelte.ts already does stale-while-revalidate in memory. The
    // HTTP cache (the API sends max-age on /workouts and /exercises) would hand
    // the refetch after a write the pre-write response.
    cache: 'no-store',
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...getAuthHeaders(),
      ...(options?.headers as Record<string, string> | undefined),
    },
  };

  let res: Response;
  try {
    res = queueable ? await fetchWithTimeout(url, init, WRITE_TIMEOUT_MS) : await fetch(url, init);
  } catch (err) {
    if (!mutation || !isNetworkError(err)) throw err;
    if (queueable) {
      await queueWrite(method, path, options);
      return undefined as T;
    }
    // POST creates a row the caller needs (its id) right now, and replaying it
    // later would create a duplicate/orphan row — so fail loudly instead.
    showToast("You're offline — this can't be added until you reconnect", 'error');
    throw new OfflineError();
  }

  if (!res.ok) throw new Error(`API error: ${res.status}`);
  if (res.status === 204) {
    if (mutation) invalidateAfterMutation(path);
    return undefined as T;
  }
  const data = await res.json();
  if (mutation) invalidateAfterMutation(path);
  return data;
}

// HR summary + time-in-zone for a workout (#59, #93). Returns sampleCount:0
// (and zones:null) when the workout has no HR samples — callers should treat
// that as "nothing to show".
export function getWorkoutHr(id: number): Promise<import('fitlocal-shared').WorkoutHr> {
  return api<import('fitlocal-shared').WorkoutHr>(`/workouts/${id}/hr`);
}

let syncing: Promise<ReplayResult> | null = null;

/**
 * Replay queued offline writes, then refresh caches and report the outcome.
 * Concurrent calls share one run (and one toast).
 */
export function syncOfflineQueue(): Promise<ReplayResult> {
  if (!syncing) {
    const authToken = (typeof localStorage !== 'undefined' && localStorage.getItem('fitlocal_api_key')) || undefined;
    syncing = replayQueue(API_BASE, authToken)
      .then((result) => {
        if (result.syncedPaths.length > 0) invalidateAfterMutation(result.syncedPaths);
        if (result.synced > 0) {
          showToast(`Synced ${result.synced} offline change${result.synced > 1 ? 's' : ''}`, 'success');
        }
        if (result.failed > 0) {
          showToast(`${result.failed} offline change${result.failed > 1 ? 's' : ''} couldn't be saved`, 'error');
        }
        return result;
      })
      .catch((): ReplayResult => ({ synced: 0, failed: 0, remaining: 0, syncedPaths: [] }))
      .finally(() => { syncing = null; });
  }
  return syncing;
}

let syncStarted = false;

/**
 * Flush the offline queue now and whenever the app may have regained a
 * connection. `online` alone isn't enough on iOS: it rarely fires for a gym
 * signal that drops data without dropping the network, and never for a PWA
 * that was killed and relaunched.
 */
export function startOfflineSync(): void {
  if (syncStarted || typeof window === 'undefined') return;
  syncStarted = true;
  const sync = () => { void syncOfflineQueue(); };
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });
  sync();
}
