// Checks the card-data table parser and placeholder filling.
// Run with: node scripts/test-cards.mjs
import assert from 'node:assert/strict';
import { cardRows, copiesOf, fillTemplate, parseTable, rowRecord, valueOf } from '../src/cards/table.ts';

// Tab-separated, as copied from Google Sheets or Excel.
const tsv = parseTable('Name\tCost\tText\nFireball\t3\tDeal 4 damage.\n\nShield\t1\tBlock, then draw.\n');
assert.deepEqual(tsv.columns, ['Name', 'Cost', 'Text']);
assert.deepEqual(tsv.rows, [
  ['Fireball', '3', 'Deal 4 damage.'],
  ['Shield', '1', 'Block, then draw.'],
]);

// CSV with quotes, a comma and a line break inside a value, an escaped quote, CRLF and a BOM.
const csv = parseTable('﻿Name,Text,Count\r\n"Sword, Rusty","Says ""hello""\nthen strikes",2\r\nBow,,\r\n');
assert.deepEqual(csv.columns, ['Name', 'Text', 'Count']);
assert.deepEqual(csv.rows, [
  ['Sword, Rusty', 'Says "hello"\nthen strikes', '2'],
  ['Bow', '', ''],
]);

// Short rows are padded; extra cells are ignored.
assert.deepEqual(parseTable('A,B\n1\n2,3,4').rows, [
  ['1', ''],
  ['2', '3'],
]);
assert.deepEqual(parseTable(''), { columns: [], rows: [] });

const record = rowRecord(csv, 0);
assert.equal(fillTemplate('# {{Name}}\n\n{{ text }} ({{COUNT}}) {{Missing}}', record), '# Sword, Rusty\n\nSays "hello"\nthen strikes (2) {{Missing}}');
assert.equal(valueOf(record, 'NAME'), 'Sword, Rusty');
assert.equal(valueOf(record, undefined), undefined);

// Copies: a Count column repeats the card; blank or bad values mean one copy; zero skips it.
assert.equal(copiesOf(record), 2);
assert.equal(copiesOf(rowRecord(csv, 1)), 1); // a blank Count is one copy
assert.equal(copiesOf({ name: 'x' }), 1);
assert.equal(copiesOf({ qty: 'lots' }), 1);
assert.deepEqual(cardRows(parseTable('Name,Qty\nA,2\nB,0\nC,1')), [0, 0, 2]);
assert.deepEqual(cardRows(tsv), [0, 1]);

console.log('card data: all checks passed');
