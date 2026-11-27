import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { usePanZoom } from './hooks';
import { ItemMenu } from './ItemMenu';
import type { MenuOption } from './ItemMenu';
import { ItemView } from './ItemView';
import { PdfView } from './PdfView';
import { sendItem, updateItem, useItems, useLayouts } from './store';
import type { Item } from './store';
import { thisDevice, useDevices } from './sync';

function label(item: Item): string {
  if (item.type === 'image') return 'Image';
  if (item.type === 'layout') return 'Layout';
  if (item.type === 'embed' || item.type === 'link') return item.label ?? 'Link';
  if (item.type === 'pdf' || item.type === 'video') return item.label ?? (item.type === 'pdf' ? 'PDF' : 'Video');
  const text = (item.text ?? '').trim().replace(/\s+/g, ' ');
  return text ? (text.length > 28 ? `${text.slice(0, 28)}…` : text) : 'Text';
}

/** One item filling the screen, for reading or watching. */
function FullScreen({ item, onOpenLayout }: { item: Item; onOpenLayout: (layoutId: string) => void }) {
  if (item.type === 'image') return <img className="full-fit" src={item.src} alt="" draggable={false} />;
  if (item.type === 'video') return <video className="full-fit" src={item.url} controls preload="metadata" playsInline />;
  if (item.type === 'pdf' && item.url) return <PdfView url={item.url} />;
  if (item.type === 'embed') {
    return (
      <iframe
        className="tile-frame"
        src={item.url}
        title={item.label ?? 'Embedded page'}
        allow="autoplay; fullscreen; clipboard-read; clipboard-write; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    );
  }
  if (item.type === 'layout') {
    return (
      <div className="tile-open">
        <button onClick={() => item.layoutId && onOpenLayout(item.layoutId)}>Open layout</button>
      </div>
    );
  }
  if (item.type === 'link') {
    return (
      <div className="tile-open">
        <button onClick={() => item.url && window.open(item.url, '_blank', 'noopener,noreferrer')}>
          Open {item.label} in a new tab ↗
        </button>
      </div>
    );
  }
  return (
    <div
      className="stage-text"
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => {
        const text = e.currentTarget.innerText;
        if (text !== item.text) updateItem(item.id, { text });
      }}
    >
      {item.text}
    </div>
  );
}

/**
 * This device's Stage: the things that have been sent here, on a surface that
 * works like the Desk. Each can be moved and resized, put full screen, sent on
 * to another device, or sent back to the Desk. Moving something here does not
 * disturb the place it will return to on the Desk.
 */
export function Stage({
  onOpenDesk,
  onOpenLayout,
}: {
  onOpenDesk: () => void;
  onOpenLayout: (layoutId: string) => void;
}) {
  const items = useItems().filter((it) => it.location === thisDevice.id);
  const layouts = useLayouts();
  const others = useDevices().filter((d) => d.id !== thisDevice.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [fullId, setFullId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const { rootRef, view, setView, toWorld, handlers } = usePanZoom(() => setSelected(null));
  const full = items.find((it) => it.id === fullId);

  // Give newly arrived items a place: in view, sized to fit this screen, each
  // a little down and right of the last so none hides another completely.
  const unplaced = items.filter((it) => it.sx === undefined).map((it) => it.id).join(',');
  useEffect(() => {
    const root = rootRef.current;
    if (!unplaced || !root) return;
    const r = root.getBoundingClientRect();
    const corner = toWorld(r.left + 24, r.top + 72);
    const maxW = Math.max(160, (r.width - 48) / view.k);
    const maxH = Math.max(160, (r.height - 150) / view.k);
    let n = items.filter((it) => it.sx !== undefined).length;
    for (const it of items) {
      if (it.sx !== undefined) continue;
      const scale = Math.min(1, maxW / it.w, maxH / it.h);
      const step = (n % 8) * 28;
      updateItem(it.id, { sx: corner.x + step, sy: corner.y + step, sw: it.w * scale, sh: it.h * scale });
      n++;
    }
    // Runs when the set of unplaced items changes; reads the view as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unplaced]);

  // Leave full screen if the item is sent away or deleted from another device.
  useEffect(() => {
    if (fullId && !full) setFullId(null);
  }, [fullId, full]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function fitAll() {
    const root = rootRef.current;
    const placed = items.filter((it) => it.sx !== undefined);
    if (!root || !placed.length) return;
    const r = root.getBoundingClientRect();
    const x0 = Math.min(...placed.map((it) => it.sx!));
    const y0 = Math.min(...placed.map((it) => it.sy!));
    const x1 = Math.max(...placed.map((it) => it.sx! + it.sw!));
    const y1 = Math.max(...placed.map((it) => it.sy! + it.sh!));
    const k = Math.max(0.1, Math.min(2, (r.width - 48) / (x1 - x0), (r.height - 170) / (y1 - y0)));
    setView({ k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: 72 - y0 * k + Math.max(0, (r.height - 170 - (y1 - y0) * k) / 2) });
  }

  function optionsFor(item: Item): MenuOption[] {
    return [
      { label: 'Full screen', onSelect: () => setFullId(item.id) },
      ...others.map((d, i) => ({ label: `Send to ${d.name}`, onSelect: () => sendItem(item.id, d.id), divider: i === 0 })),
      { label: 'Send back to the Desk', onSelect: () => sendItem(item.id, 'desk'), divider: true },
    ];
  }

  const menuItem = menu ? items.find((it) => it.id === menu.id) : undefined;
  const grid = 24 * view.k;
  const surfaceStyle: CSSProperties = {
    backgroundSize: `${grid}px ${grid}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };

  return (
    <div className="stage">
      <div ref={rootRef} className="desk" style={surfaceStyle} {...handlers}>
        <div
          className="world"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, ['--inv' as string]: 1 / view.k }}
        >
          {items
            .filter((it) => it.sx !== undefined)
            .map((it) => (
              <ItemView
                key={it.id}
                // Shown at its place on this Stage, not its place on the Desk.
                item={{ ...it, x: it.sx!, y: it.sy!, w: it.sw!, h: it.sh!, rot: 0 }}
                selected={it.id === selected}
                onSelect={setSelected}
                toWorld={toWorld}
                noRotate
                layout={it.layoutId ? layouts.find((l) => l.id === it.layoutId) : undefined}
                onOpen={(item) => item.layoutId && onOpenLayout(item.layoutId)}
                onMenu={(item, x, y) => setMenu({ id: item.id, x, y })}
                onChange={(patch) => {
                  // Dropped on a device in the dock: send it there.
                  if (patch.location) return sendItem(it.id, patch.location);
                  updateItem(it.id, {
                    ...(patch.x !== undefined ? { sx: patch.x } : {}),
                    ...(patch.y !== undefined ? { sy: patch.y } : {}),
                    ...(patch.w !== undefined ? { sw: patch.w } : {}),
                    ...(patch.h !== undefined ? { sh: patch.h } : {}),
                  });
                }}
              />
            ))}
        </div>
      </div>

      <div className="toolbar">
        <span className="brand">{thisDevice.name}</span>
        <button disabled={!items.length} onClick={fitAll} title="Show everything on this Stage">
          Fit all
        </button>
        <button onClick={() => setView({ x: 0, y: 0, k: 1 })} title="Reset view">
          {Math.round(view.k * 100)}%
        </button>
        <button onClick={onOpenDesk}>Open the Desk</button>
      </div>

      {items.length === 0 && (
        <div className="stage-empty">
          <p>Nothing has been sent to this device yet.</p>
          <p>On the Desk, drag something onto this device in the bar below, or right-click it and choose Send to.</p>
        </div>
      )}

      {menu && menuItem && (
        <ItemMenu x={menu.x} y={menu.y} options={optionsFor(menuItem)} onClose={() => setMenu(null)} />
      )}

      {full && (
        <div className="stage-full">
          <header>
            <span className="tile-title">{label(full)}</span>
            {others.length > 0 && (
              <select
                value=""
                aria-label="Send to another device"
                onChange={(e) => e.target.value && sendItem(full.id, e.target.value)}
              >
                <option value="">Send to…</option>
                {others.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            <button onClick={() => setFullId(null)} title="Shortcut: Esc">
              Exit full screen
            </button>
          </header>
          <div className="stage-full-body">
            <FullScreen item={full} onOpenLayout={onOpenLayout} />
          </div>
        </div>
      )}
    </div>
  );
}
