import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useBgStatus } from './bg/removeBackground';
import { fillTemplate, valueOf } from './cards/table';
import { deviceAt, highlightDevice } from './Dock';
import type { FlowInfo } from './flow';
import { renderAll } from './markup';
import { ModelView } from './ModelView';
import { PdfView } from './PdfView';
import type { Point } from './hooks';
import { bringToFront, sendItem, updateItem } from './store';
import type { Item, Layout } from './store';

/** 'px' on the Desk; 'pt' on a layout page, so screen and print share one size. */
export type Unit = 'px' | 'pt';

interface Props {
  item: Item;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Converts a screen position to this surface's coordinates. */
  toWorld: (clientX: number, clientY: number) => Point;
  unit?: Unit;
  /** For layout cards: the layout they open, and what opening does. */
  layout?: Layout;
  onOpen?: (item: Item) => void;
  /** Called after the item has been dragged and released. */
  onDragEnd?: (id: string) => void;
  /** For a linked text frame: the part of its story it shows. */
  flow?: FlowInfo;
  /** Called with the edited text of a linked frame's portion. */
  onCommitFlowText?: (flow: FlowInfo, text: string) => void;
  /** Called when the "more text" marker on an overflowing frame is clicked. */
  onOverflowClick?: (item: Item) => void;
  /** In a card template: the data row being previewed, used to fill placeholders. */
  record?: Record<string, string>;
  /**
   * Where moves, resizes and sends are written. By default they go to the
   * item's own position; a Stage redirects them to the item's place on that Stage.
   */
  onChange?: (patch: Partial<Item>) => void;
  /** Hides the rotate handle, where rotation does not apply. */
  noRotate?: boolean;
  /**
   * The item is filling the screen: it is in use (touches go to its content),
   * cannot be dragged, and shows no frame around it.
   */
  fullScreen?: boolean;
  /** Puts the item full screen; shown as a button on a window's title bar. */
  onFullScreen?: (item: Item) => void;
  /** Opens the item's menu (right-click, or its "more" button), at a screen position. */
  onMenu?: (item: Item, clientX: number, clientY: number) => void;
}

/** The image an item shows: the row's value for its bound column if it has one, else its own. */
export function imageSrc(item: Item, record: Record<string, string> | undefined): string | undefined {
  const bound = record && item.bind ? valueOf(record, item.bind) : undefined;
  return bound?.trim() ? bound.trim() : item.src;
}

/** A text item's content as HTML: its portion of a story if linked, else its own text. */
export function itemHtml(item: Item, flow: FlowInfo | undefined, record?: Record<string, string>): string {
  if (flow) return flow.html;
  return renderAll(record ? fillTemplate(item.text ?? '', record) : (item.text ?? ''));
}

const MIN_SIZE = 12;
/** How long a window stays in arrange mode after the last pinch or drag. */
const ARRANGE_LINGER_MS = 3500;

/** A drag or pinch in progress on an item. */
interface Gesture {
  /** Screen positions of the fingers (or the mouse) involved. */
  touches: Map<number, Point>;
  /** Set while one finger is moving the item. */
  move: { start: Point; x: number; y: number } | null;
  /** Set while two fingers are resizing it. */
  pinch: { dist: number; w: number; h: number; cx: number; cy: number } | null;
  /** Whether this gesture has included a pinch at any point. */
  pinched: boolean;
  /** Where the item was when the gesture began. */
  home: Point;
  stop: () => void;
}
const CORNERS: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

function rotate(p: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function boxStyle(item: Item, unit: Unit): CSSProperties {
  const len = (v: number) => (unit === 'pt' ? `${v}pt` : v);
  return {
    left: len(item.x),
    top: len(item.y),
    width: len(item.w),
    height: len(item.h),
    zIndex: item.z,
    transform: `rotate(${item.rot}deg)`,
  };
}

export function textStyle(item: Item, unit: Unit): CSSProperties {
  return {
    // Quoted, because a name such as "Source Serif 4" is not valid CSS unquoted.
    fontFamily: item.fontFamily ? `"${item.fontFamily}"` : undefined,
    fontSize: item.fontSize ? `${item.fontSize}${unit}` : undefined,
    // Pages are paper: text defaults to dark ink whatever the app theme is.
    color: item.color ?? (unit === 'pt' ? '#1a1a1a' : undefined),
    textAlign: item.align,
    fontWeight: item.bold ? 700 : undefined,
    fontStyle: item.italic ? 'italic' : undefined,
    // Read by the heading rules in styles.css.
    ...(item.headingFont ? { ['--heading-font' as string]: `"${item.headingFont}"` } : {}),
    ...(item.headingColor ? { ['--heading-color' as string]: item.headingColor } : {}),
  };
}

export function ItemView({
  item,
  selected,
  onSelect,
  toWorld,
  unit = 'px',
  layout,
  onOpen,
  onDragEnd,
  flow,
  onCommitFlowText,
  onOverflowClick,
  record,
  onChange,
  noRotate,
  fullScreen,
  onFullScreen,
  onMenu,
}: Props) {
  /** Writes a move, resize, rotation or send. */
  const change = (patch: Partial<Item>) => {
    if (onChange) onChange(patch);
    else if ('location' in patch && patch.location) sendItem(item.id, patch.location, patch);
    else updateItem(item.id, patch);
  };
  const [editing, setEditing] = useState(false);
  const busy = useBgStatus(item.id);
  /** A window: a live page, video or PDF, with a title bar to move it by. */
  const framed = item.type === 'embed' || item.type === 'pdf' || item.type === 'video' || item.type === 'model';
  const ownText = item.type === 'text' && !flow ? (item.text ?? '') : null;
  const ownHtml = useMemo(
    () => (ownText === null ? '' : renderAll(record ? fillTemplate(ownText, record) : ownText)),
    [ownText, record],
  );
  const html = flow ? flow.html : ownHtml;
  const textRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The newest values, for pointer and wheel listeners that outlive one render.
  const live = useRef({ item, toWorld, change, onDragEnd });
  live.current = { item, toWorld, change, onDragEnd };
  const gesture = useRef<Gesture | null>(null);
  /**
   * Arrange mode, for touch screens. A web page cannot see fingers that land
   * inside another site's player, so a pinch over a live video cannot be
   * noticed directly. Touching a window's title bar therefore lays a cover
   * over its content for a few seconds: while it is there, a pinch or drag
   * anywhere on the window resizes or moves it. A tap on the cover, or a short
   * wait, removes it and the content is live again.
   */
  const [arranging, setArranging] = useState(false);
  const arrangeTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(arrangeTimer.current), []);

  useEffect(() => {
    if (!selected) {
      setEditing(false);
      setArranging(false);
    }
  }, [selected]);

  // Stop listening if the item goes away in the middle of a drag or pinch.
  useEffect(() => () => gesture.current?.stop(), []);

  // A pinch on a laptop trackpad reaches the page as a wheel event with Ctrl
  // set (as does Ctrl + mouse wheel). Over the selected item it resizes that
  // item about its centre; anywhere else it zooms the surface as before.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !selected || editing) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      const it = live.current.item;
      const w = Math.max(MIN_SIZE, it.w * Math.exp(-ev.deltaY * 0.01));
      const h = w * (it.h / it.w);
      live.current.change({ x: it.x + it.w / 2 - w / 2, y: it.y + it.h / 2 - h / 2, w, h });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [selected, editing]);

  useEffect(() => {
    if (editing && textRef.current) {
      textRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(textRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [editing]);

  /** Follows the pointer until it is released, reporting surface coordinates. */
  function startDrag(
    e: ReactPointerEvent,
    onMove: (p: Point, ev: PointerEvent) => void,
    onEnd?: (ev: PointerEvent) => void,
  ) {
    e.stopPropagation();
    e.preventDefault();
    const move = (ev: PointerEvent) => onMove(toWorld(ev.clientX, ev.clientY), ev);
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.body.classList.remove('moving-item');
      onEnd?.(ev);
    };
    document.body.classList.add('moving-item'); // see onBodyPointerDown
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /** Starts resizing with two fingers: the item grows and shrinks about its centre. */
  function beginPinch(g: Gesture) {
    const [a, b] = [...g.touches.values()];
    const it = live.current.item;
    g.pinch = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), w: it.w, h: it.h, cx: it.x + it.w / 2, cy: it.y + it.h / 2 };
    g.move = null;
    g.pinched = true;
    highlightDevice(null);
  }

  /**
   * One finger (or the mouse) on an item moves it. A second finger turns that
   * into a pinch, which resizes it. Lifting back to one finger carries on moving.
   */
  function onBodyPointerDown(e: ReactPointerEvent) {
    if (editing || fullScreen) {
      e.stopPropagation();
      return;
    }
    // A window is moved by its title bar. A press anywhere else in it belongs
    // to the content (the video's controls, the PDF's buttons), so it is left
    // alone, unless the window is in arrange mode (see `arranging`).
    const onCover = !!(e.target as HTMLElement).closest('.arrange-cover');
    if (framed && !onCover && !(e.target as HTMLElement).closest('.embed-bar')) {
      e.stopPropagation();
      onSelect(item.id);
      bringToFront(item.id);
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    // Touching a window's title bar puts it in arrange mode.
    window.clearTimeout(arrangeTimer.current);
    if (framed && e.pointerType === 'touch') setArranging(true);
    const pressedAt = Date.now();
    const pressedWhere = { x: e.clientX, y: e.clientY };
    let travelled = 0;
    const active = gesture.current;
    if (active) {
      // A second finger landing on the item itself.
      if (!active.touches.has(e.pointerId) && active.touches.size === 1) {
        active.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        beginPinch(active);
      }
      return;
    }
    onSelect(item.id);
    bringToFront(item.id);

    const onMove = (ev: PointerEvent) => {
      const g = gesture.current;
      if (!g || !g.touches.has(ev.pointerId)) return;
      g.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      travelled = Math.max(travelled, Math.hypot(ev.clientX - pressedWhere.x, ev.clientY - pressedWhere.y));
      if (g.pinch) {
        const [a, b] = [...g.touches.values()];
        const scale = Math.hypot(a.x - b.x, a.y - b.y) / g.pinch.dist;
        const w = Math.max(MIN_SIZE, g.pinch.w * scale);
        const h = w * (g.pinch.h / g.pinch.w); // keep the item's proportions
        live.current.change({ x: g.pinch.cx - w / 2, y: g.pinch.cy - h / 2, w, h });
      } else if (g.move) {
        const p = live.current.toWorld(ev.clientX, ev.clientY);
        live.current.change({ x: g.move.x + p.x - g.move.start.x, y: g.move.y + p.y - g.move.start.y });
        if (!g.pinched) highlightDevice(deviceAt(ev.clientX, ev.clientY));
      }
    };
    const onEnd = (ev: PointerEvent) => {
      const g = gesture.current;
      if (!g || !g.touches.has(ev.pointerId)) return;
      g.touches.delete(ev.pointerId);
      if (g.touches.size === 1) {
        // Back to one finger: carry on moving from where the item is now.
        const [p] = [...g.touches.values()];
        const it = live.current.item;
        g.pinch = null;
        g.move = { start: live.current.toWorld(p.x, p.y), x: it.x, y: it.y };
        return;
      }
      if (g.touches.size > 1) return;
      g.stop();
      gesture.current = null;
      highlightDevice(null);
      // A quick tap on the arrange cover means "I am done arranging": the
      // content goes live again. Otherwise arrange mode lingers a few seconds,
      // long enough for another pinch or drag, then ends by itself.
      const tapped = onCover && !g.pinched && travelled < 8 && Date.now() - pressedAt < 350;
      if (tapped) setArranging(false);
      else arrangeTimer.current = window.setTimeout(() => setArranging(false), ARRANGE_LINGER_MS);
      // Dropped on a device in the dock: send it to that Stage, and put its
      // marker back where the item sat before the drag. Not after a pinch.
      const target = !g.pinched && ev.type === 'pointerup' ? deviceAt(ev.clientX, ev.clientY) : null;
      if (target) live.current.change({ x: g.home.x, y: g.home.y, location: target });
      else live.current.onDragEnd?.(live.current.item.id);
    };
    // A second finger often lands beside a small item rather than on it. While
    // one finger holds this item, any other finger joins its pinch, and is kept
    // from panning the surface underneath.
    const onOtherFinger = (ev: PointerEvent) => {
      const g = gesture.current;
      if (!g || ev.pointerType !== 'touch' || g.touches.has(ev.pointerId) || g.touches.size !== 1) return;
      ev.stopPropagation();
      ev.preventDefault();
      g.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      beginPinch(g);
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('pointerdown', onOtherFinger, true);
      document.body.classList.remove('moving-item');
    };
    // While something is being moved, live pages and videos stop taking the
    // pointer (see styles.css); otherwise the drag would stall whenever the
    // pointer crossed one, and a second finger on one could not join a pinch.
    document.body.classList.add('moving-item');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('pointerdown', onOtherFinger, true);

    gesture.current = {
      touches: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]),
      move: { start: toWorld(e.clientX, e.clientY), x: item.x, y: item.y },
      pinch: null,
      pinched: false,
      home: { x: item.x, y: item.y },
      stop,
    };
  }

  function onResizePointerDown(e: ReactPointerEvent, sx: number, sy: number) {
    const { x, y, w, h, rot, type } = item;
    const centre = { x: x + w / 2, y: y + h / 2 };
    // The corner opposite the dragged handle stays fixed on the surface.
    const offset = rotate({ x: (-sx * w) / 2, y: (-sy * h) / 2 }, rot);
    const anchor = { x: centre.x + offset.x, y: centre.y + offset.y };
    const aspect = w / h;
    startDrag(e, (p) => {
      const local = rotate({ x: p.x - anchor.x, y: p.y - anchor.y }, -rot);
      let nw = Math.max(MIN_SIZE, local.x * sx);
      let nh = Math.max(MIN_SIZE, local.y * sy);
      if (type === 'image') nh = nw / aspect; // images keep their proportions
      const half = rotate({ x: (sx * nw) / 2, y: (sy * nh) / 2 }, rot);
      const nc = { x: anchor.x + half.x, y: anchor.y + half.y };
      change({ x: nc.x - nw / 2, y: nc.y - nh / 2, w: nw, h: nh });
    });
  }

  function onRotatePointerDown(e: ReactPointerEvent) {
    const centre = { x: item.x + item.w / 2, y: item.y + item.h / 2 };
    startDrag(e, (p, ev) => {
      let deg = (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI + 90;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      change({ rot: deg });
    });
  }

  function finishEditing() {
    if (!editing) return;
    const text = textRef.current?.innerText ?? '';
    if (flow) onCommitFlowText?.(flow, text);
    else updateItem(item.id, { text });
    setEditing(false);
  }

  function onDoubleClick() {
    if (item.type === 'text') setEditing(true);
    else if (item.type === 'link' && item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
    else if (item.type === 'layout') onOpen?.(item);
  }

  return (
    <div
      className={`item item-${item.type}${framed ? ' item-framed' : ''}${selected ? ' selected' : ''}${editing ? ' editing' : ''}${unit === 'pt' ? ' on-page' : ''}${busy ? ' busy' : ''}${fullScreen ? ' full-screen' : ''}`}
      ref={rootRef}
      style={boxStyle(item, unit)}
      onPointerDown={onBodyPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        if (!onMenu || editing) return;
        e.preventDefault();
        onSelect(item.id);
        onMenu(item, e.clientX, e.clientY);
      }}
    >
      {item.type === 'image' && (
        <img src={imageSrc(item, record)} alt="" draggable={false} className={item.bind ? 'bound' : undefined} />
      )}
      {item.type === 'text' &&
        (editing ? (
          // While editing, the source text is shown, markup and all.
          <div
            key="edit"
            ref={textRef}
            className="text"
            style={textStyle(item, unit)}
            contentEditable
            suppressContentEditableWarning
            onBlur={finishEditing}
            onKeyDown={(e) => {
              if (e.key === 'Escape') (e.target as HTMLElement).blur();
            }}
          >
            {flow ? flow.text : item.text}
          </div>
        ) : (
          <div key="view" className="text" style={textStyle(item, unit)} dangerouslySetInnerHTML={{ __html: html }} />
        ))}
      {flow?.overflow && !editing && (
        <button
          className="overflow-mark"
          title="There is more text than fits. Click to continue it on the next page."
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onOverflowClick?.(item)}
        >
          +
        </button>
      )}
      {item.type === 'link' && (
        <div className="link-card">
          {item.src && <img src={item.src} alt="" draggable={false} referrerPolicy="no-referrer" />}
          <div className="link-card-text">
            <span className="link-site">{item.label}</span>
            <strong>{item.text}</strong>
          </div>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => item.url && window.open(item.url, '_blank', 'noopener,noreferrer')}
            title="This site cannot be shown inside another page, so it opens in a new tab"
          >
            Open in a new tab ↗
          </button>
        </div>
      )}
      {framed && (
        <>
          {/*
            A window: the title bar moves it (always), and everything below the
            bar is the live content, which takes clicks and touches directly.
          */}
          <div className="embed-bar" title="Drag to move">
            <span className="grip" aria-hidden="true">
              ⠿
            </span>
            <span className="embed-title">{item.label ?? 'Link'}</span>
            {item.type === 'embed' && (
              <button
                className="embed-open"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => item.url && window.open(item.url, '_blank', 'noopener,noreferrer')}
                aria-label="Open in a new tab"
                title="Open in a new tab. Use this if the page stays blank here."
              >
                ↗
              </button>
            )}
            {onFullScreen && (
              <button
                className="embed-open"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onFullScreen(item)}
                aria-label="Full screen"
                title="Full screen"
              >
                ⛶
              </button>
            )}
            {onMenu && (
              <button
                className="embed-open"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  onSelect(item.id);
                  onMenu(item, r.left, r.bottom + 4);
                }}
                aria-label="More options"
                title="More options"
              >
                ⋯
              </button>
            )}
          </div>
          {item.type === 'embed' && (
            <iframe
              src={item.url}
              title={item.label ?? 'Embedded page'}
              allow="autoplay; fullscreen; clipboard-read; clipboard-write; encrypted-media; picture-in-picture"
              // Video sites refuse to play without knowing which page is showing them.
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          )}
          {item.type === 'video' && <video src={item.url} controls preload="metadata" playsInline />}
          {item.type === 'pdf' && item.url && <PdfView url={item.url} />}
          {item.type === 'model' && item.url && <ModelView url={item.url} name={item.label ?? ''} />}
          {arranging && !fullScreen && (
            <div className="arrange-cover">
              <span>Pinch to resize · drag to move · tap to use</span>
            </div>
          )}
          {/* A corner to resize by, always there, since the content itself takes the pointer. */}
          {!fullScreen && <div className="window-grip" title="Drag to resize" onPointerDown={(e) => onResizePointerDown(e, 1, 1)} />}
        </>
      )}
      {item.type === 'layout' && (
        <div className="layout-card">
          <div className="layout-card-page" />
          <strong>{layout?.name ?? 'Layout'}</strong>
          {layout && (
            <span>
              {+(layout.w / 72).toFixed(2)} × {+(layout.h / 72).toFixed(2)} in
            </span>
          )}
          <span className="hint">Double-click to open</span>
        </div>
      )}
      {selected && !editing && (
        <>
          {CORNERS.map(([sx, sy]) => (
            <div
              key={`${sx},${sy}`}
              className="handle"
              style={{ left: sx < 0 ? 0 : '100%', top: sy < 0 ? 0 : '100%' }}
              onPointerDown={(e) => onResizePointerDown(e, sx, sy)}
            />
          ))}
          {!noRotate && <div className="handle rotate" onPointerDown={onRotatePointerDown} />}
          {onMenu && (
            // The same menu as right-click, for touch screens where there is no right-click.
            <button
              className="item-more"
              aria-label="More options"
              title="More options"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onMenu(item, r.left, r.bottom + 4);
              }}
            >
              ⋯
            </button>
          )}
        </>
      )}
    </div>
  );
}
