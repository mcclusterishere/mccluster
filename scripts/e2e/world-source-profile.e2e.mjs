/* The shipped World source sheet, its mission dialog and history, with synthetic backend answers. No production request,
   account or mutation. Uses the catalog's actual imported rows to check all nine areas and their credits. The globe's renderer
   is omitted: this proof covers the page and its integration, not Cesium or physical Safari. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missionRow, detailsRow } from '../../tools/build-mission-import.mjs';
import { startServer, loadChromium, openWorld, DEVICES, SB, API, LAUNCH } from './support/world-gate-harness.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'world-source-profile');
const CATALOG = JSON.parse(await readFile(join(ROOT, 'data/missions/drawdown/missions.json'), 'utf8')).missions;
const MISSIONS = CATALOG.map((m) => ({ ...missionRow(m), status: 'open', created_at: '2026-11-17T12:00:00Z', action_mission_details: detailsRow(m) }));
const DETAILS = CATALOG.map(detailsRow);
const ORG = { id: '7d0e0000-0000-4000-8000-00000000d0d0', slug: 'project-drawdown', name: 'Project Drawdown', website_url: 'https://drawdown.org/', organization_type: 'nonprofit' };
const SOURCE = { catalog: 'drawdown', organization_id: ORG.id, role_line: 'Missions written by McCluster Corp from Project Drawdown’s climate solutions.', facts: [{ label: 'Organization', value: '501(c)(3) nonprofit', source: 'https://drawdown.org/about' }], facts_read_on: '2026-11-19', shown_at: '2026-11-19T10:00:00Z' };
const DRAFT = { ...MISSIONS[0], id: '0e1f0000-0000-4000-8000-000000000099', title: 'Private draft must stay out', status: 'draft' };
const results = [];
function check(scope, name, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ scope, name, ok, ...(ok ? {} : { actual, expected }) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}`);
  assert.deepEqual(actual, expected, name);
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
const server = await startServer();
const browser = await loadChromium().launch({ ...LAUNCH, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
await mkdir(OUT, { recursive: true });

async function open(width, options = {}) {
  const state = { sourceReads: [], orgReads: 0, missionReads: [], ownerReads: 0, failMissions: !!options.failMissions };
  const beforeNavigate = async ({ ctx }) => {
    const stub = (url, handler) => ctx.route(url, (route) => route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: cors }) : handler(route));
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.base });
    await ctx.route('**/*', (route) => {
      const origin = new URL(route.request().url()).origin;
      return [server.base, SB, API].includes(origin) ? route.fallback() : route.abort();
    });
    await stub(SB + '/rest/v1/mission_catalog_sources**', (route) => {
      state.sourceReads.push(Object.fromEntries(new URL(route.request().url()).searchParams));
      if (options.absent) return json(route, { code: 'PGRST205', message: 'Missing table in fixture' }, 404);
      return json(route, options.hidden ? [] : [SOURCE]);
    });
    await stub(SB + '/rest/v1/network_organizations**', (route) => {
      state.orgReads++;
      return json(route, [ORG, { ...ORG, id: '7d0e0000-0000-4000-8000-0000000000a1', slug: 'unrelated-organization', name: 'Unrelated organization' }]);
    });
    await stub(SB + '/rest/v1/action_missions**', (route) => {
      const u = new URL(route.request().url());
      if (u.searchParams.has('action_mission_details.catalog')) {
        state.missionReads.push(Object.fromEntries(u.searchParams));
        if (state.failMissions) { state.failMissions = false; return json(route, { message: 'Fixture unavailable' }, 503); }
        return json(route, [...MISSIONS, DRAFT]);
      }
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      return json(route, id ? MISSIONS.filter((m) => m.id === id) : MISSIONS);
    });
    await stub(SB + '/rest/v1/action_mission_details**', (route) => {
      const filter = new URL(route.request().url()).searchParams.get('mission_id') || '';
      return json(route, DETAILS.filter((d) => !filter || filter.includes(d.mission_id)));
    });
    await stub(API + '/v1/mission-sources', (route) => {
      state.ownerReads++;
      if (options.denied) return json(route, { error: 'Forbidden' }, 403);
      return json(route, { ok: true, store: 'applied', sources: [{ ...SOURCE, state: 'draft', revision: 1, shown_at: null, organization: ORG, open_missions: 125 }], history: [] });
    });
  };
  const path = options.path || '/mnet.html?source=project-drawdown';
  const w = await openWorld(browser, server.base, DEVICES[width], path, { globe: false, missions: MISSIONS, dpr: 1, reduced: true, phase: options.phase || 'night', member: !!options.member, beforeNavigate });
  return { ...w, state };
}
const ready = async (p) => { await p.waitForSelector('#mnSourceDialog[open]'); await p.waitForFunction(() => document.querySelectorAll('#mnSourceAreas [data-area]').length === 10); };
async function fit(p) {
  return p.evaluate(() => {
    const d = document.getElementById('mnSourceDialog'), r = d.getBoundingClientRect();
    return { viewport: document.documentElement.scrollWidth === document.documentElement.clientWidth, sheet: d.scrollWidth === d.clientWidth, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, input: parseFloat(getComputedStyle(document.getElementById('mnSourceSearch')).fontSize) >= 16 };
  });
}

try {
  const widths = (process.env.SOURCE_PROFILE_WIDTHS || '390,820,1280').split(',').map(Number);
  for (const width of widths) {
    const scope = String(width), w = await open(width), p = w.page;
    try {
      await ready(p);
      check(scope, 'the source sheet names its maker and the source without implying endorsement', await p.locator('#mnSourceTrust').textContent(), 'Made by McCluster Corp, which runs this platform. Project Drawdown does not run or pay for this page and has not endorsed this platform.');
      check(scope, 'all 125 open missions are indexed; a returned draft stays out', await p.locator('#mnSourceAreas [data-area="all"] .mn__source-area-count').textContent(), '125');
      check(scope, 'nine site-defined areas and one All entry', await p.locator('#mnSourceAreas [data-area]').count(), 10);
      check(scope, 'the public source read is made once and names only shown rows', w.state.sourceReads.map((q) => q.state), ['eq.shown']);
      check(scope, 'the mission read is catalog-scoped and open-only', w.state.missionReads.every((q) => q.status === 'eq.open' && q['action_mission_details.catalog'] === 'eq.drawdown'));
      check(scope, 'no unrelated organization or private draft reaches the sheet', !/Unrelated organization|Private draft/.test(await p.locator('#mnSourceBody').textContent()));
      check(scope, 'fits the screen without horizontal overflow and keeps the field at 16 px', await fit(p), { viewport: true, sheet: true, inside: true, input: true });
      check(scope, 'no source logo or image', await p.locator('#mnSourceDialog img, #mnSourceDialog canvas').count(), 0);
      await p.screenshot({ path: join(OUT, scope + '-source.png') });
      await p.locator('#mnSourceBody [data-act="share"]').click();
      await p.waitForFunction(() => document.querySelector('#mnSourceBody .mn__source-copied').textContent === 'Copied');
      check(scope, 'Share uses the canonical World source link', await p.evaluate(() => navigator.clipboard.readText()), 'https://mccluster.org/?source=project-drawdown');
      await p.locator('#mnSourceAreas [data-area="all"]').click();
      await p.locator('#mnSourceSearch').fill('insulation');
      await p.waitForFunction(() => /insulation/.test(document.getElementById('mnSourceStatus').textContent));
      check(scope, 'search finds the catalog mission and keeps the dialog open', await p.locator('#mnSourceResults [data-mission]').count() > 0);
      await p.keyboard.press('Escape');
      check(scope, 'first Escape clears the search and preserves the source page', await p.evaluate(() => [document.getElementById('mnSourceDialog').open, document.getElementById('mnSourceSearch').value]), [true, '']);
      const row = p.locator('#mnSourceResults [data-mission]').first(), id = await row.getAttribute('data-mission');
      await row.click();
      await p.waitForSelector('#mnMissionDialog[open]');
      check(scope, 'a mission opens above its source page with Join and credit', await p.evaluate(() => [document.getElementById('mnSourceDialog').open, !document.getElementById('mnMissionJoin').hidden, !!document.getElementById('mnMissionCredit')]), [true, true, true]);
      await p.locator('#mnMissionClose').click();
      await p.waitForFunction(() => !document.getElementById('mnMissionDialog').open && new URLSearchParams(location.search).get('source') === 'project-drawdown');
      check(scope, 'closing the mission returns to its source page', await p.locator('#mnSourceDialog').evaluate((d) => d.open));
      check(scope, 'focus returns to the mission row', await p.evaluate(() => document.activeElement.getAttribute('data-mission')), id);
      await p.locator('#mnSourceBody [data-act="close"]').click();
      await p.waitForFunction(() => !document.getElementById('mnSourceDialog').open && !new URLSearchParams(location.search).has('source'));
      check(scope, 'closing a landed source leaves its source keys out of the address', !new URL(p.url()).searchParams.has('source'));
      check(scope, 'no script errors', w.world.errors, []);
    } finally { await w.ctx.close(); }
  }

  const door = await open(390, { path: '/mnet.html?mission=' + MISSIONS[0].id });
  try {
    await door.page.waitForSelector('#mnMissionDialog[open]');
    check('door', 'a deep-linked mission waits for its credit before opening', await door.page.locator('#mnMissionCredit').count(), 1);
    await door.page.locator('#mnMissionSource button').click();
    await ready(door.page);
    check('door', 'the mission source door opens the source page and closes the mission', await door.page.evaluate(() => [document.getElementById('mnSourceDialog').open, document.getElementById('mnMissionDialog').open, new URLSearchParams(location.search).get('source')]), [true, false, 'project-drawdown']);
    check('door', 'opening the source reuses its shown-source read', door.state.sourceReads.length, 1);
    check('door', 'no script errors', door.world.errors, []);
  } finally { await door.ctx.close(); }

  for (const mode of ['hidden', 'absent', 'denied']) {
    const w = await open(390, { [mode]: true, member: mode === 'denied', path: '/mnet.html?source=project-drawdown' + (mode === 'denied' ? '&preview=1' : '') });
    try {
      await w.page.waitForFunction(() => document.body.innerText.includes('That page is not available.'));
      check(mode, 'the unavailable source has no public sheet', await w.page.locator('#mnSourceDialog').evaluate((d) => !d.open));
      check(mode, 'no unlinked organization is read', w.state.orgReads, 0);
      check(mode, 'no script errors', w.world.errors, []);
    } finally { await w.ctx.close(); }
  }

  const preview = await open(390, { member: true, path: '/mnet.html?source=project-drawdown&preview=1' });
  try {
    await ready(preview.page);
    check('preview', 'owner preview is visibly private', await preview.page.locator('.mn__source-preview').textContent(), 'Preview. This page is not public yet; only you can see it.');
    check('preview', 'a draft has no Share button', await preview.page.locator('#mnSourceBody [data-act="share"]').count(), 0);
    check('preview', 'preview uses the owner route', preview.state.ownerReads, 1);
    check('preview', 'preview makes no shown-source read', preview.state.sourceReads.length, 0);
  } finally { await preview.ctx.close(); }

  const retry = await open(390, { failMissions: true, phase: 'day' });
  try {
    await retry.page.locator('#mnSourceBody [data-act="retry"]:visible').first().click();
    await ready(retry.page);
    check('recovery', 'a failed mission read can be retried', retry.state.missionReads.length, 2);
    check('recovery', 'the recovered daytime page fits the phone', await fit(retry.page), { viewport: true, sheet: true, inside: true, input: true });
    await retry.page.screenshot({ path: join(OUT, '390-source-day.png') });
  } finally { await retry.ctx.close(); }
} finally {
  await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  await browser.close();
  await server.close();
}
console.log(`${results.length}/${results.length} source-profile browser checks passed`);
