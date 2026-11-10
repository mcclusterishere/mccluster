/* THE NETWORK MEDIA ASSETS POINTER GUARD (pending, not applied).

   supabase/pending/network_media_assets_pointer_guard_v1.sql takes the write
   of public.network_media_assets away from members, pins the pointer for every
   role and takes the member's own token off the mnet-media bucket. That is
   only safe while nothing a member runs writes the table or the bucket with
   their own token, so this file holds that inventory as a contract: add such a
   write while the guard is pending, or after it is applied, and this fails.

   Without a database: the pending-only status, the one canonical rule in
   every place it is written (the CHECK, the helper, the legacy count, the
   media function's storage-path.mjs and, where present, the Worker's twin),
   the shape of the SQL, a rollback that is the applied migration's own
   statements, and the registration. The SQL's behaviour, on PostgreSQL:
   scripts/test-network-media-pointer-guard-db.sh. The Storage API's:
   scripts/test-network-media-storage-flow.sh. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { canonicalMediaUploader } from '../../supabase/functions/mnet-media/storage-path.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const code = (sql) => sql.replace(/--[^\n]*/g, ''); // statements only, not the prose
const flat = (sql) => sql.replace(/\s+/g, ' ').trim();

const NAME = 'network_media_assets_pointer_guard_v1';
const PENDING = read(`supabase/pending/${NAME}.sql`);
const ROLLBACK = read(`supabase/pending/${NAME}.rollback.sql`);
const MIGRATION = read('supabase/migrations/20260920071811_mnet_real_network_v1.sql');
const COUNT = read('scripts/db/media-asset-legacy-count.sql');
const EDGE = read('supabase/functions/mnet-media/index.ts');
const CASES = JSON.parse(read('supabase/tests/network_media_assets_pointer_guard.cases.json'));
const sql = code(PENDING);

const OBJECTS = ['network_media_assets_guard', 'network_media_assets_follow_merge', 'network_media_canonical_uploader',
  'network_media_upload_owned_by', 'network_media_owner_move_recorded', 'network_media_asset_owner_moves_append_only',
  'network_media_asset_owner_moves', 'network_media_assets_canonical_upload_check'];

test('the guard is pending only: not a migration, not in the ledger, not in the reset manifest, not in production evidence', () => {
  assert.ok(!readdirSync(path.join(ROOT, 'supabase/migrations')).some((f) => f.includes('pointer_guard')));
  assert.ok(!read('supabase/production-ledger.json').includes('pointer_guard'));
  const evidence = readdirSync(path.join(ROOT, 'docs/control-plane/evidence')).filter((f) => /^production-schema-snapshot-.*\.json$/.test(f));
  for (const name of OBJECTS) {
    assert.ok(!read('supabase/schema-manifest.json').includes(name), `${name} is in the reset manifest: the guard was promoted, move this test to the migration`);
    for (const f of evidence) assert.ok(!read(`docs/control-plane/evidence/${f}`).includes(name), `${name} is in ${f}`);
  }
  assert.match(PENDING, /^-- NETWORK MEDIA ASSETS POINTER GUARD V1 \(pending; NOT applied in production\)/);
});

test('one canonical rule: the CHECK, the helper and the legacy count carry the same pattern, and it is the media function\'s rule case for case', async () => {
  const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  const expected = `^${UUID}/${UUID}-[A-Za-z0-9._-]{1,180}$`;
  const patterns = (text) => [...text.matchAll(/(?:object_path|p_path) ~ '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(patterns(sql), [expected, expected], 'the helper function and the CHECK, in that order');
  assert.deepEqual(patterns(code(COUNT)), [expected], 'the legacy count');
  for (const text of [sql, code(COUNT)]) {
    assert.doesNotMatch(text, /object_path\s*~\*|p_path\s*~\*|\bilike\b|\[\[:/i, 'case-sensitive, spelled-out classes: no locale-dependent matching');
    assert.equal((text.match(/= 'mnet-media'/g) || []).length >= 1, true);
  }
  // Only constructs that mean the same in a Postgres ARE and in JavaScript:
  // anchors, ASCII bracket ranges, counted repeats, literal - and /.
  assert.match(expected.replace(/\[[0-9A-Za-z._-]+\]/g, 'C').replace(/\{\d+(,\d+)?\}/g, 'Q'), /^\^(?:CQ|-|\/)+\$$/);
  const re = new RegExp(expected);

  const twins = [['supabase/functions/mnet-media/storage-path.mjs', canonicalMediaUploader]];
  const workerTwin = 'workers/mccluster/src/lib/media-storage.js';
  if (existsSync(path.join(ROOT, workerTwin))) twins.push([workerTwin, (await import(path.join(ROOT, workerTwin))).canonicalMediaUploader]);

  assert.ok(CASES.length >= 30 && CASES.some((c) => c.uploader) && CASES.some((c) => !c.uploader));
  for (const c of CASES) {
    const sqlSays = c.bucket === 'mnet-media' && typeof c.path === 'string' && re.test(c.path) ? c.path.split('/')[0].toLowerCase() : null;
    assert.equal(sqlSays, c.uploader, `the SQL pattern on "${c.note}"`);
    for (const [file, fn] of twins) assert.equal(fn({ bucket_id: c.bucket, object_path: c.path }), c.uploader, `${file} on "${c.note}"`);
  }
  // what upload-url writes is canonical: the caller's login, a random uuid, a clean name
  assert.match(EDGE, /const path=`\$\{who\.user\.id\}\/\$\{crypto\.randomUUID\(\)\}-\$\{filename\}`;/);
  assert.match(EDGE, /\.slice\(0,180\)\.replace\(\/\[\^a-zA-Z0-9\._-\]\+\/g,"-"\)/, 'cleanName keeps a name inside [A-Za-z0-9._-]{1,180}');
});

test('the guard takes the write from members, pins the pointer for every role, and changes nothing else', () => {
  assert.match(sql, /^\s*begin;\s*set local lock_timeout = '5s';/, 'one transaction, a short lock wait');
  assert.match(sql, /commit;\s*$/);
  assert.match(flat(sql), /revoke insert, update, delete, truncate, references, trigger on public\.network_media_assets from public, anon, authenticated;/);
  for (const op of ['insert', 'update', 'delete']) assert.ok(sql.includes(`drop policy if exists network_media_owner_${op} on public.network_media_assets;`), op);
  assert.ok(!sql.includes('network_media_owner_read'), 'members keep reading their own rows');
  assert.doesNotMatch(sql, /revoke[^;]*\bselect\b[^;]*network_media_assets/i);

  // NOT VALID, and kept as it is on a re-run so a validated constraint stays validated
  assert.match(flat(sql), /do \$c\$ begin alter table public\.network_media_assets add constraint network_media_assets_canonical_upload_check check \(bucket_id = 'mnet-media' and object_path ~ '[^']+'\) not valid; exception when duplicate_object then null; end \$c\$;/);
  assert.doesNotMatch(sql, /drop constraint|validate constraint/i);

  // the guard reads current_user, so it must run with the caller's rights
  const guard = sql.slice(sql.indexOf('create or replace function public.network_media_assets_guard()'), sql.indexOf('drop trigger if exists network_media_assets_guard_trg'));
  assert.doesNotMatch(guard.slice(0, guard.indexOf('as $$')), /security definer/i, 'SECURITY INVOKER: current_user is the statement\'s role');
  assert.match(guard, /if current_user in \('anon', 'authenticated'\) then\s+raise exception 'network_media_assets_server_write_only'/);
  assert.match(flat(guard), /if new\.id is distinct from old\.id or new\.bucket_id is distinct from old\.bucket_id or new\.object_path is distinct from old\.object_path then raise exception 'network_media_asset_pointer_immutable'/);
  assert.match(flat(guard), /if new\.owner_m_uid is distinct from old\.owner_m_uid and not public\.network_media_owner_move_recorded\(old\.id, old\.owner_m_uid, new\.owner_m_uid\) then raise exception 'network_media_asset_owner_immutable'/);
  assert.match(flat(sql), /create trigger network_media_assets_guard_trg before insert or update or delete on public\.network_media_assets for each row execute function public\.network_media_assets_guard\(\);/);

  // every function closed to the API's member roles; the merge path is the service role's
  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(fns.sort(), ['network_media_asset_owner_moves_append_only', 'network_media_assets_follow_merge', 'network_media_assets_guard',
    'network_media_canonical_uploader', 'network_media_owner_move_recorded', 'network_media_upload_owned_by']);
  for (const fn of fns) assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`), fn);
  assert.match(sql, /grant execute on function public\.network_media_assets_follow_merge\(uuid, uuid, text\) to service_role;/);
  assert.doesNotMatch(sql, /grant execute[^;]*to[^;]*\b(?:anon|authenticated|public)\b/i);
  assert.match(flat(sql), /revoke all on public\.network_media_asset_owner_moves from public, anon, authenticated, service_role; grant select on public\.network_media_asset_owner_moves to service_role;/);
  assert.match(sql, /m\.txid = txid_current\(\)/, 'an audit row authorizes a move only in its own transaction');

  // nothing else is altered: no other table, no Storage trigger, no existing function replaced
  const altered = [...sql.matchAll(/alter table (?:only )?([\w.]+)/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)].sort(), ['public.network_media_asset_owner_moves', 'public.network_media_assets']);
  assert.doesNotMatch(sql, /create trigger[^;]*on storage\./i, 'no trigger on storage.objects: that is an owner decision (README)');
  assert.doesNotMatch(sql, /m_merge_people\s*\(\s*p_keep|create or replace function public\.(?!network_media_)/, 'no existing function is replaced');
});

test('the bytes: the member\'s own token loses create, overwrite and delete in mnet-media, and keeps read', () => {
  for (const name of ['upload', 'update', 'delete']) assert.ok(sql.includes(`drop policy if exists "mnet media owner ${name}" on storage.objects;`), name);
  assert.ok(!sql.includes('"mnet media owner read"'), 'the read policy stays');
  assert.doesNotMatch(sql, /create policy/i, 'the guard creates no policy');
  // The upload flow this rests on: the function always answers with an upload
  // token (it fails first without one), and every client PUTs to the signed URL.
  assert.match(EDGE, /createSignedUploadUrl\(path\);\s*if\(error\|\|!grant\?\.token\)return json\(/, 'upload-url must fail without an upload token: the member-token fallback is refused once "mnet media owner upload" is gone');
  assert.match(EDGE, /upload:\{path:grant\.path\|\|path,token:grant\.token,/);
});

test('who writes the table and the bucket: the inventory the guard was built on still holds', () => {
  const SKIP = /(^|\/)(node_modules|test|tests|fixtures|vendor)\/|\.test\.|\.min\.js$/;
  const EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.html']);
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(path.join(ROOT, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = path.posix.join(dir, e.name);
      if (SKIP.test(rel + (e.isDirectory() ? '/' : ''))) continue;
      if (e.isDirectory()) walk(rel); else if (EXT.has(path.extname(e.name))) files.push(rel);
    }
  };
  for (const dir of ['js', 'native', 'workers/mccluster/src', 'workers/mccluster-mcp/src', 'supabase/functions', 'core/src', 'core/scripts']) walk(dir);
  for (const f of readdirSync(ROOT)) if (f.endsWith('.html') && statSync(path.join(ROOT, f)).isFile()) files.push(f);

  // 1. every file that names the table. The Worker's signing rule (commit
  //    3374dfcb) is a reader that arrives with that commit: it names the table
  //    in prose and asks its caller's reader about m_auth_user_links only.
  const SIGNING_RULE = 'workers/mccluster/src/lib/media-storage.js';
  const naming = files.filter((f) => read(f).includes('network_media_assets')).sort();
  assert.deepEqual(naming, ['js/control-room/clipping.js', 'supabase/functions/mnet-media/index.ts',
    'workers/mccluster/src/clipping/router.js', ...(existsSync(path.join(ROOT, SIGNING_RULE)) ? [SIGNING_RULE] : []),
    'workers/mccluster/src/platform-api.js'],
  'a new file names network_media_assets: redo the writer survey in the guard\'s header before it is applied');
  if (naming.includes(SIGNING_RULE)) {
    const rule = code(read(SIGNING_RULE).replace(/\/\*[\s\S]*?\*\//g, ''));
    assert.doesNotMatch(rule, /network_media_assets|method\s*:|PATCH|POST|DELETE|fetch\(/, 'the signing rule reads through its caller and writes nothing');
  }

  // 2. the one member-token caller only reads
  const clip = read('js/control-room/clipping.js');
  const calls = [...clip.matchAll(/C\.supa\(\s*"network_media_assets\?([^"]*)"\s*([,)])/g)];
  assert.equal(calls.length, 1);
  assert.match(calls[0][1], /^status=eq\.ready&post_id=is\.null&select=/);
  assert.equal(calls[0][2], ')', 'no options object: a GET');

  // 3. the media function and the Worker write with the service role
  assert.match(EDGE, /const admin = createClient\(SB, SRV,/);
  assert.equal((EDGE.match(/admin\.from\("network_media_assets"\)\.(insert|update|delete)\(/g) || []).length, 3, 'upload-url, finalize, discard');
  assert.doesNotMatch(EDGE, /from\("network_media_assets"\)\.upsert/);
  assert.doesNotMatch(EDGE, /\bid:\s*(?:body|String\(body)/, 'the function never takes the row id from the caller on insert');
  const worker = read('workers/mccluster/src/platform-api.js');
  const patches = worker.split('\n').filter((l) => /network_media_assets\?|assetFilter\}/.test(l) && /method:'(PATCH|POST|DELETE|PUT)'/.test(l));
  assert.equal(patches.length, 5, 'attach, attachPosters, releasePosters, reserve, release');
  for (const l of patches) {
    assert.match(l, /\bservice\(env,/, 'through the service-role helper');
    assert.match(l, /method:'PATCH'/);
    const body = l.slice(l.indexOf('JSON.stringify('));
    assert.doesNotMatch(body, /object_path|bucket_id|owner_m_uid|\bid:/, 'the Worker never writes the pointer or the owner');
  }
  assert.doesNotMatch(read('workers/mccluster/src/clipping/router.js'), /network_media_assets[^`'"]*[`'"]\s*,\s*\{[^}]*method/, 'the clipping router only reads');

  // 4. member-token Storage calls on the bucket: uploads only, no delete, move, copy or list
  const direct = [];
  for (const f of files.filter((x) => /^(js|native)\//.test(x) || !x.includes('/'))) {
    const text = read(f);
    for (const m of text.matchAll(/storage\/v1\/object\/([a-z/]*)mnet-media\//g)) direct.push(`${f} ${m[1] || 'object/'}`);
    assert.doesNotMatch(text, /storage\.from\(\s*['"`]mnet-media['"`]\s*\)/, `${f}: no supabase-js Storage client on mnet-media`);
  }
  // any number of signed-upload PUTs; besides them only the four known no-token fallbacks
  assert.ok(direct.filter((d) => d.endsWith(' upload/sign/')).length >= 5, 'the signed-upload call sites');
  assert.deepEqual(direct.filter((d) => !d.endsWith(' upload/sign/')).sort(),
    ['js/create.js object/', 'js/create.js object/', 'js/mnet.js object/', 'native/src/proofMedia.ts object/'],
    'a member-token Storage call on mnet-media that is not a signed upload needs a Storage policy the guard removes');
});

test('the rollback is the applied migration\'s own statements, and keeps a record of merges', () => {
  const statement = (text, start) => { const i = text.indexOf(start); assert.ok(i >= 0, start); return flat(text.slice(i, text.indexOf(';', i) + 1)); };
  for (const p of ['network_media_owner_insert', 'network_media_owner_update', 'network_media_owner_delete',
    '"mnet media owner upload"', '"mnet media owner update"', '"mnet media owner delete"']) {
    assert.equal(statement(code(ROLLBACK), `create policy ${p} `), statement(MIGRATION, `create policy ${p} `), p);
    assert.ok(code(ROLLBACK).includes(`drop policy if exists ${p} on `), `${p} is dropped before it is created: safe to run twice`);
  }
  assert.match(code(ROLLBACK), /grant insert, update, delete on public\.network_media_assets to authenticated;/);
  assert.match(MIGRATION, /grant select,insert,update,delete on public\.network_media_assets to authenticated;/);
  const rb = code(ROLLBACK);
  assert.match(rb, /drop trigger if exists network_media_assets_guard_trg on public\.network_media_assets;/);
  assert.match(rb, /alter table public\.network_media_assets drop constraint if exists network_media_assets_canonical_upload_check;/);
  for (const fn of [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1])) assert.match(rb, new RegExp(`drop function if exists public\\.${fn}\\(`), fn);
  assert.match(flat(rb), /if v_rows then .* raise notice .* else execute 'drop table public\.network_media_asset_owner_moves'; end if;/, 'the audit record is dropped only when empty');
  assert.doesNotMatch(rb, /"mnet media owner read"|network_media_owner_read/, 'the read policies were never removed, so the rollback leaves them alone');
  assert.match(rb, /^\s*begin;\s*set local lock_timeout = '5s';/);
});

test('the legacy count is read-only: one SELECT, counts only', () => {
  const body = code(COUNT).trim();
  assert.match(body, /^with assets as \(/);
  assert.equal(body.split(';').filter((s) => s.trim()).length, 1, 'one statement');
  assert.doesNotMatch(body, /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke|copy|call|do|set|begin|commit|lock)\b/i);
  for (const col of ['not_canonical', 'prefix_not_linked', 'legacy_named_by_action_proofs', 'legacy_named_by_antisocial_levels',
    'legacy_named_by_fbi_cases', 'legacy_named_by_clip_assets', 'legacy_named_by_any']) assert.match(body, new RegExp(`as ${col}\\b`), col);
  for (const ref of ["p.metadata ->> 'asset_id'", 'l.media_asset_id = b.id', 'b.id = any (c.media_asset_ids)', 'c.network_media_asset_id = b.id']) assert.ok(body.includes(ref), ref);
  assert.doesNotMatch(body, /network_media_canonical_uploader|network_media_upload_owned_by/, 'it must run BEFORE the guard exists');
  const out = body.slice(body.lastIndexOf('select'));
  assert.doesNotMatch(out, /\bobject_path\b|\bid\b(?!\s*=)|owner_m_uid/, 'no ids, paths or owners in the output');
});

test('the guard is registered where the pending folder requires it', () => {
  const readme = read('supabase/pending/README.md');
  const order = read('supabase/pending/PROMOTION-ORDER.md');
  assert.ok(readme.includes(`Pending (2026-11-10): \`${NAME}.sql\``), 'README.md has no entry for the guard');
  assert.ok(readme.includes(`What must be true in production before \`${NAME}.sql\` may be applied`), 'README.md does not say what must be true in production first');
  for (const need of ['not_canonical = 0', 'scripts/db/media-asset-legacy-count.sql', 'scripts/test-network-media-pointer-guard-db.sh',
    `${NAME}.rollback.sql`, 'validate constraint network_media_assets_canonical_upload_check', 'upload.token',
    'network_media_assets_follow_merge', 'supabase/tests/action_clipping_regression.sql', 'NOT applied']) assert.ok(readme.includes(need), `README.md: ${need}`);
  assert.ok(order.includes(`\`${NAME}.sql\``), 'PROMOTION-ORDER.md does not list the guard');
  // live-callers.json lists names shipped code calls that are not deployed. Nothing
  // shipped calls an object this file creates, so it must have no entry (an entry
  // nothing calls fails scripts/test/rpc-names-exist.test.mjs).
  const callers = JSON.parse(read('supabase/pending/live-callers.json'));
  for (const sectionName of Object.keys(callers)) {
    if (typeof callers[sectionName] !== 'object' || Array.isArray(callers[sectionName])) continue;
    for (const name of OBJECTS) assert.ok(!(name in callers[sectionName]), `${name} is listed in live-callers.json ${sectionName}`);
  }
});
