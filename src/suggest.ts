import { addLinkedFrame } from './flow';
import { getItems, updateItem } from './store';
import type { Item, Layout } from './store';

/**
 * Layout suggestions: a library of page patterns. Given what is on a page (its
 * images and text frames), each pattern that suits the content proposes an
 * arrangement. The patterns do the exact placement: margins, a shared gap,
 * images at their true proportions, text filling the space that is left.
 *
 * Each suggestion is then scored for how well it fits this page's content
 * (the shape of the art, how much text there is, how wide the page is) and the
 * list is offered best first, with a reason. That ranking is built in and
 * free; optionally Claude can re-rank the same suggestions (see SuggestDialog).
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Kind = 'top' | 'edge' | 'below' | 'side' | 'text';

export interface Suggestion {
  name: string;
  /** New position for each existing item, by id. */
  boxes: Map<string, Box>;
  /** A second column: a new frame linked after this text frame. */
  split?: { itemId: string; box: Box };
  kind: Kind;
  columns: 1 | 2;
  /** How well it fits the page's content; higher is better. */
  score: number;
  /** Why it scored as it did, in a few words. */
  reason: string;
  /** A plain description of the arrangement, for an AI model to judge. */
  description: string;
}

/** What the page holds, beyond the items' boxes. */
export interface PageContent {
  /** Characters of text that need a home on this page. */
  textChars: number;
  /** The text opens with a heading, as a chapter or section opener does. */
  startsWithHeading: boolean;
  /** The text can run on to later pages (it is a linked story). */
  flowsOn: boolean;
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

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** What counted for and against each suggestion: points and a few words. */
const considerations = new WeakMap<Suggestion, Array<[number, string]>>();

/**
 * Scores a suggestion against the page's content and writes its reason and
 * description. The weights are judgement calls drawn from common book-design
 * practice; they order the options, they do not forbid any.
 */
function assess(s: Suggestion, layout: Layout, images: Item[], texts: Item[], content: PageContent) {
  const pageArea = layout.w * layout.h;
  const fontSize = texts[0]?.fontSize ?? 11;
  const textBoxes = [...texts.map((t) => s.boxes.get(t.id)), s.split?.box].filter((b): b is Box => !!b);
  const textArea = textBoxes.reduce((a, b) => a + b.w * b.h, 0);
  const imageArea = images.reduce((a, img) => {
    const b = s.boxes.get(img.id);
    return a + (b ? b.w * b.h : 0);
  }, 0);

  // Roughly how many characters the text area holds: an average character is
  // about 0.45 of the font size wide, and a line is 1.35 of it tall.
  const capacity = textArea / (0.61 * fontSize * fontSize);
  const fill = capacity > 0 ? content.textChars / capacity : content.textChars > 0 ? 9 : 0;
  const lineChars = textBoxes.length ? textBoxes[0].w / (0.45 * fontSize) : 0;
  const mainAspect = images.length ? aspect(images[0]) : 1;
  const wide = mainAspect > 1.2;
  const tall = mainAspect < 0.85;

  let score = 50;
  const notes: Array<[number, string]> = [];
  const note = (points: number, text: string) => {
    score += points;
    notes.push([points, text]);
  };

  if (texts.length && content.textChars > 0) {
    if (fill > 1.05) {
      // Text that cannot run on to another page simply would not fit.
      note(content.flowsOn ? -6 : -Math.min(40, 30 * (fill - 1) + 12), content.flowsOn ? 'Text continues on the next page' : 'The text would not all fit');
    } else if (fill < 0.35) {
      note(-Math.round((0.35 - fill) * 40), 'Leaves the text area mostly empty');
    } else {
      note(10, 'All the text fits comfortably');
    }
    // Lines of about 45 to 75 characters are the easiest to read.
    if (lineChars > 90) note(-12, 'Lines would be very long to read');
    else if (lineChars < 28) note(-10, 'Lines would be very short');
    else if (lineChars >= 45 && lineChars <= 75) note(8, 'Lines are a comfortable length');
  }

  if (images.length) {
    note(Math.round((imageArea / pageArea) * 30), 'Gives the art plenty of room');
    if (wide && (s.kind === 'top' || s.kind === 'edge' || s.kind === 'below')) note(14, 'Wide art suits the full width of the page');
    if (tall && s.kind === 'side') note(14, 'Tall art sits best beside the text');
    if (tall && s.kind !== 'side') note(-10, 'Tall art is squeezed when placed across the page');
    if (wide && s.kind === 'side') note(-8, 'Wide art is small in a side column');
    if (content.startsWithHeading && s.kind === 'edge') note(10, 'Art running off the page makes a strong opener');
    if (content.startsWithHeading && s.kind === 'below') note(-8, 'An opener usually leads with its art');
  }

  if (s.columns === 2) {
    if (layout.w >= 504 && content.textChars > 1200) note(12, 'Two columns suit a page this wide');
    if (layout.w < 400) note(-15, 'Two columns are cramped on a page this narrow');
    if (content.textChars < 500) note(-8, 'Too little text to fill two columns');
  }

  s.score = Math.round(score);
  // Kept for choosing each reason once the order is known (see suggestLayouts).
  considerations.set(s, notes);
  s.reason = 'A balanced arrangement';
  s.description =
    `${s.name}: ${images.length ? `art covers ${pct(imageArea / pageArea)} of the page (${s.kind === 'side' ? 'in a side column' : s.kind === 'below' ? 'at the bottom' : s.kind === 'edge' ? 'running off the top and sides' : 'across the top'}); ` : ''}` +
    `text in ${s.columns === 2 ? 'two columns' : 'one column'} covering ${pct(textArea / pageArea)} of the page, about ${Math.round(lineChars)} characters per line, ` +
    `${fill > 1.05 ? `holding roughly ${pct(1 / fill)} of the text` : `filled to about ${pct(fill)}`}.`;
}

export function suggestLayouts(layout: Layout, pageItems: Item[], content: PageContent): Suggestion[] {
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
  const add = (name: string, kind: Kind, build: (s: Suggestion) => boolean | void) => {
    const s: Suggestion = { name, kind, columns: 1, boxes: new Map(), score: 0, reason: '', description: '' };
    if (build(s) !== false) out.push(s);
  };

  // Two columns need either one frame to split, or two frames of the same story.
  const pair = texts.length === 2 && texts[0].storyId && texts[0].storyId === texts[1].storyId;
  const canColumns = texts.length === 1 || pair;
  const columns = (region: Box, s: Suggestion) => {
    const w = (region.w - GAP) / 2;
    const left = { x: region.x, y: region.y, w, h: region.h };
    const right = { x: region.x + w + GAP, y: region.y, w, h: region.h };
    s.columns = 2;
    s.boxes.set(texts[0].id, left);
    if (pair) s.boxes.set(texts[1].id, right);
    else s.split = { itemId: texts[0].id, box: right };
  };

  if (images.length) {
    add('Art on top', 'top', (s) => {
      const h = imageRow(images, M, M, cw, ch * 0.55, s.boxes);
      stackText({ x: M, y: M + h + GAP, w: cw, h: ch - h - GAP }, texts, s.boxes);
    });

    if (images.length === 1) {
      add('Art edge to edge', 'edge', (s) => {
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
      add('Art on top, two columns', 'top', (s) => {
        const h = imageRow(images, M, M, cw, ch * 0.45, s.boxes);
        columns({ x: M, y: M + h + GAP, w: cw, h: ch - h - GAP }, s);
      });
    }

    for (const right of [false, true]) {
      add(right ? 'Art at right' : 'Art at left', 'side', (s) => {
        const colW = imageColumn(images, M, M, cw * 0.42, ch, s.boxes, right);
        if (right) for (const img of images) s.boxes.get(img.id)!.x = layout.w - M - colW;
        stackText({ x: right ? M : M + colW + GAP, y: M, w: cw - colW - GAP, h: ch }, texts, s.boxes);
      });
    }

    add('Art below', 'below', (s) => {
      const probe = new Map<string, Box>();
      const h = imageRow(images, M, 0, cw, ch * 0.55, probe);
      imageRow(images, M, layout.h - M - h, cw, ch * 0.55, s.boxes);
      stackText({ x: M, y: M, w: cw, h: ch - h - GAP }, texts, s.boxes);
    });
  } else {
    add('One column', 'text', (s) => stackText({ x: M, y: M, w: cw, h: ch }, texts, s.boxes));
    if (canColumns) add('Two columns', 'text', (s) => columns({ x: M, y: M, w: cw, h: ch }, s));
    add('Narrow column', 'text', (s) => stackText({ x: M + cw * 0.15, y: M, w: cw * 0.7, h: ch }, texts, s.boxes));
  }

  for (const s of out) assess(s, layout, images, texts, content);
  // Best first; ties keep the order the patterns were offered in.
  const ranked = out.map((s, i) => ({ s, i })).sort((a, b) => b.s.score - a.s.score || a.i - b.i).map(({ s }) => s);
  // The best fit is explained by its strongest point; the rest by what held
  // them back, if anything did, since that is what tells the options apart.
  ranked.forEach((s, i) => {
    const notes = considerations.get(s) ?? [];
    const strongest = [...notes].sort((a, b) => b[0] - a[0])[0];
    const weakest = [...notes].sort((a, b) => a[0] - b[0])[0];
    const pick = i > 0 && weakest && weakest[0] < 0 ? weakest : strongest;
    if (pick) s.reason = pick[1];
  });
  return ranked;
}

/** Moves the page's items into a suggestion's arrangement. */
export function applySuggestion(s: Suggestion) {
  for (const [id, box] of s.boxes) updateItem(id, { ...box, rot: 0 });
  if (s.split) {
    const frame = getItems().find((it) => it.id === s.split!.itemId);
    if (frame) addLinkedFrame(frame, frame.location, s.split.box);
  }
}
