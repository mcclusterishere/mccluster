// Native PostgreSQL 17 proof for optional Halo registration in the existing
// Equity Uprise shared-platform policy. No route activation or product access change.
// Default: disposable database with bounded identity fixtures and exact applied SQL.
// --full-reset: actual local Supabase reset, without substituting its base objects.
// Deliberate drift mutations are transient fault injections, rolled back after refusal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { nativeTestDb, resetMigrationPlan, waitForBlocked } from './native-admin-test-db.mjs';
import { ensureHouse, applyModulePolicy } from './test/support/eup-module-policy-database.mjs';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  const fullReset = process.argv.includes('--full-reset');
  assert.deepEqual(process.argv.slice(2), fullReset ? ['--full-reset'] : []);
  const files = {
    forward: 'supabase/pending/eup_module_policy_halo_v1.sql',
    rollback: 'supabase/pending/eup_module_policy_halo_v1.rollback.sql',
  };
  const forward = read(files.forward), rollback = read(files.rollback);
  const preflight = read('scripts/db/halo-module-policy-preflight.sql');
  const golden = JSON.parse(read('docs/control-plane/evidence/halo-policy-catalog-2026-11-24.json'));
  const original = JSON.parse(read('scripts/test/fixtures/eup-module-policy-halo-original.json'));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const gitBlob = value => createHash('sha1').update('blob ' + Buffer.byteLength(value) + '\0' + value).digest('hex');
  const owner = randomUUID(), member = randomUUID(), otherOrg = randomUUID();
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const ok = (value, label) => { assert.ok(value, label); checks++; };
  const deny = async (work, code, label) => { await assert.rejects(work, error => error.code === code, label); checks++; };
  const clients = new Set();

  async function openReset() {
    const url = new URL(process.env.NATIVE_TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.equal(url.port, '54322'); assert.equal(url.pathname, '/postgres');
    const { default: postgres } = await import(pathToFileURL(process.env.POSTGRES_MODULE_PATH));
    const options = { max: 1, onnotice: () => {}, connection: { application_name: 'halo-policy-proof', statement_timeout: 20000 } };
    const wrap = connection => ({
      query: async (sql, values = []) => ({ rows: await connection.unsafe(sql, values) }),
      exec: sql => connection.unsafe(sql),
      transaction: fn => connection.begin(tx => fn(wrap(tx))),
      close: () => connection.end(),
    });
    const database = wrap(postgres(url.href, options));
    database.fork = () => wrap(postgres(url.href, options));
    try {
      const plan = await resetMigrationPlan(root);
      equal(Array.from((await database.query('select version,name from supabase_migrations.schema_migrations order by version')).rows),
        plan.rows, 'full reset equals canonical ledger plus replay foundations');
      console.log(JSON.stringify({ baseline: 'full Supabase reset', production_migrations: plan.productionCount,
        replay_only_migrations: plan.replayOnlyCount, reset_migrations: plan.rows.length }));
      return database;
    } catch (error) { await database.close(); throw error; }
  }

  const db = fullReset ? await openReset() : await nativeTestDb('halo_policy');
  async function session(role) {
    const connection = db.fork(); clients.add(connection);
    if (role) { assert.ok(['anon', 'authenticated', 'service_role'].includes(role)); await connection.exec(`set role ${role}`); }
    return connection;
  }
  async function apply(sql, connection = db) {
    try { return await connection.exec(sql); }
    catch (error) { await connection.exec('rollback'); throw error; }
  }
  const catalog = async (connection = db) => (await connection.query(preflight)).rows[0];
  const fingerprint = async (connection = db) => (await catalog(connection)).fingerprints;
  const rows = async () => (await db.query(`select
    (select coalesce(jsonb_agg(to_jsonb(p) order by org_id,module_id),'[]'::jsonb) from public.eup_module_policies p) as policies,
    (select coalesce(jsonb_agg(to_jsonb(c) order by seq),'[]'::jsonb) from public.eup_module_policy_commands c) as commands`)).rows[0];
  const rpc = async (connection, name, values, types) => (await connection.query(
    `select public.${name}(${types.map((type, i) => `$${i + 1}::${type}`).join(',')}) as value`, values)).rows[0].value;
  const control = (connection, actor = owner) => rpc(connection, 'eup_module_control_read', [actor, 50], ['uuid', 'integer']);
  const install = (connection, module, actor = owner, key = `proof:${module}:${randomUUID()}`) =>
    rpc(connection, 'eup_module_policy_install', [actor, module, key, 'Synthetic native database proof'], ['uuid', 'text', 'text', 'text']);
  const command = (connection, module, state, revision, key = `proof:${module}:${randomUUID()}`, actor = owner) =>
    rpc(connection, 'eup_module_policy_command', [actor, module, state, revision, key, 'Synthetic native database proof'],
      ['uuid', 'text', 'text', 'bigint', 'text', 'text']);

  async function racedFile(holderWork, candidate, finishHolder, expectedCode, label) {
    const holder = await session(), contender = await session(), observer = await session();
    await holder.exec('begin');
    let pending;
    try {
      await holderWork(holder);
      pending = apply(candidate, contender).then(value => ({ value }), error => ({ error }));
      await waitForBlocked(observer); checks++;
      await holder.exec(finishHolder);
      const outcome = await pending;
      if (expectedCode) equal(outcome.error?.code, expectedCode, label);
      else { if (outcome.error) throw outcome.error; checks++; }
      console.log(`native lock wait verified: ${label}`);
    } finally { await holder.exec('rollback'); if (pending) await pending; }
  }

  try {
    const version = (await db.query("select current_setting('server_version_num')::int as version")).rows[0].version;
    ok(version >= 170000 && version < 180000, 'proof requires PostgreSQL 17, matching production catalog semantics');
    for (const direction of ['forward', 'rollback']) equal(gitBlob(original[direction].sql), original[direction].git_blob_sha, `${direction}: immutable original reference`);
    equal(gitBlob(read(golden.canonical_migration)), golden.canonical_git_blob_sha, 'canonical baseline bytes are pinned');
    if (!fullReset) {
      await ensureHouse(db, owner);
      await db.exec(`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
        alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
        alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
      await applyModulePolicy(db);
      console.log('bounded baseline: exact applied policy SQL; only auth.users/orgs/org_members are stand-ins');
    }
    equal((await catalog()).detail, golden.baseline_detail, 'entire reset/bounded baseline equals fresh production catalog');
    equal(await fingerprint(), golden.baseline, 'baseline fingerprints match production');
    const startingRows = await rows();
    equal(startingRows.policies, [], 'disposable policy tables start empty');
    equal(startingRows.commands, [], 'disposable command history starts empty');

    // The exact historical files accept unfamiliar function security and
    // Repeatable Read. The corrected candidates must reject both below.
    if (!fullReset) {
      for (const [name, text] of [['forward', original.forward.sql], ['rollback', original.rollback.sql]]) {
        if (name === 'rollback') await apply(original.forward.sql);
        await db.exec('alter function public.eup_module_control_read(uuid,integer) security invoker');
        await apply(text);
        equal(await fingerprint(), name === 'forward' ? golden.halo : golden.baseline,
          `original ${name} silently overwrites unknown function security drift`);
        await db.exec("set default_transaction_isolation = 'repeatable read'");
        await apply(text);
        await db.exec("set default_transaction_isolation = 'read committed'");
        checks++;
        console.log(`original defect reproduced: ${name} accepts Repeatable Read and unknown security drift`);
        await apply(original.rollback.sql);
      }
    }

    for (const [direction, sql] of Object.entries({ forward, rollback })) {
      for (const isolation of ['repeatable read', 'serializable']) {
        await db.exec(`set default_transaction_isolation = '${isolation}'`);
        await deny(() => apply(sql), '55000', `${direction} refuses ${isolation}`);
        await db.exec("set default_transaction_isolation = 'read committed'");
        equal(await fingerprint(), golden.baseline, `${direction} isolation refusal preserves schema`);
      }
    }

    const drifts = [
      ['RPC security', 'alter function public.eup_module_control_read(uuid,integer) security invoker'],
      ['RPC configuration', "alter function public.eup_module_policy_install(uuid,text,text,text) set search_path = public"],
      ['RPC body', "create or replace function public.eup_module_control_read(p_actor uuid,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin return '{}'::jsonb; end $$"],
      ['RPC grant', 'grant execute on function public.eup_module_control_read(uuid,integer) to anon'],
      ['guard function security', 'alter function public.eup_module_guard(text,bigint) security invoker'],
      ['table grant', 'grant select on public.eup_module_policies to authenticated'],
      ['column grant', 'grant select(module_id) on public.eup_module_policies to authenticated'],
      ['sequence grant', 'grant usage on sequence public.eup_module_policy_commands_seq_seq to service_role'],
      ['unknown constraint', "alter table public.eup_module_policies drop constraint eup_module_policies_module_id_check; alter table public.eup_module_policies add constraint eup_module_policies_module_id_check check (module_id in ('environment','league','intake','future'))"],
      ['unvalidated constraint', "alter table public.eup_module_policies drop constraint eup_module_policies_module_id_check; alter table public.eup_module_policies add constraint eup_module_policies_module_id_check check (module_id in ('environment','league','intake')) not valid"],
      ['disabled protection trigger', 'alter table public.eup_module_policies disable trigger eup_module_policies_no_truncate'],
      ['missing protection trigger', 'drop trigger eup_module_policy_commands_append_only on public.eup_module_policy_commands'],
      ['unknown column', 'alter table public.eup_module_policies add column future_field text'],
      ['disabled RLS', 'alter table public.eup_module_policy_commands disable row level security'],
      ['unexpected policy', 'create policy unexpected_halo_read on public.eup_module_policies for select to authenticated using(true)'],
      ['missing index', 'drop index public.eup_module_policy_commands_module_time'],
      ['unexpected overload', "create function public.eup_module_control_read(integer) returns jsonb language sql as $$ select '{}'::jsonb $$"],
    ];
    for (const [direction, sql] of Object.entries({ forward, rollback })) for (const [label, mutation] of drifts) {
      await db.exec('begin');
      await db.exec(mutation);
      await assert.rejects(() => apply(sql), error => error.code === '55000' && error.message.includes('HALO_CATALOG_DRIFT'), `${direction}: ${label}`); checks++;
      equal(await fingerprint(), golden.baseline, `${direction}: refused ${label} leaves original schema`);
    }
    await db.exec('begin');
    await db.exec(forward.slice(forward.indexOf('create or replace function public.eup_module_control_read('),
      forward.indexOf('create or replace function public.eup_module_policy_install(')));
    await deny(() => apply(forward), '55000', 'partial Halo deployment is refused');
    equal(await fingerprint(), golden.baseline, 'partial-state refusal is atomic');

    // Full-reset mode inserts only synthetic rows into existing canonical
    // identity tables. No role/table/auth-function stand-ins or grants run there.
    if (fullReset) {
      await db.query('insert into auth.users(id,email) values($1,$2)', [owner, `halo-owner-${owner}@example.test`]);
      await db.query("insert into public.org_members(org_id,profile_id,role) select id,$1,'owner' from public.orgs where slug='mccluster'", [owner]);
    }
    await db.query('insert into auth.users(id) values($1)', [member]);
    const house = (await db.query("select id from public.orgs where slug='mccluster'")).rows[0].id;
    await db.query("insert into public.org_members(org_id,profile_id,role) values($1,$2,'staff')", [house, member]);
    if (fullReset) await db.query("insert into public.orgs(id,slug,name) values($1,'halo-native-other','Synthetic Halo proof tenant')", [otherOrg]);
    else await db.query("insert into public.orgs(id,slug) values($1,'halo-native-other')", [otherOrg]);
    const service = await session('service_role');
    for (const module of ['environment', 'league', 'intake']) {
      await install(service, module);
      await command(service, module, 'enabled', 0);
    }
    const nonHalo = await rows();
    await deny(() => install(service, 'halo'), '22023', 'Halo install fails before extension');
    equal((await control(service)).modules.map(item => item.moduleId), ['environment', 'league', 'intake'], 'baseline has three units');
    await apply(forward); await apply(forward);
    equal(await fingerprint(), golden.halo, 'exact candidate applies and reruns');
    equal(await rows(), nonHalo, 'promotion and rerun preserve every existing row and receipt');
    const overview = await control(service);
    equal(overview.modules.map(item => item.moduleId), ['environment', 'league', 'intake', 'halo'], 'Halo is listed fourth');
    equal(overview.modules.at(-1).installed, false, 'promotion creates no Halo policy row');

    // Exercise each half of recovery's OR independently, without deleting
    // append-only history. The refused transaction removes only its test insert.
    await db.exec('begin');
    await db.query("insert into public.eup_module_policies(org_id,module_id,state,updated_by) values($1,'halo','disabled',$2)", [house, owner]);
    await deny(() => apply(rollback), '55000', 'policy-only Halo row prevents recovery');
    equal(await rows(), nonHalo, 'policy-only refusal rolls its synthetic row back');
    await db.exec('begin');
    await db.query("insert into public.eup_module_policy_commands(org_id,idempotency_key,actor,module_id,command,requested_state,reason,payload_digest,receipt) values($1,'halo:history:only',$2,'halo','install','disabled','Synthetic history-only proof',repeat('a',64),'{}')", [house, owner]);
    await deny(() => apply(rollback), '55000', 'command-only Halo history prevents recovery');
    equal(await rows(), nonHalo, 'history-only refusal rolls its synthetic row back');
    await apply(rollback); await apply(rollback);
    equal(await fingerprint(), golden.baseline, 'empty-Halo recovery and rerun restore exact baseline');
    equal(await rows(), nonHalo, 'recovery preserves all other modules and history');
    await apply(forward);
    equal(await fingerprint(), golden.halo, 'extension reapplies after safe recovery');

    for (const role of ['anon', 'authenticated']) {
      const client = await session(role);
      await deny(() => control(client), '42501', `${role} cannot call control RPC`);
      await deny(() => install(client, 'halo'), '42501', `${role} cannot install even with owner argument`);
      await deny(() => command(client, 'halo', 'enabled', 0), '42501', `${role} cannot command even with owner argument`);
      await deny(() => client.query('select * from public.eup_module_policies'), '42501', `${role} cannot read private policy rows`);
    }
    for (const actor of [member, null]) {
      await deny(() => control(service, actor), '42501', 'service RPC rechecks owner identity');
      await deny(() => install(service, 'halo', actor), '42501', 'non-owner cannot install through service RPC');
      await deny(() => command(service, 'halo', 'enabled', 0, `proof:${randomUUID()}`, actor), '42501', 'non-owner cannot change through service RPC');
    }
    for (const sql of [
      'select * from public.eup_module_policies', 'delete from public.eup_module_policy_commands',
      'truncate public.eup_module_policies', "select nextval('public.eup_module_policy_commands_seq_seq')",
    ]) await deny(() => service.exec(sql), '42501', 'service role only has reviewed RPC grants');
    for (const sql of ['delete from public.eup_module_policies', 'truncate public.eup_module_policies',
      'delete from public.eup_module_policy_commands', 'truncate public.eup_module_policy_commands'])
      await deny(() => db.exec(sql), '42501', 'existing immutable guards still refuse privileged deletion');

    await racedFile(holder => holder.exec(forward.replace(/commit;\s*$/, '')), rollback, 'commit', undefined,
      'forward completes before concurrent recovery');
    equal(await fingerprint(), golden.baseline, 'serialized forward/recovery ends at baseline');
    await racedFile(holder => holder.exec(rollback.replace(/commit;\s*$/, '')), forward, 'commit', undefined,
      'recovery completes before concurrent forward');
    equal(await fingerprint(), golden.halo, 'serialized recovery/forward ends at Halo');

    await racedFile(holder => holder.exec('alter table public.eup_module_policies add column concurrent_drift text'),
      forward, 'commit', '55000', 'fresh catalog detects DDL committed during table-lock wait');
    await db.exec('alter table public.eup_module_policies drop column concurrent_drift');
    equal(await fingerprint(), golden.halo, 'DDL refusal left extension unchanged');

    const lockHolder = await session(), contender = await session();
    await lockHolder.exec('begin; lock table public.eup_module_policies in access share mode');
    const started = Date.now();
    try { await deny(() => apply(forward, contender), '55P03', 'five-second lock timeout refuses busy-table promotion'); }
    finally { await lockHolder.exec('rollback'); }
    ok(Date.now() - started >= 4500 && Date.now() - started < 12000, 'lock wait is bounded by the actual migration timeout');
    equal(await fingerprint(), golden.halo, 'lock timeout preserves schema');
    equal(await rows(), nonHalo, 'lock timeout preserves every original policy and history row');

    await racedFile(async holder => {
      await holder.exec('set local role service_role');
      await install(holder, 'halo', owner, 'proof:halo:install');
    }, rollback, 'commit', '55000', 'recovery waits for in-flight install, then refuses its history');
    const installed = await rows();
    equal(installed.policies.filter(row => row.module_id !== 'halo'), nonHalo.policies, 'concurrent install preserves other policy rows');
    equal(installed.commands.filter(row => row.module_id !== 'halo'), nonHalo.commands, 'concurrent install preserves other command receipts');
    const receipt = await install(service, 'halo', owner, 'proof:halo:install');
    equal(receipt.policy.state, 'disabled', 'new Halo policy is disabled');
    equal(receipt.policy.revision, 0, 'new Halo policy is revision zero');
    equal(await rows(), installed, 'same install key replays without another command');
    await deny(() => install(service, 'halo'), 'EUM07', 'another install key cannot replace policy');
    await deny(() => command(service, 'halo', 'enabled', 5), '40001', 'stale revision is refused');
    const enabled = await command(service, 'halo', 'enabled', 0, 'proof:halo:enable');
    equal(enabled.policy.revision, 1, 'enable moves revision once');
    equal(await command(service, 'halo', 'enabled', 0, 'proof:halo:enable'), enabled, 'state command exact replay returns same receipt');
    await deny(() => command(service, 'halo', 'draining', 1, 'proof:halo:enable'), 'EUM06', 'changed payload cannot reuse command key');
    await deny(() => command(service, 'halo', 'disabled', 1), 'EUM05', 'enabled policy requires drain before disable');
    const drained = await command(service, 'halo', 'draining', 1);
    equal(drained.policy.revision, 2, 'drain moves revision');
    const disabled = await command(service, 'halo', 'disabled', 2);
    equal(disabled.policy.revision, 3, 'disable moves revision');
    await deny(() => service.query("select public.eup_module_guard('halo')"), 'EUM03', 'existing guard sees disabled Halo');
    equal(Number((await service.query("select public.eup_module_guard_reduce('halo') as revision")).rows[0].revision), 3, 'existing reduce-only guard works');

    await db.exec('begin isolation level repeatable read');
    equal((await db.query("select count(*)::int as n from public.eup_module_policies where org_id=$1", [otherOrg])).rows[0].n, 0,
      'old snapshot starts before concurrent policy');
    const fresh = await session();
    await fresh.query("insert into public.eup_module_policies(org_id,module_id,state,updated_by) values($1,'halo','disabled',$2)", [otherOrg, owner]);
    equal((await db.query("select count(*)::int as n from public.eup_module_policies where org_id=$1", [otherOrg])).rows[0].n, 0,
      'old snapshot cannot see newly committed policy');
    await assert.rejects(() => apply(rollback), error => error.code === '55000' && error.message.includes('HALO_READ_COMMITTED_REQUIRED')); checks++;
    equal((await db.query("select count(*)::int as n from public.eup_module_policies where org_id=$1", [otherOrg])).rows[0].n, 1,
      'refused recovery preserves concurrently committed policy');
    const finalRows = await rows();
    await deny(() => apply(rollback), '55000', 'durable Halo history prevents normal recovery');
    await apply(forward);
    equal(await rows(), finalRows, 'refused recovery and forward rerun preserve every row');
    equal(await fingerprint(), golden.halo, 'all catalog protections remain exact');
    const report = { status: 'passed', checks, full_reset: fullReset, server_version_num: version,
      original_defects_reproduced: fullReset ? [] : ['forward and recovery overwrite unknown function security drift', 'forward and recovery accept Repeatable Read'],
      production_changed: false, optional_registration_only: true,
      files: Object.fromEntries(Object.values(files).map(file => [file, hash(read(file))])),
      baseline_fingerprints: golden.baseline, final_fingerprints: golden.halo };
    if (process.env.HALO_PROOF_REPORT) fs.writeFileSync(process.env.HALO_PROOF_REPORT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.exec('rollback; reset role; reset default_transaction_isolation').catch(() => {});
    for (const connection of clients) { await connection.exec('rollback').catch(() => {}); await connection.close(); }
    await db.close();
  }
}

await main();
