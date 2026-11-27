import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useBgStatus } from './bg/removeBackground';
import { deviceAt, highlightDevice } from './Dock';
import type { FlowInfo } from './flow';
import { renderAll } from './markup';
import { PdfView } from './PdfView';
import type { Point } from './hooks';
import { bringToFront, updateItem } from './store';
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
}

/** A text item's content as HTML: its portion of a story if linked, else its own text. */
export function itemHtml(item: Item, flow: FlowInfo | undefined): string {
  return flow ? flow.html : renderAll(item.text ?? '');
}

const MIN_SIZE = 12;
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
}: Props) {
  const [editing, setEditing] = useState(false);
  const busy = useBgStatus(item.id);
  /** An embedded page being used: the mouse goes to the page, not to moving the item. */
  const framed = item.type === 'embed' || item.type === 'pdf' || item.type === 'video';
  const using = framed && editing;
  const ownText = item.type === 'text' && !flow ? (item.text ?? '') : null;
  const ownHtml = useMemo(() => (ownText === null ? '' : renderAll(ownText)), [ownText]);
  const html = flow ? flow.html : ownHtml;
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected) setEditing(false);
  }, [selected]);

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
      onEnd?.(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function onBodyPointerDown(e: ReactPointerEvent) {
    if (editing) {
      e.stopPropagation();
      return;
    }
    onSelect(item.id);
    bringToFront(item.id);
    const start = toWorld(e.clientX, e.clientY);
    const { x, y } = item;
    startDrag(
      e,
      (p, ev) => {
        updateItem(item.id, { x: x + p.x - start.x, y: y + p.y - start.y });
        highlightDevice(deviceAt(ev.clientX, ev.clientY));
      },
      (ev) => {
        // Dropped on a device in the dock: send it to that Stage, and put its
        // marker back where the item sat before the drag.
        const target = ev.type === 'pointerup' ? deviceAt(ev.clientX, ev.clientY) : null;
        highlightDevice(null);
        if (target) updateItem(item.id, { x, y, location: target });
        else onDragEnd?.(item.id);
      },
    );
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
      updateItem(item.id, { x: nc.x - nw / 2, y: nc.y - nh / 2, w: nw, h: nh });
    });
  }

  function onRotatePointerDown(e: ReactPointerEvent) {
    const centre = { x: item.x + item.w / 2, y: item.y + item.h / 2 };
    startDrag(e, (p, ev) => {
      let deg = (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI + 90;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      updateItem(item.id, { rot: deg });
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
    if (item.type === 'text' || framed) setEditing(true);
    else if (item.type === 'layout') onOpen?.(item);
  }

  return (
    <div
      className={`item item-${item.type}${framed ? ' item-framed' : ''}${selected ? ' selected' : ''}${editing ? ' editing' : ''}${unit === 'pt' ? ' on-page' : ''}${busy ? ' busy' : ''}`}
      style={boxStyle(item, unit)}
      onPointerDown={onBodyPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {item.type === 'image' && <img src={item.src} alt="" draggable={false} />}
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
      {framed && (
        <>
          <div className="embed-bar">
            <span>{item.label ?? 'Link'}</span>
            <span className="hint">{using ? 'Click outside to move it' : 'Double-click to use'}</span>
          </div>
          {item.type === 'embed' && (
            <iframe
              src={item.url}
              title={item.label ?? 'Embedded page'}
              allow="autoplay; fullscreen; clipboard-read; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          )}
          {item.type === 'video' && <video src={item.url} controls preload="metadata" playsInline />}
          {item.type === 'pdf' && item.url && <PdfView url={item.url} />}
          {/* A cover takes the mouse so the item can be dragged; it lifts while the content is in use. */}
          {!using && <div className="embed-cover" />}
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
          <div className="handle rotate" onPointerDown={onRotatePointerDown} />
        </>
      )}
    </div>
  );
}
