import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePanZoom } from '../hooks';
import { updateItem, useItems } from '../store';

/**
 * Refine a cut-out by hand: an Erase brush removes leftover background and a
 * Restore brush paints the original image back. The original is never changed;
 * the brushes edit a transparency mask laid over it.
 */

// --- which image is being refined (one at a time, app-wide) -------------------

let refineId: string | null = null;
const listeners = new Set<() => void>();

export function openRefine(itemId: string | null) {
  refineId = itemId;
  listeners.forEach((l) => l());
}

export function useRefineId(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => refineId,
  );
}

// --- the editor --------------------------------------------------------------

type Mode = 'erase' | 'restore';
const MAX_UNDO = 10;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the image'));
    img.src = src;
  });
}

export function RefineEditor({ itemId }: { itemId: string }) {
  const item = useItems().find((it) => it.id === itemId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The untouched image, and the mask whose transparency decides what shows. */
  const original = useRef<HTMLCanvasElement | null>(null);
  const mask = useRef<HTMLCanvasElement | null>(null);
  const undoStack = useRef<ImageData[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>('erase');
  const [size, setSize] = useState(40);
  const [maxSize, setMaxSize] = useState(300);
  const [undoCount, setUndoCount] = useState(0);
  const [ring, setRing] = useState<{ x: number; y: number; d: number } | null>(null);
  const { rootRef, view, setView, handlers } = usePanZoom();

  const close = () => openRefine(null);
  const originalSrc = item?.originalSrc ?? item?.src;
  const currentSrc = item?.src;

  // The image was deleted (here or on another device): leave.
  useEffect(() => {
    if (!item) close();
  }, [item]);

  /** Draws the original image, shown only where the mask is opaque. */
  function render() {
    const canvas = canvasRef.current;
    if (!canvas || !original.current || !mask.current) return;
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(original.current, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask.current, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Load once, when the editor opens.
  useEffect(() => {
    if (!originalSrc || !currentSrc) return;
    let cancelled = false;
    void Promise.all([loadImage(originalSrc), loadImage(currentSrc)]).then(([o, c]) => {
      if (cancelled || !canvasRef.current || !rootRef.current) return;
      const w = o.naturalWidth;
      const h = o.naturalHeight;
      const make = (img: HTMLImageElement) => {
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        cv.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0, w, h);
        return cv;
      };
      original.current = make(o);
      mask.current = make(c); // only its transparency is used
      canvasRef.current.width = w;
      canvasRef.current.height = h;
      render();
      const r = rootRef.current.getBoundingClientRect();
      const k = Math.max(0.05, Math.min(4, (r.width - 60) / w, (r.height - 60) / h));
      setView({ k, x: (r.width - w * k) / 2, y: (r.height - h * k) / 2 });
      const longest = Math.max(w, h);
      setMaxSize(Math.max(40, Math.round(longest / 3)));
      setSize(Math.max(4, Math.round(longest / 20)));
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  function toCanvas(e: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * canvas.width) / r.width,
      y: ((e.clientY - r.top) * canvas.height) / r.height,
      scale: r.width / canvas.width,
    };
  }

  function pushUndo() {
    const m = mask.current!;
    undoStack.current.push(m.getContext('2d')!.getImageData(0, 0, m.width, m.height));
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
  }

  function undo() {
    const snapshot = undoStack.current.pop();
    if (!snapshot || !mask.current) return;
    mask.current.getContext('2d')!.putImageData(snapshot, 0, 0);
    setUndoCount(undoStack.current.length);
    render();
  }

  function stroke(from: { x: number; y: number }, to: { x: number; y: number }) {
    const ctx = mask.current!.getContext('2d')!;
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    // A zero-length line draws nothing, so nudge a single click into a dot.
    ctx.lineTo(to.x + (from.x === to.x && from.y === to.y ? 0.01 : 0), to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    render();
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (!ready || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pushUndo();
    const p = toCanvas(e);
    last.current = p;
    stroke(p, p);
  }

  function onPointerMove(e: ReactPointerEvent) {
    const p = toCanvas(e);
    setRing({ x: e.clientX, y: e.clientY, d: size * p.scale });
    if (last.current) {
      stroke(last.current, p);
      last.current = p;
    }
  }

  function endStroke() {
    last.current = null;
  }

  function showAll() {
    if (!mask.current) return;
    pushUndo();
    const ctx = mask.current.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, mask.current.width, mask.current.height);
    render();
  }

  function save() {
    if (!canvasRef.current || !originalSrc) return;
    updateItem(itemId, { src: canvasRef.current.toDataURL('image/png'), originalSrc });
    close();
  }

  // Shortcuts. The Desk and layout editor ignore keys while this is open.
  const keys = useRef({ undo, setMode, setSize, maxSize });
  keys.current = { undo, setMode, setSize, maxSize };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        k.undo();
      } else if (key === 'e') k.setMode('erase');
      else if (key === 'r') k.setMode('restore');
      else if (key === '[') k.setSize((s) => Math.max(2, Math.round(s * 0.8)));
      else if (key === ']') k.setSize((s) => Math.min(k.maxSize, Math.round(s * 1.25) + 1));
      else if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!item) return null;

  return (
    <div className="refine">
      <div className="editor-bar">
        <div className="views">
          <button className={mode === 'erase' ? 'active' : ''} onClick={() => setMode('erase')} title="Shortcut: E">
            Erase
          </button>
          <button className={mode === 'restore' ? 'active' : ''} onClick={() => setMode('restore')} title="Shortcut: R">
            Restore
          </button>
        </div>
        <label title="Shortcuts: [ and ]">
          Brush size
          <input
            type="range"
            min={2}
            max={maxSize}
            value={size}
            onChange={(e) => setSize(+e.target.value)}
          />
        </label>
        <button disabled={undoCount === 0} onClick={undo}>
          Undo
        </button>
        <button disabled={!ready} onClick={showAll} title="Bring the whole original image back">
          Restore everything
        </button>
        <span className="hint">Scroll to zoom. Drag outside the image to move it.</span>
        <span className="spacer" />
        <button onClick={close}>Cancel</button>
        <button className="on" disabled={!ready} onClick={save}>
          Done
        </button>
      </div>

      <div className="editor-body">
        <div ref={rootRef} className="desk" {...handlers}>
          <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
            <canvas
              ref={canvasRef}
              className="refine-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={() => setRing(null)}
            />
          </div>
        </div>
        {!ready && <p className="refine-loading">Loading image…</p>}
      </div>

      {ring && (
        <div
          className={`brush-ring ${mode}`}
          style={{ left: ring.x - ring.d / 2, top: ring.y - ring.d / 2, width: ring.d, height: ring.d }}
        />
      )}
    </div>
  );
}
