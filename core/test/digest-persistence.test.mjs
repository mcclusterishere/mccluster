import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { digestWindowId } from '../src/digest.mjs';

// Audit finding C7: a failed daily report write still exited 0, so the systemd
// timer looked successful with no canonical report. Loopback-free synthetic fetch.
const ORG = '123e4567-e89b-42d3-a456-426614174000';
const DIGEST = new URL('../src/digest.mjs', import.meta.url).pathname;

async function run(mockSource, env = {}) {
  const dir = await mkdtemp('/tmp/mccluster-digest-test-');
  const preload = `${dir}/mock.mjs`;
  await writeFile(preload, mockSource);
  try {
    return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, DIGEST], {
      env: { ...process.env, SUPABASE_URL: 'https://digest.test', SUPABASE_SECRET_KEY: 'sb_secret_test', MCCLUSTER_ORG_ID: ORG, MCCLUSTER_SMS_NOTIFY: '0', ...env },
      encoding: 'utf8', timeout: 15000,
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('a report that cannot be persisted is a failed run, not a successful timer exit', async () => {
  const result = await run(`globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/rest/v1/ops_signals') && (init.method || 'GET') === 'POST') throw new Error('synthetic digest persistence failure');
    return Response.json([]);
  };\n`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /core_digest_record_failed/);
  assert.match(result.stderr, /core_digest_failed/);
});

test('a persisted report exits successfully and carries a stable window identity even when SMS is off', async () => {
  const result = await run(`const posts = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/rest/v1/ops_signals') && (init.method || 'GET') === 'POST') { posts.push(JSON.parse(init.body)); return Response.json([{ id: 'sig-1', ...posts[0] }]); }
    return Response.json([]);
  };
  process.on('exit', () => { process.stderr.write('POSTS=' + JSON.stringify(posts) + '\\n'); });\n`);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim());
  assert.equal(out.recorded, true);
  assert.match(out.window_id, /^core_morning_digest:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\/\d+h$/);
  const posts = JSON.parse(result.stderr.match(/POSTS=(.*)/)[1]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.window_id, out.window_id);
  assert.equal(out.sms.sent, false);
});

test('a repeated run for the same window reuses the existing report instead of inserting a duplicate', async () => {
  const result = await run(`let posts = 0;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/rest/v1/ops_signals') && (init.method || 'GET') === 'GET') return Response.json([{ id: 'sig-existing', payload: { window_id: new URL(href).searchParams.get('payload->>window_id').slice(3), sms_sent: true } }]);
    if (href.includes('/rest/v1/ops_signals') && (init.method || 'GET') === 'POST') { posts += 1; }
    return Response.json([]);
  };
  process.on('exit', () => { process.stderr.write('POSTS=' + posts + '\\n'); });\n`);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim());
  assert.equal(out.recorded, true);
  assert.equal(out.duplicate_window, true);
  assert.equal(out.sms.reason, 'already_delivered');
  assert.match(result.stderr, /POSTS=0/);
});

// Follow-up: one report per window under concurrency. With the unique index on (org, window) a run that loses
// the insert race gets 23505; it then reads the report the other run recorded and leaves the text to that run.
const RACE = (row) => `let gets = 0, posts = 0;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/rest/v1/ops_signals') && (init.method || 'GET') === 'GET') {
      gets += 1;
      if (gets === 1) return Response.json([]);
      const row = ${row};
      return Response.json(row ? [{ ...row, payload: { ...row.payload, window_id: new URL(href).searchParams.get('payload->>window_id') } }] : []);
    }
    if (href.includes('/rest/v1/ops_signals') && (init.method || 'GET') === 'POST') { posts += 1; return Response.json({ code: '23505', message: 'duplicate key value violates unique constraint "ops_signals_core_digest_window_key"' }, { status: 409 }); }
    return Response.json([]);
  };
  process.on('exit', () => { process.stderr.write('GETS=' + gets + ' POSTS=' + posts + '\\n'); });\n`;

test('a run that loses the insert race reads the other run\'s report and leaves the text to it', async () => {
  const result = await run(RACE(`{ id: 'sig-other', payload: { sms_sent: false }, created_at: new Date(Date.now() - 5000).toISOString() }`), { MCCLUSTER_SMS_NOTIFY: '1' });
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim());
  assert.equal(out.recorded, true);
  assert.equal(out.duplicate_window, true);
  assert.equal(out.signal_id, 'sig-other');
  assert.deepEqual(out.sms, { sent: false, reason: 'delivery_in_progress' });
  assert.match(result.stderr, /GETS=2 POSTS=1/);
});

test('an undelivered report recorded long ago is sent again by a later run', async () => {
  const result = await run(`globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/rest/v1/ops_signals') && (init.method || 'GET') === 'GET') return Response.json([{ id: 'sig-old', payload: { window_id: new URL(href).searchParams.get('payload->>window_id'), sms_sent: false }, created_at: new Date(Date.now() - 3600000).toISOString() }]);
    return Response.json([]);
  };\n`);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim());
  assert.equal(out.duplicate_window, true);
  assert.notEqual(out.sms.reason, 'delivery_in_progress', 'past the grace period the delivery is retried');
  assert.notEqual(out.sms.reason, 'already_delivered');
});

test('a conflict with no report behind it is still a failed run', async () => {
  const result = await run(RACE('null'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /core_digest_record_failed/);
});

// Close-out (2026-11-10): the row's other claims had no test that failed without them.

// "SMS failure optional": a text that cannot be sent after the report is saved never fails the run.
const SMS_FAILURE = (failure) => `let posts = 0, twilio = 0, patches = 0;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const method = init.method || 'GET';
    if (href.startsWith('https://api.twilio.com/')) { twilio += 1; ${failure} }
    if (href.includes('/rest/v1/ops_signals') && method === 'POST') { posts += 1; return Response.json([{ id: 'sig-1', ...JSON.parse(init.body) }]); }
    if (href.includes('/rest/v1/ops_signals') && method === 'PATCH') { patches += 1; return new Response(null, { status: 204 }); }
    return Response.json([]);
  };
  process.on('exit', () => { process.stderr.write('COUNTS=' + JSON.stringify({ posts, twilio, patches }) + '\\n'); });\n`;
const TWILIO_FALLBACK_ENV = {
  MCCLUSTER_SMS_NOTIFY: '1', MCCLUSTER_SMS_REQUIRE_RELAY: '', MCCLUSTER_OWNER_PHONE: '', MCCLUSTER_PHONE: '+15555550123',
  TWILIO_ACCOUNT_SID: 'AC_digest_test', TWILIO_AUTH_TOKEN: 'digest-test-token', TWILIO_API_KEY: '', TWILIO_API_SECRET: '', TWILIO_FROM: '+15555550199',
};

test('a text that fails after the report is saved leaves a successful run with the report recorded', async () => {
  for (const [name, failure] of [
    ['Twilio answers 500', `return Response.json({ message: 'synthetic Twilio outage' }, { status: 500 });`],
    ['the Twilio request rejects', `throw new TypeError('synthetic network failure');`],
  ]) {
    const result = await run(SMS_FAILURE(failure), TWILIO_FALLBACK_ENV);
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.recorded, true, name);
    assert.equal(out.sms.sent, false, name);
    assert.equal(out.sms.reason, 'delivery_error', name);
    assert.match(out.sms.error, /synthetic/, name);
    assert.deepEqual(JSON.parse(result.stderr.match(/COUNTS=(.*)/)[1]), { posts: 1, twilio: 1, patches: 0 }, `${name}: one report, one attempt, never marked delivered`);
  }
});

// "stable window_id": every run inside one window carries the same id, which is what reuse and the unique index key on.
test('the window id is the start of the UTC-aligned window, the same for every run inside it', () => {
  const id = (iso, hours) => digestWindowId(new Date(iso), hours);
  assert.equal(id('2026-11-10T12:00:00.000Z', 12), 'core_morning_digest:2026-11-10T12:00:00.000Z/12h');
  assert.equal(id('2026-11-10T12:30:05.123Z', 12), 'core_morning_digest:2026-11-10T12:00:00.000Z/12h');
  assert.equal(id('2026-11-10T23:59:59.999Z', 12), 'core_morning_digest:2026-11-10T12:00:00.000Z/12h');
  assert.equal(id('2026-11-11T00:00:00.000Z', 12), 'core_morning_digest:2026-11-11T00:00:00.000Z/12h');
  assert.equal(id('2026-11-10T07:00:00.000Z', 6), 'core_morning_digest:2026-11-10T06:00:00.000Z/6h');
  assert.equal(id('2026-11-10T05:59:59.999Z', 6), 'core_morning_digest:2026-11-10T00:00:00.000Z/6h');
});

// A store shared by sequential runs, with each run's clock fixed, that answers a lookup only with rows of the queried window.
const STATEFUL = `import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const store = process.env.DIGEST_TEST_STORE;
const fixed = Date.parse(process.env.DIGEST_TEST_NOW);
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixed])); }
  static now() { return fixed; }
};
const rows = () => (existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : []);
globalThis.fetch = async (url, init = {}) => {
  const href = new URL(String(url));
  const method = init.method || 'GET';
  if (href.pathname === '/rest/v1/ops_signals' && method === 'GET') {
    const windowId = String(href.searchParams.get('payload->>window_id')).replace(/^eq\\./, '');
    const orgId = String(href.searchParams.get('org_id')).replace(/^eq\\./, '');
    return Response.json(rows().filter((row) => row.payload.window_id === windowId && row.org_id === orgId).slice(0, 1));
  }
  if (href.pathname === '/rest/v1/ops_signals' && method === 'POST') {
    const all = rows();
    const row = { id: 'sig-' + (all.length + 1), ...JSON.parse(init.body), created_at: new Date().toISOString() };
    writeFileSync(store, JSON.stringify([...all, row]));
    return Response.json([row]);
  }
  return Response.json([]);
};\n`;

test('runs inside one window record one report; the next window records its own', async (t) => {
  const dir = await mkdtemp('/tmp/mccluster-digest-store-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = `${dir}/ops_signals.json`;
  const at = async (now) => {
    const result = await run(STATEFUL, { DIGEST_TEST_STORE: store, DIGEST_TEST_NOW: now, MCCLUSTER_DIGEST_HOURS: '12' });
    assert.equal(result.status, 0, `${now}: ${result.stderr}`);
    return JSON.parse(result.stdout.trim());
  };
  const first = await at('2026-11-10T12:30:05.123Z');
  const later = await at('2026-11-10T23:59:59.999Z');
  assert.deepEqual([first.duplicate_window, later.duplicate_window, later.signal_id], [false, true, first.signal_id]);
  assert.equal(later.window_id, first.window_id);
  const next = await at('2026-11-11T00:00:00.000Z');
  assert.equal(next.duplicate_window, false);
  const rows = JSON.parse(await readFile(store, 'utf8'));
  assert.deepEqual(rows.map((row) => row.payload.window_id), [
    'core_morning_digest:2026-11-10T12:00:00.000Z/12h',
    'core_morning_digest:2026-11-11T00:00:00.000Z/12h',
  ]);
});

// Fail closed: with no organization to record under, the run is a failure, never a silent success.
test('with no MCCLUSTER_ORG_ID and no house org row the run fails without recording or texting', async () => {
  const result = await run(`let orgLookups = 0, posts = 0;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/rest/v1/orgs?')) { orgLookups += 1; return Response.json([]); }
    if ((init.method || 'GET') === 'POST') posts += 1;
    return Response.json([]);
  };
  process.on('exit', () => { process.stderr.write('ORG_LOOKUPS=' + orgLookups + ' POSTS=' + posts + '\\n'); });\n`, { MCCLUSTER_ORG_ID: '', MCCLUSTER_ORG_SLUG: '', MCCLUSTER_SMS_NOTIFY: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /house org id unavailable/);
  assert.match(result.stderr, /ORG_LOOKUPS=1 POSTS=0/);
  assert.equal(result.stdout.trim(), '', 'no digest result is reported');
});

// Audit finding C7b: houseOrgId() read the rest() envelope as the row array and always resolved null, so with
// MCCLUSTER_ORG_ID unset no report was ever recorded. Every test above sets MCCLUSTER_ORG_ID; this one does not.
test('C7b: with no MCCLUSTER_ORG_ID the digest resolves the house org by slug and records the report under it', async () => {
  const result = await run(`const slugs = [], reportLookups = [], posts = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = new URL(String(url));
    const method = init.method || 'GET';
    if (href.pathname === '/rest/v1/orgs') { slugs.push(href.searchParams.get('slug')); return Response.json([{ id: '${ORG}' }]); }
    if (href.pathname === '/rest/v1/ops_signals' && method === 'GET') { reportLookups.push(href.searchParams.get('org_id')); return Response.json([]); }
    if (href.pathname === '/rest/v1/ops_signals' && method === 'POST') { posts.push(JSON.parse(init.body)); return Response.json([{ id: 'sig-house', ...posts[0] }]); }
    return Response.json([]);
  };
  process.on('exit', () => { process.stderr.write('SEEN=' + JSON.stringify({ slugs, reportLookups, posts }) + '\\n'); });\n`, { MCCLUSTER_ORG_ID: '', MCCLUSTER_ORG_SLUG: '' });
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim());
  assert.deepEqual([out.recorded, out.org_id, out.signal_id], [true, ORG, 'sig-house']);
  const seen = JSON.parse(result.stderr.match(/SEEN=(.*)/)[1]);
  assert.deepEqual(seen.slugs, ['eq.mccluster']);
  assert.deepEqual(seen.reportLookups, [`eq.${ORG}`]);
  assert.equal(seen.posts.length, 1);
  assert.equal(seen.posts[0].org_id, ORG);
});
