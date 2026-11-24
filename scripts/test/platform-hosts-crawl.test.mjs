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
import { ROOT, localFetcher, githubPages, workerEnv, crawlPlan, COMPARED_HEADERS } from '../e2e/platform-hosts.e2e.mjs';
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
