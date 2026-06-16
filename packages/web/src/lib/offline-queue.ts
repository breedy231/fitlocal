const DB_NAME = 'fitlocal-offline';
const STORE_NAME = 'queue';
const DB_VERSION = 1;

interface QueuedRequest {
  id?: number;
  method: string;
  path: string;
  body: string | null;
  signature: string;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function computeSignature(method: string, path: string, body: string | null): string {
  // Simple hash: method + path + body content
  const raw = `${method}:${path}:${body ?? ''}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export async function enqueue(method: string, path: string, body: string | null): Promise<void> {
  const db = await openDB();
  const signature = computeSignature(method, path, body);

  // Deduplicate: skip if same signature already queued
  const existing = await new Promise<QueuedRequest[]>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const all = store.getAll();
    all.onsuccess = () => resolve(all.result);
    all.onerror = () => resolve([]);
  });

  if (existing.some(r => r.signature === signature)) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add({ method, path, body, signature, timestamp: Date.now() } as QueuedRequest);
    tx.oncomplete = () => {
      notifyListeners();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueueSize(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const count = tx.objectStore(STORE_NAME).count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

export async function replayQueue(apiBase: string, authToken?: string): Promise<number> {
  const db = await openDB();
  const items = await new Promise<QueuedRequest[]>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const all = tx.objectStore(STORE_NAME).getAll();
    all.onsuccess = () => resolve(all.result);
    all.onerror = () => resolve([]);
  });

  if (items.length === 0) return 0;

  let replayed = 0;
  for (const item of items) {
    try {
      const headers: Record<string, string> = item.body ? { 'Content-Type': 'application/json' } : {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${apiBase}${item.path}`, {
        method: item.method,
        headers,
        body: item.body,
      });
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        // Success or client error (don't retry 4xx) — remove from queue
        await removeItem(db, item.id!);
        replayed++;
      }
      // 5xx: leave in queue for next retry
    } catch {
      // Network still down — stop replaying
      break;
    }
  }

  notifyListeners();
  return replayed;
}

async function removeItem(db: IDBDatabase, id: number): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
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
