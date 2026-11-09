import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { environmentNewsRevision, prepareEnvironmentMission, prepareEnvironmentSponsorDraft, prepareEnvironmentSponsorCandidates, createEnvironmentPlanningService } from '../src/environment-mission-planning.js';
globalThis.crypto ||= webcrypto;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-11-08T12:00:00Z');
const article = () => ({ id: id(2), title: 'City publishes accessible cooling information', canonical_url: 'https://example.org/news/cooling', ingestion_provider: 'gdelt_gkg_v2', published_at: '2026-11-08T08:00:00Z', imported_at: '2026-11-08T08:10:00Z' });
const event = () => ({ id: 'nws:alert1', title: 'Heat alert', source: { id: 'nws', url: 'https://www.weather.gov/' }, observed_at: '2026-11-08T07:00:00Z', stale: false, actions: [{ id: 'resource-check' }] });
async function fixture() {
  const a = article();
  const r = { id: id(3), org_id: id(1), status: 'approved', recommendation_type: 'environment_news_context', decided_at: '2026-11-08T09:00:00Z', rationale: 'Check whether the listed support is accessible for this alert.', proposed_action: { schema: 'environment-news-context/v1', reviewer_id: id(7), scope: 'news_context_only_not_mission_or_outreach_approval', event_id: 'nws:alert1', article_id: a.id, article_revision: await environmentNewsRevision(a), headline_excerpt: 'accessible cooling information' } };
  return { orgId: id(1), event: event(), actionId: 'resource-check', articles: [a], reviews: [r], now };
}
test('exact reviewed metadata supplements official source without fabricated location or approval', async () => {
  const input = await fixture(), original = JSON.stringify(input), p = await prepareEnvironmentMission(input);
  assert.equal(JSON.stringify(input), original);
  assert.equal(p.news_context_ready, true);
  assert.equal(p.primary_source.url, 'https://www.weather.gov/');
  assert.equal(p.news[0].seen_at, input.articles[0].published_at);
  assert.equal(p.news[0].evidence_kind, 'reported_headline_claim');
  assert.equal(p.news[0].location_verified, false);
  assert.equal(p.status, undefined);
  assert.equal(p.lat, undefined);
  assert.match(p.safety, /Never enter a hazard/);
});
for (const change of ['status', 'org', 'event', 'revision', 'excerpt', 'future', 'old', 'missing_import']) {
  test(`review fails closed for ${change}`, async () => {
    const f = await fixture(), r = f.reviews[0];
    if (change === 'status') r.status = 'proposed';
    if (change === 'org') r.org_id = id(9);
    if (change === 'event') r.proposed_action.event_id = 'nws:other';
    if (change === 'revision') f.articles[0].title += ' corrected';
    if (change === 'excerpt') r.proposed_action.headline_excerpt = 'not a headline';
    if (change === 'future') r.decided_at = '2026-11-09T09:00:00Z';
    if (change === 'old') r.decided_at = '2026-11-06T09:00:00Z';
    if (change === 'missing_import') { f.articles[0].imported_at = null; r.proposed_action.article_revision = await environmentNewsRevision(f.articles[0]); }
    const p = await prepareEnvironmentMission(f);
    assert.equal(p.news_context_ready, false);
    assert.equal(p.excluded[0].reason, 'current_canonical_review_required');
  });
}
test('unsafe or old news is excluded, no fetch/body/geographic inference', async () => {
  const f = await fixture();
  f.articles.push({ ...article(), id: id(6), canonical_url: 'javascript:alert(1)' });
  f.articles[0].published_at = '2026-11-06T08:00:00Z';
  const p = await prepareEnvironmentMission(f);
  assert.deepEqual(p.excluded.map(x => x.reason), ['outside_daily_window', 'invalid_article']);
});
for (const change of ['stale', 'expired', 'missing_time', 'future', 'action', 'too_old']) {
  test(`source blocks planning when ${change}`, async () => {
    const f = await fixture();
    if (change === 'stale') f.event.stale = true;
    if (change === 'expired') f.event.expires_at = '2026-11-08T11:00:00Z';
    if (change === 'missing_time') f.event.observed_at = null;
    if (change === 'future') f.event.observed_at = '2026-11-09T07:00:00Z';
    if (change === 'action') f.actionId = 'travel-into-hazard';
    if (change === 'too_old') f.event.observed_at = '2026-11-06T07:00:00Z';
    await assert.rejects(prepareEnvironmentMission(f));
  });
}
test('sponsor draft requires same-org CRM evidence; no recipient, consent or partnership fabricated', async () => {
  const preview = await prepareEnvironmentMission(await fixture());
  const company = { id: id(4), org_id: id(1), name: 'Example organization', notes: 'Public accessibility research program', status: 'new' };
  const args = { preview, company, alignmentExcerpt: 'accessibility research' };
  const draft = prepareEnvironmentSponsorDraft(args);
  assert.equal(draft.recipient, null); assert.equal(draft.consent, null); assert.equal(draft.partnership_established, false);
  assert.match(draft.body, /https:\/\/example.org\/news\/cooling/);
  assert.match(draft.body, /claims, not independent verification/);
  assert.throws(() => prepareEnvironmentSponsorDraft({ ...args, alignmentExcerpt: 'made up' }));
  assert.throws(() => prepareEnvironmentSponsorDraft({ ...args, company: { ...company, org_id: id(5) } }));
  assert.throws(() => prepareEnvironmentSponsorDraft({ ...args, company: { ...company, status: 'declined' } }));
});
function serviceFixture({ owner = true, failWrite = false } = {}) {
  const rows = [], calls = [], a = article();
  const service = createEnvironmentPlanningService({ now: () => now,
    authorizeOwner: async () => owner ? { orgId: id(1), actorId: id(7) } : null,
    repository: {
      readEvent: async () => { calls.push('event'); return event(); },
      readArticles: async () => { calls.push('articles'); return [a]; },
      readReviews: async () => structuredClone(rows),
      readCompany: async () => ({ id: id(4), org_id: id(1), name: 'Example', notes: 'Accessibility support', status: 'new' }),
      saveNewsReview: async (_, record) => { calls.push('write'); if (failWrite) throw Error('database_unavailable'); const row = { ...record, id: id(3) }; rows.push(row); return structuredClone(row); }
    } });
  return { service, rows, calls, a };
}
const request = { eventId: 'nws:alert1', actionId: 'resource-check' };
test('owner journey lists candidates, approves exact revision, reloads canonical review, prepares draft', async () => {
  const { service, rows } = serviceFixture();
  const candidates = await service.listContext(request);
  assert.equal(candidates.articles[0].state, 'candidate_only');
  assert.equal((await service.plan(request)).news_context_ready, false);
  const saved = await service.reviewContext({ ...request, articleId: id(2), revision: candidates.articles[0].revision, headlineExcerpt: 'accessible cooling information', rationale: 'Review whether the support serves this alert.' });
  assert.equal(saved.review_id, id(3));
  assert.equal(rows[0].proposed_action.reviewer_id, id(7));
  assert.equal((await service.plan(request)).news_context_ready, true);
  const draft = await service.sponsorDraft({ ...request, companyId: id(4), alignmentExcerpt: 'Accessibility support' });
  assert.equal(draft.preparation_only, true); assert.equal(rows.length, 1);
});
test('all operations deny non-owner before any private read/write', async () => {
  const { service, calls } = serviceFixture({ owner: false });
  for (const method of ['listContext', 'reviewContext', 'plan', 'companies', 'sponsorDraft']) await assert.rejects(service[method](request), /owner_only/);
  assert.deepEqual(calls, []);
});
test('changed article blocks stale approval; failed write never returns success', async () => {
  const { service, calls, a } = serviceFixture();
  const revision = await environmentNewsRevision(a);
  a.title += ' corrected';
  await assert.rejects(service.reviewContext({ ...request, articleId: id(2), revision, headlineExcerpt: 'cooling', rationale: 'Check support.' }), /article_changed_reload_required/);
  assert.equal(calls.includes('write'), false);
  const failed = serviceFixture({ failWrite: true });
  await assert.rejects(failed.service.reviewContext({ ...request, articleId: id(2), revision, headlineExcerpt: 'cooling', rationale: 'Check support.' }), /database_unavailable/);
});

test('sponsor candidates use exact canonical notes with transparent lexical matches', async () => {
  const preview = await prepareEnvironmentMission(await fixture());
  const companies = [
    { id: id(4), org_id: id(1), name: 'Cooling team', status: 'new', notes: 'Program overview.\nAccessible cooling research for public access.' },
    { id: id(5), org_id: id(1), name: 'No notes', status: 'new', notes: null },
    { id: id(6), org_id: id(1), name: 'Declined', status: 'declined', notes: 'Accessible cooling research' },
    { id: id(8), org_id: id(9), name: 'Other org', status: 'new', notes: 'Accessible cooling research' },
    { id: id(9), org_id: id(1), name: 'Unrelated', status: 'new', notes: 'Motorsport engine development' }
  ];
  const result = prepareEnvironmentSponsorCandidates({ preview, companies });
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.company_id, id(4));
  assert.ok(candidate.matched_terms.includes('cooling'));
  assert.ok(companies[0].notes.includes(candidate.alignmentExcerpt));
  assert.equal(candidate.fit, 'unverified_hypothesis');
  assert.equal(candidate.recipient, undefined);
  assert.equal(prepareEnvironmentSponsorDraft({ preview, company: companies[0], alignmentExcerpt: candidate.alignmentExcerpt }).company_id, id(4));
  assert.throws(() => prepareEnvironmentSponsorCandidates({ preview, companies: Array(51).fill(companies[0]) }), /bounded_inputs_required/);
});
test('multiline/tab review prose saves and qualifies without altering exact evidence', async () => {
  const { service, a, rows } = serviceFixture();
  const rationale = 'Check accessible support.\nCompare local hours.\r\n\tFlag missing details.';
  await service.reviewContext({ ...request, articleId: a.id, revision: await environmentNewsRevision(a), headlineExcerpt: 'cooling', rationale });
  assert.equal(rows[0].rationale, rationale);
  assert.equal((await service.plan(request)).news_context_ready, true);
  for (const control of ['\0', '\u000b', '\u001b', '\u007f', '\u0085']) {
    await assert.rejects(service.reviewContext({ ...request, articleId: a.id, revision: await environmentNewsRevision(a), headlineExcerpt: 'cooling', rationale: `Normal ${control} text` }), /relevance_rationale_required/);
  }
});
test('multiline CRM notes and exact multiline/tab excerpt are usable but other controls fail closed', async () => {
  const preview = await prepareEnvironmentMission(await fixture());
  const notes = 'Accessible\tcooling research.\r\nPublic access program.';
  const company = { id: id(4), org_id: id(1), name: 'Example organization', status: 'new', notes };
  const result = prepareEnvironmentSponsorCandidates({ preview, companies: [company] });
  assert.equal(result.candidates.length, 1);
  assert.ok(notes.includes(result.candidates[0].alignmentExcerpt));
  const draft = prepareEnvironmentSponsorDraft({ preview, company, alignmentExcerpt: notes });
  assert.equal(draft.alignment.excerpt, notes);
  assert.match(draft.body, /internal CRM notes/);
  assert.match(draft.body, /not verified public facts/);
  assert.equal(draft.alignment.verification_required, true);
  for (const control of ['\0', '\u001b', '\u0085']) {
    const bad = { ...company, notes: notes + control };
    assert.equal(prepareEnvironmentSponsorCandidates({ preview, companies: [bad] }).candidates.length, 0);
    assert.throws(() => prepareEnvironmentSponsorDraft({ preview, company: bad, alignmentExcerpt: notes }), /exact_crm_alignment_evidence_required/);
  }
  assert.equal(prepareEnvironmentSponsorCandidates({ preview, companies: [{ ...company, notes: 'Unrelated program.\nNo topical overlap.' }] }).candidates.length, 0);
});
test('draft includes at most three whole citations and exposes total and limitation', async () => {
  const preview = await prepareEnvironmentMission(await fixture());
  preview.news = Array.from({ length: 5 }, (_, i) => ({ ...preview.news[0], id: id(20 + i), title: `Cooling report ${i}`, canonical_url: `https://example.org/story/${i}` }));
  const company = { id: id(4), org_id: id(1), name: 'Example', status: 'new', notes: 'Cooling research program' };
  const draft = prepareEnvironmentSponsorDraft({ preview, company, alignmentExcerpt: company.notes });
  assert.equal(draft.citation_total, 5);
  assert.equal(draft.citation_included, 3);
  assert.equal(draft.citations.length, 3);
  assert.match(draft.citation_limitation, /3 complete/);
  assert.match(draft.body, /Includes 3 of 5/);
  for (const citation of draft.citations) { assert.ok(draft.body.includes(citation.title)); assert.ok(draft.body.includes(citation.url)); }
  assert.ok(!draft.body.includes('https://example.org/story/3'));
  assert.ok(draft.body.endsWith('No partnership or funding commitment has been made.'));
  assert.ok(draft.body.length <= 12000);
});
test('max-length draft removes complete citations instead of silently cutting text', async () => {
  const preview = await prepareEnvironmentMission(await fixture());
  preview.news = Array.from({ length: 4 }, (_, i) => ({ ...preview.news[0], id: id(30 + i), title: String(i).repeat(1000), canonical_url: 'https://example.org/' + String(i).repeat(1980) }));
  preview.primary_source.url = 'https://www.weather.gov/' + 'a'.repeat(1970);
  const company = { id: id(4), org_id: id(1), name: 'Example', status: 'new', notes: 'a'.repeat(1500) };
  const draft = prepareEnvironmentSponsorDraft({ preview, company, alignmentExcerpt: company.notes });
  assert.equal(draft.citation_total, 4);
  assert.equal(draft.citation_included, 2);
  assert.ok(draft.body.length <= 12000);
  for (const citation of draft.citations) assert.ok(draft.body.includes(citation.url));
  assert.ok(draft.body.includes(company.notes));
  assert.ok(draft.body.endsWith('No partnership or funding commitment has been made.'));
});
