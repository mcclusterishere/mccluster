import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { JOB_TYPE, TARGET_ID, observeOpportunities, parseAnnouncement, robotsAllows, SOURCES } from '../src/student-opportunities.mjs';
import { studentOpportunitySnapshot } from '../src/executors/student-opportunity-snapshot.mjs';
import { dailyJobId, seedStudentOpportunitySnapshot } from '../src/seed-student-opportunity-snapshot.mjs';
import { assertCompletionEvidence } from '../src/completion-evidence.mjs';
import { notifyJobFailure, notifyJobSuccess } from '../src/notifier.mjs';

const now = new Date('2026-11-27T18:00:00Z');
const day = '2027-01-06';
const fixtures = (id, deadline = 'January 6, 2027', term = 'Summer 2027') =>
  `<p>Example (${id.toUpperCase()}) Program is now open for for applications for the <strong>${term}</strong> Term. Applications are due ${deadline} at 5:00pm ET.</p><p>${id.toUpperCase()} is a paid internship opportunity</p>`;
const origin = 'https://science.osti.gov';
const robots = 'User-agent: *\nDisallow: /query/\nAllow: /';
const mock = (uri, init) => {
  assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'manual');
  if (uri === origin + '/robots.txt') return new Response(robots, { headers: { 'content-type': 'text/plain' } });
  const source = SOURCES.find(({ path }) => uri === origin + path);
  assert.ok(source, uri);
  return new Response(fixtures(source.id), { headers: { 'content-type': 'text/html' } });
};

test('discovers both paid programs and distinguishes unchanged from a deadline correction', async () => {
  const first = await observeOpportunities({ fetchImpl: mock, now });
  assert.equal(first.state, 'observed');
  assert.deepEqual(first.opportunities.map(({ id, deadline_at, change }) => [id, deadline_at, change]), [
    ['suli:summer-2027', day + 'T22:00:00.000Z', 'new'], ['cci:summer-2027', day + 'T22:00:00.000Z', 'new'],
  ]);
  const second = await observeOpportunities({ fetchImpl: mock, now, prior: first.known });
  assert.ok(second.opportunities.every(({ change }) => change === 'unchanged'));
  const fetchImpl = (uri, init) => uri === origin + '/wdts/suli' ? new Response(fixtures('suli', 'January 8, 2027'), { headers: { 'content-type': 'text/html' } }) : mock(uri, init);
  const third = await observeOpportunities({ fetchImpl, now, prior: second.known });
  assert.equal(third.opportunities[0].change, 'updated');
  assert.equal(third.opportunities[1].change, 'unchanged');
  assert.equal(parseAnnouncement(SOURCES[0], fixtures('suli', 'March 31, 2027'), now)[0].deadline_at, '2027-03-31T21:00:00.000Z');
  assert.deepEqual(parseAnnouncement(SOURCES[0], fixtures('suli'), new Date('2027-01-07T00:00Z')), []);
});

test('unrecognized robots, prohibited paths, over-cap bodies, redirects and ambiguous announcements fail closed', async () => {
  assert.ok(robotsAllows(robots, '/wdts/suli'));
  assert.ok(!robotsAllows(robots, '/query/'));
  assert.ok(!robotsAllows('User-agent: *\nAllow: /\nCrawl-delay: 5', '/wdts/suli'));
  const calls = [];
  const rejected = await observeOpportunities({ now, fetchImpl: (url) => { calls.push(url); return new Response('User-agent: *\nDisallow: /wdts/', { headers: { 'content-type': 'text/plain' } }); } });
  assert.deepEqual(calls, [origin + '/robots.txt']);
  assert.equal(rejected.state, 'unavailable');
  assert.ok(rejected.observations.every(({ reason }) => reason === 'robots_not_cleared'));
  const overflow = await observeOpportunities({ now, fetchImpl: (uri, init) => uri === origin + '/wdts/suli'
    ? new Response('x'.repeat(512_001), { headers: { 'content-type': 'text/html' } }) : mock(uri, init) });
  assert.equal(overflow.state, 'partial'); assert.equal(overflow.observations[0].reason, 'source_size');
  const moved = await observeOpportunities({ now, prior: overflow.known, fetchImpl: (uri, init) => uri === origin + '/wdts/cci'
    ? new Response(null, { status: 302, headers: { location: 'https://unapproved.example/' } }) : mock(uri, init) });
  assert.equal(moved.state, 'partial'); assert.equal(moved.observations[1].reason, 'source_http');
  assert.equal(moved.known['cci:summer-2027'], overflow.known['cci:summer-2027']);
  assert.throws(() => parseAnnouncement(SOURCES[0], fixtures('suli', 'February 31, 2027'), now), /deadline_unconfirmed/);
});

test('seed is disabled by default, idempotent per UTC day and fenced to the house', async () => {
  const denied = () => assert.fail('disabled jobs must not call the backend');
  assert.deepEqual(await seedStudentOpportunitySnapshot({ env: {}, house: denied, pending: denied, queue: denied }), { state: 'disabled' });
  const env = { MCCLUSTER_STUDENT_OPPORTUNITY_DISCOVERY: 'true' };
  const orgId = '10000000-0000-4000-8000-000000000001';
  let jobs = [];
  const deps = { env, now, house: () => orgId, pending: () => false, queue: (job) => { jobs.push(job); return { id: job.jobId }; } };
  const first = await seedStudentOpportunitySnapshot(deps);
  assert.equal((await seedStudentOpportunitySnapshot(deps)).job_id, first.job_id);
  assert.notEqual(first.job_id, dailyJobId(orgId, '2026-11-28'));
  assert.match(first.job_id, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.ok(jobs.every((job) => job.input.notify_owner === undefined && job.maxAttempts === 1));
  assert.equal((await seedStudentOpportunitySnapshot({ ...deps, pending: () => true })).state, 'already_pending');
  const job = { org_id: orgId, job_type: JOB_TYPE, target_id: TARGET_ID, target_type: 'public_opportunity_feed' };
  const injected = { env, fetchImpl: denied, house: () => 'other-org', query: denied };
  await assert.rejects(studentOpportunitySnapshot(job, {}, injected), /outside_house/);
  await assert.rejects(studentOpportunitySnapshot({ ...job, target_id: 'https://example.invalid' }, {}, injected), /target_invalid/);
  assert.deepEqual(await notifyJobSuccess({ ...job, input: { notify_owner: true } }), { sent: false, reason: 'discovery_receipt_only' });
  assert.deepEqual(await notifyJobFailure(job, new Error('fixture')), { sent: false, reason: 'discovery_receipt_only' });
});

test('the actual Core Runner leases and shares a verified opportunity receipt through its existing job boundary', async () => {
  const org = '10000000-0000-4000-8000-000000000001';
  const job = { id: dailyJobId(org, '2026-11-27'), org_id: org, job_type: JOB_TYPE, target_id: TARGET_ID, target_type: 'public_opportunity_feed', status: 'queued', attempts: 0, input: {} };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const chunks = [];
    for await (const bytes of req) chunks.push(bytes);
    const send = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    if (u.pathname === '/rest/v1/orgs') return send([{ id: org, enabled: true }]);
    if (u.pathname !== '/rest/v1/ops_agent_jobs') { res.statusCode = 404; return send({ message: 'not allowed' }); }
    if (req.method === 'GET') return send(u.searchParams.has('run_after') && job.status === 'queued' ? [job] : []);
    if (req.method === 'PATCH') {
      const patch = JSON.parse(Buffer.concat(chunks).toString());
      if (u.searchParams.get('id') !== `eq.${job.id}` || u.searchParams.get('status') !== `eq.${job.status}` ||
        (job.status === 'running' && u.searchParams.get('locked_by') !== `eq.${job.locked_by}`)) return send([]);
      Object.assign(job, patch); return send([job]);
    }
    res.statusCode = 405; return send({ message: 'not allowed' });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const due = new Date(Date.now() + 20 * 86400_000);
  const formatted = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(due);
  const preload = `const native=globalThis.fetch;const replies=${JSON.stringify(Object.fromEntries(SOURCES.map(s => [origin + s.path, fixtures(s.id, formatted, 'Summer ' + due.getUTCFullYear())])))};` +
    `globalThis.fetch=(url,opts)=>String(url).startsWith('${base}/')?native(url,opts):String(url)==='${origin}/robots.txt'?Promise.resolve(new Response(${JSON.stringify(robots)},{headers:{'content-type':'text/plain'}})):Object.hasOwn(replies,url)?Promise.resolve(new Response(replies[url],{headers:{'content-type':'text/html'}})):Promise.reject(new Error('network disabled'));`;
  const runner = fileURLToPath(new URL('../src/runner.mjs', import.meta.url));
  const p = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, runner, '--once'], {
    env: { ...process.env, NODE_USE_ENV_PROXY: '0', MCCLUSTER_STUDENT_OPPORTUNITY_DISCOVERY: 'true', SUPABASE_URL: base, SUPABASE_SECRET_KEY: 'fixture-only' },
  });
  let logs = ''; p.stdout.on('data', data => { logs += data; }); p.stderr.on('data', data => { logs += data; });
  const timeout = setTimeout(() => p.kill(), 10_000);
  try {
    const [code] = await once(p, 'exit');
    assert.equal(code, 0, logs); assert.equal(job.status, 'done', logs);
    assert.equal(job.output.opportunities.length, 2);
    assert.ok(assertCompletionEvidence(job, job.output));
    assert.equal(job.output.completion_evidence.records[1].kind, 'public_discovery_receipt');
    assert.match(logs, /discovery_receipt_only/);
  } finally { clearTimeout(timeout); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
