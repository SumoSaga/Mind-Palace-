import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRefineId } from './bg/RefineEditor';
import { BackgroundButtons } from './bg/removeBackground';
import { DEFAULT_FONT, FONT_GROUPS } from './fonts/fonts';
import { readImage, useEditingKeys, usePanZoom } from './hooks';
import { ItemView } from './ItemView';
import { PAPERS, planPrint, PrintView } from './PrintView';
import {
  addItem,
  addPage,
  getItems,
  pageLocation,
  PT_PER_PX,
  removeItem,
  removePage,
  undoManager,
  updateItem,
  updateLayout,
  useItems,
  useLayouts,
  usePages,
} from './store';
import type { Item, Layout, Page } from './store';

const PRESETS: Array<{ key: string; label: string; w: number; h: number }> = [
  { key: 'letter', label: 'Letter 8.5 × 11 in', w: 612, h: 792 },
  { key: 'a4', label: 'A4 210 × 297 mm', w: 595.28, h: 841.89 },
  { key: 'trade', label: 'Trade book 6 × 9 in', w: 432, h: 648 },
  { key: 'digest', label: 'Digest 5.5 × 8.5 in', w: 396, h: 612 },
  { key: 'poker', label: 'Poker card 2.5 × 3.5 in', w: 180, h: 252 },
  { key: 'tarot', label: 'Tarot card 2.75 × 4.75 in', w: 198, h: 342 },
];

const SPREAD_GAP = 60;

interface Placed {
  page: Page;
  /** Top-left of the page on the surface, in pixels. */
  x: number;
  y: number;
}

/** Lays pages out as book spreads (facing) or a single column. */
function placePages(pages: Page[], layout: Layout): Placed[] {
  const pw = layout.w / PT_PER_PX;
  const ph = layout.h / PT_PER_PX;
  return pages.map((page, i) => {
    if (!layout.facing) return { page, x: 0, y: i * (ph + SPREAD_GAP) };
    // Page 1 sits alone on the right, as the first page of a book does.
    return { page, x: i % 2 === 0 ? pw : 0, y: Math.ceil(i / 2) * (ph + SPREAD_GAP) };
  });
}

interface Props {
  layoutId: string;
  onClose: () => void;
}

export function LayoutEditor({ layoutId, onClose }: Props) {
  const layout = useLayouts().find((l) => l.id === layoutId);
  const pages = usePages().filter((p) => p.layoutId === layoutId);
  const items = useItems();
  const [selected, setSelected] = useState<string | null>(null);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [trayOpen, setTrayOpen] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const fitted = useRef(false);
  const refining = !!useRefineId();
  const { rootRef, view, setView, toWorld, handlers } = usePanZoom(() => setSelected(null));

  const placed = layout ? placePages(pages, layout) : [];
  const current = placed.find((p) => p.page.id === currentPageId) ?? placed[0];
  const sel = items.find((it) => it.id === selected);
  const deskItems = items.filter((it) => it.location === 'desk' && it.type !== 'layout');

  // The layout was deleted (here or on another device): leave the editor.
  useEffect(() => {
    if (!layout) onClose();
  }, [layout, onClose]);

  // Start with the first spread fitted to the screen.
  useEffect(() => {
    if (fitted.current || !layout || !rootRef.current) return;
    fitted.current = true;
    const r = rootRef.current.getBoundingClientRect();
    const pw = layout.w / PT_PER_PX;
    const ph = layout.h / PT_PER_PX;
    const spreadW = layout.facing ? pw * 2 : pw;
    const tray = r.width > 700 ? 210 : 0; // leave room for the "From the Desk" panel
    const k = Math.max(0.1, Math.min(2, (r.width - tray - 80) / spreadW, (r.height - 80) / ph));
    setView({ k, x: (r.width - tray - spreadW * k) / 2, y: 40 });
  }, [layout, rootRef, setView]);

  function deleteSelected() {
    if (selected) removeItem(selected);
    setSelected(null);
  }

  function addText(text = 'Double-click to edit') {
    if (!layout || !current) return;
    const w = layout.w - layout.margin * 2;
    setSelected(
      addItem({
        type: 'text',
        location: pageLocation(current.page.id),
        x: layout.margin,
        y: layout.margin,
        w,
        h: 72,
        text,
        fontFamily: DEFAULT_FONT,
        fontSize: 11,
      }),
    );
  }

  /** Scales a size to fit inside the page margins, keeping its proportions. */
  function fit(w: number, h: number) {
    const maxW = layout!.w - layout!.margin * 2;
    const maxH = layout!.h - layout!.margin * 2;
    const scale = Math.min(1, maxW / w, maxH / h);
    const fw = w * scale;
    const fh = h * scale;
    return { w: fw, h: fh, x: (layout!.w - fw) / 2, y: (layout!.h - fh) / 2 };
  }

  async function addImages(files: File[]) {
    if (!layout || !current) return;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const { src, w, h } = await readImage(file);
      setSelected(
        addItem({ type: 'image', location: pageLocation(current.page.id), src, ...fit(w * PT_PER_PX, h * PT_PER_PX) }),
      );
    }
  }

  /** Moves an item from the Desk onto the current page. */
  function bringFromDesk(item: Item) {
    if (!layout || !current) return;
    const box = fit(item.w * PT_PER_PX, item.h * PT_PER_PX);
    updateItem(item.id, {
      location: pageLocation(current.page.id),
      ...box,
      rot: 0,
      ...(item.type === 'text'
        ? { fontSize: Math.round((item.fontSize ?? 20) * PT_PER_PX), fontFamily: item.fontFamily ?? DEFAULT_FONT }
        : {}),
    });
    setSelected(item.id);
  }

  function sendToDesk(item: Item) {
    updateItem(item.id, {
      location: 'desk',
      x: item.x / PT_PER_PX,
      y: item.y / PT_PER_PX,
      w: item.w / PT_PER_PX,
      h: item.h / PT_PER_PX,
      ...(item.type === 'text' && item.fontSize ? { fontSize: Math.round(item.fontSize / PT_PER_PX) } : {}),
    });
    setSelected(null);
  }

  /** After a drag, re-home the frame if its centre now sits over a different page. */
  function onDragEnd(id: string) {
    if (!layout) return;
    const it = getItems().find((i) => i.id === id);
    const from = it && placed.find((p) => pageLocation(p.page.id) === it.location);
    if (!it || !from) return;
    const pw = layout.w / PT_PER_PX;
    const ph = layout.h / PT_PER_PX;
    const cx = from.x + (it.x + it.w / 2) / PT_PER_PX;
    const cy = from.y + (it.y + it.h / 2) / PT_PER_PX;
    const to = placed.find((p) => cx >= p.x && cx <= p.x + pw && cy >= p.y && cy <= p.y + ph);
    if (to && to !== from) {
      updateItem(id, {
        location: pageLocation(to.page.id),
        x: it.x + (from.x - to.x) * PT_PER_PX,
        y: it.y + (from.y - to.y) * PT_PER_PX,
      });
      setCurrentPageId(to.page.id);
    }
  }

  useEditingKeys({
    active: !refining,
    onDelete: deleteSelected,
    onEscape: () => setSelected(null),
    onUndo: () => undoManager.undo(),
    onRedo: () => undoManager.redo(),
    onPasteFiles: (files) => void addImages(files),
    onPasteText: (text) => addText(text),
  });

  if (!layout) return null;

  const preset = PRESETS.find((p) => Math.abs(p.w - layout.w) < 0.5 && Math.abs(p.h - layout.h) < 0.5);
  const inches = (pt: number) => +(pt / 72).toFixed(3);
  const plan = planPrint(layout, pages);
  const grid = 24 * view.k;
  const surfaceStyle: CSSProperties = {
    backgroundSize: `${grid}px ${grid}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };

  return (
    <div className="editor">
      <div className="editor-bar">
        <button onClick={onClose}>← Desk</button>
        <input
          className="name"
          aria-label="Layout name"
          value={layout.name}
          onChange={(e) => updateLayout(layoutId, { name: e.target.value })}
        />
        <select
          aria-label="Page size"
          value={preset?.key ?? 'custom'}
          onChange={(e) => {
            const p = PRESETS.find((x) => x.key === e.target.value);
            if (p) updateLayout(layoutId, { w: p.w, h: p.h });
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom size</option>
        </select>
        <label>
          W
          <input
            type="number"
            min={1}
            step={0.125}
            value={inches(layout.w)}
            onChange={(e) => +e.target.value > 0 && updateLayout(layoutId, { w: +e.target.value * 72 })}
          />
        </label>
        <label>
          H
          <input
            type="number"
            min={1}
            step={0.125}
            value={inches(layout.h)}
            onChange={(e) => +e.target.value > 0 && updateLayout(layoutId, { h: +e.target.value * 72 })}
          />
          in
        </label>
        <label>
          Margin
          <input
            type="number"
            min={0}
            step={0.125}
            value={inches(layout.margin)}
            onChange={(e) => +e.target.value >= 0 && updateLayout(layoutId, { margin: +e.target.value * 72 })}
          />
          in
        </label>
        <label title="Extra area past the trim edge for art that runs off the page. Printers usually ask for 0.125 in.">
          Bleed
          <input
            type="number"
            min={0}
            step={0.125}
            value={inches(layout.bleed ?? 0)}
            onChange={(e) => +e.target.value >= 0 && updateLayout(layoutId, { bleed: +e.target.value * 72 })}
          />
          in
        </label>
        <label title="Print short lines outside the page showing where to trim">
          <input
            type="checkbox"
            checked={!!layout.marks}
            onChange={(e) => updateLayout(layoutId, { marks: e.target.checked })}
          />
          Crop marks
        </label>
        <label>
          <input
            type="checkbox"
            checked={layout.facing}
            onChange={(e) => updateLayout(layoutId, { facing: e.target.checked })}
          />
          Facing pages
        </label>
        <span className="spacer" />
        <select
          aria-label="Print on"
          title="Print each page on its own, or tile small pages such as cards onto sheets of paper with cut marks"
          value={layout.sheet ?? 'own'}
          onChange={(e) =>
            updateLayout(layoutId, { sheet: e.target.value === 'own' ? undefined : (e.target.value as Layout['sheet']) })
          }
        >
          <option value="own">Print one page each</option>
          {Object.entries(PAPERS).map(([key, p]) => (
            <option key={key} value={key}>
              Tile onto {p.label}
            </option>
          ))}
        </select>
        {layout.sheet && !plan.tooBig && (
          <label title="Odd pages are fronts and even pages their backs. Backs print on alternate sheets, mirrored so they line up when the paper is flipped side to side.">
            <input
              type="checkbox"
              checked={!!layout.duplex}
              onChange={(e) => updateLayout(layoutId, { duplex: e.target.checked })}
            />
            Double-sided
          </label>
        )}
        {layout.sheet && (
          <span className="print-info">
            {plan.tooBig
              ? 'Page is too big to tile'
              : `${plan.perSheet} per sheet · ${plan.sheets.length} ${plan.sheets.length === 1 ? 'sheet' : 'sheets'}`}
          </span>
        )}
        <button onClick={() => window.print()} title="Print at true size, or choose Save as PDF">
          Print / PDF
        </button>
      </div>

      <div className="editor-bar">
        <button onClick={() => addText()}>Add text</button>
        <button onClick={() => fileRef.current?.click()}>Add image</button>
        <button onClick={() => setCurrentPageId(addPage(layoutId))}>Add page</button>
        <button
          disabled={pages.length < 2 || !current}
          onClick={() => {
            if (current && window.confirm('Delete this page and everything on it?')) removePage(current.page.id);
          }}
        >
          Delete page
        </button>
        <button onClick={() => undoManager.undo()}>Undo</button>
        <button onClick={() => undoManager.redo()}>Redo</button>
        <span className="divider" />
        {sel && sel.type === 'text' && (
          <>
            <select
              aria-label="Font"
              value={sel.fontFamily ?? DEFAULT_FONT}
              onChange={(e) => updateItem(sel.id, { fontFamily: e.target.value })}
            >
              {FONT_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.fonts.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label>
              <input
                type="number"
                aria-label="Font size in points"
                min={4}
                max={400}
                value={sel.fontSize ?? 11}
                onChange={(e) => +e.target.value >= 4 && updateItem(sel.id, { fontSize: +e.target.value })}
              />
              pt
            </label>
            <input
              type="color"
              aria-label="Text colour"
              value={sel.color ?? '#1a1a1a'}
              onChange={(e) => updateItem(sel.id, { color: e.target.value })}
            />
            <select
              aria-label="Alignment"
              value={sel.align ?? 'left'}
              onChange={(e) => updateItem(sel.id, { align: e.target.value as Item['align'] })}
            >
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
              <option value="justify">Justified</option>
            </select>
            <button className={sel.bold ? 'on' : ''} onClick={() => updateItem(sel.id, { bold: !sel.bold })}>
              <b>B</b>
            </button>
            <button className={sel.italic ? 'on' : ''} onClick={() => updateItem(sel.id, { italic: !sel.italic })}>
              <i>I</i>
            </button>
          </>
        )}
        {sel && (
          <>
            <BackgroundButtons item={sel} />
            <button onClick={() => sendToDesk(sel)}>Move to Desk</button>
            <button onClick={deleteSelected}>Delete</button>
          </>
        )}
        <span className="spacer" />
        <button onClick={() => setTrayOpen((o) => !o)}>From the Desk ({deskItems.length})</button>
        <span className="zoom">{Math.round(view.k * 100)}%</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void addImages(files);
          }}
        />
      </div>

      <div className="editor-body">
        <div ref={rootRef} className="desk" style={surfaceStyle} {...handlers}>
          <div
            className="world"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
              ['--inv' as string]: 1 / view.k,
            }}
          >
            {placed.map(({ page, x, y }, i) => {
              const location = pageLocation(page.id);
              const toPage = (clientX: number, clientY: number) => {
                const p = toWorld(clientX, clientY);
                return { x: (p.x - x) * PT_PER_PX, y: (p.y - y) * PT_PER_PX };
              };
              return (
                <div
                  key={page.id}
                  data-pan
                  className={`page${current?.page.id === page.id ? ' current' : ''}`}
                  style={{ left: x, top: y, width: `${layout.w}pt`, height: `${layout.h}pt` }}
                  onPointerDown={() => setCurrentPageId(page.id)}
                >
                  <div className="margin-guide" style={{ inset: `${layout.margin}pt` }} />
                  {!!layout.bleed && <div className="bleed-guide" style={{ inset: `${-layout.bleed}pt` }} />}
                  {items
                    .filter((it) => it.location === location)
                    .map((it) => (
                      <ItemView
                        key={it.id}
                        item={it}
                        unit="pt"
                        selected={it.id === selected}
                        onSelect={(id) => {
                          setSelected(id);
                          setCurrentPageId(page.id);
                        }}
                        toWorld={toPage}
                        onDragEnd={onDragEnd}
                      />
                    ))}
                  <span className="page-number">{i + 1}</span>
                </div>
              );
            })}
          </div>
        </div>

        {trayOpen && (
          <aside className="tray">
            <h2>From the Desk</h2>
            {deskItems.length === 0 && <p>Images and text on the Desk appear here. Click one to place it on the current page.</p>}
            {deskItems.map((it) => (
              <button key={it.id} onClick={() => bringFromDesk(it)} title="Move onto the current page">
                {it.type === 'image' ? <img src={it.src} alt="" /> : <span>{it.text}</span>}
              </button>
            ))}
          </aside>
        )}
      </div>

      <PrintView layout={layout} pages={pages} items={items} />
    </div>
  );
}
