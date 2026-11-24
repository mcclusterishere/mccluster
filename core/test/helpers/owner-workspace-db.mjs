// Disposable SQL fixture for owner-workspace integration tests. This is a
// deliberately bounded PostgREST test adapter, never a production backend.
// Auth identities are synthetic; database permissions/RLS, owner membership,
// enrollment consumption and lease transitions execute real repository SQL.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WORKSPACE_FIXTURE_ORG = '00000000-0000-4000-8000-000000000001';
export const WORKSPACE_FIXTURE_OWNER = '00000000-0000-4000-8000-000000000003';
export const WORKSPACE_FIXTURE_MEMBER = '00000000-0000-4000-8000-000000000004';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

export async function createOwnerWorkspaceDatabase({ modulePath = process.env.PGLITE_MODULE_PATH } = {}) {
  if (!modulePath || !path.isAbsolute(modulePath)) throw new Error('Set an absolute pinned PGLITE_MODULE_PATH for the disposable database.');
  const { PGlite } = await import(pathToFileURL(modulePath));
  const { pgcrypto } = await import(pathToFileURL(path.join(path.dirname(modulePath), 'contrib/pgcrypto.js')));
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private; create schema extensions;
      create table auth.users(id uuid primary key,email text);
      create table public.orgs(id uuid primary key,slug text unique,enabled boolean not null default true);
      create table public.org_members(org_id uuid references public.orgs(id),profile_id uuid references auth.users(id),role text not null,primary key(org_id,profile_id));
      create table public.shake_crew(profile_id uuid references auth.users(id));
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
      -- No synthetic identity receives a global admin bypass in this fixture.
      create function public.eu_is_admin() returns boolean language sql stable as $$ select false; $$;
      grant usage on schema auth,private to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;
    `);
    await db.exec(read('supabase/replay_migrations/0072_org_helper_replay_foundation.sql'));
    for (const file of [
      'supabase/replay_migrations/20260912071000_compute_node_protocol.sql',
      'supabase/migrations/20260919020830_compute_gateway_hardening_live_reconcile.sql',
      'supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql',
      'supabase/migrations/20260919021013_compute_crypto_search_path_reconcile.sql',
      'supabase/migrations/20261020210718_compute_lease_authority_v2.sql',
    ]) await db.exec(read(file));
    // Exact canonical queue DDL; the remainder creates unrelated ontology tables.
    const ontology = read('supabase/migrations/20260919053445_operational_ontology_v1.sql');
    await db.exec(ontology.slice(0, ontology.indexOf('create table if not exists public.ops_ontology_types')));
    for (const file of [
      'supabase/migrations/20260919043433_operator_local_ai_chat.sql',
      'supabase/migrations/20260927222835_resident_ai_durable_vps_turn.sql',
      'supabase/pending/compute_owner_enrollment_v1.sql',
      'supabase/pending/compute_owner_workspace_v1.sql',
    ]) await db.exec(read(file));
    // Supabase's standard service-role table grants are part of the fixture's
    // baseline. Browser roles receive only the canonical migration grants.
    await db.exec('grant all on all tables in schema public to service_role;');
    await db.query("insert into public.orgs(id,slug) values($1,'mccluster')", [WORKSPACE_FIXTURE_ORG]);
    await db.query("insert into auth.users(id,email) values($1,'owner@example.invalid'),($2,'member@example.invalid')", [WORKSPACE_FIXTURE_OWNER, WORKSPACE_FIXTURE_MEMBER]);
    await db.query("insert into public.org_members(org_id,profile_id,role) values($1,$2,'owner'),($1,$3,'member')", [WORKSPACE_FIXTURE_ORG,WORKSPACE_FIXTURE_OWNER,WORKSPACE_FIXTURE_MEMBER]);
    return db;
  } catch (error) { await db.close(); throw error; }
}

const TABLES = new Set(['orgs','org_members','ops_compute_nodes','ops_compute_enrollments','ops_compute_tasks','ops_compute_leases','ops_compute_nonces','ops_compute_pairs','ops_compute_pair_reservations','ops_ai_threads','ops_ai_messages','ops_agent_jobs']);
function identifier(value) { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsupported fixture identifier'); return `"${value}"`; }
function field(value) {
  const parts = value.split('->>');
  if (parts.length === 1) return identifier(value);
  if (parts.length !== 2 || !/^[a-z][a-z0-9_]*$/.test(parts[1])) throw new Error('Unsupported fixture JSON selector');
  return `${identifier(parts[0])}->>'${parts[1]}'`;
}
function whereClause(search, values) {
  const clauses = [];
  for (const [column, raw] of search) {
    if (['select','order','limit','offset','on_conflict'].includes(column)) continue;
    const expr = field(column); let op = raw; let negate = false;
    if (op.startsWith('not.')) { negate = true; op = op.slice(4); }
    if (op === 'is.null') { clauses.push(`${expr} is ${negate ? 'not ' : ''}null`); continue; }
    if (op.startsWith('in.(') && op.endsWith(')')) {
      const items = op.slice(4,-1).split(',').filter(Boolean);
      clauses.push(items.length ? `${expr} ${negate ? 'not ' : ''}in (${items.map((item) => { values.push(item); return `$${values.length}`; }).join(',')})` : (negate ? 'true' : 'false'));
      continue;
    }
    const at = op.indexOf('.'); const name = op.slice(0,at); const value = op.slice(at+1);
    const sqlOp = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[name];
    if (!sqlOp || negate) throw new Error(`Unsupported fixture filter ${raw}`);
    values.push(value); clauses.push(`${expr} ${sqlOp} $${values.length}`);
  }
  return clauses.length ? ` where ${clauses.join(' and ')}` : '';
}
function selectClause(selection, table) {
  if (!selection || selection === '*') return '*';
  // Only the device-test receipt join is needed by the current integration.
  let relation = '';
  const match = selection.match(/,?ops_compute_leases\(([a-z_,]+)\)/);
  if (match) {
    if (table !== 'ops_compute_tasks') throw new Error('Unsupported fixture relation');
    const columns = match[1].split(','); columns.forEach(identifier);
    relation = `,(select coalesce(jsonb_agg(jsonb_build_object(${columns.map((column) => `'${column}',l.${identifier(column)}`).join(',')})),'[]'::jsonb) from public.ops_compute_leases l where l.task_id=ops_compute_tasks.id) as ops_compute_leases`;
    selection = selection.replace(match[0],'');
  }
  return selection.split(',').filter(Boolean).map(field).join(',') + relation;
}

export async function startOwnerWorkspaceRestFixture(db, {
  serviceKey = 'owner-workspace-fixture-service-key',
  users = { 'fixture-owner-session': { id: WORKSPACE_FIXTURE_OWNER, email: 'owner@example.invalid' }, 'fixture-member-session': { id: WORKSPACE_FIXTURE_MEMBER, email: 'member@example.invalid' } },
} = {}) {
  const requests = [];
  const server = http.createServer(async (req,res) => {
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://fixture.invalid');
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (url.pathname === '/auth/v1/user') return users[token] ? send(200, users[token]) : send(401, { error: 'Fixture session is missing or invalid.' });
      if (!url.pathname.startsWith('/rest/v1/')) return send(404, { error: 'Unknown fixture route.' });
      const service = req.headers.apikey === serviceKey;
      const user = users[token];
      if (!service && !user) return send(401, { error: 'Fixture authentication required.' });
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      const resource = url.pathname.slice('/rest/v1/'.length);
      // Request records keep method and resource only, never secrets or prompts.
      requests.push({ method: req.method, resource });
      const result = await db.transaction(async (tx) => {
        await tx.exec(`set local role ${service ? 'service_role' : 'authenticated'}`);
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user?.id || '']);
        if (resource.startsWith('rpc/')) {
          const fn = resource.slice(4); identifier(fn);
          if (!/^(compute_|ops_ai_)/.test(fn)) throw Object.assign(new Error('Fixture RPC is not allowed.'), { code: '42501' });
          const keys = Object.keys(input); keys.forEach(identifier);
          const { rows: definitions } = await tx.query('select p.proretset from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=\'public\' and p.proname=$1', [fn]);
          if (!definitions.length) throw Object.assign(new Error('Function is not installed in the disposable fixture.'), { code: 'PGRST202', status: 404 });
          const values = keys.map((key) => input[key] && typeof input[key] === 'object' && !Array.isArray(input[key]) ? JSON.stringify(input[key]) : input[key]);
          const call = `public.${identifier(fn)}(${keys.map((key,i) => `${identifier(key)} => $${i+1}`).join(',')})`;
          const rows = (await tx.query(definitions[0].proretset ? `select * from ${call}` : `select ${call} as result`, values)).rows;
          return definitions[0].proretset ? rows : rows[0]?.result;
        }
        if (!TABLES.has(resource)) throw Object.assign(new Error('Unknown fixture table.'), { code: 'PGRST205', status: 404 });
        const table = identifier(resource); const values = [];
        if (req.method === 'GET') {
          let sql = `select ${selectClause(url.searchParams.get('select'), resource)} from public.${table}${whereClause(url.searchParams,values)}`;
          const order = url.searchParams.get('order');
          if (order) sql += ` order by ${order.split(',').map((item) => { const [column,direction='asc'] = item.split('.'); if (!['asc','desc'].includes(direction)) throw new Error('Invalid fixture order'); return `${field(column)} ${direction}`; }).join(',')}`;
          const limit = Math.min(1000,Math.max(0,Number(url.searchParams.get('limit') || 1000)));
          sql += ` limit ${limit}`;
          return (await tx.query(sql,values)).rows;
        }
        if (req.method === 'PATCH') {
          const columns = Object.keys(input); columns.forEach(identifier);
          values.push(...columns.map((column) => input[column] && typeof input[column] === 'object' ? JSON.stringify(input[column]) : input[column]));
          const sql = `update public.${table} set ${columns.map((column,i) => `${identifier(column)}=$${i+1}`).join(',')}${whereClause(url.searchParams,values)} returning *`;
          return (await tx.query(sql,values)).rows;
        }
        if (req.method === 'POST') {
          const entries = Array.isArray(input) ? input : [input]; const written = [];
          for (const entry of entries) {
            const columns = Object.keys(entry); columns.forEach(identifier);
            const params = columns.map((column) => entry[column] && typeof entry[column] === 'object' ? JSON.stringify(entry[column]) : entry[column]);
            // PostgreSQL text[] uses its array binding, while JSONB uses JSON.
            if (resource === 'ops_compute_pairs' && columns.includes('node_ids')) params[columns.indexOf('node_ids')] = entry.node_ids;
            let sql = `insert into public.${table}(${columns.map(identifier).join(',')}) values(${columns.map((_,i) => `$${i+1}`).join(',')})`;
            const conflict = url.searchParams.get('on_conflict');
            if (conflict) {
              const conflictColumns = conflict.split(','); conflictColumns.forEach(identifier);
              sql += ` on conflict(${conflictColumns.map(identifier).join(',')}) `;
              sql += String(req.headers.prefer || '').includes('resolution=merge-duplicates') ? `do update set ${columns.filter(column=>!conflictColumns.includes(column)).map(column=>`${identifier(column)}=excluded.${identifier(column)}`).join(',')}` : 'do nothing';
            }
            sql += ' returning *'; written.push(...(await tx.query(sql,params)).rows);
          }
          return written;
        }
        throw Object.assign(new Error('Method not supported by fixture.'), { status: 405 });
      });
      send(200,result);
    } catch (error) {
      send(error.status || (error.code === '42501' ? 403 : 500), { code: error.code || 'FIXTURE_ERROR', message: error.message });
    }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, serviceKey, users, requests,
    close: async () => { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); } };
}
