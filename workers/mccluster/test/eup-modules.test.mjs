// E=Up module policy Worker contract with a fake service REST: owner-only routing, what is required before
// any RPC, the acting owner (always the verified session user), every SQLSTATE the policy SQL raises, an
// unapplied schema, no caching between requests, and the Overview's separate policy field.
// The SQL itself is proven in scripts/test/eup-module-policy.integration.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEup, EUP_PREFIX, EUP_SECTIONS } from '../src/eup/router.js';
import * as modules from '../src/eup/modules.js';
import { MODULE_IDS, MODULE_STATES, MODULE_POLICY_ERRORS, modulePolicyRefusal, readModulePolicy, moduleControl } from '../src/eup/modules.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const owner = async () => ({ id: OWNER });
const denied = async () => { throw Object.assign(new Error('McCluster house owner access required'), { status: 403 }); };
const anon = async () => { throw Object.assign(new Error('Authentication required'), { status: 401 }); };
const req = (path = '', init) => new Request(`https://fixture.invalid${EUP_PREFIX}/modules${path}`, init);
const post = (path, body, headers = { 'content-type': 'application/json' }) => req(path, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const KEY = 'policy-key-0001';
const REASON = 'Test fixture: owner decision.';
const policyOf = (moduleId, state, revision) => ({ schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId, state, revision });
const receiptOf = (moduleId, state, revision, prior = null) => ({ policy: policyOf(moduleId, state, revision), changed: true, prior, recorded_at: '2026-11-10T00:00:00Z' });
const lastCommandOf = (seq, command, requested_state, expected_revision, receipt) => ({ seq, command, requested_state, expected_revision, reason: REASON, actor: OWNER, created_at: '2026-11-10T00:00:00Z', idempotency_key: `policy-key-${seq}`, receipt });
// The owner read exactly as the SQL builds it: one row per registered module, nulls for a module with no row.
const controlOf = (rows = {}, commands = []) => ({
  installationId: 'mccluster',
  modules: MODULE_IDS.map((moduleId) => rows[moduleId]
    ? { moduleId, installed: true, updated_at: '2026-11-10T00:00:00Z', updated_by: OWNER, last_command: null, ...rows[moduleId] }
    : { moduleId, installed: false, state: null, revision: null, updated_at: null, updated_by: null, last_command: null }),
  commands
});
const storeError = (code, message = 'database text that must not reach the owner', status = 400) => Response.json({ code, message, details: null, hint: null }, { status });
function fake(reply) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const call = { url: String(url), name: String(url).split('/rpc/')[1] || null, method: options.method, headers: options.headers || {}, redirect: options.redirect, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    const out = typeof reply === 'function' ? await reply(call, calls.length) : reply;
    return out instanceof Response ? out : Response.json(out);
  };
  return { calls, fetchImpl };
}
const run = (request, f, requireHouseOwner = owner) => handleEup(request, env, { requireHouseOwner, fetchImpl: f.fetchImpl, now: () => Date.parse('2026-11-10T12:00:00Z') });
const ROUTES = [
  ['GET /modules', () => req()],
  ...MODULE_IDS.flatMap((id) => [
    [`POST /modules/${id}/install`, () => post(`/${id}/install`, { idempotency_key: KEY, reason: REASON })],
    [`POST /modules/${id}/state`, () => post(`/${id}/state`, { idempotency_key: KEY, reason: REASON, state: 'enabled', expected_revision: 0 })]
  ])
];

test('modules is a registered E=Up section behind the same owner check as every other section', () => {
  assert.ok(EUP_SECTIONS.includes('modules'));
  assert.deepEqual([...MODULE_IDS], ['environment', 'league', 'intake']);
  assert.deepEqual([...MODULE_STATES], ['enabled', 'draining', 'disabled']);
});

test('every module route answers 401 without a session and 403 for a non-owner, and never reaches the store', async () => {
  for (const [label, make] of ROUTES) {
    const a = fake({}); const r401 = await run(make(), a, anon);
    assert.equal(r401.status, 401, label); assert.equal((await r401.json()).reason, 'authentication_required'); assert.equal(a.calls.length, 0, label);
    const d = fake({}); const r403 = await run(make(), d, denied);
    assert.equal(r403.status, 403, label); assert.equal((await r403.json()).reason, 'owner_required'); assert.equal(d.calls.length, 0, label);
    assert.equal(r403.headers.get('cache-control'), 'private, no-store');
    const none = await handleEup(make(), env, { fetchImpl: d.fetchImpl });
    assert.equal(none.status, 503, `${label}: no authorization function`); assert.equal(d.calls.length, 0);
    const empty = await run(make(), d, async () => null);
    assert.equal(empty.status, 401, `${label}: an owner check that returns no user`); assert.equal(d.calls.length, 0);
  }
});

test('the owner reaches every module route; each sends one service-key RPC with the session user as actor', async () => {
  const expected = {
    'GET /modules': ['eup_module_control_read', { p_actor: OWNER, p_limit: 50 }]
  };
  for (const id of MODULE_IDS) {
    expected[`POST /modules/${id}/install`] = ['eup_module_policy_install', { p_actor: OWNER, p_module: id, p_key: KEY, p_reason: REASON }];
    expected[`POST /modules/${id}/state`] = ['eup_module_policy_command', { p_actor: OWNER, p_module: id, p_state: 'enabled', p_expected_revision: 0, p_key: KEY, p_reason: REASON }];
  }
  for (const [label, make] of ROUTES) {
    const id = label.split('/')[2];
    const f = fake((call) => call.name === 'eup_module_control_read' ? controlOf() : receiptOf(id, call.name === 'eup_module_policy_install' ? 'disabled' : 'enabled', call.name === 'eup_module_policy_install' ? 0 : 1));
    const r = await run(make(), f); const b = await r.json();
    assert.equal(r.status, 200, label); assert.equal(b.ok, true); assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.equal(f.calls.length, 1, label);
    const [call] = f.calls;
    assert.equal(call.url, `https://fixture.invalid/rest/v1/rpc/${expected[label][0]}`); assert.deepEqual(call.body, expected[label][1], label);
    assert.equal(call.method, 'POST'); assert.equal(call.redirect, 'manual');
    assert.equal(call.headers.authorization, 'Bearer fixture-only'); assert.equal(call.headers.apikey, 'fixture-only');
    assert.doesNotMatch(JSON.stringify(b), /fixture-only/);
  }
});

test('GET /modules returns one normalised row per registered module, the last command and the command log', async () => {
  const drainReceipt = receiptOf('league', 'draining', 2, { state: 'enabled', revision: 1 });
  const log = [
    { seq: 3, module_id: 'league', command: 'set_state', requested_state: 'draining', expected_revision: 1, reason: REASON, actor: OWNER, prior_state: 'enabled', prior_revision: 1, idempotency_key: 'policy-key-3', receipt: drainReceipt, created_at: '2026-11-10T00:00:00Z' },
    { seq: 1, module_id: 'league', command: 'install', requested_state: 'disabled', expected_revision: null, reason: REASON, actor: OWNER, prior_state: null, prior_revision: null, idempotency_key: 'policy-key-1', receipt: receiptOf('league', 'disabled', 0), created_at: '2026-11-09T00:00:00Z' }
  ];
  const f = fake(controlOf({ league: { state: 'draining', revision: 2, last_command: lastCommandOf(3, 'set_state', 'draining', 1, drainReceipt), extra_column: 'ignored' } }, log));
  const r = await run(req(), f); const b = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(b), ['ok', 'installationId', 'modules', 'commands']);
  assert.equal(b.installationId, 'mccluster');
  assert.deepEqual(b.modules.map((m) => m.moduleId), ['environment', 'league', 'intake']);
  assert.deepEqual(b.modules[0], { moduleId: 'environment', installed: false, state: null, revision: null, updated_at: null, updated_by: null, last_command: null });
  assert.deepEqual(b.modules[1], {
    moduleId: 'league', installed: true, state: 'draining', revision: 2, updated_at: '2026-11-10T00:00:00Z', updated_by: OWNER,
    last_command: { seq: 3, command: 'set_state', requested_state: 'draining', expected_revision: 1, reason: REASON, actor: OWNER, idempotency_key: 'policy-key-3', receipt: drainReceipt, created_at: '2026-11-10T00:00:00Z' }
  });
  assert.deepEqual(b.commands, log);
  /* registry order and one row per module whatever order the store answers in */
  const shuffled = controlOf({ intake: { state: 'enabled', revision: 1 } }); shuffled.modules.reverse();
  assert.deepEqual((await (await run(req(), fake(shuffled))).json()).modules.map((m) => [m.moduleId, m.state]), [['environment', null], ['league', null], ['intake', 'enabled']]);
});

test('GET /modules takes a bounded limit and nothing else from the query', async () => {
  const f = fake(controlOf());
  assert.equal((await run(req('?limit=200'), f)).status, 200); assert.equal(f.calls[0].body.p_limit, 200);
  assert.equal((await run(req(`?limit=1&actor=${OTHER}&p_actor=${OTHER}`), f)).status, 200); assert.deepEqual(f.calls[1].body, { p_actor: OWNER, p_limit: 1 });
  for (const bad of ['0', '201', '-1', '1.5', 'all', '', '1e2', '0050x']) {
    const r = await run(req(`?limit=${bad}`), f);
    assert.equal(r.status, 400, bad); assert.equal((await r.json()).reason, 'invalid_request');
  }
  assert.equal(f.calls.length, 2, 'a refused limit never reaches the store');
});

test('a malformed owner read is a failure, never a module completed with a guess', async () => {
  const good = controlOf({ league: { state: 'enabled', revision: 1 } });
  const broken = [
    ['an empty object', {}], ['null', null], ['a list', []], ['another installation', { ...good, installationId: 'elsewhere' }],
    ['a missing module', { ...good, modules: good.modules.slice(0, 2) }],
    ['installed without a state', controlOf({ league: { state: null, revision: 1 } })],
    ['an unknown state', controlOf({ league: { state: 'on', revision: 1 } })],
    ['a text revision', controlOf({ league: { state: 'enabled', revision: '1' } })],
    ['a negative revision', controlOf({ league: { state: 'enabled', revision: -1 } })],
    ['installed that is not a boolean', { ...good, modules: good.modules.map((m) => ({ ...m, installed: 'yes' })) }]
  ];
  for (const [label, answer] of broken) {
    const r = await run(req(), fake(Response.json(answer))); const b = await r.json();
    assert.equal(r.status, 503, label); assert.equal(b.reason, 'storage_unavailable', label); assert.equal(b.modules, undefined);
    assert.doesNotMatch(JSON.stringify(b), /enabled/, label);
  }
});

test('a command needs JSON, an idempotency key and a reason before any RPC', async () => {
  const f = fake({});
  const refused = async (request, status, reason, label) => {
    const r = await run(request, f); const b = await r.json();
    assert.equal(r.status, status, label); assert.equal(b.reason, reason, label); assert.equal(b.ok, false);
  };
  for (const verb of ['install', 'state']) {
    const full = { idempotency_key: KEY, reason: REASON, state: 'enabled', expected_revision: 0 };
    const without = (name) => Object.fromEntries(Object.entries(full).filter(([k]) => k !== name));
    await refused(post(`/league/${verb}`, full, {}), 415, 'json_required', `${verb}: no content type`);
    await refused(post(`/league/${verb}`, full, { 'content-type': 'text/plain' }), 415, 'json_required', `${verb}: text`);
    await refused(req(`/league/${verb}`, { method: 'POST', headers: { 'content-type': 'application/json' } }), 400, 'body_required', `${verb}: no body`);
    await refused(post(`/league/${verb}`, '{not json'), 400, 'invalid_json', `${verb}: broken JSON`);
    for (const notObject of ['[]', 'null', '"text"', '7']) await refused(post(`/league/${verb}`, notObject), 400, 'invalid_json', `${verb}: ${notObject}`);
    await refused(post(`/league/${verb}`, { ...full, reason: 'x'.repeat(5000) }), 413, 'body_too_large', `${verb}: oversized body`);
    await refused(post(`/league/${verb}`, without('idempotency_key')), 400, 'idempotency_key_required', `${verb}: no key`);
    for (const key of ['short', 'has space 0001', 'x'.repeat(129), 12345678, null, 'semi;colon-0001']) await refused(post(`/league/${verb}`, { ...full, idempotency_key: key }), 400, 'idempotency_key_required', `${verb}: key ${key}`);
    await refused(post(`/league/${verb}`, without('reason')), 422, 'reason_required', `${verb}: no reason`);
    for (const reason of ['', '   ', '\n\t', 'x'.repeat(501), 'line one\nline two', 'bell\u0007', 42, null, ['a']]) await refused(post(`/league/${verb}`, { ...full, reason }), 422, 'reason_required', `${verb}: reason ${JSON.stringify(reason).slice(0, 20)}`);
  }
  assert.equal(f.calls.length, 0, 'nothing above reached the store');
});

test('a reason is trimmed and counted in characters, exactly as the store counts it', async () => {
  const f = fake((call) => receiptOf('league', 'disabled', 0));
  assert.equal((await run(post('/league/install', { idempotency_key: KEY, reason: `  ${REASON}  ` }), f)).status, 200);
  assert.equal(f.calls[0].body.p_reason, REASON);
  const astral = '\u{1F30D}'.repeat(500); /* 500 characters, 1000 UTF-16 units, 2000 bytes */
  assert.equal((await run(post('/league/install', { idempotency_key: KEY, reason: astral }), f)).status, 200);
  assert.equal(f.calls[1].body.p_reason, astral);
  assert.equal((await run(post('/league/install', { idempotency_key: KEY, reason: astral + 'x' }), f)).status, 422);
  assert.equal(f.calls.length, 2);
});

test('a state command also needs a known state and the expected revision before any RPC', async () => {
  const f = fake({});
  const base = { idempotency_key: KEY, reason: REASON };
  for (const state of [undefined, null, 'on', 'ENABLED', 'installed', '', 1, ['enabled']]) {
    const r = await run(post('/league/state', { ...base, state, expected_revision: 0 }), f);
    assert.equal(r.status, 422, String(state)); assert.equal((await r.json()).reason, 'invalid');
  }
  for (const expected_revision of [undefined, null, '0', -1, 1.5, 9007199254740992, NaN, true, [0]]) {
    const r = await run(post('/league/state', { ...base, state: 'draining', expected_revision }), f);
    assert.equal(r.status, 400, String(expected_revision)); assert.equal((await r.json()).reason, 'expected_revision_required');
  }
  assert.equal(f.calls.length, 0);
  const ok = fake((call) => receiptOf('league', call.body.p_state, call.body.p_expected_revision + 1, { state: 'disabled', revision: call.body.p_expected_revision }));
  for (const [state, expected_revision] of [['enabled', 0], ['draining', 1], ['disabled', 9007199254740990]]) {
    const r = await run(post('/league/state', { ...base, state, expected_revision }), ok);
    assert.equal(r.status, 200, state); assert.equal((await r.json()).receipt.policy.state, state);
  }
  assert.deepEqual(ok.calls.map((c) => [c.body.p_state, c.body.p_expected_revision]), [['enabled', 0], ['draining', 1], ['disabled', 9007199254740990]]);
  /* install ignores state and expected_revision: it has neither */
  const install = fake(receiptOf('league', 'disabled', 0));
  assert.equal((await run(post('/league/install', { ...base, state: 'enabled', expected_revision: 7 }), install)).status, 200);
  assert.deepEqual(install.calls[0].body, { p_actor: OWNER, p_module: 'league', p_key: KEY, p_reason: REASON });
});

test('the actor is the verified session user; a body, query or header never names it', async () => {
  const forged = { idempotency_key: KEY, reason: REASON, state: 'enabled', expected_revision: 0, actor: OTHER, p_actor: OTHER, user_id: OTHER, owner: OTHER, user: { id: OTHER }, p_module: 'intake', module: 'intake', p_key: 'other-key-0001' };
  for (const verb of ['install', 'state']) {
    const f = fake(receiptOf('league', verb === 'install' ? 'disabled' : 'enabled', verb === 'install' ? 0 : 1));
    const request = new Request(`https://fixture.invalid${EUP_PREFIX}/modules/league/${verb}?actor=${OTHER}&p_actor=${OTHER}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': OTHER, 'x-mcc-admin': 'true' }, body: JSON.stringify(forged) });
    const r = await run(request, f);
    assert.equal(r.status, 200, verb); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].body.p_actor, OWNER); assert.equal(f.calls[0].body.p_module, 'league'); assert.equal(f.calls[0].body.p_key, KEY);
    assert.doesNotMatch(JSON.stringify(f.calls[0]), new RegExp(OTHER), `${verb}: the forged id is sent nowhere`);
    assert.deepEqual(Object.keys(f.calls[0].body).sort(), verb === 'install' ? ['p_actor', 'p_key', 'p_module', 'p_reason'] : ['p_actor', 'p_expected_revision', 'p_key', 'p_module', 'p_reason', 'p_state']);
  }
  /* a second verified owner acts as themselves */
  const second = fake(receiptOf('league', 'disabled', 0));
  await run(post('/league/install', { idempotency_key: KEY, reason: REASON }), second, async () => ({ id: OTHER }));
  assert.equal(second.calls[0].body.p_actor, OTHER);
});

test('a receipt is returned as stored: policy, changed, prior, recorded_at', async () => {
  const install = await run(post('/intake/install', { idempotency_key: KEY, reason: REASON }), fake({ ...receiptOf('intake', 'disabled', 0), unknown_column: 1 }));
  assert.deepEqual(await install.json(), { ok: true, receipt: { policy: policyOf('intake', 'disabled', 0), changed: true, prior: null, recorded_at: '2026-11-10T00:00:00Z' } });
  const replay = { policy: policyOf('intake', 'draining', 2), changed: false, prior: { state: 'draining', revision: 2 }, recorded_at: '2026-11-10T00:00:01Z' };
  const same = await run(post('/intake/state', { idempotency_key: KEY, reason: REASON, state: 'draining', expected_revision: 2 }), fake(replay));
  assert.deepEqual(await same.json(), { ok: true, receipt: replay });
});

test('a 200 without a readable receipt is an unknown outcome (503), not a success', async () => {
  for (const [label, answer] of [['empty', {}], ['null', null], ['a list', []], ['another module', receiptOf('league', 'disabled', 0)], ['another installation', { ...receiptOf('intake', 'disabled', 0), policy: { ...policyOf('intake', 'disabled', 0), installationId: 'elsewhere' } }], ['unknown state', receiptOf('intake', 'on', 0)], ['no changed flag', { policy: policyOf('intake', 'disabled', 0) }], ['text', 'ok']]) {
    for (const [verb, body] of [['install', { idempotency_key: KEY, reason: REASON }], ['state', { idempotency_key: KEY, reason: REASON, state: 'enabled', expected_revision: 0 }]]) {
      const r = await run(post(`/intake/${verb}`, body), fake(Response.json(answer))); const b = await r.json();
      assert.equal(r.status, 503, `${label} ${verb}`); assert.equal(b.reason, 'storage_unavailable'); assert.equal(b.receipt, undefined);
    }
  }
});

test('every SQLSTATE an owner command can raise has its own status and reason, and no database text is passed on', async () => {
  const mapped = [
    ['42501', 403, 'owner_required'], ['40001', 409, 'revision_conflict'], ['22023', 422, 'invalid'], ['EUM01', 404, 'module_not_installed'],
    ['EUM05', 409, 'drain_required'], ['EUM06', 409, 'idempotency_conflict'], ['EUM07', 409, 'module_already_installed'],
    ['55P03', 503, 'drain_busy'], ['57014', 503, 'drain_busy'], ['PGRST202', 503, 'schema_not_applied'], ['42883', 503, 'schema_not_applied']
  ];
  assert.deepEqual(Object.keys(MODULE_POLICY_ERRORS.command).sort(), mapped.map(([code]) => code).sort(), 'the test covers the whole command table');
  for (const [code, status, reason] of mapped) {
    assert.deepEqual([...MODULE_POLICY_ERRORS.command[code]], [status, reason]);
    for (const [label, make] of ROUTES) {
      const f = fake(() => storeError(code, undefined, code === 'PGRST202' ? 404 : code === '42501' ? 403 : code === '40001' ? 409 : 400));
      const r = await run(make(), f); const b = await r.json();
      assert.equal(r.status, status, `${code} ${label}`); assert.equal(b.reason, reason, `${code} ${label}`); assert.equal(b.ok, false);
      assert.doesNotMatch(JSON.stringify(b), /database text|fixture-only/, `${code} ${label}`);
      assert.equal(f.calls.length, 1, `${code} ${label}: one attempt, no retry`);
    }
  }
  /* anything else, with or without a body, is the store being unavailable: never a success, never a 500 */
  for (const answer of [() => storeError('XX000'), () => storeError('EUM02'), () => storeError('23505'), () => new Response('upstream timeout', { status: 504 }), () => new Response(null, { status: 500 }), () => Response.json({ message: 'no code' }, { status: 400 }), () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid/' } }), () => { throw new Error('offline'); }]) {
    for (const [label, make] of ROUTES) {
      const r = await run(make(), fake(answer)); const b = await r.json();
      assert.equal(r.status, 503, label); assert.equal(b.reason, 'storage_unavailable', label); assert.doesNotMatch(JSON.stringify(b), /database text|offline|upstream timeout/);
    }
  }
});

test('an unapplied policy schema says so on every route', async () => {
  for (const answer of [() => storeError('PGRST202', 'Could not find the function public.eup_module_control_read(p_actor, p_limit) in the schema cache', 404), () => storeError('42883', 'function public.eup_module_policy_json(text, text, bigint) does not exist', 404)]) {
    for (const [label, make] of ROUTES) {
      const r = await run(make(), fake(answer)); const b = await r.json();
      assert.equal(r.status, 503, label); assert.equal(b.reason, 'schema_not_applied', label); assert.match(b.error, /eup_module_policy_v1\.sql/); assert.doesNotMatch(b.error, /schema cache|does not exist/);
    }
  }
});

test('an unconfigured store answers 503 without a request', async () => {
  for (const partial of [{}, { SUPABASE_URL: 'https://fixture.invalid' }, { SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' }]) {
    for (const [label, make] of ROUTES) {
      const f = fake({});
      const r = await handleEup(make(), { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS, ...partial }, { requireHouseOwner: owner, fetchImpl: f.fetchImpl });
      assert.equal(r.status, 503, label); assert.equal((await r.json()).reason, 'storage_unavailable'); assert.equal(f.calls.length, 0);
    }
  }
});

test('unknown modules, unknown verbs and wrong methods never reach the store', async () => {
  const f = fake({});
  const body = { idempotency_key: KEY, reason: REASON, state: 'enabled', expected_revision: 0 };
  for (const [request, status, reason] of [
    [post('/halo/install', body), 404, 'unknown_module'], [post('/consumer_environment/state', body), 404, 'unknown_module'], [post('/LEAGUE/state', body), 404, 'unknown_module'],
    [post('/__proto__/install', body), 404, 'unknown_module'], [post('/league', body), 404, 'not_found'], [req('/league'), 404, 'not_found'],
    [post('/league/enable', body), 404, 'not_found'], [post('/league/state/extra', body), 404, 'not_found'], [post('/league/install/', body), 404, 'not_found'],
    [req('/league/state'), 405, 'method_not_allowed'], [req('/league/install'), 405, 'method_not_allowed'],
    [req('/league/state', { method: 'DELETE' }), 405, 'method_not_allowed'], [req('/league/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), 405, 'method_not_allowed'],
    [post('', body), 405, 'method_not_allowed'], [req('', { method: 'DELETE' }), 405, 'method_not_allowed']
  ]) {
    const r = await run(request, f);
    assert.equal(r.status, status, `${request.method} ${new URL(request.url).pathname}`); assert.equal((await r.json()).reason, reason);
  }
  assert.equal(f.calls.length, 0);
});

test('nothing is cached between requests: every read and every command goes to the store again', async () => {
  let state = 'disabled'; let revision = 0;
  const f = fake((call) => {
    if (call.name === 'eup_module_control_read') return controlOf({ league: { state, revision } });
    if (call.name === 'eup_module_policy_read') return policyOf('league', state, revision);
    const prior = { state, revision }; state = call.body.p_state; revision += 1;
    return receiptOf('league', state, revision, prior);
  });
  const league = async () => (await (await run(req(), f)).json()).modules[1];
  assert.deepEqual([(await league()).state, (await league()).revision], ['disabled', 0]);
  assert.equal((await run(post('/league/state', { idempotency_key: 'policy-key-0002', reason: REASON, state: 'enabled', expected_revision: 0 }), f)).status, 200);
  assert.deepEqual([(await league()).state, (await league()).revision], ['enabled', 1]);
  assert.equal((await readModulePolicy(env, f.fetchImpl, 'league')).state, 'enabled');
  state = 'draining'; revision = 2; /* changed behind the Worker, by another isolate or another owner */
  assert.equal((await readModulePolicy(env, f.fetchImpl, 'league')).state, 'draining');
  assert.deepEqual([(await league()).state, (await league()).revision], ['draining', 2]);
  assert.equal(f.calls.filter((c) => c.name === 'eup_module_control_read').length, 6);
  assert.equal(f.calls.filter((c) => c.name === 'eup_module_policy_read').length, 2);
  /* the same key sent twice is sent twice: replay is the store's decision, not a Worker memory */
  const twice = fake(receiptOf('league', 'disabled', 0));
  for (let i = 0; i < 2; i += 1) assert.equal((await run(post('/league/install', { idempotency_key: KEY, reason: REASON }), twice)).status, 200);
  assert.equal(twice.calls.length, 2); assert.deepEqual(twice.calls[0].body, twice.calls[1].body);
});

test('MODULE_POLICY_ERRORS.guard is the one table for a refused domain write, and it is frozen', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(MODULE_POLICY_ERRORS.guard).map(([code, pair]) => [code, [...pair]])), {
    EUM00: [503, 'module_policy_unavailable'], EUM01: [503, 'module_not_installed'], '42883': [503, 'module_not_installed'],
    EUM02: [503, 'module_draining'], EUM03: [409, 'module_disabled'], EUM04: [409, 'module_policy_changed'],
    '55P03': [503, 'module_busy'], '57014': [503, 'module_busy']
  });
  /* the pinned product's public route answers the same guard refusals with its own statuses */
  assert.deepEqual(Object.fromEntries(Object.entries(MODULE_POLICY_ERRORS.consumer).map(([code, pair]) => [code, [...pair]])), {
    EUM01: [503, 'module_not_installed'], EUM02: [503, 'module_draining'], EUM03: [404, 'module_disabled'], EUM04: [409, 'module_policy_changed']
  });
  assert.deepEqual(Object.keys(MODULE_POLICY_ERRORS).sort(), ['command', 'consumer', 'guard']);
  for (const tableName of ['guard', 'command', 'consumer']) {
    assert.ok(Object.isFrozen(MODULE_POLICY_ERRORS[tableName])); assert.ok(Object.values(MODULE_POLICY_ERRORS[tableName]).every(Object.isFrozen));
    assert.throws(() => { 'use strict'; MODULE_POLICY_ERRORS[tableName].EUM03 = [200, 'enabled']; }, TypeError);
  }
  assert.ok(Object.isFrozen(MODULE_POLICY_ERRORS)); assert.ok(Object.isFrozen(MODULE_IDS)); assert.ok(Object.isFrozen(MODULE_STATES));
  /* a spread into another section's table keeps the pairs (how a domain section composes it) */
  const composed = { '42501': [403, 'owner_required'], ...MODULE_POLICY_ERRORS.guard };
  assert.deepEqual([...composed.EUM02], [503, 'module_draining']);
});

test('modulePolicyRefusal reads a SQLSTATE, a store error body or a driver error, and nothing else', () => {
  for (const [code, pair] of Object.entries(MODULE_POLICY_ERRORS.guard)) {
    assert.equal(modulePolicyRefusal(code), pair);
    assert.equal(modulePolicyRefusal({ code, message: 'anything' }), pair);
    assert.equal(modulePolicyRefusal(Object.assign(new Error('module_draining'), { code })), pair);
  }
  const [status, reason] = modulePolicyRefusal({ code: 'EUM03' });
  assert.deepEqual([status, reason], [409, 'module_disabled']);
  for (const other of [null, undefined, '', 'EUM05', 'EUM06', 'EUM07', '42501', '40001', 'P0002', 'PGRST202', 'eum02', 'constructor', 'toString', '__proto__', 'hasOwnProperty', {}, { code: 42883 }, { code: null }, { message: 'module_draining' }, { status: 503, reason: 'module_draining' }, 42883, [], ['EUM02'], new Error('EUM02')]) {
    assert.equal(modulePolicyRefusal(other), null, JSON.stringify(other));
  }
});

test('readModulePolicy returns only a well-formed persisted policy and throws on everything else', async () => {
  const good = fake(policyOf('environment', 'draining', 4));
  assert.deepEqual(await readModulePolicy(env, good.fetchImpl, 'environment'), policyOf('environment', 'draining', 4));
  assert.deepEqual(good.calls[0].body, { p_module: 'environment' }); assert.equal(good.calls[0].headers.authorization, 'Bearer fixture-only');
  const refused = async (answer, module, reason, label) => {
    await assert.rejects(readModulePolicy(env, fake(answer).fetchImpl, module), (error) => { assert.equal(error.status, 503, label); assert.equal(error.reason, reason, label); return true; }, label);
  };
  await refused(() => storeError('EUM01', 'module_not_installed'), 'environment', 'module_not_installed', 'no row');
  await refused(() => storeError('PGRST202', 'missing', 404), 'environment', 'schema_not_applied', 'schema absent');
  await refused(() => storeError('57014', 'canceling statement due to statement timeout', 500), 'environment', 'module_busy', 'timeout');
  await refused(() => { throw new Error('offline'); }, 'environment', 'storage_unavailable', 'offline');
  await refused(() => new Response('<html>', { status: 200 }), 'environment', 'module_policy_unavailable', 'not JSON');
  for (const [label, answer] of [['empty', {}], ['null', null], ['other module', policyOf('league', 'enabled', 1)], ['other installation', { ...policyOf('environment', 'enabled', 1), installationId: 'x' }], ['other schema', { ...policyOf('environment', 'enabled', 1), schema: 'v2' }], ['unknown state', policyOf('environment', 'on', 1)], ['no state', { ...policyOf('environment', 'enabled', 1), state: undefined }], ['text revision', policyOf('environment', 'enabled', '1')], ['unsafe revision', policyOf('environment', 'enabled', 2 ** 53)], ['a list', [policyOf('environment', 'enabled', 1)]]]) {
    await refused(Response.json(answer), 'environment', 'module_policy_unavailable', label);
  }
  const never = fake(policyOf('environment', 'enabled', 1));
  for (const module of ['halo', '', undefined, null, 'consumer_environment']) {
    await assert.rejects(readModulePolicy(env, never.fetchImpl, module), (error) => error.reason === 'module_policy_unavailable');
  }
  assert.equal(never.calls.length, 0, 'an unregistered module is refused without a request');
  await assert.rejects(readModulePolicy({}, never.fetchImpl, 'environment'), (error) => error.status === 503 && error.reason === 'storage_unavailable');
});

test('moduleControl is the owner read other sections use: same normalisation, same refusals', async () => {
  const fail = (status, message, reason) => Object.assign(new Error(message), { status, reason });
  const f = fake(controlOf({ intake: { state: 'enabled', revision: 3 } }));
  const control = await moduleControl(env, f.fetchImpl, fail, OWNER, 1);
  assert.deepEqual(f.calls[0].body, { p_actor: OWNER, p_limit: 1 });
  assert.deepEqual(control.modules[2], { moduleId: 'intake', installed: true, state: 'enabled', revision: 3, updated_at: '2026-11-10T00:00:00Z', updated_by: OWNER, last_command: null });
  await assert.rejects(moduleControl(env, fake(() => storeError('42501', 'House owner required', 403)).fetchImpl, fail, OTHER), (error) => error.status === 403 && error.reason === 'owner_required');
});

test('the module exports are the documented ones', () => {
  assert.deepEqual(Object.keys(modules).sort(), ['MODULE_IDS', 'MODULE_INSTALLATION', 'MODULE_POLICY_ERRORS', 'MODULE_POLICY_SCHEMA', 'MODULE_STATES', 'handleModules', 'moduleControl', 'modulePolicyRefusal', 'readModulePolicy']);
});

// --- Overview: release posture and persisted policy are two fields -------------------------------------
const overview = (reply) => {
  const f = fake((call) => {
    if (call.name === 'eup_module_control_read') return typeof reply === 'function' ? reply(call) : reply;
    if (call.name === 'eup_league_command') return { campaigns: { drafts: 1 }, queues: {}, latest_change: null };
    if (call.name === 'eup_sources_read') return [];
    return Response.json({ message: 'denied' }, { status: 403 });
  });
  return handleEup(new Request(`https://fixture.invalid${EUP_PREFIX}/overview`), env, { requireHouseOwner: owner, fetchImpl: f.fetchImpl, now: () => Date.parse('2026-11-10T12:00:00Z') }).then(async (r) => ({ status: r.status, body: await r.json(), calls: f.calls }));
};
const POSTURE = { league: 'draft', civic: 'planned', companies: 'planned', sources: 'planned', consumer_environment: 'held', arcade: 'dormant', c5: 'partial' };
const UNIT = { league: 'league', civic: 'intake', companies: 'intake', sources: 'intake', consumer_environment: 'environment', arcade: null, c5: null };

test('overview gives each module its release posture and, separately, the persisted policy of the unit that governs it', async () => {
  const { status, body, calls } = await overview(controlOf({ league: { state: 'enabled', revision: 1 }, intake: { state: 'draining', revision: 4, updated_at: '2026-11-10T01:00:00Z' } }));
  assert.equal(status, 200);
  assert.deepEqual(Object.fromEntries(body.modules.map((m) => [m.id, m.state])), POSTURE, 'the release posture is unchanged by the policy');
  assert.deepEqual(Object.fromEntries(body.modules.map((m) => [m.id, m.policy_module])), UNIT);
  const policy = Object.fromEntries(body.modules.map((m) => [m.id, m.policy]));
  assert.deepEqual(policy.league, { installed: true, state: 'enabled', revision: 1, updated_at: '2026-11-10T00:00:00Z' });
  for (const id of ['civic', 'companies', 'sources']) assert.deepEqual(policy[id], { installed: true, state: 'draining', revision: 4, updated_at: '2026-11-10T01:00:00Z' }, id);
  assert.deepEqual(policy.consumer_environment, { installed: false, state: null, revision: null, updated_at: null });
  assert.equal(policy.arcade, null); assert.equal(policy.c5, null);
  assert.deepEqual(body.module_policy, { status: 'available', reason: null });
  assert.ok(!body.blockers.some((b) => /^module_policy/.test(b.id)));
  const read = calls.filter((c) => c.name === 'eup_module_control_read');
  assert.equal(read.length, 1); assert.deepEqual(read[0].body, { p_actor: OWNER, p_limit: 1 });
  assert.ok(body.modules.every((m) => typeof m.label === 'string' && typeof m.detail === 'string'));
});

test('overview with nothing installed reports installed false for every governed module', async () => {
  const { body } = await overview(controlOf());
  for (const m of body.modules) assert.deepEqual(m.policy, UNIT[m.id] ? { installed: false, state: null, revision: null, updated_at: null } : null, m.id);
  assert.deepEqual(body.module_policy, { status: 'available', reason: null });
});

test('overview names the absent policy schema as a blocker and reports no module enabled', async () => {
  const { status, body } = await overview(() => storeError('PGRST202', 'Could not find the function', 404));
  assert.equal(status, 200);
  assert.deepEqual(body.module_policy, { status: 'schema_not_applied', reason: 'schema_not_applied' });
  const blocker = body.blockers.find((b) => b.id === 'module_policy_schema');
  assert.equal(blocker.gate, 'schema'); assert.match(blocker.text, /supabase\/pending\/eup_module_policy_v1\.sql/);
  for (const m of body.modules) assert.deepEqual(m.policy, UNIT[m.id] ? { installed: null, state: 'unknown', revision: null, updated_at: null } : null, m.id);
  assert.deepEqual(Object.fromEntries(body.modules.map((m) => [m.id, m.state])), POSTURE);
});

test('overview never reports enabled when the policy read failed, whatever the failure', async () => {
  const failures = [
    ['store error', () => storeError('XX000'), 'storage_unavailable'], ['lock wait', () => storeError('55P03'), 'drain_busy'], ['statement timeout', () => storeError('57014'), 'drain_busy'],
    ['not the owner', () => storeError('42501', 'House owner required', 403), 'owner_required'], ['offline', () => { throw new Error('offline'); }, 'storage_unavailable'],
    ['gateway', () => new Response('bad gateway', { status: 502 }), 'storage_unavailable'], ['empty answer', () => Response.json({}), 'storage_unavailable'],
    ['one module missing', () => { const c = controlOf({ league: { state: 'enabled', revision: 1 }, intake: { state: 'enabled', revision: 1 }, environment: { state: 'enabled', revision: 1 } }); c.modules.pop(); return Response.json(c); }, 'storage_unavailable'],
    ['one module unreadable', () => Response.json(controlOf({ league: { state: 'enabled', revision: 1 }, intake: { state: 'enabled', revision: 'x' }, environment: { state: 'enabled', revision: 1 } })), 'storage_unavailable']
  ];
  for (const [label, reply, reason] of failures) {
    const { status, body } = await overview(reply);
    assert.equal(status, 200, label);
    assert.deepEqual(body.module_policy, { status: 'unavailable', reason }, label);
    for (const m of body.modules) {
      assert.deepEqual(m.policy, UNIT[m.id] ? { installed: null, state: 'unknown', revision: null, updated_at: null } : null, `${label} ${m.id}`);
      assert.notEqual(m.state, 'enabled', `${label} ${m.id}`);
    }
    assert.doesNotMatch(JSON.stringify(body.modules.map((m) => m.policy)), /enabled/, label);
    const blocker = body.blockers.find((b) => b.id === 'module_policy_unreadable');
    assert.ok(blocker, label); assert.equal(blocker.gate, 'storage'); assert.match(blocker.text, new RegExp(reason));
    assert.ok(!body.blockers.some((b) => b.id === 'module_policy_schema'), label);
    assert.doesNotMatch(JSON.stringify(body), /database text|fixture-only|bad gateway/, label);
  }
});
