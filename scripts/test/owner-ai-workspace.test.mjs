/* Whole shipped Control Room, real route/authority/render/action code, synthetic
   MCP and Supabase answers. This proves UI integration and credential handling;
   it is not physical-Mac, Core, Ollama, visual-browser, or deployment evidence. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openControl, ready, session, flush, sleep } from './support/control-room-page.mjs';
/* Production keeps the new surface behind its Core rollout flag. The fixture
   explicitly represents a staging Core with that gate enabled. */
const previousFlag = process.env.CORE_OWNER_AI_WORKSPACE_ENABLED;
process.env.CORE_OWNER_AI_WORKSPACE_ENABLED = '1';
const { CONTROL_TOOLS } = await import('../../core/src/tools/control.mjs?owner-workspace-fixture');
if (previousFlag === undefined) delete process.env.CORE_OWNER_AI_WORKSPACE_ENABLED;
else process.env.CORE_OWNER_AI_WORKSPACE_ENABLED = previousFlag;

const ORG = 'org-avocado';
const now = () => new Date().toISOString();
const toolText = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const errorText = value => ({ isError: true, content: [{ type: 'text', text: value }] });
const rpc = (entry, result) => ({ jsonrpc: '2.0', id: entry.rpc.id, result });
const device = (id, name, platform = 'darwin') => ({ id, node_id: id, display_name: name, platform, arch: platform === 'darwin' ? 'arm64' : 'x86_64', memory_bytes: 16 * 1073741824, state: 'test_passed', eligible: true, max_leases: 1, active_jobs: 0, models: [{ implementation: 'qwen3.8b.local', model: 'qwen3:8b', ready: true }], last_seen_at: now() });

function fixture() {
  const f = {
    threads: [{ id: 'thread-1', org_id: ORG, title: 'Planning our next step', status: 'active', last_message_at: now(), created_at: now() }],
    messages: { 'thread-1': [] }, turns: new Map(), calls: [], devices: [device('mac-a', 'Studio iMac'), device('mac-b', 'Second iMac'), device('ovh', 'OVH', 'linux')],
    enrollments: [], pairs: [], credentialCount: 0, rejectSubmit: false
  };
  f.finish = (id, fallback = '') => {
    const t = f.turns.get(id); assert.ok(t, 'fixture turn exists');
    t.status = 'done'; t.user.metadata.task_status = 'done';
    t.assistant = { id: 'reply-' + id, org_id: ORG, thread_id: t.args.thread_id, role: 'assistant', content: '# A concrete next step\n\nUse **independent jobs** for parallel work.\n\n```js\nconst answer = "fixture output";\n```', model: 'qwen3:8b', implementation: 'qwen3.8b.local', created_at: now(), metadata: { agent_job_id: id, task_status: 'done', node: t.node, requested_route: t.args.route, fallback_reason: fallback } };
    f.messages[t.args.thread_id].push(t.assistant);
  };
  f.overrides = [
    { match: e => e.path === '/rest/v1/ops_ai_threads', body: (_body, e) => {
      if (e.method === 'POST') { const t = { ...e.rpc, id: 'thread-' + (f.threads.length + 1), status: 'active', created_at: now(), last_message_at: now() }; f.threads.unshift(t); f.messages[t.id] = []; return [t]; }
      const params = new URL(e.url).searchParams, offset = Number(params.get('offset')) || 0, limit = Number(params.get('limit')) || 100;
      return f.threads.slice(offset, offset + limit);
    } },
    { match: e => e.path === '/rest/v1/ops_ai_messages', body: (_body, e) => {
      const params = new URL(e.url).searchParams, offset = Number(params.get('offset')) || 0, limit = Number(params.get('limit')) || 200;
      const rows = [...(f.messages[(params.get('thread_id') || '').replace(/^eq\./, '')] || [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      if ((params.get('order') || '').includes('desc')) rows.reverse();
      return rows.slice(offset, offset + limit);
    } },
    { match: e => e.path === '/v1/core/mcp', body: (_body, e) => {
      if (e.rpc.method === 'tools/list') return rpc(e, { tools: CONTROL_TOOLS });
      const name = e.rpc.params?.name, args = e.rpc.params?.arguments || {};
      f.calls.push({ name, args });
      if (name === 'core.compute.devices.list') return rpc(e, toolText({ devices: f.devices, enrollments: f.enrollments, enrollment_available: true, coordinator: 'McCluster Core on OVH' }));
      if (name === 'core.compute.pairs.list') return rpc(e, toolText({ pairs: f.pairs }));
      if (name === 'core.compute.enrollment.create') {
        const id = args.enrollment_id || 'enrollment-' + (f.enrollments.length + 1);
        const setup = { org_id: ORG, compute_url: 'https://compute.mccluster.org', enrollment_id: id, display_name: args.display_name, platform: 'darwin', implementation: 'qwen3.8b.local', model: 'qwen3:8b', context: 4096, max_leases: 1 };
        const pending = { id, enrollment_id: id, display_name: args.display_name, platform: 'darwin', created_at: now(), expires_at: new Date(Date.now() + 600000).toISOString(), state: 'pending' };
        f.enrollments = f.enrollments.filter(x => x.id !== id).concat(pending);
        const credential = 'mcen1_' + String(++f.credentialCount).padStart(43, 'A');
        f.lastCredential = credential;
        return rpc(e, toolText({ ...pending, credential, setup }));
      }
      if (name === 'core.compute.device.update') {
        const d = f.devices.find(x => x.node_id === args.node_id); assert.ok(d);
        if (args.action === 'rename') d.display_name = args.display_name;
        if (args.action === 'pause') { d.state = 'paused'; d.eligible = false; }
        if (args.action === 'resume') { d.state = 'connected'; d.eligible = true; }
        if (args.action === 'revoke') { d.state = 'revoked'; d.eligible = false; }
        return rpc(e, toolText({ device: d, in_flight_policy: 'Existing signed leases expire according to their original deadline.' }));
      }
      if (name === 'core.compute.device.test') {
        const d = f.devices.find(x => x.node_id === args.node_id); d.test = { task_id: 'test-' + args.node_id, status: 'queued' };
        return rpc(e, toolText({ task_id: d.test.task_id, status: 'queued', node_id: d.node_id }));
      }
      if (name === 'core.compute.pair.create') {
        const pair = { id: 'pair-1', name: args.name, node_ids: args.node_ids, state: 'unverified', ready: false, unavailable_reason: 'Exact shared-model runtime and M1 setup is unverified.' };
        f.pairs.push(pair); return rpc(e, toolText({ pair }));
      }
      if (name === 'core.compute.pair.benchmark') return rpc(e, errorText('PAIR_RUNTIME_UNVERIFIED: No supported distributed runtime is verified on this pair.'));
      if (name === 'core.ai.turn.submit') {
        if (f.rejectSubmit) return rpc(e, errorText('NODE_UNAVAILABLE: The pinned worker is unavailable.'));
        const d = f.devices.find(x => x.node_id === args.route?.node_id) || f.devices[0];
        const user = { id: args.message_id, org_id: ORG, thread_id: args.thread_id, role: 'user', content: args.content, created_at: now(), metadata: { execution_kind: 'resident_ai_turn', agent_job_id: args.message_id, task_status: 'running', route: args.route, images: args.images || [] } };
        f.messages[args.thread_id].push(user);
        const thread = f.threads.find(x => x.id === args.thread_id); if (thread.title === 'New chat') thread.title = args.content.slice(0, 80);
        f.turns.set(args.message_id, { args, user, status: 'running', progress: 'First measured tokens', sequence: 1, node: { node_id: d.node_id, node_name: d.display_name, model: 'qwen3:8b' } });
        return rpc(e, toolText({ turn_id: args.message_id, job_status: 'queued' }));
      }
      if (name === 'core.ai.turn.get') {
        const t = f.turns.get(args.turn_id);
        if (!t) return rpc(e, errorText('Turn not found'));
        return rpc(e, toolText({ turn: { id: args.turn_id, status: t.status, job_type: 'resident_ai_turn' }, user_message: t.user, assistant_message: t.assistant || null, progress: t.status === 'running' ? { status: 'running', content: t.progress, sequence: t.sequence, node: t.node } : null }));
      }
      if (name === 'core.ai.turn.stop') {
        const t = f.turns.get(args.turn_id); t.status = 'canceled'; t.user.metadata.task_status = 'canceled';
        return rpc(e, toolText({ stopped: true, turn_id: args.turn_id }));
      }
      return rpc(e, toolText({}));
    } }
  ];
  return f;
}
async function openOwner(f, t, extra = {}) {
  const page = await openControl({ hash: '#home:ask', storage: new Map([['mccdb_session', session('owner-a')]]), initialOverrides: f.overrides, ...extra });
  t.after(() => page.close());
  assert.ok(await ready(page, 'McCluster AI'));
  await page.settle();
  return page;
}
async function until(check, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (check()) return; await sleep(25); }
  assert.ok(check(), 'expected UI state arrived before deadline');
}
const calls = (f, name) => f.calls.filter(x => x.name === name);

test('named worker actions submit exact signed-dispatch intent and recover historical receipts', async t => {
  const f = fixture();
  const targets = [['ovh', 'OVH CPU'], ['prime', 'Prime GPU'], ['connected', 'Connected inference']];
  f.devices = targets.map(([target]) => {
    const d = device('worker-' + target, 'Worker ' + target);
    d.target = target; d.target_ready = true; d.models[0].target_ready = true;
    return d;
  });
  const page = await openOwner(f, t);
  for (const [target, label] of targets) {
    const id = 'worker-' + target;
    page.select('crAiDevice', 'node:' + id);
    assert.match(page.surface(), /Browser and agent tools are off/);
    page.type('crAiComposer', 'Return the fixture word'); await page.click('ai-send'); await page.settle();
    const sent = calls(f, 'core.ai.turn.submit').at(-1).args;
    assert.deepEqual(sent.route, { mode: 'node', node_id: id, target, implementation: 'qwen3.8b.local' });
    assert.equal(sent.allow_browser, undefined);
    f.finish(sent.message_id);
    await until(() => !page.state().aiChatPending);
    assert.ok(page.surface().includes('Selected: ' + label));
    assert.ok(page.surface().includes('Served by: Worker ' + target));
  }
  assert.equal(calls(f, 'core.ai.turn.submit').length, 3);
});

test('a pin survives a reload and cannot submit after losing its worker, schema or model readiness', async t => {
  const f = fixture(), sessionStore = new Map();
  const d = f.devices[0]; d.target = 'prime'; d.target_ready = true; d.models[0].target_ready = false;
  const first = await openOwner(f, t, { sessionStore });
  first.select('crAiDevice', 'node:' + d.node_id);
  first.type('crAiComposer', 'Wait for GPU evidence'); await first.click('ai-send');
  assert.equal(calls(f, 'core.ai.turn.submit').length, 0);
  first.close();
  f.devices = [];
  const second = await openOwner(f, t, { sessionStore });
  assert.equal(second.state().aiRouteSelection, 'node:' + d.node_id);
  assert.equal(second.state().aiRouteTarget, 'prime');
  assert.ok(second.surface().includes('value="node:' + d.node_id + '" selected>Prime GPU'));
  second.type('crAiComposer', 'Keep the original worker'); await second.click('ai-send');
  assert.equal(calls(f, 'core.ai.turn.submit').length, 0);
  second.state().coreTools = second.state().coreTools.map(tool => {
    if (tool.name !== 'core.ai.turn.submit') return tool;
    const old = structuredClone(tool); delete old.inputSchema.properties.route.properties.target;
    return old;
  });
  second.module.render(); await second.click('ai-send');
  assert.match(second.surface(), /Core cannot enforce the selected compute target/);
  assert.equal(calls(f, 'core.ai.turn.submit').length, 0);
});

test('image preview retains its resized dimensions and byte count in the new composer', async t => {
  const f = fixture(), page = await openOwner(f, t);
  /* Encoding is exercised by the real Chromium image fixture. Here its
     resulting attachment must survive the shipped workspace renderer. */
  page.state().aiAttachments = [{ name: 'Project sketch', preview: 'data:image/jpeg;base64,QUJD', base64: 'QUJD', width: 1280, height: 768, bytes: 153600 }];
  page.module.render();
  assert.match(page.surface(), /class="cr-ai-thumb__meta">1280×768 · 150 KB<\/span>/);
  await page.action('ai-remove-attachment', { 'data-index': '0' });
  assert.doesNotMatch(page.surface(), /class="cr-ai-thumb__meta"/);
});

test('owner enrollment survives target-Mac handoff without persisting or putting credentials in commands, downloads, or requests', async t => {
  const f = fixture(), page = await openOwner(f, t);
  await page.action('ai-panel', { 'data-panel': 'devices' });
  await page.click('ai-add-device'); page.type('crAiDeviceName', 'Design iMac'); await page.click('ai-enroll'); await page.settle();
  assert.equal(calls(f, 'core.compute.enrollment.create')[0].args.display_name, 'Design iMac');
  assert.match(page.surface(), /type="password"[^>]*mcen1_/);
  assert.match(page.surface(), /installer’s private prompt/);
  const secret = f.lastCredential;
  assert.ok(page.surface().includes(secret), 'credential is shown once in this owner session');
  const command = page.surface().match(/id="crAiSetupCommand">([^<]+)/)?.[1] || '';
  assert.match(command, /install --setup-file/); assert.ok(!command.includes(secret));
  await page.click('ai-download-setup');
  const setup = JSON.parse(await page.blobs[0].text());
  assert.equal(setup.enrollment_id, 'enrollment-1'); assert.equal(setup.context, 4096); assert.equal(setup.max_leases, 1);
  assert.ok(!JSON.stringify(setup).includes(secret)); assert.ok(!Object.keys(setup).some(k => /credential|token|secret/i.test(k)));
  assert.ok(!JSON.stringify([...page.storage]).includes(secret)); assert.ok(!JSON.stringify(page.fetchLog).includes(secret));
  await page.action('ai-panel', { 'data-panel': 'chat' });
  assert.equal(page.state().aiEnrollment, null); assert.ok(!page.dom().includes(secret));
  const target = await openOwner(f, t);
  await target.action('ai-panel', { 'data-panel': 'devices' });
  assert.match(target.surface(), /Design iMac/); assert.ok(!target.surface().includes(secret));
  await target.click('ai-finish-enrollment', 'enrollment-1'); await target.settle();
  assert.equal(calls(f, 'core.compute.enrollment.create').at(-1).args.enrollment_id, 'enrollment-1');
  assert.notEqual(f.lastCredential, secret, 'target Mac explicitly requests a newly issued credential');
  await target.otherTab(s => s.delete('mccdb_session'));
  assert.equal(target.state().aiEnrollment, null); assert.ok(!target.dom().includes('mcen1_'));
});

test('individual worker controls show real states, recovery, and forbid an unavailable pin', async t => {
  const f = fixture(), page = await openOwner(f, t);
  await page.action('ai-panel', { 'data-panel': 'devices' });
  await page.click('ai-device-rename', 'mac-a'); page.type('crAiRename', 'East iMac'); await page.click('ai-device-save-name', 'mac-a'); await page.settle();
  assert.equal(f.devices[0].display_name, 'East iMac');
  await page.click('ai-device-pause', 'mac-a'); await page.settle(); assert.match(page.surface(), /Paused/);
  await page.action('ai-panel', { 'data-panel': 'chat' }); page.select('crAiDevice', 'node:mac-a');
  assert.match(page.surface(), /selected device is unavailable/i);
  page.type('crAiComposer', 'Must not run on a paused Mac'); await page.click('ai-send');
  assert.equal(calls(f, 'core.ai.turn.submit').length, 0);
  await page.action('ai-panel', { 'data-panel': 'devices' });
  await page.click('ai-device-resume', 'mac-a'); await page.settle(); assert.match(page.surface(), /Connected/);
  await page.click('ai-device-test', 'mac-a'); await page.settle(); assert.match(page.surface(), /Device test: queued/);
  f.devices[0].test = { status: 'done', passed: true }; f.devices[0].state = 'test_passed';
  await page.click('ai-refresh-devices'); await page.settle(); assert.match(page.surface(), /Test passed/);
  await page.click('ai-device-revoke', 'mac-a'); assert.match(page.surface(), /New leases stop immediately/);
  await page.click('ai-device-confirm-revoke', 'mac-a'); await page.settle();
  assert.equal(f.devices[0].state, 'revoked'); assert.match(page.surface(), /Existing signed leases expire/);
});

test('real progress is painted from Core data, two conversations run independently, and the receipt names actual execution and fallback', async t => {
  const f = fixture(), page = await openOwner(f, t);
  page.select('crAiDevice', 'node:mac-a'); page.type('crAiComposer', 'First independent job'); await page.click('ai-send'); await page.settle();
  const first = calls(f, 'core.ai.turn.submit')[0].args;
  assert.deepEqual(first.route, { mode: 'node', implementation: 'qwen3.8b.local', node_id: 'mac-a' });
  assert.match(page.surface(), /First measured tokens/); assert.match(page.surface(), /Studio iMac/);
  f.turns.get(first.message_id).progress = 'A later measured chunk'; f.turns.get(first.message_id).sequence++;
  await until(() => page.surface().includes('A later measured chunk'));
  await page.click('ai-new-thread'); await page.settle();
  page.select('crAiDevice', 'node:mac-b'); page.type('crAiComposer', 'Second independent job'); await page.click('ai-send'); await page.settle();
  const second = calls(f, 'core.ai.turn.submit')[1].args;
  assert.notEqual(first.thread_id, second.thread_id); assert.equal(second.route.node_id, 'mac-b');
  assert.equal(Object.values(page.state().aiRuns).filter(x => x.pending).length, 2);
  f.finish(first.message_id); f.finish(second.message_id, 'The original eligible worker disconnected; this recorded worker accepted the recovered job.');
  await until(() => Object.values(page.state().aiRuns).every(x => !x.pending));
  assert.match(page.surface(), /Second iMac/); assert.match(page.surface(), /Fallback: The original eligible worker disconnected/);
  assert.match(page.surface(), /<h3>A concrete next step<\/h3>/); assert.match(page.surface(), /data-action="ai-copy-code"/);
  await page.action('ai-panel', { 'data-panel': 'runs' }); assert.match(page.surface(), /First independent job/); assert.match(page.surface(), /Second independent job/);
  assert.equal(page.errors.length, 0);
});

test('stop, retry and explicit second-worker review use durable tool contracts', async t => {
  const f = fixture(), page = await openOwner(f, t);
  page.select('crAiDevice', 'node:mac-a'); page.type('crAiComposer', 'Work to stop'); await page.click('ai-send'); await page.settle();
  const first = calls(f, 'core.ai.turn.submit')[0].args;
  await page.click('ai-stop'); await page.settle();
  assert.equal(calls(f, 'core.ai.turn.stop')[0].args.turn_id, first.message_id);
  assert.equal(page.state().aiRuns[first.thread_id].pending, false); assert.match(page.surface(), /Stopped/);
  await page.click('ai-retry', first.message_id); await page.settle();
  const retried = calls(f, 'core.ai.turn.submit')[1].args;
  assert.equal(retried.content, first.content); assert.notEqual(retried.message_id, first.message_id);
  f.finish(retried.message_id); await until(() => page.surface().includes('data-action="ai-review"'));
  await page.click('ai-review', 'reply-' + retried.message_id);
  assert.equal(page.state().aiRouteSelection, 'node:mac-a');
  assert.match(page.surface(), /Choose a different worker/); await page.click('ai-send'); assert.equal(calls(f, 'core.ai.turn.submit').length, 2);
  page.select('crAiDevice', 'node:mac-b'); await page.click('ai-send'); await page.settle();
  const review = calls(f, 'core.ai.turn.submit')[2].args;
  assert.equal(review.review_of_turn_id, retried.message_id); assert.equal(review.route.node_id, 'mac-b');
  f.finish(review.message_id); await until(() => !page.state().aiRuns[first.thread_id].pending);
});

test('reopen restores a running saved job; rejected submission becomes retryable instead of a permanent spinner', async t => {
  const f = fixture(), first = await openOwner(f, t);
  first.type('crAiComposer', 'A durable job'); await first.click('ai-send'); await first.settle();
  const accepted = calls(f, 'core.ai.turn.submit')[0].args;
  first.close();
  const reconnected = await openOwner(f, t);
  assert.match(reconnected.surface(), /A durable job/); assert.match(reconnected.surface(), /First measured tokens/);
  f.finish(accepted.message_id); await reconnected.click('ai-refresh-thread'); await reconnected.settle();
  assert.match(reconnected.surface(), /A concrete next step/); assert.equal(reconnected.state().aiRuns[accepted.thread_id].pending, false);
  f.rejectSubmit = true; reconnected.type('crAiComposer', 'Rejected pin'); await reconnected.click('ai-send');
  await until(() => !reconnected.state().aiRuns[accepted.thread_id].pending);
  assert.match(reconnected.surface(), /Rejected pin/); assert.match(reconnected.surface(), /Retry with current selection/);
});

test('Create pair never converts stale state or claimed combined memory into readiness', async t => {
  const f = fixture(), page = await openOwner(f, t);
  await page.action('ai-panel', { 'data-panel': 'devices' }); await page.click('ai-pair-create');
  page.type('crAiPairName', 'Studio pair'); page.select('crAiPairFirst', 'mac-a'); page.select('crAiPairSecond', 'mac-b'); await page.click('ai-pair-save'); await page.settle();
  assert.deepEqual(calls(f, 'core.compute.pair.create')[0].args.node_ids, ['mac-a', 'mac-b']);
  f.pairs[0].state = 'ready'; f.pairs[0].ready = false;
  await page.click('ai-refresh-devices'); await page.settle(); assert.match(page.surface(), /Unavailable/);
  await page.click('ai-pair-benchmark', 'pair-1'); await page.settle(); assert.match(page.surface(), /No supported distributed runtime/);
  await page.action('ai-panel', { 'data-panel': 'chat' }); page.select('crAiDevice', 'pair:pair-1');
  assert.match(page.surface(), /Deep Reasoning is unavailable/);
  page.type('crAiComposer', 'Do not dispatch an unverified pair'); await page.click('ai-send'); assert.equal(calls(f, 'core.ai.turn.submit').length, 0);
});

test('a nonowner receives no owner composer, device controls, or device-tool calls', async t => {
  const f = fixture();
  const deny = { match: e => e.path === '/v1/workspaces/me', body: () => ({ ok: true, default_org_id: ORG, workspaces: [{ org_id: ORG, slug: 'mccluster', kind: 'studio', role: 'viewer', enabled: true, name: 'House' }] }) };
  const page = await openControl({ hash: '#home:ask', storage: new Map([['mccdb_session', session('owner-a')]]), initialOverrides: [...f.overrides, deny] }); t.after(() => page.close()); await page.settle();
  assert.match(page.surface(), /Sign in as the McCluster house owner/);
  assert.ok(!page.surface().includes('crAiComposer')); assert.ok(!page.surface().includes('ai-add-device'));
  assert.equal(calls(f, 'core.compute.devices.list').length, 0);
});

test('a delayed enrollment response cannot restore a credential after account loss', async t => {
  const f = fixture(), page = await openOwner(f, t);
  await page.action('ai-panel', { 'data-panel': 'devices' }); await page.click('ai-add-device');
  const held = page.hold(e => e.rpc?.params?.name === 'core.compute.enrollment.create');
  page.type('crAiDeviceName', 'Late response Mac'); await page.click('ai-enroll');
  assert.ok(held.pending.length > 0, 'the real request is waiting for a network response');
  await page.otherTab(s => s.delete('mccdb_session')); held.release(); await page.settle();
  assert.equal(page.state().aiEnrollment, null); assert.ok(!page.dom().includes('mcen1_')); assert.ok(page.gateShown());
});

test('an unconfirmed pair cleanup hold cannot be resumed from the browser', async t => {
  const f = fixture();
  Object.assign(f.devices[0], { state: 'paused', eligible: false, cleanup_required: true, cleanup: { reservation_id: 'reserved-pair-1', reason: 'Local model memory cleanup not confirmed' }, resume_available: false, recovery: 'Run the local cleanup repair and send its signed receipt before resuming.' });
  const page = await openOwner(f, t); await page.action('ai-panel', { 'data-panel': 'devices' });
  assert.match(page.surface(), /local cleanup repair/);
  await page.click('ai-device-resume', 'mac-a'); assert.equal(calls(f, 'core.compute.device.update').length, 0);
});

test('history loads newest messages first and can page through older canonical conversations', async t => {
  const f = fixture();
  const oldest = Date.parse('2026-11-01T00:00:00Z');
  f.threads = Array.from({ length: 101 }, (_, i) => ({ id: 'thread-' + (i + 1), org_id: ORG, title: 'Saved chat ' + (i + 1), status: 'active', created_at: now(), last_message_at: now() }));
  f.messages['thread-1'] = Array.from({ length: 205 }, (_, i) => ({ id: 'message-' + i, thread_id: 'thread-1', org_id: ORG, role: i % 2 ? 'assistant' : 'user', content: 'Message number ' + i, created_at: new Date(oldest + i * 1000).toISOString(), metadata: {} }));
  const page = await openOwner(f, t);
  assert.equal(page.state().aiThreads.length, 100);
  assert.equal(page.state().aiMessages['thread-1'][0].id, 'message-5');
  assert.equal(page.state().aiMessages['thread-1'].at(-1).id, 'message-204');
  await page.click('ai-earlier-messages'); await page.settle();
  assert.equal(page.state().aiMessages['thread-1'].length, 205); assert.equal(page.state().aiMessages['thread-1'][0].id, 'message-0');
  assert.equal(page.state().aiMessagesHasMore['thread-1'], false);
  await page.click('ai-more-threads'); await page.settle();
  assert.equal(page.state().aiThreads.length, 101); assert.equal(page.state().aiThreadHasMore, false);
  assert.match(page.surface(), /Search covers loaded titles/);
});
