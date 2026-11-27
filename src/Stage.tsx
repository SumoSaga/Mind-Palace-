import { useEffect, useState } from 'react';
import { PdfView } from './PdfView';
import { updateItem, useItems } from './store';
import type { Item } from './store';
import { thisDevice, useDevices } from './sync';

const NARROW = '(max-width: 700px)';

function label(item: Item): string {
  if (item.type === 'image') return 'Image';
  if (item.type === 'layout') return 'Layout';
  if (item.type === 'embed') return item.label ?? 'Link';
  if (item.type === 'pdf' || item.type === 'video') return item.label ?? (item.type === 'pdf' ? 'PDF' : 'Video');
  const text = (item.text ?? '').trim().replace(/\s+/g, ' ');
  return text ? (text.length > 28 ? `${text.slice(0, 28)}…` : text) : 'Text';
}

/**
 * This device's Stage: the items that have been sent here, laid out to fit the
 * screen. One item fills it; several become tabs on phones and tiles elsewhere.
 */
export function Stage({
  onOpenDesk,
  onOpenLayout,
}: {
  onOpenDesk: () => void;
  onOpenLayout: (layoutId: string) => void;
}) {
  const items = useItems().filter((it) => it.location === thisDevice.id);
  const others = useDevices().filter((d) => d.id !== thisDevice.id);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);

  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (items.length === 0) {
    return (
      <div className="stage empty">
        <p>Nothing has been sent to this device.</p>
        <button onClick={onOpenDesk}>Open the Desk</button>
      </div>
    );
  }

  const tabbed = items.length > 1 && (thisDevice.kind === 'phone' || narrow);
  const current = items.find((it) => it.id === activeId) ?? items[0];
  const shown = tabbed ? [current] : items;

  return (
    <div className="stage">
      {tabbed && (
        <div className="stage-tabs">
          {items.map((it) => (
            <button
              key={it.id}
              className={it.id === current.id ? 'active' : ''}
              onClick={() => setActiveId(it.id)}
            >
              {label(it)}
            </button>
          ))}
        </div>
      )}
      <div className="stage-grid">
        {shown.map((it) => (
          <section key={it.id} className="tile">
            <header>
              <span className="tile-title">{label(it)}</span>
              {others.length > 0 && (
                <select
                  value=""
                  aria-label="Send to another device"
                  onChange={(e) => e.target.value && updateItem(it.id, { location: e.target.value })}
                >
                  <option value="">Send to…</option>
                  {others.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}
              <button onClick={() => updateItem(it.id, { location: 'desk' })}>Back to Desk</button>
            </header>
            <div className="tile-body">
              {it.type === 'image' && <img src={it.src} alt="" draggable={false} />}
              {it.type === 'embed' && (
                <iframe
                  className="tile-frame"
                  src={it.url}
                  title={it.label ?? 'Embedded page'}
                  allow="autoplay; fullscreen; clipboard-read; clipboard-write; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              )}
              {it.type === 'video' && <video className="tile-frame" src={it.url} controls preload="metadata" playsInline />}
              {it.type === 'pdf' && it.url && <PdfView url={it.url} />}
              {it.type === 'layout' && (
                <div className="tile-open">
                  <button onClick={() => it.layoutId && onOpenLayout(it.layoutId)}>Open layout</button>
                </div>
              )}
              {it.type === 'text' && (
                <div
                  className="stage-text"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    const text = e.currentTarget.innerText;
                    if (text !== it.text) updateItem(it.id, { text });
                  }}
                >
                  {it.text}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
