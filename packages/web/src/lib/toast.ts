interface ToastMessage {
  id: number;
  text: string;
  type: 'error' | 'success' | 'info';
}

let nextId = 0;
let listeners: Array<(toasts: ToastMessage[]) => void> = [];
let current: ToastMessage[] = [];

function notify() {
  for (const fn of listeners) fn(current);
}

export function showToast(text: string, type: 'error' | 'success' | 'info' = 'error', duration = 4000) {
  const id = nextId++;
  current = [...current, { id, text, type }];
  notify();
  setTimeout(() => {
    current = current.filter(t => t.id !== id);
    notify();
  }, duration);
}

export function subscribeToasts(fn: (toasts: ToastMessage[]) => void): () => void {
  listeners.push(fn);
  fn(current);
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
}
