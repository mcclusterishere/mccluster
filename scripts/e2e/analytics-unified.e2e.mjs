/* Unified analytics browser regression with in-memory API fixtures, never production rows.
   Real Control shell and geographic renderer at phone, tablet and desktop sizes.
   Checks layout, navigation, missing archive, explicit snapshots and field search.
   Run: node scripts/e2e/analytics-unified.e2e.mjs [outDir]
   Set PLAYWRIGHT_DIR, CHROMIUM_PATH and CESIUM_DIR (the app-pinned Cesium build). */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
await mkdir(OUT, { recursive: true });

let failed = 0;
function check(scope, name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 500)}`);
  if (!ok) failed++;
}

/* ---------- FIXTURES (test data only; shaped like the real reads) ---------- */
const now = process.env.ANALYTICS_FIXED_TIME ? Date.parse(process.env.ANALYTICS_FIXED_TIME) : Date.now();
const HOURS = [...Array(24)].map((_, i) => { const at = new Date(now - (23 - i) * 3600000); at.setMinutes(0, 0, 0); return { hour: at.toISOString(), hour_label: '', page_views: [2, 3, 2, 4, 5, 4, 6, 5, 3, 4, 6, 5, 7, 6, 9, 8, 8, 9, 7, 6, 7, 5, 4, 4][i], visitors: 2, sessions: 3, plays: 1, events: 9 }; });
const FIX = {
  totals: [{ page_views: 133, visits: 40, visitors: 40, sessions: 52, plays: 30, events: 900 }],
  country: [{ key: 'US', n: 61 }, { key: 'GB', n: 18 }, { key: 'BR', n: 12 }, { key: 'JP', n: 7 }, { key: 'CA', n: 3 }, { key: 'XX', n: 2 }],
  source: [{ key: 'x.com', n: 22 }, { key: 'direct', n: 14 }, { key: 't.co', n: 4 }],
  network: [{ key: '4g', n: 70 }, { key: 'wifi', n: 40 }],
  countryTotals: [{ country: 'US', page_views: 61, visitors: 18, sessions: 22 }, { country: 'GB', page_views: 18, visitors: 7, sessions: 8 }, { country: 'BR', page_views: 12, visitors: 5, sessions: 6 }],
  /* a country's 24 buckets: the worldwide hourly shape scaled to that country's total, rounded by largest remainder so
     the buckets add up to the country's page views (the earlier fixture alternated 0/1/2 for every other country, which
     drew a sawtooth: a fixture artefact, not the chart or the bucketing) */
  series: (cc) => {
    const total = { US: 61, GB: 18, BR: 12, JP: 7 }[cc] || 0, all = HOURS.reduce((a, h) => a + h.page_views, 0);
    const raw = HOURS.map((h) => h.page_views * total / all), out = raw.map(Math.floor);
    raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).slice(0, total - out.reduce((a, b) => a + b, 0)).forEach(([, i]) => { out[i]++; });
    return HOURS.map((h, i) => ({ bucket: h.hour, bucket_label: '', page_views: out[i], visitors: Math.min(out[i], 1) }));
  },
  visitors: { ok: true, total: 40, counts: { all: 40, returning: 9 }, visitors: [] },
  flows: { ok: true, flows: { sessions: 52, bounced: 20, bounce_rate: 38, pages_per_session: { 1: 20, 2: 14, 3: 9, 4: 5, '5+': 4 }, entries: [{ path: '/', sessions: 30 }], exits: [], transitions: [], paths: [], pages: [] } },
  errors: { ok: true, totals: { errors: 6, site_errors: 2, injected_errors: 4, friction: 9, journey: 3, sessions_affected: 11 }, errors: [], friction: [], journey: [{ kind: 'gated_preview_end', detail: 'Track · gate', sessions: 3 }] },
  missions: [{ mission_id: 'm1', joined: 14, in_progress: 6, submitted: 5, verified: 2, rejected: 1 }, { mission_id: 'm2', joined: 4, in_progress: 3, submitted: 1, verified: 0, rejected: 0 }],
  business: { window: {}, users: { total: 110, created_in_window: 4, confirmed_in_window: 3, active_in_window: 9, created_by_day: [{ day: '2026-10-14', count: 1 }, { day: '2026-10-15', count: 3 }] },
    music: { plays: { total: 900, in_window: 30 }, preview_plays: { in_window: 21 }, full_plays: { in_window: 9 }, completions: { in_window: 5 }, paid_orders: { in_window: 0 }, revenue: {} },
    mnet: { profiles: { total: 64, created_in_window: 2 }, posts: { created_in_window: 7 }, follows: { created_in_window: 5 }, reactions: { created_in_window: 19 } }, commerce: { available: false, reason: 'fixture' } },
  regions: { ok: true, pending: false, country: 'US', min: 5, regions: [{ code: 'CT', name: 'Connecticut', page_views: 22, visitors: 9 }, { code: 'NY', name: 'New York', page_views: 14, visitors: 6 }, { code: null, name: 'California', page_views: 9, visitors: 4 }], folded: 7, unknown: 9 },
  identity: { coverage: { accounts: 4 }, journeys: [{ source: 'x.com', country: 'US', created_at: new Date().toISOString() }, { source: 'x.com', country: 'US' }, { source: 'direct', country: 'GB' }, { source: 'x.com', country: null }], tracks: [] }
};
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': '*' }, body: JSON.stringify(body) });

const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH||undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function context(viewport, { owner = true, reduced = false, pendingRpc = true, theme, fixedTime, deviceScaleFactor = 2 } = {}) {
  const mobile = viewport.width < 600;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, timezoneId:'UTC', isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(({fixedTime,theme}) => {
    if(fixedTime){const NativeDate=Date,ms=Date.parse(fixedTime);window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[ms]));}static now(){return ms;}};}
    if(theme)localStorage.setItem('mcc_theme',theme);
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: '11111111-1111-4111-8111-111111111111', email: 'owner@test' })).replace(/=+$/, '') + '.y', refresh_token: 'r', expires_at: exp, user: { id: '11111111-1111-4111-8111-111111111111', email: 'owner@test' } }));
  },{fixedTime,theme});
  const calls = [];
  await ctx.route('https://api.mccluster.org/**', (route) => {
    const req = route.request(), p = new URL(req.url()).pathname;
    calls.push(p);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p === '/v1/seek-first/sources') return json(route,{sources:[{key:'cctv',name:'Public Traffic Camera Catalogs',capabilities:['traffic-cameras'],persistence:'transient',configured:true,entitlement:{allowed:true}},{key:'usgs',name:'U.S. Geological Survey',capabilities:['earthquakes'],persistence:'persistent',configured:true,entitlement:{allowed:true}}]});
    if (p === '/v1/seek-first/readiness') return json(route,{database_schema_ready:false});
    if (p === '/v1/seek-first/fetch/cctv') { const body=JSON.parse(req.postData());check('snapshot','transient owner query',body.persist===false&&body.include_raw===false&&body.lane==='INTERNAL');return json(route,{result:{records:[{name:'Fixture camera',entity_type:'traffic_camera',properties:{catalog_status:'TURNED_ON'}}],fetched_at:new Date().toISOString(),attribution:'Fixture catalog'}}); }
    if (p === '/v1/seek-first/fetch/usgs') return json(route,{error:'Fixture upstream unavailable'},502);
    if (p === '/health') return json(route, { ok: true });
    if (p === '/v1/status') return owner ? json(route, { ok: true, operator: { email: 'owner@test' } }) : json(route, { error: 'Forbidden' }, 403);
    if (!owner) return json(route, { error: 'Forbidden' }, 403);
    if (p === '/v1/workspaces/me') return json(route, { profile:{id:'11111111-1111-4111-8111-111111111111'}, default_org_id: 'o1', workspaces: [{ org_id: 'o1', slug: 'mccluster', kind: 'studio', name: 'McCluster', role: 'owner', enabled: true }] });
    if(p==='/v1/analytics/cameras')return json(route,{ok:true,catalog_count:3,stale_count:0,retrieved_at:new Date().toISOString(),packs:[{name:'Test provider',cameras:3,status:'ok'}],cameras:[1,2,3].map(id=>({id:String(id),name:'Camera '+id,pack:'Test provider'}))});
    if(p==='/v1/analytics/cameras/check')return json(route,{ok:true,checks:[{id:'1',status:'image_received',checked_at:new Date().toISOString(),image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFqoAAAAASUVORK5CYII='},{id:'2',status:'unavailable',checked_at:new Date().toISOString()},{id:'3',status:'image_received',image:'data:image/png;base64,YmFk',checked_at:new Date().toISOString()}]});
    if(p==='/v1/intel/health')return json(route,{schema_ready:true,collector:{enabled:false},latest_run:null,last_successful_run:null});
    if(p==='/v1/analytics/coverage')return json(route,{schema:'analytics-coverage/v2',measured_at:new Date().toISOString(),summary:{datasets:3,populated:1,empty:1,quiet:0,unavailable:1},datasets:[
      {key:'headlines',label:'News headlines',family:'Intelligence',state:'populated',count:4200,window_count:40,window_status:'measured',scope:'News catalog',section:'intelligence',time_field:'imported_at',latest_at:new Date().toISOString(),next_step:'Open analysis'},
      {key:'evidence',label:'Evidence',family:'Intelligence',state:'empty',count:0,window_count:0,scope:'House',section:'intelligence',time_field:'created_at',next_step:'No stored records'},
      {key:'spatial',label:'Spatial archive',family:'Intelligence',state:'missing',count:null,window_count:null,scope:'House',section:'intelligence',time_field:'last_seen_at',next_step:'Provision storage'}]});
    if (p === '/v1/analytics/business') return json(route, {ok:true,snapshot:FIX.business});
    if (p === '/v1/analytics/audience-science') return json(route, {version:'fixture',totals:{music_listeners:18,returning_listeners:7},profiles:[],signals:[],track_affinity:[]});
    if (p === '/v1/analytics/identity') return json(route, FIX.identity);
    if (p === '/v1/analytics/visitors') return json(route, FIX.visitors);
    if (p === '/v1/analytics/flows') return json(route, FIX.flows);
    if (p === '/v1/analytics/errors') return json(route, FIX.errors);
    if (p === '/v1/analytics/regions') return json(route, pendingRpc ? (new URL(req.url()).searchParams.get('country') === 'US' ? FIX.regions : { ok: true, pending: false, country: new URL(req.url()).searchParams.get('country'), min: 5, regions: [], folded: 0, unknown: 0 }) : { ok: true, pending: true, country: new URL(req.url()).searchParams.get('country'), regions: [], folded: 0, unknown: 0 });
    if (p === '/v1/intel/geo') return json(route, {ok:true,audience:'owner',totals:{records:0,located:0,unknown_location:0,suppressed_records:0,suppressed_buckets:0},buckets:[]});
    return json(route, { ok: true });
  });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => {
    const req = route.request(), p = new URL(req.url()).pathname, body = JSON.parse(req.postData() || '{}');
    if (p === '/auth/v1/user') return json(route, { id: '11111111-1111-4111-8111-111111111111', email: 'owner@test' });
    if (p === '/rest/v1/rpc/analytics_totals') return json(route, FIX.totals);
    if (p === '/rest/v1/rpc/analytics_hourly') return json(route, HOURS);
    if (p === '/rest/v1/rpc/analytics_top') return json(route, body.p_dim === 'country' ? FIX.country : body.p_dim === 'source' ? FIX.source : body.p_dim === 'network' ? FIX.network : []);
    if (p === '/rest/v1/rpc/analytics_country_totals') return pendingRpc ? json(route, FIX.countryTotals) : json(route, { code: 'PGRST202', message: 'Could not find the function public.analytics_country_totals' }, 404);
    if (p === '/rest/v1/rpc/analytics_geo_audience') {
      const state=Array.isArray(body.p_region_codes),v=state?9:body.p_country==='US'?18:7;
      return json(route,{schema:'analytics-geo-audience/v1',country:body.p_country,suppressed:false,totals:{visitors:v,sessions:v+4,returning:2,page_views:v*2,plays:3,bounce_rate:25},series:FIX.series(body.p_country).map(r=>({...r,visitors:1,sessions:2})),sources:[{source:'Scoped source',people:v}],paths:[{from_page:'/local',to_page:'/song',moves:2}],pages:[{path:'/local',visitors:v}],stages:[{stage:'content',visitors:3}]});
    }
    if (p === '/rest/v1/rpc/analytics_country_series') return pendingRpc ? json(route, FIX.series(body.p_country)) : json(route, { code: 'PGRST202', message: 'Could not find the function' }, 404);
    if (p === '/rest/v1/rpc/action_mission_stats') return json(route, FIX.missions);
    return json(route, []);
  });
  await ctx.route('https://cesium.com/downloads/cesiumjs/releases/**',async route=>{const p=new URL(route.request().url()).pathname.split('/Build/Cesium/')[1];if(!p)return route.abort();try{return route.fulfill({body:await readFile(join(process.env.CESIUM_DIR,p)),contentType:TYPES[extname(p)]||'application/octet-stream'});}catch{return route.abort();}});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  /* the fixtures answer two reads with deliberate failures (intel switched off: 503; the pending country read absent: 404),
     which the browser logs as "Failed to load resource"; every other console error counts */
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { ctx, page, errors, calls };
}
const settle = (page) => page.waitForFunction(() => window.__craGlobe && window.__craGlobe().ready && window.__craGlobe().valued.length > 0, null, { timeout: 60000 }).then(() => true).catch(() => false);
const widths = (page) => page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));


export { context, settle, widths, browser, server, BASE, OUT, json };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
for(const size of [{width:390,height:844},{width:820,height:1180},{width:1280,height:1000},{width:390,height:844,workspace:true},{width:1180,height:820,workspace:true}]){
 const {ctx,page,errors,calls}=await context(size);
 await page.goto(BASE+'/control.html'+(size.workspace?'?workspace=1':'')+'#analytics',{waitUntil:'domcontentloaded'});
 if(size.workspace)await page.waitForSelector('body[data-control-workspace=owner]');
 const ready=await settle(page);check(size.width,'geographic globe renders',ready);
 await page.waitForSelector('.cu-metrics');await page.waitForFunction(()=>window.CR.analytics.state.loaded);
 const w=await widths(page);check(size.width,'no horizontal overflow',w.scrollW===w.clientW,w);
 const targets=await page.locator('.cu-card button,.cu-card a').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>({text:n.textContent,height:n.getBoundingClientRect().height})));
 check(size.width,'card controls retain 40px touch targets',targets.length>0&&targets.every(n=>n.height>=40),targets.filter(n=>n.height<40));
 const dimensions=await page.locator('.cu-geography').boundingBox();check(size.width,'globe stays inside viewport',dimensions.height>150&&dimensions.y+dimensions.height<=size.height,dimensions);
 check(size.width,'document has no dashboard scroll',await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+2),await page.evaluate(()=>({height:document.documentElement.scrollHeight,window:innerHeight,body:getComputedStyle(document.body).paddingBottom})));
 const originalGlobe=await page.locator('[data-cra-globe]').evaluate(el=>{el.dataset.testIdentity='same-earth';return el.querySelectorAll('canvas').length;});
 const tabs=await page.locator('.appbar [data-appnav]').evaluateAll(nodes=>nodes.map(n=>n.dataset.appnav));check(size.width,'original five tab bar',JSON.stringify(tabs)===JSON.stringify(['music','admin-home','home','analytics','world']),tabs);
 check(size.width,'overview exposes six connected metrics',await page.locator('.cu-overview-metrics .cu-metric-link').count()===6);
 check(size.width,'trend exposes exact keyboard values',await page.locator('.cra-ac__point[tabindex="0"]').count()===24);
 await page.screenshot({path:OUT+'/unified-'+size.width+(size.workspace?'-workspace':'')+'.png',fullPage:false});
 const heat=await page.evaluate(()=>{const g=window.__craGlobe();return{us:g.fill('US'),gb:g.fill('GB'),none:g.fill('AU'),metric:window.CR.analytics.state.geo.layer};});
 check(size.width,'visitor heat map starts populated with distinct intensities',heat.metric==='visitors'&&JSON.stringify(heat.us)!==JSON.stringify(heat.gb)&&JSON.stringify(heat.gb)!==JSON.stringify(heat.none),heat);
 check(size.width,'unique visitors lead the overview',await page.locator('.cu-overview-metrics button').first().innerText().then(t=>t.startsWith('Unique visitors')));
 await page.locator('[role=tab][data-cra-sec="audience"]').click();
 await page.locator('#craCountry').selectOption('US');
 await page.waitForFunction(()=>window.CR.analytics.state.geoAudience?.data?.totals.visitors===18);
 check(size.width,'country filters all audience cards',await page.locator('.cad-body').innerText().then(t=>/unique visitors\s+18/i.test(t)&&t.includes('Scoped source')&&!t.includes('all countries')));
 await page.waitForFunction(()=>!!document.querySelector('#craCountry option[value="US/US-CT"]'));
 await page.locator('#craCountry').selectOption('US/US-CT');
 await page.waitForFunction(()=>window.CR.analytics.state.geoAudience?.data?.totals.visitors===9);
 check(size.width,'state filters audience cards',await page.locator('.cad-body').innerText().then(t=>t.includes('Connecticut')&&/unique visitors\s+9/i.test(t)));
 await page.screenshot({path:OUT+'/audience-state-'+size.width+(size.workspace?'-workspace':'')+'.png'});
 await page.locator('#craCountry').selectOption('');
 check(size.width,'clear restores global audience',await page.locator('.cad-body').innerText().then(t=>/unique visitors\s+40/i.test(t)&&!t.includes('Scoped source')));
 await page.locator('[data-cra-sec="intelligence"]').first().click();await page.waitForSelector('[data-cu-source="cctv"]');
 check(size.width,'missing archive shown',await page.locator('[data-cu-details]').innerText().then(x=>x.includes('not provisioned')));
 await page.locator('[data-cu-source="cctv"]').click();
 check(size.width,'archive disabled',await page.locator('[data-cu-archive]').isDisabled());
 await page.locator('#cuSnapshot button[type=submit]').click();await page.waitForFunction(()=>!window.CR.analyticsUnified.state.reading);
 check(size.width,'snapshot displayed',await page.locator('.cu-records').innerText().then(x=>x.includes('Fixture camera')));
 await page.locator('[data-cu-source="usgs"]').click();await page.locator('#cuSnapshot button[type=submit]').click();await page.waitForFunction(()=>!window.CR.analyticsUnified.state.reading);
 check(size.width,'failed source read remains visible',await page.locator('[data-cu-details] [role=alert]').innerText().then(x=>x.includes('unavailable')));
 check(size.width,'globe survives chapter navigation',await page.locator('[data-cra-globe]').getAttribute('data-test-identity')==='same-earth');
 await page.locator('[data-cra-sec="cameras"]').first().click();
 check(size.width,'camera count starts unmeasured',!(await page.locator('[data-cu-details]').innerText()).includes('10,000'));
 await page.locator('[data-camera-load]').click();await page.waitForSelector('[data-camera-check]:not([disabled])');
 check(size.width,'catalog count is measured independently',await page.locator('.cu-metrics').innerText().then(t=>t.includes('3')&&t.includes('Run feed verification')));
 await page.locator('[data-camera-check]').click();await page.waitForFunction(()=>Object.keys(window.CR.analyticsCameras.state.checks).length===3&&!window.CR.analyticsCameras.state.running);
 const measured=await page.evaluate(()=>window.CR.analyticsCameras.totals(window.CR.analyticsCameras.state.catalog.cameras));
 check(size.width,'only decoded images count as verified',measured.verified===1&&measured.failed===2&&measured.unchecked===0,measured);
 await page.locator('[role=tab][data-cra-sec="cameras"]').press('ArrowRight');
 check(size.width,'keyboard and tab state agree',await page.locator('[role=tab][aria-selected=true]').innerText()==='Adaptive');
 if(size.width<600){
  await page.locator('[role=tab][data-cra-sec="overview"]').click();
  const metricBox=await page.locator('.cu-metrics').first().boundingBox(),railSession=await ctx.newCDPSession(page);
  const ry=metricBox.y+Math.min(metricBox.height/2,40),rx=metricBox.x+metricBox.width-20;
  await railSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rx,y:ry}]});
  for(const delta of [40,100,180,260]){await railSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rx-delta,y:ry}]});await page.waitForTimeout(20);}
  await railSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300);
  check(size.width,'KPI rail swipes without changing chapter',await page.locator('.cu-metrics').first().evaluate(el=>el.scrollLeft>30)&&await page.locator('[role=tab][aria-selected=true]').innerText()==='Overview');
  const box=await page.locator('.cad-chapter').boundingBox();
  const bodyBox=await page.locator('.cad-chapter>div:first-child').boundingBox();
  const session=await ctx.newCDPSession(page), y=bodyBox.y+bodyBox.height-8;
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bodyBox.x+bodyBox.width-25,y}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:bodyBox.x+25,y}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(200);
  check(size.width,'touch swipe changes the whole chapter',await page.locator('[role=tab][aria-selected=true]').innerText()==='Audience');
 }
 check(size.width,'dataset counts are not fetched on every dashboard open',!calls.some(x=>x.includes('/analytics/coverage')));
 await page.locator('[data-cad-health]').click();await page.waitForSelector('[data-cu-dataset="headlines"]');
 check(size.width,'dataset explorer shows measured empty and missing states',await page.locator('.cu-dataset-list').innerText().then(t=>t.includes('Empty')&&t.includes('Storage missing')));
 await page.locator('#cuDatasetStatus').selectOption('empty');
 check(size.width,'dataset health filter narrows the view',await page.locator('[data-cu-dataset]').count()===1);
 await page.locator('#cuDatasetStatus').selectOption('');await page.locator('[data-cu-dataset="headlines"]').click();
 check(size.width,'dataset details show time scope and provenance',await page.locator('.cad-body').innerText().then(t=>t.includes('Latest stored activity')&&t.includes('imported_at')));
 await page.screenshot({path:OUT+'/datasets-'+size.width+(size.workspace?'-workspace':'')+'.png'});
 await page.locator('[data-cu-panel="connections"]').click();
 check(size.width,'data status reaches all applicable connections',await page.locator('.cad-health li').count()===23);
 await page.screenshot({path:OUT+'/connections-'+size.width+(size.workspace?'-workspace':'')+'.png'});
 await page.locator('[data-cu-panel="fields"]').click();await page.waitForSelector('#cuFieldSearch');
 await page.locator('#cuFieldSearch').fill('analytics_site_daily');await page.locator('#cuFieldSearch').press('Tab');
 check(size.width,'field directory searches audited schema',await page.locator('[data-cu-details] .cu-records').innerText().then(x=>x.includes('analytics_site_daily')));
 check(size.width,'no automatic ingestion',!calls.some(x=>x.includes('/ingest/')));
 check(size.width,'no runtime errors',!errors.length,errors);
 await ctx.close();
}
await browser.close();server.close();if(failed)process.exitCode=1;

}
