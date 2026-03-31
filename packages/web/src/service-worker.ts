/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const CACHE = `cache-${version}`;
const API_CACHE = `api-cache-${version}`;
const ASSETS = [...build, ...files];
const API_CACHE_MAX = 50;
const NETWORK_TIMEOUT_MS = 3000;

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      for (const key of keys) {
        if (key !== CACHE && key !== API_CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })
  );
});

/**
 * Network-first with timeout: try network, fall back to cache.
 * On success, cache the response for future offline/slow use.
 */
async function networkFirstWithTimeout(request: Request): Promise<Response> {
  const cache = await caches.open(API_CACHE);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      // Cache the response (clone since body can only be read once)
      cache.put(request, response.clone()).then(() => evictApiCache(cache));
    }

    return response;
  } catch {
    // Network failed or timed out — try cache
    const cached = await cache.match(request);
    if (cached) return cached;

    // Nothing in cache either — return a proper error response
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** Keep API cache under max size by evicting oldest entries */
async function evictApiCache(cache: Cache) {
  const keys = await cache.keys();
  if (keys.length <= API_CACHE_MAX) return;

  // Remove oldest entries (first added = first in keys list)
  const toRemove = keys.length - API_CACHE_MAX;
  for (let i = 0; i < toRemove; i++) {
    await cache.delete(keys[i]);
  }
}

sw.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // API requests: network-first with timeout + cache fallback
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithTimeout(event.request));
    return;
  }

  // Static assets: cache-first
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request);
      })
    );
  }
});

// Listen for invalidation messages from the main thread
sw.addEventListener('message', (event) => {
  if (event.data?.type === 'INVALIDATE_API_CACHE') {
    const prefix = event.data.pathPrefix as string;
    caches.open(API_CACHE).then(async (cache) => {
      const keys = await cache.keys();
      for (const req of keys) {
        const url = new URL(req.url);
        if (url.pathname.startsWith(`/api${prefix}`)) {
          await cache.delete(req);
        }
      }
    });
  }
});
