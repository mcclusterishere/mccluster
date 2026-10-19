/* Guest directions and phone controls against the actual World document.
   All APIs, GPS fixes and imagery are deterministic fixtures. No production
   requests, database writes or physical-navigation claims.

   PLAYWRIGHT_DIR=/path/to/node_modules CESIUM_DIR=/path/to/Build/Cesium
   PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chromium node scripts/e2e/world-travel-guest.e2e.mjs [outDir]
   CESIUM_DIR must contain the pinned 1.131 build used by action-globe.html. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'world-travel-guest');
const CESIUM = process.env.CESIUM_DIR;
assert.ok(CESIUM, 'CESIUM_DIR is required for an offline, pinned renderer');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }
const fixture = JSON.parse(await readFile(join(ROOT, 'scripts/e2e/fixtures/travel-new-haven-routes.json'), 'utf8'));
const origin = fixture.routes[0].origin, destination = fixture.routes[0].destination;
const tile = await readFile(join(CESIUM, 'Assets/Textures/NaturalEarthII/1/3/1.jpg'));
const BASE = 'https://mccluster.org', AUDIO_PARENT = 'https://matthew.mccluster.org'; // Intercepted in memory; no external navigation.
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.webp':'image/webp', '.wasm':'application/wasm' };
const reports = [];
function check(scope, message, condition, detail) {
  assert.ok(condition, `[${scope}] ${message}${detail ? ': ' + JSON.stringify(detail) : ''}`);
  reports.push({ scope, message }); console.log(`PASS [${scope}] ${message}`);
}
const json = (r, body, status = 200) => r.fulfill({ status, contentType:'application/json', headers:{ 'access-control-allow-origin':'*', 'access-control-allow-headers':'*', 'access-control-allow-methods':'*' }, body:JSON.stringify(body) });
await mkdir(OUT, { recursive:true });
const browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, headless:true, args:['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(viewport, { automatic = false, webgl = true, audioParent = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor:1, isMobile:viewport.width < 600, hasTouch:viewport.width < 600, reducedMotion:'reduce' });
  await ctx.addInitScript(({ automatic, origin }) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version:'2026-09-26', accepted_at:new Date().toISOString() }));
    if (!automatic) sessionStorage.setItem('wt_location_asked', '1');
    // Keep the separately approved analytics location feature out of this
    // travel interaction test, without changing shipping analytics code.
    Object.defineProperty(navigator, 'doNotTrack', { value:'1', configurable:true });
    let nextId = 0, timestamp = Date.now(); const watches = new Map(), pending = [];
    const geo = window.__geo = { calls:[], cleared:[], answer:automatic ? 'hold' : 'deny', coordinates:origin };
    const position = (coordinates = geo.coordinates) => ({ coords:{ longitude:coordinates[0], latitude:coordinates[1], accuracy:8 }, timestamp:timestamp = Math.max(Date.now(), timestamp + 1) });
    const respond = (success, error, answer) => {
      if (answer === 'hold') { pending.push({ success, error }); return; }
      setTimeout(() => answer === 'grant' ? success(position()) : error({ code:answer === 'deny' ? 1 : 3 }), 40);
    };
    geo.release = answer => { for (const call of pending.splice(0)) respond(call.success, call.error, answer); };
    geo.emit = coordinates => { for (const call of watches.values()) call.success(position(coordinates)); };
    geo.failWatch = () => { for (const call of [...watches.values()]) call.error({ code:1 }); };
    geo.watchCount = () => watches.size;
    Object.defineProperty(navigator, 'geolocation', { configurable:true, value:{
      getCurrentPosition(success, error, options) { geo.calls.push({ kind:'once', ...options }); respond(success, error, geo.answer); },
      watchPosition(success, error, options) { const id = ++nextId; geo.calls.push({ kind:'watch', ...options }); watches.set(id, { success, error }); return id; },
      clearWatch(id) { watches.delete(id); geo.cleared.push(id); }
    } });
  }, { automatic, origin });
  const requests = [], errors = [], held = [];
  let response = 'route';
  await ctx.route('**/*', async r => {
    const req = r.request(), url = new URL(req.url());
    if (url.origin === AUDIO_PARENT && url.pathname === '/__travel-audio-parent') return r.fulfill({ status:200, contentType:'text/html', body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%}iframe{position:fixed;inset:0;border:0;width:100%;height:100%}#audioFixtureDock{position:fixed;inset:auto 0 0;height:176px;background:#111820;z-index:5;color:white;display:grid;place-items:center;font:16px system-ui}</style></head><body><iframe id="retainedWorld" src="${BASE}/?view=feed&mcc_audio=1" allow="geolocation; autoplay; fullscreen"></iframe><div id="audioFixtureDock">Playback and navigation controls</div><script>const child=document.getElementById('retainedWorld');window.audioReady=false;window.audioSend=data=>child.contentWindow.postMessage({channel:'mcc-world-audio-v1',id:'travel-proof',...data},'${BASE}');addEventListener('message',e=>{if(e.origin!=='${BASE}'||e.source!==child.contentWindow||e.data?.channel!=='mcc-world-audio-v1')return;if(e.data.type==='hello')audioSend({type:'attach',clearance:176});if(e.data.type==='ready'&&e.data.id==='travel-proof')audioReady=true;});</script></body></html>` });
    if (url.origin === BASE) {
      try {
        const path = url.pathname === '/' ? '/mnet.html' : url.pathname;
        let body = await readFile(join(ROOT, path));
        if (path === '/js/action-globe.js') body = Buffer.from(body.toString().replace('viewer=new Cesium.Viewer(', 'viewer=window.__testViewer=new Cesium.Viewer('));
        return r.fulfill({ status:200, contentType:TYPES[extname(path)] || 'application/octet-stream', body });
      } catch { return r.fulfill({ status:404, body:'Fixture file unavailable' }); }
    }
    if (url.hostname === 'cesium.com' && url.pathname.includes('/Build/Cesium/')) {
      if (!webgl && url.pathname.endsWith('/Cesium.js')) return r.abort();
      const path = url.pathname.split('/Build/Cesium/')[1];
      try { return r.fulfill({ status:200, contentType:TYPES[extname(path)] || 'application/octet-stream', headers:{ 'access-control-allow-origin':'*' }, body:await readFile(join(CESIUM, path)) }); }
      catch { return r.abort(); }
    }
    if (url.hostname === 'photon.komoot.io') {
      const from = /green/i.test(url.searchParams.get('q') || '');
      return json(r, { type:'FeatureCollection', features:[{ type:'Feature', geometry:{ type:'Point', coordinates:from ? origin : destination }, properties:{ name:from ? 'New Haven Green' : 'Union Station', city:'New Haven', state:'Connecticut', country:'United States' } }] });
    }
    if (url.hostname === 'api.mccluster.org') {
      if (req.method() === 'OPTIONS') return json(r, {});
      if (url.pathname === '/v1/travel/route') {
        const body = req.postDataJSON(); requests.push({ ...body, authenticated:!!req.headers().authorization });
        if (response === 'hold') { held.push(r); return; }
        if (response === 'error') return json(r, { error:'Directions are temporarily unavailable. Try again.' }, 503);
        const route = response === 'map-pick'
          ? { ...fixture.routes[0], origin:body.origin, destination:body.destination }
          : fixture.routes.find(route => route.mode === body.mode && JSON.stringify(route.origin) === JSON.stringify(body.origin) && JSON.stringify(route.destination) === JSON.stringify(body.destination));
        return route ? json(r, { route }) : json(r, { error:'No matching fixture route.' }, 422);
      }
      if (url.pathname === '/v1/world/access') return json(r, { level:'public', unlocked_layers:[], locked_layers:[] });
      if (url.pathname === '/v1/world/cctv/eligibility') return json(r, { eligible:false, checks:{ signed_in:false }, reason:'sign_in_required' });
      if (url.pathname === '/v1/world/news') return json(r, { items:[], next_before:null });
      if (url.pathname === '/v1/mnet/public-feed') return json(r, { posts:[], next_before:null });
      return json(r, {});
    }
    if (url.hostname.endsWith('supabase.co')) return json(r, []);
    if (url.hostname === 'gibs.earthdata.nasa.gov' || url.hostname.endsWith('tile.openstreetmap.org')) return r.fulfill({ status:200, contentType:'image/jpeg', headers:{ 'access-control-allow-origin':'*' }, body:tile });
    return r.abort();
  });
  const outerPage = await ctx.newPage(); outerPage.on('pageerror', error => errors.push(error.message));
  await outerPage.goto(audioParent ? AUDIO_PARENT + '/__travel-audio-parent' : BASE + '/mnet.html?view=feed', { waitUntil:'domcontentloaded' });
  const page = audioParent ? await (await outerPage.waitForSelector('#retainedWorld')).contentFrame() : outerPage;
  await page.waitForFunction(() => window.MCC_WORLD_MODE?.get() === 'travel' && document.documentElement.classList.contains('mn-world-on'), null, { timeout:20000 });
  if (audioParent) await outerPage.waitForFunction(() => audioReady);
  const frame = await (await page.waitForSelector('#mnWorldFrame')).contentFrame();
  if (webgl) await frame.waitForFunction(() => window.__testViewer && window.__huNavigation?.().travel, null, { timeout:25000 });
  return { ctx, page, outerPage, frame, requests, errors, setResponse:value => { response = value; }, releaseRoutes:async () => { for (const r of held.splice(0)) await json(r, { route:fixture.routes[0] }).catch(() => {}); } };
}
async function select(page, field, text) {
  await page.fill('#' + field, text);
  await page.locator('#' + field + 'Results button').first().click();
}
async function ready(page) { await page.waitForFunction(() => document.getElementById('wtNavigate').textContent === 'Go' && !document.getElementById('wtRouteCard').hidden); }
async function exposed(page, id) {
  return page.evaluate(id => {
    const element = document.getElementById(id), r = element.getBoundingClientRect();
    const centerX = (r.left+r.right)/2, centerY = (r.top+r.bottom)/2;
    const clearance = document.body.dataset.worldAudioChild === 'ready' ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mn-bar-clear')) || 0 : 0;
    return r.bottom <= innerHeight-clearance && [[centerX,r.top+3],[centerX,r.bottom-3],[r.left+3,centerY],[r.right-3,centerY]].every(([x,y]) => element.contains(document.elementFromPoint(x,y)));
  }, id);
}
async function controls(page) {
  return page.evaluate(() => {
    const frame = document.getElementById('mnWorldFrame'), f = frame.getBoundingClientRect();
    const rect = element => { const r = element?.getBoundingClientRect(); return r && r.width && r.height ? { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height } : null; };
    const obstacles = ['.mn__world-expand','.wt-world-modes','.appbar','#mccWorldAudioControls','#wtMapNav','#wtMapPickBanner'].map(selector => ({ selector, rect:rect(document.querySelector(selector)) })).filter(x => x.rect);
    if (document.body.dataset.worldAudioChild === 'ready') { const clearance = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mn-bar-clear')) || 0; obstacles.push({ selector:'retained-parent-audio', rect:{ left:0, right:innerWidth, top:innerHeight-clearance, bottom:innerHeight } }); }
    const buttons = ['ctlLocate','ctlZoomIn','ctlZoomOut'].map(id => ({ id, rect:rect(frame.contentDocument.getElementById(id)) })).map(x => ({ ...x, rect:{ ...x.rect, left:x.rect.left+f.left, right:x.rect.right+f.left, top:x.rect.top+f.top, bottom:x.rect.bottom+f.top } }));
    const overlap = (a,b) => a.left < b.right-1 && a.right > b.left+1 && a.top < b.bottom-1 && a.bottom > b.top+1;
    const hits = buttons.flatMap(button => obstacles.filter(o => overlap(button.rect,o.rect)).map(o => `${button.id}:${o.selector}`));
    const inside = buttons.every(b => b.rect.left >= f.left && b.rect.right <= f.right+1 && b.rect.top >= f.top && b.rect.bottom <= f.bottom+1);
    return { hits, inside, buttons, frame:{ top:f.top, bottom:f.bottom }, scrollWidth:document.documentElement.scrollWidth, clientWidth:document.documentElement.clientWidth };
  });
}

try {
  const selectedWidths = process.env.WORLD_TRAVEL_WIDTHS?.split(',').map(Number);
  for (const size of [{ width:320,height:568 }, { width:390,height:844 }, { width:844,height:390 }, { width:1280,height:800 }].filter(size => !selectedWidths || selectedWidths.includes(size.width))) {
    const scope = `${size.width}x${size.height}`, app = await open(size), { page, frame } = app;
    let geometry = await controls(page);
    check(scope, 'normal map controls are 44px, inside the map, clear of Fullscreen, modes and dock', !geometry.hits.length && geometry.inside && geometry.buttons.every(b => b.rect.width >= 44 && b.rect.height >= 44), geometry);
    check(scope, 'no horizontal document overflow', geometry.scrollWidth === geometry.clientWidth, geometry);
    await page.locator('.mn__world-expand').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('wt-expanded'));
    await page.waitForTimeout(100); geometry = await controls(page);
    check(scope, 'expanded map controls do not overlap Fullscreen, modes or dock', !geometry.hits.length && geometry.inside, geometry);
    await page.locator('.mn__world-expand').click();
    await page.locator('#wtLocate').click();
    await page.waitForFunction(() => /Location access is off/.test(document.getElementById('wtLocationStatus').textContent));
    check(scope, 'denied GPS leaves a retry and manual starting address', await page.isEnabled('#wtLocate') && await page.isEditable('#wtFrom'));
    await page.evaluate(() => { __geo.answer = 'grant'; });
    await frame.locator('#ctlLocate').click();
    await page.waitForFunction(() => document.getElementById('wtFrom').value === 'Current location');
    await frame.waitForFunction(() => __huNavigation().locationEntities === 2);
    const location = await page.evaluate(() => __geo.calls.filter(c => c.kind === 'once'));
    check(scope, 'the globe location button retries a fresh fix after denial', location.length === 2 && location.every(c => c.maximumAge === 0), location);
    const labels = await frame.evaluate(() => __testViewer.entities.values.filter(e => e.label).map(e => e.label.text.getValue()));
    check(scope, 'one origin label, no overlapping You are here label', !labels.includes('You are here') && labels.filter(l => l === 'Current location').length === 1, labels);
    await page.fill('#wtTo', 'Union Station');
    await page.locator('#wtToResults button').first().waitFor();
    check(scope, 'typing a destination does not send route coordinates', app.requests.length === 0);
    check(scope, 'the suggestion list is bounded above the app bar so every row can be reached', await page.evaluate(() => {
      const list = document.getElementById('wtToResults'), bar = document.querySelector('.appbar'), rect = list.getBoundingClientRect();
      const barTop = bar && bar.offsetHeight ? bar.getBoundingClientRect().top : innerHeight;
      return !!list.style.maxHeight && rect.bottom <= barTop + 1 && rect.bottom <= innerHeight;
    }));
    await page.locator('#wtToResults button').first().click(); await ready(page);
    check(scope, 'selecting a destination automatically returns guest directions and Go', app.requests.length === 1 && !app.requests[0].authenticated && await page.isVisible('#wtRouteSummary'), app.requests);
    await page.screenshot({ path:join(OUT, `guest-route-preview-${scope}.png`) });
    check(scope, 'route summary and Go are fully exposed above floating controls', await exposed(page, 'wtRouteSummary') && await exposed(page, 'wtNavigate'));
    check(scope, 'guest directions contain no save journey, saved journeys or Draft controls', await page.isHidden('#wtSaveRow') && await page.isHidden('#wtSaveFooter') && await page.isHidden('#wtDraftStatus'));
    const exitBlocked = await page.evaluate(() => { const event = new Event('beforeunload', { cancelable:true }); dispatchEvent(event); return event.defaultPrevented; });
    check(scope, 'guest navigation has no unsaved-journey exit prompt', !exitBlocked);
    await page.locator('#wtNavigate').click();
    await page.evaluate(coordinates => __geo.emit(coordinates), fixture.routes[0].geometry[0]);
    await frame.waitForFunction(() => __huNavigation().following);
    check(scope, 'Go starts foreground GPS guidance without signing in', await page.evaluate(() => __geo.watchCount() === 1 && document.documentElement.classList.contains('wt-navigating')) && await page.isVisible('#wtNavInstruction'));
    check(scope, 'the active turn is fully exposed above floating controls', await exposed(page, 'wtNavInstruction'));
    await page.screenshot({ path:join(OUT, `guest-navigation-${scope}.png`) });
    check(scope, 'Stop is exposed without scrolling behind music controls', await exposed(page, 'wtStopNavigation'));
    await frame.locator('#ctlZoomOut').click(); await page.waitForFunction(() => !document.getElementById('wtRecenter').hidden);
    check(scope, 'Stop and Recenter remain exposed after inspecting the map', await exposed(page, 'wtStopNavigation') && await exposed(page, 'wtRecenter'));
    await page.locator('#wtRecenter').click();
    await frame.locator('#ctlLocate').click();
    await page.waitForFunction(() => __geo.calls.filter(c => c.kind === 'once').length === 3 && !document.getElementById('wtLocate').disabled);
    check(scope, 'location click during navigation obtains a fresh fix and preserves one watch', await page.evaluate(() => __geo.watchCount() === 1));
    await page.locator('#wtStopNavigation').click();
    check(scope, 'Stop releases the GPS watch', await page.evaluate(() => __geo.watchCount() === 0));
    await page.screenshot({ path:join(OUT, `guest-directions-${scope}.png`) });
    if (size.width === 390) {
      await page.locator('[data-travel-kind="walk"]').click(); await ready(page);
      check(scope, 'changing mode recalculates the selected route automatically', app.requests.at(-1).mode === 'walk');
      app.setResponse('error'); await page.locator('[data-travel-kind="cycle"]').click();
      await page.waitForFunction(() => document.getElementById('wtNavigate').textContent === 'Try route again');
      check(scope, 'route failure gives a clear retry, without stale directions', await page.isHidden('#wtRouteCard') && /temporarily unavailable/.test(await page.textContent('#wtRouteMessage')));
      app.setResponse('route'); await page.locator('#wtNavigate').click(); await ready(page);
      app.setResponse('hold'); await page.locator('[data-travel-kind="drive"]').click();
      await page.waitForFunction(() => document.getElementById('wtNavigate').textContent === 'Finding your route…');
      await page.fill('#wtTo', 'An unselected address'); await app.releaseRoutes();
      await page.waitForTimeout(80);
      check(scope, 'editing an endpoint cancels a pending route and late data cannot restore it', await page.isHidden('#wtRouteCard') && await frame.evaluate(() => __huNavigation().routePoints === 0));
    }
    check(scope, 'no JavaScript exceptions in the full World page or real globe', app.errors.length === 0, app.errors);
    await app.ctx.close();
  }
  // Actual Cesium map clicks must select endpoints, request a truthful street
  // route, render its polyline and leave Go/Stop accessible in expanded Earth.
  const picked = await open({ width:390,height:844 });
  picked.setResponse('map-pick');
  const clickWorldPoint = async coordinates => {
    const position = await picked.frame.evaluate(([lon,lat]) => {
      const viewer = window.__testViewer;
      viewer.camera.setView({
        destination:Cesium.Cartesian3.fromDegrees(lon,lat,2300),
        orientation:{heading:0,pitch:-Math.PI/2,roll:0}
      });
      return Cesium.SceneTransforms.worldToWindowCoordinates(
        viewer.scene, Cesium.Cartesian3.fromDegrees(lon,lat));
    }, coordinates);
    assert.ok(position && Number.isFinite(position.x) && Number.isFinite(position.y), 'New Haven point projects into Cesium canvas');
    await picked.frame.locator('#globe canvas').first().click({ position:{ x:position.x, y:position.y }, force:true });
  };
  await picked.page.locator('#wtPickFrom').click();
  await picked.frame.waitForFunction(() => __huNavigation().mapPicking);
  check('map-pick', 'selecting a starting point expands the Earth and shows a cancelable tap instruction',
    await picked.page.isVisible('#wtMapPickBanner') && await picked.page.evaluate(() => document.documentElement.classList.contains('wt-expanded')));
  await picked.page.locator('#wtMapPickCancel').click();
  check('map-pick', 'cancelling a globe pick restores directions without making a route request',
    await picked.page.isHidden('#wtMapPickBanner') &&
    await picked.page.evaluate(() => !document.documentElement.classList.contains('wt-expanded')) &&
    picked.requests.length === 0);
  await picked.page.locator('#wtPickFrom').click();
  await picked.frame.waitForFunction(() => __huNavigation().mapPicking);
  await clickWorldPoint(origin);
  await picked.page.waitForFunction(() => document.getElementById('wtFrom').value.startsWith('Pinned map location'));
  check('map-pick', 'actual Cesium click sets a longitude/latitude origin without a GPS permission request',
    picked.requests.length === 0 && await picked.page.evaluate(() => __geo.calls.length === 0));
  await picked.page.locator('#wtPickTo').click();
  await picked.frame.waitForFunction(() => __huNavigation().mapPicking);
  await clickWorldPoint(destination);
  await ready(picked.page);
  await picked.frame.waitForFunction(() => __huNavigation().routePoints > 2 && __huNavigation().routeVisible);
  check('map-pick', 'two selected globe pins request an anonymous street route and draw its real geometry',
    picked.requests.length === 1 && picked.requests[0].mode === 'drive' && await picked.frame.evaluate(() => __huNavigation().routeVisible));
  await picked.page.locator('.mn__world-expand').click();
  await picked.page.waitForFunction(() => !document.getElementById('wtMapNav').hidden);
  check('map-pick', 'the expanded Earth retains a usable Go control over the route',
    await exposed(picked.page, 'wtMapNavGo'));
  await picked.page.waitForTimeout(150);
  const expandedChrome = await controls(picked.page);
  check('map-pick', 'route overlay never covers the map location and zoom controls',
    !expandedChrome.hits.length && expandedChrome.inside, expandedChrome);
  await picked.page.locator('#wtMapNavGo').click();
  await picked.page.evaluate(coordinates => __geo.emit(coordinates), fixture.routes[0].geometry[0]);
  await picked.page.waitForFunction(() => __geo.watchCount() === 1 && !document.getElementById('wtMapNavStop').hidden);
  // Parent geolocation and child Cesium postMessage are asynchronous: wait for
  // the actual location-follow update rather than racing the queued message.
  await picked.frame.waitForFunction(() => __huNavigation().following, null, {timeout:5000});
  check('map-pick', 'full-map Go starts GPS guidance; Stop remains accessible in the expanded Earth',
    await exposed(picked.page, 'wtMapNavStop') && await picked.frame.evaluate(() => __huNavigation().following));
  await picked.page.screenshot({ path:join(OUT, 'guest-map-picked-route-expanded-390.png') });
  await picked.page.locator('#wtMapNavStop').click();
  check('map-pick', 'Stop on the expanded Earth releases the location watch',
    await picked.page.evaluate(() => __geo.watchCount() === 0));
  check('map-pick', 'map-pin directions introduce no JavaScript exceptions', picked.errors.length === 0, picked.errors);
  await picked.ctx.close();
  const manual = await open({ width:390,height:844 }, { webgl:false });
  await manual.page.waitForFunction(() => document.getElementById('wtPickFrom').disabled);
  check('manual', 'missing Cesium disables map picking without blocking typed addresses',
    await manual.page.isDisabled('#wtPickFrom') && await manual.page.isDisabled('#wtPickTo'));
  await manual.frame.waitForFunction(() => document.documentElement.classList.contains('globe-travel') && document.querySelector('.globe-travel-controls')?.children.length === 3);
  await manual.page.waitForTimeout(100);
  let manualGeometry = await controls(manual.page);
  check('manual', 'without WebGL, location and zoom controls still clear Fullscreen and the listening dock', !manualGeometry.hits.length && manualGeometry.inside, manualGeometry);
  await manual.page.locator('.mn__world-expand').click(); await manual.page.waitForTimeout(100);
  manualGeometry = await controls(manual.page);
  check('manual', 'without WebGL, expanded controls still clear Fullscreen and the listening dock', !manualGeometry.hits.length && manualGeometry.inside, manualGeometry);
  await manual.page.locator('.mn__world-expand').click();
  await manual.frame.locator('#ctlLocate').click();
  await manual.page.waitForFunction(() => /Location access is off/.test(document.getElementById('wtLocationStatus').textContent));
  check('manual', 'the globe location button reaches parent GPS even when WebGL is unavailable', await manual.page.evaluate(() => __geo.calls.some(call => call.kind === 'once' && call.maximumAge === 0)));
  await select(manual.page, 'wtTo', 'Union Station');
  check('manual', 'destination-first does not invent a starting point', manual.requests.length === 0);
  await select(manual.page, 'wtFrom', 'New Haven Green'); await ready(manual.page);
  check('manual', 'manual origin completes directions even when GPS and WebGL are unavailable', manual.requests.length === 1 && await manual.page.isVisible('#wtRouteSummary'));
  await manual.page.screenshot({ path:join(OUT, 'guest-directions-webgl-unavailable-390.png') });
  await manual.page.locator('#wtNavigate').click(); await manual.page.evaluate(() => __geo.failWatch());
  await manual.page.waitForFunction(() => /Location access is off/.test(document.getElementById('wtDirectionsHint').textContent));
  check('manual', 'Go keeps navigating from the first step when live location is denied; Stop stays available', await manual.page.isVisible('#wtRouteCard') && await manual.page.evaluate(() => document.documentElement.classList.contains('wt-navigating') && __geo.watchCount() === 0 && document.getElementById('wtNavigate').hidden && !document.getElementById('wtStopNavigation').hidden) && await manual.page.isVisible('#wtNavInstruction') && (await manual.page.textContent('#wtNavInstruction')).trim().length > 0);
  await manual.page.locator('#wtStopNavigation').click();
  check('manual', 'Stop after a denied location returns a Go retry with the route steps intact', await manual.page.isVisible('#wtRouteCard') && !(await manual.page.evaluate(() => document.getElementById('wtNavigate').hidden)) && await manual.page.textContent('#wtNavigate') === 'Go');
  await manual.ctx.close();
  const late = await open({ width:390,height:844 }, { automatic:true });
  await late.page.waitForFunction(() => __geo.calls.some(c => c.kind === 'once'));
  await late.page.fill('#wtFrom', 'My own starting address');
  await late.page.evaluate(() => __geo.release('grant'));
  await late.page.waitForTimeout(80);
  check('late-gps', 'late automatic GPS cannot overwrite an edited starting point', await late.page.inputValue('#wtFrom') === 'My own starting address' && late.requests.length === 0);
  await late.ctx.close();
  for (const size of [{ width:320,height:568 }, { width:390,height:844 }]) {
    const scope = `retained-audio-${size.width}`, app = await open(size, { audioParent:true }), { page, outerPage, frame } = app;
    check(scope, 'trusted parent handshake reserves 176px and hides the duplicate dock', await page.evaluate(() => document.body.dataset.worldAudioChild === 'ready' && getComputedStyle(document.documentElement).getPropertyValue('--mn-bar-clear') === '176px' && getComputedStyle(document.querySelector('.appbar')).display === 'none'));
    let geometry = await controls(page);
    check(scope, 'normal map controls clear the retained parent audio controls', !geometry.hits.length && geometry.inside, geometry);
    await page.locator('.mn__world-expand').click();
    await page.waitForTimeout(100); geometry = await controls(page);
    check(scope, 'expanded map controls clear the retained parent audio controls', !geometry.hits.length && geometry.inside, geometry);
    await page.locator('.mn__world-expand').click();
    await page.evaluate(() => { __geo.answer = 'grant'; }); await page.locator('#wtLocate').click();
    await page.waitForFunction(() => document.getElementById('wtFrom').value === 'Current location');
    await page.fill('#wtTo', 'Union Station'); await page.waitForSelector('#wtToResults button');
    const suggest = await page.evaluate(() => { const list = document.getElementById('wtToResults'), last = list.querySelector('button:last-of-type'), l = list.getBoundingClientRect(), b = last.getBoundingClientRect(); const clearance = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mn-bar-clear')) || 0; return { listBottom:l.bottom, lastBottom:b.bottom, limit:innerHeight - clearance, scrolls:list.scrollHeight > list.clientHeight }; });
    check(scope, 'suggestion list stops above the retained parent app bar and keeps its last option reachable', suggest.listBottom <= suggest.limit + 1 && (suggest.scrolls || suggest.lastBottom <= suggest.limit + 1), suggest);
    await outerPage.screenshot({ path:join(OUT, `retained-parent-suggestions-${size.width}.png`) });
    await page.locator('#wtToResults button').first().click(); await ready(page);
    await outerPage.screenshot({ path:join(OUT, `retained-parent-route-${size.width}.png`) });
    check(scope, 'route and Go stay above the retained parent audio controls', await exposed(page, 'wtRouteSummary') && await exposed(page, 'wtNavigate'));
    await page.locator('#wtNavigate').click(); await page.evaluate(coordinates => __geo.emit(coordinates), fixture.routes[0].geometry[0]);
    await frame.waitForFunction(() => __huNavigation().following);
    await outerPage.screenshot({ path:join(OUT, `retained-parent-navigation-${size.width}.png`) });
    check(scope, 'active turn and Stop are exposed above the retained parent dock', await exposed(page, 'wtNavInstruction') && await exposed(page, 'wtStopNavigation'));
    await frame.locator('#ctlZoomOut').click(); await page.waitForFunction(() => !document.getElementById('wtRecenter').hidden);
    check(scope, 'Stop and Recenter remain exposed with retained parent audio', await exposed(page, 'wtStopNavigation') && await exposed(page, 'wtRecenter'));
    await outerPage.evaluate(() => audioSend({ type:'visibility', visible:false }));
    await page.waitForFunction(() => __geo.watchCount() === 0);
    check(scope, 'returning to Music stops the GPS watch and keeps the route', await page.isVisible('#wtRouteCard') && await page.textContent('#wtNavigate') === 'Go');
    const before = await page.evaluate(() => __geo.calls.length);
    await outerPage.evaluate(() => audioSend({ type:'visibility', visible:true }));
    await page.waitForTimeout(80);
    check(scope, 'returning to World preserves the draft without automatically resuming GPS', await page.evaluate(before => __geo.calls.length === before && __geo.watchCount() === 0, before) && await page.inputValue('#wtTo') === 'Union Station, New Haven, Connecticut, United States');
    await page.locator('#wtNavigate').click();
    check(scope, 'Go explicitly resumes retained navigation', await page.evaluate(() => __geo.watchCount() === 1));
    check(scope, 'no retained-frame JavaScript exceptions', app.errors.length === 0, app.errors);
    await app.ctx.close();
  }
  await writeFile(join(OUT, 'results.json'), JSON.stringify({ ok:true, reports }, null, 2));
  console.log(`PASS ${reports.length} checks; screenshots and results in ${OUT}`);
} finally { await browser.close(); }
