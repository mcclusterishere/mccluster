import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { seedMorningBriefs, handleNewsBriefs, editionWindow, deskConfig, shapeBrief } from '../src/news-briefs.js';
const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture', NEWS_BRIEFS_ENABLED: 'true', NEWS_BRIEF_AUTO_MAX: '0', NEWS_BRIEF_COUNTRIES: 'KE,GB' };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const now = Date.parse('2026-10-21T05:00:00Z');
const headline = (country, n = 1) => ({ id: `source-${country}-${n}`, source_id: 'publisher', location_country_fips: country,
  published_at: '2026-10-20T12:00:00Z', imported_at: '2026-10-20T12:15:00Z', story_key: `${country}-${n}`, title: `Ferry service returns ${country}`, canonical_url: `https://example.org/${country}/${n}` });
function store({ failCountryOnce, capped = false, unavailable = false } = {}) {
  const jobs = new Map(), writes = [], state = { capped };
  let failed = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    if (u.pathname.endsWith('/auth/v1/user')) return Response.json({ id: 'owner-user' });
    if (u.pathname.endsWith('/org_members')) return Response.json([{ role: 'owner' }]);
    if (u.pathname.endsWith('/orgs')) return Response.json([{ id: 'org-1' }]);
    if (u.pathname.endsWith('/news_region_leads')) return Response.json([]);
    if (u.pathname.endsWith('/media_news_articles')) {
      if (unavailable) return Response.json({ message: 'timeout' }, { status: 503 });
      assert.equal(u.searchParams.get('ingestion_provider'), 'eq.gdelt_gkg_v2');
      return Response.json(state.capped ? Array.from({ length: 1000 }, (_, i) => headline('US', i)) : [headline('US'), headline('KE'), headline('UK')]);
    }
    if (u.pathname.endsWith('/ops_agent_jobs') && method === 'GET') return Response.json([...jobs.values()].filter((j) => `eq.${j.id}` === u.searchParams.get('id')));
    if (u.pathname.endsWith('/ops_agent_jobs') && method === 'POST') {
      const job = JSON.parse(init.body), country = job.input.evidence.country;
      writes.push(job);
      if (country === failCountryOnce && !failed) { failed = true; return Response.json({ message: 'temporarily unavailable' }, { status: 503 }); }
      assert.equal(init.headers.prefer, 'resolution=ignore-duplicates,return=representation');
      // Simulates the DB primary-key conflict after both callers read absence.
      await Promise.resolve();
      if (jobs.has(job.id)) return Response.json([]);
      jobs.set(job.id, job); return Response.json([job]);
    }
    throw new Error(`Unexpected ${method} ${u}`);
  };
  return { jobs, writes, state };
}

test('partial country failure preserves successful desks and next cron recovers only missing work', async () => {
  const db = store({ failCountryOnce: 'KE' });
  const first = await seedMorningBriefs(ENV, { now });
  assert.deepEqual(first.queued, ['US', 'GB']);
  assert.equal(first.complete, false);
  assert.equal(first.receipts.find((r) => r.country === 'KE').state, 'enqueue_failed');
  const second = await seedMorningBriefs(ENV, { now });
  assert.deepEqual(second.queued, ['KE']);
  assert.equal(second.complete, true);
  assert.equal(db.jobs.size, 3);
  assert.equal(db.writes.filter((j) => j.input.evidence.country === 'US').length, 1);
});

test('overlapping cron invocations converge on one durable job per edition', async () => {
  const db = store();
  await Promise.all([seedMorningBriefs(ENV, { now }), seedMorningBriefs(ENV, { now })]);
  assert.equal(db.jobs.size, 3);
  for (const job of db.jobs.values()) assert.equal(job.input.edition_version, 2);
});

test('DST dates use 23/25 hour windows and the deadline remains 07:00 local', () => {
  const spring = editionWindow('2026-03-08');
  assert.equal(spring.since, '2026-03-08T05:00:00.000Z');
  assert.equal(spring.until, '2026-03-09T04:00:00.000Z');
  assert.equal(spring.deadline, '2026-03-09T11:00:00.000Z');
  const fall = editionWindow('2026-11-01');
  assert.equal(fall.since, '2026-11-01T04:00:00.000Z');
  assert.equal(fall.until, '2026-11-02T05:00:00.000Z');
  assert.equal(fall.deadline, '2026-11-02T12:00:00.000Z');
  const uk = editionWindow('2026-10-25', 'Europe/London');
  assert.equal(Date.parse(uk.until) - Date.parse(uk.since), 25 * 3600000);
  assert.equal(editionWindow('2026-10-20', 'Africa/Nairobi').since, '2026-10-19T21:00:00.000Z');
  assert.throws(() => editionWindow('2026-02-30'), /Invalid calendar/);
  assert.throws(() => deskConfig({ NEWS_BRIEF_DESKS: '{"KE":"bad/zone"}' }, 'KE'), /time zone/i);
});

test('discovery time is never projected as publication/event time, and scan caps remain visible', async () => {
  const db = store({ capped: true });
  const result = await seedMorningBriefs(ENV, { now });
  assert.equal(result.coverage.truncated, true);
  const us = [...db.jobs.values()].find((j) => j.input.evidence.country === 'US');
  assert.equal(us.input.coverage.truncated, true);
  assert.equal(us.input.coverage.sampled, true);
  const source = us.input.evidence.headlines[0];
  assert.equal(source.published_at, null); assert.equal(source.observed_at, null);
  assert.equal(source.discovered_at, '2026-10-20T12:00:00Z');
  assert.equal(source.time_basis, 'discovery'); assert.equal(source.url, undefined);
  const ke = [...db.jobs.values()].find((j) => j.input.evidence.country === 'KE');
  assert.equal(ke, undefined, 'absence from a capped scan must not freeze an empty edition');
  assert.equal(result.receipts.find((r) => r.country === 'KE').state, 'coverage_incomplete');
  assert.equal(result.complete, false);
});

test('a later complete scan recovers missing desks after truncation without rewriting the US edition', async () => {
  const db = store({ capped: true });
  const first = await seedMorningBriefs(ENV, { now });
  assert.deepEqual(first.queued, ['US']);
  assert.equal(db.jobs.size, 1);
  const us = [...db.jobs.values()][0], frozen = JSON.stringify(us);
  db.state.capped = false;
  const second = await seedMorningBriefs(ENV, { now });
  assert.deepEqual(second.queued, ['KE', 'GB']);
  assert.equal(second.complete, true);
  assert.equal(db.jobs.size, 3);
  assert.equal(JSON.stringify(db.jobs.get(us.id)), frozen);
  assert.equal(db.writes.filter((j) => j.input.evidence.country === 'US').length, 1);
  assert.equal([...db.jobs.values()].find((j) => j.input.evidence.country === 'KE').status, 'queued');
});

test('an incomplete country request stays retryable without creating a frozen empty edition', async () => {
  const db = store({ capped: true });
  const request = () => handleNewsBriefs(new Request('https://api.test/v1/news-briefs/request', {
    method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ country: 'KE', day: '2026-10-19' })
  }), ENV);
  const incomplete = await request();
  assert.equal(incomplete.status, 503);
  assert.match((await incomplete.json()).error, /incomplete.*retry/i);
  assert.equal(db.jobs.size, 0);
  db.state.capped = false;
  const complete = await request();
  assert.equal(complete.status, 200); // Fixture rows are outside this requested day: now a complete empty scan.
  assert.equal((await complete.json()).status, 'no_coverage');
  assert.equal(db.jobs.size, 1);
});

test('source failure cannot become a delivered empty edition', async () => {
  const db = store({ unavailable: true });
  await assert.rejects(seedMorningBriefs(ENV, { now }), /timeout/);
  assert.equal(db.jobs.size, 0);
});

test('late is measured against actual completion, not the time the operator opens the card', () => {
  const j = { target_id: '2026-10-20:US', status: 'done', updated_at: '2026-10-21T10:59:00Z',
    input: { evidence: { window: editionWindow('2026-10-20') } }, output: { editorial_status: 'needs_review', analysis: {} } };
  assert.equal(shapeBrief(j, now + 86400000).late, false);
  assert.equal(shapeBrief({ ...j, updated_at: '2026-10-21T11:01:00Z' }).late, true);
  assert.equal(shapeBrief(j).publication_authorized, false);
});
