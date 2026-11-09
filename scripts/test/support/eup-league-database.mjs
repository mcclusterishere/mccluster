// Isolated local PostgreSQL-compatible database for the E=Up League intake; never connects to canonical Supabase.
// Applies supabase/pending/eup_league_v1.sql plus decoy public projections (action_missions, network_groups,
// action_policy_bills) so a test can prove admin intake never lands in them.
import { readFile } from 'node:fs/promises';
import { handleEup } from '../../../workers/mccluster/src/eup/router.js';
export const OWNER = '11111111-1111-4111-8111-111111111111';
export const PEER = '22222222-2222-4222-8222-222222222222';
export const REVIEWER = '33333333-3333-4333-8333-333333333333';
const SQL = new URL('../../../supabase/pending/eup_league_v1.sql', import.meta.url);
const ROLLBACK = new URL('../../../supabase/pending/eup_league_v1.rollback.sql', import.meta.url);
export async function createLeagueDatabase() {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
    create table public.orgs(id uuid primary key,slug text);create table public.org_members(org_id uuid,profile_id uuid,role text);
    grant select on public.orgs,public.org_members to service_role;grant usage on schema auth to service_role;grant select on auth.users to service_role;
    grant usage on schema public to anon,authenticated,service_role;
    create table public.action_missions(id uuid primary key default gen_random_uuid(),title text,status text);
    create table public.network_groups(id uuid primary key default gen_random_uuid(),name text);
    create table public.action_policy_bills(id uuid primary key default gen_random_uuid(),title text);
    insert into auth.users values('${OWNER}'),('${PEER}'),('${REVIEWER}');insert into orgs values('${OWNER}','mccluster');
    insert into org_members values('${OWNER}','${OWNER}','owner'),('${OWNER}','${REVIEWER}','owner'),('${OWNER}','${PEER}','member');`);
  const apply = async () => db.exec(await readFile(SQL, 'utf8'));
  const rollback = async () => db.exec(await readFile(ROLLBACK, 'utf8'));
  await apply();
  let chain = Promise.resolve();
  const as = async (role, work) => {
    const run = chain.then(async () => { await db.exec(`set role ${role}`); try { return await work(); } finally { await db.exec('reset role'); } });
    chain = run.catch(() => {}); return run;
  };
  const rpc = (params) => as('service_role', async () => (await db.query('select public.eup_league_command($1,$2,$3,$4,$5,$6) as result',
    [params.p_action, params.p_actor, params.p_id ?? '', params.p_document ?? null, params.p_revision ?? null, params.p_key ?? null])).rows[0].result);
  const actors = { 'Bearer local-owner': OWNER, 'Bearer local-reviewer': REVIEWER };
  const handle = (request) => handleEup(request, { SUPABASE_URL: 'https://local.invalid', SUPABASE_SERVICE_ROLE_KEY: 'local-fixture-only' }, {
    requireHouseOwner: async (r) => {
      const token = r.headers.get('authorization');
      if (!token) throw Object.assign(Error('Sign in'), { status: 401 });
      if (!actors[token]) throw Object.assign(Error('Owner required'), { status: 403 });
      return { id: actors[token] };
    },
    fetchImpl: async (url, options) => {
      if (!String(url).endsWith('/rest/v1/rpc/eup_league_command')) throw new Error(`Unexpected fixture fetch: ${url}`);
      try { return Response.json(await rpc(JSON.parse(options.body))); } catch (e) { return Response.json({ code: e.code, message: e.message }, { status: 400 }); }
    }
  });
  return { db, as, rpc, handle, apply, rollback, close: () => db.close() };
}
