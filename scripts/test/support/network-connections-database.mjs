// Isolated local database support for the consent guard on public.network_connections
// (the pending forward SQL, or its recorded migration after promotion, and the retained rollback); never connects to the
// canonical project. One proof, two engines: scripts/test/network-connections-consent.integration.mjs runs it on PGlite,
// scripts/test/network-connections-consent.native.integration.mjs on a disposable PostgreSQL 16 or 17.
//
// THE PRODUCTION LAYER is production's shape of the connection feature, built from the repository's own SQL:
//   1. supabase/tests/supabase_api_roles.stub.sql: the API roles, Supabase's default privileges, auth.uid(), m_people
//      and a STAND-IN current_m_uid() (it reads m_links; production's reads m_auth_user_links where is_primary, and both
//      answer the same member for the fixture below, which fills both tables);
//   2. supabase/tests/mnet_network_tables.stub.sql: a STAND-IN for the network tables production has (the full
//      network migrations are too large to replay here); its network_connections is production's shape (composite
//      primary key on the pair, the four statuses, the foreign keys, the pair index, the member read policy);
//   3. two slices of supabase/migrations/20260920071811_mnet_real_network_v1.sql, byte for byte: the conversation
//      tables with their policies and grants, and mnet_open_direct, mnet_accept_conversation, mnet_send_message and
//      the message triggers (the direct-message gate);
//   4. the Anti-Social chain scripts/test-antisocial-db.sh applies: gamification, proof review, feed shares, the
//      three-level draft, the completion (the connection RPCs and publish_antisocial_collaboration), the civic scope;
//   5. production-only: the two policies exactly as supabase/replay_migrations/20261028230000_schema_reconcile_
//      production_only_v1.sql records them (read from that file), and production's grants on the table.
// The proof then checks the result against what was read from production on 2026-11-19 (PRODUCTION below): the
// policies' expressions, every grant, the constraints and indexes, and the bodies of the eight functions that read or
// write the table, so a difference between this layer and production fails the proof instead of passing silently.
// The chain runs as a superuser; production's owner, postgres, is not one but owns the table and bypasses row level
// security, so the SECURITY DEFINER writers behave the same (their privileges come from owning the table).
//
// NETWORK_CONNECTIONS_CONSENT_DIR replaces the normal migration/pending locations with one folder containing
// the fix and its rollback (same file names), for scripts/test/network-connections-consent.mutants.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const GUARD_NAME = 'network_connections_consent_guard_v1';
const PENDING_FIX_FILE = '20261119062110_network_connections_consent_guard_v1.sql';
export const ROLLBACK_FILE = '20261119062110_network_connections_consent_guard_v1.rollback.sql';
const REPO = new URL('../../../', import.meta.url);

// A reviewed file is still pending until the production ledger records its actual
// version. Promotion can then move the same SQL without rewriting any proof runner.
export function consentForwardLocation(ledger) {
  assert.ok(Array.isArray(ledger?.migrations), 'the production ledger must contain migrations');
  const recorded = ledger.migrations.filter((row) => row.name === GUARD_NAME);
  assert.ok(recorded.length <= 1, 'the consent guard is recorded more than once');
  if (!recorded.length) return { directory: 'pending', file: PENDING_FIX_FILE };
  assert.match(recorded[0].version, /^\d{14}$/, 'the recorded consent guard needs its actual migration version');
  return { directory: 'migrations', file: `${recorded[0].version}_${GUARD_NAME}.sql` };
}
const forward = consentForwardLocation(JSON.parse(await readFile(new URL('supabase/production-ledger.json', REPO), 'utf8')));
export const FIX_FILE = forward.file;
const consentPath = (file, directory) => (process.env.NETWORK_CONNECTIONS_CONSENT_DIR
  ? join(process.env.NETWORK_CONNECTIONS_CONSENT_DIR, file) : new URL(`supabase/${directory}/${file}`, REPO));
export const fixSql = () => readFile(consentPath(FIX_FILE, forward.directory), 'utf8');
export const rollbackSql = () => readFile(consentPath(ROLLBACK_FILE, 'pending'), 'utf8');
export const repoFile = (path) => readFile(new URL(path, REPO), 'utf8');

export const REPLAY_FILE = 'supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql';
export const DM_MIGRATION = 'supabase/migrations/20260920071811_mnet_real_network_v1.sql';
export const ANTISOCIAL_MISSION = 'a17050c1-a551-4c5c-80c1-5a1750c1a001';

// What the production catalogs said on 2026-11-19 (read-only SELECT statements; recorded in the fix's header).
// Policy expressions are md5 prefixes of pg_policies.qual / with_check as PostgreSQL prints them.
export const PRODUCTION = Object.freeze({
  read: '2026-11-19',
  server: '17.6',
  ledgerRows: 376,
  policies: [
    ['network_connections_member_read', 'PERMISSIVE', 'SELECT', '{authenticated}', '49ce381f710d', ''],
    ['network_connections_self_update', 'PERMISSIVE', 'UPDATE', '{authenticated}', '49ce381f710d', '49ce381f710d'],
    ['network_connections_self_write', 'PERMISSIVE', 'INSERT', '{authenticated}', '', '2cc8e4ed470d']
  ],
  // {postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=arwdm/postgres,service_role=arwdDxtm/postgres}
  acl: { anon: 'rm', authenticated: 'arwdm', service_role: 'arwdDxtm' },
  constraints: {
    network_connections_addressee_m_uid_fkey: 'FOREIGN KEY (addressee_m_uid) REFERENCES m_people(id) ON DELETE CASCADE',
    network_connections_check: 'CHECK ((requester_m_uid <> addressee_m_uid))',
    network_connections_pkey: 'PRIMARY KEY (requester_m_uid, addressee_m_uid)',
    network_connections_requester_m_uid_fkey: 'FOREIGN KEY (requester_m_uid) REFERENCES m_people(id) ON DELETE CASCADE',
    network_connections_status_check: "CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text])))"
  },
  indexes: [
    'CREATE UNIQUE INDEX network_connections_id_key ON public.network_connections USING btree (id)',
    'CREATE UNIQUE INDEX network_connections_pair_idx ON public.network_connections USING btree (LEAST(requester_m_uid, addressee_m_uid), GREATEST(requester_m_uid, addressee_m_uid))',
    'CREATE UNIQUE INDEX network_connections_pkey ON public.network_connections USING btree (requester_m_uid, addressee_m_uid)'
  ],
  // left(md5(prosrc), 12): every function whose body names network_connections (the first three write it)
  functions: {
    'request_connection(uuid)': '2067ed3912df',
    'answer_connection(uuid,boolean)': '960bd1095846',
    'withdraw_connection(uuid)': 'd6c0ffa85fde',
    'connection_with(uuid)': 'bac9e74e9a95',
    'my_connections()': '1b9f4d87479b',
    'mnet_open_direct(uuid)': '7f35aa5492c1',
    'publish_antisocial_collaboration(uuid,uuid,text,text,text,uuid,text)': 'e371812ee8e8',
    'submit_antisocial_level(uuid,smallint,text,text,uuid,uuid,uuid)': '44c106de9a6c'
  }
});
export const WRITERS = Object.freeze(['request_connection(uuid)', 'answer_connection(uuid,boolean)', 'withdraw_connection(uuid)']);

// ---------------------------------------------------------------- statements, as psql sends them
/** Split SQL into statements the way psql does (comments, quotes and dollar quotes respected). [{ start, end, text }] */
export function splitStatements(sql) {
  const out = [];
  const n = sql.length;
  let i = 0;
  let start = -1;
  const skipLine = (k) => { const e = sql.indexOf('\n', k); return e < 0 ? n : e + 1; };
  const skipBlock = (k) => {
    let depth = 0;
    for (let j = k; j < n; j += 1) {
      if (sql[j] === '/' && sql[j + 1] === '*') { depth += 1; j += 1; } else if (sql[j] === '*' && sql[j + 1] === '/') { depth -= 1; j += 1; if (!depth) return j + 1; }
    }
    throw new Error('unterminated block comment');
  };
  const skipQuoted = (k, q) => {
    for (let j = k + 1; j < n; j += 1) {
      if (sql[j] === q) { if (sql[j + 1] === q) { j += 1; continue; } return j + 1; }
    }
    throw new Error(`unterminated ${q} quote`);
  };
  while (i < n) {
    const ch = sql[i];
    if (ch === '-' && sql[i + 1] === '-') { i = skipLine(i); continue; }
    if (ch === '/' && sql[i + 1] === '*') { i = skipBlock(i); continue; }
    if (start < 0) {
      if (/\s/.test(ch)) { i += 1; continue; }
      start = i;
    }
    if (ch === "'" || ch === '"') { i = skipQuoted(i, ch); continue; }
    if (ch === '$') {
      const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const e = sql.indexOf(m[0], i + m[0].length);
        if (e < 0) throw new Error(`unterminated dollar quote ${m[0]}`);
        i = e + m[0].length;
        continue;
      }
    }
    if (ch === ';') { out.push({ start, end: i + 1, text: sql.slice(start, i + 1) }); start = -1; i += 1; continue; }
    i += 1;
  }
  if (start >= 0) out.push({ start, end: n, text: sql.slice(start) });
  return out;
}

/** A statement's text with comments dropped and whitespace collapsed (for comparing statements). */
export const normalizeStatement = (text) => splitStatements(text).map((s) => s.text).join(' ')
  .replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- the production layer
const clean = (sql) => sql
  .replace(/^\\set ON_ERROR_STOP 1\s*$/gm, '')
  .replace(/create extension if not exists pgcrypto;/gi, '') // gen_random_uuid() is built in; pgcrypto is not needed
  .replace(/notify pgrst, *'reload schema';/gi, '');
function slice(text, from, to, label) {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a);
  assert.ok(a >= 0 && b > a && text.indexOf(from, a + 1) < 0, `${label}: the slice markers must each appear once`);
  return text.slice(a, b + to.length);
}

/** The production layer as [label, sql] steps, in order. */
export async function productionLayer() {
  const dm = await repoFile(DM_MIGRATION);
  const replay = await repoFile(REPLAY_FILE);
  const policy = (name) => {
    const m = new RegExp(`create policy ${name} on public\\.network_connections[^;]*;`).exec(replay);
    assert.ok(m, `${REPLAY_FILE} records ${name}`);
    return m[0];
  };
  const steps = [];
  for (const file of ['supabase/tests/supabase_api_roles.stub.sql', 'supabase/tests/mnet_network_tables.stub.sql']) steps.push([file, clean(await repoFile(file))]);
  steps.push([`${DM_MIGRATION} (conversation tables, policies, grants)`, slice(dm, 'create table if not exists public.network_reports (',
    'grant all on public.network_media_assets,public.network_reports,public.network_conversations,public.network_conversation_members,public.network_messages to service_role;',
    'conversation tables')]);
  steps.push([`${DM_MIGRATION} (mnet_open_direct to the message triggers)`, slice(dm, 'create or replace function public.mnet_open_direct(p_target_m_uid uuid)',
    'for each row execute function public.mnet_notify_message();', 'direct-message functions')]);
  steps.push(['supabase/migrations/20261002061056_action_network_gamification_v1.sql', clean(await repoFile('supabase/migrations/20261002061056_action_network_gamification_v1.sql'))]);
  steps.push(['action_missions.kind (as scripts/test-antisocial-db.sh)', "alter table public.action_missions add column if not exists kind text not null default 'civic'"]);
  for (const file of ['supabase/migrations/20261004015451_action_proof_retry_and_review_notifications_v1.sql',
    'supabase/migrations/20261002135458_action_network_feed_shares_v1.sql',
    'supabase/migrations/20261014185154_antisocial_get_social_three_levels_draft.sql',
    'supabase/migrations/20261015000455_antisocial_get_social_completion_v1.sql',
    'supabase/migrations/20261015001022_antisocial_action_record_civic_scope.sql']) steps.push([file, clean(await repoFile(file))]);
  steps.push(['production only (2026-11-19): the two policies and the grants', [
    policy('network_connections_self_update'),
    policy('network_connections_self_write'),
    'grant select, insert, update, delete on public.network_connections to authenticated;',
    'grant select on public.network_connections to anon;',
    // MAINTAIN exists from PostgreSQL 17; production (17.6) holds it for anon and authenticated
    "do $m$ begin if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on public.network_connections to anon, authenticated'; end if; end $m$;"
  ].join('\n')]);
  return steps;
}

// ---------------------------------------------------------------- members (synthetic; no e-mail, no real person)
const NAMES = ['ana', 'ben', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jon', 'kay', 'leo', 'mia', 'ned', 'ola', 'paz', 'quin', 'rex'];
const hex = (i) => String(i + 1).padStart(12, '0');
export const M = Object.freeze(Object.fromEntries(NAMES.map((name, i) => [name, Object.freeze({
  name, user: `00000000-0000-4000-8000-${hex(i)}`, m_uid: `10000000-0000-4000-8000-${hex(i)}`,
  handle: `fixture.${name}`, display: `Fixture ${name[0].toUpperCase()}${name.slice(1)}`
})])));
const byMuid = new Map(Object.values(M).map((m) => [m.m_uid, m.name]));
export const nameOf = (uuid) => byMuid.get(uuid) || uuid;

async function seedMembers(db) {
  const all = Object.values(M);
  const values = (f) => all.map(f).join(', ');
  await db.script(`
    insert into auth.users(id) values ${values((m) => `('${m.user}')`)};
    insert into public.m_people(id) values ${values((m) => `('${m.m_uid}')`)};
    insert into public.m_links(user_id, m_uid) values ${values((m) => `('${m.user}', '${m.m_uid}')`)};
    insert into public.m_auth_user_links(auth_user_id, m_uid) select user_id, m_uid from public.m_links;
    insert into public.platform_profiles(user_id, mccluster_id, display_name) values ${values((m) => `('${m.user}', '${m.handle}', '${m.display}')`)};
    insert into public.network_profiles(m_uid, display_name) values ${values((m) => `('${m.m_uid}', '${m.display}')`)};
    insert into public.platform_apps(app_key, enabled) values ('mccluster-web', true);`);
}

/** Build the production layer on an adapter, then the members. */
export async function buildProductionLayer(db) {
  for (const [label, sql] of await productionLayer()) {
    try { await db.script(sql); } catch (error) { throw new Error(`${label}: ${error.message}`); }
  }
  await seedMembers(db);
}

/** Empty every table the proof writes, between phases (the members stay). */
export const resetRows = (db) => db.script(`truncate public.network_messages, public.network_conversation_members, public.network_conversations,
  public.action_collaboration_posts, public.network_posts, public.action_antisocial_levels, public.action_points_ledger,
  public.action_mission_assignments, public.network_notifications, public.network_connections, public.network_blocks,
  public.network_follows cascade;`);

// ---------------------------------------------------------------- applying a file
/**
 * Apply a SQL file. 'psql' sends one statement at a time (what psql -v ON_ERROR_STOP=1 -f does) and, on an error,
 * ends the session's transaction as psql's exit would; 'string' sends the whole file in one call (what
 * apply_migration does). Either way, a file that leaves a transaction open is rolled back and refused: psql rolls it
 * back when it exits.
 */
export async function applyFile(db, sql, mode = 'psql') {
  try {
    if (mode === 'string') await db.script(sql);
    else for (const s of splitStatements(sql)) await db.script(s.text);
  } catch (error) {
    await db.script('rollback').catch(() => {});
    throw error;
  }
  // A transaction the file left open still holds its DDL's transaction id; a fresh statement has none.
  const [{ fresh }] = await db.admin('select pg_current_xact_id_if_assigned() is null as fresh');
  if (!fresh) {
    await db.script('rollback');
    throw Object.assign(new Error('the file ended inside an open transaction (psql would roll it back on exit)'), { code: 'OPEN_TRANSACTION' });
  }
}

// ---------------------------------------------------------------- reads
/** Policies on the table: [name, permissive, cmd, roles, md5(qual)[0..12], md5(with_check)[0..12]], by name. */
export const tablePolicies = async (db) => (await db.admin(`select policyname, permissive, cmd, roles::text as roles,
    case when qual is null then '' else left(md5(qual), 12) end as u, case when with_check is null then '' else left(md5(with_check), 12) end as w
  from pg_policies where schemaname = 'public' and tablename = 'network_connections' order by policyname`))
  .map((r) => [r.policyname, r.permissive, r.cmd, r.roles, r.u, r.w]);

const PRIV_LETTER = { INSERT: 'a', SELECT: 'r', UPDATE: 'w', DELETE: 'd', TRUNCATE: 'D', REFERENCES: 'x', TRIGGER: 't', MAINTAIN: 'm' };
const LETTER_ORDER = 'arwdDxtm';
/** The table's privileges per API role, as relacl letters in PostgreSQL's order ('' when none). */
export async function apiAcl(db) {
  const rows = await db.admin(`select g.rolname as grantee, a.privilege_type as p
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    join pg_roles g on g.oid = a.grantee where c.oid = 'public.network_connections'::regclass`);
  const out = { anon: '', authenticated: '', service_role: '' };
  for (const role of Object.keys(out)) {
    const letters = rows.filter((r) => r.grantee === role).map((r) => PRIV_LETTER[r.p]);
    out[role] = [...LETTER_ORDER].filter((l) => letters.includes(l)).join('');
  }
  return out;
}
/** What production held, for this server (MAINTAIN, 'm', exists from PostgreSQL 17). */
export const productionAcl = (versionNum, after = false) => {
  const drop = (s) => (versionNum >= 170000 ? s : s.replace('m', ''));
  return { anon: drop(PRODUCTION.acl.anon), authenticated: drop(after ? 'rm' : PRODUCTION.acl.authenticated), service_role: drop(PRODUCTION.acl.service_role) };
};

/** A whole-database catalog fingerprint: every policy, grant, function, trigger and constraint (keys sort). */
export async function fingerprint(db) {
  const [{ f }] = await db.admin(`select jsonb_build_object(
    'policies', (select jsonb_object_agg(schemaname || '.' || tablename || '.' || policyname,
        jsonb_build_array(permissive, cmd, roles::text, qual, with_check)) from pg_policies),
    'relations', (select jsonb_object_agg(n.nspname || '.' || c.relname, jsonb_build_array(coalesce(c.relacl::text, ''),
        c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner)))
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'auth', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')),
    'columns', (select coalesce(jsonb_object_agg(c.relname || '.' || a.attname, a.attacl::text), '{}'::jsonb)
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and cardinality(a.attacl) > 0),
    'functions', (select jsonb_object_agg(p.oid::regprocedure::text, jsonb_build_array(md5(p.prosrc), p.prosecdef,
        coalesce(p.proconfig::text, ''), coalesce(p.proacl::text, ''), pg_get_userbyid(p.proowner)))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'auth', 'private')),
    'triggers', (select coalesce(jsonb_object_agg(t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid)), '{}'::jsonb)
      from pg_trigger t where not t.tgisinternal),
    'constraints', (select jsonb_object_agg(k.conrelid::regclass::text || '.' || k.conname, pg_get_constraintdef(k.oid))
      from pg_constraint k join pg_namespace n on n.oid = k.connamespace where n.nspname = 'public' and k.conrelid <> 0),
    'default_acl', (select coalesce(jsonb_agg(d.defaclacl::text order by d.defaclacl::text), '[]'::jsonb) from pg_default_acl d)) as f`);
  return f;
}
/** The keys (section.object) whose values differ between two fingerprints. */
export function fingerprintDiff(a, b) {
  const keys = [];
  for (const section of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[section] || {}; const y = b[section] || {};
    if (Array.isArray(x) || Array.isArray(y)) { if (JSON.stringify(x) !== JSON.stringify(y)) keys.push(section); continue; }
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) keys.push(`${section}.${k}`);
  }
  return keys.sort();
}

// ---------------------------------------------------------------- requests, as PostgREST makes them
const SET_CLAIMS = "select set_config('request.jwt.claims', $1, true)";
const claims = (role, user) => JSON.stringify(user ? { sub: user, role } : { role });
/** Settle a promise into { ok: true, rows } or { ok: false, code, message }. */
export const settle = (p) => p.then((rows) => ({ ok: true, rows }), (e) => ({ ok: false, code: e.code, message: String(e.message || e) }));

// ---------------------------------------------------------------- adapters
// An adapter: { label, version, versionNum, script(sql), admin(sql, params), request(role, user, sql, params), close() }.
// script and admin run as the superuser outside any request; request runs one statement the way PostgREST does: its
// own transaction, `set local role` (anon, authenticated or service_role), the JWT claims of `user`, then commit.

/** PGlite (one session). PGLITE_MODULE names PGlite's dist/index.js. */
export async function pgliteAdapter() {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const pg = new PGlite();
  const [{ v, n }] = (await pg.query("select current_setting('server_version') as v, current_setting('server_version_num')::int as n")).rows;
  return {
    label: `PGlite (PostgreSQL ${v})`, version: v, versionNum: n,
    script: async (sql) => { await pg.exec(sql); },
    admin: async (sql, params = []) => (await pg.query(sql, params)).rows,
    request: (role, user, sql, params = []) => pg.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query(SET_CLAIMS, [claims(role, user)]);
      return (await tx.query(sql, params)).rows;
    }),
    close: () => pg.close()
  };
}

/** node-postgres on a disposable server: one session for scripts and reads, another for requests. */
export async function nativeAdapter(server, database) {
  const admin = await server.client(database);
  const member = await server.client(database);
  const [{ v, n }] = (await admin.query("select current_setting('server_version') as v, current_setting('server_version_num')::int as n")).rows;
  return {
    label: `PostgreSQL ${v}`, version: v, versionNum: n, adminClient: admin,
    script: async (sql) => { await admin.query(sql); },
    admin: async (sql, params = []) => (await admin.query(sql, params)).rows,
    request: async (role, user, sql, params = []) => {
      await member.query('begin');
      try {
        await member.query(`set local role ${role}`);
        await member.query(SET_CLAIMS, [claims(role, user)]);
        const r = await member.query(sql, params);
        await member.query('commit');
        return r.rows;
      } catch (error) {
        await member.query('rollback').catch(() => {});
        throw error;
      }
    },
    /** A session that has started a member's request and not finished it (for lock checks). */
    openRequest: async (role, user) => {
      const c = await server.client(database);
      await c.query('begin');
      await c.query(`set local role ${role}`);
      await c.query(SET_CLAIMS, [claims(role, user)]);
      return c;
    },
    close: async () => { for (const c of [admin, member]) { try { await c.end(); } catch { /* already closed */ } } }
  };
}

/** The read-only query the fix's header gives under "CHECK AFTER APPLYING", taken from the file itself. */
export function headerCheckQuery(fixText) {
  const lines = fixText.split('\n');
  const from = lines.findIndex((l) => /^--\s+select \(select string_agg\(policyname/.test(l));
  const to = lines.findIndex((l, i) => i >= from && /as acl;\s*$/.test(l));
  assert.ok(from > 0 && to >= from, 'the fix header carries its check query');
  return lines.slice(from, to + 1).map((l) => l.replace(/^--/, '')).join('\n');
}

// ---------------------------------------------------------------- the proof
const DENIED = '42501: permission denied for table network_connections';
const FIX_CHANGES = ['policies.public.network_connections.network_connections_self_update',
  'policies.public.network_connections.network_connections_self_write', 'relations.public.network_connections'];

// What THE HOLE lets Ana do, with her own session, before the fix (and again after the rollback) and after the fix.
export const HOLE_OPEN = Object.freeze({
  insertAccepted: ['accepted'],
  askCat: 'pending sent',
  selfAccept: ['accepted'],
  anaSeesCat: 'accepted both',
  askDan: 'pending sent',
  readdress: ['eve'],
  fayAsks: 'pending sent',
  requesterSwap: ['gus'],
  swapAccepted: 'accepted both',
  deleteRow: [],
  rows: ['ana->ben accepted', 'ana->cat accepted', 'ana->eve pending', 'gus->ana accepted'],
  dmBen: 'active',
  dmHal: 'requested',
  publish: 'level 3 pending',
  creditsBen: 1,
  benNotices: ['collaboration_published 1']
});
// What each observation is, for the proof's output.
export const HOLE_STEPS = Object.freeze({
  insertAccepted: 'Ana inserts an accepted row naming Ben (POST)',
  askCat: 'Ana asks Cat (request_connection)',
  selfAccept: 'Ana accepts her own request to Cat (PATCH status)',
  anaSeesCat: 'the pair Ana and Cat (connection_with)',
  askDan: 'Ana asks Dan (request_connection)',
  readdress: 'Ana moves her request from Dan to Eve (PATCH addressee)',
  fayAsks: 'Fay asks Ana (request_connection)',
  requesterSwap: 'Ana makes Fay\'s request Gus\'s (PATCH requester)',
  swapAccepted: 'Ana accepts the request Gus never sent (answer_connection)',
  deleteRow: 'Ana deletes her row with Cat (DELETE)',
  rows: 'the table',
  dmBen: 'Ana writes to Ben (mnet_open_direct): Ben\'s side',
  dmHal: 'Ana writes to Hal, never connected: Hal\'s side',
  publish: 'Ana publishes a song crediting Ben (publish_antisocial_collaboration)',
  creditsBen: 'public posts crediting Ben',
  benNotices: 'what Ben was told'
});
export const HOLE_CLOSED = Object.freeze({
  insertAccepted: DENIED,
  askCat: 'pending sent',
  selfAccept: DENIED,
  anaSeesCat: 'pending sent',
  askDan: 'pending sent',
  readdress: DENIED,
  fayAsks: 'pending sent',
  requesterSwap: DENIED,
  swapAccepted: 'not tried',
  deleteRow: DENIED,
  rows: ['ana->cat pending', 'ana->dan pending', 'fay->ana pending'],
  dmBen: 'requested',
  dmHal: 'requested',
  publish: 'P0001: connect with your collaborator on Action Network first',
  creditsBen: 0,
  benNotices: []
});

// Every legitimate flow the World uses (js/mnet.js: Connect, Accept, Decline, Withdraw, End, the bell's answer, the
// partner picker; the Worker's profile read; direct messages; publishing together), with what each answers. The same
// before the fix, after it, and in that order.
export const LEGITIMATE = Object.freeze([
  ['Ivy asks Jon (request_connection)', 'pending sent'],
  ['Jon is told', ['connection_request 1']],
  ['asking again changes nothing', 'pending sent'],
  ['Ivy cannot answer her own request (answer_connection)', 'P0001: request not found'],
  ['a member outside the pair cannot answer it', 'P0001: request not found'],
  ['Jon sees it as received (connection_with)', 'pending received'],
  ['Jon accepts (answer_connection true)', 'accepted both'],
  ['Ivy is told', ['connection_accepted 1']],
  ['Ivy lists Jon (my_connections)', ['jon']],
  ['Jon lists Ivy (my_connections)', ['ivy']],
  ['Ivy reads her own row (REST read)', 1],
  ['Paz, in no pair, reads no row', 0],
  ['a visitor reads no row (anon)', 0],
  ['the Worker reads the pair (service role)', ['ivy->jon accepted']],
  ['Ivy writes to Jon: a conversation, not a request (mnet_open_direct)', 'active'],
  ['Ivy sends (mnet_send_message); the Worker reads it for Jon (service role)', 1],
  ['Ivy and Jon publish together (publish_antisocial_collaboration)', 'level 3 pending'],
  ['the post credits Jon', 1],
  ['Kay asks Leo; Leo declines (answer_connection false)', 'declined received'],
  ['a decline tells Kay nothing', []],
  ['Kay sees the declined pair as none (connection_with)', 'none'],
  ['Leo asks Kay after declining (request_connection)', 'pending sent'],
  ['Kay asks back, which accepts (request_connection)', 'accepted both'],
  ['Leo ends the connection (withdraw_connection)', 'none'],
  ['Kay lists no one', []],
  ['Mia asks Ned, then withdraws the request (withdraw_connection)', 'none'],
  ['Ned has no unread notice of it left', []],
  ['Ola asks Ned; Ned cannot withdraw it, only answer it', 'P0001: answer it instead'],
  ['Quin blocked Rex: Rex asking reads as not found', 'P0001: member not found'],
  ['a visitor cannot ask (anon has no EXECUTE)', '42501: permission denied for function request_connection'],
  ['rows left', ['ivy->jon accepted', 'ola->ned pending']]
]);

/**
 * The proof both engines run on a fresh production layer. Returns the number of checks. `atHole` (optional) runs extra
 * checks while the table is in THE HOLE's state (the native proof's lock wait).
 */
export async function runConsentProof(db, { log = console.log, atHole } = {}) {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n += 1; log(`ok ${n} ${m}`); };
  const eq = (a, b, m) => { assert.deepEqual(a, b, m); n += 1; log(`ok ${n} ${m}`); };
  const fix = await fixSql();
  const rollback = await rollbackSql();
  const checkQuery = headerCheckQuery(fix);
  const fp = () => fingerprint(db);
  const as = (m, sql, params = []) => settle(db.request('authenticated', m.user, sql, params));
  const shown = (x, f) => (x.ok ? f(x.rows) : `${x.code}: ${x.message}`);
  const rpc = (x) => shown(x, (rows) => {
    const v = rows[0].r;
    if (v && typeof v === 'object' && 'level' in v) return `level ${v.level} ${v.status}`;
    return v && typeof v === 'object' ? [v.status, v.direction].filter(Boolean).join(' ') : v;
  });
  const pairs = async () => (await db.admin('select requester_m_uid as a, addressee_m_uid as b, status from public.network_connections order by 1, 2'))
    .map((x) => `${nameOf(x.a)}->${nameOf(x.b)} ${x.status}`);
  const pairId = async (a, b) => (await db.admin('select id from public.network_connections where requester_m_uid = $1 and addressee_m_uid = $2', [a.m_uid, b.m_uid]))[0]?.id;
  const stateOf = async (conversation, m) => (await db.admin('select member_state from public.network_conversation_members where conversation_id = $1 and m_uid = $2', [conversation, m.m_uid]))[0]?.member_state;
  const notices = async (m) => (await db.admin('select type, count(*)::int as n from public.network_notifications where recipient_m_uid = $1 group by type order by type', [m.m_uid])).map((x) => `${x.type} ${x.n}`);
  const credits = async (m) => (await db.admin(`select count(*)::int as n from public.network_posts where visibility = 'public'
      and metadata->'collaboration'->'credits' @> $1::jsonb`, [JSON.stringify([{ m_uid: m.m_uid }])]))[0].n;
  const assignment = async (m) => {
    const [{ id }] = await db.admin(`insert into public.action_mission_assignments(mission_id, user_id, m_uid, status) values ($1, $2, $3, 'in_progress') returning id`, [ANTISOCIAL_MISSION, m.user, m.m_uid]);
    await db.admin(`insert into public.action_antisocial_levels(assignment_id, level, user_id, status) values ($1, 1, $2, 'verified'), ($1, 2, $2, 'verified')`, [id, m.user]);
    return id;
  };
  const dm = async (from, to) => {
    const x = await as(from, 'select public.mnet_open_direct($1) as r', [to.m_uid]);
    return x.ok ? { conversation: x.rows[0].r, state: await stateOf(x.rows[0].r, to) } : { state: shown(x) };
  };
  const ASK = 'select public.request_connection($1) as r';
  const ANSWER = 'select public.answer_connection($1, $2) as r';
  const WITHDRAW = 'select public.withdraw_connection($1) as r';
  const WITH = 'select public.connection_with($1) as r';
  const MINE = 'select m_uid from public.my_connections() order by m_uid';
  const PUBLISH = "select public.publish_antisocial_collaboration($1, $2, $3, 'song', 'https://example.org/work', null, '') as r";

  /** Everything THE HOLE allows, tried with Ana's own session. */
  async function holeAttempts() {
    const { ana, ben, cat, dan, eve, fay, gus, hal } = M;
    const o = {};
    // (a) an accepted row naming Ben, who was never asked
    o.insertAccepted = shown(await as(ana, `insert into public.network_connections(requester_m_uid, addressee_m_uid, status)
      values ($1, $2, 'accepted') returning status`, [ana.m_uid, ben.m_uid]), (rows) => rows.map((x) => x.status));
    // (b) Ana asks Cat through the RPC, then accepts her own request
    o.askCat = rpc(await as(ana, ASK, [cat.m_uid]));
    o.selfAccept = shown(await as(ana, `update public.network_connections set status = 'accepted'
      where requester_m_uid = $1 and addressee_m_uid = $2 returning status`, [ana.m_uid, cat.m_uid]), (rows) => rows.map((x) => x.status));
    o.anaSeesCat = rpc(await as(ana, WITH, [cat.m_uid]));
    // (c) Ana asks Dan, then moves the request to Eve, who was never asked
    o.askDan = rpc(await as(ana, ASK, [dan.m_uid]));
    o.readdress = shown(await as(ana, `update public.network_connections set addressee_m_uid = $3
      where requester_m_uid = $1 and addressee_m_uid = $2 returning addressee_m_uid`, [ana.m_uid, dan.m_uid, eve.m_uid]), (rows) => rows.map((x) => nameOf(x.addressee_m_uid)));
    // (c) as the one asked: Fay asks Ana; Ana makes it Gus's request, then accepts it
    o.fayAsks = rpc(await as(fay, ASK, [ana.m_uid]));
    const swap = await as(ana, `update public.network_connections set requester_m_uid = $3
      where requester_m_uid = $1 and addressee_m_uid = $2 returning requester_m_uid`, [fay.m_uid, ana.m_uid, gus.m_uid]);
    o.requesterSwap = shown(swap, (rows) => rows.map((x) => nameOf(x.requester_m_uid)));
    o.swapAccepted = swap.ok && swap.rows.length ? rpc(await as(ana, ANSWER, [await pairId(gus, ana), true])) : 'not tried';
    // deleting (production has no delete policy: nothing is deleted; after the fix the request is refused)
    o.deleteRow = shown(await as(ana, `delete from public.network_connections where requester_m_uid = $1 and addressee_m_uid = $2 returning status`,
      [ana.m_uid, cat.m_uid]), (rows) => rows.map((x) => x.status));
    o.rows = await pairs();
    // what an accepted pair opens: a direct message to Ben arrives as a conversation; Hal, not connected, gets a request
    o.dmBen = (await dm(ana, ben)).state;
    o.dmHal = (await dm(ana, hal)).state;
    // and a public post crediting Ben, who never answered anything
    o.publish = rpc(await as(ana, PUBLISH, [await assignment(ana), ben.m_uid, 'Probe song']));
    o.creditsBen = await credits(ben);
    o.benNotices = await notices(ben);
    return o;
  }

  /** Every legitimate flow, as [label, answer] in order. */
  async function legitimateFlows() {
    const { ivy, jon, kay, leo, mia, ned, ola, paz, quin, rex } = M;
    const t = [];
    const step = (label, value) => { t.push([label, value]); return value; };
    step('Ivy asks Jon (request_connection)', rpc(await as(ivy, ASK, [jon.m_uid])));
    step('Jon is told', await notices(jon));
    step('asking again changes nothing', rpc(await as(ivy, ASK, [jon.m_uid])));
    const ij = await pairId(ivy, jon);
    step('Ivy cannot answer her own request (answer_connection)', rpc(await as(ivy, ANSWER, [ij, true])));
    step('a member outside the pair cannot answer it', rpc(await as(paz, ANSWER, [ij, true])));
    step('Jon sees it as received (connection_with)', rpc(await as(jon, WITH, [ivy.m_uid])));
    step('Jon accepts (answer_connection true)', rpc(await as(jon, ANSWER, [ij, true])));
    step('Ivy is told', await notices(ivy));
    step('Ivy lists Jon (my_connections)', shown(await as(ivy, MINE), (rows) => rows.map((x) => nameOf(x.m_uid))));
    step('Jon lists Ivy (my_connections)', shown(await as(jon, MINE), (rows) => rows.map((x) => nameOf(x.m_uid))));
    step('Ivy reads her own row (REST read)', shown(await as(ivy, 'select count(*)::int as n from public.network_connections'), (rows) => rows[0].n));
    step('Paz, in no pair, reads no row', shown(await as(paz, 'select count(*)::int as n from public.network_connections'), (rows) => rows[0].n));
    step('a visitor reads no row (anon)', shown(await settle(db.request('anon', null, 'select count(*)::int as n from public.network_connections')), (rows) => rows[0].n));
    step('the Worker reads the pair (service role)', shown(await settle(db.request('service_role', null, `select requester_m_uid as a, addressee_m_uid as b, status
      from public.network_connections where (requester_m_uid = $1 and addressee_m_uid = $2) or (requester_m_uid = $2 and addressee_m_uid = $1)`,
    [ivy.m_uid, jon.m_uid])), (rows) => rows.map((x) => `${nameOf(x.a)}->${nameOf(x.b)} ${x.status}`)));
    const talk = await dm(ivy, jon);
    step('Ivy writes to Jon: a conversation, not a request (mnet_open_direct)', talk.state);
    const sent = await as(ivy, 'select public.mnet_send_message($1, $2) as r', [talk.conversation, 'Hello, Jon']);
    // the Worker reads a conversation's messages with the service role (workers/mccluster/src/platform-api.js:1059)
    step('Ivy sends (mnet_send_message); the Worker reads it for Jon (service role)', sent.ok
      ? shown(await settle(db.request('service_role', null, 'select count(*)::int as n from public.network_messages where conversation_id = $1 and deleted_at is null',
        [talk.conversation])), (rows) => rows[0].n)
      : shown(sent));
    step('Ivy and Jon publish together (publish_antisocial_collaboration)', rpc(await as(ivy, PUBLISH, [await assignment(ivy), jon.m_uid, 'Our song'])));
    step('the post credits Jon', await credits(jon));
    await as(kay, ASK, [leo.m_uid]);
    step('Kay asks Leo; Leo declines (answer_connection false)', rpc(await as(leo, ANSWER, [await pairId(kay, leo), false])));
    step('a decline tells Kay nothing', await notices(kay));
    step('Kay sees the declined pair as none (connection_with)', rpc(await as(kay, WITH, [leo.m_uid])));
    step('Leo asks Kay after declining (request_connection)', rpc(await as(leo, ASK, [kay.m_uid])));
    step('Kay asks back, which accepts (request_connection)', rpc(await as(kay, ASK, [leo.m_uid])));
    step('Leo ends the connection (withdraw_connection)', rpc(await as(leo, WITHDRAW, [await pairId(leo, kay)])));
    step('Kay lists no one', shown(await as(kay, MINE), (rows) => rows.map((x) => nameOf(x.m_uid))));
    await as(mia, ASK, [ned.m_uid]);
    step('Mia asks Ned, then withdraws the request (withdraw_connection)', rpc(await as(mia, WITHDRAW, [await pairId(mia, ned)])));
    step('Ned has no unread notice of it left', await notices(ned));
    await as(ola, ASK, [ned.m_uid]);
    step('Ola asks Ned; Ned cannot withdraw it, only answer it', rpc(await as(ned, WITHDRAW, [await pairId(ola, ned)])));
    await db.admin('insert into public.network_blocks(blocker_m_uid, blocked_m_uid) values ($1, $2)', [quin.m_uid, rex.m_uid]);
    step('Quin blocked Rex: Rex asking reads as not found', rpc(await as(rex, ASK, [quin.m_uid])));
    step('a visitor cannot ask (anon has no EXECUTE)', rpc(await settle(db.request('anon', null, ASK, [jon.m_uid]))));
    step('rows left', await pairs());
    return t;
  }
  const legitimate = async (phase) => {
    const t = await legitimateFlows();
    eq(t.map(([label]) => label), LEGITIMATE.map(([label]) => label), `${phase}: every legitimate flow ran`);
    for (let i = 0; i < t.length; i += 1) eq(t[i][1], LEGITIMATE[i][1], `${phase}: ${t[i][0]}: ${JSON.stringify(t[i][1])}`);
    await resetRows(db);
    return t;
  };
  const writers = async () => (await db.admin(`select replace(p.oid::regprocedure::text, 'public.', '') as f, p.prosecdef as definer,
      p.proowner = c.relowner as owns_table, has_function_privilege('authenticated', p.oid, 'EXECUTE') as member, has_function_privilege('anon', p.oid, 'EXECUTE') as visitor
    from pg_proc p, pg_class c where c.oid = 'public.network_connections'::regclass
      and p.oid in (${WRITERS.map((w) => `to_regprocedure('public.${w}')`).join(', ')}) order by 1`))
    .map((x) => [x.f, x.definer, x.owns_table, x.member, x.visitor]);
  const WRITERS_AS_PRODUCTION = [...WRITERS].sort().map((w) => [w, true, true, true, false]);

  // ---------------------------------------------------------------- P. the production layer is production
  log(`# ${db.label}: production layer`);
  eq(await tablePolicies(db), PRODUCTION.policies, 'policies equal production (2026-11-19): names, commands, roles and expressions (md5 of pg_policies)');
  eq(await apiAcl(db), productionAcl(db.versionNum), `grants equal production for anon, authenticated and service_role${db.versionNum >= 170000 ? '' : ' (PostgreSQL 16 has no MAINTAIN)'}`);
  eq(Object.fromEntries((await db.admin(`select conname, pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.network_connections'::regclass`)).map((x) => [x.conname, x.d])),
    PRODUCTION.constraints, 'constraints equal production (the pair is the primary key; four statuses)');
  eq((await db.admin(`select pg_get_indexdef(indexrelid) as d from pg_index where indrelid = 'public.network_connections'::regclass order by 1`)).map((x) => x.d),
    PRODUCTION.indexes, 'indexes equal production');
  eq(Object.fromEntries((await db.admin(`select replace(p.oid::regprocedure::text, 'public.', '') as f, left(md5(p.prosrc), 12) as m from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%network_connections%'`)).map((x) => [x.f, x.m])),
    PRODUCTION.functions, 'the eight functions whose body names the table are production\'s, byte for byte (md5 of the body)');
  eq(await writers(), WRITERS_AS_PRODUCTION, 'the three writers are SECURITY DEFINER, owned by the table\'s owner, executable by members and not by visitors');
  eq((await db.admin(`select relrowsecurity as on, relforcerowsecurity as forced from pg_class where oid = 'public.network_connections'::regclass`))[0],
    { on: true, forced: false }, 'row level security on, not forced');
  const hole = await fp();

  // ---------------------------------------------------------------- H and L before the fix
  log('# before the fix: THE HOLE');
  const open = await holeAttempts();
  for (const k of Object.keys(HOLE_OPEN)) eq(open[k], HOLE_OPEN[k], `before: ${HOLE_STEPS[k]}: ${JSON.stringify(open[k])}`);
  await resetRows(db);
  log('# before the fix: the legitimate flows');
  const legitBefore = await legitimate('before');

  // ---------------------------------------------------------------- D. a drifted table: the fix refuses, changing nothing
  log('# the fix refuses a table it would not close, and changes nothing');
  for (const [label, drift, undo, says] of [
    ['anon holds INSERT', 'grant insert on public.network_connections to anon', 'revoke insert on public.network_connections from anon',
      'an API role can still write public.network_connections (anon INSERT)'],
    ['a member DELETE policy exists', 'create policy network_connections_self_delete on public.network_connections for delete to authenticated using (requester_m_uid = public.current_m_uid())',
      'drop policy network_connections_self_delete on public.network_connections', 'a write policy is still on public.network_connections (network_connections_self_delete (DELETE))'],
    ['answer_connection is SECURITY INVOKER', 'alter function public.answer_connection(uuid, boolean) security invoker',
      'alter function public.answer_connection(uuid, boolean) security definer', 'not SECURITY DEFINER or not owned by the table\'s owner (public.answer_connection(uuid,boolean))']
  ]) {
    await db.script(drift);
    const drifted = await fp();
    const x = await settle(applyFile(db, fix));
    eq(x.ok ? 'applied' : x.code, '55000', `${label}: the fix stops with 55000`);
    ok(!x.ok && x.message.includes(says), `${label}: and names it: ${x.message}`);
    eq(fingerprintDiff(drifted, await fp()), [], `${label}: and nothing changed (one transaction)`);
    await db.script(undo);
    eq(fingerprintDiff(hole, await fp()), [], `${label}: undone`);
  }
  if (atHole) await atHole({ ok, eq, fix, hole, fp, applyFile, settle });

  // ---------------------------------------------------------------- F. the fix
  log('# the fix');
  await applyFile(db, fix);
  const closed = await fp();
  eq(fingerprintDiff(hole, closed), FIX_CHANGES, 'it changes the two policies and the table\'s grants and nothing else in the database');
  eq(await tablePolicies(db), [PRODUCTION.policies[0]], 'network_connections_member_read is the only policy left, unchanged');
  eq(await apiAcl(db), productionAcl(db.versionNum, true), 'authenticated keeps SELECT (and MAINTAIN); anon and the service role are unchanged');
  eq(await writers(), WRITERS_AS_PRODUCTION, 'the writers are untouched');
  const check = (await db.admin(checkQuery))[0];
  eq({ policies: check.policies, select: check.member_select, insert: check.member_insert, update: check.member_update, delete: check.member_delete },
    { policies: 'network_connections_member_read SELECT authenticated', select: true, insert: false, update: false, delete: false },
    'the header\'s check query answers what the header says it will');
  await applyFile(db, fix);
  eq(fingerprintDiff(closed, await fp()), [], 'applied twice: no change');
  await applyFile(db, fix, 'string');
  eq(fingerprintDiff(closed, await fp()), [], 'applied as one string, as apply_migration sends it: no change');

  log('# after the fix: THE HOLE is closed');
  const shut = await holeAttempts();
  for (const k of Object.keys(HOLE_CLOSED)) eq(shut[k], HOLE_CLOSED[k], `after: ${HOLE_STEPS[k]}: ${JSON.stringify(shut[k])}`);
  await resetRows(db);
  log('# after the fix: the legitimate flows');
  const legitAfter = await legitimate('after');
  eq(legitAfter, legitBefore, 'every legitimate flow answers exactly as before the fix');

  log('# the second lock: if the grants came back by mistake, no policy admits a member write');
  await db.script('grant insert, update, delete on public.network_connections to authenticated');
  eq(rpc(await as(M.ana, ASK, [M.cat.m_uid])), 'pending sent', 're-granted: Ana asks Cat through the RPC');
  eq(shown(await as(M.ana, `insert into public.network_connections(requester_m_uid, addressee_m_uid, status) values ($1, $2, 'accepted') returning status`, [M.ana.m_uid, M.ben.m_uid]), (rows) => rows),
    '42501: new row violates row-level security policy for table "network_connections"', 're-granted: an accepted insert is refused by row level security');
  eq(shown(await as(M.ana, `update public.network_connections set status = 'accepted' where requester_m_uid = $1 returning status`, [M.ana.m_uid]), (rows) => rows), [],
    're-granted: accepting her own request updates no row');
  eq(shown(await as(M.ana, 'delete from public.network_connections where requester_m_uid = $1 returning status', [M.ana.m_uid]), (rows) => rows), [], 're-granted: deleting removes no row');
  eq(await pairs(), ['ana->cat pending'], 're-granted: the request is still pending');
  await db.script('revoke insert, update, delete on public.network_connections from authenticated');
  eq(fingerprintDiff(closed, await fp()), [], 'grants taken back: the fixed state again');
  await resetRows(db);

  // ---------------------------------------------------------------- R. the rollback
  log('# the rollback');
  await applyFile(db, rollback);
  eq(fingerprintDiff(hole, await fp()), [], 'the rollback restores the state before the fix exactly: every policy, grant, function and constraint');
  eq(await tablePolicies(db), PRODUCTION.policies, 'its policies are production\'s again (names, commands, roles, expressions)');
  eq(await apiAcl(db), productionAcl(db.versionNum), 'and so are the grants');
  const back = (await db.admin(checkQuery))[0];
  eq({ policies: back.policies, select: back.member_select, insert: back.member_insert, update: back.member_update, delete: back.member_delete },
    { policies: 'network_connections_member_read SELECT authenticated; network_connections_self_update UPDATE authenticated; network_connections_self_write INSERT authenticated',
      select: true, insert: true, update: true, delete: true }, 'the check query answers what the rollback\'s header says');
  await applyFile(db, rollback);
  eq(fingerprintDiff(hole, await fp()), [], 'rolled back twice: no change');
  const reopened = await holeAttempts();
  eq(reopened, { ...HOLE_OPEN }, 'rolled back: every path of THE HOLE works again, as before the fix');
  await resetRows(db);

  log('# applied again');
  await db.script('grant update (status) on public.network_connections to authenticated');
  await applyFile(db, fix);
  eq(fingerprintDiff(closed, await fp()), [], 'from the hole again: the same fixed state, and a column UPDATE grant made before it goes too');
  await applyFile(db, rollback);
  await applyFile(db, fix, 'string');
  eq(fingerprintDiff(closed, await fp()), [], 'applied as one string from the hole: the same fixed state');
  return n;
}
