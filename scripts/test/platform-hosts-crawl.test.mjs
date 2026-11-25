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
import { ROOT, localFetcher, githubPages, workerEnv, crawlPlan, crawlUrls, diffCrawls, judgeServesEverything, stageJudged, COMPARED_HEADERS, cloudflareNormalized, addressReader,
  browserPages, hisCopy, errorText, judgePage, absentAddress, readFixture, withAddedPage, localCrawl, judgeLocal } from '../e2e/platform-hosts.e2e.mjs';
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

/* The P1 review (P1A-1, SEC-P1-2, P1A-2, P1A-3): GitHub Pages answers a page at other spellings of its address (Measured
   live 2026-11-24), so the crawl asks for them on every host and judges each on the platform by the page it names (Whip
   Equipped's and the owner's own on Matthew's host, the World's at its root, any other on the platform), and holds a door
   to one hop: straight to where the platform's own answer for the address sends it. */
test('the crawl asks for other spellings of an address, judges each by the page it names, and holds a door to one hop', async () => {
  const P1 = tableOf('P1');
  const PLAT = P1.platform.origin, PROF = P1.profile.origin;
  const plan = crawlPlan(P1);
  for (const path of ['/whip', '//whip.html', '/whip%2Ehtml', '/%77hip.html', '/whip/rider/operator', '/whip/rider', '/prayer-closet', '/fbi', '/closet/sent',
    '/mnet', '/mnet?view=feed', '//mnet.html', '/index', '/index?view=feed', '//index.html?view=feed', '/listen', '//album.html?album=here']) {
    assert.ok(plan.paths.includes(path), `${path} is crawled on every host`);
  }
  const addressOf = await addressReader(ROOT);
  const row = (url, extra = {}) => ({ url, status: 200, location: null, error: null, headers: {}, ...extra });
  const good = [
    row(`${PLAT}/whip`, { status: 301, location: `${PROF}/whip.html` }), row(`${PROF}/whip`),
    row(`${PLAT}//whip.html`, { status: 301, location: `${PROF}/whip.html` }), row(`${PROF}//whip.html`),
    row(`${PLAT}/whip/rider`, { status: 301, location: `${PROF}/whip/rider/` }), row(`${PROF}/whip/rider`, { status: 301, location: `${PROF}/whip/rider/` }),
    row(`${PLAT}/mnet?view=feed`, { status: 301, location: `${PLAT}/?view=feed` }), row(`${PROF}/mnet?view=feed`),
    row(`${PLAT}/index?view=feed`, { status: 301, location: `${PLAT}/?view=feed` }), row(`${PROF}/index?view=feed`),
    row(`${PLAT}/index`, { status: 301, location: `${PLAT}/index.html` }), row(`${PROF}/index`),
    row(`${PLAT}/listen`, { status: 301, location: `${PLAT}/listen.html` }), row(`${PROF}/listen`),
    row(`${PLAT}/whip.html`, { status: 301, location: `${PROF}/whip.html` }), row(`${PROF}/whip.html`),
    row(`${PLAT}/listen.html`), row(`${PROF}/listen.html`),
    row('https://www.mccluster.org/whip.html', { status: 301, location: `${PROF}/whip.html` }),
    row('https://www.mccluster.org/whip', { status: 301, location: `${PROF}/whip.html` }),
    row('https://www.mccluster.org/listen.html', { status: 301, location: `${PLAT}/listen.html` })
  ];
  assert.deepEqual(judgeServesEverything({ rows: good }, P1, null, addressOf), [], 'the answers P1 means');
  const bad = (rows, problem) => {
    const found = judgeServesEverything({ rows: [...good.filter((g) => !rows.some((r) => r.url === g.url)), ...rows] }, P1, null, addressOf);
    assert.ok(found.some((f) => problem.test(f.problem)), `${problem}: ${JSON.stringify(found)}`);
  };
  bad([row(`${PLAT}/whip`)], /another spelling of \/whip\.html answers 200/);
  bad([row(`${PLAT}//whip.html`, { status: 301, location: `${PROF}//whip.html` })], /another spelling of \/whip\.html answers 301 https:\/\/matthew\.mccluster\.org\/\/whip\.html/);
  bad([row(`${PLAT}/mnet?view=feed`)], /another spelling of \/mnet\.html answers 200/);
  bad([row(`${PLAT}/listen`)], /another spelling of \/listen\.html answers 200/);
  bad([row(`${PLAT}/listen`, { status: 301, location: `${PROF}/listen.html` })], /another spelling of \/listen\.html answers 301/);
  bad([row('https://www.mccluster.org/whip.html', { status: 301, location: `${PLAT}/whip.html` })], /a door of the platform answers 301 https:\/\/mccluster\.org\/whip\.html/);
  bad([row('https://www.mccluster.org/whip', { status: 301, location: `${PLAT}/whip` })], /a door of the platform answers 301/);
  /* the zone's own redirect rule (here.mccluster.org) reads an address through Cloudflare's normalization; the Worker
     reads it as sent (both Measured 2026-11-24) */
  assert.equal(cloudflareNormalized('//whip.html'), '/whip.html');
  assert.equal(cloudflareNormalized('/whip%2Ehtml'), '/whip.html');
  assert.equal(cloudflareNormalized('/%77hip.html'), '/whip.html');
  assert.equal(cloudflareNormalized('/a%2fb%20c'), '/a%2Fb%20c', 'a reserved or other escape stays escaped, in upper case');
  const fetchOne = await localFetcher(P1, { root: ROOT });
  assert.equal((await fetchOne('https://here.mccluster.org//whip%2Ehtml?x=1')).headers.get('location'), `${PROF}/whip.html?x=1`);
  assert.equal((await fetchOne(`${PLAT}//whip.html?x=1`)).headers.get('location'), `${PROF}/whip.html?x=1`, 'the platform, one hop to his page');
});

/* The browser half (the P1 review, P1A-4; SPEC-PLATFORM 4, P1's acceptance): which pages it opens, which copy on
   Matthew's host is the baseline, and the verdict it reads from the visits. */
test('the crawl\'s browser half opens every page the platform serves and judges it against its copy on Matthew\'s host', () => {
  const P1 = tableOf('P1');
  const PLAT = P1.platform.origin, PROF = P1.profile.origin;
  const pages = browserPages(P1);
  assert.equal(pages[0], '/', 'the World at the platform\'s root first');
  assert.ok(pages.includes('/index.html') && pages.includes('/listen.html') && pages.includes('/engineering/') && pages.includes('/action/'), 'the front door, platform and profile pages');
  assert.ok(!pages.includes('/mnet.html'), 'the World\'s document name only answers 301 to the root there');
  for (const p of P1.pages.profile_only) assert.ok(!pages.includes(p), `${p} is Matthew's own: never served by the platform`);
  assert.equal(new Set(pages).size, pages.length, 'each page once');
  assert.equal(hisCopy(P1, '/'), `${PROF}/mnet.html`, 'the World\'s root is its document on his host');
  assert.equal(hisCopy(P1, '/engineering/'), `${PROF}/engineering/`);
  assert.equal(errorText(P1, `Refused to execute script from '${PLAT}/engineering/js/experience.js'`), errorText(P1, `Refused to execute script from '${PROF}/engineering/js/experience.js'`), 'the two origins read alike');

  const visit = (errors = [], extra = {}) => ({ errors, documents: [], nav: null, ...extra });
  const refused = errorText(P1, `console: Refused to execute script from '${PLAT}/engineering/js/experience.js?v=1' because its MIME type ('text/html') is not executable`);
  const missing = 'console: Failed to load resource: the server responded with a status of 404 ()';
  assert.deepEqual(judgePage(P1, { platform: [visit()] }), [], 'a quiet page passes');
  assert.deepEqual(judgePage(P1, { platform: [visit([missing])], his: [visit([missing])] }), [], 'what both copies log is not the platform\'s doing');
  assert.match(judgePage(P1, { platform: [visit([missing, refused])], his: [visit([missing])] })[0], /logs 1 error\(s\) its copy on Matthew's host does not/, 'an error only the platform logs');
  assert.deepEqual(judgePage(P1, { platform: [visit([refused]), visit([])], his: [visit([]), visit([])] }), [], 'an error the second pair of visits does not repeat is not counted');
  assert.deepEqual(judgePage(P1, { platform: [visit([refused]), visit([refused])], his: [visit([]), visit([refused])] }), [], 'nor one his copy logs on either visit');
  assert.match(judgePage(P1, { platform: [visit([], { documents: [`${PLAT}/listen.html`, `${PROF}/listen.html?x=1`] })] })[0], /asks for a document on Matthew's host: https:\/\/matthew\.mccluster\.org\/listen\.html\?x=1/);
  assert.deepEqual(judgePage(P1, { platform: [visit([], { documents: [`${PLAT}/listen.html`, `${PROF}${P1.profile.carry_path}`, `${PROF}${P1.profile.carry_path}?r=2`] })] }), [], 'his carry page, framed on purpose, is not a document the visitor is sent to');
  assert.match(judgePage(P1, { platform: [visit([], { nav: 'Timeout 30000ms exceeded.' })], his: [visit()] })[0], /does not open on the platform/);
  assert.deepEqual(judgePage(P1, { platform: [visit([], { nav: 'Timeout' })], his: [visit([], { nav: 'Timeout' })] }), [], 'a page neither host opens is not the platform\'s doing');
});


test('post-P0 artist observations preserve the original baseline and enforce each host’s routing', async () => {
  const path = '/artist.html';
  const observation = JSON.parse(readFileSync(join(ROOT, 'scripts/e2e/fixtures/platform-hosts-artist-20261124.json'), 'utf8'));
  const frozen = readFixture();
  const fixture = withAddedPage(frozen, observation, SITE);
  const local = await localCrawl(SITE);
  const addressOf = await addressReader(ROOT);
  const check = (input) => judgeLocal(input, fixture, SITE, addressOf);
  assert.equal(frozen.rows.some((r) => new URL(r.url).pathname === path), false);
  assert.throws(() => withAddedPage(fixture, observation, SITE), /duplicate/);
  const actual = check(local);
  assert.deepEqual(actual.failures, []);
  assert.ok(actual.added.includes(SITE.profile.origin + path));
  const change = (host, patch) => {
    const url = `https://${host}${path}`;
    const rows = local.rows.map((r) => r.url === url ? { ...r, ...patch } : r);
    return check({ rows }).failures.filter((r) => r.url === url);
  };
  assert.ok(change(SITE.profile.host, { status: 503 }).length);
  assert.ok(change('here.mccluster.org', { location: 'https://mccluster.org/artist.html' }).length);
  for (const host of ['humanuprise.com', 'www.humanuprise.com']) {
    assert.ok(change(host, { status: 503, error: null }).length, 'an HTTP gateway is not an inert door');
    assert.ok(change(host, { error: 'ETIMEDOUT' }).length, 'a timeout does not prove absence');
  }
  const incomplete = structuredClone(observation);
  delete incomplete.rows.find((r) => r.dns).dns.cloudflare.AAAA;
  assert.throws(() => withAddedPage(frozen, incomplete, SITE), /Missing corroborated/);
});

test('an inert door needs negative DNS evidence for the exact requested host and address family', () => {
  const host = 'example.test';
  const reply = { Status: 0, Question: [{ name: host + '.', type: 1 }], Authority: [{ type: 6 }] };
  assert.equal(absentAddress(reply, host, 'A'), 'NODATA');
  assert.equal(absentAddress({ ...reply, Status: 3 }, host, 'A'), 'NXDOMAIN');
  for (const bad of [{ Status: 2 }, { TC: true }, { Answer: [{ type: 5 }] }, { Authority: [] }]) {
    assert.throws(() => absentAddress({ ...reply, ...bad }, host, 'A'));
  }
  assert.throws(() => absentAddress(reply, host, 'AAAA'));
  assert.throws(() => absentAddress(reply, 'www.' + host, 'A'));
});
