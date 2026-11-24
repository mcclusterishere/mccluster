/* ONE PLATFORM, SET IN ONE PLACE: no host in code but the generated ones.

     node --test scripts/test/site-hosts.test.mjs

   data/seo/domain-architecture.json names every host once. tools/build-site-hosts.mjs writes the three outputs the
   code reads (the Worker's table, the block at the top of js/shell-boot.js that sets window.MCC_SITE, and the
   Supabase functions' module). This file holds that promise:

   - the outputs are current (--check) and answer every question the same way, in the Worker, on the pages and in
     the functions;
   - with P0's switches the table describes today exactly (the values the code names today);
   - js/, workers/mccluster/src/ and supabase/functions/ name no site host in code outside the outputs, except the
     files listed in scripts/test/site-hosts-pending/ (worker, functions, client, engine), each with its count and
     the stage that converts it, and those lists only shrink: no list names a file or allows a count beyond the P0
     ceiling pinned below (7 files, 112 literals), and every list allows exactly what the scan finds;
   - the equityuprise rewrite (SPEC-PLATFORM 2.3): with platform.origin https://equityuprise.com and mccluster.org a
     tenant, every classified path still resolves and nothing answers a host it should not.
   The router of SPEC-PLATFORM 2.4 and the client's host logic extend the rewrite check when they exist. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import {
  OUTPUTS, BLOCK_BEGIN, BLOCK_END, EXPORTS, siteTable, readRecord, renderWorker, renderClientBlock, renderFunctions,
  findClientBlock, drift, hostLiterals, scanHostLiterals, readPending, pendingProblems, LANES, PENDING_CEILING
} from '../../tools/build-site-hosts.mjs';

/* THE P0 CEILING, pinned here as well as in the generator (PENDING_CEILING): the four pending lists as they stood when
   P0 was built (2026-11-23). No list may name a file outside it or allow more than its count, so a list cannot grow by
   an edit to the list alone; and every list must allow exactly what the scan finds, so a literal removed is a count
   lowered at once and freed room is never refilled. A number here is only ever lowered or deleted. */
const P0_PENDING_CEILING = Object.freeze({
  'js/live-content.js': 1,
  'js/mcc-auth.js': 1,
  'js/music-shell.js': 4,
  'js/tabbar.js': 10,
  'js/world-audio-continuity.js': 7,
  'workers/mccluster/src/company-site/pages.generated.js': 86,
  'workers/mccluster/src/seek-first/console.html': 3
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const record = readRecord(ROOT);
const plain = (v) => JSON.parse(JSON.stringify(v));

const worker = await import(pathToFileURL(join(ROOT, OUTPUTS.worker)).href);
const functions = await import(pathToFileURL(join(ROOT, OUTPUTS.functions)).href);
function clientSite(source = read(OUTPUTS.client)) {
  const found = findClientBlock(source);
  assert.ok(found, 'js/shell-boot.js carries the generated block');
  const window = {};
  vm.runInNewContext(found.text, { window });
  return window.MCC_SITE;
}
const client = clientSite();
const moduleFrom = (text) => import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);

/* every published page the record classifies, and paths that are not pages */
const CLASSIFIED = ['platform', 'profile', 'profile_only'].flatMap((set) => record.url_ownership[set].map((p) => [p, set]));
const PROBES = ['', '/', '/index.html', '/index.html?view=feed', '/mnet.html?view=feed#x', 'listen.html', '/account.html', '/action/',
  '/action/index.html', '/action-network-artist.html', '/company', '/company/', '/news', '/news/', '/news/a-headline-123', '/newsroom.html',
  '/robots.txt', '/js/tabbar.js', '/data/front-projects/vaunt-original.html', '/embed.html', '/carry.html', '/sw.js', '/manifest.json',
  '/.well-known/acme-challenge/x', '/site0/', '/site0/play.html', '/whip/driver/?a=1', '/walls/', '/nope.html', '/docs/', '/favicon.ico'];
const HELPER_PATH_FNS = ['cleanPath', 'isPageLike', 'pageSet', 'ownPathOrigin', 'isOwnPath', 'isWorldRoom', 'isBothHosts', 'homeOrigin', 'servingOrigin', 'siteUrl'];
const ORIGIN_PROBES = ['https://mccluster.org', 'https://matthew.mccluster.org', 'https://www.mccluster.org', 'https://humanuprise.com',
  'https://api.mccluster.org', 'https://evil.example', '', null, undefined];
const HOST_PROBES = ['mccluster.org', 'MCCLUSTER.ORG', 'www.mccluster.org', 'matthew.mccluster.org', 'here.mccluster.org', 'humanuprise.com',
  'www.humanuprise.com', 'api.mccluster.org', 'equityuprise.com', 'example.org', '', null];

function answers(site, paths = [...CLASSIFIED.map(([p]) => p), ...PROBES]) {
  const out = {};
  for (const p of paths) for (const fn of HELPER_PATH_FNS) out[`${fn}(${p})`] = site[fn](p);
  for (const o of ORIGIN_PROBES) { out[`returnOrigin(${o})`] = site.returnOrigin(o); out[`isSiteOrigin(${o})`] = site.isSiteOrigin(o); }
  for (const h of HOST_PROBES) { out[`isWorldHost(${h})`] = site.isWorldHost(h); out[`hostRole(${h})`] = plain(site.hostRole(h)); }
  return out;
}

test('the generated outputs are current: tools/build-site-hosts.mjs --check passes, and a hand edit to any output is drift', () => {
  execFileSync('node', ['tools/build-site-hosts.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });
  assert.deepEqual(drift(ROOT), []);
  const dir = mkdtempSync(join(tmpdir(), 'site-hosts-'));
  try {
    for (const f of ['data/seo/domain-architecture.json', ...Object.values(OUTPUTS)]) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      copyFileSync(join(ROOT, f), join(dir, f));
    }
    assert.deepEqual(drift(dir), [], 'a faithful copy has no drift');
    writeFileSync(join(dir, OUTPUTS.worker), read(OUTPUTS.worker).replace('"origin": "https://mccluster.org"', '"origin": "https://example.org"'));
    const boot = read(OUTPUTS.client);
    writeFileSync(join(dir, OUTPUTS.client), boot.replace(BLOCK_END, `${BLOCK_END}\nwindow.MCC_SITE = null;`).replace(BLOCK_BEGIN, `${BLOCK_BEGIN}\n// edited`));
    assert.deepEqual(drift(dir).sort(), [OUTPUTS.client, OUTPUTS.worker].sort(), 'both hand edits are drift');
    const changed = readRecord(dir);
    changed.platform.origin = 'https://equityuprise.com';
    writeFileSync(join(dir, 'data/seo/domain-architecture.json'), JSON.stringify(changed, null, 2) + '\n');
    assert.equal(drift(dir).length, 3, 'a new platform origin changes all three outputs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the outputs are deterministic: the same record renders the same three texts', () => {
  const a = siteTable(record), b = siteTable(JSON.parse(JSON.stringify(record)));
  assert.equal(renderWorker(a), renderWorker(b));
  assert.equal(renderClientBlock(a), renderClientBlock(b));
  assert.equal(renderFunctions(a), renderFunctions(b));
  assert.equal(read(OUTPUTS.worker), renderWorker(a));
  assert.equal(read(OUTPUTS.functions), renderFunctions(a));
});

test('one table, one answer: the Worker, the pages (window.MCC_SITE) and the functions agree on every path, origin and host', () => {
  assert.deepEqual(plain(functions.SITE_TABLE), plain(worker.SITE_TABLE), 'the functions carry the Worker\'s table');
  assert.deepEqual(plain(client), plain(worker.SITE_TABLE), 'window.MCC_SITE carries the same table (its helpers aside)');
  assert.deepEqual(plain(worker.SITE_TABLE), plain(siteTable(record)), 'and it is the record\'s table');
  const want = answers(worker.SITE);
  assert.deepEqual(answers(functions.SITE), want, 'the functions answer as the Worker');
  assert.deepEqual(answers(client), want, 'the pages answer as the Worker');
  for (const name of [...EXPORTS.named, ...EXPORTS.helpers, EXPORTS.table, EXPORTS.site, EXPORTS.factory]) {
    assert.ok(name in worker, `the Worker module exports ${name}`);
    assert.ok(name in functions, `the functions module exports ${name}`);
  }
  for (const name of EXPORTS.helpers) assert.equal(typeof client[name], 'function', `window.MCC_SITE.${name}`);
  for (const site of [worker.SITE, functions.SITE, client]) {
    assert.ok(Object.isFrozen(site) && Object.isFrozen(site.platform) && Object.isFrozen(site.pages.platform) && Object.isFrozen(site.doors[0]), 'frozen all the way down');
  }
});

test('the block sits at the very top of js/shell-boot.js, once, and only sets window.MCC_SITE', () => {
  const boot = read(OUTPUTS.client);
  assert.ok(boot.startsWith(BLOCK_BEGIN), 'the first bytes of the file are the block');
  assert.equal(boot.split(BLOCK_BEGIN).length, 2, 'one BEGIN marker');
  assert.equal(boot.split(BLOCK_END).length, 2, 'one END marker');
  const found = findClientBlock(boot);
  const touched = [];
  const window = new Proxy({}, { set(t, k, v) { touched.push(k); t[k] = v; return true; } });
  /* a context holding nothing but window: no document, location, storage or network to reach for */
  vm.runInNewContext(found.text, { window });
  assert.deepEqual(touched, ['MCC_SITE']);
  const site = window.MCC_SITE;
  assert.equal(site.siteUrl('/news/a-1'), 'https://mccluster.org/news/a-1', 'its helpers answer from the table alone');
  assert.equal(site.hostRole('matthew.mccluster.org').role, 'tenant');
  const rest = boot.slice(found.end);
  assert.match(rest, /^\/\* Before first paint: reserve navigation while the server verifies this session\./, 'the rest of the file starts where it always did');
});

test('with P0\'s switches the table describes today exactly', async () => {
  const S = worker;
  assert.equal(S.STAGE, 'P0');
  assert.deepEqual(plain(S.SWITCHES), { platform_serves: 'world', profile_host_routed: false, carry: false, returns_fallback: 'tenants.matthew', metadata: 'today' });
  assert.equal(S.PLATFORM_ORIGIN, 'https://mccluster.org');
  assert.equal(S.WORLD_URL, 'https://mccluster.org/');
  assert.equal(S.PROFILE_ORIGIN, 'https://matthew.mccluster.org');
  assert.equal(S.STATIC_ORIGIN, 'https://matthew.mccluster.org');
  /* the values the code names today (js/tabbar.js, js/music-shell.js, js/world-audio-continuity.js,
     workers/mccluster/src/world-host.js, lib/http.js, supabase/functions/collect/index.ts at d33b189d) */
  assert.deepEqual([...S.WORLD_HOSTS], ['mccluster.org', 'www.mccluster.org', 'humanuprise.com', 'www.humanuprise.com']);
  assert.deepEqual([...S.SITE_ORIGINS], ['https://matthew.mccluster.org', 'https://mccluster.org', 'https://www.mccluster.org', 'https://humanuprise.com', 'https://www.humanuprise.com']);
  assert.deepEqual([...S.FRAME_ANCESTORS], ["'self'", 'https://matthew.mccluster.org', 'https://mccluster.org', 'https://www.mccluster.org', 'https://humanuprise.com', 'https://www.humanuprise.com']);
  assert.deepEqual([...S.CORS_ORIGINS], ['https://matthew.mccluster.org', 'https://mccluster.org', 'https://humanuprise.com', 'https://www.humanuprise.com']);
  assert.deepEqual(new Set(S.SITE_HOSTS), new Set(['mccluster.org', 'www.mccluster.org', 'matthew.mccluster.org', 'humanuprise.com', 'www.humanuprise.com']));
  assert.equal(S.COOKIE_DOMAIN, 'mccluster.org');
  assert.deepEqual([...S.WORLD_QUERY_KEYS], ['view', 'mission']);
  /* and the modules that still define them agree, before and after the Worker lane imports them from the table */
  const host = await import(pathToFileURL(join(ROOT, 'workers/mccluster/src/world-host.js')).href);
  assert.deepEqual([...S.FRAME_ANCESTORS], [...host.FRAME_ANCESTORS]);
  assert.deepEqual([...S.WORLD_ROOMS], [...host.WORLD_ROOMS]);
  assert.deepEqual([...S.WORLD_PREFIXES], [...host.WORLD_PREFIXES]);
  const http = await import(pathToFileURL(join(ROOT, 'workers/mccluster/src/lib/http.js')).href);
  const cors = http.allowedOrigins({});
  for (const o of S.CORS_ORIGINS) assert.ok(cors.includes(o), `the API's CORS list names ${o}`);
  for (const o of cors.filter((x) => S.SITE_ORIGINS.includes(x))) assert.ok(S.CORS_ORIGINS.includes(o), `${o} is on the CORS list and in the table`);
  const company = await import(pathToFileURL(join(ROOT, 'workers/mccluster/src/company-site/pages.generated.js')).href);
  assert.equal(company.COMPANY_ORIGIN, S.PLATFORM_ORIGIN);
  assert.equal(company.PERSONAL_ORIGIN, S.STATIC_ORIGIN);
  assert.deepEqual(Object.keys(company.PAGES), [...S.SITE.platform.own_paths.generated], 'the company pages the router serves are the platform\'s own paths');
  /* P0 serves as today: the World's rooms and the platform's own paths on the platform, every other page where it is now */
  assert.equal(S.servingOrigin('/account.html'), 'https://mccluster.org');
  assert.equal(S.servingOrigin('/news/a-1'), 'https://mccluster.org');
  assert.equal(S.siteUrl('/member-front.html?handle=x'), 'https://matthew.mccluster.org/member-front.html?handle=x');
  assert.equal(S.siteUrl('/whip/driver/'), 'https://matthew.mccluster.org/whip/driver/');
  assert.equal(S.siteUrl('/listen.html'), 'https://matthew.mccluster.org/listen.html');
  /* returns: an origin that serves pages gets its buyer back; anything else goes where every page is served today */
  assert.equal(S.returnOrigin('https://matthew.mccluster.org'), 'https://matthew.mccluster.org');
  assert.equal(S.returnOrigin('https://mccluster.org'), 'https://mccluster.org');
  assert.equal(S.returnOrigin('https://www.mccluster.org'), 'https://matthew.mccluster.org', 'www serves no page');
  assert.equal(S.returnOrigin('https://evil.example'), 'https://matthew.mccluster.org');
  assert.equal(S.returnOrigin(null), 'https://matthew.mccluster.org');
  /* the stable @ids come from the record's entities, never from a host */
  assert.equal(S.IDS.organization, 'https://matthew.mccluster.org/#mccluster-corp');
  assert.equal(S.IDS.person, 'https://matthew.mccluster.org/#matthew-mccluster');
  assert.equal(S.ENTITY_URLS.organization, 'https://mccluster.org/');
});

test('a later stage\'s table exists only here: P1 serves everything on the platform, P3 routes the profile host', () => {
  const p1 = worker.makeSite(siteTable(record, { stage: 'P1' }));
  assert.equal(p1.siteUrl('/listen.html'), 'https://mccluster.org/listen.html');
  assert.equal(p1.siteUrl('/matthew-mccluster.html'), 'https://mccluster.org/matthew-mccluster.html', 'a profile page has an in-app copy on the platform');
  assert.equal(p1.homeOrigin('/matthew-mccluster.html'), 'https://matthew.mccluster.org', 'whose home stays his host');
  assert.equal(p1.siteUrl('/whip.html'), 'https://matthew.mccluster.org/whip.html', 'profile_only never leaves his host');
  assert.equal(p1.returnOrigin('https://evil.example'), 'https://mccluster.org');
  const p3 = siteTable(record, { stage: 'P3' });
  assert.equal(p3.switches.profile_host_routed, true);
  assert.throws(() => siteTable(record, { stage: 'P9' }), /no switches for stage "P9"/);
});

test('the scanner counts a site host in code and nothing else', () => {
  const n = (src, file) => hostLiterals(src, file).length;
  assert.equal(n('const a = "https://matthew.mccluster.org/x";'), 1);
  assert.equal(n("const a = 'https://mccluster.org'; const b = 'https://www.mccluster.org';"), 2);
  assert.equal(n('const t = `https://humanuprise.com/${p}`;'), 1, 'template text');
  assert.equal(n('const t = `${x ? "https://mccluster.org" : y}`;'), 1, 'a string inside a template expression');
  assert.equal(n('if (/\\.mccluster\\.org$/.test(host)) {}'), 1, 'a regular expression\'s escaped host');
  assert.equal(n('const R = /^(?:www\\.)?(?:mccluster\\.org|humanuprise\\.com)$/i;'), 2);
  assert.equal(n('const DEAD = "https://mcclusterishere.github.io/Here";'), 1, 'the dead repository address');
  assert.equal(n('fetch("https://equityuprise.com/x")'), 1);
  assert.equal(n('// see https://matthew.mccluster.org\n/* mccluster.org */ const x = 1;'), 0, 'comments are documentation, not routing');
  assert.equal(n('const a = "https://api.mccluster.org"; const b = "https://esmer.mccluster.org"; const c = "core.mccluster.org";'), 0, 'other subdomains are not site hosts');
  assert.equal(n('const mail = "name@mccluster.org";'), 0, 'an e-mail address is not a host');
  assert.equal(n('const s = "https://mcclusterishere.github.io/esmer/";'), 0, 'another satellite on GitHub Pages is not this site');
  assert.equal(n('const a = "//not a comment https://mccluster.org";'), 1, 'a // inside a string does not start a comment');
  assert.equal(n('const r = a / b; const u = "https://mccluster.org"; // https://mccluster.org'), 1, 'division is not a regular expression');
  assert.equal(n('<!-- https://mccluster.org --><p>Sign in on matthew.mccluster.org</p><script>// mccluster.org\nvar u="https://mccluster.org";</script>', 'x.html'), 2, 'HTML text and inline script code count; HTML and script comments do not');
  assert.equal(n('{"u": "https://mccluster.org"}', 'x.json'), 1);
});

test('every file that names a site host in code is on exactly one pending list, and the lists only shrink', () => {
  const rows = scanHostLiterals(ROOT);
  const lanes = readPending(ROOT);
  assert.deepEqual(pendingProblems(rows, lanes), []);
  assert.deepEqual({ ...PENDING_CEILING }, { ...P0_PENDING_CEILING }, 'the generator holds the same P0 ceiling as this test');
  const ceilingFiles = Object.keys(P0_PENDING_CEILING);
  assert.equal(ceilingFiles.length, 7, 'the P0 ceiling: 7 files');
  assert.equal(Object.values(P0_PENDING_CEILING).reduce((s, n) => s + n, 0), 112, 'the P0 ceiling: 112 literals');
  /* the rule itself, here as well as in pendingProblems: whatever the lists say, they never exceed the ceiling, and
     each allows exactly what the scan finds (mobile-rule.test.mjs's ratchet) */
  const scanned = new Map(rows.map((r) => [r.file, r.count]));
  let total = 0;
  for (const [lane, data] of Object.entries(lanes)) {
    assert.equal(data.lane, lane, `${LANES[lane].list} names its lane`);
    assert.match(data.rule, /only shrinks/, `${LANES[lane].list} states the rule`);
    for (const e of data.files) {
      assert.ok(ceilingFiles.includes(e.file), `${LANES[lane].list}: ${e.file} was on no list when P0 was built: a list never gains a file`);
      assert.ok(e.count <= P0_PENDING_CEILING[e.file], `${LANES[lane].list}: ${e.file} allows ${e.count}, the P0 ceiling is ${P0_PENDING_CEILING[e.file]}: a list never raises a count`);
      assert.equal(scanned.get(e.file) || 0, e.count, `${LANES[lane].list}: ${e.file} allows ${e.count} and the scan finds ${scanned.get(e.file) || 0}: the list allows exactly what is left`);
      total += e.count;
    }
  }
  assert.equal(total, rows.reduce((s, r) => s + r.count, 0), 'every literal the scan finds is allowed by exactly one entry');
  assert.ok(total <= 112);
  const engine = lanes.engine.owned_files;
  for (const f of ['js/tabbar.js', 'js/music-shell.js', 'js/world-audio-continuity.js', 'js/music-engine.js', 'js/installed-app-dock.js', 'js/now-playing.js',
    'js/music-sheet.js', 'js/pip.js', 'js/label.js', 'listen.html', 'album.html', 'music-creator.html', 'music-videos.html', 'index.html']) {
    assert.ok(engine.includes(f), `${f} is engine-owned`);
  }
  for (const e of lanes.engine.files) assert.equal(e.stage, 'engine stage 2', `${e.file}: the engine converts it with the World on the engine`);
});

test('a planted literal fails, a grown count fails, a list never grows, freed room goes back at once, and a file that names no host leaves its list', () => {
  const lanes = readPending(ROOT);
  /* the rule alone, whatever the tree holds right now: a scan exactly as the lists allow is clean */
  const rows = Object.values(lanes).flatMap((d) => d.files.map((e) => ({ file: e.file, count: e.count })));
  assert.deepEqual(pendingProblems(rows, lanes), []);
  const planted = pendingProblems([...rows, { file: 'js/new-page.js', count: 1 }], lanes);
  assert.equal(planted.length, 1);
  assert.match(planted[0], /^js\/new-page\.js names a site host 1 time\(s\) and is on no pending list/);
  const listed = lanes.worker.files[0];
  const grown = pendingProblems(rows.map((r) => (r.file === listed.file ? { ...r, count: listed.count + 1 } : r)), lanes);
  assert.deepEqual(grown, [`${listed.file} names a site host ${listed.count + 1} time(s), more than the ${listed.count} its list allows: the list only shrinks`]);
  const gone = pendingProblems(rows.filter((r) => r.file !== listed.file), lanes);
  assert.deepEqual(gone, [`${listed.file} no longer names a site host: remove it from ${LANES.worker.list}`]);
  /* a literal removed and its count left as it was: the room it freed must go now, or a later literal could fill it */
  const slack = pendingProblems(rows.map((r) => (r.file === listed.file ? { ...r, count: listed.count - 1 } : r)), lanes);
  assert.deepEqual(slack, [`${listed.file} names a site host ${listed.count - 1} time(s) and ${LANES.worker.list} still allows ${listed.count}: lower it to ${listed.count - 1} in the same change (the list only shrinks; freed room is never refilled)`]);
  /* a list grown by an edit to the list itself (review mutation M4): a new file and its entry */
  const grownList = JSON.parse(JSON.stringify(lanes));
  grownList.client.files.push({ file: 'js/new-thing.js', count: 2, stage: 'P1' });
  const newEntry = pendingProblems([...rows, { file: 'js/new-thing.js', count: 2 }], grownList);
  assert.deepEqual(newEntry, [`${LANES.client.list}: js/new-thing.js was not on any list when P0 was built (PENDING_CEILING): the lists only shrink, so a new file reads its hosts from the generated outputs instead`]);
  /* a count raised together with the literals it covers (review mutation M5) */
  const raised = JSON.parse(JSON.stringify(lanes));
  const live = raised.client.files.find((e) => e.file === 'js/live-content.js');
  live.count += 2;
  const raisedProblems = pendingProblems(rows.map((r) => (r.file === live.file ? { ...r, count: live.count } : r)), raised);
  assert.deepEqual(raisedProblems, [`${LANES.client.list}: js/live-content.js allows ${live.count}, more than the ${P0_PENDING_CEILING['js/live-content.js']} it allowed when P0 was built (PENDING_CEILING): the lists only shrink`]);
  /* and a lower ceiling (a file converted further) binds the lists at once */
  const lowered = { ...P0_PENDING_CEILING, [listed.file]: listed.count - 1 };
  assert.ok(pendingProblems(rows, lanes, lowered).some((p) => p.includes(`allows ${listed.count}, more than the ${listed.count - 1}`)));
  const misfiled = JSON.parse(JSON.stringify(lanes));
  misfiled.client.files.push(misfiled.engine.files.pop());
  assert.ok(pendingProblems(rows, misfiled).some((p) => /is engine-owned: it belongs in/.test(p)), 'an engine-owned file cannot move to the client list');
  const shell = read(OUTPUTS.client);
  const found = findClientBlock(shell);
  assert.ok(hostLiterals(found.text, OUTPUTS.client).length > 0, 'the generated block names hosts, and the scan leaves it out');
});

/* SPEC-PLATFORM 2.3: "the record rewritten to platform.origin = https://equityuprise.com and mccluster.org as a tenant:
   every path still resolves, nothing answers a host it should not." What exists now is the generated table; the
   router (2.4) and the client's host logic extend this when they land. */
const NEXT = 'https://equityuprise.com';
const COMPANY = 'https://mccluster.org';
const PROFILE = 'https://matthew.mccluster.org';
function rewritten() {
  const F = JSON.parse(JSON.stringify(record));
  assert.equal(F.platform.next.origin, NEXT, 'the record names the next platform');
  F.platform.origin = NEXT;
  F.platform.website_id = `${NEXT}/#website`;
  F.platform.site_name = 'Equity Uprise';
  F.platform.own_paths = { generated: ['/robots.txt', '/sitemap.xml', '/llms.txt'], subtrees: [] };
  F.tenants.company = { host: 'mccluster.org', entity: record.entities.mccluster_corp.id, website_id: `${COMPANY}/#website`, site_name: 'McCluster Corp', root: '/company', sets: [], own_paths: { generated: ['/company'], subtrees: ['/news'] } };
  F.doors = {
    'www.equityuprise.com': { to: 'platform', served_by: 'worker:mccluster', state: 'routed', api_cors: false },
    'www.mccluster.org': { to: 'tenants.company', served_by: 'worker:mccluster', state: 'routed', api_cors: false },
    'humanuprise.com': record.doors['humanuprise.com'],
    'www.humanuprise.com': record.doors['www.humanuprise.com'],
    'here.mccluster.org': record.doors['here.mccluster.org']
  };
  return F;
}
function checkRewrite(site, stage) {
  const everything = site.switches.platform_serves === 'everything';
  for (const [path, set] of CLASSIFIED) {
    const home = site.homeOrigin(path), served = site.servingOrigin(path);
    assert.equal(site.pageSet(path), set, `${stage} ${path}: its set`);
    assert.notEqual(home, COMPANY, `${stage} ${path}: no page is homed on the company's tenant`);
    assert.notEqual(served, COMPANY, `${stage} ${path}: no page is served from the company's tenant`);
    if (set === 'platform') assert.equal(home, NEXT, `${stage} ${path}: a platform page lives on the new platform`);
    else assert.equal(home, PROFILE, `${stage} ${path}: Matthew's pages stay his`);
    if (set === 'profile_only') assert.equal(served, PROFILE, `${stage} ${path}: profile_only never leaves his host`);
    else if (everything) assert.equal(served, NEXT, `${stage} ${path}: the new platform serves it`);
    else assert.ok([NEXT, PROFILE].includes(served), `${stage} ${path}: served by the platform or where it is now`);
  }
  for (const path of ['/company', '/news', '/news/a-headline-123']) {
    assert.equal(site.homeOrigin(path), COMPANY, `${stage} ${path}: the company's own page stays on its host`);
    assert.equal(site.servingOrigin(path), COMPANY);
  }
  assert.equal(site.platform.world_url, `${NEXT}/`, 'the World is the new platform\'s root');
  assert.deepEqual([...site.world_hosts], ['equityuprise.com', 'www.equityuprise.com', 'humanuprise.com', 'www.humanuprise.com']);
  assert.ok(!site.isWorldHost('mccluster.org') && !site.isWorldHost('www.mccluster.org'), 'mccluster.org is no longer a World host');
  assert.equal(plain(site.hostRole('equityuprise.com')).role, 'platform');
  assert.deepEqual(plain(site.hostRole('mccluster.org')), { role: 'tenant', host: 'mccluster.org', origin: COMPANY, key: 'company' });
  assert.equal(plain(site.hostRole('www.mccluster.org')).to_origin, COMPANY);
  assert.equal(plain(site.hostRole('matthew.mccluster.org')).key, 'matthew');
  assert.deepEqual([...site.return_origins].sort(), [COMPANY, NEXT, PROFILE].sort());
  assert.equal(site.returnOrigin('https://evil.example'), everything ? NEXT : PROFILE);
  assert.ok(site.frame_ancestors.includes(NEXT) && site.frame_ancestors.includes(PROFILE));
  assert.equal(site.cookie_domain, 'mccluster.org', 'the shared privacy cookie stays Matthew\'s registrable domain; the new platform asks once');
  assert.equal(site.ids.organization, record.entities.mccluster_corp.id, 'no @id moves');
  assert.equal(site.entity_urls.organization, 'https://mccluster.org/', 'the Organization\'s url stays the company\'s');
}

test('the equityuprise rewrite: every classified path resolves, and nothing answers a host it should not', async () => {
  const F = rewritten();
  for (const stage of ['P0', 'P1', 'P2', 'P3', 'P4']) {
    const table = siteTable(F, { stage });
    checkRewrite(worker.makeSite(table), stage);
    /* and the generated code itself, rendered for the rewritten record, answers the same */
    const mod = await moduleFrom(renderWorker(table));
    checkRewrite(mod.SITE, `${stage} (rendered Worker module)`);
    const window = {};
    vm.runInNewContext(renderClientBlock(table), { window });
    checkRewrite(window.MCC_SITE, `${stage} (rendered page block)`);
    assert.deepEqual(answers(window.MCC_SITE), answers(mod.SITE));
  }
  const dir = mkdtempSync(join(tmpdir(), 'site-hosts-ts-'));
  try {
    const file = join(dir, 'site-hosts.ts');
    writeFileSync(file, renderFunctions(siteTable(F, { stage: 'P1' })));
    const ts = await import(pathToFileURL(file).href);
    checkRewrite(ts.SITE, 'P1 (rendered functions module)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const text = renderWorker(siteTable(F));
  const platformLines = text.split('\n').filter((l) => l.includes('"origin": "https://mccluster.org"'));
  assert.equal(platformLines.length, 1, 'mccluster.org is named as an origin once: the company\'s tenant');
});
