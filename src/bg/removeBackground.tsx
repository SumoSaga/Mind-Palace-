import { useSyncExternalStore } from 'react';
import { updateItem } from '../store';
import type { Item } from '../store';
import type { WorkerReply, WorkerRequest } from './worker';

/**
 * One-click background removal, run on this device. The original image is
 * kept alongside the cut-out, so the background can always be restored.
 */

// --- per-item progress, for the button label and the busy state ---------------

const status = new Map<string, string>();
const listeners = new Set<() => void>();

function setStatus(itemId: string, message: string | null) {
  if (message === null) status.delete(itemId);
  else status.set(itemId, message);
  listeners.forEach((l) => l());
}

/** The progress message while an item's background is being removed, else undefined. */
export function useBgStatus(itemId: string | undefined): string | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (itemId ? status.get(itemId) : undefined),
  );
}

// --- the worker --------------------------------------------------------------

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (r: Extract<WorkerReply, { type: 'done' }>) => void; reject: (e: Error) => void; onStatus: (m: string) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const reply = e.data;
    const entry = pending.get(reply.id);
    if (!entry) return;
    if (reply.type === 'status') entry.onStatus(reply.message);
    else {
      pending.delete(reply.id);
      if (reply.type === 'done') entry.resolve(reply);
      else entry.reject(new Error(reply.message));
    }
  };
  worker.onerror = (e) => {
    for (const entry of pending.values()) entry.reject(new Error(e.message || 'Background removal could not start'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function cutOut(src: string, onStatus: (m: string) => void) {
  return new Promise<Extract<WorkerReply, { type: 'done' }>>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onStatus });
    getWorker().postMessage({ id, src } satisfies WorkerRequest);
  });
}

export async function removeBackground(item: Item) {
  if (item.type !== 'image' || !item.src || status.has(item.id)) return;
  const original = item.originalSrc ?? item.src;
  setStatus(item.id, 'Starting…');
  try {
    const { rgba, width, height } = await cutOut(original, (m) => setStatus(item.id, m));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    updateItem(item.id, { src: canvas.toDataURL('image/png'), originalSrc: original });
  } catch (err) {
    window.alert(`Background removal failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setStatus(item.id, null);
  }
}

export function restoreBackground(item: Item) {
  if (item.originalSrc) updateItem(item.id, { src: item.originalSrc, originalSrc: undefined });
}

/** Toolbar buttons for the selected image: remove, and restore once removed. */
export function BackgroundButtons({ item }: { item: Item | undefined }) {
  const busy = useBgStatus(item?.id);
  if (!item || item.type !== 'image') return null;
  return (
    <>
      <button disabled={!!busy} onClick={() => void removeBackground(item)}>
        {busy ?? 'Remove background'}
      </button>
      {item.originalSrc && !busy && <button onClick={() => restoreBackground(item)}>Restore background</button>}
    </>
  );
}
