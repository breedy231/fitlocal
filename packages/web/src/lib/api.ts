const API_BASE = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? `http://${window.location.hostname}:3001`
  : 'http://localhost:3001';

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body != null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}
