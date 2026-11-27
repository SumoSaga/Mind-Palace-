/**
 * Data-driven cards: a layout's pages act as a template, and a table of rows
 * (pasted from a spreadsheet, or a CSV file) supplies the content. Each row
 * makes one card. Text frames use placeholders such as {{Name}}; image frames
 * can be tied to a column holding image links.
 *
 * No imports, so Node can run this file in tests.
 */

export interface CardData {
  columns: string[];
  rows: string[][];
}

/**
 * Parses a table copied from a spreadsheet (tab-separated) or a CSV file
 * (comma-separated, with "quoted, values" and "" for a quote inside quotes).
 * The first row is the column names. Blank rows are dropped.
 */
export function parseTable(text: string): CardData {
  const source = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = source.slice(0, source.indexOf('\n') === -1 ? undefined : source.indexOf('\n'));
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  const table: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      table.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    table.push(row);
  }

  const [header = [], ...body] = table.filter((r) => r.some((c) => c.trim() !== ''));
  const columns = header.map((c) => c.trim());
  return {
    columns,
    rows: body.map((r) => columns.map((_, i) => (r[i] ?? '').trim())),
  };
}

const key = (name: string) => name.trim().toLowerCase();

/** One row as a lookup from column name (any capitalisation) to value. */
export function rowRecord(data: CardData, index: number): Record<string, string> {
  const record: Record<string, string> = {};
  data.columns.forEach((c, i) => {
    record[key(c)] = data.rows[index]?.[i] ?? '';
  });
  return record;
}

/** Replaces {{Column}} placeholders with the row's values. Unknown names are left as written. */
export function fillTemplate(text: string, record: Record<string, string>): string {
  return text.replace(/\{\{([^{}\n]+)\}\}/g, (whole, name: string) => record[key(name)] ?? whole);
}

/** The row's value for a column, by name. */
export function valueOf(record: Record<string, string>, column: string | undefined): string | undefined {
  return column === undefined ? undefined : record[key(column)];
}

const COPY_COLUMNS = ['count', 'qty', 'quantity', 'copies'];

/** How many copies of a row's card to make: its Count, Qty, Quantity or Copies column, else 1. */
export function copiesOf(record: Record<string, string>): number {
  for (const name of COPY_COLUMNS) {
    if (name in record) {
      if (record[name].trim() === '') return 1; // a blank cell means one copy, not none
      const n = Math.floor(Number(record[name]));
      return Number.isFinite(n) && n >= 0 ? Math.min(n, 999) : 1;
    }
  }
  return 1;
}

/** The row index for each card to print, in order, with rows repeated for their copies. */
export function cardRows(data: CardData): number[] {
  const out: number[] = [];
  data.rows.forEach((_, i) => {
    for (let n = copiesOf(rowRecord(data, i)); n > 0; n--) out.push(i);
  });
  return out;
}
