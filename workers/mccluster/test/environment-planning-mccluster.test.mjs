import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createMcClusterEnvironmentPlanning } from '../src/environment-planning-mccluster.js';
globalThis.crypto ||= webcrypto;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function setup() {
  const state = { owner: true, failWrite: false, rows: [], calls: [], event: { id: 'nws:alert', title: 'Heat alert', source: { id: 'nws', url: 'https://www.weather.gov/' }, observed_at: '2026-11-08T09:00:00Z', stale: false, actions: [{ id: 'resource-check' }] }, article: { id: id(2), title: 'Accessible cooling resource announced', canonical_url: 'https://example.org/cooling', published_at: '2026-11-08T09:00:00Z', imported_at: '2026-11-08T09:10:00Z', ingestion_provider: 'gdelt_gkg_v2' } };
  const fetchImpl = async (raw, options = {}) => {
    const url = new URL(raw); state.calls.push({ url, options });
    const result = data => Response.json(data);
    if (url.pathname === '/auth/v1/user') return result({ id: id(7) });
    if (url.pathname.endsWith('/orgs')) return result([{ id: id(1) }]);
    if (url.pathname.endsWith('/org_members')) return result(state.owner ? [{ role: 'owner' }] : []);
    if (url.pathname.endsWith('/media_news_articles')) return result([state.article]);
    if (url.pathname.endsWith('/out_companies')) return result([{ id: id(4), org_id: id(1), name: 'Example', notes: 'Accessible cooling research', status: 'new' }]);
    if (url.pathname.endsWith('/ops_recommendations')) {
      assert.equal(options.headers.authorization, 'Bearer test-key');
      if (options.method === 'POST') {
        if (state.failWrite) return new Response('failed', { status: 500 });
        const row = { ...JSON.parse(options.body), id: id(3) }; state.rows.push(row); return result([row]);
      }
      assert.equal(url.searchParams.get('org_id'), `eq.${id(1)}`);
      assert.equal(url.searchParams.get('proposed_action->>event_id'), 'eq.nws:alert');
      return result(state.rows);
    }
    throw Error(`Unexpected external request: ${url}`);
  };
  const api = createMcClusterEnvironmentPlanning({ request: new Request('https://test.invalid/', { headers: { authorization: 'Bearer test-user' } }), env: { SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key' }, readEvent: async () => state.event, now: () => Date.parse('2026-11-08T12:00:00Z'), fetchImpl });
  return { api, state };
}
const request = { eventId: 'nws:alert', actionId: 'resource-check' };
async function approve(api) {
  const c = await api.context(request);
  return api.review({ ...request, articleId: id(2), revision: c.articles[0].revision, headlineExcerpt: 'cooling resource', rationale: 'Check the accessible resource against the official alert.' });
}
test('adapter writes canonical review and returns only public-safe attribution', async () => {
  const { api, state } = setup(); await approve(api);
  const context = await api.approvedContext({ ...request, reviewId: id(3) });
  assert.equal(context.url, state.article.canonical_url);
  assert.equal(context.reviewer_id, undefined); assert.equal(context.rationale, undefined); assert.equal(context.org_id, undefined);
  assert.equal(state.rows[0].proposed_action.reviewer_id, id(7));
  const draft = await api.sponsorDraft({ ...request, companyId: id(4), alignmentExcerpt: 'Accessible cooling research' });
  assert.equal(draft.recipient, null);
  assert.equal(state.calls.filter(c => c.options.method === 'POST').length, 1);
});
for (const reason of ['revoked', 'changed', 'stale', 'expired']) {
  test(`approvedContext refuses ${reason} context`, async () => {
    const { api, state } = setup(); await approve(api);
    if (reason === 'revoked') state.rows[0].status = 'rejected';
    if (reason === 'changed') state.article.title += ' correction';
    if (reason === 'stale') state.event.stale = true;
    if (reason === 'expired') state.event.expires_at = '2026-11-08T11:00:00Z';
    assert.equal(await api.approvedContext({ ...request, reviewId: id(3) }), null);
  });
}
test('non-owner cannot read private planning data or write', async () => {
  const { api, state } = setup(); state.owner = false;
  await assert.rejects(api.context(request), /owner_only/);
  assert.equal(state.calls.some(c => /media_news_articles|ops_recommendations|out_companies/.test(c.url.pathname)), false);
});
test('persistence failure propagates without fake review success', async () => {
  const { api, state } = setup(); state.failWrite = true;
  await assert.rejects(approve(api), /review_persistence_unavailable/);
  assert.equal(state.rows.length, 0);
});
test('malformed or missing review does not produce context', async () => {
  const { api } = setup();
  assert.equal(await api.approvedContext({ ...request, reviewId: 'no' }), null);
  assert.equal(await api.approvedContext({ ...request, reviewId: id(3) }), null);
});
test('context reload exposes reviewed IDs and typed validation errors', async () => {
  const { api } = setup(); await approve(api);
  const context = await api.context(request);
  assert.equal(context.reviewed[0].review_id, id(3));
  assert.equal(context.limit, 100);
  await assert.rejects(api.review({ ...request, articleId: 'invalid' }), error => error.code === 'invalid_article_id' && error.status === 400);
});
test('review with absent reviewer identity fails closed', async () => {
  const { api, state } = setup(); await approve(api);
  delete state.rows[0].proposed_action.reviewer_id;
  assert.equal(await api.approvedContext({ ...request, reviewId: id(3) }), null);
});

test('owner company candidates are bounded same-org canonical reads and feed draft directly', async () => {
  const { api, state } = setup(); await approve(api);
  const result = await api.companies(request);
  assert.equal(result.candidates.length, 1);
  const call = state.calls.find(c => c.url.pathname.endsWith('/out_companies'));
  assert.equal(call.url.searchParams.get('limit'), '50');
  assert.equal(call.url.searchParams.get('org_id'), `eq.${id(1)}`);
  const candidate = result.candidates[0];
  const draft = await api.sponsorDraft({ ...request, companyId: candidate.company_id, alignmentExcerpt: candidate.alignmentExcerpt });
  assert.equal(draft.company_id, candidate.company_id);
  assert.equal(state.calls.filter(c => c.options.method === 'POST').length, 1);
});
