/* THE LOCAL CRAWL RUNS PRODUCTION'S COMPOSITION, FOR EVERY STAGE'S TABLE (SPEC-PLATFORM 4: the crawl is the acceptance
   suite of each stage).

     node --test scripts/test/platform-hosts-crawl.test.mjs

   scripts/e2e/platform-hosts.e2e.mjs answers each host the way the table's stage says it is served, and wherever Worker
   mccluster answers it runs the Worker in-process. That Worker must be the one workers/mccluster/src/entry-platform.js
   builds (createSiteRouter with the company's parts and the World door's), over the table being crawled. A wrapper bound
   to the shipped table answers nothing for a host the shipped table does not route, so a later stage's crawl (P3:
   Matthew's host routed) would answer 404 where production answers 200 or a 301. Nothing here reaches the network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, localFetcher, githubPages, workerEnv, crawlPlan, crawlUrls, diffCrawls, judgeServesEverything, stageJudged, COMPARED_HEADERS } from '../e2e/platform-hosts.e2e.mjs';
import { siteTable, readRecord } from '../../tools/build-site-hosts.mjs';

const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const { SITE, makeSite } = await imp('workers/mccluster/src/platform/hosts.generated.js');
const { createSiteRouter } = await imp('workers/mccluster/src/platform/router.js');
const { COMPANY_PARTS } = await imp('workers/mccluster/src/company-site/router.js');
const { WORLD_DOOR_PARTS } = await imp('workers/mccluster/src/human-uprise/router.js');
const record = readRecord(ROOT);
const tableOf = (stage) => makeSite(siteTable(record, { stage }));

/* production for a table: entry-platform.js's composition over that table, fetching from the same model of GitHub Pages
   the crawl uses (and an empty newsroom) */
function production(site) {
  const router = createSiteRouter({ site, company: COMPANY_PARTS, worldDoor: WORLD_DOOR_PARTS });
  const pages = githubPages(ROOT);
  const env = workerEnv(ROOT);
  const upstream = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    if (req.url.startsWith(`${env.SUPABASE_URL}/`)) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    return pages(req.url);
  };
  return async (url) => router(new Request(url), env, upstream);
}
/* the hosts production sends to Worker mccluster at a stage: the platform, a tenant once routed, a routed door that rides
   the Worker */
function workerHostsOf(site) {
  const hosts = [site.platform.host];
  for (const t of site.tenants) if (t.origin !== site.platform.static_origin || site.switches.profile_host_routed) hosts.push(t.host);
  for (const d of site.doors) if (d.served_by === 'worker:mccluster' && /^routed/.test(String(d.state))) hosts.push(d.host);
  return hosts;
}
const answerOf = (res) => ({ status: res.status, location: res.headers.get('location'), ...Object.fromEntries(COMPARED_HEADERS.map((h) => [h, res.headers.get(h)])) });

test('with the P3 table the crawl answers Matthew\'s host as production does: his pages 200, a page that moved 301 to the platform, the files 200', async () => {
  const P3 = tableOf('P3');
  assert.equal(P3.switches.profile_host_routed, true);
  const crawl = await localFetcher(P3, { root: ROOT });
  const prod = production(P3);
  const want = {
    '/': [200, null],
    '/matthew-mccluster.html': [200, null],
    '/listen.html': [301, `${P3.platform.origin}/listen.html`],
    '/js/tabbar.js': [200, null]
  };
  for (const [path, [status, location]] of Object.entries(want)) {
    const url = `${P3.profile.origin}${path}`;
    const got = await crawl(url), real = await prod(url);
    assert.deepEqual([real.status, real.headers.get('location')], [status, location], `production answers ${url} so`);
    assert.deepEqual(answerOf(got), answerOf(real), `the crawl answers ${url} as production does`);
  }
});

test('for every stage\'s table, every host the Worker answers and a sample of every path class, the crawl\'s answer is production\'s', async () => {
  const base = crawlPlan(SITE);
  const sample = [...new Set([
    ...['platform', 'profile', 'profile_only'].flatMap((set) => SITE.pages[set].slice(0, 6)),
    ...base.paths.filter((p) => !/\.html$/.test(p) || /^\/(?:index|mnet|embed|carry|nope)\.html/.test(p))
  ])];
  for (const stage of ['P0', 'P1', 'P2', 'P3', 'P4']) {
    const site = stage === SITE.stage ? SITE : tableOf(stage);
    const crawl = await localFetcher(site, { root: ROOT });
    const prod = production(site);
    const hosts = workerHostsOf(site);
    assert.ok(hosts.includes(site.platform.host));
    if (site.switches.profile_host_routed) assert.ok(hosts.includes(site.profile.host), `${stage}: Matthew's host rides the Worker`);
    let compared = 0;
    for (const host of hosts) {
      for (const scheme of ['https', 'http']) {
        for (const path of sample) {
          const url = `${scheme}://${host}${path}`;
          assert.deepEqual(answerOf(await crawl(url)), answerOf(await prod(url)), `${stage} ${url}`);
          compared += 1;
        }
      }
    }
    assert.ok(compared > 100, `${stage}: ${compared} answers compared`);
  }
});

test('the composition the crawl runs is the one entry-platform.js runs before the API', () => {
  const entry = readFileSync(join(ROOT, 'workers/mccluster/src/entry-platform.js'), 'utf8');
  assert.match(entry, /const siteResponse = createSiteRouter\(\{ company: COMPANY_PARTS, worldDoor: WORLD_DOOR_PARTS \}\);/);
  const crawl = readFileSync(join(ROOT, 'scripts/e2e/platform-hosts.e2e.mjs'), 'utf8');
  assert.match(crawl, /createSiteRouter\(\{ site: site \|\| await loadSite\(root\), company: COMPANY_PARTS, worldDoor: WORLD_DOOR_PARTS \}\)/);
  assert.doesNotMatch(crawl, /companySiteResponse|humanUpriseResponse/, 'not the per-host wrappers, which are bound to the shipped table');
});

/* V-2 of the P0 verification: SPEC-PLATFORM risk 19 is "mccluster.org/index.html changes meaning" (a 301 to the World
   until P1, the HERE front door from P1), so the crawl asks every host for a bare /index.html as well as /index.html with a
   World query. */
test('the crawl asks every host for a bare /index.html and for /index.html?view=feed', () => {
  for (const stage of ['P0', 'P1', 'P3']) {
    const plan = crawlPlan(tableOf(stage));
    const urls = new Set(crawlUrls(plan));
    for (const host of plan.hosts) {
      for (const path of ['/index.html', '/index.html?view=feed']) assert.ok(urls.has(`https://${host}${path}`), `${stage}: https://${host}${path} is crawled`);
    }
  }
});

/* V-3 of the P0 verification: the live comparison against a baseline compares what a host answered (status, Location,
   the head and the headers), never the words a failed lookup came back with: an inert door that does not resolve in either
   crawl ("ENOTFOUND" once, "Request was cancelled." the next time) is no difference. */
test('a live comparison counts what hosts answered, never how an unresolvable host failed', () => {
  const row = (url, extra = {}) => ({ url, status: null, location: null, error: null, headers: {}, canonical: null, og_url: null, og_site_name: null, robots: null, ...extra });
  const before = { rows: [
    row('https://humanuprise.com/', { error: 'ENOTFOUND' }), row('https://humanuprise.com/x', { error: 'ENOTFOUND' }),
    row('https://mccluster.org/', { status: 200, canonical: 'https://mccluster.org/' }), row('https://mccluster.org/a', { status: 301, location: 'https://matthew.mccluster.org/a' }),
    row('https://door.example/', { error: 'ENOTFOUND' }), row('https://up.example/', { status: 200 })
  ] };
  const after = { rows: [
    row('https://humanuprise.com/', { error: 'Request was cancelled.' }), row('https://humanuprise.com/x', { error: 'getaddrinfo ENOTFOUND humanuprise.com' }),
    row('https://mccluster.org/', { status: 200, canonical: 'https://mccluster.org/' }), row('https://mccluster.org/a', { status: 200 }),
    row('https://door.example/', { status: 200 }), row('https://up.example/', { error: 'ECONNRESET' })
  ] };
  const diffs = diffCrawls(before, after);
  assert.deepEqual(diffs.map((d) => d.url), ['https://door.example/', 'https://mccluster.org/a', 'https://up.example/'],
    'unresolvable in both crawls is no difference; an answer that appeared, went or changed is one');
  const moved = diffs.find((d) => d.url === 'https://mccluster.org/a');
  assert.deepEqual(Object.keys(moved.fields).sort(), ['location', 'status']);
  assert.ok(!diffs.some((d) => d.fields && 'error' in d.fields && d.fields.error.before && d.fields.error.after), 'two failures never differ by their words');
});

/* P1's acceptance in the local crawl (SPEC-PLATFORM 4): the platform and its routed doors are judged by the stage's own
   rules, every other host by production's answers before P0. Each rule catches the answer it exists for. */
test('from P1 the crawl judges the platform by the stage: 200 or the class Matthew\'s host answers, profile_only to his host, nothing else to it', () => {
  const P1 = tableOf('P1'), P0 = tableOf('P0');
  const PLAT = P1.platform.origin, PROF = P1.profile.origin;
  assert.equal(stageJudged(P1, P1.platform.host), true);
  assert.equal(stageJudged(P1, 'www.mccluster.org'), true, 'the www door is routed and sends everything to the platform');
  assert.equal(stageJudged(P1, 'humanuprise.com'), false, 'an inert door is held to production\'s answers');
  assert.equal(stageJudged(P1, P1.profile.host), false, 'Matthew\'s host is held to production\'s answers until P3');
  assert.equal(stageJudged(P0, P0.platform.host), false, 'P0 is held to production\'s answers everywhere');
  const row = (url, extra = {}) => ({ url, status: 200, location: null, error: null, headers: {}, ...extra });
  const good = [
    row(`${PLAT}/listen.html`), row(`${PROF}/listen.html`),
    row(`${PLAT}/engineering`, { status: 301, location: `${PLAT}/engineering/` }), row(`${PROF}/engineering`, { status: 301, location: `${PROF}/engineering/` }),
    row(`${PLAT}/nope.html`, { status: 404 }), row(`${PROF}/nope.html`, { status: 404 }),
    row(`${PLAT}/whip.html`, { status: 301, location: `${PROF}/whip.html` }), row(`${PROF}/whip.html`),
    row(`${PLAT}/index.html?view=feed`, { status: 301, location: `${PLAT}/?view=feed` }),
    row(`${PLAT}/mnet.html`, { status: 301, location: `${PLAT}/` }),
    row(`${PLAT}/`), row('http://mccluster.org/', { status: 301, location: `${PLAT}/` }),
    row('https://www.mccluster.org/listen.html?a=1', { status: 301, location: `${PLAT}/listen.html?a=1` })
  ];
  assert.deepEqual(judgeServesEverything({ rows: good }, P1), [], 'the answers P1 means');
  const bad = (rows, problem) => {
    const found = judgeServesEverything({ rows: [...good.filter((g) => !rows.some((r) => r.url === g.url)), ...rows] }, P1);
    assert.ok(found.some((f) => problem.test(f.problem)), `${problem}: ${JSON.stringify(found)}`);
  };
  bad([row(`${PLAT}/listen.html`, { status: 301, location: `${PROF}/listen.html` })], /sends the visitor to a document on Matthew's host/);
  bad([row(`${PLAT}/whip.html`)], /profile_only answers 200/);
  bad([row(`${PLAT}/nope.html`)], /not the same class of answer/);
  bad([row(`${PLAT}/listen.html`, { status: 404 })], /not the same class of answer/);
  bad([row(`${PLAT}/engineering`, { status: 301, location: `${PLAT}/walls/` })], /redirects to \/walls\//);
  bad([row(`${PLAT}/index.html?view=feed`)], /the World's other address answers 200/);
  bad([row(`${PLAT}/listen.html`, { headers: { 'x-robots-tag': 'noindex' } })], /x-robots-tag noindex/);
  bad([row('https://www.mccluster.org/listen.html?a=1', { status: 301, location: `${PROF}/listen.html?a=1` })], /a door of the platform answers 301/);
  bad([row(`${PLAT}/listen.html`, { status: 302, location: 'https://evil.example/x' })], /sends the visitor off the site/);
});
