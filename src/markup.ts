/**
 * Light markup for text frames, so one piece of text can mix styles while
 * staying a plain string (easy to edit, sync and import):
 *
 *   # Heading        ## Subheading        ### Minor heading
 *   **bold**         *italic*
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
}

export interface Line {
  /** Range of the whole source line, not counting its line break. */
  start: number;
  end: number;
  /** 0 for a normal paragraph, 1 to 3 for headings. */
  level: number;
  segments: Segment[];
}

// A marker must hug the text it wraps, so "2 * 3 * 4" is left alone.
const INLINE = /\*\*(\S(?:.*?\S)?)\*\*|\*(\S(?:.*?\S)?)\*/g;
const HEADING = /^(#{1,3}) +/;

export function parseMarkup(text: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  while (pos <= text.length) {
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = text.length;
    const raw = text.slice(pos, lineEnd);
    const heading = HEADING.exec(raw);
    const prefix = heading ? heading[0].length : 0;
    const body = raw.slice(prefix);
    const base = pos + prefix;

    const segments: Segment[] = [];
    let last = 0;
    INLINE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE.exec(body))) {
      if (m.index > last) segments.push({ from: base + last, to: base + m.index, bold: false, italic: false });
      const bold = m[1] !== undefined;
      const marker = bold ? 2 : 1;
      const inner = bold ? m[1] : m[2];
      const from = base + m.index + marker;
      segments.push({ from, to: from + inner.length, bold, italic: !bold });
      last = m.index + m[0].length;
    }
    if (last < body.length) segments.push({ from: base + last, to: base + body.length, bold: false, italic: false });

    lines.push({ start: pos, end: lineEnd, level: heading ? heading[1].length : 0, segments });
    pos = lineEnd + 1;
  }
  return lines;
}

/** True when `pos` sits just after a heading marker ("## |Title"), a bad place to cut. */
export function afterHeadingMarker(text: string, pos: number): boolean {
  let j = pos - 1;
  while (j >= 0 && text[j] === ' ') j--;
  const hashesEnd = j;
  while (j >= 0 && text[j] === '#') j--;
  return hashesEnd > j && (j < 0 || text[j] === '\n');
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ESCAPES[c]);

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

/**
 * Renders the part of the text between `start` and `end` as HTML: one block
 * per paragraph. With `justifyLast`, the final block's last line is spread to
 * the full width, for a justified paragraph that carries on in the next frame.
 */
export function renderHtml(text: string, lines: Line[], start: number, end: number, justifyLast = false): string {
  const blocks: string[] = [];
  for (let i = firstLineAt(lines, start); i < lines.length && lines[i].start < end; i++) {
    const line = lines[i];
    if (line.end <= start && line.start < start) continue; // ended before the range began
    let inner = '';
    for (const seg of line.segments) {
      const a = Math.max(seg.from, start);
      const b = Math.min(seg.to, end);
      if (a >= b) continue;
      let piece = escapeHtml(text.slice(a, b));
      if (seg.bold) piece = `<b>${piece}</b>`;
      if (seg.italic) piece = `<i>${piece}</i>`;
      inner += piece;
    }
    blocks.push(`<div class="tl${line.level ? ` h${line.level}` : ''}"__STYLE__>${inner || '<br>'}</div>`);
  }
  return blocks
    .map((b, i) =>
      b.replace('__STYLE__', justifyLast && i === blocks.length - 1 ? ' style="text-align-last:justify"' : ''),
    )
    .join('');
}

/** Renders a whole piece of text. */
export function renderAll(text: string): string {
  return renderHtml(text, parseMarkup(text), 0, text.length);
}
