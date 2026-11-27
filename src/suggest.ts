import { addLinkedFrame } from './flow';
import { getItems, updateItem } from './store';
import type { Item, Layout } from './store';

/**
 * Layout suggestions: a library of page patterns. Given what is on a page (its
 * images and text frames), each pattern that suits the content proposes an
 * arrangement. The patterns do the exact placement: margins, a shared gap,
 * images at their true proportions, text filling the space that is left.
 *
 * Choosing which pattern suits the content best is where an AI model's
 * judgement will come in; for now they are offered in a fixed order.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Suggestion {
  name: string;
  /** New position for each existing item, by id. */
  boxes: Map<string, Box>;
  /** A second column: a new frame linked after this text frame. */
  split?: { itemId: string; box: Box };
}

const GAP = 14;

const aspect = (it: Item) => it.w / it.h;

/** Splits a region among text frames, top to bottom. Short standalone lines (titles) get less room. */
function stackText(region: Box, texts: Item[], boxes: Map<string, Box>) {
  if (!texts.length || region.h <= 0) return;
  const weights = texts.map((t) => (!t.storyId && (t.text ?? '').length < 60 && texts.length > 1 ? 0.25 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const usable = region.h - GAP * (texts.length - 1);
  let y = region.y;
  texts.forEach((t, i) => {
    const h = (usable * weights[i]) / total;
    boxes.set(t.id, { x: region.x, y, w: region.w, h });
    y += h + GAP;
  });
}

/** Lays images side by side at one shared height, filling the width if they can. Returns the row's height. */
function imageRow(images: Item[], x: number, y: number, width: number, maxHeight: number, boxes: Map<string, Box>) {
  const ratios = images.map(aspect);
  const gaps = GAP * (images.length - 1);
  const h = Math.min(maxHeight, (width - gaps) / ratios.reduce((a, b) => a + b, 0));
  const rowWidth = ratios.reduce((a, r) => a + r * h, 0) + gaps;
  let cx = x + (width - rowWidth) / 2;
  images.forEach((img, i) => {
    boxes.set(img.id, { x: cx, y, w: ratios[i] * h, h });
    cx += ratios[i] * h + GAP;
  });
  return h;
}

/** Stacks images in a column of one shared width. Returns the column's width. */
function imageColumn(images: Item[], x: number, y: number, width: number, maxHeight: number, boxes: Map<string, Box>, alignRight: boolean) {
  const ratios = images.map(aspect);
  const gaps = GAP * (images.length - 1);
  const natural = ratios.reduce((a, r) => a + width / r, 0);
  const w = natural + gaps > maxHeight ? (width * (maxHeight - gaps)) / natural : width;
  let cy = y;
  images.forEach((img, i) => {
    boxes.set(img.id, { x: alignRight ? x + width - w : x, y: cy, w, h: w / ratios[i] });
    cy += w / ratios[i] + GAP;
  });
  return w;
}

export function suggestLayouts(layout: Layout, pageItems: Item[]): Suggestion[] {
  const images = pageItems.filter((it) => it.type === 'image');
  const texts = pageItems
    .filter((it) => it.type === 'text')
    .sort((a, b) => (a.storyId && a.storyId === b.storyId ? (a.storyIndex ?? 0) - (b.storyIndex ?? 0) : a.y - b.y));
  if (!images.length && !texts.length) return [];

  const M = layout.margin;
  const B = layout.bleed ?? 0;
  const cw = layout.w - M * 2;
  const ch = layout.h - M * 2;
  const out: Suggestion[] = [];
  const add = (name: string, build: (s: Suggestion) => boolean | void) => {
    const s: Suggestion = { name, boxes: new Map() };
    if (build(s) !== false) out.push(s);
  };

  // Two columns need either one frame to split, or two frames of the same story.
  const pair = texts.length === 2 && texts[0].storyId && texts[0].storyId === texts[1].storyId;
  const canColumns = texts.length === 1 || pair;
  const columns = (region: Box, s: Suggestion) => {
    const w = (region.w - GAP) / 2;
    const left = { x: region.x, y: region.y, w, h: region.h };
    const right = { x: region.x + w + GAP, y: region.y, w, h: region.h };
    s.boxes.set(texts[0].id, left);
    if (pair) s.boxes.set(texts[1].id, right);
    else s.split = { itemId: texts[0].id, box: right };
  };

  if (images.length) {
    add('Art on top', (s) => {
      const h = imageRow(images, M, M, cw, ch * 0.55, s.boxes);
      stackText({ x: M, y: M + h + GAP, w: cw, h: ch - h - GAP }, texts, s.boxes);
    });

    if (images.length === 1) {
      add('Art edge to edge', (s) => {
        // Runs off the top and sides of the page, into the bleed if there is one.
        const w = layout.w + B * 2;
        const h = w / aspect(images[0]);
        if (h > layout.h * 0.62) return false; // too tall to leave room for text
        s.boxes.set(images[0].id, { x: -B, y: -B, w, h });
        const top = h - B + GAP;
        stackText({ x: M, y: top, w: cw, h: layout.h - M - top }, texts, s.boxes);
      });
    }

    if (canColumns) {
      add('Art on top, two columns', (s) => {
        const h = imageRow(images, M, M, cw, ch * 0.45, s.boxes);
        columns({ x: M, y: M + h + GAP, w: cw, h: ch - h - GAP }, s);
      });
    }

    for (const right of [false, true]) {
      add(right ? 'Art at right' : 'Art at left', (s) => {
        const colW = imageColumn(images, M, M, cw * 0.42, ch, s.boxes, right);
        if (right) for (const img of images) s.boxes.get(img.id)!.x = layout.w - M - colW;
        stackText({ x: right ? M : M + colW + GAP, y: M, w: cw - colW - GAP, h: ch }, texts, s.boxes);
      });
    }

    add('Art below', (s) => {
      const probe = new Map<string, Box>();
      const h = imageRow(images, M, 0, cw, ch * 0.55, probe);
      imageRow(images, M, layout.h - M - h, cw, ch * 0.55, s.boxes);
      stackText({ x: M, y: M, w: cw, h: ch - h - GAP }, texts, s.boxes);
    });
  } else {
    add('One column', (s) => stackText({ x: M, y: M, w: cw, h: ch }, texts, s.boxes));
    if (canColumns) add('Two columns', (s) => columns({ x: M, y: M, w: cw, h: ch }, s));
    add('Narrow column', (s) => stackText({ x: M + cw * 0.15, y: M, w: cw * 0.7, h: ch }, texts, s.boxes));
  }

  return out;
}

/** Moves the page's items into a suggestion's arrangement. */
export function applySuggestion(s: Suggestion) {
  for (const [id, box] of s.boxes) updateItem(id, { ...box, rot: 0 });
  if (s.split) {
    const frame = getItems().find((it) => it.id === s.split!.itemId);
    if (frame) addLinkedFrame(frame, frame.location, s.split.box);
  }
}
