/**
 * Light markup for text frames, so one piece of text can mix styles while
 * staying a plain string (easy to edit, sync and import):
 *
 *   # Heading        ## Subheading        ### Minor heading
 *   **bold**         *italic*             ***both***          __underline__
 *   {center} A centred line        {right} ...        {justify} ...
 *   ![320x200](/files/abc)         a picture, on a line of its own, sized in points
 *
 * Each line of the source is one paragraph. The markers themselves are never
 * shown. Rendering works on any range of the text, which is what lets a story
 * be cut between frames in the middle of a paragraph or a bold phrase.
 */

interface Segment {
  /** Range of visible characters in the source text. */
  from: number;
  to: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export type Align = 'center' | 'right' | 'justify';

export interface Line {
  /** Range of the whole source line, not counting its line break. */
  start: number;
  end: number;
  /** 0 for a normal paragraph, 1 to 3 for headings. */
  level: number;
  /** Set when the line asks for an alignment other than the frame's own. */
  align?: Align;
  /** Set when the line is a picture: its address and its size in points. */
  image?: { src: string; w: number; h: number };
  segments: Segment[];
}

// A marker must hug the text it wraps, so "2 * 3 * 4" is left alone.
const INLINE = /\*\*\*(\S(?:.*?\S)?)\*\*\*|\*\*(\S(?:.*?\S)?)\*\*|\*(\S(?:.*?\S)?)\*|__(\S(?:.*?\S)?)__/g;
const ALIGN = /^\{(center|right|justify)\} +/;
const HEADING = /^(#{1,3}) +/;
/** A picture line. The target may carry a "#id" naming the picture in the document it came from. */
export const IMAGE_LINE = /^!\[(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)\]\(([^)\s]*)\)$/;
/** Everything that may open a line before its text: an alignment, then a heading mark. */
const LINE_MARKERS = /^(?:\{(?:center|right|justify)\} +)?(?:#{1,3} +)?$/;

export function parseMarkup(text: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  while (pos <= text.length) {
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = text.length;
    let raw = text.slice(pos, lineEnd);
    let base = pos;

    const aligned = ALIGN.exec(raw);
    if (aligned) {
      raw = raw.slice(aligned[0].length);
      base += aligned[0].length;
    }

    const picture = IMAGE_LINE.exec(raw.trim());
    if (picture) {
      lines.push({
        start: pos,
        end: lineEnd,
        level: 0,
        ...(aligned ? { align: aligned[1] as Align } : {}),
        image: { src: picture[3], w: Number(picture[1]), h: Number(picture[2]) },
        segments: [],
      });
      pos = lineEnd + 1;
      continue;
    }
    const heading = HEADING.exec(raw);
    const prefix = heading ? heading[0].length : 0;
    const body = raw.slice(prefix);
    base += prefix;

    const segments: Segment[] = [];
    const plain = (from: number, to: number) => segments.push({ from: base + from, to: base + to, bold: false, italic: false, underline: false });
    let last = 0;
    INLINE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE.exec(body))) {
      if (m.index > last) plain(last, m.index);
      const marker = m[1] !== undefined ? 3 : m[2] !== undefined ? 2 : m[3] !== undefined ? 1 : 2;
      const inner = m[1] ?? m[2] ?? m[3] ?? m[4];
      const from = base + m.index + marker;
      segments.push({
        from,
        to: from + inner.length,
        bold: m[1] !== undefined || m[2] !== undefined,
        italic: m[1] !== undefined || m[3] !== undefined,
        underline: m[4] !== undefined,
      });
      last = m.index + m[0].length;
    }
    if (last < body.length) plain(last, body.length);

    lines.push({
      start: pos,
      end: lineEnd,
      level: heading ? heading[1].length : 0,
      ...(aligned ? { align: aligned[1] as Align } : {}),
      segments,
    });
    pos = lineEnd + 1;
  }
  return lines;
}

/**
 * True when `pos` sits just after a line's opening markers ("## |Title",
 * "{center} |Words"), which is a bad place to cut the text between frames.
 */
export function afterHeadingMarker(text: string, pos: number): boolean {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const before = text.slice(lineStart, pos);
  return before.length > 0 && LINE_MARKERS.test(before);
}

/** True when a whole line of source text is a picture. */
export const isImageLine = (line: string) => IMAGE_LINE.test(line.replace(ALIGN, '').trim());

/** True when the line starting at `lineStart` is a heading. */
export function isHeadingLine(text: string, lineStart: number): boolean {
  return /^(?:\{(?:center|right|justify)\} +)?#{1,3} /.test(text.slice(lineStart, lineStart + 16));
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** Index of the first line that ends at or after `pos`. */
function firstLineAt(lines: Line[], pos: number): number {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].end >= pos) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Only Mind Palace's own stored files and secure web addresses may be shown as pictures. */
const safeImage = (src: string) => /^(\/files\/[0-9a-f-]+|https:\/\/[^\s"'<>]+)(#[\w.-]*)?$/i.test(src);

/**
 * Renders the part of the text between `start` and `end` as HTML: one block
 * per paragraph. With `justifyLast`, the final block's last line is spread to
 * the full width, for a justified paragraph that carries on in the next frame.
 */
export function renderHtml(text: string, lines: Line[], start: number, end: number, justifyLast = false): string {
  const blocks: Array<{ cls: string; style: string; inner: string }> = [];
  for (let i = firstLineAt(lines, start); i < lines.length && lines[i].start < end; i++) {
    const line = lines[i];
    if (line.end <= start && line.start < start) continue; // ended before the range began

    if (line.image) {
      // A picture belongs to the frame its line starts in; it is never split.
      if (line.start < start) continue;
      const { src, w, h } = line.image;
      if (!safeImage(src) || !(w > 0) || !(h > 0)) continue;
      // Sized by width with a fixed shape, so its height is known before it loads
      // and the text around it does not jump.
      blocks.push({
        cls: ' img',
        style: line.align ? `text-align:${line.align};` : '',
        inner: `<img src="${escapeHtml(src.replace(/#.*$/, ''))}" alt="" draggable="false" style="width:min(${w}pt,100%);aspect-ratio:${w}/${h}">`,
      });
      continue;
    }

    let inner = '';
    for (const seg of line.segments) {
      const a = Math.max(seg.from, start);
      const b = Math.min(seg.to, end);
      if (a >= b) continue;
      let piece = escapeHtml(text.slice(a, b));
      if (seg.bold) piece = `<b>${piece}</b>`;
      if (seg.italic) piece = `<i>${piece}</i>`;
      if (seg.underline) piece = `<u>${piece}</u>`;
      inner += piece;
    }
    blocks.push({
      cls: line.level ? ` h${line.level}` : '',
      style: line.align ? `text-align:${line.align};` : '',
      inner: inner || '<br>',
    });
  }
  return blocks
    .map((b, i) => {
      const style = b.style + (justifyLast && i === blocks.length - 1 && !b.cls.includes('img') ? 'text-align-last:justify;' : '');
      return `<div class="tl${b.cls}"${style ? ` style="${style}"` : ''}>${b.inner}</div>`;
    })
    .join('');
}

/** Renders a whole piece of text. */
export function renderAll(text: string): string {
  return renderHtml(text, parseMarkup(text), 0, text.length);
}
