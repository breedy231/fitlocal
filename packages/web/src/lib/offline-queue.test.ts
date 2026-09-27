import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Queue = typeof import('./offline-queue');
let q: Queue;

const BASE = 'http://api.test';

function json(status: number, data: unknown = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// Fresh IndexedDB + fresh module (its cached DB connection and replay lock)
// for every test.
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
  q = await import('./offline-queue');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function queued() {
  return (await q.getQueuedRequests()).map((r) => ({ method: r.method, path: r.path, body: r.body && JSON.parse(r.body) }));
}

describe('enqueue ordering and coalescing', () => {
  it('complete → uncomplete → complete on one set replays as completed', async () => {
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ reps: 8, completed: true }));
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ reps: 8, completed: false }));
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ reps: 8, completed: true }));

    expect(await queued()).toEqual([{ method: 'PATCH', path: '/sets/1', body: { reps: 8, completed: true } }]);
  });

  it('merges partial updates so earlier fields survive', async () => {
    await q.enqueue('PATCH', '/workouts/1', JSON.stringify({ endedAt: 'T1' }));
    await q.enqueue('PATCH', '/workouts/1', JSON.stringify({ effortRating: 7 }));
    await q.enqueue('PATCH', '/workouts/1', JSON.stringify({ endedAt: 'T2' }));

    expect(await queued()).toEqual([
      { method: 'PATCH', path: '/workouts/1', body: { endedAt: 'T2', effortRating: 7 } },
    ]);
  });

  it('moves the merged write to the end, after writes queued in between', async () => {
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true }));
    await q.enqueue('PATCH', '/sets/2', JSON.stringify({ completed: true }));
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ reps: 10 }));

    expect(await queued()).toEqual([
      { method: 'PATCH', path: '/sets/2', body: { completed: true } },
      { method: 'PATCH', path: '/sets/1', body: { completed: true, reps: 10 } },
    ]);
  });

  it('never drops a write that repeats an earlier one', async () => {
    const finish = JSON.stringify({ notes: 'Completed' });
    await q.enqueue('PUT', '/workouts/1', finish);
    await q.enqueue('PATCH', '/workouts/1', JSON.stringify({ notes: 'edited' }));
    await q.enqueue('PUT', '/workouts/1', finish);

    // Different methods aren't merged; the repeated PUT is kept, last.
    expect((await queued()).map((r) => [r.method, r.body.notes])).toEqual([
      ['PUT', 'Completed'],
      ['PATCH', 'edited'],
      ['PUT', 'Completed'],
    ]);
  });

  it('does not merge across a DELETE of the same path', async () => {
    await q.enqueue('PATCH', '/sets/3', JSON.stringify({ reps: 5 }));
    await q.enqueue('DELETE', '/sets/3', null);
    await q.enqueue('PATCH', '/sets/3', JSON.stringify({ reps: 6 }));

    expect((await queued()).map((r) => r.method)).toEqual(['PATCH', 'DELETE', 'PATCH']);
  });

  it('keeps concurrent enqueues in call order', async () => {
    await Promise.all([
      q.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true })),
      q.enqueue('PATCH', '/sets/2', JSON.stringify({ completed: true })),
      q.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: false })),
    ]);

    expect(await queued()).toEqual([
      { method: 'PATCH', path: '/sets/2', body: { completed: true } },
      { method: 'PATCH', path: '/sets/1', body: { completed: false } },
    ]);
  });
});

describe('replayQueue', () => {
  it('sends everything in order on 2xx and reports it as synced', async () => {
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true }));
    await q.enqueue('DELETE', '/sets/2', null);
    await q.enqueue('PUT', '/workouts/9', JSON.stringify({ notes: 'Completed' }));
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(200));
    vi.stubGlobal('fetch', fetchMock);

    const result = await q.replayQueue(BASE, 'secret');

    expect(fetchMock.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
      ['PATCH', `${BASE}/sets/1`],
      ['DELETE', `${BASE}/sets/2`],
      ['PUT', `${BASE}/workouts/9`],
    ]);
    const [, patchInit] = fetchMock.mock.calls[0]!;
    expect(patchInit.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer secret' });
    expect(patchInit.body).toBe(JSON.stringify({ completed: true }));
    expect(result).toEqual({ synced: 3, failed: 0, remaining: 0, syncedPaths: ['/sets/1', '/sets/2', '/workouts/9'] });
    expect(await q.getQueueSize()).toBe(0);
  });

  it('drops a 4xx but reports it as failed, not synced, and keeps going', async () => {
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ reps: 'bad' }));
    await q.enqueue('PATCH', '/sets/2', JSON.stringify({ completed: true }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/sets/1') ? json(400) : json(200))));

    const result = await q.replayQueue(BASE);

    expect(result).toEqual({ synced: 1, failed: 1, remaining: 0, syncedPaths: ['/sets/2'] });
  });

  it('treats a DELETE that 404s as synced', async () => {
    await q.enqueue('DELETE', '/sets/4', null);
    vi.stubGlobal('fetch', vi.fn(async () => json(404)));

    expect(await q.replayQueue(BASE)).toMatchObject({ synced: 1, failed: 0, remaining: 0 });
  });

  it('stops at the first 5xx so later writes do not jump ahead', async () => {
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true }));
    await q.enqueue('PATCH', '/sets/2', JSON.stringify({ completed: true }));
    await q.enqueue('PATCH', '/sets/3', JSON.stringify({ completed: true }));
    const fetchMock = vi.fn(async (url: string) => (url.endsWith('/sets/2') ? json(503) : json(200)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await q.replayQueue(BASE);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${BASE}/sets/1`, `${BASE}/sets/2`]);
    expect(result).toEqual({ synced: 1, failed: 0, remaining: 2, syncedPaths: ['/sets/1'] });
    const left = await q.getQueuedRequests();
    expect(left.map((r) => r.path)).toEqual(['/sets/2', '/sets/3']);
    expect(left[0].attempts).toBe(1);
  });

  it('keeps everything when the network is still down', async () => {
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true }));
    await q.enqueue('PATCH', '/sets/2', JSON.stringify({ completed: true }));
    const fetchMock = vi.fn(async () => { throw new TypeError('Load failed'); });
    vi.stubGlobal('fetch', fetchMock);

    const result = await q.replayQueue(BASE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ synced: 0, failed: 0, remaining: 2, syncedPaths: [] });
  });

  it('gives up on a request that keeps 5xx-ing for a long time, then moves on', async () => {
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true }));
    await q.enqueue('PATCH', '/sets/2', JSON.stringify({ completed: true }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/sets/1') ? json(500) : json(200))));
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(t0);
    expect(await q.replayQueue(BASE)).toMatchObject({ failed: 0, remaining: 2 });
    now.mockReturnValue(t0 + 60_000);
    expect(await q.replayQueue(BASE)).toMatchObject({ failed: 0, remaining: 2 });
    // Third failure, but still inside the give-up window (e.g. a long deploy).
    now.mockReturnValue(t0 + 120_000);
    expect(await q.replayQueue(BASE)).toMatchObject({ failed: 0, remaining: 2 });
    now.mockReturnValue(t0 + 31 * 60_000);
    expect(await q.replayQueue(BASE)).toEqual({ synced: 1, failed: 1, remaining: 0, syncedPaths: ['/sets/2'] });
  });

  it('runs one replay at a time — overlapping triggers do not double-send', async () => {
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true }));
    await q.enqueue('PATCH', '/sets/2', JSON.stringify({ completed: true }));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchMock = vi.fn(async () => { await gate; return json(200); });
    vi.stubGlobal('fetch', fetchMock);

    const first = q.replayQueue(BASE);
    const second = q.replayQueue(BASE);
    expect(second).toBe(first);
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a).toEqual({ synced: 2, failed: 0, remaining: 0, syncedPaths: ['/sets/1', '/sets/2'] });
    expect(b).toBe(a);

    // Lock is released afterwards: a later replay runs again.
    await q.enqueue('PATCH', '/sets/3', JSON.stringify({ completed: true }));
    expect(await q.replayQueue(BASE)).toMatchObject({ synced: 1 });
  });

  it('picks up writes queued while it was running', async () => {
    await q.enqueue('PATCH', '/sets/1', JSON.stringify({ completed: true }));
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/sets/1')) await q.enqueue('PATCH', '/sets/2', JSON.stringify({ completed: true }));
      return json(200);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await q.replayQueue(BASE);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${BASE}/sets/1`, `${BASE}/sets/2`]);
    expect(result).toMatchObject({ synced: 2, remaining: 0 });
  });
});
