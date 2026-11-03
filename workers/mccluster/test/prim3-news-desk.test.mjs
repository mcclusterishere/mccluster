import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNewsDesk } from '../src/prim3/news-desk.js';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const owner = async () => ({ id: 'owner' });
const ART = '00000000-0000-4000-8000-000000000001';

function withFetch(rows, run) {
  const original = globalThis.fetch; const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const path = String(url).replace('https://db.example/rest/v1/', '');
    const key = Object.keys(rows).find(prefix => path.startsWith(prefix));
    return new Response(JSON.stringify(key ? rows[key] : []), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return run(seen).finally(() => { globalThis.fetch = original; });
}
const get = (q = '') => new Request(`https://api.mccluster.org/v1/prim3/news-desk${q}`, { headers: { origin: 'https://matthew.mccluster.org' } });

test('a country returns its latest brief and reactions with publisher links', async () => {
  await withFetch({
    'prim3_agent_news_briefs?country_iso=eq.JP': [{ agent_key: 'aya-shinoda', brief: 'Japan was mostly space and games today.', headline_count: 40, created_at: '2026-11-03T01:00:00Z' }],
    'prim3_agent_news_comments?country_iso=eq.JP': [{ agent_key: 'aya-shinoda', article_id: ART, headline: 'Satellite launched', comment: 'Another relay in orbit.', created_at: '2026-11-03T01:00:00Z' }],
    'media_news_articles?id=in.': [{ id: ART, canonical_url: 'https://news.example/a' }],
  }, async () => {
    const res = await handleNewsDesk(get('?country=jp'), env, { requireHouseOwner: owner });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const body = await res.json();
    assert.equal(body.country_iso, 'JP');
    assert.equal(body.brief.text, 'Japan was mostly space and games today.');
    assert.equal(body.comments[0].url, 'https://news.example/a');
  });
});

test('without a country it returns one latest brief per agent', async () => {
  await withFetch({ 'prim3_agent_news_briefs?select': [
    { agent_key: 'aya-shinoda', country_iso: 'JP', brief: 'new', headline_count: 3, created_at: '2026-11-03T02:00:00Z' },
    { agent_key: 'aya-shinoda', country_iso: 'JP', brief: 'old', headline_count: 3, created_at: '2026-11-02T22:00:00Z' },
    { agent_key: 'hana-lee', country_iso: 'KR', brief: 'kr', headline_count: 2, created_at: '2026-11-03T01:00:00Z' },
  ] }, async () => {
    const body = await (await handleNewsDesk(get(), env, { requireHouseOwner: owner })).json();
    assert.deepEqual(body.briefs.map(b => b.brief), ['new', 'kr']);
  });
});

test('only the house owner may read; bad input and methods are refused', async () => {
  await withFetch({}, async (seen) => {
    const denied = async () => { throw Object.assign(new Error('McCluster house owner access required'), { status: 403 }); };
    assert.equal((await handleNewsDesk(get('?country=JP'), env, { requireHouseOwner: denied })).status, 403);
    assert.equal(seen.length, 0, 'no database read before the owner check');
    assert.equal((await handleNewsDesk(get('?country=JPN'), env, { requireHouseOwner: owner })).status, 400);
    assert.equal((await handleNewsDesk(new Request('https://api.mccluster.org/v1/prim3/news-desk', { method: 'POST' }), env, { requireHouseOwner: owner })).status, 405);
    assert.equal(await handleNewsDesk(get().constructor === Request ? new Request('https://api.mccluster.org/v1/prim3/other') : null, env, { requireHouseOwner: owner }), null);
  });
});
