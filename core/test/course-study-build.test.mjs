import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { courseStudyBuild } from '../src/executors/course-study-build.mjs';
import { verifyChapter, selectChapters, SOURCE_BYTE_LIMIT } from '../src/course-studio/chapters.mjs';
import { COURSE_STUDIO_SOURCES as catalog } from '../src/course-studio/source-catalog.mjs';
import { buildPractice } from '../src/course-studio/practice.mjs';
import { resultDigest, buildCompletionEvidence, assertCompletionEvidence } from '../src/completion-evidence.mjs';
import { notifyJobFailure, notifyJobSuccess } from '../src/notifier.mjs';

const urls = catalog.map(s => s.url);
const html = [
  '<h1>Linear Functions</h1><p>The average rate of change is constant. Point-slope form and slope-intercept form.</p>',
  '<h1>Elementary derivative rules</h1><p>Instantaneous rate of change. Power functions. Constant multiple rule and sum rule.</p>',
  '<h1>Composition of an Atom</h1><p>Atoms may gain or lose electrons. Isotopes keep the number of protons, but have a different number of neutrons. Carbon-13.</p>',
];
const job = {
  id: 'b0010000-cafe-4a00-8047-000000000001', org_id: 'b0010000-cafe-4a00-8047-000000000002',
  target_id: 'b0010000-cafe-4a00-8047-000000000003', job_type: 'course_study_build',
  target_type: 'private_study_course', status: 'running', attempts: 1, locked_by: 'lab#one', input: {},
};
const now = () => new Date('2026-01-02T12:00:00Z');
const page = (body, init = {}) => new Response(body, { headers: { 'content-type': 'text/html' }, ...init });
const row = (changes = {}) => ({ id: job.target_id, job_id: job.id, source_urls: [...urls], bundle: null, ...changes });

function lab({ record = row(), finish = true, failGet, failSave } = {}) {
  const requests = [], reads = [], writes = [];
  const deps = { now, resolveOrg: async () => job.org_id,
    fetchImpl: async (url, options) => { requests.push({ url, options }); return page(html[urls.indexOf(url)]); },
    query: async (path, options) => {
      if (path.startsWith('learning_studio_courses?')) {
        reads.push(path); if (failGet) throw new Error(failGet);
        return { body: record ? [record] : [] };
      }
      assert.equal(path, 'rpc/learning_studio_finish');
      assert.equal(options.method, 'POST');
      const payload = JSON.parse(options.body);
      writes.push(payload);
      if (failSave) throw new Error(failSave);
      if (finish === true) record.bundle = payload.p_bundle;
      return { body: finish };
    },
  };
  return { deps, requests, reads, writes, record };
}

test('all three sources are verified before one fenced private write; outward evidence contains only a digest and counts', async () => {
  const { deps, requests, reads, writes, record } = lab();
  const result = await courseStudyBuild(job, deps);
  const params = new URLSearchParams(reads[0].split('?')[1]);
  assert.equal(params.get('id'), 'eq.' + job.target_id);
  assert.equal(params.get('job_id'), 'eq.' + job.id);
  assert.equal(params.get('select'), 'id,job_id,source_urls,bundle');
  assert.deepEqual(requests.map(r => r.url), urls);
  for (const { options } of requests) {
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { accept: 'text/html' }); assert.equal(options.body, undefined);
  }
  assert.equal(writes.length, 1);
  const { p_bundle, ...fence } = writes[0];
  assert.deepEqual(fence, { p_course: job.target_id, p_job: job.id, p_worker: job.locked_by, p_attempt: 1 });
  for (let i = 0; i < urls.length; i++) {
    const { topic: _topic, ...citation } = catalog[i];
    assert.deepEqual(p_bundle.sources[i], { ...citation,
      bytes: Buffer.byteLength(html[i]), checked_at: now().toISOString(), sha256: createHash('sha256').update(html[i]).digest('hex') });
    assert.equal(p_bundle.brief.filter(b => b.source === urls[i]).length, 2);
    assert.equal(p_bundle.rounds.filter(r => r.source === urls[i]).length, 4);
  }
  assert.deepEqual(result, { executor: 'course_study_build:v1', source_count: 3, brief_count: 6,
    round_count: 12, bundle_sha256: resultDigest(record.bundle) });
  const out = buildCompletionEvidence(job, result);
  assert.ok(assertCompletionEvidence(job, out));
  assert.ok(!catalog.some(s => JSON.stringify(out).includes(s.url) || JSON.stringify(out).includes(s.attribution)));
  for (const bad of [{ ...result, school: 'Sample school' }, { ...result, round_count: 5 }, { ...result, bundle_sha256: 'bad' }]) {
    assert.throws(() => buildCompletionEvidence(job, bad), /private study/);
  }
});

test('course cannot finish on stale leases or ambiguous acknowledgments and retry never rerenders a stored bundle', async () => {
  const { deps, record } = lab({ record: row({ source_urls: [urls[1]] }) });
  const result = await courseStudyBuild(job, deps);
  const resumed = lab({ record });
  assert.deepEqual(await courseStudyBuild({ ...job, attempts: 2, locked_by: 'lab#two' }, resumed.deps), result);
  assert.equal(resumed.requests.length, 0); assert.equal(resumed.writes.length, 0);
  record.bundle.rounds[0].answer = -1;
  await assert.rejects(courseStudyBuild(job, resumed.deps), /no verifiable receipt/);
  await assert.rejects(courseStudyBuild(job, lab({ finish: false }).deps), { code: 'LEASE_LOST' });
  await assert.rejects(courseStudyBuild(job, lab({ finish: null }).deps), /not confirmed/);
  for (const f of [{ failGet: 'private example' }, { failSave: 'private example' }]) {
    await assert.rejects(courseStudyBuild(job, lab(f).deps), { message: 'Private study storage unavailable' });
  }
});

test('all seven nonempty selections build only requested topics; original math pair stays eight rounds', async () => {
  for (let mask = 1; mask < 8; mask++) {
    const chosen = urls.filter((_, i) => (mask & (1 << i)) !== 0);
    const l = lab({ record: row({ source_urls: chosen }) });
    const receipt = await courseStudyBuild(job, l.deps);
    assert.ok(assertCompletionEvidence(job, buildCompletionEvidence(job, receipt)));
    assert.deepEqual(l.requests.map(r => r.url), chosen);
    assert.equal(receipt.round_count, 4 * chosen.length); assert.equal(receipt.brief_count, 2 * chosen.length);
    assert.deepEqual([...new Set(l.writes[0].p_bundle.rounds.map(r => r.source))], chosen);
    if (mask === 3) assert.equal(receipt.round_count, 8);
  }
});

test('wrong request, row, source, org or cancellation cannot produce a write', async () => {
  for (const invalid of [{ target_id: 'not a course id' }, { input: { title: 'Lab' } }, { status: 'done' },
    { attempts: 0 }, { job_type: 'different' }, { target_type: 'portfolio' }]) {
    const l = lab(); await assert.rejects(courseStudyBuild({ ...job, ...invalid }, l.deps));
    assert.equal(l.reads.length, 0); assert.equal(l.requests.length, 0); assert.equal(l.writes.length, 0);
  }
  for (const invalid of [null, row({ id: job.id }), row({ job_id: job.target_id }),
    row({ source_urls: [] }), row({ source_urls: [urls[0], urls[0]] }), row({ source_urls: ['https://example.org/'] })]) {
    const l = lab({ record: invalid }); await assert.rejects(courseStudyBuild(job, l.deps));
    assert.equal(l.requests.length, 0); assert.equal(l.writes.length, 0);
  }
  const l = lab();
  await assert.rejects(courseStudyBuild(job, { ...l.deps, resolveOrg: async () => null }), /authority/);
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(courseStudyBuild(job, { ...l.deps, signal: ctl.signal }), { code: 'LEASE_LOST' });
  assert.equal(l.reads.length, 0);
  assert.deepEqual(await notifyJobSuccess(job, {}), { sent: false, reason: 'private_study_job' });
  assert.deepEqual(await notifyJobFailure(job, new Error('test')), { sent: false, reason: 'private_study_job' });
});

test('requires both transport proof and substantive content; prose, HTML and errors do not flow to the game', async () => {
  for (const response of [
    page('<h1>Linear Functions</h1>'), page('<script>' + html[0] + '</script>'),
    page(html[0], { status: 302 }), page(html[0], { status: 404 }),
    page(html[0], { headers: { 'content-type': 'text/plain' } }),
    page(html[0], { headers: { 'content-type': 'text/html', 'content-length': String(SOURCE_BYTE_LIMIT + 1) } }),
    page('x'.repeat(SOURCE_BYTE_LIMIT + 1)), page(html[1]),
  ]) {
    await assert.rejects(verifyChapter(urls[0], { fetchImpl: async () => response }), /could not be verified/);
  }
  const l = lab();
  await assert.rejects(courseStudyBuild(job, { ...l.deps, fetchImpl: async url => {
    if (url === urls[1]) throw new Error('unfiltered fetch failure');
    return page(html[0]);
  } }), { message: 'Study chapter could not be verified' });
  assert.equal(l.writes.length, 0);
  assert.throws(() => selectChapters([urls[0] + '?extra=1']), /supported catalog/);
});

test('100 seeded three-source runs: independently calculate all 1,200 answers, verify citations, choice uniqueness and deterministic variation', () => {
  const seeds = new Set(), positions = new Set();
  const sources = catalog.map(({ title, url }) => ({ title, url }));
  for (let i = 0; i < 100; i++) {
    const id = job.target_id.slice(0, -4) + String(i).padStart(4, '0');
    const run = buildPractice(id, sources);
    assert.deepEqual(run, buildPractice(id, sources));
    seeds.add(JSON.stringify(run.rounds.map(r => r.prompt)));
    const nums = i => run.rounds[i].prompt.match(/-?\d+/g).map(Number);
    const [x1, y1, x2, y2] = nums(0), [m, x, y] = nums(1), [start, flow, time] = nums(2),
      [fee, cost, bill] = nums(3), [factor, exp, at] = nums(4), [a, b, c, t] = nums(5), [linear] = nums(7);
    const [atomicNumber, mass] = nums(8), [protons, neutrons] = nums(9),
      [ionNumber, charge] = nums(10), [ionProtons, electrons] = nums(11);
    const answers = [(y2 - y1) / (x2 - x1), y - m * x, start + flow * time, (bill - fee) / cost,
      factor * exp * at ** (exp - 1), 2 * a * t + b, 0, linear,
      mass - atomicNumber, protons + neutrons, ionNumber - charge, ionProtons - electrons];
    for (const [idx, r] of run.rounds.entries()) {
      assert.equal(r.choices[r.answer], String(answers[idx])); assert.equal(new Set(r.choices).size, 4);
      assert.ok(r.explanation.length > 15); assert.equal(r.source, urls[Math.floor(idx / 4)]);
      positions.add(r.answer);
    }
  }
  assert.equal(seeds.size, 100); assert.equal(positions.size, 4);
});
