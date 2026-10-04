const DB_NAME = 'fitlocal-offline';
const STORE_NAME = 'queue';
const DB_VERSION = 1;

// Only idempotent writes are queued: the caller doesn't need the response, and
// replaying the same body again leaves the same end state. POSTs create rows
// whose ids the caller needs right away, so they are never queued (see api.ts).
export const QUEUEABLE_METHODS: ReadonlySet<string> = new Set(['PUT', 'PATCH', 'DELETE']);

// Bounds each replayed request so a hung connection (gym signal that's "up" but
// passes no data) can't hold the replay lock forever.
const REPLAY_TIMEOUT_MS = 15_000;
// A request the server keeps rejecting with a retryable status (5xx etc.)
// blocks everything queued behind it, so give up on it eventually — but only
// after several tries spread over a while, so a deploy/restart doesn't drop it.
const GIVE_UP_AFTER_ATTEMPTS = 3;
const GIVE_UP_AFTER_MS = 30 * 60 * 1000;

export interface QueuedRequest {
  id?: number;
  method: string;
  path: string;
  body: string | null;
  timestamp: number;
  // Retryable server failures seen while replaying this request.
  attempts?: number;
  firstFailedAt?: number;
}

export interface ReplayResult {
  /** Accepted by the server and removed from the queue. */
  synced: number;
  /** Rejected for good (4xx, or retryable errors past the give-up window) and dropped. */
  failed: number;
  /** Still queued — offline, or stopped at a server error to keep order. */
  remaining: number;
  /** Distinct paths that synced, for cache invalidation. */
  syncedPaths: string[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // iOS can close the connection under us; reopen on next use.
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function parseObject(body: string | null): Record<string, unknown> | null {
  if (body == null) return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Fold a new PATCH/PUT into the previous queued write to the same path. The
// bodies are partial updates, so later fields win and earlier ones are kept
// (e.g. {endedAt} then {effortRating} → both). Returns null when the two can't
// be merged safely, in which case the new write is simply appended.
function coalesce(prev: QueuedRequest, next: QueuedRequest): QueuedRequest | null {
  if (prev.method !== next.method || (next.method !== 'PATCH' && next.method !== 'PUT')) return null;
  const a = parseObject(prev.body);
  const b = parseObject(next.body);
  if (!a || !b) return null;
  return { ...next, body: JSON.stringify({ ...a, ...b }) };
}

/**
 * Queue a write for replay. Order is preserved: the newest write always lands
 * at the end of the queue. A PATCH/PUT to the same path as the most recent
 * queued write for that path is merged into it (and moved to the end), so
 * complete → uncomplete → complete replays as a single `completed: true`.
 */
export async function enqueue(method: string, path: string, body: string | null): Promise<void> {
  const db = await openDB();
  const next: QueuedRequest = { method: method.toUpperCase(), path, body, timestamp: Date.now() };

  await new Promise<void>((resolve, reject) => {
    // One readwrite transaction for read + merge + write, so concurrent
    // enqueues can't interleave between the lookup and the add.
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const all = store.getAll();
    all.onsuccess = () => {
      const items = all.result as QueuedRequest[];
      let prev: QueuedRequest | undefined;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].path === path) { prev = items[i]; break; }
      }
      const merged = prev ? coalesce(prev, next) : null;
      if (prev && merged) store.delete(prev.id!);
      store.add(merged ?? next);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  notifyListeners();
}

/** Queued requests, oldest first. */
export async function getQueuedRequests(): Promise<QueuedRequest[]> {
  const db = await openDB();
  return readAll(db);
}

function readAll(db: IDBDatabase): Promise<QueuedRequest[]> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const all = tx.objectStore(STORE_NAME).getAll();
    all.onsuccess = () => resolve(all.result as QueuedRequest[]);
    all.onerror = () => resolve([]);
  });
}

export async function getQueueSize(): Promise<number> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const count = tx.objectStore(STORE_NAME).count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

/**
 * fetch() with a timeout. A timeout rejects with a TypeError, the same shape
 * as any other network failure, so callers treat it as "couldn't reach the
 * server". A caller-supplied signal disables the timeout.
 */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (init.signal) return fetch(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new TypeError('Network request timed out', { cause: err });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Worth retrying later rather than dropping: the server (or auth/rate limiting
// in front of it) may accept the same request once it recovers.
function isRetryable(status: number): boolean {
  return status >= 500 || status === 401 || status === 403 || status === 408 || status === 429;
}

let replaying: Promise<ReplayResult> | null = null;

/**
 * Send queued requests in order. Stops at the first network failure or
 * retryable server error so later writes never land ahead of earlier ones.
 * Only one replay runs at a time — overlapping triggers (online event,
 * visibilitychange, app start) share the run in progress.
 */
export function replayQueue(apiBase: string, authToken?: string): Promise<ReplayResult> {
  if (!replaying) {
    replaying = runReplay(apiBase, authToken).finally(() => { replaying = null; });
  }
  return replaying;
}

async function runReplay(apiBase: string, authToken?: string): Promise<ReplayResult> {
  const result: ReplayResult = { synced: 0, failed: 0, remaining: 0, syncedPaths: [] };
  const db = await openDB();
  const seen = new Set<number>();

  // Re-read after each pass: writes queued while we were sending are picked up
  // in the same run. Each request is sent at most once per run, so this ends.
  replay: for (;;) {
    const items = (await readAll(db)).filter((item) => !seen.has(item.id!));
    if (items.length === 0) break;

    for (const item of items) {
      seen.add(item.id!);
      const headers: Record<string, string> = item.body ? { 'Content-Type': 'application/json' } : {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      let res: Response;
      try {
        res = await fetchWithTimeout(`${apiBase}${item.path}`, {
          method: item.method,
          headers,
          body: item.body,
          cache: 'no-store',
        }, REPLAY_TIMEOUT_MS);
      } catch {
        break replay; // still offline — keep this item and everything after it
      }

      // A DELETE that 404s already has the end state it asked for.
      if (res.ok || (item.method === 'DELETE' && res.status === 404)) {
        await removeItem(db, item.id!);
        result.synced++;
        if (!result.syncedPaths.includes(item.path)) result.syncedPaths.push(item.path);
      } else if (isRetryable(res.status)) {
        const now = Date.now();
        const attempts = (item.attempts ?? 0) + 1;
        const firstFailedAt = item.firstFailedAt ?? now;
        if (attempts >= GIVE_UP_AFTER_ATTEMPTS && now - firstFailedAt >= GIVE_UP_AFTER_MS) {
          await removeItem(db, item.id!);
          result.failed++;
          continue;
        }
        await updateItem(db, { ...item, attempts, firstFailedAt });
        break replay; // keep order: nothing after this may land before it
      } else {
        // Other 4xx: the server will never accept this request as-is.
        await removeItem(db, item.id!);
        result.failed++;
      }
    }
  }

  result.remaining = (await readAll(db)).length;
  notifyListeners();
  return result;
}

function removeItem(db: IDBDatabase, id: number): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// Update in place only if the item is still queued — it may have been merged
// into a newer write (and deleted) while its request was in flight.
function updateItem(db: IDBDatabase, item: QueuedRequest): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const existing = store.get(item.id!);
    existing.onsuccess = () => {
      if (existing.result) store.put(item);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// Listener support for reactive queue count
type QueueListener = (count: number) => void;
let listeners: QueueListener[] = [];

export function onQueueChange(fn: QueueListener): () => void {
  listeners.push(fn);
  getQueueSize().then(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

async function notifyListeners() {
  const count = await getQueueSize();
  for (const fn of listeners) fn(count);
}
