import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { AddBar } from './AddBar';
import { PdfThumb } from './PdfView';
import { isPageLocation, removeItem, sendItem, undoManager, useItems, useLayouts } from './store';
import type { Item, Layout } from './store';
import { kindLabel, thisDevice, useDevices, useKnownDevices } from './sync';
import type { Device } from './sync';

const TYPE_WORD: Record<Item['type'], string> = {
  text: 'Text',
  image: 'Image',
  layout: 'Layout',
  embed: 'Live page',
  pdf: 'PDF',
  video: 'Video',
  link: 'Link',
  model: '3D model',
};

function titleOf(item: Item, layouts: Layout[]): string {
  if (item.type === 'layout') return layouts.find((l) => l.id === item.layoutId)?.name ?? 'Layout';
  if (item.type === 'text' || item.type === 'link') {
    const text = (item.text ?? '').replace(/[#*]/g, '').trim().replace(/\s+/g, ' ');
    return text ? (text.length > 60 ? `${text.slice(0, 60)}…` : text) : TYPE_WORD[item.type];
  }
  return item.label ?? TYPE_WORD[item.type];
}

/** The still picture YouTube publishes for a video, from its player address. */
function youTubePicture(url: string | undefined): string | null {
  const id = /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,})/.exec(url ?? '')?.[1];
  return id && id !== 'videoseries' ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** A picture of an item: the thing itself where that is cheap, otherwise a labelled tile. */
function Thumbnail({ item, layouts }: { item: Item; layouts: Layout[] }) {
  if (item.type === 'image' && item.src) return <img src={item.src} alt="" draggable={false} />;
  if (item.type === 'link' && item.src) return <img src={item.src} alt="" draggable={false} referrerPolicy="no-referrer" />;
  if (item.type === 'video' && item.url) {
    // Shows the first frame without playing: nudged forward so it is not a blank start.
    return (
      <video
        src={item.url}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = 0.1;
        }}
      />
    );
  }
  if (item.type === 'pdf' && item.url) return <PdfThumb url={item.url} />;
  if (item.type === 'embed') {
    const picture = youTubePicture(item.url);
    if (picture) {
      return (
        <>
          <img src={picture} alt="" draggable={false} referrerPolicy="no-referrer" />
          <span className="thumb-play" aria-hidden="true">
            ▶
          </span>
        </>
      );
    }
    return <span className="thumb-tile">{item.label ?? 'Live page'}</span>;
  }
  if (item.type === 'text') return <span className="thumb-words">{(item.text ?? '').replace(/[#*]/g, '').slice(0, 220)}</span>;
  if (item.type === 'layout') {
    const layout = layouts.find((l) => l.id === item.layoutId);
    return (
      <span className="thumb-page" style={layout ? { aspectRatio: `${layout.w} / ${layout.h}` } : undefined}>
        {layout ? `${+(layout.w / 72).toFixed(1)} × ${+(layout.h / 72).toFixed(1)} in` : ''}
      </span>
    );
  }
  return <span className="thumb-tile">{item.label ?? TYPE_WORD[item.type]}</span>;
}

/** The "desk" location: things that are not on any device. */
const SHELF = 'desk';
/** How long a finger must rest on a thumbnail before it lifts, so a swipe still scrolls. */
const HOLD_MS = 220;

interface Drag {
  id: string;
  /** Where the thumbnail is drawn, following the pointer. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The panel under the pointer. */
  over: string | null;
}

/**
 * The Overview: one panel per device, showing a thumbnail of each thing that
 * has been sent to or opened on it, plus a panel for things not on any device.
 * A thumbnail can be picked up and dropped on another device to move it there.
 */
export function Overview({
  onOpenLayout,
  onOpenCanvas,
  onOpenStage,
}: {
  onOpenLayout: (layoutId: string) => void;
  onOpenCanvas: () => void;
  onOpenStage: () => void;
}) {
  const items = useItems().filter((it) => !isPageLocation(it.location));
  const layouts = useLayouts();
  const online = useDevices();
  const known = useKnownDevices();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  /** Removes the listeners of a press or drag in progress. */
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  // This device first, then the other connected ones, then any that are away
  // but still hold something.
  const onlineIds = new Set(online.map((d) => d.id));
  const held = new Set(items.map((it) => it.location).filter((loc) => loc !== SHELF));
  const away: Device[] = [...held]
    .filter((id) => !onlineIds.has(id))
    .map((id) => known.get(id) ?? { id, name: 'Unknown device', kind: 'computer' });
  const devices = [...online, ...away];
  const places = [
    ...devices.map((d) => ({ id: d.id, name: d.id === thisDevice.id ? `${d.name} (this device)` : d.name })),
    { id: SHELF, name: 'Not on a device' },
  ];
  const shelf = items.filter((it) => it.location === SHELF);

  /** The panel at a point on the screen. */
  const placeAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest('[data-place]') as HTMLElement | null)?.dataset.place ?? null;

  /**
   * Picking up a thumbnail. With a mouse it lifts as soon as it is moved. With
   * a finger it lifts after a short hold, so that swiping over the thumbnails
   * still scrolls the page.
   */
  function onCardPointerDown(e: ReactPointerEvent<HTMLElement>, item: Item) {
    if ((e.target as HTMLElement).closest('.ov-card-actions') || e.button !== 0) return;
    cleanup.current?.();
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const pointerId = e.pointerId;
    const touch = e.pointerType === 'touch';
    let lifted = false;
    let timer = 0;

    const lift = (x: number, y: number) => {
      lifted = true;
      if (touch) navigator.vibrate?.(8); // a small buzz to say it has been picked up
      setDrag({ id: item.id, x: x - grab.x, y: y - grab.y, w: rect.width, h: rect.height, over: placeAt(x, y) });
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const moved = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
      if (!lifted) {
        if (touch) {
          if (moved > 10) finish(); // a swipe: let the page scroll
          return;
        }
        if (moved < 5) return;
        lift(ev.clientX, ev.clientY);
      }
      setDrag((d) => d && { ...d, x: ev.clientX - grab.x, y: ev.clientY - grab.y, over: placeAt(ev.clientX, ev.clientY) });
      // Near the top or bottom edge, scroll to reach panels that are off screen.
      const scroller = scrollRef.current;
      if (scroller) {
        if (ev.clientY < 90) scroller.scrollTop -= 14;
        else if (ev.clientY > window.innerHeight - 120) scroller.scrollTop += 14;
      }
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const d = dragRef.current;
      if (lifted && d) {
        const target = placeAt(ev.clientX, ev.clientY);
        if (target && target !== item.location) sendItem(item.id, target);
      }
      finish();
    };
    const onCancel = (ev: PointerEvent) => ev.pointerId === pointerId && finish();
    // Once a thumbnail is lifted, the finger moves it rather than scrolling the page.
    const onTouchMove = (ev: TouchEvent) => {
      if (lifted && ev.cancelable) ev.preventDefault();
    };
    function finish() {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', onTouchMove);
      cleanup.current = null;
      setDrag(null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    cleanup.current = finish;
    if (touch) timer = window.setTimeout(() => lift(start.x, start.y), HOLD_MS);
    else e.preventDefault(); // no text selection while dragging with a mouse
  }

  function card(it: Item) {
    const title = titleOf(it, layouts);
    return (
      <li
        key={it.id}
        className={`ov-card${drag?.id === it.id ? ' lifted' : ''}`}
        onPointerDown={(e) => onCardPointerDown(e, it)}
        onContextMenu={(e) => e.preventDefault()}
        title="Drag onto another device to move it there"
      >
        <div className={`ov-thumb ov-thumb-${it.type}`}>
          <Thumbnail item={it} layouts={layouts} />
        </div>
        <strong>{title}</strong>
        <span className="ov-kind">{TYPE_WORD[it.type]}</span>
        <div className="ov-card-actions">
          {it.type === 'layout' && it.layoutId && <button onClick={() => onOpenLayout(it.layoutId!)}>Open</button>}
          {it.type === 'link' && it.url && (
            <button onClick={() => window.open(it.url, '_blank', 'noopener,noreferrer')}>Open ↗</button>
          )}
          <select aria-label={`Move ${title} to`} value="" onChange={(e) => e.target.value && sendItem(it.id, e.target.value)}>
            <option value="">Move…</option>
            {places
              .filter((p) => p.id !== it.location)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <button className="ov-delete" onClick={() => removeItem(it.id)} aria-label={`Delete ${title}`} title="Delete (Undo brings it back)">
            ×
          </button>
        </div>
      </li>
    );
  }

  function panel(id: string, heading: ReactNode, list: Item[], emptyText: string) {
    const target = drag && drag.over === id && items.find((it) => it.id === drag.id)?.location !== id;
    return (
      <section key={id} data-place={id} className={`ov-panel${target ? ' drop' : ''}${id === thisDevice.id ? ' mine' : ''}`}>
        <header>{heading}</header>
        {list.length === 0 ? <p className="ov-empty">{drag ? 'Drop here' : emptyText}</p> : <ul className="ov-cards">{list.map(card)}</ul>}
      </section>
    );
  }

  const dragged = drag ? items.find((it) => it.id === drag.id) : undefined;

  return (
    <div className={`overview${drag ? ' dragging' : ''}`} ref={scrollRef}>
      <div className="toolbar">
        <span className="brand">Mind Palace</span>
        <AddBar location={SHELF} place={() => ({ x: 200 + shelf.length * 24, y: 200 + shelf.length * 24 })} onOpenLayout={onOpenLayout} />
        <button onClick={() => undoManager.undo()}>Undo</button>
        <button onClick={() => undoManager.redo()}>Redo</button>
      </div>

      <div className="ov-grid">
        {devices.map((d) => {
          const list = items.filter((it) => it.location === d.id);
          const mine = d.id === thisDevice.id;
          return panel(
            d.id,
            <>
              <span className="kind">{kindLabel(d.kind)}</span>
              <strong>{d.name}</strong>
              {mine && <span className="tag">this device</span>}
              {!onlineIds.has(d.id) && <span className="tag away">away</span>}
              <span className="ov-count">{list.length}</span>
              {mine && <button onClick={onOpenStage}>Open my Stage</button>}
            </>,
            list,
            'Nothing here yet. Drag something onto this device.',
          );
        })}
        {panel(
          SHELF,
          <>
            <strong>Not on a device</strong>
            <span className="ov-count">{shelf.length}</span>
            <button onClick={onOpenCanvas} title="Arrange these freely on the shared canvas">
              Open canvas
            </button>
          </>,
          shelf,
          'New things land here. Drag them onto a device to use them there.',
        )}
      </div>

      {drag && dragged && (
        // The thumbnail in the hand: follows the pointer above everything else.
        <div className="ov-card ov-ghost" style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }}>
          <div className={`ov-thumb ov-thumb-${dragged.type}`}>
            <Thumbnail item={dragged} layouts={layouts} />
          </div>
          <strong>{titleOf(dragged, layouts)}</strong>
          <span className="ov-kind">{TYPE_WORD[dragged.type]}</span>
        </div>
      )}
    </div>
  );
}
