import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./toast', () => ({ showToast: vi.fn() }));
vi.mock('./api-cache.svelte', () => ({ invalidateAfterMutation: vi.fn() }));

type Api = typeof import('./api');
let apiMod: Api;
let queue: typeof import('./offline-queue');
let showToast: ReturnType<typeof vi.fn>;
let invalidateAfterMutation: ReturnType<typeof vi.fn>;

// Outside the browser getApiBase() falls back to the dev API.
const BASE = 'http://localhost:3001';

function json(status: number, data: unknown = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
  apiMod = await import('./api');
  queue = await import('./offline-queue');
  showToast = (await import('./toast')).showToast as unknown as ReturnType<typeof vi.fn>;
  invalidateAfterMutation = (await import('./api-cache.svelte')).invalidateAfterMutation as unknown as ReturnType<typeof vi.fn>;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('isNetworkError', () => {
  it.each([
    ['Safari / iOS WebKit', 'Load failed'],
    ['Chrome', 'Failed to fetch'],
    ['Firefox', 'NetworkError when attempting to fetch resource.'],
    ['timeout', 'Network request timed out'],
  ])('%s fetch failure (%s) is a network error', (_engine, message) => {
    expect(apiMod.isNetworkError(new TypeError(message))).toBe(true);
  });

  it('HTTP and parse errors are not network errors while online', () => {
    expect(apiMod.isNetworkError(new Error('API error: 500'))).toBe(false);
    expect(apiMod.isNetworkError(new SyntaxError('Unexpected token <'))).toBe(false);
  });

  it('navigator.onLine === false marks any fetch failure as network', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(apiMod.isNetworkError(new DOMException('aborted', 'AbortError'))).toBe(true);
  });
});

describe('api() offline writes', () => {
  it('queues a PATCH when WebKit reports "Load failed"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed'); }));

    const result = await apiMod.api('/sets/1', { method: 'PATCH', body: JSON.stringify({ completed: true }) });

    expect(result).toBeUndefined();
    const items = await queue.getQueuedRequests();
    expect(items.map((r) => [r.method, r.path, r.body])).toEqual([['PATCH', '/sets/1', '{"completed":true}']]);
    expect(showToast).toHaveBeenCalledWith('Saved offline — will sync when connected', 'info');
  });

  it('does not queue a POST — throws OfflineError with a toast instead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed'); }));

    await expect(
      apiMod.api('/sets', { method: 'POST', body: JSON.stringify({ workoutExerciseId: 1 }) })
    ).rejects.toBeInstanceOf(apiMod.OfflineError);

    expect(await queue.getQueueSize()).toBe(0);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("You're offline"), 'error');
  });

  it('rethrows network errors on reads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed'); }));

    await expect(apiMod.api('/workouts/1')).rejects.toBeInstanceOf(TypeError);
    expect(await queue.getQueueSize()).toBe(0);
  });

  it('bypasses the HTTP cache so a refetch after a write sees the write', async () => {
    const fetchMock = vi.fn(async () => json(200, { id: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiMod.api('/workouts/1');

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/workouts/1`, expect.objectContaining({ cache: 'no-store' }));
  });

  it('queues a write behind older queued writes instead of overtaking them', async () => {
    // Left over from a dead signal; the connection is back but no replay has run yet.
    await queue.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true }));
    await queue.enqueue('PATCH', '/sets/2', JSON.stringify({ completed: true }));
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      sent.push(`${init.method} ${url.replace(BASE, '')} ${init.body}`);
      return json(200);
    }));

    // Sent directly, this would land first and then be overwritten by the replay.
    const result = await apiMod.api('/sets/1', { method: 'PATCH', body: JSON.stringify({ completed: false }) });
    expect(result).toBeUndefined();
    await apiMod.syncOfflineQueue();

    expect(sent).toEqual([
      'PATCH /sets/2 {"completed":true}',
      'PATCH /sets/1 {"completed":false}',
    ]);
    expect(await queue.getQueueSize()).toBe(0);
  });

  it('a write to the same row waits for a slow earlier one, then queues behind it if that failed', async () => {
    let failFirst!: () => void;
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      sent.push(`${url.replace(BASE, '')} ${init.body}`);
      if (sent.length === 1) {
        // Dead signal: hangs, then fails.
        return new Promise<Response>((_, reject) => { failFirst = () => reject(new TypeError('Load failed')); });
      }
      return Promise.resolve(json(200));
    }));

    const first = apiMod.api('/sets/1', { method: 'PATCH', body: JSON.stringify({ completed: true }) });
    const second = apiMod.api('/sets/1', { method: 'PATCH', body: JSON.stringify({ completed: false }) });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    // The newer write must not go out while the older one is unresolved.
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);

    failFirst();
    await Promise.all([first, second]);
    await apiMod.syncOfflineQueue();

    // Both ended up queued (merged, newest value last) and replayed once.
    expect(sent).toEqual(['/sets/1 {"completed":true}', '/sets/1 {"completed":false}']);
    expect(await queue.getQueueSize()).toBe(0);
  });

  it('sends writes directly once the queue is empty', async () => {
    const fetchMock = vi.fn(async () => json(200, { id: 1, completed: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiMod.api('/sets/1', { method: 'PATCH', body: JSON.stringify({ completed: true }) });

    expect(result).toEqual({ id: 1, completed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidateAfterMutation).toHaveBeenCalledWith('/sets/1');
  });
});

describe('syncOfflineQueue', () => {
  it('invalidates caches for synced paths and reports synced and failed separately', async () => {
    await queue.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true }));
    await queue.enqueue('PATCH', '/sets/2', JSON.stringify({ reps: -1 }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/sets/2') ? json(400) : json(200))));

    const result = await apiMod.syncOfflineQueue();

    expect(result).toMatchObject({ synced: 1, failed: 1, remaining: 0 });
    expect(invalidateAfterMutation).toHaveBeenCalledWith(['/sets/1']);
    expect(showToast).toHaveBeenCalledWith('Synced 1 offline change', 'success');
    expect(showToast).toHaveBeenCalledWith("1 offline change couldn't be saved", 'error');
  });

  it('shares one run (and one toast) between overlapping calls', async () => {
    await queue.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true }));
    const fetchMock = vi.fn(async () => json(200));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([apiMod.syncOfflineQueue(), apiMod.syncOfflineQueue(), apiMod.syncOfflineQueue()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate or toast when nothing synced', async () => {
    await queue.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    expect(await apiMod.syncOfflineQueue()).toMatchObject({ synced: 0, remaining: 1 });
    expect(invalidateAfterMutation).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});
