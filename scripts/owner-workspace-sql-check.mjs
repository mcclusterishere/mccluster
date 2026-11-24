// Real repository SQL against a disposable PostgreSQL/PGlite database. This
// proves state transitions and role permissions, not native multi-session
// lock scheduling or physical Mac/distributed-runtime performance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createOwnerWorkspaceDatabase, WORKSPACE_FIXTURE_ORG as ORG, WORKSPACE_FIXTURE_OWNER as OWNER, WORKSPACE_FIXTURE_MEMBER as MEMBER } from '../core/test/helpers/owner-workspace-db.mjs';
import { generateNodeIdentity } from '../core/src/compute/signature.mjs';

const db = await createOwnerWorkspaceDatabase();
const AI = { capability: 'ai.chat', implementation: 'qwen3.8b.local', model: 'qwen3:8b', max_concurrency: 1 };
const PAIR = { capability: 'compute.pair.control', implementation: 'exo.mlx.local', max_concurrency: 1 };
let assertions = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
function ok(value, message) { assert.ok(value, message); assertions++; }
async function rejects(action, pattern, message) { await assert.rejects(action, pattern, message); assertions++; }
async function sql(text, values = [], { role = 'service_role', user = '' } = {}) {
  return db.transaction(async tx => {
    if (!['service_role', 'authenticated', 'anon'].includes(role)) throw new Error('Bad fixture role');
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    return tx.query(text, values);
  });
}
async function rpc(name, values, types) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Bad fixture function');
  const params = values.map((value, i) => types[i] === 'jsonb' ? JSON.stringify(value) : value);
  return (await sql(`select public.${name}(${types.map((type, i) => `$${i + 1}::${type}`).join(',')}) as r`, params)).rows[0].r;
}
async function node(name, platform = 'darwin') {
  const identity = generateNodeIdentity();
  await sql(`insert into public.ops_compute_nodes(id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version,state,inventory,capabilities,labels,max_leases,last_seen_at)
    values($1,$2,$3,$4,$5,'mccluster-compute/1','sql-fixture','online',$6::jsonb,$7::jsonb,'{"trust":"owned","enrolled_trust":"owned"}',1,clock_timestamp())`,
  [identity.nodeId, ORG, name, identity.publicKeyPem, identity.fingerprint, JSON.stringify({ platform, arch: platform === 'darwin' ? 'arm64' : 'x64', memory_bytes: 17179869184 }), JSON.stringify(platform === 'darwin' ? [AI, PAIR] : [AI])]);
  return identity.nodeId;
}
async function enqueue({ requirements = {}, metadata = {}, capability = AI.capability, implementation = AI.implementation, input = {}, priority = 100 } = {}) {
  return (await rpc('compute_enqueue_task', [ORG, capability, implementation, input, requirements, priority, null, 3, metadata, `fixture:${randomUUID()}`], ['uuid', 'text', 'text', 'jsonb', 'jsonb', 'integer', 'timestamptz', 'integer', 'jsonb', 'text'])).task;
}
const claim = (id, legacy = false) => rpc(legacy ? 'compute_claim_task' : 'compute_claim_task_v4', [id, ['ai.chat', 'compute.pair.control'], ['qwen3.8b.local', 'exo.mlx.local'], 120], ['text', 'text[]', 'text[]', 'integer']);
const start = lease => rpc('compute_start_lease', [lease.node_id, lease.lease_id, lease.lease_token], ['text', 'uuid', 'text']);
const finish = (lease, output = { content: 'Fixture answer.' }) => rpc('compute_complete_lease', [lease.node_id, lease.lease_id, lease.lease_token, output], ['text', 'uuid', 'text', 'jsonb']);
const heartbeat = lease => rpc('compute_heartbeat_lease', [lease.node_id, lease.lease_id, lease.lease_token], ['text', 'uuid', 'text']);
const status = async (table, id) => (await sql(`select status from public.${table} where id=$1`, [id])).rows[0]?.status;
const nodeState = async id => (await sql('select state from public.ops_compute_nodes where id=$1', [id])).rows[0].state;
async function settle() {
  await sql("update public.ops_compute_leases set status='canceled' where status in('leased','running')");
  await sql("update public.ops_compute_tasks set status='canceled',locked_by_node_id=null,locked_at=null where status in('queued','leased','running')");
}
const reserve = (pair, reservation) => rpc('compute_reserve_pair', [ORG, pair, reservation, 900], ['uuid', 'uuid', 'uuid', 'integer']);
const release = (reservation, clean) => rpc('compute_release_pair', [ORG, reservation, clean], ['uuid', 'uuid', 'text[]']);
const resume = nodeId => rpc('compute_resume_owner_device', [ORG, nodeId], ['uuid', 'text']);
const cleanup = (nodeId, reservation, override = {}) => rpc('compute_ack_pair_cleanup', [nodeId, reservation, { schema: 'mccluster-pair-cleanup/1', runtime: 'exo', unloaded: true, model_instances: 0, observed_at: new Date(Date.now() + 1000).toISOString(), ...override }], ['text', 'uuid', 'jsonb']);
const pairTask = (reservation, nodeId, action = 'probe') => ({ capability: PAIR.capability, implementation: PAIR.implementation, input: { action }, requirements: { node_id: nodeId, pair_reservation_id: reservation }, metadata: { source: 'fixture' }, max_attempts: 1 });
const pairEnqueue = (reservation, task) => rpc('compute_enqueue_pair_task', [ORG, reservation, task, `pair-fixture:${randomUUID()}`], ['uuid', 'uuid', 'jsonb', 'text']);
const route = nodeId => ({ mode: 'node', node_id: nodeId, implementation: 'qwen3.8b.local' });
async function turn(threadId, nodeId, { id = randomUUID(), assistant = randomUUID(), text = 'Fixture conversation', extra = {} } = {}) {
  const metadata = { workspace_route: route(nodeId), input_mode: 'text', actor_kind: 'owner', actor_user_id: OWNER, allow_browser: false, ...extra };
  const receipt = await rpc('ops_ai_submit_workspace_turn', [ORG, threadId, id, assistant, text, metadata], ['uuid', 'uuid', 'uuid', 'uuid', 'text', 'jsonb']);
  return { ...receipt, metadata, text, threadId, id };
}
async function runTurn(turn, attempt = 1, lease = 'fixture-core-lease') {
  await sql("update public.ops_agent_jobs set status='running',attempts=$2,locked_by=$3,locked_at=clock_timestamp() where id=$1", [turn.id, attempt, lease]);
  return { attempt, lease };
}
const routedTask = nodeId => ({ capability: AI.capability, implementation: AI.implementation, requirements: { node_id: nodeId }, input: { prompt: 'Fixture', num_ctx: 4096 }, metadata: { source: 'owner-ai-workspace' }, max_attempts: 3 });
const workspaceEnqueue = (turn, authority, task, key = `owner:${turn.id}:0`) => rpc('ops_ai_enqueue_workspace_task', [ORG, turn.id, authority.lease, authority.attempt, task, key], ['uuid', 'uuid', 'text', 'integer', 'jsonb', 'text']);
const stop = turn => rpc('ops_ai_stop_workspace_turn', [ORG, turn.id], ['uuid', 'uuid']);
const checkpoint = (turn, authority) => rpc('ops_ai_checkpoint_workspace_turn', [ORG, turn.id, authority.lease, authority.attempt, { task_status: 'running' }], ['uuid', 'uuid', 'text', 'integer', 'jsonb']);
const completeTurn = (turn, authority) => rpc('ops_ai_complete_workspace_turn', [ORG, turn.id, authority.lease, authority.attempt, { id: turn.assistant_message_id, thread_id: turn.threadId, content: 'Fixture final answer.', model: 'qwen3:8b', implementation: AI.implementation, metadata: {} }], ['uuid', 'uuid', 'text', 'integer', 'jsonb']);

try {
  const [macA, macB, ovh, laptop] = await Promise.all([node('Fixture Mac A'), node('Fixture Mac B'), node('Fixture OVH', 'linux'), node('Fixture laptop', 'linux')]);
  const pinned = await enqueue({ requirements: { node_id: macA } });
  equal(await claim(macB), null, 'another Mac cannot steal a pinned task');
  equal(await claim(ovh, true), null, 'legacy claim wrapper also enforces node pinning');
  const lease = await claim(macA);
  equal(lease.task_id, pinned.id, 'the selected Mac receives the task');
  equal(await claim(macA), null, 'one-active-job admission applies to the selected Mac');
  ok(await start(lease), 'the selected Mac starts its lease');
  equal(await finish(lease), true, 'selected worker completes');

  await enqueue({ requirements: { node_id: macA } });
  await enqueue({ requirements: { node_id: macB } });
  const parallel = await Promise.all([claim(macA), claim(macB)]);
  equal(new Set(parallel.map(item => item.node_id)).size, 2, 'independent jobs occupy different workers at once');
  equal((await sql("select count(*)::integer as n from public.ops_compute_leases where status='leased'")).rows[0].n, 2, 'both independent leases are active');
  for (const item of parallel) { await start(item); await finish(item); }

  const pairId = randomUUID();
  await sql('insert into public.ops_compute_pairs(id,org_id,name,node_ids) values($1,$2,$3,$4)', [pairId, ORG, 'Fixture pair', [macA, macB]]);
  const earlier = await enqueue({ requirements: { node_id: macA } });
  const earlierLease = await claim(macA); await start(earlierLease);
  equal(earlierLease.task_id, earlier.id, 'ordinary work starts before pair reservation');
  const waiting = await enqueue({ requirements: { node_id: macB } });
  const unrelatedOvh = await enqueue({ requirements: { node_id: ovh } });
  const unrelatedLaptop = await enqueue({ requirements: { node_id: laptop } });
  const reservation = randomUUID();
  equal((await reserve(pairId, reservation)).active_leases, 1, 'pair reservation drains an existing ordinary job');
  equal((await sql('select state from public.ops_compute_pairs where id=$1', [pairId])).rows[0].state, 'draining', 'pair exposes draining state');
  equal(await claim(macB, true), null, 'reserved partner cannot admit an ordinary job through legacy RPC');
  equal((await claim(ovh)).task_id, unrelatedOvh.id, 'OVH remains available while the Macs are reserved');
  equal((await claim(laptop)).task_id, unrelatedLaptop.id, 'the laptop remains available while the Macs are reserved');
  ok(await heartbeat(earlierLease), 'existing Mac work keeps lease authority while the pair drains');
  equal(await finish(earlierLease), true, 'existing ordinary work finishes before pair control');
  const probe = (await pairEnqueue(reservation, pairTask(reservation, macA))).task;
  const queuedPair = (await pairEnqueue(reservation, pairTask(reservation, macB, 'prepare'))).task;
  const probeLease = await claim(macA, true); await start(probeLease);
  equal(probeLease.task_id, probe.id, 'reservation command is admitted on its pinned member');
  await rejects(() => release(reservation, [macA, macA]), /PAIR_CLEANUP_IDS_INVALID/, 'duplicate IDs cannot impersonate two cleanup receipts');
  await rejects(() => release(reservation, [macA, ovh]), /PAIR_CLEANUP_IDS_INVALID/, 'an unrelated worker cannot count as pair cleanup');
  const released = await release(reservation, [macA]);
  equal(released.paused_node_ids, [macB], 'the unconfirmed partner pauses before its reservation is removed');
  equal(await nodeState(macA), 'online', 'confirmed clean member remains eligible');
  equal(await nodeState(macB), 'draining', 'uncertain model memory blocks ordinary work');
  await rejects(() => resume(macB), /DEVICE_PAIR_CLEANUP_REQUIRED/, 'Resume cannot bypass an unconfirmed pair cleanup hold');
  equal(await status('ops_compute_tasks', probe.id), 'canceled', 'release fences running pair work');
  equal(await status('ops_compute_tasks', queuedPair.id), 'canceled', 'release cancels unclaimed pair work');
  equal(await status('ops_compute_tasks', waiting.id), 'queued', 'unrelated queued ordinary work is preserved');
  equal(await finish(probeLease), false, 'released pair task cannot publish late output');
  await rejects(() => pairEnqueue(reservation, pairTask(reservation, macA)), /PAIR_RESERVATION_LOST/, 'released reservation cannot accept orphaned commands');
  equal((await sql('select count(*)::integer as n from public.ops_compute_pair_reservations')).rows[0].n, 0, 'both reservation rows are released');
  equal((await release(reservation, [macA])).already_released, true, 'pair release is idempotent after a lost response');
  equal(await cleanup(macB, randomUUID()), null, 'cleanup receipt for another reservation cannot clear hold');
  equal(await cleanup(macB, reservation, { observed_at: new Date(Date.now() - 600_000).toISOString() }), null, 'stale cleanup evidence cannot clear hold');
  equal(await cleanup(macB, reservation, { model_instances: 1 }), null, 'loaded model cannot be acknowledged as clean');
  await sql("update public.ops_compute_nodes set state='online' where id=$1", [macB]);
  equal(await claim(macB), null, 'scheduler independently enforces recovery hold even if state is changed');
  await rejects(() => reserve(pairId, randomUUID()), /PAIR_DEVICE_UNAVAILABLE/, 'held device cannot enter another pair');
  equal((await cleanup(macB, reservation)).cleanup_confirmed, true, 'fresh matching local cleanup receipt clears hold');
  equal(await nodeState(macB), 'draining', 'cleanup receipt never resumes the worker automatically');
  equal((await resume(macB)).state, 'online', 'owner can resume after local cleanup is confirmed');
  await settle();
  const cleanReservation = randomUUID(); await reserve(pairId, cleanReservation);
  equal((await release(cleanReservation, [macB, macA])).paused_node_ids, [], 'complete exact cleanup set releases both Macs without pausing');
  equal(await nodeState(macB), 'online', 'clean partner remains online');

  const expiredReservation = randomUUID(); await reserve(pairId, expiredReservation);
  const expiredTask = (await pairEnqueue(expiredReservation, pairTask(expiredReservation, macA))).task;
  const expiredLease = await claim(macA); await start(expiredLease);
  await sql("update public.ops_compute_pair_reservations set expires_at=clock_timestamp()-interval '1 second' where reservation_id=$1", [expiredReservation]);
  await enqueue({ requirements: { node_id: macB } });
  equal(await claim(macB), null, 'an expired reservation remains closed until safe reconciliation');
  const reconciled = await rpc('compute_reconcile_expired_pairs', [ORG], ['uuid']);
  equal(reconciled.count, 1, 'expired reservation is recovered after coordinator crash');
  equal([await nodeState(macA), await nodeState(macB)], ['draining', 'draining'], 'crash recovery pauses both unconfirmed workers');
  equal(await status('ops_compute_tasks', expiredTask.id), 'canceled', 'crash recovery cancels remaining pair task');
  equal(await heartbeat(expiredLease), null, 'expired recovered pair lease loses authority');
  equal((await rpc('compute_reconcile_expired_pairs', [ORG], ['uuid'])).count, 0, 'reservation recovery is idempotent');
  await settle();
  for (const id of [macA, macB]) {
    await rejects(() => resume(id), /DEVICE_PAIR_CLEANUP_REQUIRED/, 'crash hold survives ordinary Resume');
    equal((await cleanup(id, expiredReservation)).cleanup_confirmed, true, 'each worker confirms its own crash cleanup');
    await resume(id);
  }
  const renewedReservation = randomUUID(); await reserve(pairId, renewedReservation);
  equal((await rpc('compute_reconcile_expired_pairs', [ORG], ['uuid'])).count, 0, 'unexpired reservations are not reconciled');
  await release(renewedReservation, [macA, macB]);
  await sql("update public.ops_compute_nodes set state='revoked',revoked_at=clock_timestamp() where id=$1", [macB]);
  await rejects(() => reserve(pairId, randomUUID()), /PAIR_DEVICE_UNAVAILABLE/, 'revoked partner cannot be reserved');
  equal((await sql('select count(*)::integer as n from public.ops_compute_pair_reservations')).rows[0].n, 0, 'failed pair admission cannot reserve only one worker');
  await sql("update public.ops_compute_nodes set state='online',revoked_at=null where id=$1", [macB]);

  const threadId = randomUUID();
  await sql('insert into public.ops_ai_threads(id,org_id,title) values($1,$2,$3)', [threadId, ORG, 'Fixture owner thread'], { role: 'authenticated', user: OWNER });
  equal((await sql('select id from public.ops_ai_threads where id=$1', [threadId], { role: 'authenticated', user: OWNER })).rows.length, 1, 'real canonical RLS permits the house owner to see their thread');
  equal((await sql('select id from public.ops_ai_threads where id=$1', [threadId], { role: 'authenticated', user: MEMBER })).rows.length, 0, 'real canonical RLS hides the owner thread from a member');
  await rejects(() => sql('insert into public.ops_ai_threads(org_id,title) values($1,$2)', [ORG, 'Forbidden'], { role: 'authenticated', user: MEMBER }), { code: '42501' }, 'member cannot create an owner thread');
  for (const role of ['anon', 'authenticated']) {
    for (const signature of ['ops_ai_submit_workspace_turn(uuid,uuid,uuid,uuid,text,jsonb)', 'ops_ai_enqueue_workspace_task(uuid,uuid,text,integer,jsonb,text)', 'ops_ai_stop_workspace_turn(uuid,uuid)', 'compute_reserve_pair(uuid,uuid,uuid,integer)', 'compute_release_pair(uuid,uuid,text[])', 'compute_enqueue_pair_task(uuid,uuid,jsonb,text)', 'compute_reconcile_expired_pairs(uuid)', 'compute_resume_owner_device(uuid,text)', 'compute_ack_pair_cleanup(text,uuid,jsonb)']) {
      equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as r', [role, `public.${signature}`])).rows[0].r, false, `${role} cannot bypass the signed owner API through ${signature}`);
    }
  }

  const first = await turn(threadId, macA);
  const replay = await turn(threadId, macA, { id: first.id });
  equal(replay.assistant_message_id, first.assistant_message_id, 'turn retry returns the original assistant identity');
  await rejects(() => turn(threadId, macB, { id: first.id }), /AI_TURN_ID_CONFLICT/, 'same turn ID cannot change its pinned worker');
  await rejects(() => turn(threadId, macA, { id: first.id, extra: { review_of_turn_id: randomUUID() } }), /AI_TURN_ID_CONFLICT/, 'same turn ID cannot change its review source');
  await rejects(() => turn(threadId, macA, { id: first.id, extra: { images: ['fixture-image'] } }), /AI_TURN_ID_CONFLICT/, 'same turn ID cannot change attachments');
  equal((await sql('select metadata from public.ops_ai_messages where id=$1', [first.id])).rows[0].metadata.workspace_route.node_id, macA, 'conflicting retry leaves original route intact');
  const authority = await runTurn(first);
  await rejects(() => workspaceEnqueue(first, { ...authority, lease: 'stale' }, routedTask(macA)), /AI_TURN_LEASE_LOST/, 'stale Core lease cannot queue work');
  await rejects(() => workspaceEnqueue(first, { ...authority, attempt: null }, routedTask(macA)), /AI_TURN_LEASE_LOST/, 'missing attempt cannot bypass the fence');
  const queued = await workspaceEnqueue(first, authority, routedTask(macA));
  equal(queued.task.metadata.turn_id, first.id, 'SQL pins the task to its durable turn');
  equal((await workspaceEnqueue(first, authority, routedTask(macA))).task.id, queued.task.id, 'atomic task enqueue is idempotent');
  equal((await sql('select metadata from public.ops_ai_messages where id=$1', [first.id])).rows[0].metadata.active_compute_task_id, queued.task.id, 'enqueue atomically persists its active task receipt');
  equal((await stop(first)).stopped, true, 'owner stop cancels queued turn');
  equal(await status('ops_compute_tasks', queued.task.id), 'canceled', 'stop cancels queued compute work');
  await rejects(() => workspaceEnqueue(first, authority, routedTask(macA), `owner:${first.id}:1`), /AI_TURN_LEASE_LOST/, 'no enqueue can follow an owner stop');
  equal(await checkpoint(first, authority), false, 'late progress cannot overwrite stopped state');
  equal(await completeTurn(first, authority), false, 'late Core answer cannot appear after owner stop');
  equal((await stop(first)).status, 'canceled', 'repeated stop converges');

  const running = await turn(threadId, macA); const runningAuthority = await runTurn(running);
  const runningTask = (await workspaceEnqueue(running, runningAuthority, routedTask(macA))).task;
  const runningLease = await claim(macA); await start(runningLease);
  equal(runningLease.task_id, runningTask.id, 'routed turn owns the live compute lease');
  equal(await checkpoint(running, runningAuthority), true, 'current Core authority can publish progress');
  await stop(running);
  equal(await status('ops_compute_leases', runningLease.lease_id), 'canceled', 'stop fences a live worker lease');
  equal(await finish(runningLease), false, 'worker result after stop is rejected by existing lease rules');
  equal(await completeTurn(running, runningAuthority), false, 'stopped turn cannot publish assistant answer');

  const reclaimed = await turn(threadId, macA); const oldAuthority = await runTurn(reclaimed);
  const newAuthority = await runTurn(reclaimed, 2, 'new-core-lease');
  await rejects(() => workspaceEnqueue(reclaimed, oldAuthority, routedTask(macA)), /AI_TURN_LEASE_LOST/, 'replaced Core attempt cannot enqueue');
  equal(await checkpoint(reclaimed, oldAuthority), false, 'replaced Core attempt cannot checkpoint');
  equal(await completeTurn(reclaimed, oldAuthority), false, 'replaced Core attempt cannot complete');
  equal(await completeTurn(reclaimed, newAuthority), true, 'current Core attempt can persist its answer');
  equal((await stop(reclaimed)).status, 'done', 'stop observes a committed answer instead of relabeling it canceled');
  await rejects(() => workspaceEnqueue(reclaimed, newAuthority, routedTask(macA)), /AI_TURN_ALREADY_COMPLETED/, 'completed answer prevents further inference rounds');

  // Re-run the unchanged existing lease-authority behavior suite after this
  // pending workspace SQL replaces the legacy claim implementation.
  await db.exec(fs.readFileSync(new URL('../supabase/tests/compute_lease_authority.behaviour.sql', import.meta.url), 'utf8'));
  console.log(JSON.stringify({ suite: 'owner-workspace-sql', engine: 'disposable PGlite/PostgreSQL', assertions, passed: true, legacy_lease_suite: true, production_changes: false, concurrent_sessions: false, physical_hardware_verified: false }));
} finally { await db.close(); }
