// E=Up import job (src/eup/import-runner.js): claim -> source gate -> plan -> policy check -> bounded upstream
// read -> parse -> apply bound to the claim's policy revision -> settlement by the lease.
//
// Two layers, same handler:
//   1. A scripted store and a fake upstream behind one injected fetch. Always runs. It pins the order of the
//      steps, what is sent, every refusal the store can answer, the exact-host allow-list, and that no URL
//      query, header, credential, lease or database text reaches a result, a log entry or a stored reason.
//   2. The REAL pending SQL (eup_module_policy_v1.sql + eup_intake_v1.sql) in PGlite through
//      scripts/test/support/eup-intake-database.mjs, with a fake upstream. PGlite is not a dependency of this
//      repository: these tests run when PGLITE_MODULE names it (or the package resolves) and are reported as
//      SKIPPED, with the reason, when it does not. A PGLITE_MODULE that is set and does not load is a failure.
//      PGlite is one serial session: this is not a lock-contention proof (scripts/test/eup-module-policy.native.mjs).
//
// Nothing here reaches a network: the upstream is a function, and the offline guard stays the global fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as runner from '../src/eup/import-runner.js';
import { runImportJob, IMPORT_PLANS, MAX_UPSTREAM_REQUESTS, APPLY_CHUNK, DEFAULT_LEASE_SECONDS, IMPORT_MODULE } from '../src/eup/import-runner.js';
import { MODULE_POLICY_ERRORS } from '../src/eup/modules.js';
import { intakeApply, importRunClaim, importRunFinish, importRunRelease, readRunCounts } from '../src/eup/intake.js';
import { handleEup, EUP_PREFIX } from '../src/eup/router.js';
import { parseSecSubmissions, parseSecCompanyFacts } from '../src/eup/adapters/sec.js';
import { FEED_REGISTRY } from '../src/eup/registry.js';

const fixtureText = (name) => readFile(new URL(`./fixtures/eup/${name}`, import.meta.url), 'utf8');
const SUBMISSIONS = await fixtureText('sec-submissions.json');
const COMPANYFACTS = await fixtureText('sec-companyfacts.json');
const GLEIF_RECORD = await fixtureText('gleif-record.json');
const AT = '2026-11-10T12:00:00.000Z';
const NOW = Date.parse(AT);
const FACTS = parseSecCompanyFacts(JSON.parse(COMPANYFACTS), { fetched_at: AT }).length;
const LOCATIONS = parseSecSubmissions(JSON.parse(SUBMISSIONS), { fetched_at: AT }).locations.length;
const SEC_RECORDS = 1 + LOCATIONS + FACTS;
const SUBMISSIONS_URL = 'https://data.sec.gov/submissions/CIK0001234567.json';
const FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001234567.json';
/* The SEC plan's upstream as a function: the two synthetic documents, anything else is a test failure. */
const secUpstream = (url) => {
  if (url.href === SUBMISSIONS_URL) return SUBMISSIONS;
  if (url.href === FACTS_URL) return COMPANYFACTS;
  throw new Error(`unexpected upstream ${url.host}${url.pathname}`);
};
const body200 = (text) => new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });

// ---------------------------------------------------------------------------------------------------------
// 1. Scripted store
// ---------------------------------------------------------------------------------------------------------
const RUN = '7b0c6f4e-1111-4111-8111-000000000001';
const LEASE = 'fixture-runner#lease-secret-0001';
const SERVICE_KEY = 'fixture-service-key-0001';
const AGENT = 'Fixture agent contact-secret-0001';
const DB_TEXT = 'database text https://db.fixture.invalid/?apikey=db-secret-0001 that must not leave the store';
const ENV = { SUPABASE_URL: 'https://db.fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SEC_USER_AGENT: AGENT };
const CLAIM = { claimed: true, run_id: RUN, source_id: 'sec_edgar', cursor: { cik: '1234567', facts: true }, attempt: 0, lease: LEASE, lease_expires_at: '2026-11-10T12:05:00Z', policy_revision: 3, reclaimed: false };
const STATE = { source_id: 'sec_edgar', configured: true, access: 'approved', paused: false, rights_expires_at: null };
const policyOf = (state, revision) => ({ schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId: 'intake', state, revision });
const refusal = (code, message = DB_TEXT) => Response.json({ code, message, details: null, hint: null }, { status: 400 });
const STEP = { eup_import_run_claim: 'claim', eup_sources_read: 'states', eup_module_policy_read: 'policy', eup_intake_apply: 'apply', eup_import_run_finish: 'finish', eup_import_run_release: 'release' };

function plane(script = {}) {
  const calls = []; const logs = [];
  const play = {
    claim: () => CLAIM, states: () => [STATE], policy: () => policyOf('enabled', 3),
    apply: (b) => ({ applied: b.p_records.length, duplicates: 0, reviewed: 0 }),
    finish: (b) => ({ run_id: b.p_run_id, status: b.p_status, attempt: 1, replayed: false }),
    release: (b) => ({ run_id: b.p_run_id, status: 'queued', released: true }),
    upstream: secUpstream, ...script
  };
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.host === 'db.fixture.invalid') {
      const name = u.pathname.split('/rest/v1/rpc/')[1];
      if (!Object.hasOwn(STEP, name)) throw new Error(`unexpected RPC ${name}`);
      const call = { step: STEP[name], name, body: JSON.parse(options.body), key: options.headers?.apikey };
      calls.push(call);
      const out = await play[call.step](call.body, calls);
      return out instanceof Response ? out : Response.json(out);
    }
    calls.push({ step: 'upstream', url: u.href, host: u.host, headers: { ...(options.headers || {}) }, redirect: options.redirect });
    const out = await play.upstream(u, options, calls);
    return out instanceof Response ? out : body200(out);
  };
  const steps = () => calls.map((c) => c.step);
  const of = (step) => calls.filter((c) => c.step === step);
  const run = (options = {}) => runImportJob(ENV, { worker: 'fixture-runner', fetchImpl, now: () => NOW, log: (entry) => logs.push(entry), ...options });
  return { calls, logs, steps, of, run, fetchImpl };
}
/* Everything that leaves the handler for a reader: its answer, its log entries, and the reasons it stores. */
const visible = (p, result) => JSON.stringify({ result, logs: p.logs, stored: [...p.of('finish'), ...p.of('release')].map((c) => ({ error: c.body.p_error, reason: c.body.p_reason })) });
const GUARD_CODES = Object.keys(MODULE_POLICY_ERRORS.guard);

test('the documented exports, and nothing in the Worker source imports the job (no route, no schedule)', async () => {
  assert.deepEqual(Object.keys(runner).sort(), ['APPLY_CHUNK', 'DEFAULT_LEASE_SECONDS', 'IMPORT_MODULE', 'IMPORT_PLANS', 'MAX_UPSTREAM_REQUESTS', 'runImportJob']);
  assert.equal(IMPORT_MODULE, 'intake'); assert.equal(DEFAULT_LEASE_SECONDS, 300);
  assert.deepEqual(Object.keys(IMPORT_PLANS).sort(), ['gleif', 'sec_edgar']);
  assert.ok(Object.isFrozen(IMPORT_PLANS) && Object.values(IMPORT_PLANS).every((plan) => Object.isFrozen(plan) && Object.isFrozen(plan.hosts)));
  /* every plan belongs to a registered source that is not held, and reads only hosts under that source's own domain */
  for (const [id, plan] of Object.entries(IMPORT_PLANS)) {
    const feed = FEED_REGISTRY.find((f) => f.id === id);
    assert.ok(feed && feed.access !== 'held', id);
    const domain = new URL(feed.url).hostname.replace(/^www\./, '');
    assert.ok(plan.hosts.every((h) => h === domain || h.endsWith(`.${domain}`)), id);
  }
  const src = new URL('../src/', import.meta.url);
  const importers = [];
  for (const name of await readdir(src, { recursive: true })) {
    if (!/\.(js|mjs|ts|json|toml)$/.test(name) || name.replace(/\\/g, '/') === 'eup/import-runner.js') continue;
    /* an import of the module (static or dynamic) or a use of its entry point; a comment naming the file is neither */
    if (/(?:from|import)\s*\(?\s*['"`][^'"`]*import-runner|runImportJob/.test(await readFile(new URL(name, src), 'utf8'))) importers.push(name);
  }
  assert.deepEqual(importers, [], 'no module, route or schedule under src/ imports the import job');
  assert.match("import { runImportJob } from './eup/import-runner.js'; await import('./import-runner.js')", /(?:from|import)\s*\(?\s*['"`][^'"`]*import-runner/, 'the pattern does find an import');
  const wrangler = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8').catch(() => '');
  assert.doesNotMatch(wrangler, /import-runner|runImportJob/);
});

test('a complete job: the steps in order, every write bound to the claim revision, settled with the lease', async () => {
  const p = plane();
  const result = await p.run({ source_id: 'sec_edgar', lease_seconds: 120 });
  assert.deepEqual(p.steps(), ['claim', 'states', 'policy', 'upstream', 'policy', 'upstream', 'apply', 'apply', 'apply', 'finish']);
  assert.deepEqual(p.of('claim')[0].body, { p_worker: 'fixture-runner', p_source_id: 'sec_edgar', p_lease_seconds: 120 });
  assert.deepEqual(p.of('states')[0].body, { p_action: 'list', p_params: {} });
  assert.deepEqual(p.of('policy').map((c) => c.body), [{ p_module: 'intake' }, { p_module: 'intake' }], 'the policy is read again before every upstream request');
  assert.deepEqual(p.of('upstream').map((c) => c.url), [SUBMISSIONS_URL, FACTS_URL]);
  assert.ok(p.of('upstream').every((c) => c.redirect === 'manual' && c.headers['user-agent'] === AGENT), 'the bounded read: no automatic redirect, the SEC agent header from its binding');
  const applies = p.of('apply');
  assert.deepEqual(applies.map((c) => [c.body.p_source_id, c.body.p_kind, c.body.p_records.length, c.body.p_policy_revision]), [['sec_edgar', 'company', 1, 3], ['sec_edgar', 'company_location', LOCATIONS, 3], ['sec_edgar', 'company_fact', FACTS, 3]]);
  const records = applies.flatMap((c) => c.body.p_records);
  assert.ok(records.every((r) => r.provenance.source_id === 'sec_edgar' && r.provenance.fetched_at === AT && /^[0-9a-f]{64}$/.test(r.raw_hash)), 'every record carries provenance, the fetch time and the hash of the document it came from');
  assert.equal(new Set(records.map((r) => r.raw_hash)).size, 2, 'one hash per upstream document');
  assert.deepEqual(p.of('finish')[0].body, { p_run_id: RUN, p_status: 'completed', p_records: SEC_RECORDS, p_error: null, p_cursor: null, p_lease: LEASE });
  assert.ok(p.calls.filter((c) => c.name).every((c) => c.key === SERVICE_KEY), 'every store call is a service call');
  assert.deepEqual(result, {
    outcome: 'completed', finished: true, status: 'completed', reason: null, claimed: true, run_id: RUN, source_id: 'sec_edgar', policy_revision: 3, attempt: 0, reclaimed: false,
    records: SEC_RECORDS, applied: SEC_RECORDS, duplicates: 0, reviewed: 0,
    upstream: [{ id: 'submissions', host: 'data.sec.gov', path: '/submissions/CIK0001234567.json' }, { id: 'companyfacts', host: 'data.sec.gov', path: '/api/xbrl/companyfacts/CIK0001234567.json' }]
  });
  assert.deepEqual(p.logs, [result], 'one log entry: the answer itself');
});

test('the default scope of the SEC plan is identity and addresses; facts are read only when the cursor asks', async () => {
  const p = plane({ claim: () => ({ ...CLAIM, cursor: { cik: 1234567 } }) });
  const result = await p.run();
  assert.deepEqual(p.of('upstream').map((c) => c.url), [SUBMISSIONS_URL]);
  assert.deepEqual(p.of('apply').map((c) => c.body.p_kind), ['company', 'company_location']);
  assert.equal(result.outcome, 'completed'); assert.equal(result.records, 1 + LOCATIONS);
  assert.deepEqual(p.of('claim')[0].body, { p_worker: 'fixture-runner', p_source_id: null, p_lease_seconds: 300 }, 'no source and no lease named: any source, the default lease');
});

test('the GLEIF plan reads one LEI record from its own host and applies the company before its locations', async () => {
  const p = plane({
    claim: () => ({ ...CLAIM, source_id: 'gleif', cursor: { lei: 'SYNTH00000000000GRID' } }), states: () => [{ ...STATE, source_id: 'gleif' }],
    upstream: (url) => { assert.equal(url.href, 'https://api.gleif.org/api/v1/lei-records/SYNTH00000000000GRID'); return GLEIF_RECORD; }
  });
  const result = await p.run();
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(p.of('apply').map((c) => [c.body.p_source_id, c.body.p_kind, c.body.p_records.length]), [['gleif', 'company', 1], ['gleif', 'company_location', 2]]);
  assert.ok(!('user-agent' in p.of('upstream')[0].headers), 'no other source is sent the SEC agent binding');
});

test('nothing to claim is idle: one store call and no upstream request', async () => {
  const p = plane({ claim: () => ({ claimed: false, policy_revision: 3 }) });
  assert.deepEqual(await p.run(), { outcome: 'idle', claimed: false, policy_revision: 3 });
  assert.deepEqual(p.steps(), ['claim']);
});

test('a refused claim starts nothing: no upstream request, no settlement, the shared module reason', async () => {
  for (const code of GUARD_CODES) {
    const p = plane({ claim: () => refusal(code) });
    const result = await p.run();
    assert.deepEqual(result, { outcome: 'refused', claimed: false, reason: MODULE_POLICY_ERRORS.guard[code][1] }, code);
    assert.deepEqual(p.steps(), ['claim'], `${code}: the claim is the only call`);
    assert.doesNotMatch(visible(p, result), /database text|db-secret/, code);
  }
  const others = [
    ['a bad worker name', () => refusal('22023', 'worker_and_lease_required'), 'invalid_request'], ['the store is down', () => { throw new Error(`offline ${DB_TEXT}`); }, 'storage_unavailable'],
    ['a gateway page', () => new Response('bad gateway', { status: 502 }), 'storage_unavailable'], ['the schema is absent', () => refusal('PGRST202'), 'storage_unavailable'],
    ['an answer with no lease', () => ({ ...CLAIM, lease: null }), 'storage_unavailable'], ['an answer with no revision', () => ({ ...CLAIM, policy_revision: null }), 'storage_unavailable'],
    ['an empty answer', () => ({}), 'storage_unavailable'], ['a list', () => [], 'storage_unavailable']
  ];
  for (const [label, claim, reason] of others) {
    const p = plane({ claim });
    assert.deepEqual(await p.run(), { outcome: 'refused', claimed: false, reason }, label);
    assert.deepEqual(p.steps(), ['claim'], label);
  }
  const unconfigured = await runImportJob({}, { worker: 'fixture-runner', fetchImpl: async () => { throw new Error('must not be called'); } });
  assert.deepEqual(unconfigured, { outcome: 'refused', claimed: false, reason: 'storage_unavailable' });
});

test('the source gate decides before any request: a connector that is disabled, unapproved, held, expired or unbound is never fetched', async () => {
  const cases = [
    ['no state row', { states: () => [] }, {}, 'not_configured'],
    ['access not reviewed', { states: () => [{ ...STATE, access: 'not_reviewed' }] }, {}, 'not_configured'],
    ['access held in the store', { states: () => [{ ...STATE, access: 'held' }] }, {}, 'not_configured'],
    ['not configured', { states: () => [{ ...STATE, configured: false }] }, {}, 'not_configured'],
    ['rights expired', { states: () => [{ ...STATE, rights_expires_at: '2026-01-01T00:00:00Z' }] }, {}, 'rights_expired'],
    ['credential binding absent', {}, { env: { ...ENV, SEC_USER_AGENT: '' } }, 'not_configured'],
    ['a source the registry holds, approved in the store all the same', { claim: () => ({ ...CLAIM, source_id: 'openfec' }), states: () => [{ ...STATE, source_id: 'openfec' }] }, { env: { ...ENV, OPENFEC_API_KEY: 'fixture-openfec-key' } }, 'rights_held'],
    ['a source the registry does not know', { claim: () => ({ ...CLAIM, source_id: 'fixture_unknown' }), states: () => [{ ...STATE, source_id: 'fixture_unknown' }] }, {}, 'unknown_source'],
    ['the state read fails', { states: () => refusal('XX000') }, {}, 'storage_unavailable']
  ];
  for (const [label, script, { env = ENV } = {}, reason] of cases) {
    const p = plane(script);
    const result = await runImportJob(env, { worker: 'fixture-runner', fetchImpl: p.fetchImpl, now: () => NOW, log: (e) => p.logs.push(e) });
    assert.deepEqual(p.steps(), ['claim', 'states', 'finish'], `${label}: no policy read, no upstream request, no write`);
    assert.deepEqual(p.of('finish')[0].body, { p_run_id: RUN, p_status: 'failed', p_records: null, p_error: reason, p_cursor: null, p_lease: LEASE }, label);
    assert.deepEqual([result.outcome, result.finished, result.status, result.reason, result.upstream], ['failed', true, 'failed', reason, []], label);
    assert.doesNotMatch(visible(p, result), /fixture-openfec-key|database text|db-secret/, label);
  }
});

test('a source paused after the claim gives its run back instead of failing it', async () => {
  const p = plane({ states: () => [{ ...STATE, paused: true }] });
  const result = await p.run();
  assert.deepEqual(p.steps(), ['claim', 'states', 'release']);
  assert.deepEqual(p.of('release')[0].body, { p_run_id: RUN, p_lease: LEASE, p_reason: 'source_paused' });
  assert.deepEqual([result.outcome, result.released, result.reason], ['released', true, 'source_paused']);
});

test('a source without a plan, or a run whose cursor names no scope, fetches nothing', async () => {
  const cases = [
    ['a registered source with no plan', { claim: () => ({ ...CLAIM, source_id: 'census_tiger' }), states: () => [{ ...STATE, source_id: 'census_tiger' }] }, {}, 'no_import_plan'],
    ['an empty cursor, as a refresh queues it', { claim: () => ({ ...CLAIM, cursor: {} }) }, {}, 'no_import_scope'],
    ['a cursor that is not a company number', { claim: () => ({ ...CLAIM, cursor: { cik: '../../x' } }) }, {}, 'no_import_scope'],
    ['an LEI that is not one', { claim: () => ({ ...CLAIM, source_id: 'gleif', cursor: { lei: 'short' } }), states: () => [{ ...STATE, source_id: 'gleif' }] }, {}, 'no_import_scope'],
    ['no plans at all', {}, { plans: {} }, 'no_import_plan'], ['a plan inherited from a prototype', {}, { plans: Object.create({ sec_edgar: IMPORT_PLANS.sec_edgar }) }, 'no_import_plan'],
    ['a plan with no host list', {}, { plans: { sec_edgar: { hosts: [], requests: () => [{ id: 'a', url: SUBMISSIONS_URL }], parse: () => [] } } }, 'no_import_plan'],
    ['a plan that asks for nothing', {}, { plans: { sec_edgar: { hosts: ['data.sec.gov'], requests: () => [], parse: () => [] } } }, 'no_import_scope'],
    ['a plan that throws', {}, { plans: { sec_edgar: { hosts: ['data.sec.gov'], requests: () => { throw new Error(`boom ${DB_TEXT}`); }, parse: () => [] } } }, 'no_import_plan']
  ];
  for (const [label, script, options, reason] of cases) {
    const p = plane(script);
    const result = await p.run(options);
    assert.deepEqual(p.steps(), ['claim', 'states', 'finish'], label);
    assert.equal(p.of('finish')[0].body.p_error, reason, label); assert.equal(result.reason, reason, label);
    assert.doesNotMatch(visible(p, result), /database text|db-secret/, label);
  }
});

test('nothing is fetched outside the allow-list: one bad request in a plan and no request at all is sent', async () => {
  const good = { id: 'ok', url: SUBMISSIONS_URL };
  const planOf = (requests, hosts = ['data.sec.gov']) => ({ sec_edgar: { hosts, requests: () => requests, parse: () => [] } });
  const hostile = [
    'https://evil.example/x', 'http://data.sec.gov/x', 'https://data.sec.gov:8443/x', 'https://user:pass@data.sec.gov/x', 'https://data.sec.gov.evil.example/x',
    'https://notdata.sec.gov/x', 'https://www.sec.gov/x', 'https://evilsec.gov/x', 'https://sec.gov/x', 'ftp://data.sec.gov/x', 'not a url', '//data.sec.gov/x', '', null
  ];
  const cases = hostile.flatMap((url) => [[`alone: ${url}`, planOf([{ id: 'bad', url }])], [`after a good one: ${url}`, planOf([good, { id: 'bad', url }])]]);
  cases.push(
    ['more requests than a job may send', planOf(Array.from({ length: MAX_UPSTREAM_REQUESTS + 1 }, (_, i) => ({ id: `r${i}`, url: SUBMISSIONS_URL })))],
    ['two requests under one id', planOf([good, { ...good }])], ['a request with no id', planOf([{ url: SUBMISSIONS_URL }])],
    /* a plan cannot widen its source: a host it lists has to be the source's registered host or a subdomain of it */
    ['a plan that lists a host outside the source', planOf([good, { id: 'bad', url: 'https://evil.example/x' }], ['data.sec.gov', 'evil.example'])],
    ['a plan that lists a look-alike of the source domain', planOf([good, { id: 'bad', url: 'https://evilsec.gov/x' }], ['data.sec.gov', 'evilsec.gov'])],
    ['a plan that lists the source domain as a prefix of another', planOf([{ id: 'bad', url: 'https://data.sec.gov.evil.example/x' }], ['data.sec.gov.evil.example'])]
  );
  for (const [label, plans] of cases) {
    const p = plane({ upstream: () => { throw new Error('the upstream must not be called'); } });
    const result = await p.run({ plans });
    assert.deepEqual(p.of('upstream'), [], `${label}: no upstream request`);
    assert.deepEqual(p.of('apply'), [], label);
    assert.deepEqual([result.outcome, result.reason, result.upstream], ['failed', 'invalid_upstream', []], label);
    assert.equal(p.of('finish')[0].body.p_error, 'invalid_upstream', label);
  }
  assert.equal(MAX_UPSTREAM_REQUESTS, 4);
  /* the exact number a job may send is admitted */
  const p = plane({ upstream: () => '{}' });
  const full = await p.run({ plans: planOf(Array.from({ length: MAX_UPSTREAM_REQUESTS }, (_, i) => ({ id: `r${i}`, url: `https://data.sec.gov/fixture/${i}` }))) });
  assert.equal(p.of('upstream').length, MAX_UPSTREAM_REQUESTS); assert.equal(full.outcome, 'completed');
});

test('an upstream that redirects to another host is not followed, and a failed or oversized answer fails the run', async () => {
  const redirect = plane({ upstream: () => new Response(null, { status: 302, headers: { location: 'https://evil.example/collect?token=redirect-secret-0001' } }) });
  const moved = await redirect.run();
  assert.deepEqual(redirect.of('upstream').map((c) => c.host), ['data.sec.gov'], 'the redirect target is never requested');
  assert.deepEqual([moved.outcome, moved.reason, moved.upstream], ['failed', 'upstream_redirect', []]);
  assert.doesNotMatch(visible(redirect, moved), /evil\.example|redirect-secret/);
  const cases = [
    ['HTTP 503', () => new Response('unavailable', { status: 503 }), 'upstream_unavailable'], ['HTTP 404', () => new Response('{}', { status: 404 }), 'upstream_unavailable'],
    ['a network error', () => { throw new TypeError(`fetch failed for ${SUBMISSIONS_URL}?token=net-secret-0001`); }, 'upstream_unavailable'],
    ['a body over the 2 MB bound', () => body200('x'.repeat(2 * 1024 * 1024 + 1)), 'upstream_unavailable'],
    ['a body that is not JSON', () => body200('<html>maintenance</html>'), 'parse_failed'], ['a document without a company number', () => body200('{}'), 'parse_failed']
  ];
  for (const [label, upstream, reason] of cases) {
    const p = plane({ upstream });
    const result = await p.run();
    assert.deepEqual([result.outcome, result.reason], ['failed', reason], label);
    assert.deepEqual(p.of('apply'), [], `${label}: nothing is written`);
    assert.equal(p.of('finish')[0].body.p_error, reason, label);
    assert.doesNotMatch(visible(p, result), /net-secret|maintenance|fetch failed/, label);
  }
});

test('the policy check before a request fails closed: anything but enabled at the claim revision sends nothing and gives the run back', async () => {
  const cases = [
    ['draining', () => policyOf('draining', 4), 'module_draining'], ['disabled', () => policyOf('disabled', 5), 'module_disabled'],
    ['drained and re-enabled: another revision', () => policyOf('enabled', 5), 'module_policy_changed'],
    ['no longer installed', () => refusal('EUM01'), 'module_not_installed'], ['house absent', () => refusal('EUM00'), 'module_policy_unavailable'],
    ['policy schema absent', () => refusal('PGRST202'), 'schema_not_applied'], ['lock wait', () => refusal('55P03'), 'module_busy'],
    ['store down', () => { throw new Error('offline'); }, 'storage_unavailable'], ['an answer for another module', () => ({ ...policyOf('enabled', 3), moduleId: 'league' }), 'module_policy_unavailable'],
    ['an unreadable answer', () => ({ state: 'enabled' }), 'module_policy_unavailable']
  ];
  for (const [label, policy, reason] of cases) {
    const p = plane({ policy });
    const result = await p.run();
    assert.deepEqual(p.steps(), ['claim', 'states', 'policy', 'release'], `${label}: no upstream request, no write`);
    assert.deepEqual(p.of('release')[0].body, { p_run_id: RUN, p_lease: LEASE, p_reason: reason }, label);
    assert.deepEqual([result.outcome, result.released, result.reason, result.upstream], ['released', true, reason, []], label);
  }
  /* the check is repeated: a drain that lands after the first document stops the second request */
  let reads = 0;
  const p = plane({ policy: () => { reads += 1; return reads === 1 ? policyOf('enabled', 3) : policyOf('draining', 4); } });
  const result = await p.run();
  assert.deepEqual(p.steps(), ['claim', 'states', 'policy', 'upstream', 'policy', 'release']);
  assert.deepEqual([result.outcome, result.reason, result.upstream.map((u) => u.id)], ['released', 'module_draining', ['submissions']]);
});

test('a write refused by module policy releases the run with the shared reason; it is never finished', async () => {
  for (const code of GUARD_CODES) {
    const reason = MODULE_POLICY_ERRORS.guard[code][1];
    const p = plane({ apply: () => refusal(code) });
    const result = await p.run();
    assert.deepEqual(p.steps(), ['claim', 'states', 'policy', 'upstream', 'policy', 'upstream', 'apply', 'release'], `${code}: one refused write, then the release`);
    assert.deepEqual(p.of('release')[0].body, { p_run_id: RUN, p_lease: LEASE, p_reason: reason }, code);
    assert.deepEqual([result.outcome, result.released, result.reason, result.records, result.applied], ['released', true, reason, 0, 0], code);
    assert.deepEqual(Object.keys(result).filter((k) => k === 'finished' || k === 'status'), [], code);
    assert.doesNotMatch(visible(p, result), /database text|db-secret/, code);
  }
  /* a refusal part of the way through: what landed stays counted, the rest is not sent */
  let writes = 0;
  const p = plane({ apply: (b) => { writes += 1; return writes === 2 ? refusal('EUM02', 'module_draining') : { applied: b.p_records.length, duplicates: 0, reviewed: 0 }; } });
  const result = await p.run();
  assert.equal(p.of('apply').length, 2); assert.deepEqual([result.outcome, result.reason, result.records, result.applied], ['released', 'module_draining', 1, 1]);
});

test('any other failed write finishes the run as failed with a fixed reason', async () => {
  const cases = [
    ['an unknown company', () => refusal('P0002', 'unknown_company'), 'not_found'], ['an invalid record', () => refusal('22023', 'provenance_missing_url'), 'invalid_request'],
    ['a store error', () => refusal('XX000'), 'storage_unavailable'], ['the store is down', () => { throw new Error('offline'); }, 'storage_unavailable'],
    ['a gateway page', () => new Response('bad gateway', { status: 502 }), 'storage_unavailable']
  ];
  for (const [label, apply, reason] of cases) {
    const p = plane({ apply });
    const result = await p.run();
    assert.deepEqual(p.steps().slice(-2), ['apply', 'finish'], label);
    assert.deepEqual(p.of('finish')[0].body, { p_run_id: RUN, p_status: 'failed', p_records: null, p_error: reason, p_cursor: null, p_lease: LEASE }, label);
    assert.deepEqual([result.outcome, result.finished, result.status, result.reason], ['failed', true, 'failed', reason], label);
    assert.deepEqual(p.of('release'), [], label);
    assert.doesNotMatch(visible(p, result), /database text|db-secret|bad gateway/, label);
  }
});

test('records are written in chunks, each its own guarded write, and a parser cannot write for another source', async () => {
  const record = (i, source_id = 'sec_edgar') => ({ external_id: `fixture:${i}`, raw_hash: `h${i}`, provenance: { source_id } });
  const many = Array.from({ length: 2 * APPLY_CHUNK + 50 }, (_, i) => record(i));
  const plans = (parse) => ({ sec_edgar: { hosts: ['data.sec.gov'], requests: () => [{ id: 'doc', url: SUBMISSIONS_URL }], parse } });
  const p = plane({ upstream: () => '{}' });
  const result = await p.run({ plans: plans(() => [{ kind: 'company', records: many }, { kind: 'company_location', records: [] }]) });
  assert.deepEqual(p.of('apply').map((c) => [c.body.p_kind, c.body.p_records.length, c.body.p_policy_revision]), [['company', APPLY_CHUNK, 3], ['company', APPLY_CHUNK, 3], ['company', 50, 3]], 'an empty batch is not sent');
  assert.deepEqual([result.outcome, result.records, result.applied], ['completed', many.length, many.length]);
  const bad = [
    ['a record of another source', () => [{ kind: 'company', records: [record(1), record(2, 'gleif')] }]], ['a record without provenance', () => [{ kind: 'company', records: [{ external_id: 'x' }] }]],
    ['a batch without a kind', () => [{ records: [record(1)] }]], ['not a list of batches', () => ({ kind: 'company', records: [record(1)] })], ['a parser that throws', () => { throw new Error(DB_TEXT); }]
  ];
  for (const [label, parse] of bad) {
    const q = plane({ upstream: () => '{}' });
    const out = await q.run({ plans: plans(parse) });
    assert.deepEqual(q.of('apply'), [], `${label}: nothing is written`);
    assert.deepEqual([out.outcome, out.reason, q.of('finish')[0].body.p_error], ['failed', 'parse_failed', 'parse_failed'], label);
    assert.doesNotMatch(visible(q, out), /database text|db-secret/, label);
  }
});

test('a lost lease cannot settle: the answer says unsettled and why, and nothing is retried', async () => {
  const cases = [
    ['finish: another claim took the run over', { finish: () => refusal('EUI01', 'lease_lost') }, { finished: false, intended: 'completed', reason: null, settle_reason: 'lease_lost' }, 'finish'],
    ['finish: the run is no longer running', { finish: () => refusal('EUI02', 'run_not_running') }, { finished: false, intended: 'completed', reason: null, settle_reason: 'run_not_running' }, 'finish'],
    ['finish: the run is gone', { finish: () => refusal('P0002', 'run_not_found') }, { finished: false, intended: 'completed', reason: null, settle_reason: 'not_found' }, 'finish'],
    ['finish: the store is down', { finish: () => { throw new Error('offline'); } }, { finished: false, intended: 'completed', reason: null, settle_reason: 'storage_unavailable' }, 'finish'],
    ['finish of a failed run: another claim took it over', { upstream: () => new Response('x', { status: 503 }), finish: () => refusal('EUI01', 'lease_lost') }, { finished: false, intended: 'failed', reason: 'upstream_unavailable', settle_reason: 'lease_lost' }, 'finish'],
    ['release: another claim took the run over', { policy: () => policyOf('draining', 4), release: () => refusal('EUI01', 'lease_lost') }, { released: false, reason: 'module_draining', settle_reason: 'lease_lost' }, 'release'],
    ['release: the run is no longer running', { policy: () => policyOf('draining', 4), release: () => refusal('EUI02', 'run_not_running') }, { released: false, reason: 'module_draining', settle_reason: 'run_not_running' }, 'release'],
    ['release: the store is down', { policy: () => policyOf('draining', 4), release: () => new Response('bad gateway', { status: 502 }) }, { released: false, reason: 'module_draining', settle_reason: 'storage_unavailable' }, 'release']
  ];
  for (const [label, script, expected, step] of cases) {
    const p = plane(script);
    const result = await p.run();
    assert.equal(result.outcome, 'unsettled', label);
    for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value, `${label}: ${key}`);
    assert.equal(p.of(step).length, 1, `${label}: one attempt`);
    assert.equal(p.of(step === 'finish' ? 'release' : 'finish').length, 0, `${label}: the other settlement is not tried`);
    assert.ok(!('status' in result), `${label}: an unsettled answer claims no status`);
  }
});

test('the job stops when its own clock says the lease is nearly over: no request and no write after that', async () => {
  let clock = NOW;
  const during = plane({ upstream: (url) => { clock += 26_000; return secUpstream(url); } });
  const slowRead = await during.run({ now: () => clock, lease_seconds: 30 });
  assert.deepEqual(during.steps(), ['claim', 'states', 'policy', 'upstream', 'finish'], 'the second document is not requested');
  assert.deepEqual([slowRead.outcome, slowRead.reason, during.of('finish')[0].body.p_status, during.of('finish')[0].body.p_error], ['failed', 'lease_expired', 'failed', 'lease_expired']);
  clock = NOW; let writes = 0;
  const writing = plane({ apply: (b) => { writes += 1; if (writes === 1) clock += 296_000; return { applied: b.p_records.length, duplicates: 0, reviewed: 0 }; } });
  const slowWrite = await writing.run({ now: () => clock });
  assert.equal(writing.of('apply').length, 1, 'the next write is not sent');
  assert.deepEqual([slowWrite.outcome, slowWrite.reason, slowWrite.records], ['failed', 'lease_expired', 1]);
  clock = NOW;
  const inTime = plane({ upstream: (url) => { clock += 24_000; return secUpstream(url); } });
  assert.equal((await inTime.run({ now: () => clock, lease_seconds: 60 })).outcome, 'completed', 'inside the lease the job goes on');
});

test('no URL query, header, credential, lease or database text reaches an answer, a log entry or a stored reason', async () => {
  const TOKEN = 'query-secret-0001'; const HEADER = 'header-secret-0001';
  const plans = { sec_edgar: { hosts: ['data.sec.gov'], requests: () => [{ id: 'doc', url: `https://data.sec.gov/fixture/doc?api_key=${TOKEN}&q=1#frag-secret-0001`, headers: { 'x-api-key': HEADER } }], parse: () => [] } };
  const secret = new RegExp([TOKEN, HEADER, 'frag-secret', 'contact-secret', 'lease-secret', SERVICE_KEY, 'db-secret', 'database text', 'api_key'].join('|'));
  const outcomes = [
    ['completed', {}], ['a refused write', { apply: () => refusal('EUM02') }], ['an upstream failure', { upstream: () => { throw new Error(`failed https://data.sec.gov/fixture/doc?api_key=${TOKEN}`); } }],
    ['an upstream 500 that echoes the request', { upstream: (url) => new Response(`error for ${url.href}`, { status: 500 }) }],
    ['a lost lease', { finish: () => refusal('EUI01', `lease_lost ${LEASE}`) }], ['a failed release', { policy: () => policyOf('draining', 4), release: () => refusal('XX000') }]
  ];
  for (const [label, script] of outcomes) {
    const p = plane({ upstream: () => '{}', ...script });
    const result = await p.run({ plans });
    assert.doesNotMatch(visible(p, result), secret, label);
    assert.ok(p.logs.length === 1 && p.logs[0] === result, `${label}: the only log entry is the answer`);
    if (p.of('upstream').length) {
      assert.equal(p.of('upstream')[0].url, `https://data.sec.gov/fixture/doc?api_key=${TOKEN}&q=1`, `${label}: the request itself still carries its query`);
      assert.equal(p.of('upstream')[0].headers['x-api-key'], HEADER, `${label}: and its header`);
    }
    if (result.upstream.length) assert.deepEqual(result.upstream, [{ id: 'doc', host: 'data.sec.gov', path: '/fixture/doc' }], label);
  }
  /* the built-in SEC job as well: the agent binding goes upstream in a header and nowhere else */
  const p = plane();
  assert.doesNotMatch(visible(p, await p.run()), secret);
  /* a log sink that throws does not stop the job */
  const q = plane();
  assert.equal((await q.run({ log: () => { throw new Error('sink down'); } })).outcome, 'completed');
});

// --- the intake helpers and the Overview counts this job relies on -----------------------------------------
test('intake helpers: the lease on finish, the revision on apply only when there is one, and the two lease refusals', async () => {
  const p = plane({ apply: () => ({ applied: 0, duplicates: 0, reviewed: 0 }) });
  const ctx = { fetchImpl: p.fetchImpl };
  await intakeApply(ENV, ctx, 'sec_edgar', 'company', []);
  await intakeApply(ENV, ctx, 'sec_edgar', 'company', [], 0);
  assert.deepEqual(p.of('apply').map((c) => c.body), [{ p_source_id: 'sec_edgar', p_kind: 'company', p_records: [] }, { p_source_id: 'sec_edgar', p_kind: 'company', p_records: [], p_policy_revision: 0 }]);
  await importRunFinish(ENV, ctx, RUN, 'completed', 2, null, { page: 1 }, LEASE);
  await importRunFinish(ENV, ctx, RUN, 'completed', 2, null, null);
  assert.deepEqual(p.of('finish').map((c) => c.body), [{ p_run_id: RUN, p_status: 'completed', p_records: 2, p_error: null, p_cursor: { page: 1 }, p_lease: LEASE }, { p_run_id: RUN, p_status: 'completed', p_records: 2, p_error: null, p_cursor: null, p_lease: null }]);
  await importRunRelease(ENV, ctx, RUN, LEASE, 'module_draining');
  assert.deepEqual(p.of('release')[0].body, { p_run_id: RUN, p_lease: LEASE, p_reason: 'module_draining' });
  for (const [code, status, reason] of [['EUI01', 409, 'lease_lost'], ['EUI02', 409, 'run_not_running'], ['P0002', 404, 'not_found']]) {
    const q = plane({ finish: () => refusal(code, reason), release: () => refusal(code, reason) });
    await assert.rejects(importRunFinish(ENV, { fetchImpl: q.fetchImpl }, RUN, 'completed', 0, null, null, LEASE), (e) => e.status === status && e.reason === reason && !/database text/.test(e.message), code);
    await assert.rejects(importRunRelease(ENV, { fetchImpl: q.fetchImpl }, RUN, LEASE, 'x'), (e) => e.status === status && e.reason === reason, code);
  }
  /* settlement is not a guarded write: a slow settlement is the store, not the module; a claim is guarded */
  for (const code of ['55P03', '57014', '42883']) {
    const q = plane({ finish: () => refusal(code), release: () => refusal(code), claim: () => refusal(code) });
    await assert.rejects(importRunFinish(ENV, { fetchImpl: q.fetchImpl }, RUN, 'failed', null, 'x', null, LEASE), { reason: 'storage_unavailable' }, code);
    await assert.rejects(importRunRelease(ENV, { fetchImpl: q.fetchImpl }, RUN, LEASE, 'x'), { reason: 'storage_unavailable' }, code);
    await assert.rejects(importRunClaim(ENV, { fetchImpl: q.fetchImpl }, 'fixture-runner'), { reason: MODULE_POLICY_ERRORS.guard[code][1] }, code);
  }
  const counts = plane({ states: (b) => { assert.deepEqual(b, { p_action: 'run_counts', p_params: {} }); return { queued: 2, running: 1, running_expired: 0, lease_expires_at: '2026-11-10T12:05:00Z' }; } });
  assert.deepEqual(await readRunCounts(ENV, { fetchImpl: counts.fetchImpl }), { queued: 2, running: 1, running_expired: 0, lease_expires_at: '2026-11-10T12:05:00Z' });
});

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const overviewWith = async (runCounts) => {
  const fetchImpl = async (url, options = {}) => {
    const name = String(url).split('/rest/v1/rpc/')[1] || ''; const b = options.body ? JSON.parse(options.body) : {};
    if (name === 'eup_sources_read' && b.p_action === 'run_counts') { const out = await runCounts(); return out instanceof Response ? out : Response.json(out); }
    if (name === 'eup_sources_read') return Response.json([]);
    if (name === 'eup_module_control_read') return Response.json({ installationId: 'mccluster', commands: [], modules: ['environment', 'league', 'intake'].map((moduleId) => ({ moduleId, installed: true, state: moduleId === 'intake' ? 'draining' : 'enabled', revision: 2, updated_at: AT, updated_by: OWNER_ID, last_command: null })) });
    return Response.json({ message: 'denied' }, { status: 403 });
  };
  const response = await handleEup(new Request(`https://fixture.invalid${EUP_PREFIX}/overview`), ENV, { requireHouseOwner: async () => ({ id: OWNER_ID }), fetchImpl, now: () => NOW });
  return { status: response.status, body: await response.json() };
};
const INTAKE_UNITS = ['civic', 'companies', 'sources'];

test('overview shows the open import runs beside the policy of every module the intake unit governs', async () => {
  const counts = { queued: 2, running: 3, running_expired: 1, lease_expires_at: '2026-11-10T12:05:00Z' };
  const { status, body } = await overviewWith(() => ({ ...counts, extra: 'ignored' }));
  assert.equal(status, 200);
  for (const m of body.modules) {
    assert.deepEqual(m.import_runs, INTAKE_UNITS.includes(m.id) ? counts : null, m.id);
    if (INTAKE_UNITS.includes(m.id)) { assert.equal(m.policy_module, 'intake'); assert.equal(m.policy.state, 'draining'); }
  }
  assert.deepEqual(body.import_run_counts, { status: 'available', reason: null });
  assert.deepEqual((await overviewWith(() => ({ queued: 0, running: 0, running_expired: 0, lease_expires_at: null }))).body.modules.find((m) => m.id === 'sources').import_runs, { queued: 0, running: 0, running_expired: 0, lease_expires_at: null }, 'a real zero is a zero');
});

test('overview never shows a count it did not read: a failed or malformed read is null, not zero', async () => {
  const UNKNOWN = { queued: null, running: null, running_expired: null, lease_expires_at: null };
  const cases = [
    ['a store error', () => refusal('XX000'), 'storage_unavailable'], ['the intake schema is absent', () => refusal('PGRST202'), 'storage_unavailable'], ['a statement timeout', () => refusal('57014'), 'storage_unavailable'],
    ['offline', () => { throw new Error('offline'); }, 'storage_unavailable'], ['a gateway page', () => new Response('bad gateway', { status: 502 }), 'storage_unavailable'],
    ['null, as an older intake file answers the action', () => Response.json(null), 'storage_unavailable'], ['a list', () => [], 'storage_unavailable'], ['an empty object', () => ({}), 'storage_unavailable'],
    ['a missing count', () => ({ queued: 1, running: 1 }), 'storage_unavailable'], ['a count that is text', () => ({ queued: '1', running: 0, running_expired: 0 }), 'storage_unavailable'],
    ['a negative count', () => ({ queued: -1, running: 0, running_expired: 0 }), 'storage_unavailable'], ['more expired than running', () => ({ queued: 0, running: 1, running_expired: 2 }), 'storage_unavailable']
  ];
  for (const [label, runCounts, reason] of cases) {
    const { status, body } = await overviewWith(runCounts);
    assert.equal(status, 200, label);
    for (const m of body.modules) assert.deepEqual(m.import_runs, INTAKE_UNITS.includes(m.id) ? UNKNOWN : null, `${label} ${m.id}`);
    assert.deepEqual(body.import_run_counts, { status: 'unavailable', reason }, label);
    assert.doesNotMatch(JSON.stringify(body), /database text|db-secret|bad gateway/, label);
  }
});

// ---------------------------------------------------------------------------------------------------------
// 2. The real pending SQL in PGlite
// ---------------------------------------------------------------------------------------------------------
const PGLITE = process.env.PGLITE_MODULE || '@electric-sql/pglite';
let realSqlSkip = false;
try { await import(PGLITE); }
catch (error) {
  if (process.env.PGLITE_MODULE) throw new Error(`PGLITE_MODULE is set but does not load: ${error.message}`);
  realSqlSkip = 'PGlite is not installed: set PGLITE_MODULE to its dist/index.js to run the import job against the real pending SQL';
}
const real = (name, fn) => test(`real SQL: ${name}`, { skip: realSqlSkip }, fn);
const SEC_CURSOR = { cik: '1234567', facts: true };

/* A fresh database with the policy and intake SQL applied, sec_edgar approved and configured, and a plane whose
   store is that database and whose upstream is a function. `after[rpc]` runs once the named call has committed;
   `upstream` runs inside the job's upstream request. Both are where a test moves the world under the job. */
async function world({ enable = true } = {}) {
  const support = await import('../../../scripts/test/support/eup-intake-database.mjs');
  const policy = await import('../../../scripts/test/support/eup-module-policy-database.mjs');
  const h = await support.createEupDatabase({ enable });
  const { db } = h;
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  const ready = (source, extra = '') => db.exec(`insert into public.eup_source_registry_state(source_id, access, configured) values ('${source}', 'approved', true)
    on conflict (source_id) do update set access = 'approved', configured = true, paused = false, rights_expires_at = null; ${extra}`);
  let keys = 0;
  const queue = async (source, cursor) => {
    keys += 1;
    const queued = await h.rpc('eup_sources_command', { p_action: 'refresh', p_params: { source_id: source, idempotency_key: `fixture-refresh-${keys}` }, p_actor: support.OWNER });
    assert.equal(queued.created, true);
    /* Nothing in this release writes a run's cursor; the scope of this run is a test fixture. */
    await db.query('update public.eup_import_runs set cursor = $1::jsonb where id = $2', [JSON.stringify(cursor), queued.run_id]);
    return queued.run_id;
  };
  const run = async (id) => (await rows('select status, error, attempt, lease_token, lease_expires_at, policy_revision, finished_at from public.eup_import_runs where id = $1', [id]))[0];
  const source = async (id) => (await rows('select last_success_at, last_error, records from public.eup_source_registry_state where source_id = $1', [id]))[0];
  const counts = () => h.rpc('eup_sources_read', { p_action: 'run_counts', p_params: {} });
  const data = async () => Object.fromEntries(await Promise.all(support.INTAKE_DATA_TABLES.map(async (t) => [t, await h.count(t)])));
  const written = async () => Object.values(await data()).reduce((a, b) => a + b, 0);
  const job = ({ upstream = secUpstream, after = {}, env = h.env, ...options } = {}) => {
    const seen = { upstream: [], rpc: [] };
    const fetchImpl = async (url, init = {}) => {
      const u = new URL(String(url));
      if (u.host === 'local.invalid') {
        const name = u.pathname.split('/rest/v1/rpc/')[1];
        seen.rpc.push(name);
        const response = await h.fetchImpl(url, init);
        if (after[name]) { const hook = after[name]; delete after[name]; await hook(); }
        return response;
      }
      seen.upstream.push(u.href);
      const out = await upstream(u, init, seen);
      return out instanceof Response ? out : body200(out);
    };
    return runImportJob(env, { worker: 'fixture-runner', source_id: 'sec_edgar', fetchImpl, ...options }).then((result) => ({ result, seen }));
  };
  await ready('sec_edgar');
  return {
    h, db, rows, ready, queue, run, source, counts, data, written, job, OWNER: support.OWNER,
    drain: () => policy.drainModule(db, 'intake'), disable: () => policy.disableModule(db, 'intake'),
    enable: () => policy.setModuleState(db, 'intake', 'enabled'), install: () => policy.installModule(db, 'intake'),
    revision: async () => (await policy.readModulePolicy(db, 'intake')).revision, close: () => h.close()
  };
}

real('a complete SEC job lands its records once; the same documents again are duplicates, not second copies', async () => {
  const w = await world();
  try {
    const first = await w.queue('sec_edgar', SEC_CURSOR);
    assert.deepEqual(await w.counts(), { queued: 1, running: 0, running_expired: 0, lease_expires_at: null });
    let during = null; let overview = null;
    const { result, seen } = await w.job({
      upstream: async (url) => {
        if (!during) { during = await w.counts(); overview = await (await w.h.handle('overview')).json(); }
        return secUpstream(url);
      }
    });
    assert.deepEqual([during.queued, during.running, during.running_expired], [0, 1, 0], 'while the job reads upstream its run is running under a live lease');
    assert.deepEqual(overview.modules.find((m) => m.id === 'sources').import_runs, during, 'the Overview shows the same counts, read from the real store');
    assert.deepEqual(overview.import_run_counts, { status: 'available', reason: null });
    assert.deepEqual(seen.upstream, [SUBMISSIONS_URL, FACTS_URL]);
    assert.deepEqual([result.outcome, result.status, result.reason, result.run_id, result.policy_revision, result.attempt, result.reclaimed], ['completed', 'completed', null, first, 1, 0, false]);
    assert.deepEqual([result.records, result.applied, result.duplicates, result.reviewed], [SEC_RECORDS, SEC_RECORDS, 0, 0]);
    const data = await w.data();
    assert.deepEqual([data.eup_record_snapshots, data.eup_company_entities, data.eup_company_identifiers, data.eup_company_locations, data.eup_company_facts], [SEC_RECORDS, 1, 2, LOCATIONS, FACTS]);
    const settled = await w.run(first);
    assert.deepEqual([settled.status, settled.error, settled.attempt, settled.lease_expires_at, settled.policy_revision], ['completed', null, 1, null, 1]);
    const state = await w.source('sec_edgar');
    assert.ok(state.last_success_at); assert.deepEqual([state.last_error, state.records], [null, SEC_RECORDS]);
    assert.deepEqual(await w.counts(), { queued: 0, running: 0, running_expired: 0, lease_expires_at: null });
    /* a second run over unchanged documents */
    const second = await w.queue('sec_edgar', SEC_CURSOR);
    const again = await w.job();
    assert.deepEqual([again.result.outcome, again.result.run_id, again.result.records, again.result.applied, again.result.duplicates], ['completed', second, SEC_RECORDS, 0, SEC_RECORDS]);
    assert.deepEqual(await w.data(), data, 'no table gained a row');
    assert.deepEqual((await w.job()).result, { outcome: 'idle', claimed: false, policy_revision: 1 }, 'nothing left to claim');
    assert.equal(await w.h.count('civic_jurisdictions') + await w.h.count('action_policy_bills'), 0, 'no public projection was written');
  } finally { await w.close(); }
});

real('no upstream request when the claim is refused: draining, disabled, not installed', async () => {
  const w = await world();
  try {
    const id = await w.queue('sec_edgar', SEC_CURSOR);
    const refused = async (reason, label) => {
      const { result, seen } = await w.job({ upstream: () => { throw new Error('the upstream must not be called'); } });
      assert.deepEqual(result, { outcome: 'refused', claimed: false, reason }, label);
      assert.deepEqual(seen, { upstream: [], rpc: ['eup_import_run_claim'] }, `${label}: the claim is the only call`);
      const run = await w.run(id);
      assert.deepEqual([run.status, run.lease_token, run.attempt, run.error], ['queued', null, 0, null], `${label}: the run is untouched`);
      assert.equal(await w.written(), 0, label);
    };
    await w.drain(); await refused('module_draining', 'draining');
    await w.disable(); await refused('module_disabled', 'disabled');
    await w.enable();
    const { result } = await w.job();
    assert.deepEqual([result.outcome, result.run_id, result.policy_revision], ['completed', id, 4], 're-enabled: the same queued run is claimed under the new revision and completes');
  } finally { await w.close(); }
  const bare = await world({ enable: false });
  try {
    const { result, seen } = await bare.job({ upstream: () => { throw new Error('the upstream must not be called'); } });
    assert.deepEqual(result, { outcome: 'refused', claimed: false, reason: 'module_not_installed' });
    assert.deepEqual(seen.upstream, []);
    await bare.install();
    assert.deepEqual((await bare.job()).result, { outcome: 'refused', claimed: false, reason: 'module_disabled' }, 'installed and not yet enabled');
  } finally { await bare.close(); }
});

real('no upstream request when the check before it sees the module draining; the run is released and kept', async () => {
  const w = await world();
  try {
    const id = await w.queue('sec_edgar', SEC_CURSOR);
    const { result, seen } = await w.job({ after: { eup_import_run_claim: () => w.drain() }, upstream: () => { throw new Error('the upstream must not be called'); } });
    assert.deepEqual(seen.upstream, [], 'no upstream request');
    assert.deepEqual(seen.rpc, ['eup_import_run_claim', 'eup_sources_read', 'eup_module_policy_read', 'eup_import_run_release']);
    assert.deepEqual([result.outcome, result.released, result.reason, result.run_id, result.policy_revision], ['released', true, 'module_draining', id, 1]);
    const run = await w.run(id);
    assert.deepEqual([run.status, run.error, run.lease_token, run.lease_expires_at, run.policy_revision, run.attempt], ['queued', 'module_draining', null, null, null, 0], 'released while draining: queued, kept, no lease');
    assert.deepEqual(await w.counts(), { queued: 1, running: 0, running_expired: 0, lease_expires_at: null }, 'the drain has settled: nothing is running');
    assert.equal(await w.written(), 0);
    /* disabled between the claim and the check: the same, with its own reason */
    await w.enable();
    const { result: second, seen: secondSeen } = await w.job({ after: { eup_import_run_claim: () => w.disable() }, upstream: () => { throw new Error('the upstream must not be called'); } });
    assert.deepEqual([second.outcome, second.reason, secondSeen.upstream], ['released', 'module_disabled', []]);
    assert.equal((await w.run(id)).status, 'queued');
  } finally { await w.close(); }
});

real('a drain that lands between the fetch and the write: zero snapshot rows and a released run', async () => {
  const w = await world();
  try {
    const id = await w.queue('sec_edgar', SEC_CURSOR);
    let fetched = 0;
    const { result, seen } = await w.job({ upstream: async (url) => { fetched += 1; if (fetched === 2) await w.drain(); return secUpstream(url); } });
    assert.deepEqual(seen.upstream, [SUBMISSIONS_URL, FACTS_URL], 'both documents were fetched while the module was enabled');
    assert.deepEqual(seen.rpc.slice(-2), ['eup_intake_apply', 'eup_import_run_release'], 'one refused write, then the release');
    assert.deepEqual([result.outcome, result.released, result.reason, result.records, result.applied], ['released', true, 'module_draining', 0, 0]);
    assert.equal(await w.h.count('eup_record_snapshots'), 0, 'zero snapshot rows');
    assert.equal(await w.written(), 0, 'and no row in any intake data table');
    const run = await w.run(id);
    assert.deepEqual([run.status, run.error, run.lease_token, run.attempt], ['queued', 'module_draining', null, 0]);
    assert.deepEqual(await w.counts(), { queued: 1, running: 0, running_expired: 0, lease_expires_at: null });
    assert.equal((await w.source('sec_edgar')).last_error, null, 'a released run is not a source failure');
    /* draining: the queued run cannot be claimed, and the owner can finish the drain */
    assert.deepEqual((await w.job()).result, { outcome: 'refused', claimed: false, reason: 'module_draining' });
    await w.disable();
    assert.equal((await w.run(id)).status, 'queued', 'disabling kept the run');
  } finally { await w.close(); }
});

real('a drain that lands part of the way through the writes: what committed stays, the rest is refused, the run is released', async () => {
  const w = await world();
  try {
    const id = await w.queue('sec_edgar', SEC_CURSOR);
    /* the hook runs once, after the FIRST apply committed, so the drain lands between two writes of the same job */
    const { result } = await w.job({ after: { eup_intake_apply: () => w.drain() } });
    assert.deepEqual([result.outcome, result.reason, result.records, result.applied], ['released', 'module_draining', 1, 1]);
    assert.deepEqual([await w.h.count('eup_company_entities'), await w.h.count('eup_company_locations'), await w.h.count('eup_company_facts'), await w.h.count('eup_record_snapshots')], [1, 0, 0, 1]);
    assert.equal((await w.run(id)).status, 'queued');
    await w.enable();
    const { result: rerun } = await w.job();
    assert.deepEqual([rerun.outcome, rerun.run_id, rerun.records, rerun.applied, rerun.duplicates], ['completed', id, SEC_RECORDS, SEC_RECORDS - 1, 1], 'run again from the start: the earlier record is a duplicate, not a second copy');
    assert.equal(await w.h.count('eup_company_entities'), 1);
  } finally { await w.close(); }
});

real('drained and re-enabled under the job: its write is refused module_policy_changed, and the run is claimed again under the new revision', async () => {
  const w = await world();
  try {
    const id = await w.queue('sec_edgar', SEC_CURSOR);
    let fetched = 0;
    const { result, seen } = await w.job({ upstream: async (url) => { fetched += 1; if (fetched === 2) { await w.drain(); await w.enable(); } return secUpstream(url); } });
    assert.equal(await w.revision(), 3, 'enabled again, two revisions later');
    assert.deepEqual(seen.rpc.slice(-2), ['eup_intake_apply', 'eup_import_run_release']);
    assert.deepEqual([result.outcome, result.released, result.reason, result.policy_revision, result.applied], ['released', true, 'module_policy_changed', 1, 0]);
    assert.equal(await w.written(), 0, 'work started under the old policy never landed');
    const released = await w.run(id);
    assert.deepEqual([released.status, released.error, released.policy_revision], ['queued', 'module_policy_changed', null]);
    const { result: rerun } = await w.job();
    assert.deepEqual([rerun.outcome, rerun.run_id, rerun.policy_revision, rerun.applied], ['completed', id, 3, SEC_RECORDS]);
    assert.deepEqual([(await w.run(id)).status, await w.h.count('eup_record_snapshots')], ['completed', SEC_RECORDS]);
    /* the same change seen by the check before a request instead: nothing is fetched */
    const next = await w.queue('sec_edgar', SEC_CURSOR);
    const early = await w.job({ after: { eup_import_run_claim: async () => { await w.drain(); await w.enable(); } }, upstream: () => { throw new Error('the upstream must not be called'); } });
    assert.deepEqual([early.result.outcome, early.result.reason, early.seen.upstream, (await w.run(next)).status], ['released', 'module_policy_changed', [], 'queued']);
  } finally { await w.close(); }
});

real('a lost lease cannot finish: the run stays with the claim that took it over', async () => {
  const w = await world();
  try {
    const id = await w.queue('sec_edgar', SEC_CURSOR);
    let other = null;
    const { result, seen } = await w.job({
      upstream: async (url) => {
        if (!other) {
          /* the holder is too slow: its lease runs out and another claim takes the run over */
          await w.db.query("update public.eup_import_runs set lease_expires_at = now() - interval '1 second' where id = $1", [id]);
          assert.deepEqual(await w.counts().then((c) => [c.running, c.running_expired]), [1, 1], 'an expired lease is counted as no live holder');
          other = await w.h.rpc('eup_import_run_claim', { p_worker: 'fixture-other', p_source_id: 'sec_edgar' });
          assert.deepEqual([other.claimed, other.run_id, other.reclaimed, other.attempt], [true, id, true, 1]);
        }
        return secUpstream(url);
      }
    });
    assert.equal(seen.rpc.at(-1), 'eup_import_run_finish');
    assert.deepEqual([result.outcome, result.finished, result.intended, result.reason, result.settle_reason], ['unsettled', false, 'completed', null, 'lease_lost']);
    const held = await w.run(id);
    assert.deepEqual([held.status, held.lease_token, held.finished_at, held.attempt], ['running', other.lease, null, 1], 'still running under the other lease, not finished');
    assert.equal((await w.source('sec_edgar')).last_success_at, null, 'the source was not marked successful by the lost lease');
    /* the limit the handler documents: the store does not check the lease on a write, so the slow holder's records landed */
    assert.equal(result.applied, SEC_RECORDS); assert.equal(await w.h.count('eup_record_snapshots'), SEC_RECORDS);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(other.lease.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    /* the claim that holds the run settles it */
    assert.deepEqual(await w.h.rpc('eup_import_run_finish', { p_run_id: id, p_status: 'completed', p_records: SEC_RECORDS, p_error: null, p_cursor: null, p_lease: other.lease }), { run_id: id, status: 'completed', attempt: 2, replayed: false });
    /* a release by a lost lease is refused the same way */
    const next = await w.queue('sec_edgar', SEC_CURSOR);
    const drained = await w.job({
      after: { eup_import_run_claim: async () => {
        await w.db.query("update public.eup_import_runs set lease_expires_at = now() - interval '1 second' where id = $1", [next]);
        await w.h.rpc('eup_import_run_claim', { p_worker: 'fixture-other', p_source_id: 'sec_edgar' });
        await w.drain();
      } }
    });
    assert.deepEqual([drained.result.outcome, drained.result.released, drained.result.reason, drained.result.settle_reason, drained.seen.upstream], ['unsettled', false, 'module_draining', 'lease_lost', []]);
    assert.equal((await w.run(next)).status, 'running', 'the run stays with the claim that holds it');
  } finally { await w.close(); }
});

real('a connector that is disabled or not access-approved is never claimed and never fetched', async () => {
  const w = await world();
  try {
    const id = await w.queue('sec_edgar', SEC_CURSOR);
    const never = { upstream: () => { throw new Error('the upstream must not be called'); } };
    const states = [
      ['not configured', "configured = false"], ['access not reviewed', "access = 'not_reviewed'"], ['access held', "access = 'held'"],
      ['paused', 'paused = true'], ['rights expired', "rights_expires_at = now() - interval '1 day'"]
    ];
    for (const [label, change] of states) {
      await w.ready('sec_edgar', `update public.eup_source_registry_state set ${change} where source_id = 'sec_edgar';`);
      const { result, seen } = await w.job(never);
      assert.deepEqual(result, { outcome: 'idle', claimed: false, policy_revision: 1 }, label);
      assert.deepEqual(seen, { upstream: [], rpc: ['eup_import_run_claim'] }, label);
      assert.equal((await w.run(id)).status, 'queued', label);
    }
    /* claimable in the store, refused by the Worker's own gate: a credential binding that is absent */
    await w.ready('sec_edgar');
    const unbound = await w.job({ ...never, env: { ...w.h.env, SEC_USER_AGENT: '' } });
    assert.deepEqual([unbound.result.outcome, unbound.result.reason, unbound.seen.upstream], ['failed', 'not_configured', []]);
    assert.deepEqual(unbound.seen.rpc, ['eup_import_run_claim', 'eup_sources_read', 'eup_import_run_finish'], 'no policy read and no write either');
    const failed = await w.run(id);
    assert.deepEqual([failed.status, failed.error, failed.attempt], ['failed', 'not_configured', 1]);
    assert.equal((await w.source('sec_edgar')).last_error, 'not_configured');
    /* a source the registry holds pending rights review, recorded approved and configured in the store anyway */
    await w.ready('openfec');
    const heldRun = await w.queue('openfec', {});
    const held = await w.job({ ...never, source_id: 'openfec', env: { ...w.h.env, OPENFEC_API_KEY: 'fixture-openfec-key' } });
    assert.deepEqual([held.result.outcome, held.result.reason, held.seen.upstream, (await w.run(heldRun)).error], ['failed', 'rights_held', [], 'rights_held']);
    /* a source paused after its run was claimed gives the run back */
    await w.ready('gleif');
    const paused = await w.queue('gleif', { lei: 'SYNTH00000000000GRID' });
    const stopped = await w.job({ ...never, source_id: 'gleif', after: { eup_import_run_claim: () => w.h.rpc('eup_sources_command', { p_action: 'pause', p_params: { source_id: 'gleif' }, p_actor: w.OWNER }) } });
    assert.deepEqual([stopped.result.outcome, stopped.result.reason, stopped.seen.upstream], ['released', 'source_paused', []]);
    assert.deepEqual([(await w.run(paused)).status, (await w.run(paused)).error], ['queued', 'source_paused']);
    assert.deepEqual((await w.job({ ...never, source_id: 'gleif' })).result, { outcome: 'idle', claimed: false, policy_revision: 1 }, 'a paused source is not claimed again: no loop');
    assert.equal(await w.written(), 0);
  } finally { await w.close(); }
});

real('nothing is fetched outside the allow-list, and the stored failure carries no URL', async () => {
  const w = await world();
  try {
    const never = { upstream: () => { throw new Error('the upstream must not be called'); } };
    const TOKEN = 'query-secret-0002';
    const plans = (url, hosts = ['data.sec.gov']) => ({ sec_edgar: { hosts, requests: () => [{ id: 'ok', url: SUBMISSIONS_URL }, { id: 'bad', url }], parse: () => [] } });
    for (const [url, hosts] of [[`https://evil.example/x?token=${TOKEN}`], [`https://evilsec.gov/x?token=${TOKEN}`], [`https://www.sec.gov/x?token=${TOKEN}`], [`https://evil.example/x?token=${TOKEN}`, ['data.sec.gov', 'evil.example']]]) {
      const id = await w.queue('sec_edgar', SEC_CURSOR);
      const { result, seen } = await w.job({ ...never, plans: plans(url, hosts) });
      const run = await w.run(id);
      assert.deepEqual(seen.upstream, [], `${url}: not even the good request is sent`);
      assert.deepEqual([result.outcome, result.reason, run.status, run.error], ['failed', 'invalid_upstream', 'failed', 'invalid_upstream'], url);
      assert.doesNotMatch(JSON.stringify([result, run, await w.source('sec_edgar')]), new RegExp(`${TOKEN}|evil|token=`), url);
    }
    assert.equal(await w.written(), 0);
  } finally { await w.close(); }
});
