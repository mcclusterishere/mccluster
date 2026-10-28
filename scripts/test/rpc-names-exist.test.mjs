// Shipped code must not call database objects that exist only in pending SQL.
//
// The audit's largest finding was a class of defect, not one bug: a route, page
// or Worker calls an RPC, table or bucket that a file under supabase/pending/
// defines, but that production has never applied. The call fails at runtime
// and nothing in CI notices, because the pending folder is not the applied
// history. This test closes that gap.
//
// EXTRACTION (what counts as "shipped code calls <name>")
//   Scanned: js/**/*.js, root *.html, workers/mccluster/src/**,
//   workers/mccluster-mcp/src/** (.js/.mjs/.cjs/.ts/.html). Skipped: any path
//   with /test/, /tests/, /fixtures/, /vendor/, a .test. or .min.js name.
//   Only string literals are read; a name built at runtime is not seen.
//   functions (RPC):
//     F1  /rest/v1/rpc/<name>
//     F2  a call to any identifier ending in rpc/Rpc, e.g. rpc('x'), sbRpc("x"),
//         userRpc(req, env, 'x'), serviceRpc(env, 'x'): the first string
//         literal among the first three arguments, when the arguments before
//         it are bare identifiers; both arms of a ternary (rpc(a ? 'x' : 'y')).
//         rpcError/rpcMissing/missingRpc and JSON-RPC helpers (name contains
//         "json") carry messages/methods, not RPC names, and are ignored.
//     F3  the fragment "rpc/<name>" inside a string
//   tables/views:
//     T1  /rest/v1/<name> followed by ?, a quote, a backtick or /
//     T2  a call whose first, second or third argument (after bare identifiers
//         such as env) is the PostgREST literal "<name>?…" whose query string
//         carries a PostgREST operator (select=, order=, on_conflict=, or=(,
//         col=eq. …). A query without one (GoTrue "token?grant_type=", a Worker
//         route "me?project=") is not a table read.
//     T3  .from('<name>')
//   storage buckets:
//     B1  storage/v1/object/[public/|sign/|upload/sign/|authenticated/]<bucket>/
//     B2  an identifier containing "bucket" assigned a literal: BUCKET = 'x',
//         bucket: "x"
//   pending-only names, second pass:
//     P1  for every name that pending SQL defines and the applied history does
//         not, any quoted literal '<name>' / "<name>" / `<name>` in shipped
//         code counts as a call (catches rpc(fn) where fn was chosen earlier,
//         e.g. music_gate_claim_rule in workers/mccluster/src/music/router.js).
//   Names must match [a-z][a-z0-9_]* (functions, tables) or [a-z0-9][a-z0-9-]*
//   (buckets); anything else (URLs, sentences, template holes) is not a name.
//
// DEFINITIONS (where a name counts as existing)
//   applied history: supabase/migrations/*.sql and supabase/replay_migrations/*.sql
//   pending only:    supabase/pending/*.sql, excluding *.rollback.sql
//   Recognised forms (SQL "--" comments stripped first):
//     create [or replace] function|table|view|materialized view|type|schema|domain
//       [if not exists] [schema.]name
//     create policy … on [schema.]table      (evidence the table exists)
//     insert into storage.buckets (…) values ('<bucket>', …) | select '<bucket>'
//   The bare (unqualified) name is indexed; kinds are checked: an RPC must be a
//   function, a table reference a table/view, a bucket a bucket.
//
// RULES (supabase/pending/live-callers.json is the allowlist)
//   1. A called name defined in the applied history passes.
//   2. A called name defined only in supabase/pending/ must be listed under
//      "pending_only" with the pending file that defines it. Missing there:
//      FAIL (promote the SQL, or stop calling it).
//   3. A called name defined nowhere in Git must be listed under
//      "missing_everywhere" (verified absent in production when added). Missing
//      there: FAIL. Both lists document debt; neither excuses it.
//   4. Both lists only shrink: an entry whose name is now in the applied
//      history, is no longer called by shipped code, or (pending_only) is not
//      defined by the file named, FAILS until it is removed or moved.
//   RPC_NAMES_REPORT=1 prints the classification as JSON (used to seed the
//   allowlist and to read a failure).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const rel = (p) => path.relative(root, p);

const SKIP = /(^|\/)(test|tests|fixtures|vendor)\/|\.test\.|\.min\.js$/;
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.html']);

function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full, out); }
    else if (CODE_EXT.has(path.extname(entry.name)) && !SKIP.test(rel(full))) out.push(full);
  }
  return out;
}

function shippedFiles() {
  const files = [];
  for (const entry of readdirSync(root)) {
    if (entry.endsWith('.html') && statSync(path.join(root, entry)).isFile()) files.push(path.join(root, entry));
  }
  walk(path.join(root, 'js'), files);
  walk(path.join(root, 'workers', 'mccluster', 'src'), files);
  walk(path.join(root, 'workers', 'mccluster-mcp', 'src'), files);
  return files.sort();
}

const BUCKET_ROUTE_WORDS = new Set(['public', 'sign', 'upload', 'authenticated', 'list', 'info', 'move', 'copy', 'render']);
const IGNORED_RPC_HELPERS = /^(rpcError|rpcMissing|missingRpc)$|json/i;
const POSTGREST_QUERY = /(?:^|[?&])(?:select|columns|order|limit|offset|on_conflict|or|and)=|=(?:eq|neq|gt|gte|lt|lte|like|ilike|match|imatch|in|is|isdistinct|fts|plfts|phfts|wfts|cs|cd|ov|sl|sr|nxr|nxl|adj|not)\./;

const EXTRACTORS = [
  { kind: 'function', re: /\/rest\/v1\/rpc\/([a-z][a-z0-9_]*)(?![a-z0-9_])/g },
  { kind: 'function',
    re: /\b([\w$]*[rR][pP][cC])\(\s*(?:[\w$.]+\s*,\s*){0,2}(?:[\w$.!]+\s*\?\s*)?['"`]([a-z][a-z0-9_]*)['"`]\s*(?:[,)]|:\s*['"`]([a-z][a-z0-9_]*)['"`]\s*[,)])/g,
    pick: (m) => (IGNORED_RPC_HELPERS.test(m[1]) ? null : [m[2], m[3]]) },
  { kind: 'function', re: /['"`]rpc\/([a-z][a-z0-9_]*)['"`?]/g },
  { kind: 'table', re: /\/rest\/v1\/([a-z][a-z0-9_]*)(?=[?'"`/])/g, pick: (m) => (m[1] === 'rpc' ? null : m[1]) },
  { kind: 'table', re: /\(\s*(?:[\w$.]+\s*,\s*){0,2}['"`]([a-z][a-z0-9_]*)\?([^'"`\n]*)/g,
    pick: (m) => (POSTGREST_QUERY.test(m[2]) ? m[1] : null) },
  { kind: 'table', re: /\.from\(\s*['"`]([a-z][a-z0-9_]*)['"`]\s*\)/g },
  { kind: 'bucket', re: /storage\/v1\/object\/(?:public\/|sign\/|upload\/sign\/|authenticated\/)?([a-z0-9][a-z0-9-]*)\//g,
    pick: (m) => (BUCKET_ROUTE_WORDS.has(m[1]) ? null : m[1]) },
  { kind: 'bucket', re: /\b[A-Za-z_$]*bucket[A-Za-z_$]*\s*[:=]\s*['"`]([a-z0-9][a-z0-9-]*)['"`]/gi },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

export function extractCalls(files, pendingOnly = []) {
  const calls = new Map(); // key kind:name -> { kind, name, callers:Set }
  const note = (kind, name, file) => {
    const key = `${kind}:${name}`;
    if (!calls.has(key)) calls.set(key, { kind, name, callers: new Set() });
    calls.get(key).callers.add(rel(file));
  };
  const literalRes = pendingOnly.map(({ kind, name }) => ({ kind, name, re: new RegExp(`(['"\`])${escapeRe(name)}\\1`) }));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const { kind, re, pick } of EXTRACTORS) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        for (const name of [].concat(pick ? pick(m) : m[1])) if (name) note(kind, name, file);
      }
    }
    for (const { kind, name, re } of literalRes) if (re.test(text)) note(kind, name, file);
  }
  return calls;
}

const DDL_RE = /\bcreate\s+(?:or\s+replace\s+)?(table|function|view|materialized\s+view|type|schema|domain)\s+(?:if\s+not\s+exists\s+)?(?:"?[a-z_][a-z0-9_]*"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;
const POLICY_RE = /\bcreate\s+policy\s+(?:"[^"]*"|[a-z_][a-z0-9_]*)\s+on\s+(?:"?[a-z_][a-z0-9_]*"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;
const BUCKET_STMT_RE = /insert\s+into\s+storage\.buckets\s*\([^)]*\)\s*(values\s*|select\s+)([^;]*)/gi;

export function definitionsIn(sqlFiles) {
  const defs = { function: new Map(), table: new Map(), bucket: new Map() }; // name -> Set(file)
  const add = (kind, name, file) => {
    const map = defs[kind];
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(file);
  };
  for (const file of sqlFiles) {
    const text = readFileSync(file, 'utf8').replace(/--[^\n]*/g, '');
    const f = rel(file);
    for (const m of text.matchAll(DDL_RE)) {
      const what = m[1].toLowerCase().replace(/\s+/g, ' ');
      const name = m[2].toLowerCase();
      if (what === 'function') add('function', name, f);
      else if (what === 'table' || what === 'view' || what === 'materialized view') add('table', name, f);
    }
    for (const m of text.matchAll(POLICY_RE)) add('table', m[1].toLowerCase(), f);
    for (const m of text.matchAll(BUCKET_STMT_RE)) {
      const tupleRe = m[1].trim().toLowerCase() === 'values' ? /\(\s*'([a-z0-9][a-z0-9-]*)'/g : /^\s*'([a-z0-9][a-z0-9-]*)'/g;
      for (const t of m[2].matchAll(tupleRe)) add('bucket', t[1], f);
    }
  }
  return defs;
}

function sqlFilesIn(dir, filter = () => true) {
  const full = path.join(root, dir);
  return readdirSync(full).filter((f) => f.endsWith('.sql') && filter(f)).sort().map((f) => path.join(full, f));
}

export function classify() {
  const applied = definitionsIn([
    ...sqlFilesIn('supabase/migrations'),
    ...sqlFilesIn('supabase/replay_migrations'),
  ]);
  const pending = definitionsIn(sqlFilesIn('supabase/pending', (f) => !f.endsWith('.rollback.sql')));
  const pendingOnly = [];
  for (const kind of ['function', 'table', 'bucket']) {
    for (const name of pending[kind].keys()) if (!applied[kind].has(name) && name.length >= 5) pendingOnly.push({ kind, name });
  }
  const calls = extractCalls(shippedFiles(), pendingOnly);
  const report = { applied: [], pending_only: {}, missing_everywhere: {} };
  for (const { kind, name, callers } of calls.values()) {
    if (applied[kind].has(name)) { report.applied.push(`${kind}:${name}`); continue; }
    const entry = { kind, callers: [...callers].sort() };
    if (pending[kind].has(name)) {
      entry.pending = [...pending[kind].get(name)].map((f) => f.replace(/^supabase\/pending\//, '')).sort();
      report.pending_only[name] = entry;
    } else {
      report.missing_everywhere[name] = entry;
    }
  }
  return { applied, pending, calls, report };
}

const ALLOWLIST = path.join(root, 'supabase', 'pending', 'live-callers.json');

function loadAllowlist() {
  const parsed = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  for (const section of ['pending_only', 'missing_everywhere']) {
    assert.equal(typeof parsed?.[section], 'object', `live-callers.json must have a "${section}" object`);
  }
  return parsed;
}

const { applied, pending, calls, report } = classify();
if (process.env.RPC_NAMES_REPORT) console.log(JSON.stringify(report, null, 2));

test('the extraction sees the shipped call sites', () => {
  assert.ok(calls.size > 100, `only ${calls.size} names extracted; the scan or the patterns broke`);
  assert.ok(applied.function.size > 400 && applied.table.size > 400, 'applied history index looks empty');
});

test('every name shipped code calls is in the applied migration history, or allowlisted as pending-only / missing', () => {
  const allow = loadAllowlist();
  const failures = [];
  for (const [name, entry] of Object.entries(report.pending_only)) {
    const listed = allow.pending_only[name];
    if (!listed) {
      failures.push(`${entry.kind} ${name} exists only in supabase/pending/${entry.pending.join(' | ')} and is called by ${entry.callers.join(', ')}: add it to pending_only in supabase/pending/live-callers.json, promote the SQL, or stop calling it`);
    } else if (!entry.pending.includes(listed.pending)) {
      failures.push(`${entry.kind} ${name}: live-callers.json names ${listed.pending} but it is defined in ${entry.pending.join(' | ')}`);
    } else if (listed.kind !== entry.kind) {
      failures.push(`${name}: live-callers.json says kind ${listed.kind}, the code calls it as a ${entry.kind}`);
    }
  }
  for (const [name, entry] of Object.entries(report.missing_everywhere)) {
    const listed = allow.missing_everywhere[name];
    if (!listed) failures.push(`${entry.kind} ${name} is called by ${entry.callers.join(', ')} but no migration, replay or pending SQL defines it: write the SQL, or record it under missing_everywhere in supabase/pending/live-callers.json`);
    else if (listed.kind !== entry.kind) failures.push(`${name}: live-callers.json says kind ${listed.kind}, the code calls it as a ${entry.kind}`);
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

test('live-callers.json only shrinks: every entry is still unapplied, still called, and defined where it says', () => {
  const allow = loadAllowlist();
  const failures = [];
  for (const [name, listed] of Object.entries(allow.pending_only)) {
    const kind = listed?.kind;
    if (!['function', 'table', 'bucket'].includes(kind)) { failures.push(`${name}: kind must be function, table or bucket`); continue; }
    if (applied[kind].has(name)) failures.push(`${name} is now in the applied history (${[...applied[kind].get(name)].join(', ')}): remove it from pending_only`);
    const pendingFiles = pending[kind].get(name);
    if (!pendingFiles || !pendingFiles.has(`supabase/pending/${listed.pending}`)) failures.push(`${name}: supabase/pending/${listed.pending} does not define a ${kind} of that name`);
    if (!calls.has(`${kind}:${name}`)) failures.push(`${name} is no longer called by shipped code: remove it from pending_only`);
  }
  for (const [name, listed] of Object.entries(allow.missing_everywhere)) {
    const kind = listed?.kind;
    if (!['function', 'table', 'bucket'].includes(kind)) { failures.push(`${name}: kind must be function, table or bucket`); continue; }
    if (applied[kind].has(name)) failures.push(`${name} is now in the applied history: remove it from missing_everywhere`);
    else if (pending[kind].has(name)) failures.push(`${name} is now defined in supabase/pending/: move it from missing_everywhere to pending_only`);
    if (!calls.has(`${kind}:${name}`)) failures.push(`${name} is no longer called by shipped code: remove it from missing_everywhere`);
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});
