import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DISPATCH_ROUTES, REFUSALS, NEVER_DISPATCHED, routeFor } from '../src/dispatch/routes.mjs';
import { classifyDeterministic, classifyWithModel, decide, parseModelOutput, groundSlots, extractSlots, DEFAULT_DISPATCH_MODEL, dispatchModel, STRONG, THRESHOLD } from '../src/dispatch/classify.mjs';
import { gateFor, requireOwner } from '../src/dispatch/policy.mjs';
import { dispatchTurn, executeDispatch, getDispatch, requestHash, relayText, makeRpc, DISPATCH_NOT_APPLIED } from '../src/dispatch/dispatch.mjs';
import { CONTROL_TOOLS } from '../src/tools/control.mjs';
import { MEETING_TOOLS } from '../src/tools/meeting.mjs';

const catalog = JSON.parse(await readFile(new URL('../capabilities/catalog.json', import.meta.url), 'utf8'));
const ORG = '00000000-0000-4000-8000-000000000001';
const OWNER = { user_id: '00000000-0000-4000-8000-0000000000aa', kind: 'owner', source: 'cloudflare-owner-session' };
const MSG = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';
const limits = { strong: STRONG, threshold: THRESHOLD, fallback: 0.6 };

/* ---------- routing table ---------- */

test('every route names a live catalog capability (or a runner job) and an existing Core tool', () => {
  const tools = new Set([...CONTROL_TOOLS, ...MEETING_TOOLS].map((tool) => tool.name)); // interactive meeting tools are listed only where enabled
  for (const route of DISPATCH_ROUTES) {
    assert.ok(!route.tool.startsWith('core.dispatch.') && !route.capability.startsWith('dispatch.'), 'dispatch never routes into itself');
    if (route.via === 'job') { assert.equal(route.tool, `job:${route.jobType}`); continue; }
    const entry = catalog.capabilities.find((capability) => capability.id === route.capability);
    assert.ok(entry, `${route.capability} is in the catalog`);
    assert.equal(entry.lifecycle, 'active');
    if (route.transport === 'local-control' && route.tool !== 'core.deploy.preview') assert.ok(tools.has(route.tool), `${route.tool} is a control tool`); // preview is listed only on hosts that configure it
  }
  for (const never of NEVER_DISPATCHED) assert.equal(DISPATCH_ROUTES.some((route) => route.capability === never), false, `${never} is not routable`);
  assert.equal(DISPATCH_ROUTES.some((route) => /out_|outreach|lead_rescore|site\.edit|browser/.test(route.tool + route.capability)), false);
});

test('the gate comes from the catalog: approval-free routes run, everything else is held', () => {
  for (const route of DISPATCH_ROUTES) {
    const entry = route.via === 'job' ? route : catalog.capabilities.find((capability) => capability.id === route.capability);
    const gate = gateFor(route, catalog);
    const expectRun = entry.approval === 'none' && !['spend', 'deploy', 'destructive'].includes(entry.risk);
    assert.equal(gate.decision, expectRun ? 'run' : 'approval', `${route.intent}: ${entry.risk}/${entry.approval}`);
  }
  assert.equal(gateFor(routeFor('code.build'), catalog).decision, 'approval');
  assert.equal(gateFor(routeFor('world.generate'), catalog).decision, 'approval');
  assert.equal(gateFor(routeFor('deploy.preview'), catalog).decision, 'approval');
  assert.equal(gateFor(routeFor('objective.plan'), catalog).decision, 'run');
  assert.equal(gateFor(routeFor('core.resume'), catalog).decision, 'run');
  assert.equal(gateFor({ capability: 'browser.act', tool: 'x' }, catalog).decision, 'refused');
  assert.equal(gateFor({ capability: 'site.edit', tool: 'x' }, catalog).decision, 'refused');
  assert.equal(gateFor({ capability: 'not.real', tool: 'x' }, catalog).decision, 'refused');
  // A catalog that relaxes nothing: if code.build ever became approval none
  // but spend risk, it would still be held.
  const relaxed = { capabilities: [{ id: 'code.build', lifecycle: 'active', risk: 'spend', approval: 'none', interfaces: ['mcp'] }] };
  assert.equal(gateFor(routeFor('code.build'), relaxed).decision, 'approval');
});

/* ---------- deterministic classification ---------- */

test('the deterministic table routes the obvious messages', () => {
  const cases = [
    ['what is the status right now', 'core.resume'],
    ['catch me up', 'core.resume'],
    ['show my workstreams', 'workstream.list'],
    ['fix the footer spacing bug in mcclusterishere/mccluster', 'code.build'],
    ['inspect mcclusterishere/mccluster', 'repo.inspect'],
    ['research venue photographers in Atlanta', 'research.web'],
    ['plan the music catalogue audit', 'objective.plan'],
    ['separate the stems for track midnight-drive', 'stems.separate'],
    ['deploy a preview of mcclusterishere/mccluster branch feat/x', 'deploy.preview'],
    ['generate a neon world for PRIM3', 'world.generate'],
  ];
  for (const [message, intent] of cases) {
    const result = classifyDeterministic(message);
    assert.equal(result.intent, intent, message);
    assert.ok(result.confidence >= STRONG, `${message} is strong`);
  }
  assert.equal(classifyDeterministic('separate the stems for track midnight-drive').slots.track_key, 'midnight-drive');
  assert.equal(classifyDeterministic('deploy a preview of mcclusterishere/mccluster branch feat/x').slots.ref, 'feat/x');
});

test('refusals win: production, outreach, destructive, spend and owner-only never route', () => {
  const cases = [
    ['merge PR 842 into main', 'refuse.production'],
    ['deploy mcclusterishere/mccluster to production', 'refuse.production'],
    ['email all the leads about the new prices', 'refuse.outreach'],
    ['run the outreach for thursday', 'refuse.outreach'],
    ['delete the old leads table', 'refuse.destructive'],
    ['pay the $40 invoice on stripe', 'refuse.spend'],
    ['edit the hire page prices on the website', 'refuse.owner_only'],
  ];
  for (const [message, intent] of cases) {
    const result = classifyDeterministic(message);
    assert.equal(result.intent, intent, message);
    assert.equal(result.source, 'refusal');
    const decision = decide(result, { ok: true, intent: 'code.build', confidence: 0.99, slots: { repository: 'a/b' } }, limits);
    assert.equal(decision.route, 'refused', `${message}: a confident model cannot override a refusal`);
  }
  assert.equal(REFUSALS[0].intent, 'refuse.production', 'production is checked first');
  // A code task on a named repository is not an outreach refusal...
  assert.equal(classifyDeterministic('fix the email send bug for the list page in mcclusterishere/mccluster').intent, 'code.build');
  // ...but merging it still is a production refusal.
  assert.equal(classifyDeterministic('fix it in mcclusterishere/mccluster and merge to main').intent, 'refuse.production');
});

test('slots are read from the text, never invented', () => {
  assert.equal(extractSlots('pick one and/or the other').repository, undefined);
  assert.equal(extractSlots('see https://github.com/a/b').repository, undefined);
  assert.deepEqual(groundSlots({ repository: 'evil/repo', objective: 'x' }, 'please fix the bug'), { objective: 'x' });
  assert.deepEqual(groundSlots({ repository: 'mcclusterishere/mccluster' }, 'in mcclusterishere/mccluster'), { repository: 'mcclusterishere/mccluster' });
});

/* ---------- model output and the joining rule ---------- */

test('model output must be one of the routable intents, with grounded slots', () => {
  assert.equal(parseModelOutput('not json', 'x'), null);
  assert.equal(parseModelOutput(JSON.stringify({ intent: 'browser.act', confidence: 0.99, reply: '' }), 'x'), null);
  assert.equal(parseModelOutput(JSON.stringify({ intent: 'site.edit', confidence: 0.99, reply: '' }), 'x'), null);
  assert.equal(parseModelOutput(JSON.stringify({ intent: 'send.email', confidence: 0.99, reply: '' }), 'x'), null);
  const parsed = parseModelOutput(JSON.stringify({ intent: 'code.build', confidence: 1.7, slots: { repository: 'made/up' }, reply: 'ok' }), 'fix it');
  assert.equal(parsed.confidence, 1);
  assert.equal(parsed.slots.repository, undefined);
});

test('decide: strong rule, model above and below the threshold, model down, missing argument', () => {
  const weak = classifyDeterministic('the gallery page loads slowly sometimes');
  assert.ok(weak.confidence < STRONG);
  // model above threshold is accepted
  let d = decide(weak, { ok: true, intent: 'objective.plan', confidence: 0.8, slots: {}, reply: 'I will plan that.' }, limits, 'the gallery page loads slowly sometimes');
  assert.equal(d.route, 'capability'); assert.equal(d.intent, 'objective.plan');
  // below threshold: clarify, nothing routed
  d = decide(weak, { ok: true, intent: 'objective.plan', confidence: 0.5, slots: {}, reply: '' }, limits);
  assert.equal(d.route, 'clarify');
  // model unavailable and the table is weak: answer, the safe default
  d = decide(weak, { ok: false, error: 'LOCAL_AI_NO_FABRIC_NODE' }, limits);
  assert.equal(d.route, 'answer');
  // model unavailable, the table is moderate: fallback accepted
  d = decide(classifyDeterministic('can you analyze last week'), { ok: false, error: 'down' }, limits, 'can you analyze last week');
  assert.equal(d.intent, 'objective.plan'); assert.equal(d.route, 'capability');
  // a route without its required argument asks for it
  d = decide(weak, { ok: true, intent: 'code.build', confidence: 0.95, slots: {}, reply: '' }, limits, 'the gallery page loads slowly sometimes');
  assert.equal(d.route, 'clarify'); assert.deepEqual(d.missing, ['repository']); assert.match(d.reply, /repository/);
  // a strong rule does not need the model
  d = decide(classifyDeterministic('status'), null, limits, 'status');
  assert.equal(d.intent, 'core.resume'); assert.equal(d.route, 'capability');
});

test('the front end is the smallest resident Ollama model, called locally with a schema', async () => {
  assert.equal(DEFAULT_DISPATCH_MODEL, 'qwen3:4b-instruct-2507-q4_K_M');
  const unit = await readFile(new URL('../systemd/mccluster-ollama-adapter.service', import.meta.url), 'utf8');
  assert.match(unit, /MCCLUSTER_OLLAMA_RESIDENT_MODELS=[^\n]*qwen3:4b-instruct-2507-q4_K_M/, 'it is resident on the OVH adapter');
  assert.equal(dispatchModel({ MCCLUSTER_DISPATCH_MODEL: 'qwen3:8b' }), 'qwen3:8b');
  assert.equal(dispatchModel({ MCCLUSTER_DISPATCH_MODEL: 'bad model; rm -rf' }), DEFAULT_DISPATCH_MODEL);
  let seen;
  const chat = async (request) => { seen = request; return { model: request.model, message: { content: JSON.stringify({ intent: 'answer', confidence: 0.9, reply: 'Hi.' }) } }; };
  const result = await classifyWithModel('hello there', { chat, context: 'Active work: x' });
  assert.equal(result.ok, true); assert.equal(result.intent, 'answer');
  assert.equal(seen.model, DEFAULT_DISPATCH_MODEL); assert.equal(seen.route, 'local'); assert.equal(seen.think, false);
  assert.ok(seen.schema?.properties?.intent?.enum.includes('code.build'));
  assert.equal(seen.schema.properties.intent.enum.includes('browser.act'), false);
  const down = await classifyWithModel('hello', { chat: async () => { throw Object.assign(new Error('x'), { code: 'OLLAMA_TIMEOUT' }); } });
  assert.equal(down.ok, false); assert.equal(down.error, 'OLLAMA_TIMEOUT');
});

/* ---------- the turn: record first, then run, hold or answer ---------- */

function fakeDeps({ chatReply, recordError, replay = false, submit } = {}) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push(['rpc', name, args]);
    if (name === 'ops_ai_workstream_resume') return [{ id: 'dispatch-layer', status: 'active', title: 'Dispatch layer', next: 'tests', withheld: false }];
    if (name === 'ops_ai_dispatch_record') {
      if (recordError) throw recordError;
      const t = args.p_turn;
      const status = { answer: 'answered', clarify: 'answered', refused: 'refused', approval: 'pending_approval', run: 'routed' }[t.route];
      return { replayed: replay, turn: { id: '44444444-4444-4444-8444-444444444444', ...t, status: replay ? 'queued' : status, approval_id: t.route === 'approval' ? '55555555-5555-4555-8555-555555555555' : null, decision_id: '66666666-6666-4666-8666-666666666666' } };
    }
    if (name === 'ops_ai_dispatch_attach') return { id: args.p_turn, ...args.p_patch };
    throw new Error(`unexpected rpc ${name}`);
  };
  return {
    calls,
    deps: {
      rpc, catalog, env: {},
      chat: async (request) => { calls.push(['chat', request.model]); return { model: request.model, message: { content: JSON.stringify(chatReply || { intent: 'answer', confidence: 0.9, reply: 'Short answer.' }) } }; },
      callTool: async (tool, args, options) => { calls.push(['tool', tool, args, options]); return { queued: true, job_id: JOB, job_type: 'objective_plan' }; },
      submitAnswer: submit || (async (input) => { calls.push(['answer', input]); return { turn_id: JOB }; }),
      memory: async () => ({ available: true, memories: [{ id: 'm1', content: 'Matthew prefers short updates' }] }),
    },
  };
}

test('a turn without the signed owner actor is refused before anything is read or written', async () => {
  const { calls, deps } = fakeDeps();
  for (const actor of [undefined, { user_id: OWNER.user_id, kind: 'member' }, { user_id: 'owner', kind: 'owner' }]) {
    await assert.rejects(dispatchTurn({ org_id: ORG, message_id: MSG, message: 'status' }, { actor }, deps), (error) => error.status === 403 && error.code === 'DISPATCH_OWNER_REQUIRED');
  }
  assert.equal(calls.length, 0);
  assert.throws(() => requireOwner({ kind: 'owner' }), /owner session/);
});

test('an approval-free route is recorded first, then run on Core, and the job is attached', async () => {
  const { calls, deps } = fakeDeps();
  const out = await dispatchTurn({ org_id: ORG, message_id: MSG, message: 'plan the music catalogue audit' }, { actor: OWNER }, deps);
  assert.equal(out.route, 'run'); assert.equal(out.status, 'queued'); assert.equal(out.job_id, JOB);
  const order = calls.filter((c) => c[0] === 'tool' || (c[0] === 'rpc' && c[1].startsWith('ops_ai_dispatch_'))).map((c) => c[0] === 'tool' ? c[1] : c[1]);
  assert.deepEqual(order, ['ops_ai_dispatch_record', 'core.objective.plan', 'ops_ai_dispatch_attach'], 'recorded before it runs');
  const record = calls.find((c) => c[1] === 'ops_ai_dispatch_record')[2];
  assert.equal(record.p_actor, OWNER.user_id);
  assert.equal(record.p_turn.operation_key, `dispatch:${MSG}`);
  assert.equal(record.p_turn.request_hash, requestHash('core.objective.plan', record.p_turn.args));
  assert.equal(record.p_turn.args.org_id, ORG);
  assert.deepEqual(record.p_turn.classifier.context.workstreams, ['dispatch-layer'], 'context came from Supabase');
  assert.equal(calls.some((c) => c[0] === 'chat'), false, 'a strong rule does not wake the model');
  const tool = calls.find((c) => c[0] === 'tool');
  assert.deepEqual(tool[3], { actor: OWNER }, 'the owner actor rides through to the tool');
});

test('a gated route files an approval and runs nothing', async () => {
  const { calls, deps } = fakeDeps();
  const out = await dispatchTurn({ org_id: ORG, message_id: MSG, message: 'fix the footer spacing bug in mcclusterishere/mccluster' }, { actor: OWNER }, deps);
  assert.equal(out.route, 'approval'); assert.equal(out.status, 'pending_approval');
  assert.ok(out.approval_id); assert.match(out.reply, /approval/);
  assert.equal(calls.some((c) => c[0] === 'tool'), false, 'nothing executed');
  const record = calls.find((c) => c[1] === 'ops_ai_dispatch_record')[2];
  assert.equal(record.p_turn.tool, 'core.code.build'); assert.equal(record.p_turn.risk_class, 'high');
});

test('if the audit write fails nothing runs (fail closed), and a missing SQL says so', async () => {
  const notApplied = Object.assign(new Error('Could not find the function public.ops_ai_dispatch_record'), { status: 404, detail: { code: 'PGRST202' } });
  const rpc = makeRpc(async () => { throw notApplied; });
  const { calls, deps } = fakeDeps();
  await assert.rejects(dispatchTurn({ org_id: ORG, message_id: MSG, message: 'plan the audit' }, { actor: OWNER }, { ...deps, rpc }), (error) => error.code === DISPATCH_NOT_APPLIED && error.status === 503);
  assert.equal(calls.some((c) => c[0] === 'tool'), false);
});

test('a replayed message id returns the first outcome and runs nothing again', async () => {
  const { calls, deps } = fakeDeps({ replay: true });
  const out = await dispatchTurn({ org_id: ORG, message_id: MSG, message: 'plan the audit' }, { actor: OWNER }, deps);
  assert.equal(out.replayed, true);
  assert.equal(calls.some((c) => c[0] === 'tool'), false);
});

test('chat is answered by the front-end model, or by a durable resident turn when a thread is given', async () => {
  let { calls, deps } = fakeDeps({ chatReply: { intent: 'answer', confidence: 0.92, reply: 'You have two things queued.' } });
  let out = await dispatchTurn({ org_id: ORG, message_id: MSG, message: 'the gallery page loads slowly sometimes' }, { actor: OWNER }, deps);
  assert.equal(out.route, 'answer'); assert.equal(out.reply, 'You have two things queued.');
  assert.equal(out.front_end_model, DEFAULT_DISPATCH_MODEL);
  ({ calls, deps } = fakeDeps({ chatReply: { intent: 'answer', confidence: 0.92, reply: 'ok' } }));
  out = await dispatchTurn({ org_id: ORG, message_id: MSG, thread_id: THREAD, message: 'the gallery page loads slowly sometimes' }, { actor: OWNER }, deps);
  assert.equal(out.status, 'queued'); assert.equal(out.resident_turn_id, JOB);
  const answer = calls.find((c) => c[0] === 'answer')[1];
  assert.equal(answer.threadId, THREAD); assert.equal(answer.messageId, MSG); assert.deepEqual(answer.actor, OWNER);
});

test('a low-confidence classification asks one question and runs nothing', async () => {
  const { calls, deps } = fakeDeps({ chatReply: { intent: 'clarify', confidence: 0.4, reply: 'Do you want a plan or a code change?' } });
  const out = await dispatchTurn({ org_id: ORG, message_id: MSG, message: 'the gallery thing again' }, { actor: OWNER }, deps);
  assert.equal(out.route, 'clarify'); assert.equal(out.reply, 'Do you want a plan or a code change?');
  assert.equal(calls.some((c) => c[0] === 'tool'), false);
});

test('a refusal is recorded and explained, never run', async () => {
  const { calls, deps } = fakeDeps();
  const out = await dispatchTurn({ org_id: ORG, message_id: MSG, message: 'merge PR 842 into main' }, { actor: OWNER }, deps);
  assert.equal(out.route, 'refused'); assert.match(out.reply, /never started from chat/);
  assert.equal(calls.some((c) => c[0] === 'tool' || c[0] === 'chat'), false);
  assert.equal(calls.filter((c) => c[1] === 'ops_ai_dispatch_record').length, 1, 'still audited');
});

/* ---------- execute an approved turn ---------- */

test('execute runs only a claimed turn whose request is unchanged, once', async () => {
  const args = { org_id: ORG, repository: 'mcclusterishere/mccluster', task: 'fix' };
  const turn = { id: '44444444-4444-4444-8444-444444444444', intent: 'code.build', tool: 'core.code.build', args, request_hash: requestHash('core.code.build', args), status: 'executing' };
  const tools = [];
  const callTool = async (tool, a) => { tools.push(tool); return { queued: true, job_id: JOB, job_type: 'code_patch' }; };
  const attach = [];
  const mk = (claim) => async (name, a) => { if (name === 'ops_ai_dispatch_claim') return claim; attach.push(a.p_patch); return {}; };

  let out = await executeDispatch({ org_id: ORG, turn_id: turn.id }, { actor: OWNER }, { rpc: mk({ claimed: false, state: 'pending_approval', turn: { route: 'approval', status: 'pending_approval' }, approval: { state: 'pending' } }), callTool, catalog });
  assert.equal(out.executed, false); assert.match(out.relay, /waiting for your approval/i); assert.equal(tools.length, 0);

  out = await executeDispatch({ org_id: ORG, turn_id: turn.id }, { actor: OWNER }, { rpc: mk({ claimed: true, turn }), callTool, catalog });
  assert.equal(out.executed, true); assert.equal(out.job_id, JOB); assert.deepEqual(tools, ['core.code.build']);

  const tampered = { ...turn, args: { ...args, repository: 'someone/else' } };
  await assert.rejects(executeDispatch({ org_id: ORG, turn_id: turn.id }, { actor: OWNER }, { rpc: mk({ claimed: true, turn: tampered }), callTool, catalog }), (error) => error.code === 'DISPATCH_REQUEST_CHANGED');
  assert.equal(tools.length, 1, 'a changed request never runs');
  await assert.rejects(executeDispatch({ org_id: ORG, turn_id: turn.id }, { actor: { kind: 'member', user_id: OWNER.user_id } }, { rpc: mk({ claimed: true, turn }), callTool, catalog }), /owner/);
});

/* ---------- results flow back ---------- */

test('get relays the live job, approval and resident answer', async () => {
  const view = (turn, job = null, approval = null) => async () => ({ turn, job, approval });
  let out = await getDispatch({ org_id: ORG, turn_id: MSG }, { actor: OWNER }, { rpc: view({ id: MSG, route: 'run', status: 'queued', job_id: JOB }, { id: JOB, status: 'done', output: { steps: 3 } }) });
  assert.equal(out.relay, 'Finished.'); assert.deepEqual(out.job.output, { steps: 3 });
  out = await getDispatch({ org_id: ORG, turn_id: MSG }, { actor: OWNER }, { rpc: view({ id: MSG, route: 'answer', status: 'queued', resident_turn_id: JOB }), getAnswer: async () => ({ turn: { status: 'done' }, assistant_message: { content: 'Here is the answer.' } }) });
  assert.equal(out.relay, 'Here is the answer.');
  assert.match(relayText({ turn: { route: 'approval', status: 'pending_approval' }, approval: { state: 'approved' } }), /approved/);
  assert.match(relayText({ turn: { route: 'run', status: 'queued' }, job: { status: 'failed', last_error: 'boom' } }), /failed: boom/);
  await assert.rejects(getDispatch({ org_id: ORG, turn_id: MSG }, { actor: OWNER }, { rpc: async () => ({ turn: null }) }), (error) => error.status === 404);
});

/* ---------- surface: catalog, control tools, edge ---------- */

test('the dispatch tools are catalog capabilities on the owner-only MCP edge, house org only', async () => {
  for (const [id, tool, approval] of [['dispatch.turn', 'core.dispatch.turn', 'none'], ['dispatch.get', 'core.dispatch.get', 'none'], ['dispatch.execute', 'core.dispatch.execute', 'owner']]) {
    const entry = catalog.capabilities.find((capability) => capability.id === id);
    assert.ok(entry, id); assert.deepEqual(entry.interfaces, ['mcp'], `${id} needs the MCP actor`); assert.equal(entry.approval, approval);
    const binding = catalog.bindings.find((b) => b.capability === id);
    assert.equal(binding.tool, tool); assert.equal(binding.transport, 'local-control'); assert.equal(binding.status, 'active');
    assert.ok(CONTROL_TOOLS.some((t) => t.name === tool), `${tool} is a control tool`);
  }
  assert.notEqual(catalog.catalogVersion, '2026-11-23.1', 'the catalog version moved with the new capabilities');
  const edge = await readFile(new URL('../../workers/mccluster-mcp/src/mcp.js', import.meta.url), 'utf8');
  const allowlist = edge.slice(edge.indexOf('const REMOTE_CAPABILITIES = new Set(['), edge.indexOf(']);', edge.indexOf('const REMOTE_CAPABILITIES')));
  const houseOnly = edge.slice(edge.indexOf('const HOUSE_ORG_ONLY = new Set(['), edge.indexOf(']);', edge.indexOf('const HOUSE_ORG_ONLY')));
  for (const id of ['dispatch.turn', 'dispatch.get', 'dispatch.execute']) {
    assert.ok(allowlist.includes(`'${id}'`), `${id} on the remote allowlist`);
    assert.ok(houseOnly.includes(`'${id}'`), `${id} runs on the house org the edge verified`);
  }
  assert.ok(!allowlist.includes("'core.dispatch."), 'raw tool names stay off the remote surface');
});
