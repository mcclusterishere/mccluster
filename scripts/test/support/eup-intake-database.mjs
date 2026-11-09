// Isolated PGlite database for the E=Up private intake store; never connects to canonical Supabase.
// Applies supabase/pending/eup_intake_v1.sql (twice: it must be idempotent) beside minimal stand-ins
// for the PUBLIC civic_* / action_policy_bills tables so a test can prove an admin import leaves them empty.
import { readFile } from 'node:fs/promises';
import { handleEup } from '../../../workers/mccluster/src/eup/router.js';
export const OWNER = '11111111-1111-4111-8111-111111111111';
const ROOT = new URL('../../../', import.meta.url);

export async function createEupDatabase() {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    -- public projections the intake must never write (shapes trimmed from the real migrations)
    create table public.civic_jurisdictions(id uuid primary key default gen_random_uuid(), name text, verified_at timestamptz);
    create table public.civic_offices(id uuid primary key default gen_random_uuid(), title text, verified_at timestamptz);
    create table public.civic_office_terms(id uuid primary key default gen_random_uuid(), display_name text, verified_at timestamptz);
    create table public.civic_source_registry(source_key text primary key, enabled boolean not null default false, last_checked_at timestamptz);
    create table public.action_policy_bills(id uuid primary key default gen_random_uuid(), title text);
    grant select on public.civic_jurisdictions, public.civic_offices, public.civic_office_terms, public.civic_source_registry, public.action_policy_bills to anon, authenticated, service_role;
    insert into public.civic_source_registry(source_key, enabled) values ('congress_gov', false), ('legiscan', false);`);
  const sql = await readFile(new URL('supabase/pending/eup_intake_v1.sql', ROOT), 'utf8');
  await db.exec(sql); await db.exec(sql);
  let chain = Promise.resolve();
  const asService = (work) => { const run = chain.then(async () => { await db.exec('set role service_role'); try { return await work(); } finally { await db.exec('reset role'); } }); chain = run.catch(() => {}); return run; };
  const RPC = {
    eup_sources_read: (a) => ['select public.eup_sources_read($1,$2) as r', [a.p_action, a.p_params]],
    eup_sources_command: (a) => ['select public.eup_sources_command($1,$2,$3) as r', [a.p_action, a.p_params, a.p_actor]],
    eup_civic_read: (a) => ['select public.eup_civic_read($1,$2) as r', [a.p_action, a.p_params]],
    eup_company_read: (a) => ['select public.eup_company_read($1,$2) as r', [a.p_action, a.p_params]],
    eup_intake_apply: (a) => ['select public.eup_intake_apply($1,$2,$3) as r', [a.p_source_id, a.p_kind, a.p_records]],
    eup_import_run_finish: (a) => ['select public.eup_import_run_finish($1,$2,$3,$4,$5) as r', [a.p_run_id, a.p_status, a.p_records, a.p_error, a.p_cursor]]
  };
  const rpc = (name, args) => asService(async () => { const [q, p] = RPC[name](args); return (await db.query(q, p)).rows[0].r; });
  const env = { SUPABASE_URL: 'https://local.invalid', SUPABASE_SERVICE_ROLE_KEY: 'local-fixture-only', SEC_USER_AGENT: 'McCluster fixture agent' };
  // A PostgREST stand-in: RPC posts run the real function; a civic_source_registry read answers from the stand-in table.
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(String(url));
    const m = u.pathname.match(/\/rest\/v1\/rpc\/(eup_[a-z_]+)$/);
    if (m) {
      try { return Response.json(await rpc(m[1], JSON.parse(options.body))); }
      catch (e) { return Response.json({ message: e.message, code: e.code }, { status: 400 }); }
    }
    if (u.pathname === '/rest/v1/civic_source_registry') return Response.json((await db.query('select source_key, enabled, last_checked_at from public.civic_source_registry')).rows);
    throw new Error(`unexpected fixture fetch ${u.pathname}`);
  };
  const handle = (path, init = {}) => handleEup(new Request(`https://local.invalid/v1/eup/${path}`, { headers: { authorization: 'Bearer local-owner', 'content-type': 'application/json', ...(init.headers || {}) }, ...init }), env, {
    requireHouseOwner: async (r) => {
      const token = r.headers.get('authorization');
      if (!token) throw Object.assign(Error('Sign in'), { status: 401 });
      if (token !== 'Bearer local-owner') throw Object.assign(Error('Owner required'), { status: 403 });
      return { id: OWNER };
    },
    fetchImpl, now: Date.now
  });
  const count = async (table) => (await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n;
  return { db, rpc, handle, env, fetchImpl, count, close: () => db.close() };
}
