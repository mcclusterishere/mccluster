// Isolated PGlite database for the E=Up private intake store; never connects to canonical Supabase.
// Applies supabase/pending/eup_module_policy_v1.sql first (the intake SQL calls its guards and refuses to run
// without them), then supabase/pending/eup_intake_v1.sql (twice: it must be idempotent), beside minimal
// stand-ins for the PUBLIC civic_* / action_policy_bills tables so a test can prove an admin import leaves
// them empty. Supabase DEFAULT PRIVILEGES are switched on first (every new public table, sequence and function
// is handed to anon, authenticated and service_role unless a migration takes it back), so the grants the test
// reads are the ones production would have. Then module 'intake' is installed and enabled, as the house owner
// would: without that every intake write is refused EUM01. Pass { enable: false } to stop before it.
import { readFile } from 'node:fs/promises';
import { handleEup } from '../../../workers/mccluster/src/eup/router.js';
import { OWNER, ensureHouse, applyModulePolicy, rollbackModulePolicy, enableModule, asServiceRole, MODULE_POLICY_RPC, modulePolicyRpc } from './eup-module-policy-database.mjs';
export { OWNER };
const ROOT = new URL('../../../', import.meta.url);
const INTAKE_SQL = new URL('supabase/pending/eup_intake_v1.sql', ROOT);
const INTAKE_ROLLBACK = new URL('supabase/pending/eup_intake_v1.rollback.sql', ROOT);

// The 23 intake DATA tables: each carries the <table>_module_policy statement trigger for module 'intake'.
export const INTAKE_DATA_TABLES = Object.freeze(['eup_record_snapshots',
  'eup_civic_jurisdictions', 'eup_civic_jurisdiction_relations', 'eup_civic_boundary_versions', 'eup_civic_offices',
  'eup_civic_persons', 'eup_civic_terms', 'eup_civic_committees', 'eup_civic_bills', 'eup_civic_bill_versions',
  'eup_civic_bill_actions', 'eup_civic_bill_amendments', 'eup_civic_roll_calls', 'eup_civic_election_contests',
  'eup_civic_candidacies', 'eup_civic_election_results', 'eup_company_entities', 'eup_company_identifiers',
  'eup_company_locations', 'eup_company_facts', 'eup_company_awards', 'eup_review_items', 'eup_corrections']);
// Job and source bookkeeping: no module trigger, because settlement and pause stay possible in every state.
export const INTAKE_UNGUARDED_TABLES = Object.freeze(['eup_import_runs', 'eup_source_registry_state']);
// Every function the intake file creates, by identity signature; service_role may execute them, nobody else.
export const INTAKE_FUNCTIONS = Object.freeze(['eup_check_provenance(jsonb)', 'eup_civic_read(text,jsonb)', 'eup_company_read(text,jsonb)',
  'eup_import_run_claim(text,text,integer)', 'eup_import_run_finish(uuid,text,integer,text,jsonb,text)', 'eup_import_run_release(uuid,text,text)',
  'eup_intake_apply(text,text,jsonb,bigint)', 'eup_record_snapshot(text,text,text,jsonb,jsonb)', 'eup_snapshot_immutable()',
  'eup_sources_command(text,jsonb,uuid)', 'eup_sources_read(text,jsonb)']);

// The intake RPCs and their argument names, as PostgREST would find them in its schema cache.
export const INTAKE_RPC_ARGUMENTS = Object.freeze({
  eup_sources_read: ['p_action', 'p_params'],
  eup_sources_command: ['p_action', 'p_params', 'p_actor'],
  eup_civic_read: ['p_action', 'p_params'],
  eup_company_read: ['p_action', 'p_params'],
  eup_intake_apply: ['p_source_id', 'p_kind', 'p_records', 'p_policy_revision'],
  eup_import_run_claim: ['p_worker', 'p_source_id', 'p_lease_seconds'],
  eup_import_run_release: ['p_run_id', 'p_lease', 'p_reason'],
  eup_import_run_finish: ['p_run_id', 'p_status', 'p_records', 'p_error', 'p_cursor', 'p_lease']
});
// PostgREST stand-in: RPC name -> (named arguments) -> [sql, params]; the result column is `r`. The call uses
// named notation with exactly the arguments the caller sent, as PostgREST does: an argument left out takes the
// function's default, and one the function has no default for is an error (42883 here, PGRST202 over PostgREST),
// so a default that goes missing from a signature cannot hide behind the harness.
export const INTAKE_RPC = Object.freeze(Object.fromEntries(Object.entries(INTAKE_RPC_ARGUMENTS).map(([name, known]) => [name, (args = {}) => {
  const sent = Object.keys(args).filter((k) => args[k] !== undefined);
  const unknown = sent.filter((k) => !known.includes(k));
  if (unknown.length) throw Object.assign(new Error(`Could not find the function public.${name}(${sent.join(', ')}) in the schema cache`), { code: 'PGRST202' });
  return [`select public.${name}(${sent.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, sent.map((k) => args[k])];
}])));

export async function createEupDatabase({ enable = true } = {}) {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    -- public projections the intake must never write (shapes trimmed from the real migrations)
    create table public.civic_jurisdictions(id uuid primary key default gen_random_uuid(), name text, verified_at timestamptz);
    create table public.civic_offices(id uuid primary key default gen_random_uuid(), title text, verified_at timestamptz);
    create table public.civic_office_terms(id uuid primary key default gen_random_uuid(), display_name text, verified_at timestamptz);
    create table public.civic_source_registry(source_key text primary key, enabled boolean not null default false, last_checked_at timestamptz);
    create table public.action_policy_bills(id uuid primary key default gen_random_uuid(), title text);
    grant select on public.civic_jurisdictions, public.civic_offices, public.civic_office_terms, public.civic_source_registry, public.action_policy_bills to anon, authenticated, service_role;
    insert into public.civic_source_registry(source_key, enabled) values ('congress_gov', false), ('legiscan', false);`);
  // The intake harness has no auth.users / orgs / org_members of its own: the policy needs the house and its owner.
  await ensureHouse(db, OWNER);
  await applyModulePolicy(db);
  const sql = await readFile(INTAKE_SQL, 'utf8');
  await db.exec(sql); await db.exec(sql);
  if (enable) await enableModule(db, 'intake', OWNER);
  // One RPC = one transaction as service_role, which is what one PostgREST call is: the guard's locks and the
  // reduce marker live exactly as long as the call. `service` runs several statements in one such transaction.
  const service = (work) => asServiceRole(db, work);
  const rpc = async (name, args = {}) => {
    if (Object.hasOwn(MODULE_POLICY_RPC, name)) return modulePolicyRpc(db, name, args);
    if (!Object.hasOwn(INTAKE_RPC, name)) throw new Error(`Unknown intake RPC: ${name}`);
    const [q, p] = INTAKE_RPC[name](args);
    return service(async (tx) => (await tx.query(q, p)).rows[0].r);
  };
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
  return {
    db, rpc, service, handle, env, fetchImpl, count,
    // the intake SQL and its rollback, and the policy SQL and its rollback, for apply / rollback / re-apply proofs
    apply: () => db.exec(sql), rollback: async () => db.exec(await readFile(INTAKE_ROLLBACK, 'utf8')),
    applyPolicy: () => applyModulePolicy(db), rollbackPolicy: () => rollbackModulePolicy(db),
    close: () => db.close()
  };
}
