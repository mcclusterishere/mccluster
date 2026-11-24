import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Proof for the canonical supabase/migrations/20261124164529_ai_context_workstreams_v1.sql on a disposable WASM (PGlite) or local
// native PostgreSQL. It never connects to canonical Supabase and never applies anything there.
//   PGLITE_MODULE_PATH=<pinned PGlite>/dist/index.js node scripts/ai-context-workstreams-sql-check.mjs
//   NATIVE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//     POSTGRES_MODULE_PATH=<pinned postgres>/src/index.js node scripts/ai-context-workstreams-sql-check.mjs
// Base: the roles and default privileges production has, public.orgs, public.ops_objectives, public.ops_agent_jobs
// and ai_context.decisions with the columns the replay DDL gives them (PGlite has no pgmq or pgvector, so the
// replay file itself cannot load here; only the objects this file touches are stubbed). Then: the guard on a
// database without them, apply twice, privileges, behaviour, the append-only trigger, idempotency, bounds,
// credential and transcript refusal, the resume order and caps, rollback (refused with data, then forced),
// re-apply and a second behaviour pass.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(`${root}/${file}`, 'utf8');
const PENDING = 'supabase/migrations/20261124164529_ai_context_workstreams_v1.sql';
const ROLLBACK = 'supabase/pending/ai_context_workstreams_v1.rollback.sql';

let db;
if (process.env.NATIVE_TEST_DATABASE_URL) {
  const { nativeTestDb } = await import('./native-admin-test-db.mjs');
  db = await nativeTestDb('ai_context_workstreams');
} else {
  const modulePath = process.env.PGLITE_MODULE_PATH;
  if (!modulePath || !path.isAbsolute(modulePath)) throw Error('Set PGLITE_MODULE_PATH to pinned PGlite');
  const { PGlite } = await import(pathToFileURL(modulePath));
  db = new PGlite();
}

const ORG = 'a0000000-0000-4000-8000-000000000001';
const OTHER_ORG = 'a0000000-0000-4000-8000-000000000002';
const OBJECTIVE = 'b0000000-0000-4000-8000-000000000001';
const FOREIGN_OBJECTIVE = 'b0000000-0000-4000-8000-000000000002';
const JOB = 'c0000000-0000-4000-8000-000000000001';
const ACTOR = 'd0000000-0000-4000-8000-000000000001';
const STAFF = 'd0000000-0000-4000-8000-000000000002';
const STRANGER = 'd0000000-0000-4000-8000-000000000003';
const AGENT = { actor_kind: 'agent', actor_id: 'e0000000-0000-4000-8000-000000000001', actor_source: 'test', harness: 'resident' };
const PROV = { actor_kind: 'owner', actor_id: ACTOR, actor_source: 'signed-edge', harness: 'claude-code', model_id: 'model-x', session_id: 'session-1', device: 'laptop' };
// postgres.js serializes jsonb parameters itself; passing JSON text would encode it a second time.
const J = (value) => db.native ? db.sql.json(value) : JSON.stringify(value);

let checks = 0;
async function check(name, fn) {
  try { await fn(); checks += 1; }
  catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (table) => Number((await one(`select count(*)::int as n from ${table}`)).n);
async function refused(promise, pattern, code) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), pattern);
    if (code && error.code) assert.equal(error.code, code);
    return true;
  });
}
// Every call below runs as service_role, the only role Core has. A failed statement leaves no role behind.
async function asRole(role, fn) {
  await db.exec(`set role ${role}`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const upsert = (ws, prov = PROV, org = ORG) => asRole('service_role', () => one(
  'select public.ops_ai_workstream_upsert($1::uuid,$2::jsonb,$3::jsonb) as r', [org, J(ws), J(prov)])).then((row) => row.r);
const append = (key, op, event, prov = PROV, org = ORG) => asRole('service_role', () => one(
  'select public.ops_ai_workstream_event_append($1::uuid,$2,$3,$4::jsonb,$5::jsonb) as r', [org, key, op, J(event), J(prov)])).then((row) => row.r);
const checkpoint = (ws, op = null, event = null, prov = PROV, org = ORG) => asRole('service_role', () => one(
  'select public.ops_ai_workstream_checkpoint($1::uuid,$2::jsonb,$3,$4::jsonb,$5::jsonb) as r', [org, J(ws), op, event ? J(event) : null, J(prov)])).then((row) => row.r);
const resume = (limit = 20, max = 'internal', key = null, org = ORG, actor = ACTOR) => asRole('service_role', async () => (await db.query(
  'select r from public.ops_ai_workstream_resume($1::uuid,$2,$3,$4,$5::uuid) as r', [org, limit, max, key, actor])).rows.map((row) => row.r));

// Credential-shaped samples are assembled at run time so this file never holds one (secret-scan.yml reads it).
const SECRET_SAMPLES = [
  ['gh', 'p_', 'a'.repeat(24)].join(''),
  ['github', '_pat_', 'b'.repeat(24)].join(''),
  ['sk-', 'ant-', 'c'.repeat(24)].join(''),
  ['sk-', 'proj-', 'c'.repeat(24)].join(''),
  ['sb_', 'secret_', 'd'.repeat(12)].join(''),
  ['sb', 'p_', 'e'.repeat(24)].join(''),
  ['ey', 'J', 'f'.repeat(22), '.', 'g'.repeat(22), '.', 'h'.repeat(22)].join(''),
  ['mcen', '1_', 'i'.repeat(18)].join(''),
  ['key sk', '_live_', 'j'.repeat(18)].join(''),
  ['wh', 'sec_', 'k'.repeat(18)].join(''),
  ['AK', 'IA', 'L'.repeat(16)].join(''),
  ['xo', 'xb-', 'm'.repeat(12)].join(''),
  ['AI', 'za', 'n'.repeat(35)].join(''),
  ['-----BEGIN RSA ', 'PRIVATE KEY', '-----'].join(''),
  // The shapes added after review: the workflow's Twilio account SID, a legacy sk- key, and three matched in any case.
  ['A', 'C', '0123456789abcdef'.repeat(2)].join(''),
  ['s', 'k-', 'q'.repeat(48)].join(''),
  ['-----begin rsa ', 'private key', '-----'].join(''),
  ['Authorization: Bea', 'rer ', 'r'.repeat(40)].join(''),
  ['postgres', '://', 'app', ':', 'pw-123456', '@', 'db.example/main'].join('')
];
const TRANSCRIPT = 'user: do the thing\nassistant: done\nuser: and the other thing';

async function base() {
  await db.exec(`
    do $$ begin create role anon; create role authenticated; create role service_role;
    exception when duplicate_object then null; end $$;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table public.orgs(id uuid primary key, slug text not null, enabled boolean not null default true);
    create table public.org_members(org_id uuid not null references public.orgs(id) on delete cascade, profile_id uuid not null, role text not null default 'staff' check (role in ('owner', 'staff', 'viewer')), added_at timestamptz not null default now(), primary key (org_id, profile_id));
    create table public.ops_objectives(id uuid primary key default gen_random_uuid(), org_id uuid not null, name text not null, status text not null default 'active');
    create table public.ops_agent_jobs(id uuid primary key default gen_random_uuid(), org_id uuid not null, job_type text not null, status text not null default 'queued');
    create schema ai_context;
    revoke all on schema ai_context from public, anon, authenticated;
    grant usage on schema ai_context to service_role;
    create table ai_context.decisions (
      id uuid primary key default gen_random_uuid(), org_id uuid not null, title text not null, decision text not null,
      rationale_summary text, risk_class text not null default 'low', status text not null default 'proposed',
      proposed_by text, approved_by uuid, approved_at timestamptz, source_conversation_id uuid,
      source_message_ids uuid[] not null default '{}'::uuid[], supersedes_id uuid references ai_context.decisions(id) on delete set null,
      metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    alter table ai_context.decisions enable row level security;
    revoke all on ai_context.decisions from public, anon, authenticated, service_role;
    create unique index decisions_actor_idempotency_v2 on ai_context.decisions (org_id, proposed_by, (metadata->>'idempotency_key')) where metadata ? 'idempotency_key';
    insert into public.orgs(id, slug, enabled) values ('${ORG}', 'mccluster', true), ('${OTHER_ORG}', 'tenant', true);
    insert into public.org_members(org_id, profile_id, role) values ('${ORG}', '${ACTOR}', 'owner'), ('${ORG}', '${STAFF}', 'staff'), ('${OTHER_ORG}', '${STRANGER}', 'owner');
    insert into public.ops_objectives(id, org_id, name) values ('${OBJECTIVE}', '${ORG}', 'Durable context'), ('${FOREIGN_OBJECTIVE}', '${OTHER_ORG}', 'Not ours');
    insert into public.ops_agent_jobs(id, org_id, job_type) values ('${JOB}', '${ORG}', 'repo_health');
  `);
}

async function privileges() {
  const tables = ['ai_context.workstreams', 'ai_context.workstream_events'];
  for (const table of tables) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const privilege of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
        await check(`${role} holds no ${privilege} on ${table}`, async () => {
          assert.equal((await one('select has_table_privilege($1,$2,$3) as ok', [role, table, privilege])).ok, false);
        });
      }
    }
    await check(`${table} has RLS on and no policy`, async () => {
      const row = await one("select c.relrowsecurity as rls, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies from pg_class c where c.oid = $1::regclass", [table]);
      assert.equal(row.rls, true); assert.equal(row.policies, 0);
    });
  }
  const functions = (await db.query(`
    select n.nspname as schema, p.proname as name, p.oid::regprocedure::text as signature, p.prosecdef as definer, p.proconfig as config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname like 'ops_ai_workstream_%') or (n.nspname = 'ai_context' and p.proname like 'workstream_%')
    order by 1, 2`)).rows;
  const rpcs = functions.filter((fn) => fn.schema === 'public');
  const helpers = functions.filter((fn) => fn.schema === 'ai_context');
  await check('exactly the four RPCs and fourteen helpers exist', async () => {
    assert.deepEqual(rpcs.map((fn) => fn.name), ['ops_ai_workstream_checkpoint', 'ops_ai_workstream_event_append', 'ops_ai_workstream_resume', 'ops_ai_workstream_upsert']);
    assert.equal(helpers.length, 14);
  });
  for (const fn of rpcs) {
    await check(`${fn.name} is SECURITY DEFINER with an empty search_path`, async () => {
      assert.equal(fn.definer, true);
      assert.ok((fn.config || []).some((entry) => /^search_path=("")?$/.test(entry)), `search_path not pinned: ${fn.config}`);
    });
    await check(`${fn.name} is executable by service_role only`, async () => {
      for (const [role, expected] of [['service_role', true], ['anon', false], ['authenticated', false], ['public', false]]) {
        assert.equal((await one('select has_function_privilege($1,$2,$3) as ok', [role, fn.signature, 'execute'])).ok, expected, `${role}`);
      }
    });
  }
  for (const fn of helpers) {
    await check(`${fn.name} pins search_path and no client or service role may call it`, async () => {
      assert.ok((fn.config || []).some((entry) => /^search_path=("")?$/.test(entry)), `search_path not pinned: ${fn.config}`);
      for (const role of ['service_role', 'anon', 'authenticated', 'public']) {
        assert.equal((await one('select has_function_privilege($1,$2,$3) as ok', [role, fn.signature, 'execute'])).ok, false, `${role}`);
      }
    });
  }
  await check('service_role cannot read or write either table directly', async () => {
    await refused(asRole('service_role', () => db.query('select * from ai_context.workstreams')), /permission denied/);
    await refused(asRole('service_role', () => db.query("insert into ai_context.workstream_events(org_id) values (gen_random_uuid())")), /permission denied/);
  });
  await check('anon and authenticated cannot call the RPCs', async () => {
    for (const role of ['anon', 'authenticated']) {
      await refused(asRole(role, () => db.query('select public.ops_ai_workstream_resume($1::uuid)', [ORG])), /permission denied/);
      await refused(asRole(role, () => db.query("select public.ops_ai_workstream_checkpoint($1::uuid,'{}'::jsonb)", [ORG])), /permission denied/);
    }
  });
}

async function behaviour(tag) {
  const k = (name) => `${tag}-${name}`;
  await check('an organization that is not the house is refused', async () => {
    await refused(upsert({ id: k('x'), title: 't', goal: 'g' }, PROV, OTHER_ORG), /outside Core authority/, '42501');
    await refused(resume(20, 'internal', null, OTHER_ORG), /outside Core authority/, '42501');
    await refused(append(k('x'), 'op-other', { kind: 'note', text: 'n' }, PROV, OTHER_ORG), /outside Core authority/, '42501');
  });
  await check('an empty plane resumes to zero rows, not an error', async () => {
    assert.deepEqual(await resume(20, 'internal', k('nothing')), []);
  });

  /* ---- workstream upsert ---- */
  await check('a new workstream needs a title and a goal', async () => {
    await refused(upsert({ id: k('a') }), /workstream\.title is required/);
    await refused(upsert({ id: k('a'), title: 'T' }), /workstream\.goal is required/);
  });
  await check('a bad id, an unknown field, a wrong schema, a bad status and a bad sensitivity are refused', async () => {
    await refused(upsert({ id: 'Bad Id', title: 't', goal: 'g' }), /workstream id must match/);
    await refused(upsert({ id: k('a'), title: 't', goal: 'g', transcript: 'x' }), /unknown field/);
    await refused(upsert({ schema: 'other/9', id: k('a'), title: 't', goal: 'g' }), /mccluster-workstream\/1/);
    await refused(upsert({ id: k('a'), title: 't', goal: 'g', status: 'someday' }), /status must be/);
    await refused(upsert({ id: k('a'), title: 't', goal: 'g', sensitivity: 'secret' }), /sensitivity must be/);
  });
  await check('provenance is required and bounded', async () => {
    await refused(upsert({ id: k('a'), title: 't', goal: 'g' }, {}), /provenance\.actor_kind is required/);
    await refused(upsert({ id: k('a'), title: 't', goal: 'g' }, { actor_kind: 'owner' }), /provenance\.actor_id is required/);
    await refused(upsert({ id: k('a'), title: 't', goal: 'g' }, { actor_kind: 'visitor', actor_id: 'x' }), /owner, agent or service/);
    await refused(upsert({ id: k('a'), title: 't', goal: 'g' }, { ...PROV, harness: 'h'.repeat(81) }), /provenance\.harness exceeds 80/);
    await refused(upsert({ id: k('a'), title: 't', goal: 'g' }, { ...PROV, transcript: 'x' }), /unknown field/);
  });
  let created;
  await check('a local mccluster-workstream/1 file is accepted unchanged', async () => {
    created = await upsert({
      schema: 'mccluster-workstream/1', id: k('a'), title: 'Durable context', goal: 'Work state survives a context window',
      status: 'active', branch: 'prime/durable-context', head: 'b51ede03', pr: '#1', worktree: 'mccluster-context',
      next: 'write the SQL', created_at: '2026-11-21T10:00:00.000Z', updated_at: '2026-11-22T10:00:00.000Z'
    });
    assert.equal(created.applied, true); assert.equal(created.created, true); assert.equal(created.stale, false);
    const ws = created.workstream;
    assert.equal(ws.schema, 'mccluster-workstream/1'); assert.equal(ws.id, k('a')); assert.equal(ws.next, 'write the SQL');
    assert.equal(ws.status, 'active'); assert.equal(ws.sensitivity, 'internal'); assert.deepEqual(ws.job_ids, []);
    assert.equal(new Date(ws.created_at).toISOString(), '2026-11-21T10:00:00.000Z');
    assert.equal(new Date(ws.updated_at).toISOString(), '2026-11-22T10:00:00.000Z');
    assert.equal(ws.provenance.actor_id, ACTOR); assert.equal(ws.provenance.harness, 'claude-code');
    assert.equal(ws.provenance.model_id, 'model-x'); assert.equal(ws.provenance.session_id, 'session-1'); assert.equal(ws.provenance.device, 'laptop');
  });
  await check('a merge keeps what it does not name and clears an optional field sent empty', async () => {
    const merged = (await upsert({ id: k('a'), next: 'run the check', pr: '' })).workstream;
    assert.equal(merged.title, 'Durable context'); assert.equal(merged.branch, 'prime/durable-context');
    assert.equal(merged.next, 'run the check'); assert.equal(Object.hasOwn(merged, 'pr'), false);
    await refused(upsert({ id: k('a'), title: '  ' }), /workstream\.title is required/);
  });
  await check('an older file never overwrites a newer checkpoint', async () => {
    const stale = await upsert({ id: k('a'), next: 'OLD', updated_at: '2026-11-20T00:00:00Z' });
    assert.equal(stale.applied, false); assert.equal(stale.stale, true); assert.equal(stale.workstream.next, 'run the check');
  });
  await check('a timestamp must parse and may not be in the future', async () => {
    await refused(upsert({ id: k('a'), updated_at: 'yesterday' }), /not an ISO timestamp/);
    await refused(upsert({ id: k('a'), updated_at: '2026-11-22 10:00:00' }), /not an ISO timestamp/);
    await refused(upsert({ id: k('a'), updated_at: '2026-13-45T10:00:00Z' }), /not an ISO timestamp/);
    await refused(upsert({ id: k('a'), updated_at: '2999-01-01T00:00:00Z' }), /in the future/);
  });
  await check('every text field is bounded', async () => {
    for (const [field, max] of [['title', 200], ['goal', 2000], ['branch', 200], ['head', 80], ['pr', 300], ['worktree', 300], ['next', 2000]]) {
      await refused(upsert({ id: k('a'), [field]: 'x'.repeat(max + 1) }), new RegExp(`workstream\\.${field} exceeds ${max}`), '22001');
      assert.equal((await upsert({ id: k('bound'), title: 't', goal: 'g', [field]: 'x'.repeat(max) })).applied, true, `${field} at the bound`);
    }
  });
  await check('credential-looking text is refused in every workstream field', async () => {
    for (const sample of SECRET_SAMPLES) {
      for (const field of ['title', 'goal', 'branch', 'head', 'pr', 'worktree', 'next']) {
        if (sample.length > 80 && field === 'head') continue;
        await refused(upsert({ id: k('a'), [field]: `see ${sample}` }), /looks like a credential/, '22023');
      }
    }
    assert.equal((await upsert({ id: k('a') })).workstream.next, 'run the check', 'nothing was written by a refused call');
  });
  await check('a pasted transcript is refused', async () => {
    await refused(upsert({ id: k('a'), goal: TRANSCRIPT }), /looks like a raw transcript/);
  });
  await check('objective and job links must exist for this organization and are stored as ids only', async () => {
    await refused(upsert({ id: k('a'), objective_id: 'not-a-uuid' }), /must be a UUID/);
    await refused(upsert({ id: k('a'), objective_id: FOREIGN_OBJECTIVE }), /not an objective of this organization/, '23503');
    await refused(upsert({ id: k('a'), job_ids: [OBJECTIVE] }), /names a job this organization does not have/, '23503');
    await refused(upsert({ id: k('a'), job_ids: Array.from({ length: 21 }, () => JOB) }), /at most 20/);
    const linked = (await upsert({ id: k('a'), objective_id: OBJECTIVE, job_ids: [JOB] })).workstream;
    assert.equal(linked.objective_id, OBJECTIVE); assert.deepEqual(linked.job_ids, [JOB]);
    const columns = (await db.query("select column_name from information_schema.columns where table_schema='ai_context' and table_name='workstreams'")).rows.map((r) => r.column_name);
    for (const copied of ['objective_name', 'objective_status', 'job_status', 'job_type']) assert.equal(columns.includes(copied), false);
  });

  /* ---- events ---- */
  let first;
  await check('an event is appended with its provenance', async () => {
    first = await append(k('a'), k('op-1'), { at: '2026-11-22T11:00:00.000Z', kind: 'verified', text: 'SQL check passes', evidence: 'scripts/ai-context-workstreams-sql-check.mjs', by: 'claude-code', job_id: JOB, objective_id: OBJECTIVE });
    assert.equal(first.appended, true); assert.equal(first.replayed, false);
    const ev = first.event;
    assert.equal(ev.kind, 'verified'); assert.equal(ev.text, 'SQL check passes'); assert.equal(ev.by, 'claude-code');
    assert.equal(ev.operation_key, k('op-1')); assert.equal(ev.job_id, JOB); assert.equal(ev.objective_id, OBJECTIVE);
    assert.equal(new Date(ev.at).toISOString(), '2026-11-22T11:00:00.000Z');
    assert.deepEqual(ev.provenance, PROV);
    assert.equal(ev.sensitivity, 'internal');
  });
  await check('replaying the same operation key returns the stored event and writes nothing', async () => {
    const before = await count('ai_context.workstream_events');
    const again = await append(k('a'), k('op-1'), { at: '2026-11-22T11:00:00.000Z', kind: 'verified', text: '  SQL check passes  ', evidence: 'scripts/ai-context-workstreams-sql-check.mjs', by: 'claude-code', job_id: JOB, objective_id: OBJECTIVE });
    assert.equal(again.appended, false); assert.equal(again.replayed, true);
    assert.equal(again.event.event_id, first.event.event_id);
    assert.equal(await count('ai_context.workstream_events'), before);
  });
  await check('naming a workstream, or replaying its events, never moves its own time', async () => {
    const stamp = async () => one('select source_updated_at::text as s, updated_at::text as u from ai_context.workstreams where workstream_key = $1', [k('a')]);
    const before = await stamp();
    const named = await upsert({ schema: 'mccluster-workstream/1', id: k('a') });
    assert.equal(named.applied, false); assert.equal(named.stale, false); assert.equal(named.created, false);
    const replay = await checkpoint({ id: k('a') }, k('op-1'), { at: '2026-11-22T11:00:00.000Z', kind: 'verified', text: 'SQL check passes', evidence: 'scripts/ai-context-workstreams-sql-check.mjs', by: 'claude-code', job_id: JOB, objective_id: OBJECTIVE });
    assert.equal(replay.event.replayed, true); assert.equal(replay.workstream.applied, false);
    assert.deepEqual(await stamp(), before);
  });
  await check('the same operation key with different content is refused', async () => {
    await refused(append(k('a'), k('op-1'), { at: '2026-11-22T11:00:00.000Z', kind: 'verified', text: 'something else' }), /already used for a different checkpoint/, '23505');
    await upsert({ id: k('other'), title: 't', goal: 'g' });
    await refused(append(k('other'), k('op-1'), { at: '2026-11-22T11:00:00.000Z', kind: 'verified', text: 'SQL check passes', evidence: 'scripts/ai-context-workstreams-sql-check.mjs', by: 'claude-code' }), /already used for a different checkpoint/, '23505');
  });
  await check('an event without a client time is replayable under its key', async () => {
    const live = await append(k('a'), k('op-live'), { kind: 'note', text: 'no client clock' });
    const again = await append(k('a'), k('op-live'), { kind: 'note', text: 'no client clock' });
    assert.equal(again.replayed, true); assert.equal(again.event.event_id, live.event.event_id);
  });
  await check('a bad operation key, kind, field, time or workstream is refused', async () => {
    await refused(append(k('a'), 'has space', { kind: 'note', text: 'n' }), /operation_key must match/);
    await refused(append(k('a'), null, { kind: 'note', text: 'n' }), /operation_key must match/);
    await refused(append(k('a'), 'k'.repeat(201), { kind: 'note', text: 'n' }), /operation_key must match/);
    await refused(append(k('a'), k('op-bad'), { kind: 'gossip', text: 'n' }), /event kind must be/);
    await refused(append(k('a'), k('op-bad'), { kind: 'note' }), /event\.text is required/);
    await refused(append(k('a'), k('op-bad'), { kind: 'note', text: 'n', raw: 'x' }), /unknown field/);
    await refused(append(k('a'), k('op-bad'), { kind: 'note', text: 'n', at: '2999-01-01T00:00:00Z' }), /in the future/);
    await refused(append(k('missing'), k('op-bad'), { kind: 'note', text: 'n' }), /unknown workstream/);
    await refused(append(k('a'), k('op-bad'), { kind: 'note', text: 'n', job_id: OBJECTIVE }), /not a job of this organization/, '23503');
    await refused(append(k('a'), k('op-bad'), { kind: 'note', text: 'n', objective_id: FOREIGN_OBJECTIVE }), /not an objective of this organization/, '23503');
  });
  await check('event text, evidence and by are bounded', async () => {
    await refused(append(k('a'), k('op-bad'), { kind: 'note', text: 'x'.repeat(4001) }), /event\.text exceeds 4000/, '22001');
    await refused(append(k('a'), k('op-bad'), { kind: 'note', text: 'n', evidence: 'x'.repeat(1001) }), /event\.evidence exceeds 1000/, '22001');
    await refused(append(k('a'), k('op-bad'), { kind: 'note', text: 'n', by: 'x'.repeat(201) }), /event\.by exceeds 200/, '22001');
    assert.equal((await append(k('a'), k('op-max'), { at: '2026-11-22T11:00:01Z', kind: 'note', text: 'x'.repeat(4000), evidence: 'e'.repeat(1000), by: 'b'.repeat(200) })).appended, true);
  });
  await check('credential-looking and transcript-looking event text is refused, and nothing is stored', async () => {
    const before = await count('ai_context.workstream_events');
    for (const sample of SECRET_SAMPLES) {
      await refused(append(k('a'), k('op-secret'), { kind: 'note', text: `token ${sample}` }), /looks like a credential/, '22023');
      await refused(append(k('a'), k('op-secret'), { kind: 'note', text: 'n', evidence: sample }), /looks like a credential/, '22023');
      await refused(append(k('a'), k('op-secret'), { kind: 'note', text: 'n', by: sample }), /looks like a credential/, '22023');
    }
    await refused(append(k('a'), k('op-secret'), { kind: 'note', text: TRANSCRIPT }), /looks like a raw transcript/);
    assert.equal(await count('ai_context.workstream_events'), before);
  });
  await check('the table itself refuses a credential, whoever inserts it', async () => {
    const ws = (await one('select id from ai_context.workstreams where workstream_key = $1', [k('a')])).id;
    await refused(db.query(
      "insert into ai_context.workstream_events(org_id, workstream_id, operation_key, kind, body, occurred_at, actor_kind, actor_id, content_hash) values ($1,$2,$3,'note',$4,now(),'owner','x',repeat('0',64))",
      [ORG, ws, k('op-direct'), SECRET_SAMPLES[0]]), /check constraint/);
  });

  /* ---- decisions ---- */
  let decided;
  await check('an owner decision proposes one ai_context.decisions row, never an approved one', async () => {
    decided = await append(k('a'), k('op-dec-1'), { at: '2026-11-22T12:00:00Z', kind: 'decision', text: 'Checkpoints live in ai_context', by: 'owner',
      decision: { title: 'Workstreams live in ai_context', rationale_summary: 'One private context plane', risk_class: 'medium' } });
    assert.equal(decided.decision_created, true);
    const row = await one('select * from ai_context.decisions where id = $1', [decided.event.decision_id]);
    assert.equal(row.status, 'proposed'); assert.equal(row.approved_by, null); assert.equal(row.approved_at, null);
    assert.equal(row.risk_class, 'medium'); assert.equal(row.proposed_by, ACTOR); assert.equal(row.org_id, ORG);
    assert.equal(row.decision, 'Checkpoints live in ai_context');
    assert.equal(row.metadata.ingress, 'workstream-checkpoint'); assert.equal(row.metadata.workstream_key, k('a'));
    assert.equal(row.metadata.operation_key, k('op-dec-1')); assert.equal(row.metadata.provenance.harness, 'claude-code');
  });
  await check('replaying a decision checkpoint creates no second decision', async () => {
    const before = await count('ai_context.decisions');
    const again = await append(k('a'), k('op-dec-1'), { at: '2026-11-22T12:00:00Z', kind: 'decision', text: 'Checkpoints live in ai_context', by: 'owner',
      decision: { title: 'Workstreams live in ai_context', rationale_summary: 'One private context plane', risk_class: 'medium' } });
    assert.equal(again.replayed, true); assert.equal(again.decision_created, false);
    assert.equal(again.event.decision_id, decided.event.decision_id);
    assert.equal(await count('ai_context.decisions'), before);
  });
  await check('a decision event may reference an existing decision, and only an existing one of this organization', async () => {
    const linked = await append(k('a'), k('op-dec-2'), { at: '2026-11-22T12:01:00Z', kind: 'decision', text: 'As decided', decision_id: decided.event.decision_id });
    assert.equal(linked.event.decision_id, decided.event.decision_id); assert.equal(linked.decision_created, false);
    await refused(append(k('a'), k('op-dec-3'), { kind: 'decision', text: 'x', decision_id: OBJECTIVE }), /not a decision of this organization/, '23503');
    await refused(append(k('a'), k('op-dec-3'), { kind: 'note', text: 'x', decision_id: decided.event.decision_id }), /only a decision event/);
    await refused(append(k('a'), k('op-dec-3'), { kind: 'decision', text: 'x', decision_id: decided.event.decision_id, decision: { title: 't' } }), /not both/);
    await refused(append(k('a'), k('op-dec-3'), { kind: 'decision', text: 'x', decision: { title: 't', risk_class: 'wild' } }), /risk_class must be/);
    await refused(append(k('a'), k('op-dec-3'), { kind: 'decision', text: 'x', decision: { title: 't', status: 'approved' } }), /unknown field/);
    await refused(append(k('a'), k('op-dec-3'), { kind: 'decision', text: 'x', decision: {} }), /event\.decision\.title is required/);
  });
  await check('a refused decision checkpoint leaves no orphan decision behind', async () => {
    const before = await count('ai_context.decisions');
    await refused(append(k('a'), k('op-dec-4'), { kind: 'decision', text: 'x', job_id: OBJECTIVE, decision: { title: 't' } }), /not a job/);
    await refused(append(k('a'), k('op-dec-4'), { kind: 'decision', text: 'x', decision: { title: `t ${SECRET_SAMPLES[0]}` } }), /looks like a credential/);
    assert.equal(await count('ai_context.decisions'), before);
  });

  /* ---- append-only ---- */
  await check('events cannot be updated, deleted or truncated, even by the owner role', async () => {
    await refused(db.query("update ai_context.workstream_events set body = 'rewritten' where operation_key = $1", [k('op-1')]), /append-only: UPDATE refused/, '55000');
    await refused(db.query('delete from ai_context.workstream_events where operation_key = $1', [k('op-1')]), /append-only: DELETE refused/, '55000');
    await refused(db.query('truncate ai_context.workstream_events'), /append-only: TRUNCATE refused/, '55000');
    await refused(db.query('delete from ai_context.workstreams where workstream_key = $1', [k('a')]), /foreign key constraint "workstream_events_workstream_id_fkey"/);
    assert.equal((await one('select body from ai_context.workstream_events where operation_key = $1', [k('op-1')])).body, 'SQL check passes');
  });

  /* ---- checkpoint: set + event in one transaction ---- */
  await check('checkpoint writes the workstream and the event together', async () => {
    const result = await checkpoint({ id: k('b'), title: 'Blocked stream', goal: 'Show a blocker', status: 'blocked', updated_at: '2026-11-22T09:00:00Z' },
      k('op-b-1'), { at: '2026-11-22T09:30:00Z', kind: 'blocker', text: 'waiting on the owner' });
    assert.equal(result.schema, 'mccluster-workstream-checkpoint/1');
    assert.equal(result.workstream.created, true); assert.equal(result.event.appended, true);
    assert.equal(new Date(result.workstream.workstream.updated_at).toISOString(), '2026-11-22T09:30:00.000Z', 'the event moves the workstream forward');
  });
  await check('checkpoint is all or nothing', async () => {
    const before = await count('ai_context.workstreams');
    await refused(checkpoint({ id: k('never'), title: 't', goal: 'g' }, k('op-never'), { kind: 'gossip', text: 'x' }), /event kind must be/);
    await refused(checkpoint({ id: k('never'), title: 't', goal: 'g' }, null, { kind: 'note', text: 'x' }), /operation_key must match/);
    assert.equal(await count('ai_context.workstreams'), before);
    const only = await checkpoint({ id: k('a'), next: 'ship it' });
    assert.equal(only.event, null); assert.equal(only.workstream.workstream.next, 'ship it');
  });

  /* ---- resume ---- */
  await check('resume orders active, blocked, parked, done and newest first inside a status', async () => {
    await upsert({ id: k('done'), title: 'Finished', goal: 'g', status: 'done', updated_at: '2026-11-22T23:00:00Z' });
    await upsert({ id: k('parked'), title: 'Parked', goal: 'g', status: 'parked', updated_at: '2026-11-22T22:00:00Z' });
    await upsert({ id: k('old-active'), title: 'Old active', goal: 'g', status: 'active', updated_at: '2026-11-01T00:00:00Z' });
    const rows = (await resume(50)).filter((row) => row.id.startsWith(`${tag}-`));
    const statuses = rows.map((row) => row.status);
    assert.deepEqual(statuses, [...statuses].sort((x, y) => ['active', 'blocked', 'parked', 'done'].indexOf(x) - ['active', 'blocked', 'parked', 'done'].indexOf(y)));
    const active = rows.filter((row) => row.status === 'active');
    assert.equal(active.at(-1).id, k('old-active'));
    for (let i = 1; i < active.length; i += 1) assert.ok(new Date(active[i - 1].updated_at) >= new Date(active[i].updated_at));
    assert.equal(rows.at(-1).id, k('done'));
    assert.equal(rows[0].total, (await resume(50)).length, 'every row carries the unbounded total');
  });
  await check('resume is bounded: the limit is clamped and the total still says how many exist', async () => {
    const all = await resume(50);
    const two = await resume(2);
    assert.equal(two.length, 2); assert.equal(two[0].total, all.length);
    assert.equal((await resume(0)).length, 1, 'a limit below 1 is 1');
    assert.equal((await resume(100000)).length, Math.min(50, all.length), 'a limit above 50 is 50');
    assert.deepEqual(two.map((row) => row.id), all.slice(0, 2).map((row) => row.id));
  });
  await check('resume keeps the reference proportions per kind, oldest first, with text cut for the packet', async () => {
    await upsert({ id: k('busy'), title: 'Busy', goal: 'g' });
    for (let i = 0; i < 10; i += 1) {
      const at = `2026-11-22T13:${String(i).padStart(2, '0')}:00Z`;
      await append(k('busy'), k(`d-${i}`), { at, kind: 'decision', text: `decision ${i}` });
      await append(k('busy'), k(`v-${i}`), { at, kind: 'verified', text: `verified ${i}` });
      await append(k('busy'), k(`o-${i}`), { at, kind: 'open', text: `open ${i}` });
      await append(k('busy'), k(`f-${i}`), { at, kind: 'done', text: `done ${i}` });
      await append(k('busy'), k(`n-${i}`), { at, kind: 'note', text: `note ${i}` });
    }
    await append(k('busy'), k('long'), { at: '2026-11-22T13:30:00Z', kind: 'verified', text: 'y'.repeat(3000) });
    const [row] = await resume(1, 'internal', k('busy'));
    const by = (kind) => row.events.filter((event) => event.kind === kind);
    assert.deepEqual(by('decision').map((event) => event.text), [2, 3, 4, 5, 6, 7, 8, 9].map((i) => `decision ${i}`));
    assert.equal(by('verified').length, 6); assert.equal(by('open').length, 8); assert.equal(by('done').length, 5);
    assert.equal(by('note').length, 0); assert.equal(by('unblocked').length, 0);
    assert.equal(row.event_count, 51);
    const long = by('verified').at(-1);
    assert.equal(long.text.length, 1200); assert.equal(long.text_truncated, true);
    assert.equal((await one('select length(body)::int as n from ai_context.workstream_events where operation_key = $1', [k('long')])).n, 3000, 'the stored text is whole');
    const times = row.events.map((event) => new Date(event.at).getTime());
    assert.deepEqual(times, [...times].sort((x, y) => x - y));
  });
  await check('a blocker stays until something clears it', async () => {
    let [row] = await resume(1, 'internal', k('b'));
    assert.deepEqual(row.events.filter((event) => event.kind === 'blocker').map((event) => event.text), ['waiting on the owner']);
    await append(k('b'), k('op-b-2'), { at: '2026-11-22T09:40:00Z', kind: 'unblocked', text: 'owner answered' });
    await append(k('b'), k('op-b-3'), { at: '2026-11-22T09:50:00Z', kind: 'blocker', text: 'second blocker' });
    [row] = await resume(1, 'internal', k('b'));
    assert.deepEqual(row.events.filter((event) => event.kind === 'blocker').map((event) => event.text), ['second blocker']);
  });
  await check('a finished workstream keeps one decision, one verified and one done', async () => {
    await upsert({ id: k('busy'), status: 'done' });
    const [row] = await resume(1, 'internal', k('busy'));
    assert.deepEqual(row.events.map((event) => event.kind).sort(), ['decision', 'done', 'verified']);
    assert.equal(row.events.find((event) => event.kind === 'decision').text, 'decision 9');
    await upsert({ id: k('busy'), status: 'active' });
  });
  await check('a workstream above the sensitivity ceiling is a stub, not a gap; its events are counted, not shown', async () => {
    await upsert({ id: k('private'), title: 'Private title', goal: 'Private goal', sensitivity: 'restricted' });
    await append(k('private'), k('p-1'), { kind: 'note', text: 'private note' });
    await append(k('a'), k('conf-1'), { at: '2026-11-22T12:30:00Z', kind: 'decision', text: 'confidential decision', sensitivity: 'confidential' });
    const [stub] = await resume(1, 'internal', k('private'));
    assert.equal(stub.withheld, true); assert.equal(stub.id, k('private')); assert.equal(stub.sensitivity, 'restricted');
    for (const hidden of ['title', 'goal', 'next', 'events', 'provenance']) assert.equal(Object.hasOwn(stub, hidden), false, hidden);
    const [open] = await resume(1, 'restricted', k('private'));
    assert.equal(open.withheld, false); assert.equal(open.title, 'Private title');
    const [a] = await resume(1, 'internal', k('a'));
    assert.equal(a.events.some((event) => event.text === 'confidential decision'), false);
    assert.equal(a.events_withheld, 1);
    const [aAll] = await resume(1, 'confidential', k('a'));
    assert.equal(aAll.events.some((event) => event.text === 'confidential decision'), true);
    await refused(resume(1, 'everything'), /sensitivity must be/);
    await refused(resume(1, 'internal', 'Bad Key'), /workstream id must match/);
  });
  await check('an event inherits the sensitivity of its workstream unless it says otherwise', async () => {
    assert.equal((await one('select sensitivity from ai_context.workstream_events where operation_key = $1', [k('p-1')])).sensitivity, 'restricted');
  });

  /* ---- who the actor is: decided by the database, not by the caller ---- */
  await check('an owner actor must be an owner member of this organization', async () => {
    const before = [await count('ai_context.workstreams'), await count('ai_context.workstream_events'), await count('ai_context.decisions')];
    for (const forged of [STRANGER, STAFF, 'f0000000-0000-4000-8000-00000000dead']) {
      const prov = { ...PROV, actor_id: forged };
      await refused(upsert({ id: k('forged'), title: 't', goal: 'g' }, prov), /provenance\.actor_id is not an owner of this organization/, '42501');
      await refused(append(k('a'), k('op-forged'), { kind: 'decision', text: 'x', decision: { title: 'forged' } }, prov), /not an owner of this organization/, '42501');
      await refused(checkpoint({ id: k('a'), next: 'forged' }, null, null, prov), /not an owner of this organization/, '42501');
      await refused(resume(1, 'restricted', k('private'), ORG, forged), /needs an owner of this organization/, '42501');
    }
    await refused(upsert({ id: k('forged'), title: 't', goal: 'g' }, { ...PROV, actor_id: 'the-owner' }), /provenance\.actor_id must be a UUID/);
    await refused(resume(1, 'confidential', null, ORG, null), /needs an owner of this organization/, '42501');
    assert.equal((await resume(1, 'internal', k('a'), ORG, null)).length, 1, 'internal needs no actor');
    assert.deepEqual([await count('ai_context.workstreams'), await count('ai_context.workstream_events'), await count('ai_context.decisions')], before);
    assert.equal((await upsert({ id: k('a') }, { ...PROV, actor_id: ACTOR.toUpperCase() })).workstream.provenance.actor_id, ACTOR, 'the real owner, in any letter case');
  });

  /* ---- the write path obeys the sensitivity ceiling ---- */
  await check('a writer below the ceiling can neither read back nor change a workstream above it', async () => {
    const stored = async () => one('select title, next_step, sensitivity, updated_at::text as u from ai_context.workstreams where workstream_key = $1', [k('private')]);
    await upsert({ id: k('private'), next: 'private next' });
    const before = await stored();
    const leak = (error) => { assert.equal(/Private title|private next|Private goal/.test(String(error.message)), false, 'the refusal repeats nothing stored'); return true; };
    for (const attempt of [
      () => upsert({ id: k('private') }, AGENT),
      () => upsert({ id: k('private'), sensitivity: 'public' }, AGENT),
      () => upsert({ id: k('private'), next: 'overwritten', updated_at: '2020-01-01T00:00:00Z' }, AGENT),
      () => checkpoint({ id: k('private') }, k('agent-p'), { kind: 'note', text: 'n' }, AGENT),
      () => checkpoint({ id: k('private') }, k('p-1'), { kind: 'note', text: 'private note' }, AGENT),
      () => append(k('private'), k('p-1'), { kind: 'note', text: 'private note' }, AGENT),
      () => append(k('private'), k('agent-p2'), { kind: 'note', text: 'n', sensitivity: 'public' }, AGENT)
    ]) {
      await assert.rejects(attempt(), (error) => { assert.match(String(error.message), /above this writer's sensitivity ceiling/); return leak(error); });
    }
    assert.deepEqual(await stored(), before, 'nothing changed, the sensitivity least of all');
    const [stub] = await resume(1, 'public', k('private'));
    assert.equal(stub.withheld, true, 'still withheld below its sensitivity');
  });
  await check('a writer cannot classify above its own ceiling, and only the owner lowers a sensitivity', async () => {
    const made = await checkpoint({ id: k('agent-ws'), title: 'Agent stream', goal: 'g' }, k('agent-1'), { kind: 'note', text: 'an agent may write at internal' }, AGENT);
    assert.equal(made.workstream.created, true); assert.equal(made.event.event.provenance.actor_kind, 'agent');
    assert.equal(made.event.event.provenance.actor_id, AGENT.actor_id);
    await refused(upsert({ id: k('agent-ws'), sensitivity: 'confidential' }, AGENT), /workstream\.sensitivity is above this writer's sensitivity ceiling/, '42501');
    await refused(upsert({ id: k('agent-new'), title: 't', goal: 'g', sensitivity: 'restricted' }, AGENT), /above this writer's sensitivity ceiling/, '42501');
    await refused(append(k('agent-ws'), k('agent-2'), { kind: 'note', text: 'n', sensitivity: 'restricted' }, AGENT), /event\.sensitivity is above this writer's sensitivity ceiling/, '42501');
    await refused(upsert({ id: k('agent-ws'), sensitivity: 'public' }, AGENT), /only the owner may lower a workstream's sensitivity/, '42501');
    assert.equal((await upsert({ id: k('agent-ws'), sensitivity: 'internal' }, AGENT)).applied, true, 'naming the same level is not lowering');
    assert.equal((await upsert({ id: k('agent-ws'), sensitivity: 'public' })).workstream.sensitivity, 'public', 'the owner may lower');
    assert.equal((await upsert({ id: k('agent-ws'), sensitivity: 'internal' }, AGENT)).workstream.sensitivity, 'internal', 'anyone may raise within their ceiling');
  });
  await check('lowering a workstream never lowers the ceiling on a stored event replay', async () => {
    const ws = { id: k('lowered'), title: 'Lowered workstream', goal: 'Stored events keep their own classification', sensitivity: 'restricted' };
    const event = { kind: 'verified', text: 'Restricted verification evidence' };
    await checkpoint(ws, k('lowered-event'), event);
    await upsert({ id: ws.id, sensitivity: 'internal', next: 'Continue at internal' });
    for (const replay of [
      () => append(ws.id, k('lowered-event'), event, AGENT),
      () => checkpoint({ id: ws.id, next: 'must not land' }, k('lowered-event'), event, AGENT)
    ]) await refused(replay(), /sensitivity ceiling/, '42501');
    const owner = await checkpoint(ws, k('lowered-event'), event);
    assert.equal(owner.event.replayed, true);
    assert.equal(owner.event.event.sensitivity, 'restricted');
    assert.equal(owner.workstream.workstream.sensitivity, 'internal');
    assert.equal(owner.workstream.workstream.next, 'Continue at internal');
    const [row] = await resume(1, 'internal', ws.id);
    assert.equal(row.events.length, 0);
    assert.equal(row.events_withheld, 1);
  });

  /* ---- one operation key is one checkpoint ---- */
  await check('a replayed checkpoint never rewinds the workstream', async () => {
    const first = { id: k('rewind'), title: 'Rewind', goal: 'g', branch: 'feature/one', head: 'aaaa111', next: 'X' };
    const firstEvent = { kind: 'done', text: 'step one' };
    await checkpoint(first, k('rw-1'), firstEvent);
    await checkpoint({ id: k('rewind'), head: 'bbbb222', pr: '#2', next: 'Y' }, k('rw-2'), { kind: 'done', text: 'step two' });
    const stamp = async () => one('select next_step, head, pr, branch, source_updated_at::text as s, updated_at::text as u, last_provenance::text as p from ai_context.workstreams where workstream_key = $1', [k('rewind')]);
    const before = await stamp();
    const late = await checkpoint(first, k('rw-1'), firstEvent, { ...PROV, session_id: 'a-late-retry' });
    assert.equal(late.event.replayed, true); assert.equal(late.event.appended, false);
    assert.equal(late.workstream.applied, false); assert.equal(late.workstream.replayed, true);
    assert.equal(late.workstream.workstream.next, 'Y', 'the answer shows the current state, not the replayed one');
    assert.equal(late.workstream.workstream.head, 'bbbb222');
    assert.deepEqual(await stamp(), before, 'no column of the workstream moved');
    await refused(checkpoint({ ...first, next: 'Z' }, k('rw-1'), { kind: 'done', text: 'a different step' }), /already used for a different checkpoint/, '23505');
    await refused(checkpoint({ id: k('a'), next: 'Z' }, k('rw-1'), firstEvent), /already used for a different checkpoint/, '23505');
    assert.deepEqual(await stamp(), before);
    assert.equal((await one('select next_step from ai_context.workstreams where workstream_key = $1', [k('a')])).next_step === 'Z', false, 'a refused replay changes no other workstream either');
  });
  await check('the same key with a different sensitivity, link or decision is a different checkpoint', async () => {
    const base = { at: '2026-11-22T14:00:00Z', kind: 'note', text: 'classified note', evidence: 'e', by: 'b' };
    await append(k('a'), k('hash-1'), base);
    assert.equal((await append(k('a'), k('hash-1'), base)).replayed, true);
    for (const changed of [{ ...base, sensitivity: 'restricted' }, { ...base, sensitivity: 'internal' }, { ...base, objective_id: OBJECTIVE }, { ...base, job_id: JOB }]) {
      await refused(append(k('a'), k('hash-1'), changed), /already used for a different checkpoint/, '23505');
    }
    assert.equal((await one('select sensitivity from ai_context.workstream_events where operation_key = $1', [k('hash-1')])).sensitivity, 'internal');
    const decision = { at: '2026-11-22T14:01:00Z', kind: 'decision', text: 'decided', decision: { title: 'A title', risk_class: 'low' } };
    const stored = await append(k('a'), k('hash-2'), decision);
    const decisions = await count('ai_context.decisions');
    assert.equal((await append(k('a'), k('hash-2'), { ...decision, decision: { title: '  A title ' } })).replayed, true, 'the default risk class and outer spaces are the same thing said');
    for (const changed of [
      { ...decision, decision: { title: 'A title', risk_class: 'critical' } },
      { ...decision, decision: { title: 'Another title', risk_class: 'low' } },
      { ...decision, decision: { title: 'A title', risk_class: 'low', rationale_summary: 'added later' } },
      { at: decision.at, kind: 'decision', text: 'decided' },
      { at: decision.at, kind: 'decision', text: 'decided', decision_id: stored.event.decision_id }
    ]) {
      await refused(append(k('a'), k('hash-2'), changed), /already used for a different checkpoint/, '23505');
    }
    assert.equal(await count('ai_context.decisions'), decisions);
    assert.equal((await one('select risk_class from ai_context.decisions where id = $1', [stored.event.decision_id])).risk_class, 'low');
  });

  /* ---- order is the plane's, not the writer's clock ---- */
  await check('a blocker is cleared by what was appended after it, whatever either clock said', async () => {
    const blockers = async (id) => (await resume(1, 'internal', id))[0].events.filter((event) => event.kind === 'blocker').map((event) => event.text);
    const iso = (ms) => new Date(Date.now() + ms).toISOString();
    await upsert({ id: k('clock-a'), title: 'Slow clock', goal: 'g', status: 'blocked' });
    await append(k('clock-a'), k('ca-1'), { kind: 'blocker', text: 'waiting on owner' });
    await append(k('clock-a'), k('ca-2'), { at: iso(-30_000), kind: 'unblocked', text: 'owner answered, from a clock 30s behind' });
    assert.deepEqual(await blockers(k('clock-a')), [], 'an unblocked appended later clears it, even stamped earlier');
    await upsert({ id: k('clock-b'), title: 'Same instant', goal: 'g', status: 'blocked' });
    const at = iso(-60_000);
    await append(k('clock-b'), k('cb-1'), { at, kind: 'unblocked', text: 'cleared the old one' });
    await append(k('clock-b'), k('cb-2'), { at, kind: 'blocker', text: 'a new blocker in the same instant' });
    assert.deepEqual(await blockers(k('clock-b')), ['a new blocker in the same instant']);
    await upsert({ id: k('clock-c'), title: 'Fast clock', goal: 'g', status: 'blocked' });
    await append(k('clock-c'), k('cc-1'), { at: iso(4 * 60_000), kind: 'unblocked', text: 'stamped four minutes ahead' });
    await append(k('clock-c'), k('cc-2'), { kind: 'blocker', text: 'a real blocker, server time' });
    await append(k('clock-c'), k('cc-3'), { at: '2020-01-01T00:00:00Z', kind: 'blocker', text: 'a blocker from an old local file' });
    assert.deepEqual(await blockers(k('clock-c')), ['a real blocker, server time', 'a blocker from an old local file']);
    const seqs = (await resume(1, 'internal', k('clock-c')))[0].events.map((event) => event.seq);
    assert.ok(seqs.every((seq, i) => Number.isInteger(seq) && (i === 0 || seq > seqs[i - 1])), 'events come back in append order and say so');
  });
  await check('the last N of a kind are the last N appended: a backdated event is not pushed out of the window', async () => {
    await upsert({ id: k('busy'), status: 'active' });
    await append(k('busy'), k('d-backdated'), { at: '2020-01-01T00:00:00Z', kind: 'decision', text: 'decided today, stamped years ago' });
    const decisions = (await resume(1, 'internal', k('busy')))[0].events.filter((event) => event.kind === 'decision').map((event) => event.text);
    assert.equal(decisions.length, 8); assert.equal(decisions.at(-1), 'decided today, stamped years ago');
    assert.equal(decisions[0], 'decision 3');
  });

  /* ---- every stored text is checked, keys and ids included ---- */
  await check('a credential-shaped operation key or workstream id is refused, and blank-only text is empty', async () => {
    const before = [await count('ai_context.workstreams'), await count('ai_context.workstream_events')];
    const key = ['sk-', 'ant-', 'a'.repeat(30)].join('');
    const jwt = ['ey', 'J', 'f'.repeat(22), '.', 'g'.repeat(22), '.', 'h'.repeat(22)].join('');
    for (const bad of [key, jwt, ['AK', 'IA', 'L'.repeat(16)].join(''), ['xo', 'xb-', 'm'.repeat(12)].join('')]) {
      await refused(append(k('a'), bad, { kind: 'note', text: 'n' }), /looks like a credential \(operation_key\)/, '22023');
      await refused(checkpoint({ id: k('a') }, bad, { kind: 'note', text: 'n' }), /looks like a credential \(operation_key\)/, '22023');
    }
    await refused(upsert({ id: key, title: 't', goal: 'g' }), /looks like a credential \(workstream\.id\)/, '22023');
    for (const blank of ['\n\t', ' \r\n ', '\u00a0\u2028', '\t']) {
      await refused(upsert({ id: k('blank'), title: blank, goal: 'g' }), /workstream\.title is required/);
      await refused(upsert({ id: k('blank'), title: 't', goal: blank }), /workstream\.goal is required/);
      await refused(append(k('a'), k('op-blank'), { kind: 'note', text: blank }), /event\.text is required/);
    }
    assert.equal((await upsert({ id: k('a'), next: '\n\t' })).workstream.next, undefined, 'a blank optional field is cleared, not stored as line breaks');
    await upsert({ id: k('a'), next: 'ship it' });
    assert.deepEqual([await count('ai_context.workstreams'), await count('ai_context.workstream_events')], before);
  });
  await check('the tables themselves refuse a credential in any text column, and a blank title or body', async () => {
    const ws = (await one('select id from ai_context.workstreams where workstream_key = $1', [k('a')])).id;
    const secret = SECRET_SAMPLES[0];
    const shortSecret = ['AK', 'IA', 'L'.repeat(16)].join('');
    for (const column of ['workstream_key', 'title', 'goal', 'branch', 'head', 'pr', 'worktree', 'next_step']) {
      const row = { workstream_key: k('direct'), title: 't', goal: 'g', [column]: column === 'workstream_key' ? ['sk-', 'ant-', 'a'.repeat(30)].join('') : shortSecret };
      await refused(db.query(`insert into ai_context.workstreams(org_id, ${Object.keys(row).join(', ')}) values ($1, ${Object.keys(row).map((_, i) => `$${i + 2}`).join(', ')})`, [ORG, ...Object.values(row)]), /check constraint/);
    }
    await refused(db.query("insert into ai_context.workstreams(org_id, workstream_key, title, goal, last_provenance) values ($1,$2,'t','g',$3::jsonb)", [ORG, k('direct'), J({ session_id: secret })]), /check constraint/);
    await refused(db.query("insert into ai_context.workstreams(org_id, workstream_key, title, goal) values ($1,$2,E'\\n\\t','g')", [ORG, k('direct')]), /check constraint/);
    for (const column of ['operation_key', 'body', 'evidence', 'recorded_by', 'actor_id', 'actor_source', 'harness', 'model_id', 'session_id', 'device']) {
      const row = { operation_key: k('op-direct'), body: 'b', actor_id: 'x', [column]: column === 'operation_key' ? ['sk-', 'ant-', 'a'.repeat(30)].join('') : shortSecret };
      await refused(db.query(`insert into ai_context.workstream_events(org_id, workstream_id, kind, occurred_at, actor_kind, content_hash, ${Object.keys(row).join(', ')}) values ($1,$2,'note',now(),'owner',repeat('0',64), ${Object.keys(row).map((_, i) => `$${i + 3}`).join(', ')})`, [ORG, ws, ...Object.values(row)]), /check constraint/);
    }
    await refused(db.query("insert into ai_context.workstream_events(org_id, workstream_id, operation_key, kind, body, occurred_at, actor_kind, actor_id, content_hash) values ($1,$2,$3,'note',E' \\n ',now(),'owner','x',repeat('0',64))", [ORG, ws, k('op-direct')]), /check constraint/);
  });
  await check('a transcript is refused with Markdown around the speakers and with first-name speakers', async () => {
    for (const pasted of [
      '**User**: do the thing\n**Assistant**: done\n**User**: and the next\n**Assistant**: also done',
      'Me: do the thing\nClaude: done\nMe: and the next\nClaude: also done',
      '> user: a\n> assistant: b\n> user: c',
      '### Human:\nhello\n### AI:\nhi\n### Human:\nbye',
      '[user]: a\n[assistant]: b\n[user]: c'
    ]) {
      await refused(append(k('a'), k('op-pasted'), { kind: 'note', text: pasted }), /looks like a raw transcript/, '22023');
      await refused(upsert({ id: k('a'), next: pasted }), /looks like a raw transcript/, '22023');
    }
    const fine = await append(k('a'), k('op-prose'), { kind: 'note', text: 'The user asked for durable context.\nsystem: one config line\nNext: verify with git' });
    assert.equal(fine.appended, true, 'prose that mentions a speaker once is not a transcript');
  });

  /* ---- volume is bounded (last: these fill the tables) ---- */
  await check('proposed decisions, events and workstreams are bounded per organization', async () => {
    const ws = (await one('select id from ai_context.workstreams where workstream_key = $1', [k('a')])).id;
    const limit = async (name) => Number((await one('select ai_context.workstream_limit($1) as n', [name])).n);
    assert.deepEqual([await limit('workstreams'), await limit('events_per_day'), await limit('decisions_per_day')], [500, 5000, 200]);

    const proposed = Number((await one("select count(*)::int as n from ai_context.decisions where org_id = $1 and metadata->>'ingress' = 'workstream-checkpoint' and created_at > now() - interval '24 hours'", [ORG])).n);
    await db.query("insert into ai_context.decisions(org_id, title, decision, proposed_by, metadata) select $1, 'quota filler', 'x', 'filler', jsonb_build_object('ingress', 'workstream-checkpoint', 'idempotency_key', 'filler:' || g::text) from generate_series(1, $2::int) g", [ORG, 200 - proposed]);
    const decisionsFull = await count('ai_context.decisions');
    await refused(append(k('a'), k('quota-d'), { kind: 'decision', text: 'one too many', decision: { title: 'over the cap' } }), /proposed 200 decisions through checkpoints in the last 24 hours; nothing was written/, '54000');
    assert.equal(await count('ai_context.decisions'), decisionsFull);
    assert.equal((await one('select count(*)::int as n from ai_context.workstream_events where operation_key = $1', [k('quota-d')])).n, 0, 'and its event did not land either');
    assert.equal((await append(k('a'), k('quota-d2'), { kind: 'decision', text: 'a working decision proposes nothing' })).appended, true);
    await db.query("delete from ai_context.decisions where title = 'quota filler'");

    const events = Number((await one("select count(*)::int as n from ai_context.workstream_events where org_id = $1 and created_at > now() - interval '24 hours'", [ORG])).n);
    await db.query("insert into ai_context.workstream_events(org_id, workstream_id, operation_key, kind, body, occurred_at, actor_kind, actor_id, content_hash) select $1, $2, $3::text || g::text, 'note', 'quota filler', now(), 'service', 'filler', repeat('0', 64) from generate_series(1, $4::int) g", [ORG, ws, `${k('fill')}-`, 5000 - events]);
    await refused(append(k('a'), k('quota-e'), { kind: 'note', text: 'one too many' }), /appended 5000 checkpoint events in the last 24 hours; nothing was written/, '54000');
    await refused(checkpoint({ id: k('a'), next: 'must not land' }, k('quota-e'), { kind: 'note', text: 'one too many' }), /nothing was written/, '54000');
    assert.equal((await one('select next_step from ai_context.workstreams where workstream_key = $1', [k('a')])).next_step, 'ship it', 'the refused checkpoint rolled its workstream change back');
    assert.equal((await append(k('a'), k('op-live'), { kind: 'note', text: 'no client clock' })).replayed, true, 'a replay writes nothing, so the cap does not refuse it');
    assert.equal((await checkpoint({ id: k('a'), next: 'ship it' })).workstream.applied, true, 'state without an event is still writable');

    const streams = Number((await one('select count(*)::int as n from ai_context.workstreams where org_id = $1', [ORG])).n);
    await db.query("insert into ai_context.workstreams(org_id, workstream_key, title, goal) select $1, $2::text || g::text, 'quota filler', 'g' from generate_series(1, $3::int) g", [ORG, `${k('fill')}-`, 500 - streams]);
    await refused(upsert({ id: k('one-too-many'), title: 't', goal: 'g' }), /already has 500 workstreams/, '54000');
    assert.equal((await upsert({ id: k('a'), next: 'ship it' })).applied, true, 'an existing workstream is still writable at the cap');
  });
}

// PGlite has one connection. Native PostgreSQL proves the organization-wide caps under real, distinct-key
// contention. These cases run in their own disposable database so quota fillers never alter the behavior pass.
async function nativeQuotaRaces() {
  if (!db.native) return;
  const originalDb = db;
  const { nativeTestDb } = await import('./native-admin-test-db.mjs');
  db = await nativeTestDb('ai_context_workstream_races');
  async function lastSlot(statement, firstParams, secondParams, countSql, expected) {
    const first = db.fork();
    const second = db.fork();
    let pending;
    try {
      await first.exec('begin; set local role service_role');
      await second.exec('set role service_role');
      await first.query(statement, firstParams);
      let settled = false;
      pending = second.query(statement, secondParams).then(
        (value) => { settled = true; return { value }; },
        (error) => { settled = true; return { error }; });
      let blocked = false;
      const deadline = Date.now() + 5000;
      while (!settled && Date.now() < deadline) {
        blocked = Number((await one("select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'")).n) > 0;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(blocked, true, 'a distinct-key writer must wait for the organization quota transaction');
      await first.exec('commit');
      const result = await pending;
      assert.equal(result.error?.code, '54000', 'the second writer must observe the committed final slot');
      assert.equal(Number((await one(countSql)).n), expected, 'the quota must never be exceeded');
    } finally {
      await first.exec('rollback');
      if (pending) await pending;
      await first.close(); await second.close();
    }
  }
  try {
    await base();
    await db.exec(read(PENDING));
    await check('native concurrent different workstreams share the last workstream slot', async () => {
      await db.query("insert into ai_context.workstreams(org_id, workstream_key, title, goal) select $1, 'race-fill-' || g::text, 'Quota fixture', 'g' from generate_series(1,499) g", [ORG]);
      const args = (id) => [ORG, J({ id, title: 'Final slot', goal: 'Quota contention' }), J(PROV)];
      await lastSlot('select public.ops_ai_workstream_upsert($1::uuid,$2::jsonb,$3::jsonb)', args('race-new-a'), args('race-new-b'),
        'select count(*)::int as n from ai_context.workstreams', 500);
    });
    await check('native concurrent different events share the last proposed-decision slot', async () => {
      await db.query("insert into ai_context.decisions(org_id,title,decision,proposed_by,metadata) select $1,'Quota fixture','x','fixture',jsonb_build_object('ingress','workstream-checkpoint','idempotency_key','race-decision-fill:' || g::text) from generate_series(1,199) g", [ORG]);
      const args = (suffix) => [ORG, `race-fill-${suffix}`, `race-decision:${suffix}`, J({ kind: 'decision', text: 'Proposal', decision: { title: 'Final decision slot' } }), J(PROV)];
      await lastSlot('select public.ops_ai_workstream_event_append($1::uuid,$2,$3,$4::jsonb,$5::jsonb)', args(1), args(2),
        'select count(*)::int as n from ai_context.decisions', 200);
      assert.equal(await count('ai_context.workstream_events'), 1, 'the refused decision leaves no orphan event');
    });
    await check('native concurrent different workstreams share the last event slot', async () => {
      const ws = (await one("select id from ai_context.workstreams where workstream_key='race-fill-1'")).id;
      await db.query("insert into ai_context.workstream_events(org_id,workstream_id,operation_key,kind,body,occurred_at,actor_kind,actor_id,content_hash) select $1,$2,'race-event-fill:' || g::text,'note','Quota fixture',now(),'service','fixture',repeat('0',64) from generate_series(1,4998) g", [ORG, ws]);
      const args = (suffix) => [ORG, `race-fill-${suffix}`, `race-event:${suffix}`, J({ kind: 'note', text: 'Final event slot' }), J(PROV)];
      await lastSlot('select public.ops_ai_workstream_event_append($1::uuid,$2,$3,$4::jsonb,$5::jsonb)', args(1), args(2),
        'select count(*)::int as n from ai_context.workstream_events', 5000);
    });
    console.log('native distinct-key quota races: PASS');
  } finally {
    await db.close();
    db = originalDb;
  }
}

try {
  await check('the guard refuses a database without the context plane and changes nothing', async () => {
    await refused(db.exec(read(PENDING)), /ai_context_workstreams_v1 needs schema ai_context/, '55000');
    await db.exec('rollback');
    assert.equal((await one("select to_regclass('ai_context.workstreams') as t")).t, null);
  });
  await base();
  await db.exec(read(PENDING)); console.log(`applied ${PENDING}`);
  await db.exec(read(PENDING)); console.log(`applied ${PENDING} a second time`); checks += 1;
  await privileges();
  await behaviour('one');
  console.log('first behaviour pass: PASS');

  await check('the second apply over live data changes no row', async () => {
    const before = [await count('ai_context.workstreams'), await count('ai_context.workstream_events')];
    await db.exec(read(PENDING));
    assert.deepEqual([await count('ai_context.workstreams'), await count('ai_context.workstream_events')], before);
    await refused(db.query("update ai_context.workstream_events set body = 'x'"), /append-only/, '55000');
  });
  await privileges();

  const decisionsBefore = await count('ai_context.decisions');
  await check('the rollback refuses while the log holds data and changes nothing', async () => {
    await refused(db.exec(read(ROLLBACK)), /rollback refused: \d+ workstream\(s\) and \d+ event\(s\)/, '55000');
    await db.exec('rollback');
    assert.ok(await count('ai_context.workstream_events') > 0);
    assert.equal((await resume(1)).length, 1);
  });
  await check('the forced rollback removes every object this file created and nothing else', async () => {
    await db.exec(read(ROLLBACK).replace("set local lock_timeout = '5s';", "set local lock_timeout = '5s';\nset local mccluster.workstreams_drop_data = 'on';"));
    assert.equal((await one("select to_regclass('ai_context.workstreams') as a, to_regclass('ai_context.workstream_events') as b")).a, null);
    assert.equal((await one("select to_regclass('ai_context.workstream_events') as b")).b, null);
    const left = await one("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname = 'public' and p.proname like 'ops_ai_workstream_%') or (n.nspname = 'ai_context' and p.proname like 'workstream_%')");
    assert.equal(left.n, 0);
    await refused(asRole('service_role', () => db.query('select public.ops_ai_workstream_resume($1::uuid)', [ORG])), /does not exist/);
    assert.equal(await count('ai_context.decisions'), decisionsBefore, 'proposed decisions stay in ai_context.decisions');
    assert.equal(await count('public.ops_objectives'), 2); assert.equal(await count('public.ops_agent_jobs'), 1);
  });
  await check('the rollback is safe to run twice and on a database that never had the file', async () => {
    await db.exec(read(ROLLBACK));
  });
  await db.exec(read(PENDING)); console.log(`re-applied ${PENDING} after rollback`); checks += 1;
  await privileges();
  await behaviour('two');
  console.log('rollback, re-apply and second behaviour pass: PASS');
  await nativeQuotaRaces();
  console.log(`ai_context workstreams SQL: ${checks} checks PASS`);
} finally { await db.close(); }
