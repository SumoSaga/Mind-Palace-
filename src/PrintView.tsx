import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { FlowInfo } from './flow';
import { boxStyle, flowTextStyle } from './ItemView';
import { pageLocation } from './store';
import type { Item, Layout, Page } from './store';

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
}

export interface PrintPlan {
  sheetW: number;
  sheetH: number;
  sheets: Cell[][];
  marks: CSSProperties[];
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
  const pad = bleed + (layout.marks ? MARK_GAP + MARK_LENGTH : 0);
  const sheetW = layout.w + pad * 2;
  const sheetH = layout.h + pad * 2;
  const marks: CSSProperties[] = [];
  if (layout.marks) {
    for (const x of [pad, pad + layout.w]) {
      for (const y of [pad, pad + layout.h]) {
        marks.push(hLine(x === pad ? 0 : sheetW - MARK_LENGTH, y, MARK_LENGTH));
        marks.push(vLine(x, y === pad ? 0 : sheetH - MARK_LENGTH, MARK_LENGTH));
      }
    }
  }
  return {
    sheetW,
    sheetH,
    sheets: pages.map((page) => [{ page, x: pad, y: pad }]),
    marks,
    perSheet: 1,
    tooBig: !!paper,
  };
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
  pages: Page[];
  items: Item[];
  /** The portion of text each linked frame shows. */
  flow: Map<string, FlowInfo>;
}) {
  const bleed = layout.bleed ?? 0;
  const plan = planPrint(layout, pages);

  return createPortal(
    <div className="print-root">
      <style>{`@page { size: ${plan.sheetW}pt ${plan.sheetH}pt; margin: 0; }`}</style>
      {plan.sheets.map((cells, s) => (
        <div key={s} className="print-page" style={{ width: pt(plan.sheetW), height: pt(plan.sheetH) }}>
          {cells.map(({ page, x, y }) => {
            const location = pageLocation(page.id);
            return (
              // Everything outside the bleed is cut off; inside it, frames keep their page positions.
              <div
                key={page.id}
                className="print-bleed"
                style={{
                  left: pt(x - bleed),
                  top: pt(y - bleed),
                  width: pt(layout.w + bleed * 2),
                  height: pt(layout.h + bleed * 2),
                }}
              >
                <div className="print-trim" style={{ left: pt(bleed), top: pt(bleed) }}>
                  {items
                    .filter((it) => it.location === location)
                    .map((it) => (
                      <div key={it.id} className={`item item-${it.type} on-page`} style={boxStyle(it, 'pt')}>
                        {it.type === 'image' && <img src={it.src} alt="" />}
                        {it.type === 'text' && (
                          <div className="text" style={flowTextStyle(it, 'pt', flow.get(it.id))}>
                            {flow.get(it.id)?.text ?? it.text}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
          {plan.marks.map((style, i) => (
            <div key={i} className="crop-mark" style={style} />
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
