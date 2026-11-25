#!/usr/bin/env node
// Delta capture of a schema snapshot through a SELECT-only tool (the Supabase MCP
// `execute_sql`), verified by the database's own md5 of each full section.
//
// A full section is tens of kilobytes; copying it out of a tool result by hand is where
// evidence goes wrong. This asks the database for only what changed since a saved
// snapshot and proves the rest did not:
//
//   matched   the rows whose jsonb text matches a regular expression you choose (the
//             objects a release touched), each with its position in the full section;
//   rest_md5  the md5 of the section with those rows left out, which must equal the md5
//             of the saved snapshot's rows with the same rows left out;
//   md5, n    the md5 and length of the full section, which the rebuilt rows must hash to.
//
// If a row outside the expression changed, rest_md5 differs and nothing is written: widen
// the expression (or capture the section whole with verify-production-schema.mjs
// --print-sql) and run it again. The expression is applied to the same text on both sides
// (Postgres `elem::text`, canonicalJsonbText here), so matching too much is harmless.
//
// Every statement printed is one SELECT built around scripts/db/schema-queries.mjs.
// Nothing here connects to a database or writes to one.
//
// Usage:
//   node scripts/db/snapshot-delta.mjs --base <snapshot.json> --plan <plan.json> --print-sql [section]
//       plan.json: { "<section>": "<regex>" | null }  (null or absent: expect no change)
//   node scripts/db/snapshot-delta.mjs --base <snapshot.json> --plan <plan.json> \
//       --results <dir> --out-dir <mcp-dir>
//       <dir>/<section>.json holds the tool's row list for that section's statement:
//       [{"md5": "...", "n": 0, "matched": [[ord, row], ...], "rest_md5": "...", "rest_n": 0}]
//       Writes <mcp-dir>/<section>.json as [{"md5","j"}], the input of
//       verify-production-schema.mjs --from-mcp-dir.
//
// Exit: 0 written, 1 a section did not verify, 2 usage error.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SECTIONS, SECTION_NAMES, canonicalJsonbText } from './schema-queries.mjs';

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

// Matches no row: a row's jsonb text is never empty.
export const NO_CHANGE = '^$';

// The expression is embedded in a SQL string literal and compiled by JavaScript, so it is
// limited to what means the same in both: no quotes, no backslash classes, no lookaround.
export function checkExpression(expr) {
  if (typeof expr !== 'string' || !expr.length) throw new Error('expression must be a non-empty string');
  if (/['\\]/.test(expr) || /\(\?/.test(expr)) throw new Error(`expression may not contain quotes, backslashes or (?...) groups: ${expr}`);
  if (!/^[A-Za-z0-9_|()^$".:\[\], -]+$/.test(expr)) throw new Error(`expression has a character outside the portable set: ${expr}`);
  return expr;
}

export function deltaSql(name, expr = NO_CHANGE) {
  if (!SECTIONS[name]) throw new Error(`unknown section ${name}; one of ${SECTION_NAMES.join(', ')}`);
  const re = checkExpression(expr);
  return `with s as (${SECTIONS[name].sql}),
e as (select t.elem, t.ord from s, jsonb_array_elements(s.j) with ordinality as t(elem, ord))
select s.md5, jsonb_array_length(s.j) as n,
  (select coalesce(jsonb_agg(jsonb_build_array(e.ord, e.elem) order by e.ord), '[]'::jsonb) from e where e.elem::text ~ '${re}') as matched,
  (select md5(coalesce(jsonb_agg(e.elem order by e.ord), '[]'::jsonb)::text) from e where not (e.elem::text ~ '${re}')) as rest_md5,
  (select count(*) from e where not (e.elem::text ~ '${re}')) as rest_n
from s`;
}

// Rebuild a section's rows from the saved rows and the tool's answer. Throws unless the
// untouched rows and the rebuilt section both hash to what the database computed.
export function applyDelta(name, baseRows, expr, answer) {
  const re = new RegExp(checkExpression(expr || NO_CHANGE));
  const row = Array.isArray(answer) ? answer[0] : answer;
  if (!row || typeof row.md5 !== 'string') throw new Error(`${name}: no md5 in the answer`);
  const n = Number(row.n);
  const matched = Array.isArray(row.matched) ? row.matched : [];
  const rest = baseRows.filter((r) => !re.test(canonicalJsonbText(r)));
  if (rest.length !== Number(row.rest_n)) {
    throw new Error(`${name}: ${rest.length} saved rows fall outside the expression but the database has ${row.rest_n}; a row outside it was added or removed`);
  }
  if (md5(canonicalJsonbText(rest)) !== row.rest_md5) {
    throw new Error(`${name}: rows outside the expression differ from the saved snapshot (rest_md5 ${row.rest_md5}); widen the expression`);
  }
  if (!Number.isInteger(n) || n !== rest.length + matched.length) throw new Error(`${name}: ${n} rows expected, ${rest.length} + ${matched.length} supplied`);
  const out = new Array(n);
  for (const pair of matched) {
    const ord = Number(Array.isArray(pair) ? pair[0] : NaN);
    if (!Number.isInteger(ord) || ord < 1 || ord > n || out[ord - 1] !== undefined) throw new Error(`${name}: bad position ${pair && pair[0]} in matched rows`);
    if (!re.test(canonicalJsonbText(pair[1]))) throw new Error(`${name}: a matched row at ${ord} does not match the expression as copied`);
    out[ord - 1] = pair[1];
  }
  let k = 0;
  for (let i = 0; i < n; i += 1) if (out[i] === undefined) out[i] = rest[k++];
  if (md5(canonicalJsonbText(out)) !== row.md5) throw new Error(`${name}: rebuilt rows do not hash to the database md5 ${row.md5}; a matched row was copied wrongly`);
  return { md5: row.md5, j: out, matched: matched.length, kept: rest.length };
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') o.base = argv[++i];
    else if (a === '--plan') o.plan = argv[++i];
    else if (a === '--print-sql') o.printSql = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'all';
    else if (a === '--results') o.results = argv[++i];
    else if (a === '--out-dir') o.outDir = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.base || !o.plan || (!o.printSql && !(o.results && o.outDir))) {
    console.error('usage: --base <snapshot.json> --plan <plan.json> (--print-sql [section] | --results <dir> --out-dir <dir>)');
    return 2;
  }
  const base = JSON.parse(await readFile(o.base, 'utf8'));
  const plan = JSON.parse(await readFile(o.plan, 'utf8'));
  const names = SECTION_NAMES.filter((n) => Array.isArray(base.sections?.[n]?.rows));
  if (o.printSql) {
    for (const n of o.printSql === 'all' ? names : [o.printSql]) {
      if (o.printSql === 'all') console.log(`-- section: ${n}`);
      console.log(`${deltaSql(n, plan[n] || NO_CHANGE)};`);
    }
    return 0;
  }
  await mkdir(o.outDir, { recursive: true });
  let failed = 0;
  for (const n of names) {
    try {
      const answer = JSON.parse(await readFile(path.join(o.results, `${n}.json`), 'utf8'));
      const rebuilt = applyDelta(n, base.sections[n].rows, plan[n] || NO_CHANGE, answer);
      await writeFile(path.join(o.outDir, `${n}.json`), `${JSON.stringify([{ md5: rebuilt.md5, j: rebuilt.j }])}\n`);
      console.log(`${n}: ${rebuilt.j.length} rows (${rebuilt.kept} unchanged, ${rebuilt.matched} from the database), md5 ${rebuilt.md5}`);
    } catch (error) {
      failed += 1;
      console.error(`${n}: ${error.message}`);
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code), (error) => { console.error(error.message); process.exit(2); });
}
