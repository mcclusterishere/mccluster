// What a scratch database holds for public.network_media_assets and the
// mnet-media bucket, read with the SAME catalog SQL the production snapshots
// were taken with (scripts/db/schema-queries.mjs), and compared with committed
// production evidence. Used by scripts/test-network-media-pointer-guard-db.sh
// and scripts/test-network-media-storage-flow.sh; never connects anywhere but
// the PG* environment's scratch server.
//
//   node scripts/test/support/media-asset-evidence.mjs <database> production <evidence.json>
//       the database must be production's shape: the table's column,
//       constraint and index signatures, its four owner policies, the four
//       "mnet media owner" Storage policies, the bucket, and no trigger
//   node scripts/test/support/media-asset-evidence.mjs <database> guarded <evidence.json>
//       the guard is applied: columns and indexes unchanged, one more
//       constraint, members read only, one trigger, the guard's functions
//       closed to PUBLIC, anon and authenticated
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SECTIONS } from '../../db/schema-queries.mjs';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const [database, state, evidenceFile] = process.argv.slice(2);
if (!database || !['production', 'guarded'].includes(state) || !evidenceFile) {
  console.error('usage: media-asset-evidence.mjs <database> production|guarded <evidence.json>');
  process.exit(2);
}

const TABLE = 'network_media_assets';
const MOVES = 'network_media_asset_owner_moves';
const section = (name) => JSON.parse(execFileSync('psql',
  ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', `select j from (${SECTIONS[name].sql}) x`],
  { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim());
const rowsOf = (file, name) => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')).sections[name].rows;
const ours = (rows) => rows.filter((r) => (r[0] === 'public' && r[1] === TABLE) || (r[0] === 'storage' && r[1] === 'objects' && /^mnet media /.test(r[2])));
// MAINTAIN ("m") exists from PostgreSQL 17 on. Production's grant carries it:
// Supabase's default privileges gave it and no migration took it away. The
// fixture runs under the same default privileges (the stand-ins set them), so
// on PostgreSQL 17 the grants are compared to the letter; a PostgreSQL 16
// server cannot hold MAINTAIN, and there it is left out of the comparison.
const PG17 = Number(execFileSync('psql', ['-X', '-A', '-t', '-q', '-d', database, '-c', 'show server_version_num'], { encoding: 'utf8' }).trim()) >= 170000;
const acl = (text) => (PG17 ? text : text.split(';').map((part) => part.replace(/^([^=]+=)(.*)$/, (_, who, privs) => who + privs.replace('m', ''))).join(';'));
const failures = [];
const eq = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}\n     scratch:  ${JSON.stringify(got)}\n     expected: ${JSON.stringify(want)}`); };

const relations = section('relations');
const policies = ours(section('policies'));
const triggers = section('triggers').filter((r) => r[0] === 'public' && [TABLE, MOVES].includes(r[1]));
// after a rollback that kept the record of merges, that table keeps its two append-only triggers
const tableTriggers = triggers.filter((r) => r[1] === TABLE);
const table = relations.find((r) => r[0] === 'public' && r[1] === TABLE);
if (!table) { console.error(`FAIL: public.${TABLE} is not in ${database}`); process.exit(1); }

// every committed snapshot from the named one on must agree about this table
const evidenceFiles = [evidenceFile];
const later = 'docs/control-plane/evidence/production-schema-snapshot-2026-11-09.json';
if (later !== evidenceFile && existsSync(path.join(ROOT, later))) evidenceFiles.push(later);

for (const file of evidenceFiles) {
  const prodTable = rowsOf(file, 'relations').find((r) => r[0] === 'public' && r[1] === TABLE);
  const prodPolicies = ours(rowsOf(file, 'policies'));
  const prodBucket = rowsOf(file, 'buckets').find((r) => r[0] === 'mnet-media');
  // [schema, name, relkind, rls_enabled, rls_forced, security_invoker, ncols, colsig, consig, idxsig, defsig, acl]
  if (state === 'production') {
    eq(`${file}: the table's signatures (kind, RLS, columns, constraints, indexes)`, table.slice(0, 11), prodTable.slice(0, 11));
    eq(`${file}: the table's grants to PUBLIC, anon and authenticated`, acl(table[11]), acl(prodTable[11]));
    eq(`${file}: the four owner policies and the four "mnet media owner" Storage policies`, policies, prodPolicies);
    eq(`${file}: the mnet-media bucket`, section('buckets').find((r) => r[0] === 'mnet-media'), prodBucket);
  } else {
    eq(`${file}: columns unchanged by the guard`, [table[6], table[7]], [prodTable[6], prodTable[7]]);
    eq(`${file}: indexes unchanged by the guard`, table[9], prodTable[9]);
    if (table[8] === prodTable[8]) failures.push(`${file}: the constraint signature is unchanged, so the canonical CHECK is missing`);
    eq(`${file}: the only policies left are the two owner READ policies, unchanged`,
      policies, prodPolicies.filter((r) => r[4] === 'SELECT'));
  }
}

if (state === 'production') {
  eq('no trigger on the table', tableTriggers, []);
} else {
  eq('members read the table and nothing else', acl(table[11]), acl('authenticated=mr'));
  eq('row level security stays on', [table[3], table[4]], [true, false]);
  eq('the triggers', triggers.map((r) => [r[1], r[2], r[3]]), [
    [MOVES, 'network_media_asset_owner_moves_append_only_trg', 'O'],
    [MOVES, 'network_media_asset_owner_moves_append_only_truncate_trg', 'O'],
    [TABLE, 'network_media_assets_guard_trg', 'O'],
    [TABLE, 'network_media_assets_guard_truncate_trg', 'O'],
  ]);
  const moves = relations.find((r) => r[0] === 'public' && r[1] === MOVES);
  eq('the audit table: RLS on, nothing for PUBLIC, anon or authenticated', moves && [moves[3], moves[11]], [true, '']);
  // [schema, name, identity_args, result, security_definer, volatility, config, body_md5, exec_acl]
  const fns = section('functions').filter((r) => r[0] === 'public' && /^network_media_/.test(r[1])).map((r) => [r[1], r[4], r[8]]);
  eq('the guard\'s functions, their rights and who of PUBLIC/anon/authenticated may call them (nobody)', fns, [
    ['network_media_asset_owner_moves_append_only', false, ''],
    ['network_media_assets_follow_merge', true, ''],
    ['network_media_assets_guard', false, ''],
    ['network_media_canonical_uploader', false, ''],
    ['network_media_owner_move_recorded', true, ''],
    ['network_media_upload_owned_by', true, ''],
  ]);
}

if (failures.length) {
  console.error(`FAIL (${state}): ${database} is not what the evidence says\n   ${failures.join('\n   ')}`);
  process.exit(1);
}
console.log(state === 'production'
  ? `   production's shape: signatures ${table.slice(7, 10).join(' ')}, grants ${table[11]}, ${policies.length} policies, no trigger (${evidenceFiles.map((f) => f.slice(-15, -5)).join(', ')})`
  : `   the guard's shape: constraints ${table[8]}, grants ${table[11]}, ${policies.length} policies left, the guard trigger in place`);
