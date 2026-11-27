/**
 * Converts a Google Doc (as returned by the Google Docs API) into the light
 * markup used by text frames, carrying over as much of its look as that markup
 * can hold:
 *
 *   - headings, whether made with heading styles or just with larger text
 *   - bold, italic, bold-italic and underline
 *   - centred, right-aligned and justified paragraphs
 *   - bulleted and numbered lists, with their nesting
 *   - pictures, at the size they have in the doc
 *
 * It also splits the doc into sections by top-level heading, so a layout can
 * pull one chapter at a time.
 *
 * Not carried over: fonts, text colours and exact sizes (the layout's theme
 * decides those), and the grid of a table (each row becomes one line).
 *
 * This file has no imports so that it can be run directly by Node in tests.
 */

// The parts of the Docs API response that are used here.
interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: { magnitude?: number };
}
interface Paragraph {
  elements?: Array<{ textRun?: { content?: string; textStyle?: TextStyle }; inlineObjectElement?: { inlineObjectId?: string } }>;
  paragraphStyle?: { namedStyleType?: string; alignment?: string };
  bullet?: { listId?: string; nestingLevel?: number };
}
interface StructuralElement {
  paragraph?: Paragraph;
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: StructuralElement[] }> }> };
}
interface Dimension {
  magnitude?: number;
}
export interface GoogleDoc {
  title?: string;
  body?: { content?: StructuralElement[] };
  inlineObjects?: Record<
    string,
    { inlineObjectProperties?: { embeddedObject?: { imageProperties?: { contentUri?: string }; size?: { width?: Dimension; height?: Dimension } } } }
  >;
  lists?: Record<string, { listProperties?: { nestingLevels?: Array<{ glyphType?: string }> } }>;
}

export interface DocSection {
  /** The heading that starts the section. */
  title: string;
  text: string;
}

export interface ConvertedDoc {
  title: string;
  /** The whole document as markup. */
  text: string;
  /** The document split at each top-level heading. */
  sections: DocSection[];
  /**
   * Where each picture can be downloaded, by the id used for it in the text.
   * These addresses only work for a short time after the doc is fetched.
   */
  imageSources: Record<string, string>;
}

interface Block {
  level: number;
  /** Text with bold, italic and underline markers. */
  marked: string;
  /** Text with no markers, used for headings. */
  plain: string;
  /** What starts the line if it is a list item: indent plus a bullet or number. */
  bullet: string;
  allBold: boolean;
  align: '' | 'center' | 'right' | 'justify';
  /** The paragraph's font size in points, when every part of it states one. */
  size?: number;
  /** A complete line, for blocks that are not text (pictures). */
  line?: string;
}

function headingLevel(style: string | undefined): number {
  if (style === 'TITLE' || style === 'HEADING_1') return 1;
  if (style === 'HEADING_2') return 2;
  if (style && /^HEADING_[3-6]$/.test(style)) return 3;
  return 0;
}

/** Wraps text in a marker, keeping the marker tight against the words. */
function wrap(text: string, marker: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return m[2] ? `${m[1]}${marker}${m[2]}${marker}${m[3]}` : text;
}

/** The marker for a run's style. The markup does not nest, so the strongest wins. */
function markerFor(run: { bold: boolean; italic: boolean; underline: boolean }): string {
  if (run.bold && run.italic) return '***';
  if (run.bold) return '**';
  if (run.italic) return '*';
  if (run.underline) return '__';
  return '';
}

const NUMBERED = new Set(['DECIMAL', 'ZERO_DECIMAL', 'ALPHA', 'UPPER_ALPHA', 'ROMAN', 'UPPER_ROMAN']);

/** Keeps count of numbered lists, so each item gets the right number. */
function listMarker(doc: GoogleDoc, bullet: Paragraph['bullet'], counters: Map<string, number[]>): string {
  if (!bullet) return '';
  const level = bullet.nestingLevel ?? 0;
  const indent = '    '.repeat(level);
  const glyph = doc.lists?.[bullet.listId ?? '']?.listProperties?.nestingLevels?.[level]?.glyphType;
  if (!glyph || !NUMBERED.has(glyph)) return `${indent}• `;
  const counts = counters.get(bullet.listId ?? '') ?? [];
  counts[level] = (counts[level] ?? 0) + 1;
  counts.length = level + 1; // going back up a level restarts the levels below it
  counters.set(bullet.listId ?? '', counts);
  return `${indent}${counts[level]}. `;
}

function paragraphBlocks(doc: GoogleDoc, p: Paragraph, counters: Map<string, number[]>, imageSources: Record<string, string>): Block[] {
  const alignment = p.paragraphStyle?.alignment;
  const align = alignment === 'CENTER' ? 'center' : alignment === 'END' ? 'right' : alignment === 'JUSTIFIED' ? 'justify' : '';

  // Join neighbouring runs that share a style, so "**a****b**" does not happen.
  const runs: Array<{ text: string; bold: boolean; italic: boolean; underline: boolean }> = [];
  const pictures: Block[] = [];
  const sizes: Array<number | undefined> = [];
  for (const el of p.elements ?? []) {
    const objectId = el.inlineObjectElement?.inlineObjectId;
    if (objectId) {
      const embedded = doc.inlineObjects?.[objectId]?.inlineObjectProperties?.embeddedObject;
      const uri = embedded?.imageProperties?.contentUri;
      if (uri) {
        imageSources[objectId] = uri;
        const w = Math.round((embedded?.size?.width?.magnitude ?? 300) * 10) / 10;
        const h = Math.round((embedded?.size?.height?.magnitude ?? 200) * 10) / 10;
        pictures.push({
          level: 0,
          marked: '',
          plain: '',
          bullet: '',
          allBold: false,
          align,
          line: `${align ? `{${align}} ` : ''}![${w}x${h}](#${objectId})`,
        });
      }
      continue;
    }
    const run = el.textRun;
    if (!run?.content) continue;
    // A vertical tab is a line break inside a paragraph.
    const text = run.content.replace(/\u000b/g, '\n');
    const style = { bold: !!run.textStyle?.bold, italic: !!run.textStyle?.italic, underline: !!run.textStyle?.underline };
    if (text.trim()) sizes.push(run.textStyle?.fontSize?.magnitude);
    const last = runs[runs.length - 1];
    if (last && last.bold === style.bold && last.italic === style.italic && last.underline === style.underline) last.text += text;
    else runs.push({ text, ...style });
  }
  // Every paragraph ends with a line break in the API; it is not part of the text.
  if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\n$/, '');

  const plain = runs.map((r) => r.text).join('');
  const blocks: Block[] = [];
  if (plain.trim()) {
    const marked = runs.map((r) => (markerFor(r) ? wrap(r.text, markerFor(r)) : r.text)).join('');
    blocks.push({
      level: headingLevel(p.paragraphStyle?.namedStyleType),
      marked: marked.trim(),
      plain: plain.trim(),
      bullet: listMarker(doc, p.bullet, counters),
      allBold: runs.every((r) => r.bold || !r.text.trim()),
      align,
      size: sizes.length && sizes.every((s) => s !== undefined) ? Math.min(...(sizes as number[])) : undefined,
    });
  }
  return [...blocks, ...pictures];
}

function collectBlocks(doc: GoogleDoc, content: StructuralElement[] | undefined, out: Block[], counters: Map<string, number[]>, imageSources: Record<string, string>) {
  for (const el of content ?? []) {
    if (el.paragraph) {
      out.push(...paragraphBlocks(doc, el.paragraph, counters, imageSources));
    } else if (el.table) {
      // Tables become one line per row, cells separated by " | ".
      for (const row of el.table.tableRows ?? []) {
        const cells = (row.tableCells ?? []).map((cell) => {
          const inner: Block[] = [];
          collectBlocks(doc, cell.content, inner, counters, imageSources);
          return inner.filter((b) => !b.line).map((b) => b.marked).join(' ');
        });
        const line = cells.join(' | ');
        if (line.trim()) out.push({ level: 0, marked: line, plain: line, bullet: '', allBold: false, align: '' });
      }
    }
  }
}

function blockLine(b: Block): string {
  if (b.line) return b.line;
  const align = b.align ? `{${b.align}} ` : '';
  return b.level ? `${align}${'#'.repeat(b.level)} ${b.plain}` : `${align}${b.bullet}${b.marked}`;
}

/** The font size most of the ordinary text is written in. */
function bodySize(blocks: Block[]): number {
  const weight = new Map<number, number>();
  for (const b of blocks) {
    if (b.line || b.level > 0) continue;
    const size = b.size ?? 11; // Google Docs' default
    weight.set(size, (weight.get(size) ?? 0) + b.plain.length);
  }
  let best = 11;
  let most = -1;
  for (const [size, chars] of weight) {
    if (chars > most) {
      best = size;
      most = chars;
    }
  }
  return best;
}

export function convertDoc(doc: GoogleDoc): ConvertedDoc {
  const blocks: Block[] = [];
  const imageSources: Record<string, string> = {};
  collectBlocks(doc, doc.body?.content, blocks, new Map(), imageSources);

  // Headings made by hand: a short line set clearly larger than the body text.
  const body = bodySize(blocks);
  for (const b of blocks) {
    if (b.line || b.level > 0 || b.bullet || !b.size || b.plain.length > 120 || b.plain.includes('\n')) continue;
    const ratio = b.size / body;
    if (ratio >= 1.7) b.level = 1;
    else if (ratio >= 1.35) b.level = 2;
    else if (ratio >= 1.2) b.level = 3;
  }

  // A doc with no headings of either kind: treat short all-bold lines as headings.
  if (!blocks.some((b) => b.level > 0)) {
    for (const b of blocks) {
      if (!b.line && b.allBold && !b.bullet && b.plain.length <= 80 && !b.plain.includes('\n')) b.level = 1;
    }
  }

  const sections: DocSection[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const close = () => {
    if (current && current.lines.length) sections.push({ title: current.title, text: current.lines.join('\n\n') });
  };
  for (const b of blocks) {
    if (b.level === 1) {
      close();
      current = { title: b.plain, lines: [] };
    } else if (!current) {
      current = { title: '(Before the first heading)', lines: [] };
    }
    current!.lines.push(blockLine(b));
  }
  close();

  return {
    title: doc.title ?? 'Untitled document',
    text: blocks.map(blockLine).join('\n\n'),
    sections,
    imageSources,
  };
}

/** Pulls the document id out of a Google Docs link, or accepts a bare id. */
export function parseDocId(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = /\/document\/d\/([A-Za-z0-9_-]{10,})/.exec(trimmed);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(trimmed) ? trimmed : null;
}

/** A short description of how new text differs from old, by paragraph. */
export function summariseChanges(oldText: string, newText: string): { added: string[]; removed: string[] } {
  const paragraphs = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);
  const oldSet = new Set(paragraphs(oldText));
  const newSet = new Set(paragraphs(newText));
  return {
    added: [...newSet].filter((p) => !oldSet.has(p)),
    removed: [...oldSet].filter((p) => !newSet.has(p)),
  };
}

// --- pictures ------------------------------------------------------------------
// A picture's line in the text is "![WxH](address#id)". Straight from the doc it
// has only the id, "![WxH](#id)". Once the picture has been copied into Mind
// Palace's file store, the address is filled in and the id is kept, so the same
// picture can be recognised when the doc is read again.

const IMAGE_REF = /!\[([\d.]+x[\d.]+)\]\(([^)#\s]*)(?:#([^)\s]*))?\)/g;

/** The text with every picture reduced to its id, for comparing two versions of a doc. */
export function withoutImageAddresses(text: string): string {
  return text.replace(IMAGE_REF, (whole, size: string, _address: string, id?: string) => (id ? `![${size}](#${id})` : whole));
}

/** The ids of pictures in the text that have not been copied in yet. */
export function unresolvedImages(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(IMAGE_REF)) if (!m[2] && m[3]) ids.push(m[3]);
  return ids;
}

/** Where each already-copied picture is stored, by id. */
export function imageAddresses(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of text.matchAll(IMAGE_REF)) if (m[2] && m[3]) map[m[3]] = m[2];
  return map;
}

/** Fills in the stored address of each picture that has one. */
export function withImageAddresses(text: string, addresses: Record<string, string>): string {
  return text.replace(IMAGE_REF, (whole, size: string, address: string, id?: string) =>
    id && !address && addresses[id] ? `![${size}](${addresses[id]}#${id})` : whole,
  );
}
