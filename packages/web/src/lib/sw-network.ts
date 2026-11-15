/**
 * Network-first fetch with a "soft" timeout, used by the service worker.
 *
 * After `softTimeoutMs`, a cached copy (if any) is returned so a slow
 * connection doesn't stall a screen that has data to show. If nothing is
 * cached, the live request keeps going until `hardTimeoutMs`. The old
 * behaviour aborted at the soft timeout and returned a fake
 * `503 {"error":"Offline"}`, so a slow gym connection broke workout start
 * even though the server was up.
 *
 * Returns `null` when the network failed (TypeError, any message: iOS says
 * "Load failed") or hit the hard timeout, and nothing is cached. The caller
 * builds the offline response.
 */
export interface SoftTimeoutDeps {
  fetch: (signal: AbortSignal) => Promise<Response>;
  cached: () => Promise<Response | undefined>;
  softTimeoutMs: number;
  hardTimeoutMs: number;
}

export async function fetchWithSoftTimeout(deps: SoftTimeoutDeps): Promise<Response | null> {
  const controller = new AbortController();
  const hardId = setTimeout(() => controller.abort(), deps.hardTimeoutMs);

  const network = deps.fetch(controller.signal).finally(() => clearTimeout(hardId));
  // Swallow rejections on the raced copy; the awaited copy below rethrows.
  const networkSettled = network.then(
    (r) => ({ kind: 'response' as const, r }),
    () => ({ kind: 'failed' as const }),
  );

  let softId: ReturnType<typeof setTimeout> | undefined;
  const soft = new Promise<{ kind: 'soft' }>((resolve) => {
    softId = setTimeout(() => resolve({ kind: 'soft' }), deps.softTimeoutMs);
  });

  const first = await Promise.race([networkSettled, soft]);
  clearTimeout(softId);

  if (first.kind === 'response') return first.r;

  if (first.kind === 'soft') {
    // Slow: serve cache if we have it (the live request keeps running and
    // still refreshes the cache via the caller's `fetch`), else keep waiting.
    const cached = await deps.cached();
    if (cached) return cached;
    const settled = await networkSettled;
    if (settled.kind === 'response') return settled.r;
    return null;
  }

  // Network failed outright.
  return (await deps.cached()) ?? null;
}
