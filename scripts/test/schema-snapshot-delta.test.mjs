/* scripts/db/snapshot-delta.mjs rebuilds a schema snapshot section from a saved
   snapshot plus the few rows a release touched, and refuses unless the database's own
   md5 of the untouched rows and of the whole section both agree. These tests play the
   database with the same canonical text Postgres prints. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NO_CHANGE, applyDelta, checkExpression, deltaSql } from '../db/snapshot-delta.mjs';
import { SECTIONS, canonicalJsonbText } from '../db/schema-queries.mjs';

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

// What the delta statement returns for `rows` (the live section) and an expression.
function database(rows, expr) {
  const re = new RegExp(expr);
  const matched = [];
  const rest = [];
  rows.forEach((row, i) => (re.test(canonicalJsonbText(row)) ? matched.push([i + 1, row]) : rest.push(row)));
  return [{ md5: md5(canonicalJsonbText(rows)), n: rows.length, matched, rest_md5: md5(canonicalJsonbText(rest)), rest_n: rest.length }];
}

const BASE = [
  ['public', 'alpha', 'r', true, 'aaaa'],
  ['public', 'beta', 'r', true, 'bbbb'],
  ['public', 'delta', 'r', false, 'dddd'],
];

test('an unchanged section is proven by its md5 alone', () => {
  const rebuilt = applyDelta('relations', BASE, NO_CHANGE, database(BASE, NO_CHANGE));
  assert.deepEqual(rebuilt.j, BASE);
  assert.equal(rebuilt.matched, 0);
});

test('added, replaced and removed rows inside the expression are rebuilt in database order', () => {
  const live = [
    ['public', 'alpha', 'r', true, 'aaaa'],
    ['public', 'beta', 'r', true, 'CHANGED'],
    ['public', 'claims', 'r', true, 'cccc'],
  ];
  const expr = '"(beta|claims|delta)"';
  const rebuilt = applyDelta('relations', BASE, expr, database(live, expr));
  assert.deepEqual(rebuilt.j, live);
  assert.equal(rebuilt.kept, 1);
  assert.equal(rebuilt.matched, 2);
});

test('a change outside the expression is refused, not papered over', () => {
  const live = [['public', 'alpha', 'r', false, 'aaaa'], BASE[1], BASE[2], ['public', 'claims', 'r', true, 'cccc']];
  const expr = '"claims"';
  assert.throws(() => applyDelta('relations', BASE, expr, database(live, expr)), /rows outside the expression differ/);
});

test('a row added outside the expression is refused by count', () => {
  const live = [...BASE, ['public', 'zeta', 'r', true, 'zzzz']];
  assert.throws(() => applyDelta('relations', BASE, NO_CHANGE, database(live, NO_CHANGE)), /added or removed/);
});

test('a matched row copied wrongly fails the whole-section md5', () => {
  const live = [...BASE, ['public', 'claims', 'r', true, 'cccc']];
  const expr = '"claims"';
  const answer = database(live, expr);
  answer[0].matched[0][1] = ['public', 'claims', 'r', true, 'cccd'];
  assert.throws(() => applyDelta('relations', BASE, expr, answer), /do not hash to the database md5/);
});

test('a matched row that does not match the expression, a bad position or a short list is refused', () => {
  const live = [...BASE, ['public', 'claims', 'r', true, 'cccc']];
  const expr = '"claims"';
  const wrongRow = database(live, expr);
  wrongRow[0].matched[0][1] = ['public', 'other', 'r', true, 'cccc'];
  assert.throws(() => applyDelta('relations', BASE, expr, wrongRow), /does not match the expression/);
  const badOrd = database(live, expr);
  badOrd[0].matched[0][0] = 9;
  assert.throws(() => applyDelta('relations', BASE, expr, badOrd), /bad position/);
  const short = database(live, expr);
  short[0].matched = [];
  assert.throws(() => applyDelta('relations', BASE, expr, short), /rows expected/);
});

test('the statement is one SELECT around the canonical section query and embeds only a portable expression', () => {
  const sql = deltaSql('functions', '"(media_claim_operation_v1|media_bind_operation_v1)"');
  assert.ok(sql.includes(SECTIONS.functions.sql));
  assert.match(sql, /^with s as \(select md5\(j::text\) as md5, j from /);
  assert.doesNotMatch(sql, /\b(insert into|update\s+\w+\s+set|delete from|create |alter |drop |grant |revoke |truncate |copy )/i);
  assert.match(sql, /\nfrom s$/); // one statement: the section query in a CTE, read once
  assert.equal(sql.replace(/'[^']*'/g, "''").includes(';'), false);
  for (const bad of ["a'b", 'a\\d', '(?=a)', 'a;b', 'a`b']) assert.throws(() => checkExpression(bad));
  assert.throws(() => deltaSql('nope'));
});
