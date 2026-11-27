// Checks the plan for writing text back to a Google Doc, by applying the
// planned requests to a small in-memory model of a document and reading the
// result back through the converter. Run with: node scripts/test-gdocs-push.mjs
import assert from 'node:assert/strict';
import { convertDoc } from '../src/gdocs/convert.ts';
import { planPush } from '../src/gdocs/push.ts';

/** Builds a doc like the Docs API returns, with indexes, from simple paragraphs. */
function makeDoc(paragraphs) {
  const content = [{ endIndex: 1, sectionBreak: {} }];
  let index = 1;
  for (const p of paragraphs) {
    if (p.table) {
      content.push({ startIndex: index, endIndex: index + 5, table: { tableRows: [] } });
      index += 5;
      continue;
    }
    const runs = p.runs ?? [{ text: p.text }];
    const elements = runs.map((r, i) => {
      const text = r.text + (i === runs.length - 1 ? '\n' : '');
      return { textRun: { content: text, textStyle: { bold: !!r.bold, italic: !!r.italic } } };
    });
    const length = elements.reduce((n, e) => n + e.textRun.content.length, 0);
    content.push({
      startIndex: index,
      endIndex: index + length,
      paragraph: { elements, paragraphStyle: { namedStyleType: p.style ?? 'NORMAL_TEXT' }, ...(p.bullet ? { bullet: {} } : {}) },
    });
    index += length;
  }
  return { title: 'Test', body: { content } };
}

/** A character-level model of the doc body, enough to apply the planned requests. */
function applyRequests(doc, requests) {
  // One entry per character (index 0 is the section break), each with styles.
  const chars = [{ ch: '\u0000' }];
  const paraStyle = []; // style for the paragraph ending at each '\n'
  for (const el of doc.body.content) {
    if (!el.paragraph) continue;
    for (const e of el.paragraph.elements) {
      for (const ch of e.textRun.content) {
        chars.push({ ch, bold: !!e.textRun.textStyle?.bold, italic: !!e.textRun.textStyle?.italic, style: el.paragraph.paragraphStyle.namedStyleType });
      }
    }
  }
  for (const req of requests) {
    if (req.deleteContentRange) {
      const { startIndex, endIndex } = req.deleteContentRange.range;
      assert.ok(endIndex > startIndex && endIndex <= chars.length - 1, 'delete range must be non-empty and keep the final line break');
      chars.splice(startIndex, endIndex - startIndex);
    } else if (req.insertText) {
      const at = req.insertText.location.index;
      assert.ok(at >= 1 && at < chars.length, 'insert index must be inside the body');
      const neighbour = chars[at] ?? {};
      chars.splice(at, 0, ...[...req.insertText.text].map((ch) => ({ ch, bold: neighbour.bold, italic: neighbour.italic, style: neighbour.style })));
    } else if (req.updateTextStyle) {
      const { startIndex, endIndex } = req.updateTextStyle.range;
      assert.ok(endIndex > startIndex && endIndex <= chars.length, 'text style range must be valid');
      for (let i = startIndex; i < endIndex; i++) Object.assign(chars[i], req.updateTextStyle.textStyle);
    } else if (req.updateParagraphStyle) {
      const { startIndex, endIndex } = req.updateParagraphStyle.range;
      assert.ok(endIndex > startIndex && endIndex <= chars.length, 'paragraph style range must be valid');
      assert.equal(chars[endIndex - 1].ch, '\n', 'paragraph style range must end on a line break');
      for (let i = startIndex; i < endIndex; i++) chars[i].style = req.updateParagraphStyle.paragraphStyle.namedStyleType;
    }
  }
  // Rebuild paragraphs from the characters.
  const paragraphs = [];
  let runs = [];
  for (const c of chars.slice(1)) {
    if (c.ch === '\n') {
      paragraphs.push({ runs: runs.length ? runs : [{ text: '' }], style: c.style });
      runs = [];
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last.bold === !!c.bold && last.italic === !!c.italic) last.text += c.ch;
    else runs.push({ text: c.ch, bold: !!c.bold, italic: !!c.italic });
  }
  void paraStyle;
  return makeDoc(paragraphs);
}

const original = makeDoc([
  { text: 'Preface line.' },
  { text: 'Chapter One', style: 'HEADING_1' },
  { runs: [{ text: 'The ' }, { text: 'old road', bold: true }, { text: ' runs north.' }] },
  { text: 'Chapter Two', style: 'HEADING_1' },
  { text: 'It ends here.' },
]);
const before = convertDoc(original);
const sectionText = (doc, title) => convertDoc(doc).sections.find((s) => s.title === title)?.text;

// Replace a middle section, adding a subheading and italic.
{
  const pulled = sectionText(original, 'Chapter One');
  const edited = '# Chapter One\n\nThe **old road** runs *far* north.\n\n## The Inn\n\nA new paragraph.';
  const plan = planPush(original, 'Chapter One', pulled, edited);
  assert.ok(plan.ok, plan.reason);
  const after = applyRequests(original, plan.requests);
  assert.equal(sectionText(after, 'Chapter One'), edited);
  // Neighbouring sections are untouched.
  assert.equal(sectionText(after, '(Before the first heading)'), before.sections[0].text);
  assert.equal(sectionText(after, 'Chapter Two'), sectionText(original, 'Chapter Two'));
}

// Replace the last section (the body's final line break must survive).
{
  const pulled = sectionText(original, 'Chapter Two');
  const edited = '# Chapter Two\n\nIt ends **here**, at last.\n\nAnd one more line.';
  const plan = planPush(original, 'Chapter Two', pulled, edited);
  assert.ok(plan.ok, plan.reason);
  const after = applyRequests(original, plan.requests);
  assert.equal(sectionText(after, 'Chapter Two'), edited);
  assert.equal(sectionText(after, 'Chapter One'), sectionText(original, 'Chapter One'));
}

// Replace the text before the first heading.
{
  const plan = planPush(original, '(Before the first heading)', 'Preface line.', 'A *new* preface.\n\nIn two paragraphs.');
  assert.ok(plan.ok, plan.reason);
  const after = applyRequests(original, plan.requests);
  assert.equal(sectionText(after, '(Before the first heading)'), 'A *new* preface.\n\nIn two paragraphs.');
  assert.equal(sectionText(after, 'Chapter One'), sectionText(original, 'Chapter One'));
}

// Replace the whole document.
{
  const edited = '# Only Chapter\n\nEverything **replaced**.';
  const plan = planPush(original, null, before.text, edited);
  assert.ok(plan.ok, plan.reason);
  assert.equal(convertDoc(applyRequests(original, plan.requests)).text, edited);
}

// Refusals.
assert.match(planPush(original, 'Chapter One', 'stale text', 'x').reason, /changed since/);
assert.match(planPush(original, 'Missing', 'x', 'x').reason, /no longer in the document/);
assert.match(planPush(original, 'Chapter One', sectionText(original, 'Chapter One'), '   ').reason, /no text/);
{
  const withList = makeDoc([{ text: 'Gear', style: 'HEADING_1' }, { text: 'Rope', bullet: true }]);
  assert.match(planPush(withList, 'Gear', sectionText(withList, 'Gear'), '# Gear\n\nRope').reason, /lists, tables/);
  const withTable = makeDoc([{ text: 'Prices', style: 'HEADING_1' }, { table: true }, { text: 'End.' }]);
  assert.match(planPush(withTable, 'Prices', sectionText(withTable, 'Prices'), '# Prices\n\nEnd.').reason, /lists, tables/);
}

console.log('gdocs push plan: all checks passed');
