import { useState } from 'react';
import { AddBar } from './AddBar';
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
};

function titleOf(item: Item, layouts: Layout[]): string {
  if (item.type === 'layout') return layouts.find((l) => l.id === item.layoutId)?.name ?? 'Layout';
  if (item.type === 'text' || item.type === 'link') {
    const text = (item.text ?? '').replace(/[#*]/g, '').trim().replace(/\s+/g, ' ');
    return text ? (text.length > 60 ? `${text.slice(0, 60)}…` : text) : TYPE_WORD[item.type];
  }
  return item.label ?? TYPE_WORD[item.type];
}

/** The "desk" location: things that are not on any device. */
const SHELF = 'desk';

/**
 * The Overview: one panel per device, listing what has been sent to or opened
 * on it, plus a panel for things that are not on any device. From here things
 * can be added, moved between devices, opened and removed.
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
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // This device first, then the other connected ones, then any that are away
  // but still hold something.
  const onlineIds = new Set(online.map((d) => d.id));
  const held = new Set(items.map((it) => it.location).filter((loc) => loc !== SHELF));
  const away: Device[] = [...held]
    .filter((id) => !onlineIds.has(id))
    .map((id) => known.get(id) ?? { id, name: 'Unknown device', kind: 'computer' });
  const devices = [...online, ...away];
  const places = [...devices.map((d) => ({ id: d.id, name: d.id === thisDevice.id ? `${d.name} (this device)` : d.name })), { id: SHELF, name: 'Not on a device' }];
  const shelf = items.filter((it) => it.location === SHELF);

  function panel(id: string, heading: React.ReactNode, list: Item[], extra?: React.ReactNode, emptyText?: string) {
    return (
      <section
        key={id}
        className={`ov-panel${over === id ? ' drop' : ''}${id === thisDevice.id ? ' mine' : ''}`}
        onDragOver={(e) => {
          if (!dragging) return;
          e.preventDefault();
          setOver(id);
        }}
        onDragLeave={() => setOver((o) => (o === id ? null : o))}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging) sendItem(dragging, id);
          setDragging(null);
          setOver(null);
        }}
      >
        <header>{heading}</header>
        {extra}
        {list.length === 0 && <p className="ov-empty">{emptyText ?? 'Nothing here. Drag something in, or use Move to.'}</p>}
        <ul>
          {list.map((it) => (
            <li
              key={it.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', it.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragging(it.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
            >
              <div className="ov-thumb">
                {(it.type === 'image' || it.type === 'link') && it.src ? (
                  <img src={it.src} alt="" draggable={false} referrerPolicy="no-referrer" />
                ) : (
                  <span>{TYPE_WORD[it.type]}</span>
                )}
              </div>
              <div className="ov-text">
                <strong>{titleOf(it, layouts)}</strong>
                <span>{TYPE_WORD[it.type]}</span>
              </div>
              <div className="ov-actions">
                {it.type === 'layout' && it.layoutId && <button onClick={() => onOpenLayout(it.layoutId!)}>Open</button>}
                {it.type === 'link' && it.url && (
                  <button onClick={() => window.open(it.url, '_blank', 'noopener,noreferrer')}>Open ↗</button>
                )}
                <select
                  aria-label={`Move ${titleOf(it, layouts)} to`}
                  value=""
                  onChange={(e) => e.target.value && sendItem(it.id, e.target.value)}
                >
                  <option value="">Move to…</option>
                  {places
                    .filter((p) => p.id !== it.location)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <button className="ov-delete" onClick={() => removeItem(it.id)} aria-label={`Delete ${titleOf(it, layouts)}`} title="Delete (Undo brings it back)">
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <div className="overview">
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
          undefined,
          'New things land here. Move them to a device to use them there.',
        )}
      </div>
    </div>
  );
}
