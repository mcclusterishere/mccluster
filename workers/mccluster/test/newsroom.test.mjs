/* McCluster Corp news on mccluster.org/news/ (src/company-site/news.js), the gate that lets only the house owner mark a
   post for it (src/platform-api.js), and the GDELT screen that keeps our own hosts out of the World's outside news.
   Owner, 2026-10-20: "getting my admin's posts as their own news worth posts and getting them published on GDELT". */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { companySiteResponse } from '../src/company-site/router.js';
import { shapeArticle, slugify, renderSitemap } from '../src/company-site/news.js';
import { PAGES } from '../src/company-site/pages.generated.js';
import { handlePlatformApi } from '../src/platform-api.js';
import { screenReason } from '../src/world-news-discovery.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const OWNER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const A2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GONE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOT_NEWS = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3600e3).toISOString();
const row = (id, body, extra = {}) => ({ id, author_m_uid: OWNER, body, created_at: ago(5), updated_at: ago(4), visibility: 'public',
  deleted_at: null, removed_at: null, group_id: null, reply_to_id: null, metadata: { newsroom: true }, ...extra });
const ROWS = [
  row(A1, 'Yesterday in the United States: what moved markets\n\nFirst paragraph <script>alert(1)</script> & more.\nSame paragraph, next line.\n\nSecond paragraph.',
    { metadata: { newsroom: true, newsroom_note: 'morning_brief', newsroom_sources: [{ title: 'Fed holds', url: 'https://news.example/fed' }, { title: 'bad', url: 'javascript:alert(1)' }] } }),
  row(A2, 'Older piece without a short first line, which runs on and on well past the length a headline may have before it is cut at a word so it reads cleanly. Then more.', { created_at: ago(24 * 5), updated_at: ago(24 * 5) }),
  row(GONE, 'Taken back\n\nIt was deleted.', { deleted_at: ago(1) }),
  row(NOT_NEWS, 'Just a post\n\nNot for the newsroom.', { metadata: {} }),
  row('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Someone else\n\nA member marked their own post.', { author_m_uid: MEMBER }),
  row('ffffffff-ffff-4fff-8fff-ffffffffffff', '   ', { media: [{ asset_id: 'x' }] })
];

function store({ down = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(u);
    assert.equal(init.headers.authorization, 'Bearer svc');
    if (down) return new Response('{}', { status: 503 });
    if (u.pathname.endsWith('/rpc/mnet_admin_m_uids')) return Response.json([OWNER]);
    if (u.pathname.endsWith('/network_posts')) {
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      if (id) return Response.json(ROWS.filter((r) => r.id === id));
      // the store honours the filters the newsroom asks for; the newsroom checks again
      assert.equal(u.searchParams.get('metadata->>newsroom'), 'eq.true');
      assert.equal(u.searchParams.get('author_m_uid'), `in.(${OWNER})`);
      // a store would return the emptied row too; the newsroom leaves it out
      return Response.json(ROWS.filter((r) => r.author_m_uid === OWNER && r.metadata.newsroom && !r.deleted_at));
    }
    throw new Error('unexpected ' + u.pathname);
  };
  return { calls, fetchImpl };
}
const get = (path, opts = {}, env = ENV, method = 'GET') => {
  const s = store(opts);
  return companySiteResponse(new Request('https://mccluster.org' + path, { method }), env, s.fetchImpl).then((res) => Object.assign(res, { calls: s.calls }));
};

test('an article is the post, server-rendered, with NewsArticle data that names the company and Matthew by their stable ids', async () => {
  const a = shapeArticle(ROWS[0]);
  assert.equal(a.headline, 'Yesterday in the United States: what moved markets');
  assert.equal(a.path, `/news/yesterday-in-the-united-states-what-moved-markets-${A1}`);
  const res = await get(a.path);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  assert.doesNotMatch(res.headers.get('content-security-policy'), /script-src/);
  const html = await res.text();
  assert.match(html, new RegExp(`<link rel="canonical" href="https://mccluster.org${a.path}">`));
  assert.match(html, /<meta property="og:site_name" content="McCluster Corp">/);
  assert.match(html, /<h1>Yesterday in the United States: what moved markets<\/h1>/);
  assert.match(html, /First paragraph &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; more\.<br>Same paragraph, next line\./, 'the post is text, never markup');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Drafted with McCluster AI/, 'a brief drafted with AI says so');
  assert.match(html, /href="https:\/\/news.example\/fed"/);
  assert.doesNotMatch(html, /javascript:/, 'only https sources');
  const graph = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(graph['@type'], 'NewsArticle');
  assert.equal(graph.headline, a.headline);
  assert.equal(graph.datePublished, ROWS[0].created_at);
  assert.equal(graph.author['@id'], 'https://matthew.mccluster.org/#matthew-mccluster');
  assert.equal(graph.publisher['@id'], 'https://matthew.mccluster.org/#mccluster-corp');
  assert.equal(graph.publisher.url, 'https://mccluster.org/');
  assert.equal(graph.isPartOf['@id'], 'https://mccluster.org/#website');
  assert.equal(graph.publisher.sameAs, undefined, 'no personal accounts on the Organization');
});

test('one address per article: a bare id or an old slug moves to the current one; HEAD has no body', async () => {
  const a = shapeArticle(ROWS[0]);
  for (const path of [`/news/${A1}`, `/news/old-headline-${A1}`, `/news/${A1.toUpperCase()}`]) {
    const res = await get(path);
    assert.equal(res.status, 301, path);
    assert.equal(res.headers.get('location'), `https://mccluster.org${a.path}`);
  }
  const head = await get(a.path, {}, ENV, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await get(a.path, {}, ENV, 'POST')).status, 405);
});

test('only the house owner\'s live newsroom posts are articles: deleted is 410 Gone, the rest 404', async () => {
  assert.equal((await get(`/news/taken-back-${GONE}`)).status, 410);
  assert.equal((await get(`/news/just-a-post-${NOT_NEWS}`)).status, 404);
  assert.equal((await get('/news/someone-else-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).status, 404);
  // edited down to only its media: the article has left, never an empty page
  assert.equal((await get('/news/ffffffff-ffff-4fff-8fff-ffffffffffff')).status, 410);
  const nothing = await get('/news/not-an-article');
  assert.equal(nothing.status, 404);
  assert.match(await nothing.text(), /<meta name="robots" content="noindex">/);
});

test('the index, the RSS feed and the Google News sitemap list the articles, newest first', async () => {
  const index = await get('/news/');
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.ok(html.indexOf(A1) < html.indexOf(A2), 'newest first');
  assert.doesNotMatch(html, new RegExp(GONE + '|' + NOT_NEWS + '|ffffffff-ffff'));
  assert.equal(JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1])['@type'], 'CollectionPage');
  assert.equal((await get('/news')).headers.get('location'), 'https://mccluster.org/news/');

  const feed = await get('/news/feed.xml');
  assert.match(feed.headers.get('content-type'), /application\/rss\+xml/);
  const rss = await feed.text();
  assert.match(rss, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/);
  assert.equal((rss.match(/<item>/g) || []).length, 2, 'the emptied post is not an item');
  assert.match(rss, new RegExp(`<guid isPermaLink="true">https://mccluster.org/news/yesterday-in-the-united-states-what-moved-markets-${A1}</guid>`));
  assert.match(rss, /&lt;script&gt;/, 'escaped in the feed too');

  const map = await (await get('/news/sitemap.xml')).text();
  assert.match(map, /xmlns:news="http:\/\/www.google.com\/schemas\/sitemap-news\/0.9"/);
  assert.equal((map.match(/<news:news>/g) || []).length, 1, 'only the last two days carry the news tags');
  assert.match(map, /<news:name>McCluster Corp<\/news:name>/);
  assert.match(map, new RegExp(`<loc>https://mccluster.org/news/[a-z0-9-]+-${A2}</loc>`), 'older articles stay in the sitemap');
  assert.match(PAGES['/robots.txt'].body, /Sitemap: https:\/\/mccluster.org\/news\/sitemap.xml/);
});

test('a headline from a long opening is cut at a word; slugs are plain ASCII', () => {
  const a = shapeArticle(ROWS[1]);
  assert.ok(a.headline.length <= 110, a.headline);
  assert.match(a.headline, /…$/);
  assert.equal(a.paragraphs.length, 1, 'the whole post is the story');
  assert.equal(slugify('Café & Côte d\'Ivoire: 2026!'), 'cafe-and-cote-d-ivoire-2026');
  const map = renderSitemap([], NOW);
  assert.match(map, /<loc>https:\/\/mccluster.org\/news\/<\/loc>/);
});

test('the store down is a 503 nobody caches; the switch off sends /news to the personal host; www goes to the apex', async () => {
  const down = await get('/news/', { down: true });
  assert.equal(down.status, 503);
  assert.equal(down.headers.get('cache-control'), 'no-store');
  const off = await get('/news/', {}, { ...ENV, NEWSROOM_ENABLED: 'false' });
  assert.equal(off.status, 301);
  assert.equal(off.headers.get('location'), 'https://matthew.mccluster.org/news/');
  const www = await companySiteResponse(new Request('https://www.mccluster.org/news/feed.xml'), ENV, store().fetchImpl);
  assert.equal(www.headers.get('location'), 'https://mccluster.org/news/feed.xml');
  assert.equal(await companySiteResponse(new Request('https://api.mccluster.org/news/'), ENV, store().fetchImpl), null);
});

test('GDELT never brings our own articles back as outside news', () => {
  const rec = (domain) => ({ domain, title: 'A perfectly ordinary headline about the world', themes: [] });
  assert.equal(screenReason(rec('mccluster.org')), 'domain');
  assert.equal(screenReason(rec('matthew.mccluster.org')), 'domain');
  assert.equal(screenReason(rec('humanuprise.com')), 'domain');
  assert.equal(screenReason(rec('reuters.com')), null);
});

/* ---------- the gate: only the house owner marks a post for the newsroom ---------- */
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function platform({ me = OWNER } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ u, m, body });
    if (u.endsWith('/auth/v1/user')) return Response.json({ id: 'user-1' });
    if (u.includes('/m_auth_user_links')) return Response.json([{ m_uid: me }]);
    if (u.includes('/rpc/mnet_admin_m_uids')) return Response.json([OWNER]);
    if (u.includes('/platform_apps')) return Response.json([{ id: 'app1' }]);
    if (u.includes('/network_scheduled_posts') && m === 'POST') return Response.json([{ id: 'sched-1', publish_at: body.publish_at, status: 'scheduled', payload: body.payload }], { status: 201 });
    if (u.includes('/network_posts') && m === 'POST') return Response.json([{ id: A1, author_m_uid: me, ...body }], { status: 201 });
    return Response.json([]);
  };
  return calls;
}
const post = (body) => handlePlatformApi(new Request('https://api.test/v1/mnet/posts?app_key=mccluster-web', {
  method: 'POST', headers: { authorization: 'Bearer user', 'content-type': 'application/json' }, body: JSON.stringify(body) }), ENV)
  .catch((e) => new Response(JSON.stringify({ error: e.message }), { status: e.status || 500 }));
const written = (calls) => calls.find((c) => c.u.endsWith('/network_posts') && c.m === 'POST')?.body;

test('the house owner\'s post marked for the newsroom carries it, with https sources only', async () => {
  const calls = platform();
  const res = await post({ body: 'Headline\n\nStory.', visibility: 'public', newsroom: true, newsroom_note: 'morning_brief',
    newsroom_sources: [{ title: 'Fed', url: 'https://news.example/fed' }, { title: 'x', url: 'javascript:alert(1)' }, { title: 'y', url: 'http://plain.example/' }] });
  assert.equal(res.status, 201);
  assert.deepEqual(written(calls).metadata, { newsroom: true, newsroom_note: 'morning_brief',
    newsroom_sources: [{ url: 'https://news.example/fed', title: 'Fed', domain: 'news.example' }] });
});

test('nobody else can: a member asking is refused before any write, and a member\'s own metadata cannot smuggle it in', async () => {
  let calls = platform({ me: MEMBER });
  const res = await post({ body: 'Headline\n\nStory.', visibility: 'public', newsroom: true });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /Only the house owner/);
  assert.equal(written(calls), undefined);
  calls = platform({ me: MEMBER });
  assert.equal((await post({ body: 'Sneaky', metadata: { newsroom: true } })).status, 403);
  assert.equal(written(calls), undefined);
  // without asking, a post is a post: stray newsroom keys never reach the row
  calls = platform({ me: MEMBER });
  assert.equal((await post({ body: 'Plain', metadata: { newsroom_sources: [{ url: 'https://x.example' }], mood: 'ok' } })).status, 201);
  assert.deepEqual(written(calls).metadata, { mood: 'ok' });
});

test('an article is public and has words; the owner\'s plain posts stay plain', async () => {
  let calls = platform();
  assert.equal((await post({ body: 'Headline', visibility: 'network', newsroom: true })).status, 400);
  assert.equal(written(calls), undefined);
  calls = platform();
  assert.equal((await post({ body: 'Just me today', visibility: 'public' })).status, 201);
  assert.deepEqual(written(calls).metadata, {});
});

test('a scheduled newsroom post is checked when it is asked for, and keeps its mark in the payload', async () => {
  const calls = platform();
  const at = new Date(Date.now() + 3600e3).toISOString();
  const res = await post({ body: 'Later\n\nStory.', visibility: 'public', newsroom: true, publish_at: at });
  assert.equal(res.status, 201);
  const saved = calls.find((c) => c.u.includes('/network_scheduled_posts') && c.m === 'POST').body;
  assert.equal(saved.payload.metadata.newsroom, true);
});

test('an edit cannot empty a newsroom article; it can be deleted instead', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    calls.push({ u, m });
    if (u.endsWith('/auth/v1/user')) return Response.json({ id: 'user-1' });
    if (u.includes('/m_auth_user_links')) return Response.json([{ m_uid: OWNER }]);
    if (u.includes('/network_posts') && m === 'GET') return Response.json([{ id: A1, author_m_uid: OWNER, body: 'Headline\n\nStory.', visibility: 'public', media: [{ asset_id: 'x' }], metadata: { newsroom: true } }]);
    if (u.includes('/rpc/')) return Response.json(true);
    return Response.json([]);
  };
  const res = await handlePlatformApi(new Request(`https://api.test/v1/mnet/posts/${A1}?app_key=mccluster-web`, {
    method: 'PATCH', headers: { authorization: 'Bearer user', 'content-type': 'application/json' }, body: JSON.stringify({ body: '  ' }) }), ENV)
    .catch((e) => new Response(JSON.stringify({ error: e.message }), { status: e.status || 500 }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /needs words/);
  assert.equal(calls.filter((c) => c.u.includes('/network_posts') && c.m === 'PATCH').length, 0, 'nothing is written');
});
