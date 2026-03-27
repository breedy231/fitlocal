import { enqueue, replayQueue } from './offline-queue';
import { showToast } from './toast';

function getApiBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:3001';
  // Production: API is served from same origin under /api
  const { hostname, port, protocol } = window.location;
  if (port === '5173') {
    // Dev mode — SvelteKit dev server, API on separate port
    return hostname === 'localhost'
      ? 'http://localhost:3001'
      : `http://${hostname}:3001`;
  }
  // Production — same origin, /api prefix
  return `${protocol}//${hostname}${port ? ':' + port : ''}/api`;
}

const API_BASE = getApiBase();

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && (err as TypeError).message.includes('fetch');
}

function isMutation(options?: RequestInit): boolean {
  const method = (options?.method ?? 'GET').toUpperCase();
  return method !== 'GET' && method !== 'HEAD';
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body != null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: hasBody ? { 'Content-Type': 'application/json' } : {},
      ...options,
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    if (res.status === 204) return undefined as T;
    return res.json();
  } catch (err) {
    if (isNetworkError(err) && isMutation(options)) {
      // Queue the mutation for replay when back online
      const body = typeof options?.body === 'string' ? options.body : null;
      await enqueue(options!.method!, path, body);
      showToast('Saved offline — will sync when connected', 'info');
      return undefined as T;
    }
    throw err;
  }
}

// Replay queued requests when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', async () => {
    const count = await replayQueue(API_BASE);
    if (count > 0) {
      showToast(`Synced ${count} offline change${count > 1 ? 's' : ''}`, 'success');
    }
  });
}
