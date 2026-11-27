import { useRef, useState } from 'react';
import type { Layout } from '../store';
import { cardRows, parseTable } from './table';
import type { CardData } from './table';

/** Paste or load the table of rows that fills a card template. */
export function CardDataDialog({
  layout,
  onClose,
  onSave,
}: {
  layout: Layout;
  onClose: () => void;
  onSave: (data: CardData | undefined) => void;
}) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = text.trim() ? parseTable(text) : null;
  const usable = parsed && parsed.columns.length > 0 && parsed.rows.length > 0;
  const existing = layout.data;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Card data">
        <h2>Card data</h2>
        <p>
          Turn this layout into a template: each row of a table becomes one card. Copy the rows from Google Sheets or
          Excel (including the header row) and paste them below, or choose a CSV file.
        </p>
        <ul>
          <li>
            In a text frame, write a column name in double braces, such as <code>{'{{Name}}'}</code>, where its value
            should appear.
          </li>
          <li>To change the picture per card, select an image and choose the column holding its link.</li>
          <li>
            A column named <code>Count</code> (or Qty, Quantity, Copies) sets how many copies of that card to print.
          </li>
        </ul>
        {existing && (
          <p>
            This layout has data now: <b>{existing.rows.length}</b> rows, {cardRows(existing).length} cards, columns{' '}
            {existing.columns.join(', ')}.
          </p>
        )}
        <textarea
          className="data-input"
          value={text}
          placeholder={'Name\tCost\tText\nFireball\t3\tDeal 4 damage.'}
          onChange={(e) => setText(e.target.value)}
        />
        <button onClick={() => fileRef.current?.click()}>Choose a CSV file…</button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) setText(await file.text());
          }}
        />
        {parsed &&
          (usable ? (
            <p>
              Found <b>{parsed.rows.length}</b> rows ({cardRows(parsed).length} cards) with columns:{' '}
              {parsed.columns.join(', ')}.
            </p>
          ) : (
            <p className="error">That needs a header row and at least one row of values.</p>
          ))}
        <div className="modal-actions">
          {existing && (
            <button
              onClick={() => {
                onSave(undefined);
                onClose();
              }}
            >
              Remove data
            </button>
          )}
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!usable}
            onClick={() => {
              if (usable) onSave(parsed);
              onClose();
            }}
          >
            {existing ? 'Replace data' : 'Use this data'}
          </button>
        </div>
      </div>
    </div>
  );
}
