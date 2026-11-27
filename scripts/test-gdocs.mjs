// Checks the Google Doc converter against hand-made documents shaped like the
// Docs API's responses. Run with: node scripts/test-gdocs.mjs
import assert from 'node:assert/strict';
import { convertDoc, imageAddresses, parseDocId, summariseChanges, unresolvedImages, withImageAddresses, withoutImageAddresses } from '../src/gdocs/convert.ts';
import { parseMarkup, renderAll } from '../src/markup.ts';

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

// Formatting that comes across: alignment, underline, bold-italic, numbered and
// nested lists, pictures, and headings made only by using larger text.
{
  const sized = (text, size, extra = {}) => run(text, { fontSize: { magnitude: size }, ...extra });
  const p = (elements, style = {}, bullet) => ({ paragraph: { elements, paragraphStyle: { namedStyleType: 'NORMAL_TEXT', ...style }, ...(bullet ? { bullet } : {}) } });
  const rich = {
    title: 'Rich',
    lists: {
      num: { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL' }, { glyphType: 'ALPHA' }] } },
      dots: { listProperties: { nestingLevels: [{ glyphSymbol: '●' }] } },
    },
    inlineObjects: {
      'kix.pic1': {
        inlineObjectProperties: {
          embeddedObject: { imageProperties: { contentUri: 'https://lh3.googleusercontent.com/abc' }, size: { width: { magnitude: 300 }, height: { magnitude: 150.26 } } },
        },
      },
    },
    body: {
      content: [
        p([sized('The Big Title\n', 26)], { alignment: 'CENTER' }),
        p([sized('A long paragraph of ordinary body text, set at eleven points like the rest of the document is.\n', 11)]),
        p([sized('Smaller Heading\n', 16)]),
        p([sized('Both ', 11), sized('strong and slanted', 11, { bold: true, italic: true }), sized(' and ', 11), sized('underlined', 11, { underline: true }), sized('.\n', 11)], { alignment: 'JUSTIFIED' }),
        p([sized('Signed, the author\n', 11)], { alignment: 'END' }),
        p([sized('First\n', 11)], {}, { listId: 'num' }),
        p([sized('Inner\n', 11)], {}, { listId: 'num', nestingLevel: 1 }),
        p([sized('Second\n', 11)], {}, { listId: 'num' }),
        p([sized('Loose\n', 11)], {}, { listId: 'dots' }),
        p([{ inlineObjectElement: { inlineObjectId: 'kix.pic1' } }, run('\n')], { alignment: 'CENTER' }),
      ],
    },
  };
  const r = convertDoc(rich);
  assert.equal(
    r.text,
    [
      '{center} # The Big Title',
      'A long paragraph of ordinary body text, set at eleven points like the rest of the document is.',
      '## Smaller Heading',
      '{justify} Both ***strong and slanted*** and __underlined__.',
      '{right} Signed, the author',
      '1. First',
      '    1. Inner',
      '2. Second',
      '• Loose',
      '{center} ![300x150.3](#kix.pic1)',
    ].join('\n\n'),
  );
  assert.deepEqual(r.imageSources, { 'kix.pic1': 'https://lh3.googleusercontent.com/abc' });
  assert.deepEqual(r.sections.map((s) => s.title), ['The Big Title']);

  // Pictures: filling in stored addresses and taking them out again.
  assert.deepEqual(unresolvedImages(r.text), ['kix.pic1']);
  const filled = withImageAddresses(r.text, { 'kix.pic1': '/files/0a1b' });
  assert.ok(filled.endsWith('![300x150.3](/files/0a1b#kix.pic1)'));
  assert.deepEqual(unresolvedImages(filled), []);
  assert.deepEqual(imageAddresses(filled), { 'kix.pic1': '/files/0a1b' });
  assert.equal(withoutImageAddresses(filled), r.text);

  // And the layout shows them.
  const html = renderAll(filled);
  assert.match(html, /<div class="tl h1" style="text-align:center;">The Big Title<\/div>/);
  assert.match(html, /<i><b>strong and slanted<\/b><\/i>/);
  assert.match(html, /<u>underlined<\/u>/);
  assert.match(html, /<div class="tl img" style="text-align:center;"><img src="\/files\/0a1b"/);
  // A picture that was never copied in, or from an address that is not allowed, is not shown.
  assert.doesNotMatch(renderAll('![10x10](#kix.x)\n![10x10](javascript:alert(1))\n![10x10](http://plain.example/a.png)'), /<img/);
  assert.equal(parseMarkup('2 * 3 * 4 and snake_case__name')[0].segments.length, 1);
}

console.log('gdocs converter: all checks passed');
