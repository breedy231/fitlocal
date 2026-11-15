import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithSoftTimeout } from './sw-network';

const SOFT = 3000;
const HARD = 20000;

function ok(body = 'live'): Response {
  return new Response(body, { status: 200 });
}

/** A fetch that resolves after `ms`, honouring abort like a real fetch. */
function slowFetch(ms: number, body = 'live') {
  return (signal: AbortSignal) =>
    new Promise<Response>((resolve, reject) => {
      const id = setTimeout(() => resolve(ok(body)), ms);
      signal.addEventListener('abort', () => {
        clearTimeout(id);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
}

const noCache = async () => undefined;
const withCache = async () => ok('cached');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('fetchWithSoftTimeout', () => {
  it('returns the live response when the network is fast', async () => {
    const p = fetchWithSoftTimeout({ fetch: slowFetch(100), cached: withCache, softTimeoutMs: SOFT, hardTimeoutMs: HARD });
    await vi.advanceTimersByTimeAsync(100);
    expect(await (await p)!.text()).toBe('live');
  });

  it('keeps waiting past the soft timeout when nothing is cached (the gym 503)', async () => {
    const p = fetchWithSoftTimeout({ fetch: slowFetch(8000), cached: noCache, softTimeoutMs: SOFT, hardTimeoutMs: HARD });
    await vi.advanceTimersByTimeAsync(8000);
    const res = await p;
    expect(res).not.toBeNull();
    expect(await res!.text()).toBe('live');
  });

  it('serves cache after the soft timeout when a cached copy exists', async () => {
    const p = fetchWithSoftTimeout({ fetch: slowFetch(8000), cached: withCache, softTimeoutMs: SOFT, hardTimeoutMs: HARD });
    await vi.advanceTimersByTimeAsync(SOFT);
    expect(await (await p)!.text()).toBe('cached');
  });

  it('gives up at the hard timeout with nothing cached', async () => {
    const p = fetchWithSoftTimeout({ fetch: slowFetch(60000), cached: noCache, softTimeoutMs: SOFT, hardTimeoutMs: HARD });
    await vi.advanceTimersByTimeAsync(HARD);
    expect(await p).toBeNull();
  });

  it('treats an iOS "Load failed" TypeError as offline and falls back to cache', async () => {
    const failing = async () => {
      throw new TypeError('Load failed');
    };
    expect(await (await fetchWithSoftTimeout({ fetch: failing, cached: withCache, softTimeoutMs: SOFT, hardTimeoutMs: HARD }))!.text()).toBe('cached');
    expect(await fetchWithSoftTimeout({ fetch: failing, cached: noCache, softTimeoutMs: SOFT, hardTimeoutMs: HARD })).toBeNull();
  });

  it('passes non-ok server responses through instead of masking them', async () => {
    const res = await fetchWithSoftTimeout({
      fetch: async () => new Response('nope', { status: 500 }),
      cached: withCache,
      softTimeoutMs: SOFT,
      hardTimeoutMs: HARD,
    });
    expect(res!.status).toBe(500);
  });
});
