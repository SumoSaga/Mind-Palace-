import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface Point {
  x: number;
  y: number;
}

export interface View {
  /** Screen offset of the surface origin, in pixels. */
  x: number;
  y: number;
  /** Zoom factor. */
  k: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

function zoomAt(v: View, cx: number, cy: number, factor: number): View {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
  const ratio = k / v.k;
  return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
}

/**
 * Pan and zoom for a surface. Dragging the background (the root element, or
 * any child marked with `data-pan`) pans; the wheel or a two-finger pinch zooms.
 */
export function usePanZoom(onBackgroundDown?: () => void) {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, Point>());
  const backgroundRef = useRef(onBackgroundDown);
  backgroundRef.current = onBackgroundDown;

  /** Converts a screen position to surface coordinates (pixels at zoom 1). */
  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const v = viewRef.current;
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  }, []);

  // Wheel zoom needs a non-passive listener so the page itself does not scroll or zoom.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView((v) => zoomAt(v, e.clientX - r.left, e.clientY - r.top, factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const end = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  const handlers = {
    onPointerDown(e: ReactPointerEvent) {
      const target = e.target as HTMLElement;
      if (target !== e.currentTarget && target.dataset.pan === undefined) return;
      (document.activeElement as HTMLElement | null)?.blur();
      backgroundRef.current?.();
      e.currentTarget.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    },
    onPointerMove(e: ReactPointerEvent) {
      const map = pointers.current;
      const prev = map.get(e.pointerId);
      if (!prev) return;
      const next = { x: e.clientX, y: e.clientY };
      if (map.size === 1) {
        setView((v) => ({ ...v, x: v.x + next.x - prev.x, y: v.y + next.y - prev.y }));
      } else if (map.size === 2) {
        const other = [...map.entries()].find(([id]) => id !== e.pointerId)![1];
        const r = rootRef.current!.getBoundingClientRect();
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(next.x - other.x, next.y - other.y);
        const midBefore = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
        const midAfter = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 };
        setView((v) => {
          const z = zoomAt(v, midBefore.x - r.left, midBefore.y - r.top, before > 0 ? after / before : 1);
          return { ...z, x: z.x + midAfter.x - midBefore.x, y: z.y + midAfter.y - midBefore.y };
        });
      }
      map.set(e.pointerId, next);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };

  return { rootRef, view, setView, toWorld, handlers };
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

interface EditingKeys {
  /** Shortcuts are ignored while false. */
  active: boolean;
  onDelete: () => void;
  onEscape: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPasteFiles: (files: File[]) => void;
  onPasteText: (text: string) => void;
}

/** Delete, undo/redo, Escape and paste for a surface, unless the user is typing in a field. */
export function useEditingKeys(options: EditingKeys) {
  const ref = useRef(options);
  ref.current = options;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const o = ref.current;
      if (!o.active || isTyping()) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        o.onDelete();
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) o.onRedo();
        else o.onUndo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        o.onRedo();
      } else if (e.key === 'Escape') {
        o.onEscape();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const o = ref.current;
      if (!o.active || isTyping() || !e.clipboardData) return;
      const files = Array.from(e.clipboardData.files);
      if (files.length) {
        e.preventDefault();
        o.onPasteFiles(files);
        return;
      }
      const text = e.clipboardData.getData('text/plain');
      if (text.trim()) {
        e.preventDefault();
        o.onPasteText(text);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
}

/** Reads an image file into a data URL and reports its pixel size. */
export function readImage(file: File): Promise<{ src: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read image'));
      img.onload = () => resolve({ src, w: img.naturalWidth, h: img.naturalHeight });
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
