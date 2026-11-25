// Isolated local database support for the pending mission catalog sources pair
// (supabase/pending/20261119140000_mission_catalog_sources_v1.sql and its .rollback.sql); never connects to the canonical
// project. One proof, two engines: scripts/test/mission-catalog-sources.integration.mjs runs it on PGlite (and on mutated
// copies of the pair, each of which must fail it), scripts/test/mission-catalog-sources.native.integration.mjs on a
// disposable PostgreSQL 16 and 17, with the checks one PGlite session cannot make (two sessions at once, the lock bound).
//
// The database is supabase/tests/mission_catalog_sources.stub.sql: production's default privileges (read 2026-11-19), the
// house organization with an owner, a staff member and a viewer, control_audit and its read policy, the organizations with
// production's checks and policies, the missions and their details with production's policies. Requests run the way
// PostgREST runs them: in a transaction, SET LOCAL ROLE to the key's role, request.jwt.claims set; the Worker's calls run
// as service_role, exactly as its service key does.
//
// MISSION_CATALOG_SOURCES_DIR replaces supabase/pending/ for the pair (same file names): the mutation runs.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';

export const FORWARD_FILE = '20261119140000_mission_catalog_sources_v1.sql';
export const ROLLBACK_FILE = '20261119140000_mission_catalog_sources_v1.rollback.sql';
export const STUB_FILE = 'supabase/tests/mission_catalog_sources.stub.sql';
const REPO = new URL('../../../', import.meta.url);
const pendingPath = (file, dir = process.env.MISSION_CATALOG_SOURCES_DIR) => (dir ? join(dir, file) : new URL(`supabase/pending/${file}`, REPO));
export const forwardSql = (dir) => readFile(pendingPath(FORWARD_FILE, dir), 'utf8');
export const rollbackSql = (dir) => readFile(pendingPath(ROLLBACK_FILE, dir), 'utf8');
export const stubSql = () => readFile(new URL(STUB_FILE, REPO), 'utf8');
export const WORDS = createRequire(import.meta.url)('../../../js/mission-source-words.js');

// The stub's fixture accounts and rows (synthetic ids)
export const OWNER = '11111111-1111-4111-8111-111111111111';
export const STAFF = '22222222-2222-4222-8222-222222222222';
export const VIEWER = '88888888-8888-4888-8888-888888888888';
export const MEMBER = '66666666-6666-4666-8666-666666666666';
export const MEMBER_MUID = 'b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4';
export const HOUSE = 'c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0';
export const UNKNOWN = '99999999-9999-4999-8999-999999999999';
export const DRAWDOWN_MISSIONS = Object.freeze(['d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003']);
export const OPEN_OTHER_MISSION = 'e0000000-0000-4000-8000-000000000001';
export const DESCRIPTION = 'Credited source of the mission catalog drawdown in McCluster Corp\'s World. This record is kept by McCluster Corp; Project Drawdown does not run it. Project Drawdown is a 501(c)(3) nonprofit (drawdown.org/about, read 2026-11-19).';
export const ROLE_LINE = 'Missions written by McCluster Corp from Project Drawdown’s climate solutions.';
export const FACTS = Object.freeze([
  { label: 'Organization', value: '501(c)(3) nonprofit', source: 'https://drawdown.org/about' },
  { label: 'Mailing address', value: 'St. Paul, Minnesota', source: 'https://drawdown.org/contact' },
  { label: 'What it publishes', value: 'Assessments of climate solutions, in the Drawdown Explorer', source: 'https://drawdown.org/explorer' }
]);
export const CONFIRM = Object.freeze({ permission_confirmed: true, permission_confirmed_on: '2026-11-19' });

const failure = (e) => ({ ok: false, code: e?.code ?? 'error', constraint: e?.constraint ?? null, message: String(e?.message ?? e) });

// ---------------------------------------------------------------- engines
/** PGlite: one session. exec() runs a script (a failed explicit transaction is rolled back); as() runs one request. */
export async function pgliteAdapter() {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const pg = new PGlite();
  const [{ v, n }] = (await pg.query("select current_setting('server_version') as v, current_setting('server_version_num')::int as n")).rows;
  const exec = async (sql) => { try { await pg.exec(sql); } catch (e) { await pg.exec('rollback').catch(() => {}); throw e; } };
  return {
    label: `PGlite (PostgreSQL ${v})`, version: v, versionNum: n,
    exec,
    query: async (sql, params = []) => (await pg.query(sql, params)).rows,
    as: async (role, claims, sql, params = [], { commit = false } = {}) => {
      try {
        await pg.exec(`begin; set local role ${role};`);
        await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || {})]);
        const r = await pg.query(sql, params);
        await pg.exec(commit ? 'commit' : 'rollback');
        return { ok: true, rows: r.rows };
      } catch (e) {
        await pg.exec('rollback').catch(() => {});
        return failure(e);
      }
    },
    close: () => pg.close()
  };
}

/** A real PostgreSQL server (scripts/test/support/native-postgres.mjs): an admin session and a request session. */
export async function nativeAdapter(server, database) {
  const admin = await server.client(database);
  const request = await server.client(database);
  const [{ v, n }] = (await admin.query("select current_setting('server_version') as v, current_setting('server_version_num')::int as n")).rows;
  const run = async (client, sql) => { try { await client.query(sql); } catch (e) { await client.query('rollback').catch(() => {}); throw e; } };
  const as = async (client, role, claims, sql, params, commit) => {
    try {
      await client.query('begin');
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || {})]);
      const r = await client.query(sql, params);
      await client.query(commit ? 'commit' : 'rollback');
      return { ok: true, rows: r.rows };
    } catch (e) {
      await client.query('rollback').catch(() => {});
      return failure(e);
    }
  };
  return {
    label: `PostgreSQL ${v}`, version: v, versionNum: n, adminClient: admin,
    exec: (sql) => run(admin, sql),
    query: async (sql, params = []) => (await admin.query(sql, params)).rows,
    as: (role, claims, sql, params = [], { commit = false } = {}) => as(request, role, claims, sql, params, commit),
    /** A further session, for two requests at once. */
    session: async () => {
      const c = await server.client(database);
      c.pid = (await c.query('select pg_backend_pid() as p')).rows[0].p;
      return { client: c, as: (role, claims, sql, params = [], { commit = false } = {}) => as(c, role, claims, sql, params, commit), end: () => c.end().catch(() => {}) };
    },
    close: async () => { for (const c of [admin, request]) { try { await c.end(); } catch { /* closed */ } } }
  };
}

// ---------------------------------------------------------------- what the proof compares
/** The catalog and the rows the pair must leave as it found them (control_audit's rows excepted). */
export async function snapshot(db) {
  const [row] = await db.query(`select
    (select string_agg(c.relname::text || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '-') || ':' || c.relrowsecurity::text, ',' order by c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public') as rels,
    (select string_agg(tablename::text || '.' || policyname::text || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname)
       from pg_policies where schemaname = 'public') as pols,
    (select string_agg(p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(p.proacl::text, '-') || ':' || p.prosecdef::text, ',' order by p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') as funcs,
    (select string_agg(c.conname::text || ':' || pg_get_constraintdef(c.oid), ',' order by c.conname)
       from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public') as cons,
    (select string_agg(md5(o.id::text || o.slug || o.name || o.organization_type || o.description || coalesce(o.website_url, '') || o.verification_state || coalesce(o.created_by::text, '')), ',' order by o.slug)
       from public.network_organizations o) as orgs,
    (select string_agg(md5(m.id::text || m.title || m.status || m.description), ',' order by m.id) from public.action_missions m) as missions,
    (select string_agg(md5(d.mission_id::text || d.catalog || d.slug || d.credit_line || coalesce(d.source_url, '')), ',' order by d.mission_id) from public.action_mission_details d) as details,
    (select count(*)::int from public.authenticity_checks) as checks`);
  return JSON.stringify(row);
}
export const auditCount = async (db) => (await db.query('select count(*)::int as n from public.control_audit'))[0].n;

/** One deny-list entry written into a sentence that must be refused. */
export function sentenceFor([word, kind]) {
  const w = kind === 'phrase' ? word.split(' ').join('  ') : word;
  return kind === 'prefix' ? `Missions ${w}ed here.` : `Missions ${w} here.`;
}

// ---------------------------------------------------------------- the proof
/**
 * Runs every check on a fresh database built from the stub and returns { results, passed, failed } without throwing.
 * forward and rollback are the texts under test (the pending files, or a mutated copy). A check that throws is a failure.
 */
export async function runProof(db, { forward, rollback, log = () => {} } = {}) {
  forward = forward ?? await forwardSql();
  rollback = rollback ?? await rollbackSql();
  const results = [];
  const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail: pass ? '' : String(detail) }); log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : `  ${detail}`}`); };
  const attempt = async (sql) => { try { await db.exec(sql); return 'ok'; } catch (e) { return e?.code || String(e?.message || e); } };
  const svc = (sql, params = []) => db.as('service_role', { role: 'service_role' }, sql, params, { commit: true });
  const cmd = async (actor, command, rev, key, payload = {}, reason = 'Synthetic proof reason.', catalog = 'drawdown') => {
    const r = await svc('select public.mission_catalog_source_command($1, $2, $3, $4, $5, $6, $7::jsonb) as r', [actor, catalog, command, rev, key, reason, payload === null ? null : JSON.stringify(payload)]);
    return r.ok ? r.rows[0].r : r;
  };
  const ownerState = async (actor) => { const r = await svc('select public.mission_catalog_source_owner_state($1) as r', [actor]); return r.ok ? r.rows[0].r : r; };
  const readLinks = async (role, claims) => { const r = await db.as(role, claims, 'select catalog, state from public.mission_catalog_sources'); return r.ok ? r.rows.length : r.code; };
  const key = () => crypto.randomUUID();
  const guard = async (name, fn) => { try { await fn(); } catch (e) { ok(name, false, `threw ${e?.code || ''} ${e?.message || e}`); } };

  await db.exec(await stubSql());
  await guard('the stub carries production\'s role check and default privileges', async () => {
    ok('the stub: org_members refuses the role member (production\'s org_members_role_check)', (await attempt(`insert into public.org_members values ('${HOUSE}', '${UNKNOWN}', 'member')`)) === '23514');
    const acl = Object.fromEntries((await db.query('select defaclobjtype as t, defaclacl::text as a from pg_default_acl')).map((r) => [r.t, r.a]));
    const m = db.versionNum >= 170000 ? 'm' : '';
    ok('the stub: production\'s default privileges', acl.r === `{anon=arwd${m}/postgres,authenticated=arwd${m}/postgres,service_role=arwdDxt${m}/postgres}`
      && acl.f === '{service_role=X/postgres}' && acl.S === '{anon=rwU/postgres,authenticated=rwU/postgres}', JSON.stringify(acl));
  });

  // 1. Before the publish: refused, nothing changed
  const beforeAll = await snapshot(db);
  await guard('before the publish', async () => {
    ok('1 before the publish the forward file refuses (55000) and changes nothing', (await attempt(forward)) === '55000' && (await snapshot(db)) === beforeAll);
  });
  await db.exec(`update public.action_missions set status = 'open' where id = '${DRAWDOWN_MISSIONS[0]}'`);
  const beforeForward = await snapshot(db);

  // 2. Apply, the rows, twice
  let org = null;
  await guard('apply', async () => {
    ok('2 after the publish the forward file applies', (await attempt(forward)) === 'ok');
    [org] = await db.query(`select id, slug, name, organization_type, description, website_url, verification_state, created_by from public.network_organizations where slug = 'project-drawdown'`);
    ok('2 one organization row: the name, nonprofit, the description, the website, unverified, no creator', org && org.name === 'Project Drawdown'
      && org.organization_type === 'nonprofit' && org.description === DESCRIPTION && org.website_url === 'https://drawdown.org/'
      && org.verification_state === 'unverified' && org.created_by === null, JSON.stringify(org));
    const links = await db.query('select catalog, organization_id, state, revision, role_line, facts, facts_read_on::text as read_on, shown_at from public.mission_catalog_sources');
    ok('2 one draft link for the catalog drawdown: revision 1, the role line, three dated facts, never shown', links.length === 1 && links[0].catalog === 'drawdown'
      && links[0].organization_id === org?.id && links[0].state === 'draft' && links[0].revision === 1 && links[0].role_line === ROLE_LINE
      && JSON.stringify(links[0].facts) === JSON.stringify(FACTS) && links[0].read_on === '2026-11-19' && links[0].shown_at === null, JSON.stringify(links));
    const once = await snapshot(db);
    ok('3 applying it again changes nothing and fails nothing', (await attempt(forward)) === 'ok' && (await snapshot(db)) === once
      && (await db.query("select count(*)::int as n from public.network_organizations where lower(slug) = 'project-drawdown'"))[0].n === 1);
    ok('4 production\'s slug and name checks are live', (await attempt("insert into public.network_organizations (slug, name) values ('Bad Slug', 'x')")) === '23514'
      && (await attempt(`insert into public.network_organizations (slug, name) values ('ok-slug', '${'x'.repeat(121)}')`)) === '23514');
    ok('4 no check of the new table references a mission', (await db.query(`select count(*)::int as n from pg_constraint where conrelid = 'public.mission_catalog_sources'::regclass
      and confrelid in ('public.action_missions'::regclass, 'public.action_mission_details'::regclass)`))[0].n === 0);
    const fk = (await db.query(`select confdeltype from pg_constraint where conname = 'mission_catalog_sources_organization_fkey'`))[0];
    ok('4 the link\'s foreign key onto the organization restricts deletion', fk?.confdeltype === 'r', JSON.stringify(fk));
  });

  // 3. Who can read and write
  await guard('grants', async () => {
    ok('5 a draft is unreadable: anon, a member, an admin session', (await readLinks('anon', {})) === 0 && (await readLinks('authenticated', { sub: MEMBER, role: 'authenticated' })) === 0
      && (await readLinks('authenticated', { sub: OWNER, role: 'authenticated', admin: 'true' })) === 0);
    const priv = (await db.query(`select r.role, p.priv, has_table_privilege(r.role, 'public.mission_catalog_sources', p.priv) as has
      from (values ('anon'), ('authenticated'), ('service_role')) r(role), (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)`))
      .filter((r) => r.has).map((r) => `${r.role}:${r.priv}`).sort();
    ok('6 table privileges: SELECT for anon and authenticated, nothing else for any API role (service_role included)', JSON.stringify(priv) === JSON.stringify(['anon:SELECT', 'authenticated:SELECT']), JSON.stringify(priv));
    for (const [role, claims] of [['anon', {}], ['authenticated', { sub: OWNER, role: 'authenticated', admin: 'true' }]]) {
      ok(`6 ${role} cannot insert, update or delete the link`,
        (await db.as(role, claims, `insert into public.mission_catalog_sources (catalog, organization_id, role_line) values ('x1', '${org?.id}', 'x')`)).code === '42501'
        && (await db.as(role, claims, "update public.mission_catalog_sources set state = 'shown'")).code === '42501'
        && (await db.as(role, claims, 'delete from public.mission_catalog_sources')).code === '42501');
      ok(`6 ${role} cannot execute either function`,
        (await db.as(role, claims, `select public.mission_catalog_source_owner_state('${OWNER}')`)).code === '42501'
        && (await db.as(role, claims, `select public.mission_catalog_source_command('${OWNER}', 'drawdown', 'show', 1, gen_random_uuid(), 'r', '{}')`)).code === '42501');
    }
    ok('6 service_role cannot read or write the table itself (only through the two functions)',
      (await db.as('service_role', {}, 'select * from public.mission_catalog_sources')).code === '42501'
      && (await db.as('service_role', {}, "update public.mission_catalog_sources set state = 'shown'")).code === '42501');
    const fns = (await db.query(`select p.proname, p.prosecdef, p.proconfig::text as cfg, has_function_privilege('anon', p.oid, 'execute') as anon,
      has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('service_role', p.oid, 'execute') as svc
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'mission_catalog_source%' order by 1`));
    ok('6 both functions: SECURITY DEFINER, empty search_path, executable by service_role only', fns.length === 2
      && fns.every((f) => f.prosecdef && f.cfg === '{"search_path=\\"\\""}' && !f.anon && !f.auth && f.svc), JSON.stringify(fns));
  });

  // 4. The owner's commands
  let K1 = key();
  await guard('commands', async () => {
    for (const [who, label] of [[STAFF, 'staff'], [VIEWER, 'a viewer'], [MEMBER, 'a member'], [UNKNOWN, 'an unknown account']]) {
      ok(`7 ${label} is refused (42501) and nothing is written`, (await cmd(who, 'hide', 1, key())).code === '42501' && (await auditCount(db)) === 0);
    }
    ok('7 a null actor is refused (42501)', (await cmd(null, 'hide', 1, key())).code === '42501');
    const bad = async (command, payload, extra = {}) => (await cmd(OWNER, command, 'rev' in extra ? extra.rev : 1, 'key' in extra ? extra.key : key(), payload, 'reason' in extra ? extra.reason : 'Synthetic proof reason.', extra.catalog)).code;
    ok('7 Show without the permission confirmation: 22023', (await bad('show', {})) === '22023');
    ok('7 Show with the confirmation as a string: 22023', (await bad('show', { permission_confirmed: 'true', permission_confirmed_on: '2026-11-19' })) === '22023');
    ok('7 Show with a future confirmation date: 22023', (await bad('show', { permission_confirmed: true, permission_confirmed_on: '2099-01-01' })) === '22023');
    ok('7 Show with a confirmation before 2026-11-17: 22023', (await bad('show', { permission_confirmed: true, permission_confirmed_on: '2026-11-16' })) === '22023');
    ok('7 Show with an extra key: 22023', (await bad('show', { ...CONFIRM, letter: 'x' })) === '22023');
    ok('7 Hide with a payload: 22023', (await bad('hide', { state: 'shown' })) === '22023');
    ok('7 an unknown command: 22023', (await bad('delete', {})) === '22023');
    ok('7 no key: 22023', (await bad('hide', {}, { key: null })) === '22023');
    ok('7 no revision: 22023', (await bad('hide', {}, { rev: null })) === '22023' && (await bad('hide', {}, { rev: 0 })) === '22023');
    ok('7 an empty reason, a reason over 500 characters, a reason with a control character: 22023', (await bad('hide', {}, { reason: '' })) === '22023'
      && (await bad('hide', {}, { reason: 'x'.repeat(501) })) === '22023' && (await bad('hide', {}, { reason: 'two\nlines' })) === '22023');
    ok('7 an edit with nothing to change, or another key: 22023', (await bad('edit', {})) === '22023' && (await bad('edit', { state: 'shown' })) === '22023');
    ok('7 a catalog with no source: MCS01', (await bad('hide', {}, { catalog: 'nosuch' })) === 'MCS01');
    ok('7 every refusal so far wrote no audit row', (await auditCount(db)) === 0);
    const s1 = await cmd(OWNER, 'show', 1, K1, CONFIRM);
    ok('8 the owner shows the page: shown, revision 2, one audit row', s1.ok === true && s1.state === 'shown' && s1.revision === 2 && s1.replayed === false
      && Number.isInteger(s1.audit_id) && (await auditCount(db)) === 1, JSON.stringify(s1));
    const [audit] = await db.query(`select org_id, actor_user_id, actor_kind, event, capability, resource_type, resource_id, command_id, detail from public.control_audit`);
    ok('8 the audit row: the house, the owner, mission_source.show, the key, the reason, before and after, the confirmation date only',
      audit && audit.org_id === HOUSE && audit.actor_user_id === OWNER && audit.actor_kind === 'user' && audit.event === 'mission_source.show'
      && audit.capability === 'mission_sources.manage' && audit.resource_type === 'mission_catalog_source' && audit.resource_id === 'drawdown'
      && audit.command_id === K1 && audit.detail.reason === 'Synthetic proof reason.' && audit.detail.before.state === 'draft'
      && audit.detail.after.state === 'shown' && audit.detail.permission_confirmed_on === '2026-11-19' && audit.detail.receipt.revision === 2, JSON.stringify(audit));
    const shownAt = (await db.query('select shown_at from public.mission_catalog_sources'))[0].shown_at;
    ok('8 shown_at is set on the first Show', shownAt !== null);
    ok('9 a shown page is readable: anon and a member see the link', (await readLinks('anon', {})) === 1 && (await readLinks('authenticated', { sub: MEMBER, role: 'authenticated' })) === 1);
    const s1b = await cmd(OWNER, 'show', 1, K1, CONFIRM);
    ok('10 the same key replays the receipt: same audit id, no second row', s1b.replayed === true && s1b.revision === 2 && s1b.audit_id === s1.audit_id && (await auditCount(db)) === 1, JSON.stringify(s1b));
    ok('10 the same key for another command: MCS03', (await cmd(OWNER, 'hide', 2, K1)).code === 'MCS03');
    ok('10 a revision that moved: MCS02', (await cmd(OWNER, 'hide', 1, key())).code === 'MCS02');
    const edit = async (payload) => cmd(OWNER, 'edit', 2, key(), payload);
    const refused = async (payload, constraint) => { const r = await edit(payload); return r.code === '23514' && r.constraint === constraint; };
    const missed = [];
    for (const entry of WORDS.DENY) { if (!(await refused({ role_line: sentenceFor(entry) }, 'mission_catalog_sources_words_check'))) missed.push(entry[0]); }
    ok(`11 the words check refuses every one of the ${WORDS.DENY.length} deny-list entries in the role line (23514)`, missed.length === 0, missed.join(', '));
    ok('11 and a deny word in a fact', await refused({ facts: [{ ...FACTS[0], value: 'Official partner' }], facts_read_on: '2026-11-19' }, 'mission_catalog_sources_words_check'));
    const f = (o) => ({ facts: [{ ...FACTS[0], ...o }], facts_read_on: '2026-11-19' });
    for (const [label, payload] of [['an http source', f({ source: 'http://drawdown.org/about' })], ['a tab in the source', f({ source: 'https://drawdown.org/\tabout' })],
      ['a space in the source', f({ source: 'https://drawdown.org/ about' })], ['a newline in a value', f({ value: 'two\nlines' })],
      ['a 41-character label', f({ label: 'x'.repeat(41) })], ['a control character in a label', f({ label: 'Org\u0007' })], ['an extra key', f({ icon: 'x' })],
      ['a number for a value', f({ value: 5 })], ['a fact that is not an object', { facts: ['x'], facts_read_on: '2026-11-19' }],
      ['seven facts', { facts: Array(7).fill(FACTS[0]), facts_read_on: '2026-11-19' }], ['facts that are not a list', { facts: { a: 1 }, facts_read_on: '2026-11-19' }]]) {
      ok(`12 the facts check refuses ${label} (23514)`, await refused(payload, 'mission_catalog_sources_facts_check'));
    }
    ok('12 facts without the date they were read: 22023', (await edit({ facts: [FACTS[0]] })).code === '22023');
    ok('12 a role line on two lines, of 161 characters, or empty: the role line check (23514)', await refused({ role_line: 'one\ntwo' }, 'mission_catalog_sources_role_line_check')
      && await refused({ role_line: 'x'.repeat(161) }, 'mission_catalog_sources_role_line_check') && await refused({ role_line: '' }, 'mission_catalog_sources_role_line_check'));
    ok('12 no refusal wrote an audit row', (await auditCount(db)) === 1);
    const e1 = await edit({ role_line: 'Missions written by McCluster Corp from Project Drawdown’s climate solutions, by area.', facts: [FACTS[0]], facts_read_on: '2026-11-20' });
    const [after] = await db.query("select role_line, facts, facts_read_on::text as read_on, revision from public.mission_catalog_sources");
    ok('13 a good edit: revision 3, the words and facts stored, audited with before and after', e1.ok === true && e1.revision === 3 && (await auditCount(db)) === 2
      && after.role_line.endsWith('by area.') && after.facts.length === 1 && after.read_on === '2026-11-20', JSON.stringify(e1));
    const h1 = await cmd(OWNER, 'hide', 3, key());
    ok('13 Hide: hidden, revision 4, audited, unreadable again', h1.state === 'hidden' && h1.revision === 4 && (await auditCount(db)) === 3 && (await readLinks('anon', {})) === 0);
    const st = await ownerState(OWNER);
    ok('14 the owner\'s read: the hidden source, its organization, its open missions, the history with key and audit id, never created_by',
      st.sources?.length === 1 && st.sources[0].state === 'hidden' && st.sources[0].revision === 4 && st.sources[0].organization?.slug === 'project-drawdown'
      && st.sources[0].organization?.verification_state === 'unverified' && st.sources[0].open_missions === 1 && st.history?.length === 3
      && st.history[0].key && Number.isInteger(st.history[0].audit_id) && st.history[2].permission_confirmed_on === '2026-11-19'
      && !JSON.stringify(st).includes('created_by'), JSON.stringify(st).slice(0, 300));
    for (const [who, label] of [[STAFF, 'staff'], [VIEWER, 'a viewer'], [MEMBER, 'a member'], [null, 'no actor']]) {
      ok(`14 the owner's read refuses ${label} (42501)`, (await ownerState(who)).code === '42501');
    }
    ok('15 staff and a viewer can read the audit rows (control_audit_read: the reason field says so)',
      (await db.as('authenticated', { sub: STAFF, role: 'authenticated' }, 'select id from public.control_audit')).rows?.length === 3
      && (await db.as('authenticated', { sub: VIEWER, role: 'authenticated' }, 'select id from public.control_audit')).rows?.length === 3
      && (await db.as('authenticated', { sub: MEMBER, role: 'authenticated' }, 'select id from public.control_audit')).rows?.length === 0);
  });

  // 5. The rollback
  await guard('rollback', async () => {
    // As PostgREST inserts with Prefer: return=minimal: no RETURNING. With RETURNING the read policy of authenticity_checks
    // meets production's membership read policy, which reads its own table (42P17, infinite recursion); the insert alone does not.
    const named = await db.as('authenticated', { sub: MEMBER, role: 'authenticated' },
      `insert into public.authenticity_checks (organization_id, submitted_by, submitted_by_m_uid) values ('${org?.id}', '${MEMBER}', '${MEMBER_MUID}')`, [], { commit: true });
    const namedRows = (await db.query('select count(*)::int as n from public.authenticity_checks where organization_id = $1', [org?.id]))[0].n;
    ok('16 a member can name the Project Drawdown organization in an authenticity check (production\'s insert policy)', named.ok && namedRows === 1, JSON.stringify(named));
    const held = await snapshot(db);
    const audits = await auditCount(db);
    ok('16 the rollback then refuses (55000) and changes nothing', (await attempt(rollback)) === '55000' && (await snapshot(db)) === held && (await auditCount(db)) === audits);
    const s2 = await cmd(OWNER, 'show', 4, key(), CONFIRM);
    const h2 = await cmd(OWNER, 'hide', 5, key());
    ok('16 Hide still takes the page down after the refusal', s2.state === 'shown' && h2.state === 'hidden' && (await readLinks('anon', {})) === 0);
    await db.exec('delete from public.authenticity_checks');
    await db.exec("update public.network_organizations set verification_state = 'verified' where slug = 'project-drawdown'");
    ok('17 the rollback refuses (55000) while the organization row differs from the one the forward file wrote', (await attempt(rollback)) === '55000');
    await db.exec("update public.network_organizations set verification_state = 'unverified' where slug = 'project-drawdown'");
    const keep = await auditCount(db);
    ok('18 the rollback runs', (await attempt(rollback)) === 'ok');
    ok('18 the catalog and every row are as before the forward file; the audit rows stay', (await snapshot(db)) === beforeForward && (await auditCount(db)) === keep && keep === 5,
      'snapshot differs or audit rows changed');
    ok('18 the rollback runs twice', (await attempt(rollback)) === 'ok' && (await snapshot(db)) === beforeForward);
    ok('19 after the rollback the forward file applies again', (await attempt(forward)) === 'ok'
      && (await db.query("select state, revision from public.mission_catalog_sources"))[0]?.state === 'draft');
    ok('19 and rolls back again to the same catalog', (await attempt(rollback)) === 'ok' && (await snapshot(db)) === beforeForward);
  });

  const failed = results.filter((r) => !r.pass);
  return { results, passed: results.length - failed.length, failed };
}

// ---------------------------------------------------------------- mutants: each must fail the proof
const swap = (text, from, to, label) => {
  if (!text.includes(from)) throw new Error(`mutant ${label}: the text to change is not in the file`);
  return text.split(from).join(to);
};
/** [label, mutate({ forward, rollback }) -> { forward, rollback }, the check names (prefixes) that must fail] */
export const MUTANTS = Object.freeze([
  ['no table revoke', (p) => ({ ...p, forward: swap(p.forward, 'revoke all on table public.mission_catalog_sources from public, anon, authenticated, service_role;\n', '', 'revoke') }), ['6 table privileges', '6 authenticated cannot insert']],
  ['an authenticated write grant', (p) => ({ ...p, forward: swap(p.forward, 'grant select on table public.mission_catalog_sources to anon, authenticated;', 'grant select on table public.mission_catalog_sources to anon, authenticated;\ngrant insert, update, delete on table public.mission_catalog_sources to authenticated;', 'grant') }), ['6 table privileges']],
  ['no words check', (p) => ({ ...p, forward: swap(p.forward, "  constraint mission_catalog_sources_words_check check ((role_line || ' ' || facts::text) !~* '" + WORDS.pgPattern() + "')\n", '  constraint mission_catalog_sources_fill_check check (true)\n', 'words') }), ['11 the words check']],
  ['no house check in the owner read', (p) => ({ ...p, forward: (() => { const i = p.forward.indexOf('create or replace function public.mission_catalog_source_owner_state'); const j = p.forward.indexOf('create or replace function public.mission_catalog_source_command'); return p.forward.slice(0, i) + swap(p.forward.slice(i, j), "  if house is null then raise exception 'house_owner_required' using errcode = '42501'; end if;\n", '', 'state house') + p.forward.slice(j); })() }), ['14 the owner\'s read refuses']],
  ['no house check in the command', (p) => ({ ...p, forward: (() => { const j = p.forward.indexOf('create or replace function public.mission_catalog_source_command'); return p.forward.slice(0, j) + swap(p.forward.slice(j), "  if house is null then raise exception 'house_owner_required' using errcode = '42501'; end if;\n", '', 'command house'); })() }), ['7 staff is refused']],
  ['no publish guard', (p) => ({ ...p, forward: swap(p.forward, "  if not exists (select 1 from public.action_missions m join public.action_mission_details d on d.mission_id = m.id\n                  where d.catalog = 'drawdown' and m.status = 'open') then\n    raise exception 'no Drawdown mission is open: apply the publish (release step 9) first; nothing changed' using errcode = '55000';\n  end if;\n", '', 'publish guard') }), ['1 before the publish']],
  ['no rollback refusal', (p) => ({ ...p, rollback: swap(p.rollback, "  if n_checks + n_groups + n_campaigns + n_members > 0 then", '  if false then', 'rollback refusal') }), ['16 the rollback then refuses']],
  ['on delete cascade for the link', (p) => ({ ...p, forward: swap(p.forward, 'references public.network_organizations (id) on delete restrict', 'references public.network_organizations (id) on delete cascade', 'cascade') }), ['4 the link\'s foreign key']],
  ['the source pattern back to [^ ]', (p) => ({ ...p, forward: swap(p.forward, '!(@.source like_regex "^https://[^[:space:][:cntrl:]]{4,250}$")', '!(@.source like_regex "^https://[^ ]{4,250}$")', 'source pattern') }), ['12 the facts check refuses a tab in the source']]
]);
