/* McCLUSTER CORP NEWS, on the company's own host (mccluster.org/news/).

   Owner, 2026-10-20: "getting my admin's posts as their own news worth posts
   and getting them published on GDELT". A post the house owner marks
   "Publish to the newsroom" when they post it (platform-api.js checks they
   are the owner) is also an article here: its own page, server-rendered for
   crawlers that do not run scripts (GDELT reads the HTML), with NewsArticle
   structured data, an RSS feed and a Google News sitemap. Nothing else is
   ever an article: the owner's other posts, and every other member's posts,
   stay posts.

   WHO SAYS WHAT (docs/control-plane/DOMAINS-AND-ENTITIES.md). The host is the
   company's, so the publisher is the Organization by its stable @id and the
   site name is McCluster Corp; the author is Matthew McCluster, by his stable
   @id, linked to his page on his own host. The mark is the owner's artwork,
   whole and only scaled.

   The newsroom is the post itself, read through the service role and shown
   only when it is public, live (not deleted, not taken down by the desk), not
   in a group, not a reply, the current house owner's, and bound to the exact
   human-reviewed revision. A withdrawn or edited but unreviewed article answers
   410 Gone. An explicit owner review restores the current revision. Off with NEWSROOM_ENABLED="false": /news/* then 301s
   to the personal host, as every unknown path here does. */
import { hasNewsroomApproval } from '../newsroom-review.js';
import { COMPANY_ORIGIN, PERSONAL_ORIGIN } from './pages.generated.js';
import { moved, methodNotAllowed, SECURITY } from '../world-host.js';

export const NEWS_ROOT = '/news/';
export const PUBLICATION = 'McCluster Corp';
const ORG_ID = 'https://matthew.mccluster.org/#mccluster-corp';
const PERSON_ID = 'https://matthew.mccluster.org/#matthew-mccluster';
const PERSON_URL = 'https://matthew.mccluster.org/matthew-mccluster.html';
const AUTHOR = 'Matthew McCluster';
const SITE_ID = `${COMPANY_ORIGIN}/#website`;
const MARK = 'https://matthew.mccluster.org/assets/img/m-mark.png';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTICLE = /^\/news\/(?:([a-z0-9-]{1,90})-)?([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const HEADLINE_MAX = 110;
const LIST = 30, FEED = 50, SITEMAP = 1000;
/* Google News: a news sitemap names articles from the last two days */
const NEWS_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const COLUMNS = 'id,author_m_uid,body,created_at,updated_at,metadata,visibility,deleted_at,removed_at,group_id,reply_to_id';

export function newsroomEnabled(env) {
  return String(env?.NEWSROOM_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}
export function isNewsPath(path) {
  return path === '/news' || path.startsWith('/news/');
}

/* ---------- words ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* XML has no &#39; trouble, but a stray control character is fatal to a feed reader */
const xml = (s) => esc(String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ''));
const ld = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1), space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}
export function slugify(text) {
  return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}
const longDate = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });

/* A post has no title. Its first line is the headline when it reads like one (short, with more below); otherwise the
   headline is the post's opening, cut at a word, and the whole post is the story. */
export function shapeArticle(row) {
  const text = String(row.body || '').replace(/\r\n?/g, '\n').trim();
  const lines = text.split('\n'), first = lines[0].replace(/^#+\s*/, '').trim();
  let headline, story;
  if (first.length <= HEADLINE_MAX && lines.length > 1) { headline = first; story = lines.slice(1).join('\n').trim(); }
  else if (first.length <= HEADLINE_MAX) { headline = first; story = ''; }
  else { headline = clip((/^(.{20,}?[.!?])\s/.exec(text) || [, text])[1], HEADLINE_MAX); story = text; }
  const slug = slugify(headline);
  const path = `/news/${slug ? slug + '-' : ''}${row.id}`;
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const sources = (Array.isArray(meta.newsroom_sources) ? meta.newsroom_sources : []).map((s) => {
    try {
      const u = new URL(String(s?.url || ''));
      return u.protocol === 'https:' ? { url: u.toString(), title: clip(s.title || u.hostname, 200), domain: u.hostname.replace(/^www\./, '') } : null;
    } catch { return null; }
  }).filter(Boolean).slice(0, 12);
  return {
    id: row.id, headline, path, url: COMPANY_ORIGIN + path,
    paragraphs: story ? story.split(/\n{2,}/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean)).filter((p) => p.length) : [],
    description: clip(story || headline, 200),
    published: new Date(row.created_at).toISOString(),
    modified: new Date(row.updated_at || row.created_at).toISOString(),
    drafted_with_ai: meta.newsroom_note === 'morning_brief',
    sources
  };
}

/* ---------- the store ---------- */
async function rest(env, path, fetchImpl, init = {}) {
  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    accept: 'application/json', 'content-type': 'application/json' } });
  if (!res.ok) throw new Error('newsroom_store_unavailable');
  return res.json();
}
/* the house owner, as the database defines it (mnet_admin_m_uids: the primary identity of the owner's account) */
export async function ownerMuids(env, fetchImpl = fetch) {
  const rows = await rest(env, 'rpc/mnet_admin_m_uids', fetchImpl, { method: 'POST', body: '{}' });
  return (Array.isArray(rows) ? rows : []).map((r) => (typeof r === 'string' ? r : r?.mnet_admin_m_uids)).filter((id) => UUID.test(String(id || '')));
}
const isArticle = (row, owners) => !!row && owners.includes(row.author_m_uid) && row.metadata?.newsroom === true;
/* an article has words: a post edited down to only its media has left the newsroom (410), never an empty page */
const isLive = (row) => row.visibility === 'public' && !row.deleted_at && !row.removed_at && !row.group_id && !row.reply_to_id
  && String(row.body || '').trim() !== '';
async function latest(env, owners, limit, fetchImpl) {
  if (!owners.length) return [];
  const rows = await rest(env, 'network_posts?' + new URLSearchParams({
    author_m_uid: `in.(${owners.join(',')})`, 'metadata->>newsroom': 'eq.true', visibility: 'eq.public',
    deleted_at: 'is.null', removed_at: 'is.null', group_id: 'is.null', reply_to_id: 'is.null',
    select: COLUMNS, order: 'created_at.desc', limit: String(limit)
  }).toString(), fetchImpl);
  const live = (Array.isArray(rows) ? rows : []).filter((r) => isArticle(r, owners) && isLive(r));
  const approvals = await Promise.all(live.map(hasNewsroomApproval));
  return live.filter((_, i) => approvals[i]).map(shapeArticle);
}

/* ---------- the pages ---------- */
const CSS = `
:root{--ink:#0a0807;--ink-2:#15110f;--cream:#f4efe6;--dim:#c9c1b4;--ruby-text:#ff6b6e;--edge:rgba(244,239,230,.14)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ink);color:var(--cream);font:400 1.0625rem/1.7 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--ruby-text)}
a:focus-visible{outline:2px solid var(--ruby-text);outline-offset:3px}
.wrap{max-width:44rem;margin:0 auto;padding:0 16px}
header.top{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;padding:1.1rem 0;min-height:44px}
header.top a.home{display:flex;align-items:center;gap:.75rem;color:var(--cream);text-decoration:none;min-height:44px}
header.top img{width:40px;height:40px}
header.top b{font-size:1rem;letter-spacing:.04em}
header.top a.section{margin-left:auto;display:inline-flex;align-items:center;min-height:44px;font-weight:700;text-decoration:none}
.k{font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;color:var(--dim);font-weight:700;margin:2rem 0 .4rem}
h1{font-weight:850;letter-spacing:-.01em;line-height:1.12;font-size:clamp(1.7rem,6.4vw,2.6rem);margin:.2rem 0 .9rem;overflow-wrap:anywhere}
.by{color:var(--dim);margin:0 0 1.6rem}
article p{margin:0 0 1.1rem;overflow-wrap:anywhere}
.note{color:var(--dim);font-size:.92rem;border-top:1px solid var(--edge);padding-top:1rem;margin-top:1.6rem}
h2{font-weight:800;font-size:1.05rem;margin:1.8rem 0 .5rem}
ol.sources{margin:0;padding-left:1.3em;display:grid;gap:.5rem;font-size:.95rem}
ol.sources li{overflow-wrap:anywhere}
ol.sources span{color:var(--dim);font-size:.85rem}
.go{display:inline-flex;align-items:center;min-height:44px;font-weight:700}
ul.list{list-style:none;margin:1rem 0 0;padding:0;display:grid;gap:.85rem}
ul.list li{border:1px solid var(--edge);border-radius:14px;padding:1rem;background:var(--ink-2);min-width:0}
ul.list a{color:var(--cream);text-decoration:none;font-weight:800;font-size:1.15rem;line-height:1.3;display:block;overflow-wrap:anywhere}
ul.list p{margin:.4rem 0 0;color:var(--dim);font-size:.95rem;overflow-wrap:anywhere}
ul.list time{color:var(--dim);font-size:.8rem;letter-spacing:.08em;text-transform:uppercase}
footer{border-top:1px solid var(--edge);margin-top:3rem;padding:1.4rem 0 2.4rem;color:var(--dim);font-size:.9rem}
footer a{margin-right:1rem;display:inline-block;padding:.6rem 0}
@media (min-width:46rem){.wrap{padding:0 24px}}`.trim();

function page({ title, description, canonical, type = 'website', graph, robots = 'index, follow, max-image-preview:large, max-snippet:-1', body, extraHead = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
${canonical ? `  <link rel="canonical" href="${esc(canonical)}">\n` : ''}  <meta name="robots" content="${robots}">
  <link rel="icon" type="image/png" href="${MARK}">
  <link rel="alternate" type="application/rss+xml" title="${PUBLICATION} News" href="${COMPANY_ORIGIN}/news/feed.xml">
  <meta name="theme-color" content="#0a0807">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="${PUBLICATION}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
${canonical ? `  <meta property="og:url" content="${esc(canonical)}">\n` : ''}  <meta property="og:image" content="${MARK}">
  <meta property="og:image:width" content="256">
  <meta property="og:image:height" content="256">
  <meta property="og:image:alt" content="The McCluster mark">
  <meta name="twitter:card" content="summary">
${extraHead}${graph ? `  <script type="application/ld+json">${ld(graph)}</script>\n` : ''}  <style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <header class="top"><a class="home" href="${COMPANY_ORIGIN}/company"><img src="${MARK}" alt="" width="40" height="40"><b>${PUBLICATION}</b></a><a class="section" href="${NEWS_ROOT}">News</a></header>
    <main id="main">
${body}
    </main>
    <footer>
      <a href="${NEWS_ROOT}">All news</a><a href="${COMPANY_ORIGIN}/news/feed.xml">RSS</a><a href="${COMPANY_ORIGIN}/company">About McCluster Corp</a><a href="${COMPANY_ORIGIN}/">Equity Uprise</a>
      <p>© ${new Date().getUTCFullYear()} ${PUBLICATION}.</p>
    </footer>
  </div>
</body>
</html>
`;
}

export function renderArticle(a) {
  const graph = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    '@id': `${a.url}#article`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': a.url },
    url: a.url,
    headline: a.headline,
    description: a.description,
    datePublished: a.published,
    dateModified: a.modified,
    inLanguage: 'en',
    isPartOf: { '@id': SITE_ID },
    image: [MARK],
    author: { '@type': 'Person', '@id': PERSON_ID, name: AUTHOR, url: PERSON_URL },
    publisher: { '@type': 'Organization', '@id': ORG_ID, name: PUBLICATION, url: `${COMPANY_ORIGIN}/`,
      logo: { '@type': 'ImageObject', url: MARK, width: 256, height: 256 } },
    ...(a.sources.length ? { citation: a.sources.map((s) => ({ '@type': 'CreativeWork', name: s.title, url: s.url })) } : {})
  };
  const extraHead = `  <meta property="article:published_time" content="${a.published}">
  <meta property="article:modified_time" content="${a.modified}">
  <meta property="article:author" content="${PERSON_URL}">
`;
  const body = `      <article>
        <p class="k">News · <time datetime="${a.published}">${esc(longDate(a.published))}</time></p>
        <h1>${esc(a.headline)}</h1>
        <p class="by">By <a href="${PERSON_URL}" rel="author">${AUTHOR}</a></p>
${a.paragraphs.map((p) => `        <p>${p.map(esc).join('<br>')}</p>`).join('\n')}
${a.drafted_with_ai ? `        <p class="note">Drafted with McCluster AI from the day's news headlines, then read, edited and published by ${AUTHOR}. Nothing here is financial advice.</p>\n` : ''}${a.sources.length ? `        <h2>Sources</h2>
        <ol class="sources">
${a.sources.map((s) => `          <li><a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.title)}</a> <span>${esc(s.domain)}</span></li>`).join('\n')}
        </ol>\n` : ''}        <p><a class="go" href="${COMPANY_ORIGIN}/?view=feed&amp;post=${a.id}">Talk about it in the World &#8594;</a></p>
      </article>`;
  return page({ title: `${a.headline} · ${PUBLICATION}`, description: a.description, canonical: a.url, type: 'article', graph, body, extraHead });
}

export function renderIndex(articles) {
  const url = `${COMPANY_ORIGIN}${NEWS_ROOT}`;
  const graph = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': url,
    url,
    name: `News · ${PUBLICATION}`,
    isPartOf: { '@id': SITE_ID },
    publisher: { '@id': ORG_ID },
    mainEntity: { '@type': 'ItemList', itemListElement: articles.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: a.url, name: a.headline })) }
  };
  const body = `      <p class="k">${PUBLICATION}</p>
      <h1>News</h1>
${articles.length ? `      <ul class="list">
${articles.map((a) => `        <li><time datetime="${a.published}">${esc(longDate(a.published))}</time><a href="${a.path}">${esc(a.headline)}</a>${a.description && a.description !== a.headline ? `<p>${esc(a.description)}</p>` : ''}</li>`).join('\n')}
      </ul>` : '      <p>No news yet.</p>'}`;
  return page({ title: `News · ${PUBLICATION}`, description: `News from ${PUBLICATION}, by ${AUTHOR}.`, canonical: url, graph, body });
}

const rfc822 = (iso) => new Date(iso).toUTCString();
export function renderFeed(articles, now = Date.now()) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${PUBLICATION} News</title>
    <link>${COMPANY_ORIGIN}${NEWS_ROOT}</link>
    <description>News from ${PUBLICATION}, by ${AUTHOR}.</description>
    <language>en-us</language>
    <atom:link href="${COMPANY_ORIGIN}/news/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${rfc822(articles[0]?.modified || new Date(now).toISOString())}</lastBuildDate>
${articles.map((a) => `    <item>
      <title>${xml(a.headline)}</title>
      <link>${xml(a.url)}</link>
      <guid isPermaLink="true">${xml(a.url)}</guid>
      <pubDate>${rfc822(a.published)}</pubDate>
      <dc:creator>${AUTHOR}</dc:creator>
      <description>${xml(a.description)}</description>
    </item>`).join('\n')}
  </channel>
</rss>
`;
}

/* Every article, newest first; the ones from the last two days also carry Google News' tags */
export function renderSitemap(articles, now = Date.now()) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>${COMPANY_ORIGIN}${NEWS_ROOT}</loc>${articles[0] ? `
    <lastmod>${articles[0].modified}</lastmod>` : ''}
  </url>
${articles.map((a) => `  <url>
    <loc>${xml(a.url)}</loc>
    <lastmod>${a.modified}</lastmod>${now - Date.parse(a.published) <= NEWS_WINDOW_MS ? `
    <news:news>
      <news:publication><news:name>${PUBLICATION}</news:name><news:language>en</news:language></news:publication>
      <news:publication_date>${a.published}</news:publication_date>
      <news:title>${xml(a.headline)}</news:title>
    </news:news>` : ''}
  </url>`).join('\n')}
</urlset>
`;
}

/* ---------- answers ---------- */
const HTML_HEADERS = {
  ...SECURITY,
  'content-security-policy': "default-src 'none'; img-src https://matthew.mccluster.org; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};
function answer(request, body, { status = 200, type = 'text/html; charset=utf-8', cache = 'no-store' } = {}) {
  return new Response(request.method === 'HEAD' ? null : body, { status, headers: { 'content-type': type, 'cache-control': cache, ...HTML_HEADERS } });
}
function missing(request, status, line) {
  return answer(request, page({ title: `${status === 410 ? 'Removed' : 'Not found'} · ${PUBLICATION}`, description: line, robots: 'noindex',
    body: `      <p class="k">News</p>\n      <h1>${esc(line)}</h1>\n      <p><a class="go" href="${NEWS_ROOT}">All news &#8594;</a></p>` }),
    { status, cache: 'no-store' });
}

export async function newsroomResponse(request, env = {}, fetchImpl = fetch) {
  const url = new URL(request.url), path = url.pathname;
  if (!newsroomEnabled(env)) return moved(`${PERSONAL_ORIGIN}${path}${url.search}`);
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
  if (path === '/news') return moved(`${COMPANY_ORIGIN}${NEWS_ROOT}`);
  const article = ARTICLE.exec(path);
  if (path !== NEWS_ROOT && path !== '/news/feed.xml' && path !== '/news/sitemap.xml' && !article)
    return missing(request, 404, 'There is no article here.');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return missing(request, 503, 'The news is not available right now.');
  try {
    const owners = await ownerMuids(env, fetchImpl);
    if (article) {
      const rows = await rest(env, `network_posts?id=eq.${article[2].toLowerCase()}&select=${COLUMNS}&limit=1`, fetchImpl);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!isArticle(row, owners)) return missing(request, 404, 'There is no article here.');
      if (!isLive(row) || !await hasNewsroomApproval(row)) return missing(request, 410, 'This article has been removed.');
      const a = shapeArticle(row);
      // one address per article: an old or hand-typed slug goes to the current one
      if (path !== a.path) return moved(a.url);
      return answer(request, renderArticle(a));
    }
    if (path === NEWS_ROOT) return answer(request, renderIndex(await latest(env, owners, LIST, fetchImpl)));
    if (path === '/news/feed.xml') return answer(request, renderFeed(await latest(env, owners, FEED, fetchImpl)), { type: 'application/rss+xml; charset=utf-8' });
    return answer(request, renderSitemap(await latest(env, owners, SITEMAP, fetchImpl)), { type: 'application/xml; charset=utf-8' });
  } catch {
    return missing(request, 503, 'The news is not available right now.');
  }
}
