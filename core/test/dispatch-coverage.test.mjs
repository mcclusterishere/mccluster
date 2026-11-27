/* Dispatch coverage: every catalog capability and every runner job type
   is either routable from the front end or excluded by name with a
   reason. Adding a capability to core/capabilities/catalog.json or a job
   type to core/src/runner.mjs without deciding its route fails here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  CATALOG, DISPATCH_ROUTES, ROUTE_BY_INTENT, ROUTABLE_INTENTS, EXCLUDED_CAPABILITIES, EXCLUDED_JOB_TYPES,
  JOB_TYPES_VIA_CAPABILITY, NEVER_DISPATCHED, buildArgs, missingArgs, routeFor,
} from '../src/dispatch/routes.mjs';
import { classifyDeterministic, decide, parseModelOutput, callerArgs, STRONG, THRESHOLD } from '../src/dispatch/classify.mjs';
import { gateFor } from '../src/dispatch/policy.mjs';
import { dispatchTurn, executeDispatch, requestHash, runRoute, jobIdOf } from '../src/dispatch/dispatch.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const OWNER = { user_id: '00000000-0000-4000-8000-0000000000aa', kind: 'owner', source: 'cloudflare-owner-session' };
const MSG = '11111111-1111-4111-8111-111111111111';
const JOB = '33333333-3333-4333-8333-333333333333';
const UUID_X = '44444444-4444-4444-8444-444444444444';
const limits = { strong: STRONG, threshold: THRESHOLD, fallback: 0.6 };
const src = (path) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

async function runnerJobTypes() {
  const runner = await src('runner.mjs');
  const block = runner.slice(runner.indexOf('const executors = new Map(['), runner.indexOf(']);', runner.indexOf('const executors = new Map([')));
  const map = new Map([...block.matchAll(/\['([a-z0-9_]+)',\s*([A-Za-z0-9_]+)\]/g)].map((m) => [m[1], m[2]]));
  const files = new Map();
  for (const m of runner.matchAll(/import \{([^}]+)\} from '\.\/executors\/([a-z0-9-]+)\.mjs'/g)) {
    for (const name of m[1].split(',').map((part) => part.trim().split(/\s+as\s+/).pop())) files.set(name, m[2]);
  }
  return { map, files };
}

/* Arguments a caller (or the message) would supply for each route, so
   every route can be driven end to end. */
const SAMPLE_ARGS = {
  'workstream.checkpoint': { workstream: { key: 'dispatch', title: 'Dispatch' } },
  'media.model.recommend': { capability: 'image.generate' },
  'media.generate': { model_id: 'flux-schnell' },
  'repo.inspect': { repository: 'mcclusterishere/mccluster' },
  'code.build': { repository: 'mcclusterishere/mccluster' },
  'deploy.preview': { repository: 'mcclusterishere/mccluster', ref: 'feat/x' },
  'ontology.action.apply': { action_key: 'tag', target_object_id: UUID_X, parameters: {} },
  'meeting.delegate.schedule': { scheduled_start: '2026-11-25T15:00:00Z', scheduled_end: '2026-11-25T16:00:00Z', transcription_authorized: true },
  'meeting.delegate.join': { transcription_authorized: true },
  'job.repo_health': { repository: 'mcclusterishere/mccluster' },
  'job.objective_synthesis': { source: 'owner-chat' },
  'job.game_playtest': { project_path: '/srv/prim3/game' },
  'job.prim3_agent_news': { target_id: 'prim3-desk' },
  'job.character_post': { characters: ['ava'] },
  'job.actor_news_comment': { target_id: 'actor-1' },
};
const SAMPLE_MESSAGE = `please handle this ${UUID_X} at https://meet.google.com/abc-defg-hij and say "hello everyone"`;

/* ---------- coverage ---------- */

test('every catalog capability is routed or explicitly excluded, never both', () => {
  const ids = CATALOG.capabilities.map((entry) => entry.id);
  const routed = new Set(DISPATCH_ROUTES.filter((route) => route.via === 'capability').map((route) => route.capability));
  for (const id of ids) {
    const excluded = Object.hasOwn(EXCLUDED_CAPABILITIES, id);
    assert.ok(routed.has(id) !== excluded, `${id}: needs exactly one of a route or an exclusion`);
  }
  for (const [id, reason] of Object.entries(EXCLUDED_CAPABILITIES)) {
    assert.ok(ids.includes(id), `excluded ${id} is a real capability`);
    assert.ok(reason.length > 20, `${id} has a reason`);
  }
  for (const id of routed) assert.ok(ids.includes(id), `${id} is in the catalog`);
  // Routed on purpose, not by accident: a capability added to the catalog
  // gets no route until someone writes its hint (summary, argument mapping)
  // in routes.mjs or excludes it.
  for (const route of DISPATCH_ROUTES.filter((r) => r.via === 'capability')) assert.ok(route.hint?.summary, `${route.capability} has an explicit routing hint`);
  // The headline numbers: the 48 OVH capabilities (catalog minus the 3
  // dispatch.* tools themselves), 46 routed, browser.act and site.edit excluded.
  const ovh = ids.filter((id) => !id.startsWith('dispatch.'));
  assert.equal(ovh.length, 48);
  assert.equal(ovh.filter((id) => routed.has(id)).length, 46);
  assert.deepEqual(ovh.filter((id) => !routed.has(id)).sort(), ['browser.act', 'site.edit']);
});

test('every runner job type is a job route, reached through a capability, or explicitly excluded', async () => {
  const { map } = await runnerJobTypes();
  assert.equal(map.size, 32, 'runner job types');
  const jobRoutes = new Set(DISPATCH_ROUTES.filter((route) => route.via === 'job').map((route) => route.jobType));
  for (const jobType of map.keys()) {
    const ways = [jobRoutes.has(jobType), Object.hasOwn(JOB_TYPES_VIA_CAPABILITY, jobType), Object.hasOwn(EXCLUDED_JOB_TYPES, jobType)].filter(Boolean).length;
    assert.equal(ways, 1, `${jobType}: exactly one of job route, via capability, excluded`);
  }
  for (const jobType of [...jobRoutes, ...Object.keys(JOB_TYPES_VIA_CAPABILITY), ...Object.keys(EXCLUDED_JOB_TYPES)]) assert.ok(map.has(jobType), `${jobType} is a runner job type`);
  for (const [jobType, reason] of Object.entries(EXCLUDED_JOB_TYPES)) assert.ok(reason.length > 20, `${jobType} has a reason`);
  for (const [jobType, intent] of Object.entries(JOB_TYPES_VIA_CAPABILITY)) assert.ok(ROUTABLE_INTENTS.includes(intent), `${jobType} is reached through routable ${intent}`);
  assert.equal(jobRoutes.size, 14);
});

test('a capability that claims to reach a job type really enqueues it in its Core tool', async () => {
  const sources = { control: await src('tools/control.mjs'), meeting: await src('tools/meeting.mjs'), resident: await src('resident-ai.mjs') };
  for (const [jobType, intent] of Object.entries(JOB_TYPES_VIA_CAPABILITY)) {
    const where = intent === 'answer' ? sources.resident : intent.startsWith('meeting.') ? sources.meeting : sources.control;
    assert.match(where, new RegExp(`['"]${jobType}['"]`), `${jobType} is enqueued by the tool behind ${intent}`);
  }
});

test('all 30 executor files are accounted for: reachable, excluded, or a helper', async () => {
  const { map, files } = await runnerJobTypes();
  const onDisk = (await readdir(new URL('../src/executors/', import.meta.url))).filter((name) => name.endsWith('.mjs')).map((name) => name.replace(/\.mjs$/, ''));
  assert.equal(onDisk.length, 30);
  const HELPERS = { 'host-health-collect': 'host_health' }; // imported by host-health.mjs, no job type of its own
  const reachable = (jobType) => ROUTE_BY_INTENT.has(`job.${jobType}`) || Object.hasOwn(JOB_TYPES_VIA_CAPABILITY, jobType);
  const status = {};
  for (const file of onDisk) {
    if (HELPERS[file]) { assert.ok(reachable(HELPERS[file]), `${file} helps a reachable job`); status[file] = 'helper'; continue; }
    const jobTypes = [...map].filter(([, fn]) => files.get(fn) === file).map(([jobType]) => jobType);
    assert.ok(jobTypes.length, `${file} runs at least one job type`);
    status[file] = jobTypes.some(reachable) ? 'reachable' : jobTypes.every((jobType) => Object.hasOwn(EXCLUDED_JOB_TYPES, jobType)) ? 'excluded' : 'unaccounted';
  }
  assert.equal(Object.values(status).filter((s) => s === 'unaccounted').length, 0);
  assert.deepEqual(Object.keys(status).filter((file) => status[file] === 'excluded').sort(),
    ['actor-live-comment', 'equiquant-mosaic-replay', 'game-branch-smoke', 'game-release-decision', 'lead-rescore', 'sms-assistant-turn']);
  assert.equal(Object.values(status).filter((s) => s === 'reachable' || s === 'helper').length, 24);
});

/* ---------- gates ---------- */

test('every route\'s risk and approval are the catalog\'s (or the job route\'s declared ones), and the gate follows', () => {
  for (const route of DISPATCH_ROUTES) {
    const source = route.via === 'job' ? route : CATALOG.capabilities.find((entry) => entry.id === route.capability);
    assert.equal(route.risk, source.risk, `${route.intent} risk`);
    assert.equal(route.approval, source.approval, `${route.intent} approval`);
    const gate = gateFor(route, CATALOG);
    const run = source.approval === 'none' && !['spend', 'deploy', 'destructive'].includes(source.risk);
    assert.equal(gate.decision, run ? 'run' : 'approval', route.intent);
    if (route.via === 'capability') {
      const required = (source.inputSchema?.required || []).filter((name) => name !== 'org_id');
      assert.deepEqual(route.required, required, `${route.intent} required args are the catalog's`);
      assert.equal(route.takesOrg, Object.hasOwn(source.inputSchema?.properties || {}, 'org_id'));
    }
  }
});

test('paid, outbound, public, fan-out and shared-write routes are always held for approval', () => {
  const held = [
    'media.generate', 'image.generate', 'video.generate', 'audio.generate', 'model3d.generate', 'world.generate', 'game.build',
    'code.build', 'deploy.preview', 'ontology.action.apply', 'ingest.run.begin', 'ingest.record.write', 'ingest.run.finish', 'entity.resolve', 'facts.claim',
    'meeting.delegate.schedule', 'meeting.delegate.join', 'meeting.delegate.cancel', 'meeting.delegate.chat.send', 'meeting.delegate.speak',
    'job.portfolio_plan', 'job.objective_reflection', 'job.objective_synthesis', 'job.game_playtest', 'job.weather_region_snapshot',
    'job.world_news_pairing', 'job.prim3_agent_news', 'job.character_post', 'job.actor_news_comment',
  ];
  for (const intent of held) assert.equal(gateFor(routeFor(intent), CATALOG).decision, 'approval', intent);
  const running = DISPATCH_ROUTES.filter((route) => gateFor(route, CATALOG).decision === 'run');
  assert.equal(running.length + held.length, DISPATCH_ROUTES.length, 'every route is either known-held or approval-free in the catalog');
  for (const route of running) assert.ok(['read', 'write'].includes(route.risk) && route.approval === 'none', route.intent);
  for (const id of NEVER_DISPATCHED) assert.equal(gateFor({ capability: id, tool: 'x', via: 'capability' }, CATALOG).decision, 'refused', id);
  // An agent-invisible capability is refused even if routed.
  const hidden = { capabilities: [{ id: 'core.resume', lifecycle: 'active', risk: 'read', approval: 'none', interfaces: ['http'] }] };
  assert.equal(gateFor(routeFor('core.resume'), hidden).decision, 'refused');
  const retired = { capabilities: [{ id: 'core.resume', lifecycle: 'retired', risk: 'read', approval: 'none', interfaces: ['mcp'] }] };
  assert.equal(gateFor(routeFor('core.resume'), retired).decision, 'refused');
});

/* ---------- arguments for every route ---------- */

test('every route builds its arguments from slots and the message, and names what is missing', () => {
  for (const route of DISPATCH_ROUTES) {
    const sample = SAMPLE_ARGS[route.intent] || {};
    const det = classifyDeterministic(SAMPLE_MESSAGE, { intent: route.intent, args: sample });
    assert.equal(det.source, 'caller', route.intent);
    const args = buildArgs(route, det.slots, SAMPLE_MESSAGE, { messageId: MSG });
    assert.deepEqual(missingArgs(route, args, det.slots), [], `${route.intent} is complete with sample args`);
    assert.equal('org_id' in args, false, 'the dispatcher adds org_id, never the slots');
    if (route.via === 'job') {
      assert.ok(args.target_id, `${route.intent} has a target`);
      assert.equal(typeof args.input, 'object');
    } else {
      for (const key of Object.keys(args)) assert.ok(route.properties.includes(key), `${route.intent}: ${key} is a declared property`);
    }
    // With nothing at all, a route with required args asks for them.
    const bare = buildArgs(route, {}, '', { messageId: MSG });
    const missing = missingArgs(route, bare, {});
    const needs = route.via === 'job' ? route.required : route.required.filter((name) => !(route.hint.fromMessage || []).includes(name) && !(route.hint.defaults || {})[name]);
    for (const name of needs) assert.ok(missing.includes(name), `${route.intent} asks for ${name}`);
    if (route.requiredAny.length) assert.ok(missing.some((name) => name.includes(' or ')), `${route.intent} asks for one of`);
  }
  // Message-carried fields and hinted ids land where the catalog expects them.
  assert.equal(buildArgs(routeFor('lyrics.align'), { uuid: UUID_X }, 'align').track_id, UUID_X);
  assert.equal(buildArgs(routeFor('media.job.get'), { uuid: UUID_X }, 'x').job_id, UUID_X);
  assert.equal(buildArgs(routeFor('meeting.delegate.speak'), { meeting_url: 'https://zoom.us/j/1', quote: 'hi' }, 'x').text, 'hi');
  assert.equal(buildArgs(routeFor('research.web'), {}, 'find venue photographers').objective, 'find venue photographers');
  assert.equal(buildArgs(routeFor('job.local_analysis'), {}, 'why is the gallery slow', { messageId: MSG }).target_id, MSG);
  assert.equal(buildArgs(routeFor('job.weather_region_snapshot'), {}, 'x').target_id, 'connecticut-pilot');
});

test('caller args are plain, bounded and never carry org_id; a caller intent cannot skip a refusal', () => {
  assert.deepEqual(callerArgs({ org_id: ORG, repository: 'a/b', 'Bad Key': 1, nested: { a: 1 } }), { repository: 'a/b', nested: { a: 1 } });
  assert.deepEqual(callerArgs(['x']), {});
  assert.deepEqual(callerArgs({ huge: 'x'.repeat(20000) }), {});
  assert.equal(classifyDeterministic('merge it to main', { intent: 'code.build', args: { repository: 'a/b' } }).source, 'refusal');
  assert.equal(classifyDeterministic('do it', { intent: 'browser.act' }).source === 'caller', false, 'an excluded capability is not a caller intent');
  assert.equal(classifyDeterministic('do it', { intent: 'site.edit' }).source === 'caller', false);
});

test('the model may pick any route, but only a route, and every route is in its schema', () => {
  for (const intent of ROUTABLE_INTENTS) {
    const parsed = parseModelOutput(JSON.stringify({ intent, confidence: 0.9, slots: {}, reply: '' }), 'x');
    assert.equal(parsed?.intent, intent, intent);
  }
  for (const id of [...NEVER_DISPATCHED, 'job.lead_rescore', 'job.sms_assistant_turn', 'job.actor_live_comment']) {
    assert.equal(parseModelOutput(JSON.stringify({ intent: id, confidence: 0.99, slots: {}, reply: '' }), 'x'), null, id);
  }
});

test('the deterministic table reaches the new routes', () => {
  const cases = [
    ['run a host health check on the ovh server', 'job.host_health'],
    ['run ai diagnostics', 'job.ai_diagnostics'],
    ['generate an image of a neon skyline', 'image.generate'],
    ['make a video clip of the intro', 'video.generate'],
    ['generate a 3d model of the hover bike', 'model3d.generate'],
    ['read the city lore', 'game.lore.read'],
    ['join https://meet.google.com/abc-defg-hij for me', 'meeting.delegate.join'],
    ['get the transcript of https://zoom.us/j/123456', 'meeting.delegate.transcript'],
    ['in https://zoom.us/j/123456 say "running five minutes late"', 'meeting.delegate.speak'],
    ['playtest the new level', 'job.game_playtest'],
  ];
  for (const [message, intent] of cases) {
    const result = classifyDeterministic(message);
    assert.equal(result.intent, intent, message);
    assert.ok(result.confidence >= STRONG, message);
  }
  // Generating media is paid: routed, then held.
  const d = decide(classifyDeterministic('generate an image of a neon skyline'), null, limits, 'generate an image of a neon skyline');
  assert.equal(d.route, 'capability');
  assert.equal(gateFor(routeFor(d.intent), CATALOG).decision, 'approval');
});

/* ---------- execution paths ---------- */

function fakeRpc(log, overrides = {}) {
  return async (name, args) => {
    log.push([name, args]);
    if (overrides[name]) return overrides[name](args);
    if (name === 'ops_ai_workstream_resume') return [];
    if (name === 'ops_ai_dispatch_record') return { turn: { id: '55555555-5555-4555-8555-555555555555', ...args.p_turn, status: args.p_turn.route === 'approval' ? 'pending_approval' : 'routed' } };
    if (name === 'ops_ai_dispatch_attach') return { status: args.p_patch.status };
    return null;
  };
}

test('an approval-free job route is enqueued on ops_agent_jobs and attached to the turn', async () => {
  const log = [], enqueued = [];
  const out = await dispatchTurn({ org_id: ORG, message_id: MSG, message: 'run a host health check on the ovh server' }, { actor: OWNER }, {
    rpc: fakeRpc(log), catalog: CATALOG, chat: async () => { throw new Error('model not needed'); },
    enqueue: async (job) => { enqueued.push(job); return { id: JOB, job_type: job.jobType }; },
  });
  assert.equal(out.route, 'run'); assert.equal(out.status, 'queued'); assert.equal(out.job_id, JOB);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].jobType, 'host_health'); assert.equal(enqueued[0].orgId, ORG); assert.equal(enqueued[0].targetId, 'ovh-mccluster-core');
  assert.equal(enqueued[0].input.dispatch_turn_id, '55555555-5555-4555-8555-555555555555');
  const record = log.find(([name]) => name === 'ops_ai_dispatch_record')[1].p_turn;
  assert.equal(record.tool, 'job:host_health'); assert.equal(record.capability, 'job.host_health');
  assert.equal('org_id' in record.args, false);
  assert.equal(record.request_hash, requestHash('job:host_health', record.args));
  const attach = log.find(([name]) => name === 'ops_ai_dispatch_attach')[1];
  assert.equal(attach.p_patch.job_id, JOB);
});

test('a gated job route files an approval and enqueues nothing; execute enqueues it once approved', async () => {
  const log = [], enqueued = [];
  const deps = { rpc: fakeRpc(log), catalog: CATALOG, chat: async () => { throw new Error('x'); }, enqueue: async (job) => { enqueued.push(job); return { id: JOB, job_type: job.jobType }; } };
  const out = await dispatchTurn({ org_id: ORG, message_id: MSG, message: 'post the cast updates', intent: 'job.character_post', args: { characters: ['ava'] } }, { actor: OWNER }, deps);
  assert.equal(out.route, 'approval'); assert.equal(enqueued.length, 0);
  const turn = log.find(([name]) => name === 'ops_ai_dispatch_record')[1].p_turn;
  const claimLog = [];
  const claimed = { claimed: true, turn: { id: '55555555-5555-4555-8555-555555555555', intent: turn.intent, tool: turn.tool, args: turn.args, request_hash: turn.request_hash } };
  const res = await executeDispatch({ org_id: ORG, turn_id: '55555555-5555-4555-8555-555555555555' }, { actor: OWNER }, { ...deps, rpc: fakeRpc(claimLog, { ops_ai_dispatch_claim: () => claimed }) });
  assert.equal(res.executed, true); assert.equal(res.job_id, JOB);
  assert.equal(enqueued.length, 1); assert.deepEqual(enqueued[0].input.characters, ['ava']);
  // A tampered approved request runs nothing.
  const tampered = { claimed: true, turn: { ...claimed.turn, args: { ...turn.args, target_id: 'other' } } };
  await assert.rejects(executeDispatch({ org_id: ORG, turn_id: '55555555-5555-4555-8555-555555555555' }, { actor: OWNER }, { ...deps, rpc: fakeRpc([], { ops_ai_dispatch_claim: () => tampered }) }), { code: 'DISPATCH_REQUEST_CHANGED' });
  assert.equal(enqueued.length, 1);
});

test('a catalog route goes through the broker capability registry, org_id only where the capability takes it', async () => {
  const calls = [];
  const callCapability = async (id, args, options) => { calls.push({ id, args, options }); return { capability: id, result: { tool: 'x', result: { job_id: JOB, job_type: 'objective_plan' } } }; };
  const log = [];
  const out = await dispatchTurn({ org_id: ORG, message_id: MSG, message: 'plan the music catalogue audit' }, { actor: OWNER }, { rpc: fakeRpc(log), catalog: CATALOG, callCapability, chat: async () => { throw new Error('x'); } });
  assert.equal(out.route, 'run'); assert.equal(out.job_id, JOB, 'a nested job id is found');
  assert.equal(calls[0].id, 'objective.plan'); assert.equal(calls[0].args.org_id, ORG); assert.equal(calls[0].options.actor, OWNER);
  calls.length = 0;
  await dispatchTurn({ org_id: ORG, message_id: MSG, message: 'is the api up', intent: 'system.health' }, { actor: OWNER }, { rpc: fakeRpc([]), catalog: CATALOG, callCapability, chat: async () => { throw new Error('x'); } });
  assert.equal(calls[0].id, 'system.health');
  assert.equal('org_id' in calls[0].args, routeFor('system.health').takesOrg);
});

test('runRoute: job, capability, local-control fallback, and an unwired path fails closed', async () => {
  await assert.rejects(runRoute(routeFor('job.host_health'), { target_id: 'x', input: {} }, { orgId: ORG }, {}), { code: 'DISPATCH_NOT_WIRED' });
  await assert.rejects(runRoute(routeFor('image.generate'), { prompt: 'x' }, { orgId: ORG }, { callTool: async () => ({}) }), { code: 'DISPATCH_NOT_WIRED' }, 'an http/mcp-http binding never falls back to a control tool');
  const local = [];
  await runRoute(routeFor('core.resume'), { limit: 1 }, { orgId: ORG, actor: OWNER }, { callTool: async (tool, args) => { local.push(tool); return {}; } });
  assert.deepEqual(local, ['core.resume']);
  assert.equal(jobIdOf({ result: { result: { job_id: JOB } } }), JOB);
  assert.equal(jobIdOf({ id: JOB, job_type: 'host_health' }), JOB);
  assert.equal(jobIdOf({ id: JOB }), null, 'a bare id is not a job');
});
