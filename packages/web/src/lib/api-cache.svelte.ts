import { api } from './api';
import { browser } from '$app/environment';

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 100;
const inflight = new Map<string, Promise<unknown>>();

// Staleness TTLs in milliseconds by path prefix (longest prefix match wins)
const STALE_MS: [string, number][] = [
  ['/exercises', 60 * 60 * 1000],       // 1 hour
  ['/stretches', 60 * 60 * 1000],       // 1 hour
  ['/recovery-summary', 2 * 60 * 1000], // 2 min
  ['/programs/active', 2 * 60 * 1000],  // 2 min
  ['/programs', 5 * 60 * 1000],         // 5 min
  ['/workouts', 60 * 1000],             // 1 min
  ['/reports/', 60 * 1000],             // 1 min
  ['/health-snapshots', 5 * 60 * 1000], // 5 min
];

function getTTL(path: string): number {
  for (const [prefix, ttl] of STALE_MS) {
    if (path.startsWith(prefix)) return ttl;
  }
  return 60 * 1000; // default 1 min
}

function evictOldest() {
  if (cache.size < MAX_ENTRIES) return;
  let oldestKey = '';
  let oldestTime = Infinity;
  for (const [key, entry] of cache) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldestKey = key;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

/**
 * Stale-while-revalidate API fetch.
 * Returns an object with reactive $state fields:
 *   - data: cached value (or null if no cache)
 *   - loading: true only if no cache exists and fetch is in flight
 *   - refresh(): manually trigger a re-fetch
 */
export function cachedGet<T>(path: string): { data: T | null; loading: boolean; refresh: () => void } {
  // SSR: return inert object — client will hydrate and fetch
  if (!browser) {
    return {
      get data() { return null; },
      get loading() { return true; },
      refresh() {},
    };
  }

  const entry = cache.get(path) as CacheEntry<T> | undefined;
  const now = Date.now();
  const ttl = getTTL(path);
  const isFresh = entry && (now - entry.timestamp < ttl);

  const state = $state<{ data: T | null; loading: boolean }>({
    data: entry?.data ?? null,
    loading: !entry,
  });

  const doFetch = () => {
    // Deduplicate concurrent requests to the same path
    let promise = inflight.get(path) as Promise<T> | undefined;
    if (!promise) {
      promise = api<T>(path);
      inflight.set(path, promise);
      promise.finally(() => inflight.delete(path));
    }

    promise
      .then((result) => {
        evictOldest();
        cache.set(path, { data: result, timestamp: Date.now() });
        state.data = result;
      })
      .catch(() => {
        // Network error — keep stale data if we have it
      })
      .finally(() => {
        state.loading = false;
      });
  };

  if (!isFresh) {
    doFetch();
  } else {
    state.loading = false;
  }

  return {
    get data() { return state.data; },
    get loading() { return state.loading; },
    refresh: doFetch,
  };
}

/**
 * Invalidate cache entries matching a path prefix.
 */
export function invalidateCache(pathPrefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(pathPrefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Invalidation rules triggered by mutations.
 * Call this after a successful POST/PUT/DELETE.
 */
export function invalidateAfterMutation(path: string) {
  // Workout-related mutations bust workout, recovery, and report caches
  if (path.startsWith('/workouts') || path.startsWith('/sets') || path.startsWith('/workout-exercises')) {
    invalidateCache('/workouts');
    invalidateCache('/recovery-summary');
    invalidateCache('/reports/');
  }

  // Program advancement
  if (path.startsWith('/programs/active')) {
    invalidateCache('/programs');
  }

  // Exercise changes
  if (path.startsWith('/exercises')) {
    invalidateCache('/exercises');
  }

  // Health data changes
  if (path.startsWith('/health')) {
    invalidateCache('/health');
    invalidateCache('/reports/');
  }

  // Notify service worker to bust its cache too
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'INVALIDATE_API_CACHE',
      pathPrefix: path,
    });
  }
}
