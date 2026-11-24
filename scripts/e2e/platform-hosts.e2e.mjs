#!/usr/bin/env node
/* THE CRAWL (SPEC-PLATFORM section 9, made a suite; the acceptance of every stage in section 4).

   Every classified path on every host of the site, one GET each (a redirect is recorded, never followed): its status,
   its Location, the canonical, og:url, og:site_name and robots meta of a page that answers, and the headers SPEC-PLATFORM
   2.4 names (content-security-policy and its report-only twin, x-frame-options, strict-transport-security,
   permissions-policy, x-robots-tag). The hosts and paths come from the one table (data/seo/domain-architecture.json
   through workers/mccluster/src/platform/hosts.generated.js): the platform, its tenants and its doors; every page of
   url_ownership and the deploy-promoted /site0/; the platform's own paths; the files on both hosts; World queries; a
   query kept; directories asked for without their slash; a page that does not exist; plain http.

     node scripts/e2e/platform-hosts.e2e.mjs [--out <file.json>]
         LOCAL (CI; no internet): this tree's published files served the way GitHub Pages serves them (measured), Worker
         mccluster's host routers run in-process on them (companySiteResponse, then humanUpriseResponse, as
         workers/mccluster/src/entry-platform.js calls them, with wrangler.toml's [vars]), the zone's redirect rule for
         here.mccluster.org and an inert door that does not resolve, as the table's stage says each host is served. It
         fails when any host and path answers differently from the answers measured on production before P0
         (scripts/e2e/fixtures/platform-hosts-20261123.json), apart from what that file names as the live edge's alone
         (Cloudflare's managed robots.txt and its plain-http redirects) or as built at deploy (/site0/); when the platform
         passes a page through with a head other than the file's own; or when a classified page does not answer 200 where
         the table says it is served. A file this tree adds that production does not have yet (404 there, 200 here) is
         listed, not failed.

     PLATFORM_HOSTS_LIVE=1 node scripts/e2e/platform-hosts.e2e.mjs --out <file.json> [--baseline <file.json>]
         LIVE (opt-in; never in pull-request CI): the production hosts, GET only, nobody signed in, four requests at a
         time. Writes the crawl to --out; with --baseline, compares it and exits 1 on any difference.

     node scripts/e2e/platform-hosts.e2e.mjs --diff <before.json> <after.json>
         Compares two crawls already written (either mode).

     node scripts/e2e/platform-hosts.e2e.mjs --write-fixture <live.json>
         Rewrites the fixture from a live crawl (the comparable fields only). Only from a live crawl, never by hand.

   Nothing here changes anything anywhere: no POST, no sign-in, no DNS, no settings. */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, extname, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCHEMA = 'mccluster-platform-hosts-crawl/v1';
export const FIXTURE_SCHEMA = 'mccluster-platform-hosts-fixture/v1';
export const FIXTURE = 'scripts/e2e/fixtures/platform-hosts-20261123.json';
/* the headers SPEC-PLATFORM 2.4 names, compared; cache-control and content-type are recorded for the reader only */
export const COMPARED_HEADERS = Object.freeze(['content-security-policy', 'content-security-policy-report-only', 'x-frame-options',
  'strict-transport-security', 'permissions-policy', 'x-robots-tag']);
export const RECORDED_HEADERS = Object.freeze([...COMPARED_HEADERS, 'cache-control', 'content-type']);
export const ROUTING_FIELDS = Object.freeze(['status', 'location', 'error']);
export const HEAD_FIELDS = Object.freeze(['canonical', 'og_url', 'og_site_name', 'robots']);
export const COMPARED_FIELDS = Object.freeze([...ROUTING_FIELDS, ...HEAD_FIELDS]);
const UA = 'mccluster-platform-crawl (read-only; GET only)';

/* ---------- what is crawled: the table's hosts, every classified path ---------- */

export async function loadSite(root = ROOT) {
  return (await import(pathToFileURL(join(root, 'workers/mccluster/src/platform/hosts.generated.js')).href)).SITE;
}

/* paths that are not pages but that a stage must keep answering the same way */
export const EXTRA_PATHS = Object.freeze([
  /* the World and its queries (SPEC-PLATFORM 6, risk 19: /index.html with and without ?view=feed) */
  '/?view=feed', '/index.html?view=feed', '/mnet.html', '/mnet.html?view=feed',
  /* a query is kept on every redirect */
  '/album.html?album=here', '/listen.html?from=crawl',
  /* the platform's own paths with and without their slash */
  '/company/', '/news',
  /* directories asked for without their slash (SPEC-PLATFORM 2.4, risk 8) */
  '/engineering', '/action', '/whip', '/walls', '/auth',
  /* the files on both hosts, one of each kind */
  '/embed.html?album=here', '/js/tabbar.js', '/js/shell-boot.js', '/css/style.css', '/assets/img/icon-192.png',
  '/data/albums.json', '/vendor/gsap.min.js', '/.well-known/security.txt',
  /* a page that does not exist stays a 404 where it is one today */
  '/nope.html'
]);

export function crawlPlan(site) {
  const pages = ['platform', 'profile', 'profile_only'].flatMap((set) => site.pages[set]);
  const own = [...site.platform.own_paths.generated, ...site.platform.own_paths.subtrees.map((p) => p + '/')];
  const paths = [...new Set([...pages, ...site.promoted.map((d) => d.prefix), ...own, ...site.both_hosts.paths, ...EXTRA_PATHS])];
  const hosts = [site.platform.host, ...site.tenants.map((t) => t.host), ...site.doors.map((d) => d.host)];
  return { hosts: [...new Set(hosts)], paths };
}

export function crawlUrls(plan) {
  const urls = [];
  for (const host of plan.hosts) {
    urls.push(`http://${host}/`);
    for (const p of plan.paths) urls.push(`https://${host}${p}`);
  }
  return urls;
}

/* ---------- one answer, read the same way in both modes ---------- */

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'" };
const decode = (s) => String(s).replace(/&(amp|quot|apos|lt|gt|#39);/g, (_, k) => ENTITIES[k]);
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decode(m[3] !== undefined ? m[3] : m[4]);
  return out;
}
/* the canonical, share card and robots meta of a document (in its head; the first of each) */
export function headOf(html) {
  const head = String(html).split(/<\/head>/i)[0];
  const out = { canonical: null, og_url: null, og_site_name: null, robots: null };
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (out.canonical === null && String(a.rel || '').toLowerCase().split(/\s+/).includes('canonical')) out.canonical = a.href || '';
  }
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const prop = String(a.property || a.name || '').toLowerCase();
    if (prop === 'og:url' && out.og_url === null) out.og_url = a.content || '';
    else if (prop === 'og:site_name' && out.og_site_name === null) out.og_site_name = a.content || '';
    else if (prop === 'robots' && out.robots === null) out.robots = a.content || '';
  }
  return out;
}

export async function readAnswer(url, response) {
  const headers = {};
  for (const h of RECORDED_HEADERS) {
    const v = response.headers.get(h);
    if (v !== null) headers[h] = v;
  }
  const row = { url, status: response.status, location: response.headers.get('location'), error: null, headers };
  if (response.status === 200 && /text\/html/i.test(String(response.headers.get('content-type') || ''))) Object.assign(row, headOf(await response.text()));
  else {
    Object.assign(row, { canonical: null, og_url: null, og_site_name: null, robots: null });
    try { if (response.body && response.body.cancel) await response.body.cancel(); } catch { /* already read */ }
  }
  return row;
}

export function errorRow(url, error) {
  const cause = error && error.cause;
  const code = (cause && (cause.code || cause.message)) || (error && (error.code || error.message)) || 'failed';
  return { url, status: null, location: null, error: String(code), headers: {}, canonical: null, og_url: null, og_site_name: null, robots: null };
}

export async function crawl(urls, fetchOne, { concurrency = 4, pauseMs = 0, onRow = null } = {}) {
  const rows = new Array(urls.length);
  let next = 0;
  async function lane() {
    while (next < urls.length) {
      const i = next++;
      const url = urls[i];
      let row;
      try {
        row = await readAnswer(url, await fetchOne(url));
      } catch (e) {
        row = errorRow(url, e);
      }
      rows[i] = row;
      if (onRow) onRow(row, i);
      if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, lane));
  return rows;
}

/* ---------- comparing two crawls ---------- */

export function comparable(row, fields = COMPARED_FIELDS, headers = COMPARED_HEADERS) {
  const out = {};
  for (const f of fields) out[f] = row[f] === undefined ? null : row[f];
  for (const h of headers) out[h] = (row.headers && row.headers[h] !== undefined) ? row.headers[h] : null;
  return out;
}

/* every url whose comparable answer differs, appeared or went away */
export function diffCrawls(before, after, { only = null, fields = COMPARED_FIELDS, headers = COMPARED_HEADERS } = {}) {
  const a = new Map(before.rows.map((r) => [r.url, r]));
  const b = new Map(after.rows.map((r) => [r.url, r]));
  const out = [];
  for (const url of new Set([...a.keys(), ...b.keys()])) {
    if (only && !only(url)) continue;
    const x = a.get(url), y = b.get(url);
    if (!x || !y) { out.push({ url, change: x ? 'gone' : 'new' }); continue; }
    const cx = comparable(x, fields, headers), cy = comparable(y, fields, headers);
    const changed = Object.keys(cx).filter((k) => cx[k] !== cy[k]);
    if (changed.length) out.push({ url, change: 'differs', fields: Object.fromEntries(changed.map((k) => [k, { before: cx[k], after: cy[k] }])) });
  }
  return out.sort((p, q) => (p.url < q.url ? -1 : p.url > q.url ? 1 : 0));
}

export function summarize(result) {
  const byHost = {};
  for (const r of result.rows) {
    const host = new URL(r.url).host;
    const h = (byHost[host] ||= { total: 0, status: {} });
    h.total += 1;
    const k = r.error ? `error:${r.error}` : String(r.status);
    h.status[k] = (h.status[k] || 0) + 1;
  }
  return byHost;
}

/* ---------- live: the production hosts, GET only ---------- */

export async function liveCrawl(site, { concurrency = 4, pauseMs = 150, log = null } = {}) {
  const plan = crawlPlan(site);
  const urls = crawlUrls(plan);
  const fetchOne = (url) => fetch(url, {
    method: 'GET', redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    signal: AbortSignal.timeout(30000)
  });
  let done = 0;
  const rows = await crawl(urls, fetchOne, {
    concurrency, pauseMs,
    onRow: () => { done += 1; if (log && done % 100 === 0) log(`${done}/${urls.length}`); }
  });
  return { schema: SCHEMA, mode: 'live', captured_at: new Date().toISOString(), stage: site.stage, record: site.record, hosts: plan.hosts, paths: plan.paths.length, rows };
}

/* ---------- the fixture: production's answers before P0, the comparable fields only ---------- */

/* What only the live edge answers, so a local crawl cannot: Cloudflare's managed robots.txt on the zone's other hosts
   (200 with a stray Location, 2026-11-23) and its plain-http redirects on the zone's proxied hosts. */
export function edgeOnly(site, url) {
  const u = new URL(url);
  const role = site.hostRole(u.hostname);
  const zone = role && (role.role === 'platform' || (role.role === 'door' && /^routed/.test(String(site.doors.find((d) => d.host === u.hostname).state))));
  if (!zone) return null;
  if (u.protocol === 'http:') return 'plain http on a proxied host: answered by the Cloudflare edge before the Worker or the zone rule';
  if (role.role === 'door' && u.pathname === '/robots.txt') return 'robots.txt on a door: Cloudflare\'s managed robots.txt answers it (200, with a stray Location)';
  return null;
}
/* built into the published tree at deploy (url_ownership.promoted_at_deploy), not in this checkout */
export function deployOnly(site, url) {
  const p = new URL(url).pathname;
  return site.promoted.some((d) => p.indexOf(d.prefix) === 0) ? `${p}: promoted into the published tree at deploy, not in this checkout` : null;
}

export function fixtureFrom(live, site) {
  if (!live || live.schema !== SCHEMA || live.mode !== 'live') throw new Error('the fixture is written only from a live crawl');
  const rows = live.rows.map((r) => {
    const c = comparable(r);
    const out = { url: r.url };
    for (const [k, v] of Object.entries(c)) if (v !== null) out[k] = v;
    return out;
  });
  const edge = {};
  for (const r of live.rows) {
    const why = edgeOnly(site, r.url) || deployOnly(site, r.url);
    if (why) edge[r.url] = why;
  }
  return {
    schema: FIXTURE_SCHEMA,
    _source: 'Production\'s answers before P0, read by `PLATFORM_HOSTS_LIVE=1 node scripts/e2e/platform-hosts.e2e.mjs` (GET only, nobody signed in) and reduced to the compared fields by --write-fixture. Regenerate only from a new live crawl; never by hand.',
    captured_at: live.captured_at,
    stage: live.stage,
    hosts: live.hosts,
    edge_only: edge,
    rows
  };
}

/* ---------- local: this tree, served the way production serves it today ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.wasm': 'application/wasm'
};

/* what deploy-pages.yml publishes: the tree minus its one "rm -rf" strip line, minus dot files */
export function publishedFilter(root = ROOT) {
  const joined = readFileSync(join(root, '.github/workflows/deploy-pages.yml'), 'utf8').replace(/\\\n\s*/g, ' ');
  const lines = joined.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('rm -rf ') && !l.includes('$'));
  if (lines.length !== 1) throw new Error('deploy-pages.yml strips with one rm -rf line');
  const strip = lines[0].slice('rm -rf '.length).split(/\s+/).filter(Boolean);
  return (rel) => {
    const parts = rel.split('/');
    if (parts.some((p) => p.startsWith('.') || p === 'node_modules')) return false;
    return !strip.some((s) => rel === s || rel.startsWith(s + '/'));
  };
}

/* GitHub Pages as measured on 2026-11-23 for this site: a published file answers 200; a directory with its slash
   answers its index.html; a name without an extension answers name.html when that file exists, else a directory asked
   for without its slash answers 301 to the slash on the same host; anything else 404 with the site's 404.html; plain
   http answers 301 to https. The query never matters. */
export function githubPages(root = ROOT) {
  const published = publishedFilter(root);
  const fileAt = (rel) => {
    if (!rel || !published(rel)) return null;
    const abs = join(root, rel);
    if (!normalize(abs).startsWith(normalize(root) + sep)) return null;
    return existsSync(abs) && statSync(abs).isFile() ? abs : null;
  };
  const dirAt = (rel) => {
    if (!rel || !published(rel)) return null;
    const abs = join(root, rel);
    return existsSync(abs) && statSync(abs).isDirectory() && fileAt(rel + '/index.html') ? abs : null;
  };
  const answer = (status, abs, extra = {}) => new Response(abs ? readFileSync(abs) : null, {
    status, headers: { 'content-type': abs ? (MIME[extname(abs).toLowerCase()] || 'application/octet-stream') : 'text/html; charset=utf-8', 'cache-control': 'max-age=600', ...extra }
  });
  return function serve(url) {
    const u = new URL(url);
    if (u.protocol === 'http:') return new Response(null, { status: 301, headers: { location: `https://${u.host}${u.pathname}${u.search}`, 'content-type': 'text/html' } });
    let path;
    try { path = decodeURIComponent(u.pathname); } catch { return answer(404, fileAt('404.html')); }
    const rel = path.replace(/^\/+/, '');
    if (rel.split('/').includes('..')) return answer(404, fileAt('404.html'));
    if (rel === '' || path.endsWith('/')) {
      const idx = fileAt(rel + (rel && !rel.endsWith('/') ? '/' : '') + 'index.html');
      return idx ? answer(200, idx) : answer(404, fileAt('404.html'));
    }
    const exact = fileAt(rel);
    if (exact) return answer(200, exact);
    if (!extname(rel)) {
      const html = fileAt(rel + '.html');
      if (html) return answer(200, html);
      if (dirAt(rel)) return new Response(null, { status: 301, headers: { location: `https://${u.host}${path}/`, 'content-type': 'text/html' } });
    }
    return answer(404, fileAt('404.html'));
  };
}

/* the Worker's [vars] as deployed (wrangler.toml), plus fake secrets for what the host routers read */
export function workerEnv(root = ROOT) {
  const toml = readFileSync(join(root, 'workers/mccluster/wrangler.toml'), 'utf8');
  const block = (toml.split(/^\[vars\]\s*$/m)[1] || '').split(/^\[/m)[0];
  const env = {};
  for (const m of block.matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"\s*$/gm)) env[m[1]] = m[2];
  env.SUPABASE_URL = 'https://supabase.local-crawl.invalid';
  env.SUPABASE_SERVICE_ROLE_KEY = 'local-crawl-fixture-not-a-key';
  return env;
}

/* Worker mccluster's host routers, in-process, as entry-platform.js calls them before the API */
export async function workerHosts(root = ROOT) {
  const { companySiteResponse } = await import(pathToFileURL(join(root, 'workers/mccluster/src/company-site/router.js')).href);
  const { humanUpriseResponse } = await import(pathToFileURL(join(root, 'workers/mccluster/src/human-uprise/router.js')).href);
  return async (request, env, upstream) => (await companySiteResponse(request, env, upstream)) || (await humanUpriseResponse(request, env, upstream));
}

class NotFound extends Error {
  constructor(host) { super(`getaddrinfo ENOTFOUND ${host}`); this.cause = { code: 'ENOTFOUND' }; }
}

/* the local internet: each host answered the way the table's stage says it is served */
export async function localFetcher(site, { root = ROOT } = {}) {
  const pages = githubPages(root);
  const env = workerEnv(root);
  const worker = await workerHosts(root);
  /* what the Worker's own fetch reaches: the static origin (GitHub Pages) and Supabase for the news (no posts) */
  const upstream = async (input, init = {}) => {
    const req = input instanceof Request ? input : new Request(input, init);
    let url = req.url;
    if (url.startsWith(env.SUPABASE_URL + '/')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    const origin = new URL(url).origin;
    if (origin !== site.platform.static_origin) throw new Error(`local crawl: the Worker fetched ${origin}, which this crawl does not serve`);
    for (let hops = 0; hops < 6; hops += 1) {
      const res = pages(url);
      if (req.redirect === 'manual' || res.status < 300 || res.status > 399 || !res.headers.get('location')) return res;
      url = new URL(res.headers.get('location'), url).href;
      if (new URL(url).origin !== site.platform.static_origin) throw new Error(`local crawl: GitHub redirected to ${url}`);
    }
    throw new Error('local crawl: too many redirects');
  };
  return async function fetchOne(url) {
    const u = new URL(url);
    const role = site.hostRole(u.hostname);
    if (!role) throw new NotFound(u.hostname);
    if (role.role === 'tenant') {
      if (!site.switches.profile_host_routed) return pages(url);
      return (await worker(new Request(url), env, upstream)) || new Response(null, { status: 404 });
    }
    if (role.role === 'door') {
      const door = site.doors.find((d) => d.host === u.hostname);
      if (!/^routed/.test(String(door.state))) throw new NotFound(u.hostname);
      if (door.served_by === 'cloudflare-zone-redirect-rule') {
        return new Response(null, { status: 301, headers: { location: `${door.to_origin}${u.pathname}${u.search}`, 'content-type': 'text/html; charset=UTF-8' } });
      }
    }
    const res = await worker(new Request(url), env, upstream);
    if (!res) throw new Error(`local crawl: Worker mccluster answered nothing for ${url}`);
    return res;
  };
}

export async function localCrawl(site, { root = ROOT } = {}) {
  const plan = crawlPlan(site);
  const rows = await crawl(crawlUrls(plan), await localFetcher(site, { root }), { concurrency: 8 });
  return { schema: SCHEMA, mode: 'local', captured_at: new Date().toISOString(), stage: site.stage, record: site.record, hosts: plan.hosts, paths: plan.paths.length, rows };
}

/* What a local crawl must show against the fixture. Returns { failures, added, skipped, compared }. */
export function judgeLocal(local, fixture, site) {
  const failures = [], added = [], skipped = [];
  const fx = new Map(fixture.rows.map((r) => [r.url, r]));
  const loc = new Map(local.rows.map((r) => [r.url, r]));
  const profile = site.profile.host;
  let compared = 0;
  for (const row of local.rows) {
    const why = fixture.edge_only[row.url] || edgeOnly(site, row.url) || deployOnly(site, row.url);
    if (why) { skipped.push({ url: row.url, why }); continue; }
    const want = fx.get(row.url);
    if (!want) { failures.push({ url: row.url, problem: 'not in the fixture: rewrite it from a live crawl' }); continue; }
    compared += 1;
    const have = comparable(row);
    const host = new URL(row.url).hostname;
    /* a file this tree adds that production has not published yet */
    if (want.status === 404 && have.status === 200 && host === profile) { added.push(row.url); continue; }
    for (const f of [...ROUTING_FIELDS, ...COMPARED_HEADERS]) {
      const w = want[f] === undefined ? null : want[f];
      if (have[f] !== w) failures.push({ url: row.url, problem: `${f}: production answered ${JSON.stringify(w)}, this tree ${JSON.stringify(have[f])}` });
    }
  }
  /* the platform passes a page through with the file's own head; only the World's root carries the platform's head */
  for (const row of local.rows) {
    const u = new URL(row.url);
    if (u.protocol !== 'https:' || u.hostname !== site.platform.host || row.status !== 200 || u.pathname === site.world.root) continue;
    if (site.ownPathOrigin(u.pathname)) continue;
    const mirror = loc.get(`https://${profile}${u.pathname}${u.search}`);
    if (!mirror || mirror.status !== 200) continue;
    for (const f of HEAD_FIELDS) if (row[f] !== mirror[f]) failures.push({ url: row.url, problem: `${f}: the platform's copy says ${JSON.stringify(row[f])}, the file says ${JSON.stringify(mirror[f])}` });
  }
  /* every classified page answers 200 on the host that serves it at this stage */
  for (const set of ['platform', 'profile', 'profile_only']) {
    for (const p of site.pages[set]) {
      const url = site.siteUrl(p);
      const row = loc.get(url);
      if (!row) { failures.push({ url, problem: `${p} (${set}) was not crawled` }); continue; }
      if (row.status !== 200) failures.push({ url, problem: `${p} (${set}): the table says ${site.servingOrigin(p)} serves it, and it answered ${row.status || row.error}` });
    }
  }
  return { failures, added, skipped, compared };
}

/* ---------- the command ---------- */

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] || null;
}
export function readCrawl(file) {
  const v = JSON.parse(readFileSync(file, 'utf8'));
  if (!v || v.schema !== SCHEMA || !Array.isArray(v.rows)) throw new Error(`${file} is not a ${SCHEMA} crawl`);
  return v;
}
export function readFixture(root = ROOT) {
  const v = JSON.parse(readFileSync(join(root, FIXTURE), 'utf8'));
  if (!v || v.schema !== FIXTURE_SCHEMA || !Array.isArray(v.rows)) throw new Error(`${FIXTURE} is not a ${FIXTURE_SCHEMA} fixture`);
  return v;
}
function printDiff(diffs, out = console.log) {
  for (const d of diffs) {
    if (d.change !== 'differs') { out(`${d.change.padEnd(7)} ${d.url}`); continue; }
    out(`differs ${d.url}`);
    for (const [k, v] of Object.entries(d.fields)) out(`        ${k}: ${JSON.stringify(v.before)} -> ${JSON.stringify(v.after)}`);
  }
}

async function main(argv) {
  const diffAt = argv.indexOf('--diff');
  if (diffAt !== -1) {
    const before = readCrawl(argv[diffAt + 1]), after = readCrawl(argv[diffAt + 2]);
    const diffs = diffCrawls(before, after);
    printDiff(diffs);
    console.log(`${diffs.length} difference(s) between ${before.rows.length} and ${after.rows.length} answers`);
    return diffs.length ? 1 : 0;
  }
  const site = await loadSite();
  const fixtureFromLive = arg(argv, '--write-fixture');
  if (fixtureFromLive) {
    const fixture = fixtureFrom(readCrawl(fixtureFromLive), site);
    writeFileSync(join(ROOT, FIXTURE), JSON.stringify(fixture, null, 1) + '\n');
    console.log(`wrote ${FIXTURE}: ${fixture.rows.length} answers, ${Object.keys(fixture.edge_only).length} the live edge's alone`);
    return 0;
  }
  if (process.env.PLATFORM_HOSTS_LIVE === '1') {
    /* production is read by a person who asked for it, never by a pull request's checks */
    if (process.env.GITHUB_EVENT_NAME === 'pull_request' || process.env.GITHUB_EVENT_NAME === 'pull_request_target') {
      console.error('live mode is never run for a pull request; the local crawl is the check there');
      return 2;
    }
    const out = arg(argv, '--out');
    if (!out) { console.error('live mode needs --out <file.json> (the crawl is written there)'); return 2; }
    const result = await liveCrawl(site, { log: (m) => console.error(`  ${m}`) });
    writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
    console.log(`live crawl: ${result.rows.length} answers from ${result.hosts.length} hosts written to ${out}`);
    for (const [host, s] of Object.entries(summarize(result))) console.log(`  ${host}: ${JSON.stringify(s.status)}`);
    const baseline = arg(argv, '--baseline');
    if (!baseline) return 0;
    const diffs = diffCrawls(readCrawl(baseline), result);
    printDiff(diffs);
    console.log(`${diffs.length} difference(s) against ${baseline}`);
    return diffs.length ? 1 : 0;
  }
  const local = await localCrawl(site);
  const out = arg(argv, '--out');
  if (out) writeFileSync(out, JSON.stringify(local, null, 1) + '\n');
  const verdict = judgeLocal(local, readFixture(), site);
  for (const [host, s] of Object.entries(summarize(local))) console.log(`  ${host}: ${JSON.stringify(s.status)}`);
  for (const a of verdict.added) console.log(`added   ${a} (this tree publishes it; production does not yet)`);
  for (const f of verdict.failures) console.log(`FAIL    ${f.url}: ${f.problem}`);
  console.log(`local crawl at stage ${site.stage}: ${local.rows.length} answers, ${verdict.compared} compared with production's of ${readFixture().captured_at}, ` +
    `${verdict.skipped.length} the live edge's or built at deploy, ${verdict.added.length} added, ${verdict.failures.length} failure(s)`);
  return verdict.failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e && e.stack || e); process.exitCode = 1; });
}
