/* Owner workspace browser proof. Real Control and Cesium; ALL provider/API
 * requests intercepted with synthetic fixtures. Never calls production.
 * PLAYWRIGHT_DIR=<node_modules> CESIUM_DIR=<Build/Cesium> node this-file
 * Optional PLAYWRIGHT_MODULE (module directory) and CHROMIUM_EXECUTABLE.
 */
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.env.CONTROL_QA_OUTPUT||'/tmp/control-workspace-proof';
const require=createRequire(import.meta.url);
const {chromium}=process.env.PLAYWRIGHT_MODULE?require(process.env.PLAYWRIGHT_MODULE):createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const CESIUM=process.env.CESIUM_DIR;
if(!CESIUM)throw Error('CESIUM_DIR is required; the test never downloads runtime assets.');
const BASE='https://matthew.mccluster.org';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const results=[];
function check(name,condition,detail){results.push({name,pass:!!condition});console.log((condition?'PASS ':'FAIL ')+name+(condition?'':' '+JSON.stringify(detail)));assert.ok(condition,name);}
await mkdir(OUT,{recursive:true});
const now = Date.now();
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
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
async function setup(viewport,{owner=true,loggedIn=true,reduced=false}={}){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:true,reducedMotion:reduced?'reduce':'no-preference'});
  const auth={owner,loggedIn};const calls=[],errors=[];
  await ctx.addInitScript(({loggedIn})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-09-26',accepted_at:new Date().toISOString()}));
    if(loggedIn){const exp=Math.floor(Date.now()/1000)+3600;
      localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:'11111111-1111-4111-8111-111111111111',email:'owner@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:'11111111-1111-4111-8111-111111111111',email:'owner@fixture.invalid'}}));}
  },{loggedIn});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;calls.push({host:u.hostname,path:p,method:req.method()});
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.origin==='https://prime.mccluster.org')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><body style="background:#0b0b0d;color:white;font:16px system-ui;padding:20px"><h2>Halo bridge test fixture</h2><p>This test frame is not the production Halo scene.</p><script>window.received=0;addEventListener('message',e=>{if(e.origin==='https://matthew.mccluster.org'&&e.source===parent&&e.data.type==='mccluster:halo-owner-token'){received++;document.body.dataset.authorized='true'}});parent.postMessage({type:'mccluster:halo-owner-token:request'},'https://matthew.mccluster.org');</script></body></html>`});
    if(u.hostname==='cesium.com'){
      const rel=p.split('/Build/Cesium/')[1];if(rel){const path=resolve(CESIUM,rel);if(path.startsWith(resolve(CESIUM)+sep)){try{return route.fulfill({body:await readFile(path),contentType:TYPES[extname(path)]||'application/octet-stream'});}catch{}}}
      return route.abort();
    }
    if(u.origin==='https://api.mccluster.org'){
      if(p==='/health')return json(route,{ok:true});
      if(p==='/v1/status')return auth.owner?json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}}):json(route,{error:'Forbidden'},403);
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:'11111111-1111-4111-8111-111111111111'},default_org_id:'o1',workspaces:[{org_id:'o1',slug:'mccluster',kind:'studio',role:auth.owner?'owner':'viewer',enabled:true,name:'McCluster'}]});
      if(!auth.owner)return json(route,{error:'Forbidden'},403);
      if(p==='/v1/analytics/business')return json(route,FIX.business);
      if(p==='/v1/analytics/identity')return json(route,FIX.identity);
      if(p==='/v1/analytics/visitors')return json(route,FIX.visitors);
      if(p==='/v1/analytics/flows')return json(route,FIX.flows);
      if(p==='/v1/analytics/errors')return json(route,FIX.errors);
      if(p==='/v1/analytics/regions')return json(route,u.searchParams.get('country')==='US'?FIX.regions:{ok:true,pending:false,regions:[],folded:0,unknown:0});
      if(p==='/v1/intel/geo')return json(route,{code:'intel_schema_not_ready'},503);
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[]});
    }
    if(u.hostname.endsWith('supabase.co')){
      const body=JSON.parse(req.postData()||'{}');
      if(p==='/auth/v1/user')return auth.loggedIn?json(route,{id:'11111111-1111-4111-8111-111111111111',email:'owner@fixture.invalid'}):json(route,{},401);
      if(p==='/rest/v1/rpc/analytics_totals')return json(route,FIX.totals);
      if(p==='/rest/v1/rpc/analytics_hourly')return json(route,HOURS);
      if(p==='/rest/v1/rpc/analytics_top')return json(route,body.p_dim==='country'?FIX.country:body.p_dim==='source'?FIX.source:body.p_dim==='network'?FIX.network:[]);
      if(p==='/rest/v1/rpc/analytics_country_totals')return json(route,FIX.countryTotals);
      if(p==='/rest/v1/rpc/analytics_country_series')return json(route,FIX.series(body.p_country));
      if(p==='/rest/v1/rpc/action_mission_stats')return json(route,FIX.missions);
      return json(route,[]);
    }
    if(u.origin===BASE){
      const path=resolve(ROOT,'.'+decodeURIComponent(p));
      if(!path.startsWith(resolve(ROOT)+sep))return route.abort();
      try{return route.fulfill({body:await readFile(path),contentType:TYPES[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:'Fixture: file absent from source-only QA bundle'});}
    }
    return route.abort();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|favicon/.test(m.text()))errors.push(m.text());});
  return{ctx,page,auth,calls,errors};
}
async function overflow(page){return page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));}
async function shot(page,name){await page.evaluate(()=>{const tag=document.querySelector('.cw-brand b');if(tag)tag.textContent='OWNER PREVIEW · SYNTHETIC TEST DATA';});await page.screenshot({path:join(OUT,name+'.png')});}
try{
  for(const size of [{width:1180,height:820},{width:820,height:1180},{width:390,height:844}]){
    const key=size.width+'x'+size.height;const {ctx,page,calls,errors}=await setup(size,{reduced:true});
    await page.goto(BASE+'/control.html?workspace=1#analytics',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('body[data-control-workspace="owner"]');
    await page.waitForFunction(()=>window.CR.analytics.state.globe?.ready&&window.CR.analytics.state.loaded,null,{timeout:90000});
    const tabs=await page.locator('[data-cw-page]').allTextContents();
    check(key+' exactly three main pages',JSON.stringify(tabs)===JSON.stringify(['Intelligence','Operations','Studio']),tabs);
    check(key+' real segmented black globe',await page.evaluate(()=>window.__craGlobe().countries===242));
    check(key+' default makes no Halo request',!calls.some(c=>c.host==='prime.mccluster.org'));
    await page.waitForTimeout(600);let dimensions=await overflow(page);check(key+' no horizontal page overflow',dimensions.width===dimensions.scroll,dimensions);
    await shot(page,'intelligence-'+key);
    await page.selectOption('#craCountry','US');
    await page.waitForFunction(()=>window.__craGlobe().statesFor==='US',null,{timeout:15000});
    await page.selectOption('#craCountry','US/US-CT');
    await page.waitForFunction(()=>window.__craGlobe().state==='US-CT');
    await page.evaluate(()=>window.__keptGlobe=window.CR.analytics.state.globe);
    await page.waitForTimeout(500);await shot(page,'intelligence-connecticut-'+key);
    await page.click('[data-cw-page="operations"]');
    await page.waitForFunction(()=>document.body.dataset.cwPage==='operations');
    check(key+' globe suspended in Operations',await page.evaluate(()=>window.__keptGlobe.active===false));
    await page.selectOption('#cwRoute','#work:people');
    await page.waitForFunction(()=>location.hash==='#work:people');
    check(key+' people stays native Control workflow',await page.locator('#crSurface').getAttribute('data-cr-surface')==='work');
    await shot(page,'operations-'+key);
    await page.click('[data-cw-page="studio"]');await page.waitForFunction(()=>document.body.dataset.cwPage==='studio');
    await page.selectOption('#cwRoute','#create:library');
    await page.waitForFunction(()=>location.hash==='#create:library');await shot(page,'studio-'+key);
    check(key+' Studio has no Earth in its page',await page.locator('#crSurface .crg-canvas').count()===0);
    await page.click('[data-cw-page="intelligence"]');
    await page.waitForFunction(()=>window.CR.analytics.state.globe?.active&&document.body.dataset.cwPage==='intelligence');
    check(key+' exact same globe instance retained',await page.evaluate(()=>window.CR.analytics.state.globe===window.__keptGlobe));
    check(key+' geographic selection survives round trip',await page.evaluate(()=>window.CR.analytics.state.geo.state==='US-CT'));
    await page.click('#cwSources');await page.waitForSelector('#cwSourcePanel:not([hidden])');
    check(key+' inactive external evidence is honest',/Not enabled/.test(await page.locator('#cwSourceRows').innerText()));
    await page.click('#cwSourcesClose');await page.click('#cwLayout');
    check(key+' focus details suspends globe',await page.evaluate(()=>window.CR.analytics.state.globe.active===false));
    await page.click('#cwLayout');
    await page.click('[data-cw-scene="halo"]');await page.waitForSelector('#cwHaloPanel iframe');
    const hf=page.frames().find(f=>f.url().startsWith('https://prime.mccluster.org'));
    await hf.waitForFunction(()=>window.received>0);
    check(key+' explicit Halo scene uses existing secure bridge',true);
    check(key+' black render loop stops behind Halo',await page.evaluate(()=>window.__keptGlobe.active===false));
    await page.click('[data-cw-scene="black"]');
    check(key+' Halo is unloaded on return to black',await page.locator('#cwHaloPanel iframe').count()===0);
    check(key+' black globe is restored with selection',await page.evaluate(()=>window.__keptGlobe.active&&window.__keptGlobe.sel.state==='US-CT'));
    dimensions=await overflow(page);check(key+' no overflow after all navigation',dimensions.width===dimensions.scroll,dimensions);
    check(key+' no JavaScript page errors',errors.length===0,errors);
    await page.click('[data-cw-scene="halo"]');await page.waitForSelector('#cwHaloPanel iframe');
    await page.evaluate(()=>window.MCC_AUTH.signOut());
    await page.waitForSelector('body[data-cw-blocked="true"]');
    check(key+' sign out removes Halo and destroys private globe',await page.evaluate(()=>!document.querySelector('#cwHaloPanel iframe')&&!window.CR.analytics.state.globe&&document.getElementById('crApp').hidden));
    await ctx.close();
  }
  for(const scenario of [{name:'member',owner:false,loggedIn:true},{name:'guest',owner:false,loggedIn:false}]){
    const {ctx,page,calls}=await setup({width:390,height:844},scenario);
    await page.goto(BASE+'/control.html?workspace=1#analytics',{waitUntil:'domcontentloaded'});await page.waitForTimeout(2000);
    check(scenario.name+' cannot activate owner preview',await page.locator('body[data-control-workspace]').count()===0);
    check(scenario.name+' cannot load Halo through preview',!calls.some(c=>c.host==='prime.mccluster.org'));
    await ctx.close();
  }
  {const {ctx,page}=await setup({width:1180,height:820});await page.goto(BASE+'/control.html#home',{waitUntil:'domcontentloaded'});await page.waitForTimeout(1500);check('without preview flag legacy Control stays unchanged',await page.locator('#cwHeader').count()===0);await ctx.close();}
  await writeFile(join(OUT,'results.json'),JSON.stringify({fixture:true,renderer:'Cesium 1.131.0',results},null,2));
}catch(error){
  for(const [i,ctx] of browser.contexts().entries())for(const [j,page] of ctx.pages().entries()){
    try{await page.screenshot({path:join(OUT,'failure-'+i+'-'+j+'.png')});}catch(_){}
  }
  await writeFile(join(OUT,'failure.txt'),String(error.stack||error));throw error;
}finally{await writeFile(join(OUT,'results.json'),JSON.stringify({fixture:true,renderer:'Cesium 1.131.0',results},null,2));await browser.close();}
console.log('All '+results.length+' assertions passed. Screenshots contain synthetic fixture data, not live metrics.');
