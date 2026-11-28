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
         mccluster's one site router run in-process on them as workers/mccluster/src/entry-platform.js composes it
         (createSiteRouter with the company's parts and the World door's) over the table being crawled, with
         wrangler.toml's [vars], the zone's redirect rule for here.mccluster.org and an inert door that does not
         resolve, as the table's stage says each host is served (scripts/test/platform-hosts-crawl.test.mjs holds the
         composition to entry-platform.js's for every stage's table). It
         fails when any host and path answers differently from the answers measured on production before P0
         (scripts/e2e/fixtures/platform-hosts-20261123.json), apart from what that file names as the live edge's alone
         (Cloudflare's managed robots.txt and its plain-http redirects) or as built at deploy (/site0/); when the platform
         passes a page through with a head other than the file's own; or when a classified page does not answer 200 where
         the table says it is served. A file this tree adds that production does not have yet (404 there, 200 here) is
         listed, not failed. From P1 the platform and its routed doors change on purpose, so they are judged by the
         stage's own rules instead of production's answers before P0 (judgeServesEverything): every public path on the
         platform answers 200 or the same class of answer as on Matthew's host, the World's addresses and the platform's
         own paths as the router says, profile_only 301 to his host and nothing else sends a visitor to a document there,
         the doors send every path to the platform (in one hop: straight to where the platform sends it), another spelling of
         an address answers one 301 to the page it names; every other host is still held to production's answers.

     PLATFORM_HOSTS_LIVE=1 node scripts/e2e/platform-hosts.e2e.mjs --out <file.json> [--baseline <file.json>]
         LIVE (opt-in; never in pull-request CI): the production hosts, GET only, nobody signed in, four requests at a
         time. Writes the crawl to --out; with --baseline, compares it and exits 1 on any difference.

     node scripts/e2e/platform-hosts.e2e.mjs --browser [outDir] [--only <path,path>]
         BROWSER (CI's browser job platform-pages; from P1, a no-op before it): the crawl's browser half. The same
         in-process hosts, in Chromium at 390 px; every page the platform serves (the World at its root, the HERE front
         door, every platform and profile page) is opened there, nobody signed in, and fails if it asks for a document on
         Matthew's host (his carry page aside) or logs an error that the same document opened on his host does not log.
         Writes report.json to outDir.

     node scripts/e2e/platform-hosts.e2e.mjs --diff <before.json> <after.json>
         Compares two crawls already written (either mode).

     node scripts/e2e/platform-hosts.e2e.mjs --write-fixture <live.json>
         Rewrites the fixture from a live crawl (the comparable fields only). Only from a live crawl, never by hand.

     PLATFORM_HOSTS_LIVE=1 node scripts/e2e/platform-hosts.e2e.mjs --amend-fixture
         Reads live (GET only) just the addresses the plan holds and the fixture does not yet, and adds their answers to it,
         dated; refuses once production no longer answers as before P0.

     PLATFORM_HOSTS_LIVE=1 node scripts/e2e/platform-hosts.e2e.mjs --capture-added-page /artist.html --out <new-file.json>
         After P0, capture one newly classified page separately. The stage already judges its own routes. For other
         hosts, record an HTTP GET or, for an inert door, absence of both A and AAAA at two public DNS resolvers.
         Keep each dated observation with the commit introducing the page. Local CI reads it offline.

   Reads only: no POST, sign-in or configuration changes. */
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, extname, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCHEMA = 'mccluster-platform-hosts-crawl/v1';
export const FIXTURE_SCHEMA = 'mccluster-platform-hosts-fixture/v1';
export const FIXTURE = 'scripts/e2e/fixtures/platform-hosts-20261123.json';
/* production's answers for each page published after the frozen fixture, one dated live capture per page
   (--capture-added-page): a page this tree adds is judged against its own capture, never against nothing */
export const ADDED_PAGE_FIXTURES = [
  'scripts/e2e/fixtures/platform-hosts-artist-20261124.json',
  'scripts/e2e/fixtures/platform-hosts-table-read-20261128.json',
];

/* The frozen fixture plus every added page's capture, in order; each is checked by withAddedPage. */
export function withAddedPages(frozen, site, root = ROOT) {
  return ADDED_PAGE_FIXTURES.reduce((fx, file) => withAddedPage(fx, JSON.parse(readFileSync(join(root, file), 'utf8')), site), frozen);
}
const DNS_RESOLVERS = {
  google: 'https://dns.google/resolve',
  cloudflare: 'https://cloudflare-dns.com/dns-query'
};
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
  /* the World and its queries, and the old root document name with and without one (SPEC-PLATFORM 6, risk 19: from P1 a
     bare /index.html on the platform is the HERE front door, and with ?view=feed still the World) */
  '/?view=feed', '/index.html', '/index.html?view=feed', '/mnet.html', '/mnet.html?view=feed',
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
  '/nope.html',
  /* another spelling of an address, which GitHub Pages answers with the page it names (Measured live 2026-11-24 for the
     P1 review): from P1 the platform reads an address the same way, so each is one 301 to that page where it lives
     (Whip Equipped's and the owner's own to Matthew's host, the World's to its root) */
  '//whip.html', '/whip%2Ehtml', '/%77hip.html', '/whip/rider/operator', '/whip/rider', '/prayer-closet', '/fbi', '/closet/sent',
  '/mnet', '/mnet?view=feed', '//mnet.html', '/index', '/index?view=feed', '//index.html?view=feed', '/listen', '//album.html?album=here'
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

/* every url whose comparable answer differs, appeared or went away. What is compared is what a host answered (status,
   Location, the head, the headers): a host that answered nothing in both crawls (an inert door that does not resolve) is
   no difference, whatever words each failed lookup came back with ("ENOTFOUND" once, "Request was cancelled." the next) */
export function diffCrawls(before, after, { only = null, fields = COMPARED_FIELDS, headers = COMPARED_HEADERS } = {}) {
  const a = new Map(before.rows.map((r) => [r.url, r]));
  const b = new Map(after.rows.map((r) => [r.url, r]));
  const out = [];
  for (const url of new Set([...a.keys(), ...b.keys()])) {
    if (only && !only(url)) continue;
    const x = a.get(url), y = b.get(url);
    if (!x || !y) { out.push({ url, change: x ? 'gone' : 'new' }); continue; }
    const cx = comparable(x, fields, headers), cy = comparable(y, fields, headers);
    if (cx.error && cy.error && 'error' in cx) { cx.error = 'unanswered'; cy.error = 'unanswered'; }
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

export async function liveCrawl(site, { concurrency = 4, pauseMs = 150, log = null, only = null } = {}) {
  const plan = crawlPlan(site);
  const urls = crawlUrls(plan).filter((u) => !only || only(u));
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

/* A host without an address cannot send an HTTP response. Keep a resolver's negative answer distinct from the
   transport gateway's own error page. A timeout, truncated reply, CNAME, or resolver failure proves no such thing. */
export function absentAddress(reply, host, type) {
  const question = reply.Question || [];
  if (reply.TC || question.length !== 1 || question[0].name?.replace(/\.$/, '') !== host ||
      question[0].type !== ({ A: 1, AAAA: 28 })[type] || reply.Answer?.length ||
      !reply.Authority?.some((r) => r.type === 6) || ![0, 3].includes(reply.Status)) {
    throw new Error(`No conclusive negative DNS answer for ${host} ${type}`);
  }
  return reply.Status === 3 ? 'NXDOMAIN' : 'NODATA';
}

async function captureInertDoor(url) {
  const host = new URL(url).hostname;
  const dns = {};
  for (const [name, endpoint] of Object.entries(DNS_RESOLVERS)) {
    dns[name] = {};
    for (const type of ['A', 'AAAA']) {
      const res = await fetch(`${endpoint}?name=${host}&type=${type}`, {
        headers: { accept: 'application/dns-json' }, redirect: 'error', signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) throw new Error(`${name} returned HTTP ${res.status} for ${host} ${type}`);
      dns[name][type] = absentAddress(await res.json(), host, type);
    }
  }
  return { url, dns };
}

async function captureAddedPage(site, path, frozen) {
  if (site.stage === 'P0' || !Object.values(site.pages).some((paths) => paths.includes(path))) {
    throw new Error('Supply a classified page added after P0');
  }
  const addresses = crawlUrls(crawlPlan(site)).filter((url) => new URL(url).pathname === path &&
    !stageJudged(site, new URL(url).hostname));
  if (!addresses.length || frozen.rows.some((row) => addresses.includes(row.url))) {
    throw new Error('Capture only a newly classified page absent from the original fixture');
  }
  const inert = addresses.filter((url) => site.doors.some((d) => d.host === new URL(url).hostname && /^inert\b/.test(d.state)));
  const live = await liveCrawl(site, { only: (url) => addresses.includes(url) && !inert.includes(url) });
  const rows = fixtureFrom(live, site).rows;
  for (const row of rows) {
    if (row.error || row.status < 200 || row.status >= 500) throw new Error(`No origin observation for ${row.url}: ${row.status || row.error}`);
  }
  rows.push(...await Promise.all(inert.map(captureInertDoor)));
  const observation = { stage: site.stage, captured_at: new Date().toISOString(), path, rows };
  withAddedPage(frozen, observation, site);
  return observation;
}

/* The original snapshot and its date stay intact. Only append evidence for a distinct page the current plan covers. */
export function withAddedPage(frozen, observation, site) {
  if (!observation || !Object.values(site.pages).some((paths) => paths.includes(observation.path)) ||
      !observation.captured_at || observation.stage === 'P0') throw new Error('Invalid post-P0 page observation');
  const known = new Set(frozen.rows.map((row) => row.url));
  const planned = new Set(crawlUrls(crawlPlan(site)).filter((url) => new URL(url).pathname === observation.path));
  for (const row of observation.rows) {
    if (!planned.has(row.url) || known.has(row.url)) throw new Error(`Unexpected or duplicate observation: ${row.url}`);
    known.add(row.url);
    if (row.dns) {
      const host = new URL(row.url).hostname;
      const results = Object.keys(DNS_RESOLVERS).flatMap((name) => ['A', 'AAAA'].map((type) => row.dns[name]?.[type]));
      if (!site.doors.some((d) => d.host === host && /^inert\b/.test(d.state)) ||
          new Set(results).size !== 1 || !['NODATA', 'NXDOMAIN'].includes(results[0])) {
        throw new Error(`Missing corroborated address absence for ${host}`);
      }
    }
  }
  return { ...frozen, rows: [...frozen.rows, ...observation.rows] };
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

/* the fixture amended with the answers of a live crawl of the addresses it does not hold yet (the crawl's plan grew: V-2
   of the P0 verification added a bare /index.html on every host). Only from a live crawl, never by hand; the rows it held
   keep their answers and their date, and the amendment says when the new ones were read. */
export function amendFixture(fixture, live, site) {
  if (!live || live.schema !== SCHEMA || live.mode !== 'live') throw new Error('the fixture is amended only from a live crawl');
  const have = new Set(fixture.rows.map((r) => r.url));
  const rows = [], edge = {};
  for (const r of live.rows) {
    if (have.has(r.url)) continue;
    const c = comparable(r);
    const out = { url: r.url };
    for (const [k, v] of Object.entries(c)) if (v !== null) out[k] = v;
    rows.push(out);
    const why = edgeOnly(site, r.url) || deployOnly(site, r.url);
    if (why) edge[r.url] = why;
  }
  return {
    ...fixture,
    edge_only: { ...fixture.edge_only, ...edge },
    amended: [...(fixture.amended || []), { captured_at: live.captured_at, urls: rows.map((r) => r.url),
      _note: 'Addresses the crawl\'s plan gained after the fixture was read, read live (GET only, nobody signed in) by --amend-fixture while production still answered as before P0.' }],
    rows: [...fixture.rows, ...rows]
  };
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

/* Cloudflare's URL normalization, through which the zone's own rules read an address (the redirect rule of
   here.mccluster.org: Measured 2026-11-24, it answered //whip.html, /whip%2Ehtml and /%77hip.html each with a 301 to
   https://matthew.mccluster.org/whip.html): backslashes as slashes, repeated slashes as one, escaped unreserved characters
   decoded and other escapes in upper case (developers.cloudflare.com/rules/normalization/how-it-works). The Worker reads
   the address as it was sent (Measured the same day: mccluster.org answered //whip.html with a Location of
   https://matthew.mccluster.org//whip.html), so this is the zone rule's alone. */
export function cloudflareNormalized(path) {
  return String(path).replace(/\\/g, '/').replace(/\/{2,}/g, '/')
    .replace(/%([0-9a-fA-F]{2})/g, (m, hex) => { const c = String.fromCharCode(parseInt(hex, 16)); return /[A-Za-z0-9\-._~]/.test(c) ? c : '%' + hex.toUpperCase(); });
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

/* Worker mccluster's site router, in-process, composed as entry-platform.js composes it before the API
   (createSiteRouter({ company: COMPANY_PARTS, worldDoor: WORLD_DOOR_PARTS })), over the table being crawled: the
   shipped one by default, or a later stage's, so each stage's crawl runs production's composition for that stage */
export async function workerHosts(root = ROOT, site = null) {
  const { createSiteRouter } = await import(pathToFileURL(join(root, 'workers/mccluster/src/platform/router.js')).href);
  const { COMPANY_PARTS } = await import(pathToFileURL(join(root, 'workers/mccluster/src/company-site/router.js')).href);
  const { WORLD_DOOR_PARTS } = await import(pathToFileURL(join(root, 'workers/mccluster/src/human-uprise/router.js')).href);
  return createSiteRouter({ site: site || await loadSite(root), company: COMPANY_PARTS, worldDoor: WORLD_DOOR_PARTS });
}

class NotFound extends Error {
  constructor(host) { super(`getaddrinfo ENOTFOUND ${host}`); this.cause = { code: 'ENOTFOUND' }; }
}

/* the local internet: each host answered the way the table's stage says it is served */
export async function localFetcher(site, { root = ROOT } = {}) {
  const pages = githubPages(root);
  const env = workerEnv(root);
  const worker = await workerHosts(root, site);
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
        return new Response(null, { status: 301, headers: { location: `${door.to_origin}${cloudflareNormalized(u.pathname)}${u.search}`, 'content-type': 'text/html; charset=UTF-8' } });
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

/* the hosts whose answers a stage changes on purpose, judged by the stage's rules instead of production's answers before
   P0: from P1 the platform (it serves every page) and the routed doors that send everything to it (www) */
export function stageJudged(site, host) {
  if (site.switches.platform_serves !== 'everything') return false;
  if (host === site.platform.host) return true;
  const door = site.doors.find((d) => d.host === host);
  return !!(door && door.to === 'platform' && door.served_by === 'worker:mccluster' && /^routed/.test(String(door.state)));
}
const isRedirect = (status) => Number.isInteger(status) && status >= 300 && status < 400;
const classOf = (row) => (row.error ? 'unanswered' : isRedirect(row.status) ? 'redirect' : String(row.status));

/* P1 (SPEC-PLATFORM 4, the acceptance of "the platform serves everything"): every public path on the platform answers
   200 or the same class of answer as the same path on Matthew's host (a redirect where his host redirects, a 404 where
   his is a 404); the World's own addresses and the platform's own paths answer as the router says; Whip Equipped and the
   owner's own pages (profile_only) answer 301 to his host; nothing else sends a visitor to a document on his host; plain
   http goes to https on the platform; the routed doors send every path to the platform, in one hop (straight to the
   platform's own 301 where it answers one); another spelling of an address answers one 301 to the page it names, where
   that page lives (the P1 review); no page the platform serves is noindex there. */
export async function addressReader(root = ROOT) {
  return (await import(pathToFileURL(join(root, 'workers/mccluster/src/platform/router.js')).href)).addressOf;
}
export function judgeServesEverything(local, site, fixture = null, addressOf = null) {
  const failures = [];
  const loc = new Map(local.rows.map((r) => [r.url, r]));
  const fx = new Map(((fixture && fixture.rows) || []).map((r) => [r.url, r]));
  const P = site.platform.origin, M = site.profile.origin;
  const worldQuery = (u) => site.world.query_keys.some((k) => u.searchParams.has(k));
  for (const row of local.rows) {
    const u = new URL(row.url);
    if (!stageJudged(site, u.hostname)) continue;
    const fail = (problem) => failures.push({ url: row.url, problem });
    const path = u.pathname, q = u.search;
    const where = row.location ? new URL(row.location, row.url) : null;
    if (u.hostname !== site.platform.host) {
      /* a routed door: every path to the same path and query on the platform, or in the same hop to where the platform's
         router sends that address (a page the platform renders itself, its news, decides its own answer: same path) */
      const own = loc.get(`${P}${path}${q}`);
      const want = !site.ownPathOrigin(path) && own && isRedirect(own.status) && own.location ? new URL(own.location, own.url).href : `${P}${path}${q}`;
      if (row.status !== 301 || !where || where.href !== want) fail(`a door of the platform answers ${row.status || row.error} ${row.location || ''}, not 301 to ${want}`);
      continue;
    }
    if (u.protocol === 'http:') {
      if (row.status !== 301 || !where || where.href !== `${P}${path}${q}`) fail(`plain http answers ${row.status || row.error} ${row.location || ''}, not 301 to ${P}${path}${q}`);
      continue;
    }
    /* another spelling of an address: one 301 to the page it names, where that page lives */
    const address = addressOf ? addressOf(site, path) : path;
    if (address !== null && address !== path) {
      const his = site.pageSet(address) === 'profile_only' || site.pages.profile_only.some((d) => d.slice(-1) === '/' && address.indexOf(d) === 0);
      const world = address === site.world.root || address === site.world.document || (address === site.platform.front_door_path && worldQuery(u));
      const want = his ? `${M}${address}${q}` : world ? `${P}${site.world.root}${q}` : `${P}${address}${q}`;
      if (row.status !== 301 || !where || where.href !== want) fail(`another spelling of ${address} answers ${row.status || row.error} ${row.location || ''}, not 301 to ${want}`);
      continue;
    }
    if (where && where.origin === M && site.pageSet(path) !== 'profile_only') fail(`sends the visitor to a document on Matthew's host (${row.location})`);
    if (where && where.origin !== P && where.origin !== M) fail(`sends the visitor off the site (${row.location})`);
    if (path === site.world.root && !worldQuery(u) && row.status !== 200) fail(`the World answers ${row.status || row.error}, not 200`);
    if (path === site.world.document || (path === site.platform.front_door_path && worldQuery(u))) {
      if (row.status !== 301 || !where || where.href !== `${P}${site.world.root}${q}`) fail(`the World's other address answers ${row.status || row.error} ${row.location || ''}, not 301 to ${P}${site.world.root}${q}`);
      continue;
    }
    if (path === site.world.root) continue;
    /* the platform's own paths (and one asked for with a slash, folded to it) answer as before P1: production's answers */
    if (site.ownPathOrigin(path) || (path.length > 1 && path.slice(-1) === '/' && site.ownPathOrigin(path.slice(0, -1)))) {
      const want = fx.get(row.url);
      if (want && ((want.status || null) !== (row.status || null) || (want.location || null) !== (row.location || null))) {
        fail(`the platform's own path answers ${row.status} ${row.location || ''}, production ${want.status} ${want.location || ''}`);
      }
      continue;
    }
    if (site.pageSet(path) === 'profile_only') {
      if (row.status !== 301 || !where || where.href !== `${M}${path}${q}`) fail(`profile_only answers ${row.status || row.error} ${row.location || ''}, not 301 to ${M}${path}${q}`);
      continue;
    }
    /* every other path: the same class of answer as on Matthew's host, and 200 where his is 200 */
    const mirror = loc.get(`https://${site.profile.host}${path}${q}`);
    if (!mirror) { fail('no answer from Matthew\'s host to compare'); continue; }
    if (classOf(row) !== classOf(mirror)) fail(`answers ${row.status || row.error}, Matthew's host ${mirror.status || mirror.error}: not the same class of answer`);
    if (isRedirect(row.status) && isRedirect(mirror.status) && where && new URL(mirror.location, mirror.url).pathname !== where.pathname) {
      fail(`redirects to ${where.pathname}, Matthew's host to ${new URL(mirror.location, mirror.url).pathname}`);
    }
    if (row.status === 200 && row.headers && row.headers['x-robots-tag']) fail(`served with x-robots-tag ${row.headers['x-robots-tag']}`);
  }
  return failures;
}

/* What a local crawl must show against the fixture. Returns { failures, added, skipped, compared }. */
export function judgeLocal(local, fixture, site, addressOf = null) {
  const failures = [], added = [], skipped = [];
  const fx = new Map(fixture.rows.map((r) => [r.url, r]));
  const loc = new Map(local.rows.map((r) => [r.url, r]));
  const profile = site.profile.host;
  let compared = 0;
  for (const row of local.rows) {
    const why = fixture.edge_only[row.url] || edgeOnly(site, row.url) || deployOnly(site, row.url);
    if (why) { skipped.push({ url: row.url, why }); continue; }
    /* a host the stage changes on purpose is judged by the stage's own rules, below */
    if (stageJudged(site, new URL(row.url).hostname)) { compared += 1; continue; }
    const want = fx.get(row.url);
    if (!want) { failures.push({ url: row.url, problem: 'not in the fixture: rewrite it from a live crawl' }); continue; }
    compared += 1;
    const have = comparable(row);
    const host = new URL(row.url).hostname;
    if (want.dns) {
      if (have.error !== 'ENOTFOUND' || have.status !== null || have.location !== null) {
        failures.push({ url: row.url, problem: `inert door has no address: expected ENOTFOUND, got ${have.status || have.error}` });
      }
      continue;
    }
    /* a file this tree adds that production has not published yet */
    if (want.status === 404 && have.status === 200 && host === profile) { added.push(row.url); continue; }
    for (const f of [...ROUTING_FIELDS, ...COMPARED_HEADERS]) {
      const w = want[f] === undefined ? null : want[f];
      /* unanswered both times (an inert door that does not resolve): the same answer, whatever words each lookup failed with */
      if (f === 'error' && w && have.error) continue;
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
  failures.push(...judgeServesEverything(local, site, fixture, addressOf));
  /* every classified page answers 200 on the host that serves it at this stage (the World's document, where the platform
     serves it, at the platform's root: its own address there) */
  for (const set of ['platform', 'profile', 'profile_only']) {
    for (const p of site.pages[set]) {
      const url = p === site.world.document && site.servingOrigin(p) === site.platform.origin ? site.platform.origin + site.world.root : site.siteUrl(p);
      const row = loc.get(url);
      if (!row) { failures.push({ url, problem: `${p} (${set}) was not crawled` }); continue; }
      if (row.status !== 200) failures.push({ url, problem: `${p} (${set}): the table says ${site.servingOrigin(p)} serves it, and it answered ${row.status || row.error}` });
    }
  }
  return { failures, added, skipped, compared };
}

/* ---------- the browser half (from P1) ---------- */

/* SPEC-PLATFORM 4, P1's acceptance: every public path on the platform "with no console error the P0 baseline does not
   have ... and no request for a document on Matthew's host". The crawl above holds the answers; this opens the pages
   (the P1 review, P1A-4). Chromium at 390 px, phone first; the same in-process hosts as the local crawl (localFetcher);
   nobody signed in, the visitor's privacy answer given so a page runs everything it runs for a visitor who agreed;
   service workers blocked; McCluster's API and Supabase answered with empty lists; every other host refused, alike on
   both hosts. The baseline is the same document on Matthew's host, which serves it as before P0: what both copies log is
   not the platform's doing. A page whose platform copy logs nothing and asks for no document on his host passes
   without opening his copy; any other is opened on both hosts, and an error that only the platform's copy logs is
   counted only when it comes back on a second pair of visits. */
export const BROWSER_LAUNCH_ARGS = Object.freeze(['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']);
const SERVICES = Object.freeze({ api: 'api.mccluster.org', supabase: /\.supabase\.co$/ });

/* the pages the platform serves: the World at its root, the HERE front door, every platform and profile page (the World's
   document name only answers 301 to the root on the platform) */
export function browserPages(site) {
  return [...new Set([site.world.root, site.platform.front_door_path, ...site.pages.platform, ...site.pages.profile])]
    .filter((p) => p !== site.world.document);
}
/* the same document on Matthew's host: the platform's root is the World, which is its document there */
export function hisCopy(site, path) {
  return site.profile.origin + (path === site.world.root ? site.world.document : path);
}
/* an error as logged, comparable between the hosts: both origins written alike */
export function errorText(site, text) {
  return String(text).split(site.platform.origin).join('<host>').split(site.profile.origin).join('<host>').slice(0, 300);
}
/* one page's problems from its visits: a document asked for on Matthew's host on any platform visit (his carry page
   aside, which js/carry.js frames on purpose); a page that opens on his host and not on the platform; an error the
   platform's copy logged on every visit that opened and his copy logged on none */
export function judgePage(site, { platform, his = [] }) {
  const problems = [];
  const carry = site.profile.origin + site.profile.carry_path;
  const documents = [...new Set(platform.flatMap((v) => v.documents || []))]
    .filter((u) => u.startsWith(site.profile.origin + '/') && u.split(/[?#]/)[0] !== carry);
  if (documents.length) problems.push(`asks for a document on Matthew's host: ${documents.join(' ')}`);
  const opened = platform.filter((v) => !v.nav);
  if (!opened.length && his.some((v) => !v.nav)) problems.push(`does not open on the platform (${platform.map((v) => v.nav).join('; ')}), while its copy on Matthew's host does`);
  if (opened.length) {
    const theirs = new Set(his.flatMap((v) => v.errors || []));
    const every = opened.map((v) => new Set(v.errors || [])).reduce((a, b) => new Set([...a].filter((e) => b.has(e))));
    const only = [...every].filter((e) => !theirs.has(e));
    if (only.length) problems.push(`logs ${only.length} error(s) its copy on Matthew's host does not: ${JSON.stringify(only)}`);
  }
  return problems;
}

function playwright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); }
  catch { return createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright'); }
}

export async function browserAcceptance(site, { root = ROOT, outDir = null, only = null, log = console.log } = {}) {
  if (site.switches.platform_serves !== 'everything') return { skipped: `stage ${site.stage}: the platform does not serve every page yet`, pages: [], failures: [] };
  const fetchOne = await localFetcher(site, { root });
  const { chromium } = playwright();
  const browser = await chromium.launch({ args: [...BROWSER_LAUNCH_ARGS] });
  const json = (route, status, body) => {
    const origin = route.request().headers().origin;
    return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': origin || '*', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  };
  async function open(url) {
    const v = { url, status: null, final: null, nav: null, errors: [], documents: [] };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
    try {
      ctx.setDefaultTimeout(20000);
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
          localStorage.setItem('mnet_tour_seen', '1');
          sessionStorage.setItem('mcc_premiere', '1');
        } catch (e) { /* a frame without storage */ }
      });
      await ctx.route('**/*', async (route) => {
        const req = route.request();
        let u;
        try { u = new URL(req.url()); } catch { return route.abort(); }
        if (req.resourceType() === 'document') v.documents.push(u.href);
        const preflight = req.method() === 'OPTIONS';
        if (u.hostname === SERVICES.api || SERVICES.supabase.test(u.hostname)) {
          if (preflight) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
          if (u.pathname === '/v1/auth/handoff' || u.pathname === '/auth/v1/user') return json(route, 401, { error: 'not signed in' });
          if (u.pathname.startsWith('/rest/v1/')) return json(route, 200, []);
          return json(route, 200, { ok: true, items: [], tracks: [], posts: [], events: [], missions: [], layers: [], features: [], sources: [], notifications: [], sessions: [] });
        }
        if (!site.hostRole(u.hostname)) return route.abort();
        if (!['GET', 'HEAD'].includes(req.method())) return route.fulfill({ status: 405, body: '' });
        if (/\.(mp3|m4a|aac|wav|ogg|mp4|webm|mov)$/i.test(u.pathname)) return route.fulfill({ status: 204, body: '' });
        let res;
        try { res = await fetchOne(u.href); } catch { return route.abort(); }
        const location = res.headers.get('location');
        /* a fulfilled redirect is followed outside interception, so a document's 301 is walked as a navigation here */
        if (res.status >= 300 && res.status < 400 && location && req.resourceType() === 'document') {
          return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>${res.status}</title><script>location.replace(${JSON.stringify(new URL(location, u.href).href)})</script>` });
        }
        const headers = {};
        res.headers.forEach((value, key) => { headers[key] = value; });
        return route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => v.errors.push(errorText(site, `pageerror: ${e && e.message || e}`)));
      page.on('console', (m) => { if (m.type() === 'error') v.errors.push(errorText(site, `console: ${m.text()}`)); });
      try {
        const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        v.status = r ? r.status() : null;
        await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(400);
      } catch (e) { v.nav = String(e && e.message || e).split('\n')[0].slice(0, 200); }
      v.final = page.url();
    } finally {
      await ctx.close().catch(() => {});
    }
    v.errors = [...new Set(v.errors)];
    return v;
  }

  const P = site.platform.origin;
  const rows = [], failures = [];
  const pages = browserPages(site).filter((p) => !only || only.includes(p));
  try {
    for (const path of pages) {
      const answer = await fetchOne(P + path);
      if (answer.status !== 200) {
        rows.push({ path, answered: answer.status, opened: false });
        log(`skip    ${path}: the platform answers ${answer.status} (the crawl judges it)`);
        continue;
      }
      const platform = [await open(P + path)];
      const his = [];
      const clean = (vs) => vs.every((v) => !v.nav && !v.errors.length) && !judgePage(site, { platform: vs }).length;
      if (!clean(platform)) {
        his.push(await open(hisCopy(site, path)));
        if (judgePage(site, { platform, his }).length) {
          platform.push(await open(P + path));
          his.push(await open(hisCopy(site, path)));
        }
      }
      const problems = judgePage(site, { platform, his });
      rows.push({ path, answered: answer.status, platform, his, problems });
      for (const problem of problems) failures.push({ url: P + path, problem });
      log(`${problems.length ? 'FAIL' : 'ok  '}    ${path}: ${platform.map((v) => `${v.errors.length} error(s)`).join(', ')} on the platform` +
        (his.length ? `; ${his.map((v) => `${v.errors.length}`).join(', ')} on his host` : '') + (problems.length ? ` :: ${problems.join(' | ')}` : ''));
    }
  } finally {
    await browser.close();
  }
  const report = { schema: 'mccluster-platform-pages-browser/v1', stage: site.stage, captured_at: new Date().toISOString(), viewport: '390x844', pages: rows, failures };
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  }
  return report;
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
  const browserAt = argv.indexOf('--browser');
  if (browserAt !== -1) {
    const outDir = argv[browserAt + 1] && !argv[browserAt + 1].startsWith('--') ? argv[browserAt + 1] : null;
    const only = arg(argv, '--only');
    const report = await browserAcceptance(site, { outDir, only: only ? only.split(',') : null });
    if (report.skipped) { console.log(report.skipped); return 0; }
    const opened = report.pages.filter((r) => r.platform).length;
    const compared = report.pages.filter((r) => r.his && r.his.length).length;
    for (const f of report.failures) console.log(`FAIL    ${f.url}: ${f.problem}`);
    console.log(`browser half at stage ${site.stage}: ${report.pages.length} pages, ${opened} opened on the platform, ${compared} also opened on Matthew's host, ${report.failures.length} failure(s)`);
    return report.failures.length ? 1 : 0;
  }
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
    if (argv.includes('--capture-added-page')) {
      const out = arg(argv, '--out');
      if (!out) throw new Error('Capturing one page requires --out <new-file.json>');
      const observation = await captureAddedPage(site, arg(argv, '--capture-added-page'), readFixture());
      writeFileSync(out, JSON.stringify(observation, null, 2) + '\n', { flag: 'wx' });
      console.log(`captured ${observation.rows.length} host observations for ${observation.path} at ${observation.captured_at}`);
      return 0;
    }
    if (argv.includes('--amend-fixture')) {
      /* only the addresses the fixture does not hold yet, GET only; the fixture is production before P0, so this refuses
         once production answers as P0 or a later stage does (carry.html on Matthew's host: 404 before P0, 200 from it) */
      const fixture = readFixture();
      const have = new Set(fixture.rows.map((r) => r.url));
      const probe = await fetch(`${site.profile.origin}${site.profile.carry_path}`, { method: 'GET', redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
      if (probe.status !== 404) { console.error(`production answers ${site.profile.carry_path} with ${probe.status}: it no longer answers as before P0, so the fixture is not amended`); return 2; }
      const result = await liveCrawl(site, { only: (u) => !have.has(u) });
      if (!result.rows.length) { console.log('the fixture already holds every address of the plan'); return 0; }
      const amended = amendFixture(fixture, result, site);
      writeFileSync(join(ROOT, FIXTURE), JSON.stringify(amended, null, 1) + '\n');
      for (const r of result.rows) console.log(`  ${r.url}: ${r.status || r.error}${r.location ? ' ' + r.location : ''}`);
      console.log(`amended ${FIXTURE} with ${result.rows.length} answers read live`);
      return 0;
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
  const frozen = readFixture();
  const fixture = site.stage === 'P0' ? frozen : withAddedPages(frozen, site);
  const verdict = judgeLocal(local, fixture, site, await addressReader());
  for (const [host, s] of Object.entries(summarize(local))) console.log(`  ${host}: ${JSON.stringify(s.status)}`);
  for (const a of verdict.added) console.log(`added   ${a} (this tree publishes it; production does not yet)`);
  for (const f of verdict.failures) console.log(`FAIL    ${f.url}: ${f.problem}`);
  console.log(`local crawl at stage ${site.stage}: ${local.rows.length} answers, ${verdict.compared} compared against stage rules and dated production observations, ` +
    `${verdict.skipped.length} the live edge's or built at deploy, ${verdict.added.length} added, ${verdict.failures.length} failure(s)`);
  return verdict.failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e && e.stack || e); process.exitCode = 1; });
}
