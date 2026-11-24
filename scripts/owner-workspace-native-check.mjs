// Native PostgreSQL proof for the two pending owner-device migrations.
// Default: disposable database with canonical compute/queue SQL and explicit
// peripheral Auth stand-ins. --full-reset: the actual disposable Supabase reset,
// including its existing roles, defaults, RLS, triggers and migration ledger.
// Both modes reject remote databases. No physical-device or inference claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { nativeTestDb, resetMigrationPlan, waitForBlocked } from './native-admin-test-db.mjs';
import { generateNodeIdentity } from '../core/src/compute/signature.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const fullReset = process.argv.includes('--full-reset');
assert.deepEqual(process.argv.slice(2), fullReset ? ['--full-reset'] : [], 'only --full-reset is accepted');
const enrollmentFile = 'supabase/pending/compute_owner_enrollment_v1.sql';
const workspaceFile = 'supabase/pending/compute_owner_workspace_v1.sql';
const enrollmentRollback = 'supabase/pending/compute_owner_enrollment_v1.rollback.sql';
const workspaceRollback = 'supabase/pending/compute_owner_workspace_v1.rollback.sql';
const yieldFile = 'supabase/pending/compute_claim_task_yield_v3.sql';
const yieldRollback = 'supabase/pending/compute_claim_task_yield_v3.rollback.sql';
let checks = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (value, label) => { assert.ok(value, label); checks++; };
const deny = async (action, expected, label) => { await assert.rejects(action, expected, label); checks++; };
const digest = text => createHash('sha256').update(text).digest('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function openResetDatabase() {
  const url = new URL(process.env.NATIVE_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'full-reset proof is local only');
  assert.equal(url.port, '54322', 'full-reset proof uses the disposable Supabase port');
  assert.equal(url.pathname, '/postgres', 'full-reset proof requires the CI reset database');
  const { default: postgres } = await import(pathToFileURL(process.env.POSTGRES_MODULE_PATH));
  const options = { max: 1, onnotice: () => {}, connection: { application_name: 'owner-workspace-native-proof', statement_timeout: 20000 } };
  const wrap = connection => ({ native: true, sql: connection,
    query: async (text, values = []) => ({ rows: await connection.unsafe(text, values) }),
    exec: text => connection.unsafe(text),
    transaction: fn => connection.begin(tx => fn(wrap(tx))),
    close: () => connection.end() });
  const database = wrap(postgres(url.href, options));
  database.fork = () => wrap(postgres(url.href, options));
  try {
    const plan = await resetMigrationPlan(root);
    const actual = Array.from((await database.query('select version,name from supabase_migrations.schema_migrations order by version')).rows);
    equal(actual, plan.rows, 'full reset exactly matches canonical ledger files plus replay foundations');
    console.log(JSON.stringify({ baseline: 'canonical Supabase reset', migrations: actual.length, production_migrations: plan.productionCount, replay_only_migrations: plan.replayOnlyCount, latest: actual.at(-1)?.version }));
    return database;
  } catch (error) { await database.close(); throw error; }
}

async function boundedBaseline(database) {
  // These are only the explicitly bounded Auth/global-role stand-ins. The
  // full-reset mode never executes this block or replaces canonical objects.
  await database.exec(`
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
    create schema auth; create schema private; create schema extensions;
    create table auth.users(id uuid primary key,email text);
    create table public.shake_crew(profile_id uuid references auth.users(id));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    create function public.eu_is_admin() returns boolean language sql stable as $$ select false; $$;
    grant usage on schema auth,private to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    -- Supabase defaults precede object creation. The migration must revoke
    -- browser access itself; no post-apply blanket grants repair the proof.
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
  `);
  const tenancy = read('supabase/replay_migrations/0026_tenancy.sql');
  await database.exec(tenancy.slice(tenancy.indexOf('create table if not exists public.orgs'), tenancy.indexOf('-- The house.')));
  await database.exec(read('supabase/replay_migrations/0072_org_helper_replay_foundation.sql'));
  for (const file of [
    'supabase/replay_migrations/20260912071000_compute_node_protocol.sql',
    'supabase/migrations/20260919020830_compute_gateway_hardening_live_reconcile.sql',
    'supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql',
    'supabase/migrations/20260919021013_compute_crypto_search_path_reconcile.sql',
    'supabase/migrations/20261020210718_compute_lease_authority_v2.sql',
  ]) await database.exec(read(file));
  const queue = read('supabase/migrations/20260919053445_operational_ontology_v1.sql');
  await database.exec(queue.slice(0, queue.indexOf('create table if not exists public.ops_ontology_types')));
  await database.exec(read('supabase/migrations/20260919043433_operator_local_ai_chat.sql'));
  await database.exec(read('supabase/migrations/20260927222835_resident_ai_durable_vps_turn.sql'));
  console.log(JSON.stringify({ baseline: 'canonical compute and queue SQL; peripheral Auth stand-ins', full_reset: false }));
}

const db = fullReset ? await openResetDatabase() : await nativeTestDb('owner_workspace');
const clients = new Set();
const ORG = randomUUID(), BASE_ORG = randomUUID(), OWNER = randomUUID(), MEMBER = randomUUID();
let service, implementation, pairImplementation;
async function session(role = 'service_role') {
  assert.ok(['service_role', 'authenticated', 'anon'].includes(role));
  const connection = db.fork(); clients.add(connection);
  await connection.exec(`set role ${role}`);
  return connection;
}
async function migration(file) {
  // Match apply_migration: each exact file runs in one transaction, including
  // its SET LOCAL timeout, shared advisory lock, guard, and schema changes.
  try { await db.transaction(tx => tx.exec(read(file))); }
  catch (error) { await db.exec('rollback'); throw error; }
}
const rpc = async (name, values, types, connection = service) => {
  assert.match(name, /^[a-z][a-z0-9_]+$/);
  const params = values.map((value, index) => types[index] === 'jsonb' && value !== null ? connection.sql.json(value) : value);
  return (await connection.query(`select public.${name}(${types.map((type, index) => `$${index + 1}::${type}`).join(',')}) as result`, params)).rows[0].result;
};
const snapshot = async () => {
  const result = {};
  for (const table of ['ops_compute_nodes', 'ops_compute_tasks', 'ops_compute_leases']) {
    const expression = table === 'ops_compute_nodes' ? "to_jsonb(t)-'pair_cleanup_required'-'pair_cleanup_details'" : 'to_jsonb(t)';
    result[table] = (await db.query(`select coalesce(jsonb_agg(${expression} order by id),'[]'::jsonb) as rows from public.${table} t`)).rows[0].rows;
  }
  return result;
};
const claimDefinition = async () => (await db.query("select pg_get_functiondef('public.compute_claim_task(text,text[],text[],integer)'::regprocedure) as definition")).rows[0].definition;
const claimPrivileges = async () => (await db.query(`select p.proowner::regrole::text as owner,
  (select jsonb_agg(jsonb_build_array(a.grantee::regrole::text,a.privilege_type,a.is_grantable) order by a.grantee,a.privilege_type)
   from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) as grants
  from pg_proc p where p.oid='public.compute_claim_task(text,text[],text[],integer)'::regprocedure`)).rows[0];
async function guard(file, token, label) {
  await deny(() => migration(file), error => error.code === '55000' && error.message.includes(token), label);
}
const requiresReadCommitted = error => error.code === '55000' && error.message.includes('COMPUTE_READ_COMMITTED_REQUIRED');
async function staleRecovery(file, table, insert, label) {
  assert.ok(['ops_compute_enrollments', 'ops_compute_pairs'].includes(table));
  let id, committedRow;
  await deny(() => db.transaction(async tx => {
    await tx.exec('set transaction isolation level repeatable read');
    equal((await tx.query(`select count(*)::integer as n from public.${table}`)).rows[0].n, 0, `${label}: snapshot begins empty`);
    id = await insert(); // a different native connection commits after that snapshot
    committedRow = (await service.query(`select to_jsonb(t) as row from public.${table} t where id=$1`, [id])).rows[0].row;
    equal((await tx.query(`select exists(select 1 from public.${table} where id=$1) as visible`, [id])).rows[0].visible, false, `${label}: repeatable-read snapshot cannot see the later commit`);
    await tx.exec(read(file));
  }), requiresReadCommitted, `${label}: recovery rejects an obsolete snapshot`);
  equal((await db.query(`select to_jsonb(t) as row from public.${table} t where id=$1`, [id])).rows[0].row, committedRow, `${label}: refused recovery preserves the later committed row exactly`);
  await db.query(`delete from public.${table} where id=$1`, [id]);
}
async function race(winner, contender, label) {
  const first = await session(), second = await session(), observer = db.fork();
  const ready = deferred(), release = deferred();
  const winning = first.transaction(async tx => { const value = await winner(tx); ready.resolve(); await release.promise; return value; });
  winning.catch(ready.reject);
  let pending;
  try {
    await ready.promise;
    pending = contender(second).then(value => ({ value }), error => ({ error }));
    await waitForBlocked(observer);
    checks++;
    release.resolve();
    const value = await winning, outcome = await pending;
    console.log(`native lock wait: ${label}`);
    return { winner: value, ...outcome };
  } finally {
    release.resolve(); await winning.catch(() => {}); if (pending) await pending;
    await observer.close();
    for (const connection of [first, second]) { await connection.close(); clients.delete(connection); }
  }
}
async function issue({ milliseconds = 480000 } = {}) {
  const secret = randomUUID() + randomUUID(), hash = digest(secret);
  const row = (await service.query(`insert into public.ops_compute_enrollments(org_id,issued_by,display_name,platform,credential_hash,issued_at,expires_at)
    values($1,$2,'Native proof device','darwin',$3,clock_timestamp()-interval '1 minute',clock_timestamp()+$4::integer*interval '1 millisecond') returning *`, [ORG, OWNER, hash, milliseconds])).rows[0];
  return { ...row, secret };
}
const nodeInput = identity => ({ id: identity.nodeId, org_id: ORG, public_key_pem: identity.publicKeyPem, key_fingerprint: identity.fingerprint,
  protocol_version: 'mccluster-compute/1', agent_version: 'native-proof', inventory: { platform: 'darwin', arch: 'arm64' },
  capabilities: [{ capability: 'ai.chat', implementation, max_concurrency: 1 }, { capability: 'compute.pair.control', implementation: pairImplementation, max_concurrency: 1 }], max_leases: 1 });
const consume = (enrollment, identity, connection = service) => rpc('compute_enroll_once', [enrollment.credential_hash, nodeInput(identity)], ['text', 'jsonb'], connection);
const claim = (node, connection = service, legacy = false) => rpc(legacy ? 'compute_claim_task' : 'compute_claim_task_v4', [node, ['ai.chat', 'compute.pair.control'], [implementation, pairImplementation], 120], ['text', 'text[]', 'text[]', 'integer'], connection);
const enqueue = async (node, connection = service) => (await rpc('compute_enqueue_task', [ORG, 'ai.chat', implementation, {}, { node_id: node }, 100, null, 3, {}, randomUUID()], ['uuid', 'text', 'text', 'jsonb', 'jsonb', 'integer', 'timestamptz', 'integer', 'jsonb', 'text'], connection)).task;
const settle = async () => {
  await service.query("update public.ops_compute_leases set status='canceled' where task_id in(select id from public.ops_compute_tasks where org_id=$1) and status in('leased','running')", [ORG]);
  await service.query("update public.ops_compute_tasks set status='canceled',locked_by_node_id=null,locked_at=null where org_id=$1 and status in('queued','leased','running')", [ORG]);
};
const reserve = (pair, reservation, connection = service) => rpc('compute_reserve_pair', [ORG, pair, reservation, 900], ['uuid', 'uuid', 'uuid', 'integer'], connection);
const release = (reservation, clean, connection = service) => rpc('compute_release_pair', [ORG, reservation, clean], ['uuid', 'uuid', 'text[]'], connection);
const pairTask = (reservation, node) => ({ capability: 'compute.pair.control', implementation: pairImplementation, requirements: { node_id: node, pair_reservation_id: reservation }, input: { action: 'probe' } });
const pairEnqueue = (reservation, node, connection = service) => rpc('compute_enqueue_pair_task', [ORG, reservation, pairTask(reservation, node), randomUUID()], ['uuid', 'uuid', 'jsonb', 'text'], connection);
const reconcile = (connection = service) => rpc('compute_reconcile_expired_pairs', [ORG], ['uuid'], connection);
const turn = (thread, node, id = randomUUID(), assistant = randomUUID(), connection = service) => rpc('ops_ai_submit_workspace_turn', [ORG, thread, id, assistant, 'Synthetic native proof turn', { workspace_route: { mode: 'node', node_id: node, implementation }, actor_user_id: OWNER, actor_kind: 'owner' }], ['uuid', 'uuid', 'uuid', 'uuid', 'text', 'jsonb'], connection);
const runTurn = async receipt => { await service.query("update public.ops_agent_jobs set status='running',attempts=1,locked_by='native-proof',locked_at=clock_timestamp() where id=$1", [receipt.job_id]); return receipt; };
const enqueueTurn = (receipt, node, connection = service) => rpc('ops_ai_enqueue_workspace_task', [ORG, receipt.job_id, 'native-proof', 1, { capability: 'ai.chat', implementation, requirements: { node_id: node }, input: {}, metadata: {} }, `native:${receipt.job_id}`], ['uuid', 'uuid', 'text', 'integer', 'jsonb', 'text'], connection);
const stop = (receipt, connection = service) => rpc('ops_ai_stop_workspace_turn', [ORG, receipt.job_id], ['uuid', 'uuid'], connection);
const complete = (receipt, thread, connection = service) => rpc('ops_ai_complete_workspace_turn', [ORG, receipt.job_id, 'native-proof', 1, { id: receipt.assistant_message_id, thread_id: thread, content: 'Synthetic native proof answer' }], ['uuid', 'uuid', 'text', 'integer', 'jsonb'], connection);

try {
  if (!fullReset) await boundedBaseline(db);
  equal((await db.query("select rolbypassrls from pg_roles where rolname='service_role'")).rows[0].rolbypassrls, true, 'real service role has its canonical RLS bypass');
  equal((await db.query("select to_regclass('public.ops_compute_enrollments') as enrollment,to_regprocedure('public.compute_owner_workspace_status()') as workspace")).rows[0], { enrollment: null, workspace: null }, 'proof starts before either pending migration');
  service = await session();
  await db.query("insert into public.orgs(id,slug,name) values($1,$2,'Native proof'),($3,$4,'Preserved compute history')", [ORG, `native-owner-${ORG}`, BASE_ORG, `native-existing-${BASE_ORG}`]);
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [OWNER, `${OWNER}@example.invalid`, MEMBER, `${MEMBER}@example.invalid`]);
  await db.query("insert into public.org_members(org_id,profile_id,role) values($1,$2,'owner'),($1,$3,'staff')", [ORG, OWNER, MEMBER]);
  const priorNodes = [generateNodeIdentity(), generateNodeIdentity()];
  for (const identity of priorNodes) await db.query("insert into public.ops_compute_nodes(id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version,state) values($1,$2,'Preserved node',$3,$4,'mccluster-compute/1','native-proof','offline')", [identity.nodeId, BASE_ORG, identity.publicKeyPem, identity.fingerprint]);
  const priorTasks = [];
  for (let i = 0; i < 30; i++) { const id = randomUUID(); priorTasks.push(id); await db.query("insert into public.ops_compute_tasks(id,org_id,capability,status,attempts,output) values($1,$2,'ai.chat','done',2,'{\"preserved\":true}')", [id, BASE_ORG]); }
  for (let i = 0; i < 40; i++) await db.query("insert into public.ops_compute_leases(task_id,node_id,status,lease_token_hash,expires_at,attempt,implementation,result) values($1,$2,'done',$3,clock_timestamp()-interval '1 day',$4,'fixture.local','{\"preserved\":true}')", [priorTasks[i % 30], priorNodes[i % 2].nodeId, digest(`synthetic-old-${i}`), i < 30 ? 1 : 2]);
  const before = await snapshot(), baselineClaim = await claimDefinition(), baselinePrivileges = await claimPrivileges();
  const migrationBlocker = db.fork();
  try {
    await migrationBlocker.transaction(async blocker => {
      await blocker.query('select pg_advisory_xact_lock(821,20261122)');
      for (const file of [enrollmentFile, workspaceFile, yieldFile, enrollmentRollback, workspaceRollback, yieldRollback]) {
        await deny(() => db.transaction(async tx => {
          await tx.exec('set transaction isolation level repeatable read');
          await tx.query('select count(*) from public.ops_compute_nodes');
          await tx.exec(read(file));
        }), requiresReadCommitted, `${file} refuses repeatable read before waiting for the shared migration lock`);
      }
    });
  } finally { await migrationBlocker.close(); }
  equal(await snapshot(), before, 'all isolation refusals preserve historical compute rows');
  equal(await claimDefinition(), baselineClaim, 'all isolation refusals preserve the canonical claim definition');
  await migration(enrollmentFile); await migration(enrollmentFile);
  await staleRecovery(enrollmentRollback, 'ops_compute_enrollments', async () => (await issue()).id, 'late enrollment receipt');
  await migration(yieldFile);
  const yieldDefinition = (await db.query("select pg_get_functiondef('public.compute_claim_task(text,text[],text[],integer,integer)'::regprocedure) as definition")).rows[0].definition;
  await guard(workspaceFile, 'COMPUTE_WORKSPACE_YIELD_CONFLICT', 'workspace refuses installed yield without modifying it');
  equal((await db.query("select pg_get_functiondef('public.compute_claim_task(text,text[],text[],integer,integer)'::regprocedure) as definition")).rows[0].definition, yieldDefinition, 'refused workspace preserves yield body');
  equal((await db.query("select to_regclass('public.ops_compute_pairs') as relation")).rows[0].relation, null, 'refused workspace leaves no partial tables');
  await migration(yieldRollback);
  equal(await claimDefinition(), baselineClaim, 'standalone yield rollback preserves original claim definition');
  ok(baselineClaim.includes('AS $function$'), 'native server returns the expected function-definition delimiter');
  await db.exec(baselineClaim.replace('AS $function$', 'AS $function$\n-- Disposable proof of an independently changed baseline.'));
  try { await guard(workspaceFile, 'COMPUTE_BASELINE_CHANGED', 'workspace refuses to overwrite a changed existing claim body'); }
  finally { await db.exec(baselineClaim); }
  equal((await db.query("select to_regclass('public.ops_compute_pairs') as relation")).rows[0].relation, null, 'changed-baseline refusal leaves no new tables');
  await migration(workspaceFile); await migration(workspaceFile);
  const safeClaim = await claimDefinition();
  await staleRecovery(workspaceRollback, 'ops_compute_pairs', async () => (await service.query(
    'insert into public.ops_compute_pairs(org_id,name,node_ids) values($1,$2,$3) returning id',
    [BASE_ORG, 'Synthetic late pair', priorNodes.map(node => node.nodeId)],
  )).rows[0].id, 'late saved workspace pair');
  for (const file of [yieldFile, yieldRollback]) { await guard(file, 'COMPUTE_WORKSPACE_YIELD_CONFLICT', 'yield cannot replace a workspace claim'); equal(await claimDefinition(), safeClaim, 'rejected yield leaves safe wrapper unchanged'); }
  await guard(enrollmentRollback, 'WORKSPACE_ROLLBACK_REQUIRED', 'enrollment cannot roll back before its workspace dependent');
  equal(await snapshot(), before, 'apply twice and rejected ordering preserve all preexisting compute rows');

  // Discover allowed implementation identifiers from the schema contract, so
  // this proof does not create another provider/model naming source of truth.
  const initial = await issue();
  [implementation, pairImplementation] = initial.allowed_implementations;
  ok(implementation && pairImplementation, 'enrollment schema supplies both allowed implementation bindings');
  const identities = [generateNodeIdentity(), generateNodeIdentity()];
  const consumed = await race(tx => consume(initial, identities[0], tx), peer => consume(initial, identities[1], peer), 'single-use enrollment');
  equal(consumed.winner.node_id, identities[0].nodeId, 'first consumer receives its identity');
  equal(consumed.value, null, 'second native consumer cannot reuse the credential');
  const macA = identities[0].nodeId;
  const next = await issue(), secondIdentity = generateNodeIdentity();
  equal((await consume(next, secondIdentity)).node_id, secondIdentity.nodeId, 'second valid device enrolls');
  const macB = secondIdentity.nodeId;
  const rotating = await issue(), rotatedHash = digest(randomUUID());
  const rotation = await race(tx => tx.query('update public.ops_compute_enrollments set credential_hash=$2 where id=$1 and consumed_at is null returning id', [rotating.id, rotatedHash]), peer => consume(rotating, generateNodeIdentity(), peer), 'reissue invalidates a blocked old credential');
  equal(rotation.value, null, 'old credential loses after committed rotation');
  ok(await consume({ ...rotating, credential_hash: rotatedHash }, generateNodeIdentity()), 'newly issued digest remains usable');
  const sameKey = generateNodeIdentity(), keyA = await issue(), keyB = await issue();
  const keyRace = await race(tx => consume(keyA, sameKey, tx), peer => consume(keyB, sameKey, peer), 'two credentials cannot bind the same key');
  ok(keyRace.error?.code === '23505' || keyRace.value === null, 'duplicate identity loses without rebinding');
  equal((await service.query('select consumed_at,node_id from public.ops_compute_enrollments where id=$1', [keyB.id])).rows[0], { consumed_at: null, node_id: null }, 'losing unique-key insert leaves credential unused');
  ok(await consume(keyB, generateNodeIdentity()), 'losing credential can enroll a genuinely new identity');
  const expiring = await issue({ milliseconds: 1000 }), blocker = await session(), blocked = await session();
  const expiryReady = deferred(), expiryRelease = deferred();
  const expiryHold = blocker.transaction(async tx => { await tx.query('select id from public.ops_compute_enrollments where id=$1 for update', [expiring.id]); expiryReady.resolve(); await expiryRelease.promise; });
  await expiryReady.promise;
  const expiryResult = consume(expiring, generateNodeIdentity(), blocked).then(value => ({ value }), error => ({ error }));
  try {
    await waitForBlocked(db);
    equal((await db.query('select expires_at>clock_timestamp() as live from public.ops_compute_enrollments where id=$1', [expiring.id])).rows[0].live, true, 'consumer is already blocked before credential expiry');
    await db.query('select pg_sleep(1.1)');
  }
  finally { expiryRelease.resolve(); }
  await expiryHold;
  equal(await expiryResult, { value: null }, 'credential expiring during a real lock wait cannot enroll');

  const signatures = (await db.query(`select p.oid::regprocedure::text as signature,p.proname,oidvectortypes(p.proargtypes) as types from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any($1::text[]) order by p.proname`, [[...read(enrollmentFile).matchAll(/create or replace function public\.([a-z0-9_]+)/g), ...read(workspaceFile).matchAll(/create or replace function public\.([a-z0-9_]+)/g)].map(match => match[1])])).rows;
  equal(signatures.length, 15, 'all enrollment/workspace RPCs are included in the permission proof');
  for (const role of ['anon', 'authenticated']) {
    const connection = await session(role);
    for (const row of signatures) {
      equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, row.signature])).rows[0].allowed, false, `${role} lacks ${row.proname}`);
      const args = row.types ? row.types.split(', ').map(type => `null::${type}`).join(',') : '';
      await deny(() => connection.query(`select public.${row.proname}(${args})`), { code: '42501' }, `${role} real RPC call is denied`);
    }
    for (const table of ['ops_compute_enrollments', 'ops_compute_pairs', 'ops_compute_pair_reservations']) {
      for (const command of [`select * from public.${table}`, `insert into public.${table} default values`, `update public.${table} set org_id=org_id where false`, `delete from public.${table} where false`]) await deny(() => connection.exec(command), { code: '42501' }, `${role} direct ${table} operation is denied`);
    }
  }
  for (const row of signatures) equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') as allowed", [row.signature])).rows[0].allowed, true, 'service role retains required RPC access');

  await settle();
  await enqueue(macA); await enqueue(macA);
  const admission = await race(tx => claim(macA, tx), peer => claim(macA, peer, true), 'same-node admission through v4 and legacy wrapper');
  ok(admission.winner?.lease_id, 'first same-node admission receives one lease');
  equal(admission.value, null, 'legacy gateway cannot exceed one active lease');
  await settle();
  const pair = randomUUID();
  await service.query('insert into public.ops_compute_pairs(id,org_id,name,node_ids) values($1,$2,$3,$4)', [pair, ORG, 'Native proof pair', [macA, macB]]);
  await enqueue(macA);
  let reservation = randomUUID();
  const reservationFirst = await race(tx => reserve(pair, reservation, tx), peer => claim(macA, peer, true), 'pair reservation wins ordinary claim race');
  equal(reservationFirst.value, null, 'committed reservation blocks older gateway claim');
  await release(reservation, [macA, macB]);
  reservation = randomUUID();
  const claimFirst = await race(tx => claim(macA, tx), peer => reserve(pair, reservation, peer), 'ordinary claim drains before reservation');
  equal(claimFirst.value.active_leases, 1, 'reservation observes the committed existing lease');
  await settle(); await release(reservation, [macA, macB]);
  reservation = randomUUID(); await reserve(pair, reservation);
  await service.query("update public.ops_compute_pair_reservations set expires_at=clock_timestamp()-interval '1 second' where reservation_id=$1", [reservation]);
  const renewal = await race(tx => reserve(pair, reservation, tx), peer => reconcile(peer), 'renewal wins expiry-recovery wait');
  equal(renewal.value.count, 0, 'reconciler rechecks renewed authority after pair lock');
  const pairRelease = await race(tx => release(reservation, [macA, macB], tx), peer => pairEnqueue(reservation, macA, peer), 'release fences blocked pair enqueue');
  ok(pairRelease.error?.message.includes('PAIR_RESERVATION_LOST'), 'released pair cannot gain an orphaned command');
  reservation = randomUUID(); await reserve(pair, reservation); await enqueue(macA);
  const held = await race(tx => release(reservation, [], tx), peer => claim(macA, peer, true), 'uncertain cleanup blocks ordinary admission');
  equal(held.value, null, 'persistent cleanup hold blocks legacy claim');
  for (const node of [macA, macB]) {
    await deny(() => rpc('compute_resume_owner_device', [ORG, node], ['uuid', 'text']), /DEVICE_PAIR_CLEANUP_REQUIRED/, 'owner resume cannot clear cleanup hold');
    ok(await rpc('compute_ack_pair_cleanup', [node, reservation, { schema: 'mccluster-pair-cleanup/1', runtime: 'exo', unloaded: true, model_instances: 0, observed_at: new Date(Date.now() + 1000).toISOString() }], ['text', 'uuid', 'jsonb']), 'matching cleanup receipt clears only the hold');
    await rpc('compute_resume_owner_device', [ORG, node], ['uuid', 'text']);
  }
  await settle();

  const ownerClient = await session('authenticated'), memberClient = await session('authenticated');
  await ownerClient.query("select set_config('request.jwt.claim.sub',$1,false)", [OWNER]);
  await memberClient.query("select set_config('request.jwt.claim.sub',$1,false)", [MEMBER]);
  const thread = randomUUID();
  await ownerClient.query('insert into public.ops_ai_threads(id,org_id,title) values($1,$2,$3)', [thread, ORG, 'Native proof']);
  equal((await memberClient.query('select id from public.ops_ai_threads where id=$1', [thread])).rows.length, 0, 'canonical RLS hides owner conversation from an ordinary member');
  const sameTurn = randomUUID();
  const submission = await race(tx => turn(thread, macA, sameTurn, randomUUID(), tx), peer => turn(thread, macB, sameTurn, randomUUID(), peer), 'same-ID conflicting turn submission');
  ok(submission.error?.message.includes('AI_TURN_ID_CONFLICT'), 'conflicting simultaneous route cannot adopt first turn');
  equal((await service.query('select metadata from public.ops_ai_messages where id=$1', [sameTurn])).rows[0].metadata.workspace_route.node_id, macA, 'original route remains authoritative');
  let receipt = await runTurn(await turn(thread, macA));
  const stoppedEnqueue = await race(tx => stop(receipt, tx), peer => enqueueTurn(receipt, macA, peer), 'stop wins enqueue race');
  ok(stoppedEnqueue.error?.message.includes('AI_TURN_LEASE_LOST'), 'stopped turn cannot enqueue after waiting');
  receipt = await runTurn(await turn(thread, macA));
  const queuedStop = await race(tx => enqueueTurn(receipt, macA, tx), peer => stop(receipt, peer), 'enqueue commits before stop');
  equal(queuedStop.value.stopped, true, 'stop observes and fences committed queued task');
  equal((await service.query('select status from public.ops_compute_tasks where id=$1', [queuedStop.winner.task.id])).rows[0].status, 'canceled', 'queued task remains canceled');
  receipt = await runTurn(await turn(thread, macA)); await enqueueTurn(receipt, macA);
  const claimedStop = await race(tx => claim(macA, tx), peer => stop(receipt, peer), 'stop waits on an admitted compute lease');
  equal(claimedStop.value.stopped, true, 'stop commits after native claim');
  equal((await service.query('select status from public.ops_compute_leases where id=$1', [claimedStop.winner.lease_id])).rows[0].status, 'canceled', 'stop fences the lease created during its wait');
  receipt = await runTurn(await turn(thread, macA));
  const stoppedComplete = await race(tx => stop(receipt, tx), peer => complete(receipt, thread, peer), 'stop wins answer completion');
  equal(stoppedComplete.value, false, 'late assistant completion cannot survive stop');
  receipt = await runTurn(await turn(thread, macA));
  const completedStop = await race(tx => complete(receipt, thread, tx), peer => stop(receipt, peer), 'answer completion wins stop');
  equal(completedStop.value.status, 'done', 'stop recognizes the already committed answer');

  await guard(workspaceRollback, 'WORKSPACE_ROLLBACK_DATA_PRESENT', 'workspace rollback refuses durable owner state');
  equal(await claimDefinition(), safeClaim, 'refused rollback retains safe claim wrapper');
  await settle();
  await db.query('delete from public.ops_compute_pair_reservations where org_id=$1', [ORG]);
  await db.query('delete from public.ops_compute_pairs where org_id=$1', [ORG]);
  await db.query('delete from public.ops_ai_threads where org_id=$1', [ORG]);
  await db.query('delete from public.ops_agent_jobs where org_id=$1', [ORG]);
  await db.query('delete from public.ops_compute_tasks where org_id=$1', [ORG]);
  await db.query('delete from public.ops_compute_enrollments where org_id=$1', [ORG]);
  await db.query('delete from public.ops_compute_nodes where org_id=$1', [ORG]);
  equal(await snapshot(), before, 'synthetic cleanup leaves every preexisting compute row byte-for-byte intact');
  // Fault injection is contained in an explicit transaction. A refused file
  // rolls it back, preserving the exact installed definitions for the next case.
  await db.exec('begin');
  try {
    for (const row of signatures.filter(row => !['compute_claim_task', 'compute_enroll_once'].includes(row.proname))) await db.exec(`drop function ${row.signature}`);
    await guard(workspaceRollback, 'COMPUTE_BASELINE_CHANGED', 'orphaned safe wrapper is not mistaken for a clean legacy baseline');
  } finally { await db.exec('rollback'); }
  equal(await claimDefinition(), safeClaim, 'partial-function refusal restores the original safe wrapper');
  await db.exec('begin');
  try {
    await db.exec('alter table public.ops_compute_nodes drop column pair_cleanup_details');
    await guard(workspaceRollback, 'COMPUTE_BASELINE_CHANGED', 'partial cleanup schema cannot be rolled back as a complete workspace');
  } finally { await db.exec('rollback'); }
  equal((await db.query("select count(*)::integer as n from information_schema.columns where table_schema='public' and table_name='ops_compute_nodes' and column_name in('pair_cleanup_required','pair_cleanup_details')")).rows[0].n, 2, 'refusal restores both cleanup columns');
  await db.query("update public.ops_compute_nodes set pair_cleanup_required=true,pair_cleanup_details='{\"synthetic_hold\":true}' where id=$1", [priorNodes[0].nodeId]);
  await guard(workspaceRollback, 'WORKSPACE_ROLLBACK_DATA_PRESENT', 'cleanup hold alone prevents unsafe scheduler rollback');
  equal((await db.query('select pair_cleanup_required from public.ops_compute_nodes where id=$1', [priorNodes[0].nodeId])).rows[0].pair_cleanup_required, true, 'refused rollback retains the cleanup fence');
  await db.query('update public.ops_compute_nodes set pair_cleanup_required=false,pair_cleanup_details=null where id=$1', [priorNodes[0].nodeId]);
  await migration(workspaceRollback);
  equal(await claimDefinition(), baselineClaim, 'clean workspace rollback restores exact original claim definition');
  equal(await claimPrivileges(), baselinePrivileges, 'clean workspace rollback preserves original claim owner and grants');
  const pending = await issue();
  await guard(enrollmentRollback, 'ENROLLMENT_ROLLBACK_DATA_PRESENT', 'enrollment rollback refuses even an unused credential record');
  equal((await service.query('select credential_hash from public.ops_compute_enrollments where id=$1', [pending.id])).rows[0].credential_hash, pending.credential_hash, 'refused enrollment rollback retains credential record');
  await db.query('delete from public.ops_compute_enrollments where id=$1', [pending.id]);
  await migration(enrollmentRollback);
  equal(await snapshot(), before, 'clean rollback preserves two historical nodes, 30 tasks and 40 leases');
  equal((await db.query("select to_regclass('public.ops_compute_enrollments') as enrollment,to_regclass('public.ops_compute_pairs') as pair,to_regprocedure('public.compute_claim_task_v4(text,text[],text[],integer)') as claim")).rows[0], { enrollment: null, pair: null, claim: null }, 'rollback removes only empty newly introduced objects');
  await migration(enrollmentFile); await migration(workspaceFile);
  equal(await claimDefinition(), safeClaim, 'reapply restores the same safe legacy claim wrapper');
  await migration(workspaceRollback); await migration(enrollmentRollback);
  equal(await snapshot(), before, 'reapply and second rollback preserve preexisting compute history');
  equal(await claimPrivileges(), baselinePrivileges, 'second rollback still preserves original claim privileges');
  console.log(JSON.stringify({ suite: 'owner-workspace-native', engine: (await db.query('select version() as version')).rows[0].version, checks, passed: true, concurrent_sessions: true, full_reset: fullReset, existing_history_preserved: { nodes: 2, tasks: 30, leases: 40 }, production_changes: false, physical_hardware_verified: false }));
} finally {
  for (const connection of clients) await connection.close();
  await db.close();
}
