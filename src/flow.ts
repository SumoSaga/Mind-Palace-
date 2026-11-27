import { useMemo, useSyncExternalStore } from 'react';
import {
  addItem,
  addPage,
  ensureStory,
  getPages,
  getStories,
  isPageLocation,
  pageLocation,
  storyFrames,
  useStories,
} from './store';
import type { Item } from './store';
import { afterHeadingMarker, isHeadingLine, isImageLine, parseMarkup, renderHtml } from './markup';
import type { Line } from './markup';

/**
 * Text flow: divides a story's text among its chain of linked frames. Each
 * frame takes as many whole words as fit its box, and the rest carries on into
 * the next frame. Nothing here is stored; it is worked out from the story text
 * and the frames' sizes and fonts, by measuring real text in the browser.
 */

export interface FlowInfo {
  storyId: string;
  /** The part of the story this frame shows (source text, with markup), and where it sits in the story. */
  text: string;
  /** That part rendered with its headings, bold and italic. */
  html: string;
  start: number;
  end: number;
  /** The frame ends in the middle of a paragraph. */
  continues: boolean;
  /** This is the last frame and there is more text than fits. */
  overflow: boolean;
}

/** Must match the line height of `.text` in styles.css. */
const LINE_HEIGHT = '1.35';

let probe: HTMLDivElement | null = null;

/** An invisible box styled like a frame, used to measure how tall some text is. */
function probeFor(frame: Item): HTMLDivElement {
  if (!probe) {
    probe = document.createElement('div');
    Object.assign(probe.style, {
      position: 'absolute',
      left: '-99999px',
      top: '0',
      visibility: 'hidden',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      lineHeight: LINE_HEIGHT,
      padding: '0',
    });
    document.body.appendChild(probe);
  }
  probe.style.width = `${frame.w}pt`;
  probe.style.fontFamily = frame.fontFamily ? `"${frame.fontFamily}"` : '';
  probe.style.fontSize = `${frame.fontSize ?? 11}pt`;
  probe.style.fontWeight = frame.bold ? '700' : '400';
  probe.style.fontStyle = frame.italic ? 'italic' : 'normal';
  // Headings may use their own font, which changes how much room they take.
  if (frame.headingFont) probe.style.setProperty('--heading-font', `"${frame.headingFont}"`);
  else probe.style.removeProperty('--heading-font');
  return probe;
}

const isSpace = (ch: string) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';

/** Every position where the text may be cut: the start of each word, and the end. */
function breakPositions(text: string): number[] {
  const out: number[] = [];
  for (let i = 1; i < text.length; i++) {
    // Never cut between a heading marker and its heading.
    if (isSpace(text[i - 1]) && !isSpace(text[i]) && !afterHeadingMarker(text, i)) out.push(i);
  }
  out.push(text.length);
  return out;
}

/** First index in the sorted list whose value is greater than `value`. */
function firstAbove(list: number[], value: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] > value) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Fits as much text as possible into one frame, starting at `pos`.
 * Returns the range shown (trailing spaces excluded) and where the next frame resumes.
 */
function fitFrame(text: string, lines: Line[], breaks: number[], pos: number, frame: Item, guess: number) {
  let start = pos;
  while (start < text.length && isSpace(text[start])) start++; // no blank space at the top of a frame
  if (start >= text.length) return { start: text.length, end: text.length, next: text.length, count: guess };

  const el = probeFor(frame);
  const maxHeight = (frame.h * 96) / 72 + 0.5;
  const fits = (cut: number) => {
    el.innerHTML = renderHtml(text, lines, start, start + text.slice(start, cut).trimEnd().length);
    return el.getBoundingClientRect().height <= maxHeight;
  };

  const first = firstAbove(breaks, start);
  const last = breaks.length - 1;
  // Grow in doubling steps from a guess, then narrow down, so only short pieces are ever measured.
  let lo = -1; // highest index known to fit
  let hi = -1; // lowest index known not to fit
  let step = Math.max(8, guess);
  let j = Math.min(first + step - 1, last);
  for (;;) {
    if (fits(breaks[j])) {
      lo = j;
      if (j === last) break;
      step *= 2;
      j = Math.min(j + step, last);
    } else {
      hi = j;
      break;
    }
  }
  if (hi !== -1) {
    let a = lo === -1 ? first - 1 : lo;
    let b = hi;
    while (b - a > 1) {
      const mid = (a + b) >> 1;
      if (fits(breaks[mid])) a = mid;
      else b = mid;
    }
    lo = a >= first ? a : -1;
  }

  if (lo === -1) {
    // A picture too tall for the frame is placed anyway (it is shown scaled down
    // to fit), so one large picture cannot hold up the rest of the story.
    let lineEnd = text.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = text.length;
    if (isImageLine(text.slice(start, lineEnd))) return { start, end: lineEnd, next: lineEnd, count: 1 };
    return { start, end: start, next: start, count: guess }; // not even one word fits
  }
  let next = breaks[lo];
  // Keep a heading with what follows: if the frame would end on a heading while
  // more text remains, move the heading to the next frame instead.
  if (next < text.length) {
    const lastChar = start + text.slice(start, next).trimEnd().length - 1;
    const lineStart = text.lastIndexOf('\n', lastChar) + 1;
    const lineEnd = text.indexOf('\n', lineStart);
    const wholeLineHere = lineEnd === -1 ? false : lineEnd <= next;
    if (lineStart > start && wholeLineHere && isHeadingLine(text, lineStart)) {
      next = lineStart;
    }
  }
  const end = start + text.slice(start, next).trimEnd().length;
  return { start, end, next, count: lo - first + 1 };
}

interface StoryLayout {
  lines: Line[];
  ranges: Array<{ start: number; end: number }>;
  /** Where unplaced text begins; equals the text length when everything fits. */
  placedUpTo: number;
  overflow: boolean;
}

function layoutStory(text: string, frames: Item[]): StoryLayout {
  const breaks = breakPositions(text);
  const lines = parseMarkup(text);
  const ranges: StoryLayout['ranges'] = [];
  let pos = 0;
  let guess = 64;
  for (const frame of frames) {
    const fit = fitFrame(text, lines, breaks, pos, frame, guess);
    ranges.push({ start: fit.start, end: fit.end });
    pos = fit.next;
    guess = fit.count;
  }
  let rest = pos;
  while (rest < text.length && isSpace(text[rest])) rest++;
  return { lines, ranges, placedUpTo: pos, overflow: rest < text.length };
}

// --- cached results, recomputed when text, frame shape, font or loaded fonts change

const cache = new Map<string, { key: string; layout: StoryLayout }>();

let fontsVersion = 0;
const fontListeners = new Set<() => void>();
if (typeof document !== 'undefined' && document.fonts) {
  // Text measured before its font arrives is the wrong size; measure again once fonts load.
  document.fonts.addEventListener('loadingdone', () => {
    fontsVersion++;
    fontListeners.forEach((l) => l());
  });
}

function cachedLayout(storyId: string, text: string, frames: Item[]): StoryLayout {
  const shape = frames
    .map((f) => [f.w, f.h, f.fontFamily, f.fontSize, f.bold, f.italic, f.align, f.headingFont].join(','))
    .join('|');
  const key = `${fontsVersion}\u0000${shape}\u0000${text}`;
  const hit = cache.get(storyId);
  if (hit && hit.key === key) return hit.layout;
  const layout = layoutStory(text, frames);
  cache.set(storyId, { key, layout });
  return layout;
}

/** For every linked frame, the part of its story it shows. */
export function useFlow(items: Item[]): Map<string, FlowInfo> {
  const stories = useStories();
  const version = useSyncExternalStore(
    (l) => {
      fontListeners.add(l);
      return () => fontListeners.delete(l);
    },
    () => fontsVersion,
  );
  return useMemo(() => {
    const out = new Map<string, FlowInfo>();
    for (const story of stories) {
      const frames = storyFrames(story.id, items);
      if (frames.length === 0) continue;
      const layout = cachedLayout(story.id, story.text, frames);
      frames.forEach((frame, i) => {
        const { start, end } = layout.ranges[i];
        let after = end;
        while (after < story.text.length && (story.text[after] === ' ' || story.text[after] === '\t')) after++;
        const continues = after < story.text.length && story.text[after] !== '\n';
        out.set(frame.id, {
          storyId: story.id,
          text: story.text.slice(start, end),
          html: renderHtml(story.text, layout.lines, start, end, continues && frame.align === 'justify'),
          start,
          end,
          continues,
          overflow: layout.overflow && i === frames.length - 1,
        });
      });
    }
    return out;
    // `version` is a dependency so the flow is re-measured after fonts load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stories, items, version]);
}

// --- growing a story ---------------------------------------------------------

/**
 * Adds a frame linked after `frame`, in the same position on the following
 * page (adding a page if there is none). Returns the new frame's id.
 */
export function continueOnNextPage(frame: Item): string | null {
  if (frame.type !== 'text' || !isPageLocation(frame.location)) return null;
  const pageId = frame.location.slice('page:'.length);
  const all = getPages();
  const page = all.find((p) => p.id === pageId);
  if (!page) return null;
  const layoutPages = all.filter((p) => p.layoutId === page.layoutId);
  const nextPage = layoutPages[layoutPages.findIndex((p) => p.id === pageId) + 1];
  const nextPageId = nextPage ? nextPage.id : addPage(page.layoutId);

  return addLinkedFrame(frame, pageLocation(nextPageId), { x: frame.x, y: frame.y, w: frame.w, h: frame.h });
}

/**
 * Adds a frame linked directly after `frame` in its story (starting a story if
 * the frame is standalone), with the same text styling. Returns its id.
 */
export function addLinkedFrame(
  frame: Item,
  location: string,
  box: { x: number; y: number; w: number; h: number },
): string {
  const storyId = ensureStory(frame);
  const frames = storyFrames(storyId);
  const i = frames.findIndex((f) => f.id === frame.id);
  const index = frames[i]?.storyIndex ?? 0;
  const following = frames[i + 1]?.storyIndex;
  return addItem({
    type: 'text',
    location,
    ...box,
    rot: frame.rot,
    headingFont: frame.headingFont,
    headingColor: frame.headingColor,
    storyId,
    storyIndex: following === undefined ? index + 1 : (index + following) / 2,
    fontFamily: frame.fontFamily,
    fontSize: frame.fontSize,
    color: frame.color,
    align: frame.align,
    bold: frame.bold,
    italic: frame.italic,
  });
}

const MAX_NEW_FRAMES = 300;

/**
 * Keeps adding linked frames on following pages until the whole story is
 * placed. Returns how many frames were added.
 */
export function flowToEnd(frame: Item): number {
  const storyId = ensureStory(frame);
  const text = getStories().find((s) => s.id === storyId)?.text ?? '';
  const breaks = breakPositions(text);
  let frames = storyFrames(storyId);
  let { placedUpTo: pos, overflow, lines } = layoutStory(text, frames);
  let added = 0;
  let guess = 64;
  while (overflow && added < MAX_NEW_FRAMES) {
    const newId = continueOnNextPage(frames[frames.length - 1]);
    if (!newId) break;
    frames = storyFrames(storyId);
    const fit = fitFrame(text, lines, breaks, pos, frames[frames.length - 1], guess);
    added++;
    if (fit.next === pos && fit.end === fit.start) break; // the frame is too small to hold anything
    pos = fit.next;
    guess = fit.count;
    let rest = pos;
    while (rest < text.length && isSpace(text[rest])) rest++;
    overflow = rest < text.length;
  }
  return added;
}
