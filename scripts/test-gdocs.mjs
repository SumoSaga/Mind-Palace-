// Checks the Google Doc converter against hand-made documents shaped like the
// Docs API's responses. Run with: node scripts/test-gdocs.mjs
import assert from 'node:assert/strict';
import { convertDoc, parseDocId, summariseChanges } from '../src/gdocs/convert.ts';

const run = (content, textStyle) => ({ textRun: { content, textStyle } });
const para = (style, ...elements) => ({
  paragraph: { elements, paragraphStyle: { namedStyleType: style } },
});

// A doc with proper heading styles.
const styled = {
  title: 'The Wilds',
  body: {
    content: [
      { sectionBreak: {} },
      para('NORMAL_TEXT', run('A note before any heading.\n')),
      para('HEADING_1', run('Chapter One\n', { bold: true })),
      para('NORMAL_TEXT', run('The '), run('old road ', { bold: true }), run('runs ', { bold: true }), run('north, '), run('they say', { italic: true }), run('.\n')),
      para('NORMAL_TEXT', run('\n')),
      para('HEADING_2', run('The Inn\n')),
      { paragraph: { elements: [run('A bed\n')], paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, bullet: { listId: 'x' } } },
      {
        table: {
          tableRows: [
            { tableCells: [{ content: [para('NORMAL_TEXT', run('Ale\n'))] }, { content: [para('NORMAL_TEXT', run('2 cp\n'))] }] },
          ],
        },
      },
      para('HEADING_1', run('Chapter Two\n')),
      para('NORMAL_TEXT', run('Line one\u000bline two\n')),
      para('HEADING_4', run('Deep heading\n')),
    ],
  },
};

const a = convertDoc(styled);
assert.equal(a.title, 'The Wilds');
assert.deepEqual(
  a.sections.map((s) => s.title),
  ['(Before the first heading)', 'Chapter One', 'Chapter Two'],
);
assert.equal(a.sections[0].text, 'A note before any heading.');
assert.equal(
  a.sections[1].text,
  ['# Chapter One', 'The **old road runs** north, *they say*.', '## The Inn', '• A bed', 'Ale | 2 cp'].join('\n\n'),
);
assert.equal(a.sections[2].text, ['# Chapter Two', 'Line one\nline two', '### Deep heading'].join('\n\n'));
assert.equal(a.text, a.sections.map((s) => s.text).join('\n\n'));

// A doc with no heading styles: short all-bold lines become headings.
const unstyled = {
  body: {
    content: [
      para('NORMAL_TEXT', run('Magic\n', { bold: true })),
      para('NORMAL_TEXT', run('Spells cost '), run('mana', { bold: true }), run('.\n')),
      para('NORMAL_TEXT', run('Combat\n', { bold: true })),
      para('NORMAL_TEXT', run('Roll a d20.\n')),
    ],
  },
};
const b = convertDoc(unstyled);
assert.equal(b.title, 'Untitled document');
assert.deepEqual(b.sections.map((s) => s.title), ['Magic', 'Combat']);
assert.equal(b.sections[0].text, '# Magic\n\nSpells cost **mana**.');

assert.equal(convertDoc({}).text, '');

assert.equal(parseDocId('https://docs.google.com/document/d/1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789/edit?tab=t.0'), '1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789');
assert.equal(parseDocId('  1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789 '), '1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789');
assert.equal(parseDocId('https://example.com/nope'), null);

assert.deepEqual(summariseChanges('a\n\nb\n\nc', 'a\n\nb2\n\nc\n\nd'), { added: ['b2', 'd'], removed: ['b'] });

console.log('gdocs converter: all checks passed');
