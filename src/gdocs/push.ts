/**
 * Plans how to write a layout's text back into the Google Doc it came from:
 * which range of the doc to replace, and the requests that replace it and
 * restore headings, bold and italic.
 *
 * Writing to someone's document is the riskiest thing this app does, so the
 * plan refuses whenever it cannot be sure of a clean result:
 *   - if the doc has changed since the text was pulled (refresh first), and
 *   - if the section holds anything plain text cannot represent (lists,
 *     tables, images), which a push would flatten or delete.
 *
 * No network here, and only extension-qualified imports, so Node can run it in tests.
 */
import { convertDoc } from './convert.ts';
import type { GoogleDoc } from './convert.ts';
import { parseMarkup } from '../markup.ts';

interface Element {
  startIndex?: number;
  endIndex?: number;
  paragraph?: {
    elements?: Array<{ textRun?: { content?: string } } & Record<string, unknown>>;
    paragraphStyle?: { namedStyleType?: string };
    bullet?: unknown;
  };
  table?: unknown;
  tableOfContents?: unknown;
  sectionBreak?: unknown;
}

export type PushPlan = { ok: true; requests: object[] } | { ok: false; reason: string };

const isTopHeading = (el: Element) => {
  const style = el.paragraph?.paragraphStyle?.namedStyleType;
  return style === 'TITLE' || style === 'HEADING_1';
};

const paragraphText = (el: Element) =>
  (el.paragraph?.elements ?? [])
    .map((e) => e.textRun?.content ?? '')
    .join('')
    .trim();

/**
 * @param section        the top-level heading of the section to replace, or null for the whole document
 * @param pulledText     the section's text as it was when last pulled
 * @param newText        the layout's text (with markup) to write
 */
export function planPush(doc: GoogleDoc, section: string | null, pulledText: string, newText: string): PushPlan {
  const content = (doc.body?.content ?? []) as Element[];
  if (!content.length) return { ok: false, reason: 'The document appears to be empty.' };
  const bodyEnd = content[content.length - 1].endIndex ?? 0;

  // The doc must still say what it said when the text was pulled.
  const converted = convertDoc(doc);
  const current = section === null ? converted.text : converted.sections.find((s) => s.title === section)?.text;
  if (current === undefined) {
    return { ok: false, reason: `The section "${section}" is no longer in the document. Its heading may have been renamed.` };
  }
  if (current !== pulledText) {
    return {
      ok: false,
      reason: 'The document has changed since this text was pulled. Use "Refresh from doc" first, then push.',
    };
  }

  // Find the range to replace: element positions `from` to `to`, document indexes `start` to `end`.
  const firstBody = content.findIndex((el) => !el.sectionBreak);
  if (firstBody === -1) return { ok: false, reason: 'The document appears to be empty.' };
  const headings = content.map((el, i) => (isTopHeading(el) ? i : -1)).filter((i) => i >= 0);
  let from: number;
  let to: number; // exclusive
  if (section === null) {
    from = firstBody;
    to = content.length;
  } else if (!headings.length) {
    return {
      ok: false,
      reason: 'This document has no heading styles, so a single section cannot be located safely. Only whole-document text can be pushed.',
    };
  } else if (section === '(Before the first heading)') {
    from = firstBody;
    to = headings[0];
  } else {
    const h = headings.find((i) => paragraphText(content[i]) === section);
    if (h === undefined) return { ok: false, reason: `The section "${section}" could not be located in the document.` };
    from = h;
    to = headings.find((i) => i > h) ?? content.length;
  }
  const start = content[from].startIndex ?? 1;
  const isLast = to === content.length;
  const end = isLast ? bodyEnd : (content[to].startIndex ?? bodyEnd);

  // Refuse if the range holds anything that plain paragraphs cannot carry.
  for (const el of content.slice(from, to)) {
    const rich =
      el.table ||
      el.tableOfContents ||
      el.paragraph?.bullet ||
      (el.paragraph?.elements ?? []).some((e) => !e.textRun);
    if (rich) {
      return {
        ok: false,
        reason:
          'This part of the document contains lists, tables, images or other elements that would be lost or flattened. Edit it in Google Docs instead, then refresh.',
      };
    }
  }

  // Turn the layout text into paragraphs with heading levels and styled runs.
  const paragraphs: Array<{ text: string; level: number; runs: Array<{ from: number; to: number; bold: boolean; italic: boolean }> }> = [];
  for (const line of parseMarkup(newText)) {
    let text = '';
    const runs: Array<{ from: number; to: number; bold: boolean; italic: boolean }> = [];
    for (const seg of line.segments) {
      const piece = newText.slice(seg.from, seg.to);
      if (seg.bold || seg.italic) runs.push({ from: text.length, to: text.length + piece.length, bold: seg.bold, italic: seg.italic });
      text += piece;
    }
    if (text.trim()) paragraphs.push({ text, level: line.level, runs });
  }
  if (!paragraphs.length) return { ok: false, reason: 'There is no text to push.' };

  // The body's final line break cannot be deleted, so the last section keeps it
  // and the inserted text does not add one.
  const deleteEnd = isLast ? end - 1 : end;
  const inserted = paragraphs.map((p) => p.text).join('\n') + (isLast ? '' : '\n');

  const requests: object[] = [];
  if (deleteEnd > start) requests.push({ deleteContentRange: { range: { startIndex: start, endIndex: deleteEnd } } });
  requests.push({ insertText: { location: { index: start }, text: inserted } });
  // Inserted text takes on its neighbour's formatting; clear that before applying ours.
  requests.push({
    updateTextStyle: {
      range: { startIndex: start, endIndex: start + inserted.length },
      textStyle: { bold: false, italic: false },
      fields: 'bold,italic',
    },
  });
  let offset = start;
  for (const p of paragraphs) {
    requests.push({
      updateParagraphStyle: {
        // The range includes the paragraph's line break.
        range: { startIndex: offset, endIndex: offset + p.text.length + 1 },
        paragraphStyle: { namedStyleType: p.level ? `HEADING_${p.level}` : 'NORMAL_TEXT' },
        fields: 'namedStyleType',
      },
    });
    for (const run of p.runs) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: offset + run.from, endIndex: offset + run.to },
          textStyle: run.bold ? { bold: true } : { italic: true },
          fields: run.bold ? 'bold' : 'italic',
        },
      });
    }
    offset += p.text.length + 1;
  }
  return { ok: true, requests };
}
