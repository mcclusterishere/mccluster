/* Control › System › E=Up › Environmental events, the browser proof (E=UP event timeline slice S2, 2026-11-19). The real
   control.html and its scripts, the owner signed in, against the in-process environment OWNER plane
   (scripts/test/support/eup-environment-owner-plane.mjs: the REAL Worker router over the REAL module policy and the five
   PENDING store parts in PGlite, the providers as small built answers; its header says what is emulated). Never touches
   production. At 390, 820 and 1440:
     the sixth local tab reads source health, the review queue and the preview; per source, the public state (off while the
     module is not installed) and the provider's own state (reporting, no data, off for FIRMS without its key) in words;
     the USGS rule set by keyboard alone (reason, Tab, Tab, Enter) with the revision that was read and a fresh key, read back;
     an event opened from the queue, held, restored to an older revision as a new one (rollback), released; a command whose
     answer is lost (committed, connection dropped) settled by its key in the decision log, never resent; a revision moved
     elsewhere refused as a conflict that changed nothing; the owner preview while the module is off; the decision log;
     no horizontal overflow (scrollWidth === clientWidth) at every step; every button at least 44 px and every field at
     least 16 px type.
   Once, at 390: the store not applied (every view says so and offers no command; the providers are still checked), and a
   plain member concealed (403).
   Two writes the page does not make are labelled: the USGS events the ingest would write (the ingest is a later slice) and
   one change made elsewhere (a later USGS revision), both through the plane.
   PGLITE_MODULE=<pglite dist/index.js> PLAYWRIGHT_DIR=<node_modules> node scripts/e2e/control-eup-environment.e2e.mjs [outDir] */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SERVE = resolve(process.env.MCC_SERVE_ROOT || ROOT);
const OUT = process.argv[2] || '/tmp/control-eup-environment-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const BASE = 'https://matthew.mccluster.org';
const ORG = '11111111-1111-4111-8111-222222222222';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const results = [];
function check(scope, name, condition, detail) { results.push({ scope, name, pass: !!condition }); console.log((condition ? 'PASS ' : 'FAIL ') + '[' + scope + '] ' + name + (condition ? '' : ' ' + JSON.stringify(detail))); }
await mkdir(OUT, { recursive: true });
if (!process.env.PGLITE_MODULE) { check('setup', 'PGLITE_MODULE is set: the proof runs over the in-process plane and is never skipped', false, 'PGLITE_MODULE unset'); process.exit(1); }
const { createEnvironmentOwnerPlane, usgsEvent } = await import('../test/support/eup-environment-owner-plane.mjs');
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'cache-control': 'private, no-store' }, body: JSON.stringify(body) });
const sub = (h) => { try { return JSON.parse(Buffer.from(String(h || '').replace(/^Bearer\s+/i, '').split('.')[1], 'base64').toString('utf8')); } catch { return null; } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function setup(viewport, plane, who = 'owner') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 1000, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const errors = [];
  await ctx.addInitScript(() => { localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() })); });
  await ctx.addInitScript(plane.sessionScript(who));
  /* the test's own route, registered FIRST: static files and the shell's other calls; the plane's route (attached after it)
     wins for /v1/eup* on the API origin */
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.origin === 'https://api.mccluster.org') {
      const w = sub(req.headers().authorization);
      if (p === '/v1/status') return json(route, { ok: true, operator: { email: w?.email || 'owner@plane.invalid' }, database: { reachable: true } });
      if (p === '/v1/workspaces/me') return json(route, { ok: true, profile: { id: w?.sub }, default_org_id: ORG, workspaces: [{ org_id: ORG, slug: 'mccluster', kind: 'studio', role: 'owner', enabled: true, name: 'McCluster' }] });
      if (p === '/v1/mnet/bootstrap') return json(route, { identity: { mccluster_id: 'matthew' }, profile: { display_name: 'Plane owner', avatar_url: '' } });
      return json(route, { ok: true, threads: [], apps: [], events: [], jobs: [], tools: [], decisions: [], leads: [], total: 0 });
    }
    if (u.hostname.endsWith('supabase.co')) {
      if (p === '/auth/v1/user') { const w = sub(req.headers().authorization); return w ? json(route, { id: w.sub, email: w.email }) : json(route, { msg: 'invalid' }, 401); }
      return json(route, []);
    }
    if (u.origin === BASE) {
      const rel = p === '/' ? 'index.html' : decodeURIComponent(p.replace(/^\//, '')); const file = resolve(SERVE, rel);
      if (!file.startsWith(SERVE + sep)) return route.abort();
      try { return route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404, body: '' }); }
    }
    return route.abort(); /* the Cesium CDN included: the globe says it did not load; the cards still work */
  });
  await plane.attach(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
const attr = (page, sel, name) => page.evaluate(([s, n]) => document.querySelector(s)?.getAttribute(n) ?? null, [sel, name]);
const focusIs = (page, sel) => page.evaluate((s) => !!document.activeElement && document.activeElement.matches(s), sel);
async function openTab(page) {
  await page.goto(BASE + '/control.html#system:eup');
  await page.locator('[data-eup]').waitFor();
  await page.locator('[data-eup-tab="environment"]').click();
  await page.locator('[data-eup-env]').waitFor();
  await page.waitForFunction(() => /^Checked /.test(document.querySelector('[data-eup-env-checked]')?.textContent || ''));
}
async function view(page, id) {
  await page.locator('[data-eup-env-tab="' + id + '"]').click();
  await page.waitForFunction((v) => document.querySelector('[data-eup-env-view]')?.getAttribute('data-eup-env-view') === v, id);
}
async function sizes(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-eup-env]');
    const buttons = [...host.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => ({ t: b.textContent.trim().slice(0, 40), h: Math.round(b.getBoundingClientRect().height) }));
    const fields = [...host.querySelectorAll('input:not([type="checkbox"])')].filter((i) => i.offsetParent !== null).map((i) => ({ f: parseFloat(getComputedStyle(i).fontSize), h: Math.round(i.getBoundingClientRect().height), labelled: !!i.labels && i.labels.length === 1 }));
    return { buttons, fields };
  });
}

async function proof(width) {
  const scope = String(width);
  const plane = await createEnvironmentOwnerPlane();
  let ctx = null;
  try {
    const s = await setup({ width, height: 900 }, plane); ctx = s.ctx; const { page, errors } = s;
    const noOverflow = async (what) => check(scope, 'no horizontal overflow (' + what + ')', await overflow(page));
    await openTab(page);
    check(scope, 'the sixth local tab is selected and its panel names it', await attr(page, '[data-eup-tab="environment"]', 'aria-selected') === 'true' && await attr(page, '#eupPane', 'aria-labelledby') === 'eupTab-environment');
    check(scope, 'the module was never installed: the public routes are off, in words', await attr(page, '[data-eup-env-module]', 'data-eup-env-module') === 'off' && /not installed\. The public routes answer 404 module_disabled: off\./.test(await page.locator('[data-eup-env-module]').innerText()));
    check(scope, 'the store is applied (the pending parts, in PGlite)', await attr(page, '[data-eup-env-store]', 'data-eup-env-store') === 'applied');
    const states = await page.evaluate(() => [...document.querySelectorAll('[data-eup-env-source]')].map((x) => [x.getAttribute('data-eup-env-public'), x.getAttribute('data-eup-env-now')]));
    check(scope, 'seven sources, each off to the public while the module is off', states.length === 7 && states.every(([p]) => /:off$/.test(p)), states);
    check(scope, 'the providers now: USGS, EONET and CO-OPS reporting, NWS, NHC and NIFC no data, FIRMS off without its key', JSON.stringify(states.map(([, n]) => n)) === JSON.stringify(['usgs:reporting', 'nws:no_data', 'nhc:no_data', 'eonet:reporting', 'firms:off', 'wfigs:no_data', 'coops:reporting']), states);
    check(scope, 'FIRMS is never asked without its key', !plane.providerCalls.includes('firms.modaps.eosdis.nasa.gov'));
    check(scope, 'no data and off are written out, never colour alone', /No data: it answered with nothing\./.test(await page.locator('[data-eup-env-source="nws"]').innerText()) && /Off: not configured here\./.test(await page.locator('[data-eup-env-source="firms"]').innerText()));
    await noOverflow('sources');
    const sz = await sizes(page);
    check(scope, 'every button in the tab is at least 44 px tall', sz.buttons.length > 0 && sz.buttons.every((b) => b.h >= 44), sz.buttons);
    check(scope, 'every field is labelled, at least 44 px tall and at least 16 px type', sz.fields.length > 0 && sz.fields.every((f) => f.f >= 16 && f.h >= 44 && f.labelled), sz.fields);
    await page.locator('[data-eup-env-source="usgs"]').screenshot({ path: join(OUT, 'env-sources-usgs-' + width + '.png') });

    /* the USGS rule by keyboard alone: the reason, Tab past "Set this rule", Enter on "Set the default rule" */
    const before = plane.log.filter((x) => x.method === 'POST').length;
    await page.locator('[data-eup-env-setrule="default"]').focus(); await page.keyboard.press('Enter');
    await page.locator('[data-eup-env-outcome="provider:usgs|error"]').waitFor();
    check(scope, 'without a reason nothing is sent and focus returns to the reason', plane.log.filter((x) => x.method === 'POST').length === before && await focusIs(page, '[data-eup-env-reason="provider:usgs"]'));
    await page.keyboard.type('Set the default publication rule for the first USGS slice');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    check(scope, 'two Tab stops from the reason reach "Set the default rule"', await focusIs(page, '[data-eup-env-setrule="default"]'));
    await page.keyboard.press('Enter');
    await page.locator('[data-eup-env-outcome="provider:usgs|done"]').waitFor();
    await page.locator('[data-eup-env-provider-command="pause_provider"]').waitFor();
    const rule = (await plane.call('owner', 'GET', '/v1/eup/environment/review')).body.providers.find((p) => p.provider === 'usgs');
    check(scope, 'the rule is stored: revision 1, the D7 default, the decision carries the reason that was typed', rule.revision === 1 && rule.rule.min_magnitude === 4.5 && (await plane.call('owner', 'GET', '/v1/eup/environment/review')).body.decisions[0].reason === 'Set the default publication rule for the first USGS slice');
    check(scope, 'the store line reads back the rule', /rule rev 1 set; no ingest run recorded yet/.test(await page.locator('[data-eup-env-store-line="usgs"]').innerText()));
    await noOverflow('rule set');

    /* a write the page does not make: what the ingest (a later slice) would write, through the store's own entry point */
    await plane.store.ingest([usgsEvent({ provider_id: 'us7000e2e1', magnitude: 5.2 }), usgsEvent({ provider_id: 'us7000e2e2', magnitude: 3.1, significance: 150, observed_at: '2026-11-18T09:00:00.000Z' })]);
    await plane.store.ingest([usgsEvent({ provider_id: 'us7000e2e1', magnitude: 5.6, source_updated_at: '2026-11-18T11:00:00.000Z' })]);
    await view(page, 'review');
    await page.locator('[data-eup-env-reload]').click();
    await page.locator('[data-eup-env-queue="corrected"] [data-eup-env-open="usgs:us7000e2e1"]').waitFor();
    check(scope, 'the queue lists the candidate that does not qualify and the corrected event', /does not qualify under the current rule/.test(await page.locator('[data-eup-env-queue="candidates"]').innerText()) && await page.locator('[data-eup-env-queue="corrected"] [data-eup-env-item="usgs:us7000e2e1"]').count() === 1);
    await page.locator('[data-eup-env-queue="corrected"] [data-eup-env-open="usgs:us7000e2e1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-eup-env-event]')?.getAttribute('data-eup-env-event-state') === 'published:2');
    check(scope, 'opening an event moves focus to it', await focusIs(page, '[data-eup-env-event]'));
    const reason = page.locator('[data-eup-env-reason="event:usgs:us7000e2e1"]');
    await reason.fill('Hold while the magnitude correction is checked');
    await page.locator('[data-eup-env-event-command="hold"]').click();
    await page.waitForFunction(() => document.querySelector('[data-eup-env-event]')?.getAttribute('data-eup-env-event-state') === 'held:2');
    check(scope, 'hold: recorded, read back, the revision unchanged', /recorded · state held · rev 2/.test(await page.locator('[data-eup-env-outcome="event:usgs:us7000e2e1|done"]').innerText()));
    await reason.fill('The correction to 5.6 was a mistake; restore the first reading');
    await page.locator('[data-eup-env-rollback="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-eup-env-event]')?.getAttribute('data-eup-env-event-state') === 'held:3');
    const ev = (await plane.call('owner', 'GET', '/v1/eup/environment/events/' + encodeURIComponent('usgs:us7000e2e1'))).body.event;
    check(scope, 'rollback: revision 1 restored as revision 3, cause owner_rollback, linked to its decision', ev.summary.revision === 3 && ev.summary.magnitude === 5.2 && ev.revisions[0].cause === 'owner_rollback' && ev.revisions[0].decision_seq === ev.decisions.find((d) => d.command === 'rollback').seq, ev.revisions);
    check(scope, 'the page lists revision 3 with its change, old to new', /rev 3 · owner_rollback .*magnitude 5\.6 → 5\.2/.test(await page.locator('[data-eup-env-revisions]').innerText()));
    await reason.fill('Release after the check');
    await page.locator('[data-eup-env-event-command="release"]').click();
    await page.waitForFunction(() => document.querySelector('[data-eup-env-event]')?.getAttribute('data-eup-env-event-state') === 'published:3');
    await noOverflow('event open');
    await page.locator('[data-eup-env-event]').screenshot({ path: join(OUT, 'env-event-' + width + '.png') });

    /* a lost answer: the plane serves and commits the withdrawal, then drops the connection */
    const posts = plane.log.filter((x) => x.method === 'POST').length;
    plane.faults.add({ method: 'POST', path: '/v1/eup/environment/commands', mode: 'drop' });
    await reason.fill('Withdraw: test of a lost answer');
    await page.locator('[data-eup-env-event-command="retract"]').click();
    await page.waitForFunction(() => /was recorded: its key is in the decision log/.test(document.querySelector('[data-eup-env-outcome^="event:usgs:us7000e2e1|"]')?.textContent || ''));
    check(scope, 'a lost answer is settled by its key in the decision log and never resent', plane.log.filter((x) => x.method === 'POST').length === posts + 1 && await page.locator('[data-eup-env-resend]').count() === 0);
    await page.waitForFunction(() => document.querySelector('[data-eup-env-event]')?.getAttribute('data-eup-env-event-state') === 'retracted:3');
    await reason.fill('Restore after the lost-answer test');
    await page.locator('[data-eup-env-event-command="restore"]').click();
    await page.waitForFunction(() => document.querySelector('[data-eup-env-event]')?.getAttribute('data-eup-env-event-state') === 'published:3');

    /* a change made elsewhere: USGS revises the event while the page still shows revision 3 */
    await plane.store.ingest([usgsEvent({ provider_id: 'us7000e2e1', magnitude: 5.9, source_updated_at: '2026-11-18T12:00:00.000Z' })]);
    await reason.fill('Hold, against a revision that has moved');
    await page.locator('[data-eup-env-event-command="hold"]').click();
    await page.locator('[data-eup-env-outcome="event:usgs:us7000e2e1|conflict"]').waitFor();
    check(scope, 'a moved revision is a conflict that changed nothing', /changed elsewhere since it was read\. This command changed nothing/.test(await page.locator('[data-eup-env-outcome="event:usgs:us7000e2e1|conflict"]').innerText()));
    await page.waitForFunction(() => document.querySelector('[data-eup-env-event]')?.getAttribute('data-eup-env-event-state') === 'published:4');
    check(scope, 'the event is read again at the new revision', true);
    await noOverflow('conflict');

    await view(page, 'preview');
    await page.locator('[data-eup-env-preview-item]').first().waitFor();
    check(scope, 'the owner preview says the public is off and lists the projection', /The public now: off \(404\)\./.test(await page.locator('[data-eup-env-preview-public]').innerText()) && await page.locator('[data-eup-env-preview-item^="usgs:us7000e2e1:4:published"]').count() === 1);
    const pub = (await plane.call('owner', 'GET', '/v1/eup/environment/preview')).body.events.map((e) => e.id + ':' + e.revision + ':' + e.state);
    check(scope, 'the page lists exactly the projection the store gives', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-eup-env-preview-item]')].map((x) => x.getAttribute('data-eup-env-preview-item')))) === JSON.stringify(pub), pub);
    await noOverflow('preview');
    await view(page, 'decisions');
    /* six decisions: the rule, hold, rollback, release, withdraw (its answer lost), restore; the refused hold is not one */
    check(scope, 'the decision log lists every decision with its reason, and nothing the store refused', (await page.locator('[data-eup-env-decisions] li').count()) === 6 && /reason: Release after the check/.test(await page.locator('[data-eup-env-decisions]').innerText()));
    await noOverflow('decisions');
    await page.screenshot({ path: join(OUT, 'env-decisions-' + width + '.png') });
    check(scope, 'no page error', errors.length === 0, errors);
  } catch (e) {
    check(scope, 'the proof ran to the end', false, String(e && e.stack || e).slice(0, 600));
  } finally { if (ctx) await ctx.close().catch(() => {}); await plane.close(); }
}

async function notApplied() {
  const scope = '390 store not applied';
  const plane = await createEnvironmentOwnerPlane({ apply: false });
  let ctx = null;
  try {
    const s = await setup({ width: 390, height: 900 }, plane); ctx = s.ctx; const { page } = s;
    await openTab(page);
    check(scope, 'the store not applied is said; the module and the providers are still shown', await attr(page, '[data-eup-env-store]', 'data-eup-env-store') === 'not_applied' && (await page.locator('[data-eup-env-source]').count()) === 7);
    check(scope, 'no command is offered', await page.locator('[data-eup-env-setrule],[data-eup-env-provider-command]').count() === 0);
    for (const id of ['review', 'preview', 'decisions']) {
      await view(page, id);
      check(scope, id + ' says not applied and offers nothing', /not applied/.test(await page.locator('[data-eup-env-view]').innerText()) && await page.locator('[data-eup-env-view] button').count() === 0);
    }
    check(scope, 'no horizontal overflow', await overflow(page));
    check(scope, 'nothing was sent', plane.log.filter((x) => x.method === 'POST').length === 0);
    await page.screenshot({ path: join(OUT, 'env-not-applied-390.png') });
  } catch (e) { check(scope, 'the proof ran to the end', false, String(e && e.stack || e).slice(0, 600)); } finally { if (ctx) await ctx.close().catch(() => {}); await plane.close(); }
  const denied = await createEnvironmentOwnerPlane();
  try {
    const s = await setup({ width: 390, height: 900 }, denied, 'peer'); ctx = s.ctx; const { page } = s;
    await page.goto(BASE + '/control.html#system:eup');
    await page.locator('[data-eup]').waitFor();
    await page.waitForFunction(() => /House owner access required/.test(document.querySelector('[data-eup-pane]')?.textContent || ''));
    check('390 plain member', 'a plain member is concealed: the owner routes answer 403 and nothing of the tab is drawn', await page.locator('[data-eup-env]').count() === 0);
  } catch (e) { check('390 plain member', 'the proof ran to the end', false, String(e && e.stack || e).slice(0, 600)); } finally { if (ctx) await ctx.close().catch(() => {}); await denied.close(); }
}

try {
  await notApplied();
  for (const width of [390, 820, 1440]) await proof(width);
} finally { await browser.close(); }
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length || results.length === 0 ? 1 : 0);
