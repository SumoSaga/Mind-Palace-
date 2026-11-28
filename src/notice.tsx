import { useSyncExternalStore } from 'react';

/**
 * Short messages shown at the top of the screen, for things that finish in
 * the background (such as saving into a Drive folder), from anywhere in the app.
 */

interface Notice {
  id: number;
  text: string;
  error: boolean;
}

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showNotice(text: string, error = false) {
  const id = nextId++;
  notices = [...notices, { id, text, error }];
  emit();
  // Good news goes away by itself; problems stay until dismissed.
  if (!error) window.setTimeout(() => dismissNotice(id), 4000);
}

export function dismissNotice(id: number) {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

export function Notices() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => notices,
  );
  if (!list.length) return null;
  return (
    <div className="notices" role="status">
      {list.map((n) => (
        <div key={n.id} className={`notice-line${n.error ? ' error' : ''}`}>
          <span>{n.text}</span>
          <button onClick={() => dismissNotice(n.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
