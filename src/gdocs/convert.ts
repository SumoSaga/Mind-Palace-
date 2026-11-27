/**
 * Converts a Google Doc (as returned by the Google Docs API) into the light
 * markup used by text frames: headings become `#` lines, bold and italic
 * become `**` and `*`. Also splits the doc into sections by top-level heading,
 * so a layout can pull one chapter at a time.
 *
 * This file has no imports so that it can be run directly by Node in tests.
 */

// The parts of the Docs API response that are used here.
interface TextRun {
  content?: string;
  textStyle?: { bold?: boolean; italic?: boolean };
}
interface Paragraph {
  elements?: Array<{ textRun?: TextRun }>;
  paragraphStyle?: { namedStyleType?: string };
  bullet?: unknown;
}
interface StructuralElement {
  paragraph?: Paragraph;
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: StructuralElement[] }> }> };
}
export interface GoogleDoc {
  title?: string;
  body?: { content?: StructuralElement[] };
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
}

interface Block {
  level: number;
  /** Text with bold and italic markers. */
  marked: string;
  /** Text with no markers, used for headings. */
  plain: string;
  bullet: boolean;
  allBold: boolean;
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

function paragraphBlock(p: Paragraph): Block | null {
  // Join neighbouring runs that share a style, so "**a****b**" does not happen.
  const runs: Array<{ text: string; bold: boolean; italic: boolean }> = [];
  for (const el of p.elements ?? []) {
    const run = el.textRun;
    if (!run?.content) continue;
    // A vertical tab is a line break inside a paragraph.
    const text = run.content.replace(/\u000b/g, '\n');
    const bold = !!run.textStyle?.bold;
    const italic = !!run.textStyle?.italic;
    const last = runs[runs.length - 1];
    if (last && last.bold === bold && last.italic === italic) last.text += text;
    else runs.push({ text, bold, italic });
  }
  // Every paragraph ends with a line break in the API; it is not part of the text.
  if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\n$/, '');

  const plain = runs.map((r) => r.text).join('');
  if (!plain.trim()) return null;
  // Bold wins where a run is both; the markup does not nest.
  const marked = runs.map((r) => (r.bold ? wrap(r.text, '**') : r.italic ? wrap(r.text, '*') : r.text)).join('');
  return {
    level: headingLevel(p.paragraphStyle?.namedStyleType),
    marked: marked.trim(),
    plain: plain.trim(),
    bullet: !!p.bullet,
    allBold: runs.every((r) => r.bold || !r.text.trim()),
  };
}

function collectBlocks(content: StructuralElement[] | undefined, out: Block[]) {
  for (const el of content ?? []) {
    if (el.paragraph) {
      const block = paragraphBlock(el.paragraph);
      if (block) out.push(block);
    } else if (el.table) {
      // Tables become one line per row, cells separated by " | ".
      for (const row of el.table.tableRows ?? []) {
        const cells = (row.tableCells ?? []).map((cell) => {
          const inner: Block[] = [];
          collectBlocks(cell.content, inner);
          return inner.map((b) => b.marked).join(' ');
        });
        const line = cells.join(' | ');
        if (line.trim()) out.push({ level: 0, marked: line, plain: line, bullet: false, allBold: false });
      }
    }
  }
}

const blockLine = (b: Block) => (b.level ? `${'#'.repeat(b.level)} ${b.plain}` : `${b.bullet ? '• ' : ''}${b.marked}`);

export function convertDoc(doc: GoogleDoc): ConvertedDoc {
  const blocks: Block[] = [];
  collectBlocks(doc.body?.content, blocks);

  // A doc written without heading styles: treat short all-bold lines as headings.
  if (!blocks.some((b) => b.level > 0)) {
    for (const b of blocks) {
      if (b.allBold && !b.bullet && b.plain.length <= 80 && !b.plain.includes('\n')) b.level = 1;
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
