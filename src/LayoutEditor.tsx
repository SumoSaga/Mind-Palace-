import { useEffect, useMemo, useRef, useState } from 'react';
import { uploadFile } from './files';
import { ItemMenu } from './ItemMenu';
import { Library } from './library/Library';
import type { DriveFile } from './library/classify';
import { drivePicture, imageSize } from './library/drive';
import type { CSSProperties } from 'react';
import { useRefineId } from './bg/RefineEditor';
import { BackgroundButtons } from './bg/removeBackground';
import { continueOnNextPage, flowToEnd, useFlow } from './flow';
import { DEFAULT_FONT, FONT_GROUPS } from './fonts/fonts';
import { PullDialog, PushDialog, RefreshDialog } from './gdocs/GoogleDocDialog';
import { withoutImageAddresses } from './gdocs/convert';
import { readImage, useEditingKeys, usePanZoom } from './hooks';
import { ItemView } from './ItemView';
import { CardDataDialog } from './cards/CardDataDialog';
import { cardRows, rowRecord } from './cards/table';
import { PAPERS, planPrint, printPages, PrintView } from './PrintView';
import { SuggestDialog } from './SuggestDialog';
import { getTheme, THEMES } from './themes';
import type { Theme } from './themes';

/** The text settings a theme gives a frame. */
function themeText(theme: Theme) {
  return {
    fontFamily: theme.bodyFont,
    fontSize: theme.bodySize,
    color: theme.ink,
    headingFont: theme.headingFont,
    headingColor: theme.headingColor,
  };
}
import {
  addItem,
  addPage,
  getItems,
  pageLocation,
  PT_PER_PX,
  removeItem,
  removePage,
  replaceStoryRange,
  storyFrames,
  undoManager,
  updateItem,
  updateLayout,
  useItems,
  useLayouts,
  usePages,
  addStoryFrame,
  getLayouts,
  getPages,
  markStoryPushed,
  refreshStory,
  useStories,
} from './store';
import type { Item, Layout, Page, StorySource } from './store';

interface Preset {
  key: string;
  label: string;
  /** Trimmed page size in points. */
  w: number;
  h: number;
  /** Set along with the size when the preset is chosen. */
  bleed?: number;
  margin?: number;
  facing?: boolean;
}

const IN = 72;

/**
 * Page sizes, grouped. The print-service groups also set the bleed and the
 * safe margin that service asks for.
 *
 * The Game Crafter: finished sizes from its product listing; 1/8 in bleed and
 * a safe zone 1/8 in inside the cut line, from its templates and bleed help
 * pages. DriveThruRPG: trim sizes from its "Book Formats and Sizes" page;
 * 0.125 in bleed on the three outside edges and a 0.5 in text margin, from its
 * "Quick Specifications for Print Books" page. Checked 27 November 2026;
 * services change their specifications, so re-check before a print run.
 */
const PRESET_GROUPS: Array<{ label: string; note?: string; presets: Preset[] }> = [
  {
    label: 'General',
    presets: [
      { key: 'letter', label: 'Letter 8.5 × 11 in', w: 612, h: 792 },
      { key: 'a4', label: 'A4 210 × 297 mm', w: 595.28, h: 841.89 },
      { key: 'trade', label: 'Trade book 6 × 9 in', w: 432, h: 648 },
      { key: 'digest', label: 'Digest 5.5 × 8.5 in', w: 396, h: 612 },
    ],
  },
  {
    label: 'The Game Crafter cards',
    note: 'The Game Crafter takes each card as a 300 dpi PNG or JPG in RGB, not a PDF. Exporting card images is not built yet.',
    presets: (
      [
        ['poker', 'Poker', 2.5, 3.5],
        ['bridge', 'Bridge', 2.25, 3.5],
        ['tarot', 'Tarot', 2.75, 4.75],
        ['mini', 'Mini', 1.75, 2.5],
        ['jumbo', 'Jumbo', 3.5, 5.5],
        ['square', 'Square', 3.5, 3.5],
        ['small-square', 'Small square', 2.5, 2.5],
      ] as const
    ).map(([key, name, w, h]) => ({
      key,
      label: `${name} card ${w} × ${h} in`,
      w: w * IN,
      h: h * IN,
      bleed: 0.125 * IN,
      margin: 0.125 * IN,
      facing: false,
    })),
  },
  {
    label: 'DriveThruRPG books',
    note: 'DriveThruRPG needs a PDF/X-1a or PDF/X-3 file in CMYK with no crop marks. This app saves an RGB PDF, so it needs converting before upload.',
    presets: (
      [
        ['dt-5.5x8.5', 5.5, 8.5],
        ['dt-6x9', 6, 9],
        ['dt-7x10', 7, 10],
        ['dt-8x10', 8, 10],
        ['dt-8.5x8.5', 8.5, 8.5],
        ['dt-8.5x11', 8.5, 11],
      ] as const
    ).map(([key, w, h]) => ({
      key,
      label: `Book ${w} × ${h} in`,
      w: w * IN,
      h: h * IN,
      bleed: 0.125 * IN,
      margin: 0.5 * IN,
      facing: true,
    })),
  },
];

const PRESETS = PRESET_GROUPS.flatMap((g) => g.presets);

/** The preset matching a layout's size, preferring one whose bleed also matches. */
function matchPreset(layout: Layout): Preset | undefined {
  const sameSize = PRESETS.filter((p) => Math.abs(p.w - layout.w) < 0.5 && Math.abs(p.h - layout.h) < 0.5);
  return sameSize.find((p) => Math.abs((p.bleed ?? 0) - (layout.bleed ?? 0)) < 0.5) ?? sameSize[0];
}

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

/** A tiny picture of a page for the book view's strip: its pictures, and grey blocks for its text. */
function MiniPage({ page, layout, items, paper }: { page: Page; layout: Layout; items: Item[]; paper: string }) {
  const location = pageLocation(page.id);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <span className="mini-page" style={{ aspectRatio: `${layout.w} / ${layout.h}`, background: paper }}>
      {items
        .filter((it) => it.location === location)
        .map((it) => (
          <span
            key={it.id}
            className={`mini-${it.type}`}
            style={{ left: pct(it.x, layout.w), top: pct(it.y, layout.h), width: pct(it.w, layout.w), height: pct(it.h, layout.h) }}
          >
            {it.type === 'image' && it.src && <img src={it.src} alt="" draggable={false} />}
          </span>
        ))}
    </span>
  );
}

export function LayoutEditor({ layoutId, onClose }: Props) {
  const layout = useLayouts().find((l) => l.id === layoutId);
  const pages = usePages().filter((p) => p.layoutId === layoutId);
  const items = useItems();
  const [selected, setSelected] = useState<string | null>(null);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** A Google Doc chosen in the Library, waiting in the "From Google Doc" dialog. */
  const [pullLink, setPullLink] = useState<string | null>(null);
  /** The add menu, from the "+ Add" button or a right-click: the page and point things go to. */
  const [addMenu, setAddMenu] = useState<{ x: number; y: number; pageId: string | null; pt: { x: number; y: number } | null } | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  /** Book view: one spread at a time, turned like pages. */
  const [bookMode, setBookMode] = useState(() => {
    const l = getLayouts().find((x) => x.id === layoutId);
    return !!l?.facing && getPages().filter((p) => p.layoutId === layoutId).length > 2;
  });
  const [flipDir, setFlipDir] = useState<'next' | 'prev' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fitted = useRef(false);
  const refining = !!useRefineId();
  const flow = useFlow(items);
  const stories = useStories();
  const [docDialog, setDocDialog] = useState<'pull' | 'refresh' | 'push' | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState(0);
  const data = layout?.data;
  const rowCount = data?.rows.length ?? 0;
  const shownRow = Math.min(previewRow, Math.max(0, rowCount - 1));
  // The data row shown in the template while designing.
  const record = useMemo(() => (data && rowCount ? rowRecord(data, shownRow) : undefined), [data, rowCount, shownRow]);
  const theme = getTheme(layout?.theme);
  const { rootRef, view, setView, toWorld, handlers } = usePanZoom(() => setSelected(null));

  const placed = layout ? placePages(pages, layout) : [];
  const selItem = items.find((it) => it.id === selected);
  const selStory = selItem?.storyId ? stories.find((s) => s.id === selItem.storyId) : undefined;
  const current = placed.find((p) => p.page.id === currentPageId) ?? placed[0];
  // Spreads: the pages that sit side by side (one row of the page layout).
  const spreads: Placed[][] = [];
  for (const p of placed) {
    const last = spreads[spreads.length - 1];
    if (last && last[0].y === p.y) last.push(p);
    else spreads.push([p]);
  }
  const spreadIndex = Math.max(0, spreads.findIndex((s) => s.some((p) => p.page.id === current?.page.id)));
  /** The pages drawn: all of them, or in book view only the current spread, at the top. */
  const shown: Placed[] = bookMode ? (spreads[spreadIndex] ?? []).map((p) => ({ ...p, y: 0 })) : placed;
  const sel = items.find((it) => it.id === selected);
  const deskItems = items.filter((it) => it.location === 'desk' && (it.type === 'text' || it.type === 'image'));

  // The layout was deleted (here or on another device): leave the editor.
  useEffect(() => {
    if (!layout) onClose();
  }, [layout, onClose]);

  // Start with the first spread fitted to the screen, and keep it fitted if the
  // window changes size, until the user pans or zooms for themselves.
  const fitSize = layout ? `${layout.w},${layout.h},${layout.facing},${bookMode},${bookMode ? spreadIndex : 0},${trayOpen}` : '';
  const fitSizeRef = useRef(fitSize);
  fitSizeRef.current = fitSize;
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !fitSize) return;
    fitted.current = false; // a new spread, size or view: fit it afresh
    const fit = () => {
      if (fitted.current) return;
      const [w, h, facing, book, , tray] = fitSizeRef.current.split(',');
      const r = root.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) return;
      const pw = +w / PT_PER_PX;
      const ph = +h / PT_PER_PX;
      const spreadW = facing === 'true' ? pw * 2 : pw;
      const side = tray === 'true' && r.width > 700 ? 210 : 0; // leave room for the "From the Desk" panel
      // Book view keeps room at the bottom for the strip of spreads, and centres the spread.
      const bottom = book === 'true' ? 150 : 60;
      const k = Math.max(0.1, Math.min(2, (r.width - side - 120) / spreadW, (r.height - bottom - 30) / ph));
      const y = book === 'true' ? Math.max(20, (r.height - bottom - ph * k) / 2) : 30;
      setView({ k, x: (r.width - side - spreadW * k) / 2, y });
    };
    const stop = () => {
      fitted.current = true;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    root.addEventListener('pointerdown', stop, true);
    root.addEventListener('wheel', stop, true);
    return () => {
      observer.disconnect();
      root.removeEventListener('pointerdown', stop, true);
      root.removeEventListener('wheel', stop, true);
    };
  }, [fitSize, rootRef, setView]);

  /** Restyles all of this layout's text to a theme, and makes it the default for new frames. */
  function applyTheme(id: string) {
    const next = getTheme(id);
    updateLayout(layoutId, { theme: next.id });
    const locations = new Set(pages.map((p) => pageLocation(p.id)));
    for (const it of items) {
      if (it.type === 'text' && locations.has(it.location)) updateItem(it.id, themeText(next));
    }
  }

  /** Places text pulled from a Google Doc in a frame filling the current page's margins. */
  function placeFromDoc(text: string, source: StorySource, flowAcrossPages: boolean) {
    if (!layout || !current) return;
    const id = addStoryFrame(
      {
        type: 'text',
        location: pageLocation(current.page.id),
        x: layout.margin,
        y: layout.margin,
        w: layout.w - layout.margin * 2,
        h: layout.h - layout.margin * 2,
        ...themeText(theme),
      },
      text,
      source,
    );
    setSelected(id);
    const frame = getItems().find((it) => it.id === id);
    if (frame && flowAcrossPages) flowToEnd(frame);
  }

  /** Style changes on a linked frame apply to every frame of its story. */
  function styleText(item: Item, patch: Partial<Item>) {
    const targets = item.storyId ? storyFrames(item.storyId) : [item];
    for (const t of targets) updateItem(t.id, patch);
  }

  function continueFrame(item: Item) {
    const id = continueOnNextPage(item);
    if (!id) return;
    setSelected(id);
    const added = getItems().find((it) => it.id === id);
    if (added) setCurrentPageId(added.location.slice('page:'.length));
  }

  function deleteSelected() {
    if (selected) removeItem(selected);
    setSelected(null);
  }

  /** Adds a text frame: on a given page at a point (from a right-click), or across the current page's margins. */
  function addText(text = 'Double-click to edit', pageId?: string | null, at?: { x: number; y: number } | null) {
    const page = pageId ?? current?.page.id;
    if (!layout || !page) return;
    const w = at ? Math.min(220, layout.w - layout.margin * 2) : layout.w - layout.margin * 2;
    setCurrentPageId(page);
    setSelected(
      addItem({
        type: 'text',
        location: pageLocation(page),
        x: at ? Math.max(0, Math.min(at.x, layout.w - w)) : layout.margin,
        y: at ? Math.max(0, at.y) : layout.margin,
        w,
        // Long pasted text gets a frame filling the margins, ready to flow on.
        h: text.length > 300 ? layout.h - layout.margin * 2 : 72,
        text,
        ...themeText(theme),
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
    const from = it && shown.find((p) => pageLocation(p.page.id) === it.location);
    if (!it || !from) return;
    const pw = layout.w / PT_PER_PX;
    const ph = layout.h / PT_PER_PX;
    const cx = from.x + (it.x + it.w / 2) / PT_PER_PX;
    const cy = from.y + (it.y + it.h / 2) / PT_PER_PX;
    const to = shown.find((p) => cx >= p.x && cx <= p.x + pw && cy >= p.y && cy <= p.y + ph);
    if (to && to !== from) {
      updateItem(id, {
        location: pageLocation(to.page.id),
        x: it.x + (from.x - to.x) * PT_PER_PX,
        y: it.y + (from.y - to.y) * PT_PER_PX,
      });
      setCurrentPageId(to.page.id);
    }
  }

  /** Turns to a spread in book view. */
  function goSpread(index: number) {
    const target = spreads[Math.max(0, Math.min(index, spreads.length - 1))];
    if (!target || index === spreadIndex) return;
    setFlipDir(index > spreadIndex ? 'next' : 'prev');
    setSelected(null);
    setCurrentPageId(target[0].page.id);
  }

  function addPageAndShow() {
    const id = addPage(layoutId);
    setCurrentPageId(id);
    setFlipDir('next');
  }

  // Book view: Page Up / Page Down turn the page, and so do the arrow keys when nothing is selected.
  useEffect(() => {
    if (!bookMode) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, select, textarea, [contenteditable="true"]') || docDialog || suggesting || dataOpen || setupOpen) return;
      const forward = e.key === 'PageDown' || (!selected && e.key === 'ArrowRight');
      const back = e.key === 'PageUp' || (!selected && e.key === 'ArrowLeft');
      if (!forward && !back) return;
      e.preventDefault();
      goSpread(spreadIndex + (forward ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** The page under a screen point, and the point on it in points. */
  function pageAt(clientX: number, clientY: number): { page: Page; pt: { x: number; y: number } } | null {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const id = (el as HTMLElement).closest<HTMLElement>('.page[data-page-id]')?.dataset.pageId;
      const hit = id ? shown.find((p) => p.page.id === id) : undefined;
      if (hit) {
        const w = toWorld(clientX, clientY);
        return { page: hit.page, pt: { x: (w.x - hit.x) * PT_PER_PX, y: (w.y - hit.y) * PT_PER_PX } };
      }
    }
    return null;
  }

  /**
   * A file chosen in the Library: a Google Doc's text goes through the "From
   * Google Doc" dialog; anything that can be a picture is placed on the page it
   * was dropped on (or the current page), copied into Mind Palace's file store.
   */
  async function pickFromDrive(file: DriveFile, drop: { x: number; y: number } | null) {
    if (file.mimeType === 'application/vnd.google-apps.document') {
      setPullLink(file.id);
      setDocDialog('pull');
      return;
    }
    const hit = drop ? pageAt(drop.x, drop.y) : null;
    const page = hit?.page ?? current?.page;
    if (!layout || !page) return;
    const blob = await drivePicture(file);
    const [size, src] = await Promise.all([imageSize(blob), uploadFile(blob, blob.type || 'image/png')]);
    let box = fit(size.w * PT_PER_PX, size.h * PT_PER_PX);
    if (hit) box = { ...box, x: hit.pt.x - box.w / 2, y: hit.pt.y - box.h / 2 };
    setCurrentPageId(page.id);
    setSelected(addItem({ type: 'image', location: pageLocation(page.id), src, ...box }));
  }

  useEditingKeys({
    active: !refining && !docDialog && !suggesting && !dataOpen && !setupOpen,
    onDelete: deleteSelected,
    onEscape: () => setSelected(null),
    onUndo: () => undoManager.undo(),
    onRedo: () => undoManager.redo(),
    onPasteFiles: (files) => void addImages(files),
    onPasteText: (text) => addText(text),
  });

  if (!layout) return null;

  const preset = matchPreset(layout);
  const presetNote = PRESET_GROUPS.find((g) => preset && g.presets.includes(preset))?.note;
  const inches = (pt: number) => +(pt / 72).toFixed(3);
  const plan = planPrint(layout, printPages(layout, pages));
  const cardCount = data ? cardRows(data).length : 0;
  const grid = 24 * view.k;
  const surfaceStyle: CSSProperties = {
    backgroundSize: `${grid}px ${grid}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };

  const pageSetup = (
    <div className="popover page-setup" role="dialog" aria-label="Page setup">
      <label>
        Size
        <select
          aria-label="Page size"
          value={preset?.key ?? 'custom'}
          onChange={(e) => {
            const p = PRESETS.find((x) => x.key === e.target.value);
            if (!p) return;
            updateLayout(layoutId, {
              w: p.w,
              h: p.h,
              // A print-service preset also sets that service's bleed and safe margin.
              ...(p.bleed !== undefined ? { bleed: p.bleed } : {}),
              ...(p.margin !== undefined ? { margin: p.margin } : {}),
              ...(p.facing !== undefined ? { facing: p.facing } : {}),
            });
          }}
        >
          {PRESET_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="custom">Custom size</option>
        </select>
      </label>
      {presetNote && <p className="print-info service-note">{presetNote}</p>}
      <div className="setup-row">
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
      </div>
      <div className="setup-row">
        <label>
          Margin
          <input
            type="number"
            min={0}
            step={0.125}
            value={inches(layout.margin)}
            onChange={(e) => +e.target.value >= 0 && updateLayout(layoutId, { margin: +e.target.value * 72 })}
          />
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
      </div>
      <div className="setup-row">
        <label>
          <input type="checkbox" checked={layout.facing} onChange={(e) => updateLayout(layoutId, { facing: e.target.checked })} />
          Facing pages
        </label>
        <label title="Print short lines outside the page showing where to trim">
          <input type="checkbox" checked={!!layout.marks} onChange={(e) => updateLayout(layoutId, { marks: e.target.checked })} />
          Crop marks
        </label>
      </div>
      <label title="A coordinated look: fonts, colours and paper. Restyles all the text in this layout.">
        Theme
        <select value={theme.id} onChange={(e) => applyTheme(e.target.value)}>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label title="Print each page on its own, or tile small pages such as cards onto sheets of paper with cut marks">
        Print
        <select
          value={layout.sheet ?? 'own'}
          onChange={(e) =>
            updateLayout(layoutId, { sheet: e.target.value === 'own' ? undefined : (e.target.value as Layout['sheet']) })
          }
        >
          <option value="own">One page each</option>
          {Object.entries(PAPERS).map(([key, p]) => (
            <option key={key} value={key}>
              Tile onto {p.label}
            </option>
          ))}
        </select>
      </label>
      {layout.sheet && !plan.tooBig && (
        <label title="Odd pages are fronts and even pages their backs. Backs print on alternate sheets, mirrored so they line up when the paper is flipped side to side.">
          <input type="checkbox" checked={!!layout.duplex} onChange={(e) => updateLayout(layoutId, { duplex: e.target.checked })} />
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
      <button
        className="danger"
        disabled={pages.length < 2 || !current}
        onClick={() => {
          if (current && window.confirm('Delete this page and everything on it?')) removePage(current.page.id);
        }}
      >
        Delete page {current ? pages.indexOf(current.page) + 1 : ''}
      </button>
    </div>
  );

  return (
    <div className="editor">
      <div className="editor-bar">
        <button onClick={onClose} title="Back">
          ←
        </button>
        <input
          className="name"
          aria-label="Layout name"
          value={layout.name}
          onChange={(e) => updateLayout(layoutId, { name: e.target.value })}
        />
        <button className={setupOpen ? 'on' : ''} onClick={() => setSetupOpen((o) => !o)} title="Page size, margins, bleed, theme and printing">
          Page setup ▾
        </button>
        <button
          ref={addButtonRef}
          title="Add text, pictures, Google Drive files, Google Doc text or pages. You can also right-click a page."
          onClick={() => {
            const r = addButtonRef.current!.getBoundingClientRect();
            setAddMenu({ x: r.left, y: r.bottom + 4, pageId: current?.page.id ?? null, pt: null });
          }}
        >
          + Add
        </button>
        <button onClick={() => undoManager.undo()} title="Undo" aria-label="Undo">
          ↶
        </button>
        <button onClick={() => undoManager.redo()} title="Redo" aria-label="Redo">
          ↷
        </button>
        <span className="segmented" role="group" aria-label="How pages are shown">
          <button className={!bookMode ? 'on' : ''} onClick={() => setBookMode(false)} title="All pages, scrolling down">
            All pages
          </button>
          <button className={bookMode ? 'on' : ''} onClick={() => setBookMode(true)} title="One spread at a time, like a book. Flip with the arrows or Page Up / Page Down.">
            Book
          </button>
        </span>
        <span className="spacer" />
        {data && rowCount > 0 && (
          <span className="row-pager" title="The data row shown in the template. Printing makes every card.">
            <button disabled={shownRow <= 0} onClick={() => setPreviewRow(shownRow - 1)} aria-label="Previous row">
              ‹
            </button>
            Row {shownRow + 1}/{rowCount}
            <button disabled={shownRow >= rowCount - 1} onClick={() => setPreviewRow(shownRow + 1)} aria-label="Next row">
              ›
            </button>
            <span className="print-info">{cardCount} cards</span>
          </span>
        )}
        <button onClick={() => setDataOpen(true)} title="Make many cards from one template and a table of rows">
          Card data
        </button>
        <button className="on" onClick={() => setSuggesting(true)} title="See arrangements for what is on the current page">
          Suggest
        </button>
        <button onClick={() => window.print()} title="Print at true size, or choose Save as PDF">
          Print / PDF
        </button>
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
      {setupOpen && (
        <>
          <div className="popover-backdrop" onPointerDown={() => setSetupOpen(false)} />
          {pageSetup}
        </>
      )}

      <div className="editor-body">
        <div
          ref={rootRef}
          className="desk"
          style={surfaceStyle}
          {...handlers}
          onContextMenu={(e) => {
            const el = e.target as HTMLElement;
            if (el.closest('.item, button, input, select')) return;
            e.preventDefault();
            const hit = pageAt(e.clientX, e.clientY);
            setAddMenu({ x: e.clientX, y: e.clientY, pageId: hit?.page.id ?? current?.page.id ?? null, pt: hit?.pt ?? null });
          }}
        >
          <div
            className="world"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
              ['--inv' as string]: 1 / view.k,
            }}
          >
            <div key={bookMode ? `spread-${spreadIndex}` : 'all'} className={`pages-wrap${bookMode && flipDir ? ` flip-${flipDir}` : ''}`}>
              {shown.map(({ page, x, y }) => {
                const i = pages.indexOf(page);
                const location = pageLocation(page.id);
                const toPage = (clientX: number, clientY: number) => {
                  const p = toWorld(clientX, clientY);
                  return { x: (p.x - x) * PT_PER_PX, y: (p.y - y) * PT_PER_PX };
                };
                return (
                  <div
                    key={page.id}
                    data-pan
                    data-page-id={page.id}
                    className={`page${current?.page.id === page.id ? ' current' : ''}`}
                    style={{
                      left: x,
                      top: y,
                      width: `${layout.w}pt`,
                      height: `${layout.h}pt`,
                      background: theme.paper,
                    }}
                    onPointerDown={() => setCurrentPageId(page.id)}
                  >
                    <div className="margin-guide" style={{ inset: `${layout.margin}pt` }} />
                    {!!layout.bleed && (
                      <div
                        className="bleed-guide"
                        style={{
                          // A bound book has no bleed on the binding (inner) edge; page 1 is a right-hand page.
                          inset:
                            layout.facing && !layout.data
                              ? i % 2 === 0
                                ? `${-layout.bleed}pt ${-layout.bleed}pt ${-layout.bleed}pt 0`
                                : `${-layout.bleed}pt 0 ${-layout.bleed}pt ${-layout.bleed}pt`
                              : `${-layout.bleed}pt`,
                        }}
                      />
                    )}
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
                          record={record}
                          onDragEnd={onDragEnd}
                          flow={flow.get(it.id)}
                          onCommitFlowText={(f, text) => replaceStoryRange(f.storyId, f.start, f.end, text)}
                          onOverflowClick={continueFrame}
                        />
                      ))}
                    <span className="page-number">{i + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {sel && (
          <div className="editor-bar editor-selbar">
            {sel.type === 'text' && (
              <>
                <select aria-label="Font" value={sel.fontFamily ?? DEFAULT_FONT} onChange={(e) => styleText(sel, { fontFamily: e.target.value })}>
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
                    onChange={(e) => +e.target.value >= 4 && styleText(sel, { fontSize: +e.target.value })}
                  />
                  pt
                </label>
                <input type="color" aria-label="Text colour" value={sel.color ?? '#1a1a1a'} onChange={(e) => styleText(sel, { color: e.target.value })} />
                <select aria-label="Alignment" value={sel.align ?? 'left'} onChange={(e) => styleText(sel, { align: e.target.value as Item['align'] })}>
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                  <option value="justify">Justified</option>
                </select>
                <button className={sel.bold ? 'on' : ''} onClick={() => styleText(sel, { bold: !sel.bold })} aria-label="Bold">
                  <b>B</b>
                </button>
                <button className={sel.italic ? 'on' : ''} onClick={() => styleText(sel, { italic: !sel.italic })} aria-label="Italic">
                  <i>I</i>
                </button>
                <span
                  className="print-info"
                  title="Double-click a frame to edit its text. Start a line with # for a heading, ## or ### for smaller ones. **bold**, *italic*, __underline__; start a line with {center} or {right} to align it."
                >
                  ?
                </span>
                <button onClick={() => continueFrame(sel)} title="Add a linked frame on the next page; text that does not fit here carries on there">
                  Continue on next page
                </button>
                <button onClick={() => flowToEnd(sel)} title="Keep adding pages and linked frames until all of this text is placed">
                  Flow to end
                </button>
              </>
            )}
            {sel.type === 'image' && data && (
              <select
                aria-label="Picture from data column"
                title="Show a different picture on each card: choose the column that holds each card's image link"
                value={sel.bind ?? ''}
                onChange={(e) => updateItem(sel.id, { bind: e.target.value || undefined })}
              >
                <option value="">Same picture on every card</option>
                {data.columns.map((c) => (
                  <option key={c} value={c}>
                    Picture from "{c}"
                  </option>
                ))}
              </select>
            )}
            <BackgroundButtons item={sel} />
            {selStory?.source && (
              <button onClick={() => setDocDialog('refresh')} title={`This text came from the Google Doc "${selStory.source.docTitle}". Check it for changes.`}>
                Refresh from doc
              </button>
            )}
            {selStory?.source && (
              <button
                disabled={withoutImageAddresses(selStory.text) === selStory.source.pulledText}
                onClick={() => setDocDialog('push')}
                title={
                  withoutImageAddresses(selStory.text) === selStory.source.pulledText
                    ? 'This text has not been edited since it was pulled, so there is nothing to push.'
                    : `Write this text back into the Google Doc "${selStory.source.docTitle}".`
                }
              >
                Push to doc
              </button>
            )}
            {!sel.storyId && <button onClick={() => sendToDesk(sel)}>Move to Desk</button>}
            <button onClick={deleteSelected}>Delete</button>
          </div>
        )}

        {bookMode && spreads.length > 0 && (
          <>
            <button className="book-turn prev" disabled={spreadIndex <= 0} onClick={() => goSpread(spreadIndex - 1)} aria-label="Previous spread" title="Previous spread (Page Up)">
              ‹
            </button>
            <button
              className="book-turn next"
              disabled={spreadIndex >= spreads.length - 1}
              onClick={() => goSpread(spreadIndex + 1)}
              aria-label="Next spread"
              title="Next spread (Page Down)"
            >
              ›
            </button>
            <div className="book-strip" role="tablist" aria-label="Spreads">
              {spreads.map((s, si) => {
                const first = pages.indexOf(s[0].page) + 1;
                const last = pages.indexOf(s[s.length - 1].page) + 1;
                return (
                  <button
                    key={s[0].page.id}
                    role="tab"
                    aria-selected={si === spreadIndex}
                    className={si === spreadIndex ? 'on' : ''}
                    onClick={() => goSpread(si)}
                    title={first === last ? `Page ${first}` : `Pages ${first}–${last}`}
                  >
                    <span className="mini-spread">
                      {layout.facing && s.length === 1 && first === 1 && <span className="mini-page blank" style={{ aspectRatio: `${layout.w} / ${layout.h}` }} />}
                      {s.map((p) => (
                        <MiniPage key={p.page.id} page={p.page} layout={layout} items={items} paper={theme.paper} />
                      ))}
                    </span>
                    <span className="mini-label">{first === last ? first : `${first}–${last}`}</span>
                  </button>
                );
              })}
              <button className="mini-add" onClick={() => addPageAndShow()} title="Add a page at the end">
                + Page
              </button>
            </div>
          </>
        )}

        {trayOpen && (
          <aside className="tray">
            <h2>
              From the Desk
              <button onClick={() => setTrayOpen(false)} aria-label="Close">
                ×
              </button>
            </h2>
            {deskItems.length === 0 && <p>Images and text on the Desk appear here. Click one to place it on the current page.</p>}
            {deskItems.map((it) => (
              <button key={it.id} onClick={() => bringFromDesk(it)} title="Move onto the current page">
                {it.type === 'image' ? <img src={it.src} alt="" /> : <span>{it.text}</span>}
              </button>
            ))}
          </aside>
        )}
      </div>

      {libraryOpen && (
        <Library
          className="in-editor"
          hint="Click to place on the current page, or drag onto any page. Google Docs bring their text; PDFs their first page; Slides their first slide."
          onPick={pickFromDrive}
          onClose={() => setLibraryOpen(false)}
        />
      )}

      {addMenu && (
        <ItemMenu
          x={addMenu.x}
          y={addMenu.y}
          onClose={() => setAddMenu(null)}
          options={[
            { label: addMenu.pt ? 'Text here' : 'Text', onSelect: () => addText(undefined, addMenu.pageId, addMenu.pt) },
            { label: 'Picture from this computer', onSelect: () => fileRef.current?.click() },
            { label: 'From Google Drive…', onSelect: () => setLibraryOpen(true) },
            { label: 'Text from a Google Doc…', onSelect: () => setDocDialog('pull') },
            { label: `From the Desk (${deskItems.length})`, onSelect: () => setTrayOpen(true) },
            { label: 'Page at the end', divider: true, onSelect: () => addPageAndShow() },
          ]}
        />
      )}

      <PrintView layout={layout} pages={pages} items={items} flow={flow} />

      {dataOpen && (
        <CardDataDialog
          layout={layout}
          onClose={() => setDataOpen(false)}
          onSave={(next) => {
            updateLayout(layoutId, { data: next });
            setPreviewRow(0);
          }}
        />
      )}
      {suggesting &&
        current &&
        (() => {
          const pageItems = items.filter((it) => it.location === pageLocation(current.page.id));
          // What the page's text amounts to: its length, how it opens, and whether it can run on.
          const texts = pageItems.filter((it) => it.type === 'text').sort((a, b) => a.y - b.y);
          const seenStories = new Set<string>();
          let textChars = 0;
          let flowsOn = false;
          let sample = '';
          for (const t of texts) {
            const f = flow.get(t.id);
            if (f) {
              flowsOn = true;
              if (seenStories.has(f.storyId)) continue; // a story's later frames share its text
              seenStories.add(f.storyId);
              const whole = stories.find((s) => s.id === f.storyId)?.text ?? '';
              textChars += whole.length - f.start;
              sample += `${whole.slice(f.start, f.start + 1500)}\n\n`;
            } else {
              textChars += (t.text ?? '').length;
              sample += `${t.text ?? ''}\n\n`;
            }
          }
          return (
            <SuggestDialog
              layout={layout}
              pageItems={pageItems}
              content={{ textChars, flowsOn, startsWithHeading: /^\s*#{1,3} /.test(sample) }}
              textSample={sample.slice(0, 1500)}
              onClose={() => setSuggesting(false)}
            />
          );
        })()}
      {docDialog === 'pull' && (
        <PullDialog
          initialLink={pullLink ?? undefined}
          onClose={() => {
            setDocDialog(null);
            setPullLink(null);
          }}
          onPlace={placeFromDoc}
        />
      )}
      {docDialog === 'push' && selStory?.source && (
        <PushDialog
          story={selStory}
          onClose={() => setDocDialog(null)}
          onPushed={(docText) => markStoryPushed(selStory.id, docText)}
        />
      )}
      {docDialog === 'refresh' && selStory?.source && (
        <RefreshDialog
          story={selStory}
          onClose={() => setDocDialog(null)}
          onAccept={(text, pulledText) => refreshStory(selStory.id, text, pulledText)}
        />
      )}
    </div>
  );
}
