import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { newId } from './id';

/**
 * The workspace state lives in a Yjs document so that it can be synced
 * between devices and collaborators without changing the data model.
 * Each browser keeps its own saved copy (IndexedDB); sync.ts connects that
 * copy to the sync server so changes travel between devices.
 */

export type ItemType = 'text' | 'image' | 'layout' | 'embed' | 'pdf' | 'video';

export interface Item {
  id: string;
  type: ItemType;
  /** Top-left corner before rotation. Pixels on the Desk, points on a page. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation in degrees around the item's centre. */
  rot: number;
  /** Stacking order; higher is in front. */
  z: number;
  /** 'desk', a device id (the item is on that device's Stage), or 'page:<pageId>'. */
  location: string;
  text?: string;
  /** Image source. A data URL for now; becomes a cloud file reference later. */
  src?: string;
  /** For an image in a card template: the data column whose value (an image link) it shows. */
  bind?: string;
  /** The untouched image, kept when `src` holds an edited version (e.g. background removed). */
  originalSrc?: string;
  /**
   * For linked text frames: the story whose text flows through this frame, and
   * this frame's position in the chain. The frame then has no `text` of its own.
   */
  storyId?: string;
  storyIndex?: number;
  /**
   * For type 'embed': the address shown live in a frame. For 'pdf' and 'video':
   * the file's address in the file store. `label` is shown in the item's title bar.
   */
  url?: string;
  label?: string;
  /** For type 'layout': the layout document this Desk card opens. */
  layoutId?: string;
  // Text styling. Font size is in the surface's unit (px on the Desk, pt on a page).
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  bold?: boolean;
  italic?: boolean;
  /** Font and colour for headings inside the text; body font and colour when unset. */
  headingFont?: string;
  headingColor?: string;
}

/** A layout document: a book, sheet or component with fixed-size pages. */
export interface Layout {
  id: string;
  name: string;
  /** Page size and margin in points (72 per inch). */
  w: number;
  h: number;
  margin: number;
  /** Extra area past the trim edge, in points, for art that runs off the page. */
  bleed?: number;
  /** Print crop marks showing where to trim. */
  marks?: boolean;
  /** Print several pages (cards) tiled onto sheets of this paper, instead of one page per sheet. */
  sheet?: 'letter' | 'a4';
  /** With `sheet`: odd pages are fronts and even pages their backs, on alternating sheets. */
  duplex?: boolean;
  /**
   * Card data: when set, the pages are a template and each row of this table
   * makes one card. See cards/table.ts.
   */
  data?: { columns: string[]; rows: string[][] };
  /** The look applied to this layout; see themes.ts. */
  theme?: string;
  /** Facing pages are shown as spreads, as in a book. */
  facing: boolean;
}

export interface Page {
  id: string;
  layoutId: string;
  order: number;
}

/** Text that flows through a chain of linked frames. */
export interface Story {
  id: string;
  text: string;
  /** Where the text was pulled from, if anywhere, so it can be refreshed. */
  source?: StorySource;
}

/** A Google Doc (or one section of it) that a story's text came from. */
export interface StorySource {
  kind: 'gdoc';
  docId: string;
  docTitle: string;
  /** The top-level heading of the section pulled, or null for the whole document. */
  section: string | null;
  pulledAt: number;
  /** The text as it was when pulled, to tell doc changes from edits made in the layout. */
  pulledText: string;
}

/** CSS pixels are 1/96 inch and points are 1/72 inch. */
export const PT_PER_PX = 0.75;

export const pageLocation = (pageId: string) => `page:${pageId}`;
export const isPageLocation = (location: string) => location.startsWith('page:');

export const SPACE_ID = 'default';

export const doc = new Y.Doc();
export const persistence = new IndexeddbPersistence(`mind-palace-space-${SPACE_ID}`, doc);

/** A synced table of records, with a cached snapshot for React. */
function collection<T extends { id: string }>(name: string, sort?: (a: T, b: T) => number) {
  const map = doc.getMap<Y.Map<unknown>>(name);
  let snapshot: T[] = [];
  const listeners = new Set<() => void>();

  map.observeDeep(() => {
    snapshot = Array.from(map.entries()).map(([id, m]) => ({ ...(m.toJSON() as object), id }) as T);
    if (sort) snapshot.sort(sort);
    listeners.forEach((l) => l());
  });

  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };

  return {
    map,
    get: () => snapshot,
    use: () => useSyncExternalStore(subscribe, () => snapshot),
    add(id: string, value: Omit<T, 'id'>) {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(value)) if (v !== undefined) m.set(k, v);
      map.set(id, m);
    },
    update(id: string, patch: Partial<Omit<T, 'id'>>) {
      const m = map.get(id);
      if (!m) return;
      doc.transact(() => {
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) m.delete(k);
          else m.set(k, v);
        }
      });
    },
    remove: (id: string) => map.delete(id),
  };
}

const items = collection<Item>('items', (a, b) => a.z - b.z);
const layouts = collection<Layout>('layouts');
const pages = collection<Page>('pages', (a, b) => a.order - b.order);
const stories = collection<Story>('stories');

export const undoManager = new Y.UndoManager([items.map, layouts.map, pages.map, stories.map]);

// --- items -------------------------------------------------------------------

export const useItems = items.use;
export const getItems = items.get;
export const updateItem = items.update;

function topZ(): number {
  return items.get().reduce((max, it) => Math.max(max, it.z), 0);
}

type NewItem = Omit<Item, 'id' | 'z' | 'location' | 'rot'> & Partial<Pick<Item, 'location' | 'rot'>>;

export function addItem(item: NewItem): string {
  const id = newId();
  items.add(id, { rot: 0, location: 'desk', z: topZ() + 1, ...item });
  return id;
}

export function removeItem(id: string) {
  const item = items.get().find((it) => it.id === id);
  doc.transact(() => {
    // Deleting a layout's Desk card deletes the layout, its pages and their contents.
    if (item?.type === 'layout' && item.layoutId) {
      for (const p of pages.get().filter((pg) => pg.layoutId === item.layoutId)) removePageContents(p.id);
      layouts.remove(item.layoutId);
    }
    items.remove(id);
  });
  pruneStories();
}

export function bringToFront(id: string) {
  const current = items.get().find((it) => it.id === id);
  const top = topZ();
  if (current && current.z < top) updateItem(id, { z: top + 1 });
}

// --- layouts and pages -------------------------------------------------------

export const useLayouts = layouts.use;
export const updateLayout = layouts.update;
export const usePages = pages.use;

/** Creates a layout with one page and a card for it on the Desk. */
export function addLayout(at: { x: number; y: number }): { itemId: string; layoutId: string } {
  const layoutId = newId();
  let itemId = '';
  doc.transact(() => {
    layouts.add(layoutId, { name: 'Untitled layout', w: 612, h: 792, margin: 36, facing: true });
    pages.add(newId(), { layoutId, order: 1 });
    itemId = addItem({ type: 'layout', layoutId, x: at.x - 100, y: at.y - 130, w: 200, h: 260 });
  });
  return { itemId, layoutId };
}

export function addPage(layoutId: string): string {
  const id = newId();
  const last = pages.get().reduce((max, p) => (p.layoutId === layoutId ? Math.max(max, p.order) : max), 0);
  pages.add(id, { layoutId, order: last + 1 });
  return id;
}

function removePageContents(pageId: string) {
  const location = pageLocation(pageId);
  for (const it of items.get().filter((i) => i.location === location)) items.remove(it.id);
  pages.remove(pageId);
}

export function removePage(pageId: string) {
  doc.transact(() => removePageContents(pageId));
  pruneStories();
}

export const getPages = pages.get;

// --- stories: text flowing through linked frames -----------------------------

export const useStories = stories.use;
export const getStories = stories.get;

/** The frames a story flows through, in order. */
export function storyFrames(storyId: string, list: Item[] = items.get()): Item[] {
  return list.filter((it) => it.storyId === storyId).sort((a, b) => (a.storyIndex ?? 0) - (b.storyIndex ?? 0));
}

/** Turns a standalone text frame into the first frame of a story, if it is not one already. */
export function ensureStory(item: Item): string {
  if (item.storyId) return item.storyId;
  const storyId = newId();
  doc.transact(() => {
    stories.add(storyId, { text: item.text ?? '' });
    items.update(item.id, { storyId, storyIndex: 0, text: undefined });
  });
  return storyId;
}

/** Creates a story with its first frame. Returns the frame's id. */
export function addStoryFrame(frame: NewItem, text: string, source?: StorySource): string {
  const storyId = newId();
  let itemId = '';
  doc.transact(() => {
    stories.add(storyId, { text, source });
    itemId = addItem({ ...frame, text: undefined, storyId, storyIndex: 0 });
  });
  return itemId;
}

/** Replaces a story's whole text with a fresh pull from its source. */
export function refreshStory(storyId: string, text: string) {
  const story = stories.get().find((s) => s.id === storyId);
  if (!story?.source) return;
  stories.update(storyId, { text, source: { ...story.source, pulledAt: Date.now(), pulledText: text } });
}

/** Records that a story's text has been written to its source, which now reads `docText`. */
export function markStoryPushed(storyId: string, docText: string) {
  const story = stories.get().find((s) => s.id === storyId);
  if (!story?.source) return;
  stories.update(storyId, { source: { ...story.source, pulledAt: Date.now(), pulledText: docText } });
}

/** Replaces part of a story's text, as when one frame's portion is edited. */
export function replaceStoryRange(storyId: string, start: number, end: number, text: string) {
  const story = stories.get().find((s) => s.id === storyId);
  if (!story) return;
  stories.update(storyId, { text: story.text.slice(0, start) + text + story.text.slice(end) });
}

/** Removes stories that no frame shows any more. */
function pruneStories() {
  const used = new Set(items.get().map((it) => it.storyId));
  for (const s of stories.get()) if (!used.has(s.id)) stories.remove(s.id);
}
