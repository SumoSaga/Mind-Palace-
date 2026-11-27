import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { FlowInfo } from './flow';
import { boxStyle, imageSrc, itemHtml, textStyle } from './ItemView';
import { pageLocation } from './store';
import type { Item, Layout, Page as LayoutPage } from './store';
import { cardRows, rowRecord } from './cards/table';

/** A page to print. In a card layout, each template page is printed once per data row. */
type Page = LayoutPage & { row?: number };

/** The pages to print: the layout's own, or for a card layout the template repeated for every card. */
export function printPages(layout: Layout, pages: LayoutPage[]): Page[] {
  if (!layout.data?.rows.length) return pages;
  return cardRows(layout.data).flatMap((row) => pages.map((p) => ({ ...p, row })));
}
import { getTheme } from './themes';

/** Paper sizes for tiling several small pages (cards) onto one sheet, in points. */
export const PAPERS = {
  letter: { label: 'Letter sheets', w: 612, h: 792 },
  a4: { label: 'A4 sheets', w: 595.28, h: 841.89 },
} as const;

// Crop marks: short lines outside the bleed showing where to trim.
const MARK_GAP = 6;
const MARK_LENGTH = 18;
/** Home printers cannot print to the paper's edge; keep cards this far inside it. */
const PAPER_MARGIN = 18;
const CUT_MARK_LENGTH = 12;
const CUT_MARK_GAP = 4;

interface Cell {
  page: Page;
  /** Top-left of the trimmed page on the sheet, in points. */
  x: number;
  y: number;
  /** Bleed on the left and right edges, when it differs from the layout's bleed. */
  bleedLeft?: number;
  bleedRight?: number;
}

export interface PrintPlan {
  sheetW: number;
  sheetH: number;
  sheets: Cell[][];
  /** Cut marks drawn on every sheet. */
  marks: CSSProperties[];
  /** Crop marks that differ from sheet to sheet, by sheet index. */
  sheetMarks?: CSSProperties[][];
  /** How many pages fit on one sheet; 1 when printing each page on its own. */
  perSheet: number;
  /** True when sheets were asked for but the page is too big for the paper. */
  tooBig: boolean;
}

const pt = (v: number) => `${v}pt`;
const hLine = (x: number, y: number, length: number): CSSProperties => ({
  left: pt(x),
  top: pt(y - 0.25),
  width: pt(length),
  height: '0.5pt',
});
const vLine = (x: number, y: number, length: number): CSSProperties => ({
  left: pt(x - 0.25),
  top: pt(y),
  width: '0.5pt',
  height: pt(length),
});

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Works out the printed sheets: their size, where each page sits, and the cut marks. */
export function planPrint(layout: Layout, pages: Page[]): PrintPlan {
  const bleed = layout.bleed ?? 0;
  const paper = layout.sheet ? PAPERS[layout.sheet] : undefined;

  if (paper) {
    // Each card takes its trimmed size plus bleed on every side, so bleeds meet between cards.
    const cellW = layout.w + bleed * 2;
    const cellH = layout.h + bleed * 2;
    const fit = (pw: number, ph: number) => ({
      pw,
      ph,
      cols: Math.floor((pw - PAPER_MARGIN * 2) / cellW),
      rows: Math.floor((ph - PAPER_MARGIN * 2) / cellH),
    });
    // Use whichever paper orientation holds more cards.
    const portrait = fit(paper.w, paper.h);
    const landscape = fit(paper.h, paper.w);
    const best = landscape.cols * landscape.rows > portrait.cols * portrait.rows ? landscape : portrait;
    const { pw, ph, cols, rows } = best;
    const perSheet = cols * rows;

    if (perSheet > 0) {
      const gx = (pw - cols * cellW) / 2;
      const gy = (ph - rows * cellH) / 2;
      const place = (page: Page, i: number, mirrored: boolean): Cell => {
        const col = i % cols;
        return {
          page,
          x: gx + (mirrored ? cols - 1 - col : col) * cellW + bleed,
          y: gy + Math.floor(i / cols) * cellH + bleed,
        };
      };

      let sheets: Cell[][];
      if (layout.duplex) {
        // Odd pages are fronts, even pages their backs. Each back sheet mirrors the
        // columns so that a back lands behind its front when the paper is turned over.
        const fronts = pages.filter((_, i) => i % 2 === 0);
        const backs = pages.filter((_, i) => i % 2 === 1);
        sheets = [];
        chunk(fronts, perSheet).forEach((group, s) => {
          sheets.push(group.map((p, i) => place(p, i, false)));
          const backGroup = backs.slice(s * perSheet, (s + 1) * perSheet);
          sheets.push(backGroup.map((p, i) => place(p, i, true)));
        });
      } else {
        sheets = chunk(pages, perSheet).map((group) => group.map((p, i) => place(p, i, false)));
      }

      // Cut marks in the paper's margin, in line with every card edge.
      const marks: CSSProperties[] = [];
      const vLen = Math.min(CUT_MARK_LENGTH, gy - CUT_MARK_GAP - 2);
      const hLen = Math.min(CUT_MARK_LENGTH, gx - CUT_MARK_GAP - 2);
      const gridBottom = gy + rows * cellH;
      const gridRight = gx + cols * cellW;
      if (vLen > 2) {
        for (let c = 0; c < cols; c++) {
          for (const x of [gx + c * cellW + bleed, gx + c * cellW + bleed + layout.w]) {
            marks.push(vLine(x, gy - CUT_MARK_GAP - vLen, vLen), vLine(x, gridBottom + CUT_MARK_GAP, vLen));
          }
        }
      }
      if (hLen > 2) {
        for (let r = 0; r < rows; r++) {
          for (const y of [gy + r * cellH + bleed, gy + r * cellH + bleed + layout.h]) {
            marks.push(hLine(gx - CUT_MARK_GAP - hLen, y, hLen), hLine(gridRight + CUT_MARK_GAP, y, hLen));
          }
        }
      }
      return { sheetW: pw, sheetH: ph, sheets, marks, perSheet, tooBig: false };
    }
  }

  // One page per sheet: the sheet is the page plus its bleed, plus room for crop marks if on.
  const markPad = layout.marks ? MARK_GAP + MARK_LENGTH : 0;
  // A bound book has no bleed on the binding edge (the inner edge of each facing
  // page), which is how book printers ask for files. Page 1 is a right-hand page.
  const bound = layout.facing && !layout.data && bleed > 0;
  const sheetW = layout.w + (bound ? bleed : bleed * 2) + markPad * 2;
  const sheetH = layout.h + bleed * 2 + markPad * 2;
  const y = markPad + bleed;
  const sheets: Cell[][] = pages.map((page, i) => {
    const bindingLeft = i % 2 === 0;
    const bleedLeft = bound && bindingLeft ? 0 : bleed;
    const bleedRight = bound && !bindingLeft ? 0 : bleed;
    return [{ page, x: markPad + bleedLeft, y, bleedLeft, bleedRight }];
  });
  const sheetMarks = sheets.map(([c]) => {
    if (!layout.marks) return [];
    const left = c.x - (c.bleedLeft ?? bleed) - MARK_GAP - MARK_LENGTH;
    const right = c.x + layout.w + (c.bleedRight ?? bleed) + MARK_GAP;
    const bottom = y + layout.h + bleed + MARK_GAP;
    return [
      hLine(left, y, MARK_LENGTH),
      hLine(right, y, MARK_LENGTH),
      hLine(left, y + layout.h, MARK_LENGTH),
      hLine(right, y + layout.h, MARK_LENGTH),
      vLine(c.x, 0, MARK_LENGTH),
      vLine(c.x + layout.w, 0, MARK_LENGTH),
      vLine(c.x, bottom, MARK_LENGTH),
      vLine(c.x + layout.w, bottom, MARK_LENGTH),
    ];
  });
  return { sheetW, sheetH, sheets, marks: [], sheetMarks, perSheet: 1, tooBig: !!paper };
}

/**
 * The pages at physical size, shown only when printing. The browser's print
 * dialog then prints at true size or saves a PDF with real text.
 */
export function PrintView({
  layout,
  pages,
  items,
  flow,
}: {
  layout: Layout;
  pages: LayoutPage[];
  items: Item[];
  /** The portion of text each linked frame shows. */
  flow: Map<string, FlowInfo>;
}) {
  const bleed = layout.bleed ?? 0;
  const plan = planPrint(layout, printPages(layout, pages));
  const paper = getTheme(layout.theme).paper;

  return createPortal(
    <div className="print-root">
      <style>{`@page { size: ${plan.sheetW}pt ${plan.sheetH}pt; margin: 0; }`}</style>
      {plan.sheets.map((cells, s) => (
        <div key={s} className="print-page" style={{ width: pt(plan.sheetW), height: pt(plan.sheetH) }}>
          {cells.map(({ page, x, y, bleedLeft = bleed, bleedRight = bleed }, c) => {
            const location = pageLocation(page.id);
            const record = layout.data && page.row !== undefined ? rowRecord(layout.data, page.row) : undefined;
            return (
              // Everything outside the bleed is cut off; inside it, frames keep their page positions.
              <div
                key={c}
                className="print-bleed"
                style={{
                  left: pt(x - bleedLeft),
                  top: pt(y - bleed),
                  width: pt(layout.w + bleedLeft + bleedRight),
                  height: pt(layout.h + bleed * 2),
                  background: paper,
                }}
              >
                <div className="print-trim" style={{ left: pt(bleedLeft), top: pt(bleed) }}>
                  {items
                    .filter((it) => it.location === location)
                    .map((it) => (
                      <div key={it.id} className={`item item-${it.type} on-page`} style={boxStyle(it, 'pt')}>
                        {it.type === 'image' && (
                          <img src={imageSrc(it, record)} alt="" className={it.bind ? 'bound' : undefined} />
                        )}
                        {it.type === 'text' && (
                          <div
                            className="text"
                            style={textStyle(it, 'pt')}
                            dangerouslySetInnerHTML={{ __html: itemHtml(it, flow.get(it.id), record) }}
                          />
                        )}
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
          {[...plan.marks, ...(plan.sheetMarks?.[s] ?? [])].map((style, i) => (
            <div key={i} className="crop-mark" style={style} />
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
