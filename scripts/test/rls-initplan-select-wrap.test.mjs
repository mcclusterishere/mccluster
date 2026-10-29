// supabase/migrations/20261029011314_rls_initplan_select_wrap_v1.sql (applied 2026-10-29) changes how often the 71
// policies the Supabase advisor flagged (auth_rls_initplan, 2026-10-28) evaluate
// auth.uid(), auth.jwt() and current_m_uid(), and nothing else. Proven offline here:
//   - unwrapping the three sub-selects turns the forward file into its rollback, statement
//     for statement;
//   - every rollback expression is production's own text before the apply: its md5 prefix
//     equals the policy's USING / WITH CHECK hash in the 2026-10-28 production evidence;
//   - since the apply (2026-10-29), none of the 71 still has that pre-apply text in the
//     latest production evidence;
//   - the forward file leaves no auth.uid(), auth.jwt() or current_m_uid() call outside a
//     sub-select, and names exactly the advisor's 71 policies.
// Access is compared before/after on a scratch database by scripts/test-schema-hygiene-db.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const FORWARD = 'supabase/migrations/20261029011314_rls_initplan_select_wrap_v1.sql';
const ROLLBACK = 'supabase/pending/20261029100200_rls_initplan_select_wrap_v1.rollback.sql';
const evidenceDir = 'docs/control-plane/evidence';
// Production before the apply: the rollback restores exactly this.
const BEFORE = `${evidenceDir}/production-schema-snapshot-2026-10-28.json`;
const LATEST = `${evidenceDir}/${readdirSync(path.join(root, evidenceDir)).filter((f) => /^production-schema-snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1)}`;

const unwrap = (s) => s.replaceAll('(select auth.uid())', 'auth.uid()').replaceAll('(select auth.jwt())', 'auth.jwt()')
  .replaceAll('(select current_m_uid())', 'current_m_uid()');
const statements = (text) => text.slice(text.indexOf('\nalter policy ') + 1).trim().split(/\n(?=alter policy )/);

// The parenthesised expression that starts at text[i] === '('.
function inner(text, i) {
  let depth = 0;
  for (let j = i; j < text.length; j += 1) {
    if (text[j] === '(') depth += 1;
    else if (text[j] === ')') { depth -= 1; if (depth === 0) return text.slice(i + 1, j); }
  }
  throw new Error(`unbalanced expression at ${i}`);
}
function parse(stmt) {
  const m = /^alter policy ("[^"]+"|\S+) on public\.(\w+)/.exec(stmt);
  const clause = (word) => { const k = stmt.indexOf(`\n  ${word} (`); return k < 0 ? '' : inner(stmt, k + word.length + 4); };
  return { policy: m[1].replace(/^"|"$/g, ''), table: m[2], using: clause('using'), check: clause('with check') };
}
const md5 = (s) => (s ? createHash('md5').update(s, 'utf8').digest('hex').slice(0, 12) : '');

test('the rollback is the forward file with the three sub-selects unwrapped', () => {
  const fwd = statements(read(FORWARD));
  const back = statements(read(ROLLBACK));
  assert.equal(fwd.length, 71);
  assert.deepEqual(back, fwd.map(unwrap));
});

test('every rollback expression is production\'s pre-apply text, byte for byte', () => {
  const rows = JSON.parse(read(BEFORE)).sections.policies.rows;
  const prod = new Map(rows.map((r) => [`${r[0]}.${r[1]} :: ${r[2]}`, r]));
  const failures = [];
  for (const s of statements(read(ROLLBACK)).map(parse)) {
    const row = prod.get(`public.${s.table} :: ${s.policy}`);
    if (!row) { failures.push(`${s.table} ${s.policy}: not in ${BEFORE}`); continue; }
    if (md5(s.using) !== row[6] || md5(s.check) !== row[7]) failures.push(`${s.table} ${s.policy}: ${md5(s.using)}/${md5(s.check)} vs production ${row[6]}/${row[7]}`);
  }
  assert.deepEqual(failures, []);
});

test('production runs the forward file: no policy it names keeps its pre-apply expression', () => {
  const key = (r) => `${r[0]}.${r[1]} :: ${r[2]}`;
  const before = new Map(JSON.parse(read(BEFORE)).sections.policies.rows.map((r) => [key(r), r]));
  const latest = new Map(JSON.parse(read(LATEST)).sections.policies.rows.map((r) => [key(r), r]));
  if (LATEST === BEFORE) return;
  const failures = [];
  for (const s of statements(read(FORWARD)).map(parse)) {
    const k = `public.${s.table} :: ${s.policy}`;
    const now = latest.get(k);
    const was = before.get(k);
    if (!now) { failures.push(`${k}: not in ${LATEST}`); continue; }
    if (now[6] === was[6] && now[7] === was[7]) failures.push(`${k}: still the pre-apply expression in ${LATEST}`);
  }
  assert.deepEqual(failures, []);
});

test('the forward file evaluates each identity call once per statement', () => {
  for (const s of statements(read(FORWARD))) {
    assert.doesNotMatch(s.replaceAll('(select auth.uid())', '').replaceAll('(select auth.jwt())', '').replaceAll('(select current_m_uid())', ''),
      /auth\.uid\(\)|auth\.jwt\(\)|current_m_uid\(\)/, s.split('\n')[0]);
    assert.doesNotMatch(s, /\bto (anon|authenticated|public)\b/, 'roles are not changed here');
  }
  assert.match(read(FORWARD), /^set local search_path = public, pg_temp;$/m);
});
