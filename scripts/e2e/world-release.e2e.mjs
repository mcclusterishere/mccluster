/* Actual globe, isolated API fixtures. No production reads. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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


const FEATURES=['flights','satellites','launches','intel','music','cctv','audience','transport','ion','military','quakes','fires','perimeters','cyclones','vessels','search'];
const BUTTONS=['ctlFlights','ctlSats','ctlLaunch','ctlIntel','ctlMusic','ctlCctv','ctlTransport'];
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
/* HITMAN'S HALO ON THE ADMIN GLOBE (js/halo/*): the owner's console, its layers, vision, HUD, search, follow and share */
const HALO_FIXTURES={
 '/v1/world/layers/quakes':{ok:true,layer:'quakes',fetched_at:new Date().toISOString(),credit:'Earthquakes: USGS',count:3,quakes:[{id:'us1',mag:5.4,place:'10 km S of Fixture, Chile',time:new Date().toISOString(),lon:-71.5,lat:-33.4,depth_km:12,url:'https://earthquake.usgs.gov/earthquakes/eventpage/us1',tsunami:false,alert:'green'},{id:'us2',mag:2.1,place:'Fixture, California',time:new Date().toISOString(),lon:-118.2,lat:34.05,depth_km:8,url:'',tsunami:false,alert:null},{id:'us3',mag:4.6,place:'Fixture, Japan',time:new Date().toISOString(),lon:142.4,lat:38.3,depth_km:110,url:'',tsunami:false,alert:null}]},
 '/v1/world/layers/military':{ok:true,layer:'military',fetched_at:new Date().toISOString(),credit:'Military flights: adsb.lol (ODbL)',count:2,aircraft:[['ae1234','RCH123',-77.0,38.9,9000,220,90,'C17','4521',false],['ae5678','DUKE01',-1.5,51.2,7000,180,270,'K35R','7700',true]]},
 '/v1/world/layers/fires':{ok:true,layer:'fires',fetched_at:null,unavailable:true,upstream_error:'not_configured',count:0,fires:[]}
};
async function haloChecks(scope,page,host,width,ctx,loseOwner,calls){
 const state=()=>page.evaluate(()=>window.HaloConsole?HaloConsole.state():null);
 await page.waitForFunction(()=>window.HaloConsole&&HaloConsole.state().mounted,null,{timeout:20000}).catch(()=>{});
 let st=await state();
 check(scope,'the owner gets the Halo console, open from the link, on the Layers tab',!!st&&st.mounted&&st.open&&st.tab==='layers'&&await page.locator('#haloPanel').isVisible(),st);
 const box=await page.locator('#haloPanel').boundingBox(),pill=await page.locator('.halo-pill').boundingBox();
 check(scope,'the console fits the screen and its pill is a full tap target',!!box&&box.x>=0&&box.x+box.width<=width+0.5&&pill.height>=44&&pill.width>=44,{box,pill});
 /* the top of the screen: "← World", "Just the globe", the profile chip, the Halo pill and the console's title never sit on each other */
 const crowd=await page.evaluate(()=>{const els=['#worldBack','#bareEnter','#mccAuthChip','.halo-pill','#haloPanel .halo__head h2'].map(q=>[q,document.querySelector(q)]).filter(([,e])=>e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'),hits=[];for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){const a=els[i][1].getBoundingClientRect(),b=els[j][1].getBoundingClientRect();if(a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5)hits.push(els[i][0]+' × '+els[j][0])}return{seen:els.map(([q])=>q),hits}});
 check(scope,'the top controls and the console title do not overlap',crowd.hits.length===0&&crowd.seen.includes('.halo-pill')&&crowd.seen.includes('#worldBack'),crowd);
 const small=await page.evaluate(()=>[...document.querySelectorAll('#haloPanel .halo-row,#haloPanel [role=tab],#haloPanel button,#haloPanel input[type=search]')].filter(e=>e.offsetParent!==null&&e.getBoundingClientRect().height<44).map(e=>e.className||e.tagName));
 check(scope,'every visible Halo row, tab, button and the search field is a full tap target',small.length===0,small);
 /* layers: earthquakes draw, fires say they need a key, military flights draw */
 await page.locator('[data-halo-layer="quakes"] input').click();
 await page.waitForFunction(()=>HaloConsole.state().layers.quakes.state==='on',null,{timeout:8000}).catch(()=>{});
 await page.locator('[data-halo-layer="fires"] input').click();
 await page.locator('[data-halo-layer="military"] input').click();
 await page.waitForFunction(()=>{const l=HaloConsole.state().layers;return l.fires.state==='unavailable'&&l.military.state==='on'},null,{timeout:8000}).catch(()=>{});
 st=await state();
 check(scope,'Earthquakes and Military flights draw with their counts; Active fires says it needs a key',st.layers.quakes.on&&st.layers.quakes.text==='3'&&st.layers.military.text==='2'&&st.layers.fires.text==='Needs a key',st.layers);
 check(scope,'the providers are credited in the console',/USGS/.test(await page.textContent('.halo__credits'))&&/adsb\.lol/.test(await page.textContent('.halo__credits')));
 /* a picked quake opens what USGS said, with Follow */
 await page.evaluate(()=>HaloConsole.pick({id:{haloPick:true,layer:'quakes',item:{id:'us1',mag:5.4,place:'10 km S of Fixture, Chile',time:new Date().toISOString(),lon:-71.5,lat:-33.4,depth:12,url:'https://earthquake.usgs.gov/earthquakes/eventpage/us1',tsunami:false,alert:'green'}}}));
 check(scope,'a picked quake opens its USGS facts with an official link and Follow',await page.locator('#cctvSheet').isVisible()&&/M5\.4/.test(await page.textContent('#cctvTitle'))&&await page.locator('#cctvBody a[href^="https://earthquake.usgs.gov/"]').count()===1&&await page.locator('#cctvBody .halo-follow-btn').isVisible());
 await page.locator('#cctvBody .halo-follow-btn').click();
 await page.waitForTimeout(400);
 st=await state();
 check(scope,'Follow locks the camera on it and says so',!!st.following&&await page.locator('.halo-follow').isVisible(),st.following);
 await page.keyboard.press('Escape');
 st=await state();
 check(scope,'Escape stops following',!st.following&&await page.locator('.halo-follow').isHidden());
 /* vision and HUD */
 await page.locator('[role=tab][data-tab="vision"]').click();
 await page.locator('[data-halo-style="flir"]').click();
 /* the style fades in from the next animation frame, which software GL at desktop size can hold back past a fixed wait */
 const stagesOn=()=>{const s=HuGlobe.viewer().scene.postProcessStages;let on=0;for(let i=0;i<s.length;i++)if(s.get(i).enabled)on++;return on};
 await page.waitForFunction(stagesOn,null,{timeout:8000}).catch(()=>{});
 st=await state();
 const fx=await page.evaluate(stagesOn);
 check(scope,'Thermal turns on one post-process stage',st.style==='flir'&&fx>=1,{style:st.style,fx});
 await page.keyboard.press('1');
 await page.waitForTimeout(700);
 check(scope,'key 1 goes back to Normal',(await state()).style==='normal');
 await page.locator('[role=tab][data-tab="tools"]').click();
 await page.locator('[data-halo-tool="hud"]').click();
 await page.waitForTimeout(500);
 st=await state();
 /* on a phone the open console covers the HUD's place, so the HUD shows once the console closes */
 let hudSeen;if(width<900){await page.locator('.halo__close').click();hudSeen=await page.locator('.halo-hud-host .halo-hud').isVisible();await page.screenshot({path:join(OUT,'halo-hud-'+width+'.png')});await page.locator('.halo-pill').click()}else hudSeen=await page.locator('.halo-hud-host .halo-hud').isVisible();
 check(scope,'the telemetry HUD shows a place in MGRS and the time in UTC',st.hud&&!!st.readout&&/^\d{1,2}[C-X] [A-Z]{2} \d+ \d+$/.test(String(st.readout.mgrs||''))&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(st.readout.utc||''))&&hudSeen,st.readout);
 /* search flies to the place */
 await page.fill('.halo__search input','Paris');
 await page.locator('.halo__search button').click();
 await page.waitForSelector('.halo__results button',{timeout:5000}).catch(()=>{});
 check(scope,'search lists the places the Worker found',(await page.locator('.halo__results button').count())===2);
 await page.locator('.halo__results button').first().click();
 await page.waitForFunction(()=>{const c=HuGlobe.viewer().camera.positionCartographic;return c.height<200000&&Math.abs(c.longitude*180/Math.PI-2.35)<1},null,{timeout:8000}).catch(()=>{});
 check(scope,'picking a result flies the Earth to it',await page.evaluate(()=>{const c=HuGlobe.viewer().camera.positionCartographic;return c.height<200000&&Math.abs(c.longitude*180/Math.PI-2.35)<1}));
 /* share: a link that carries the view */
 const link=await page.evaluate(()=>HaloConsole._share.link());
 check(scope,'Copy a link makes an owner-only link with the view in its hash',/action-globe\.html\?explore=1&halo=1#halo=[A-Za-z0-9_-]+$/.test(link||''),link);
 check(scope,'no document horizontal overflow with the console open',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 await page.screenshot({path:join(OUT,'halo-console-'+width+'.png')});
 /* the World's frame shows the owner a door to it */
 const frameHost=await ctx.newPage();await frameHost.goto(BASE+'/__world-release_host');
 const frame=await (async()=>{for(let n=0;n<50;n++){const f=frameHost.frames().find(f=>f.url().includes('action-globe.html'));if(f)return f;await frameHost.waitForTimeout(100)}return null})();
 if(frame){await frame.waitForFunction(()=>{const d=document.getElementById('ctlHalo');return d&&!d.hidden},null,{timeout:15000}).catch(()=>{});}
 check(scope,"the World frame shows the owner the Halo door, opening the full-screen globe",!!frame&&await frame.evaluate(()=>{const d=document.getElementById('ctlHalo');return !!d&&!d.hidden&&d.getAttribute('href')==='action-globe.html?explore=1&halo=1'&&d.target==='_top'&&d.getBoundingClientRect().height>=44}));
 await frameHost.close();
 /* role loss takes it away */
 loseOwner();await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await page.waitForFunction(()=>!HaloConsole.state().mounted,null,{timeout:8000}).catch(()=>{});
 check(scope,'losing the owner answer unmounts the console and its layers',!(await state()).mounted&&!(await page.$('#haloPanel'))&&!(await page.$('.halo-pill')));
}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try {
for(const width of [390,1280])for(const persona of (process.env.WORLD_QA_PERSONA?[process.env.WORLD_QA_PERSONA]:['guest','member','creator','owner','halo','failed'])){
 const scope=width+' '+persona, ctx=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390});
 let owner=persona==='owner'||persona==='halo', calls=0, slow=false, mapReads=0, haloCode=0;const errors=[];
 await ctx.addInitScript(p=>{localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));if(p!=='guest')localStorage.setItem('mccdb_session',JSON.stringify({access_token:p}));},persona);
 await ctx.route('**/*',async route=>{
  const url=new URL(route.request().url()), headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
  const json=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
  if(url.origin===BASE){if(/^\/(js\/halo\/|css\/halo)/.test(url.pathname))haloCode++;if(url.pathname==='/__world-release_host')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><iframe style="width:100%;height:100vh;border:0" src="/action-globe.html?embedded=1&surface=network"></iframe></body></html>'});return route.continue();}
  if(url.hostname==='cesium.com'){
   const path=url.pathname.split('/Build/Cesium/')[1];try{return route.fulfill({body:await readFile(join(process.env.CESIUM_DIR,path)),contentType:TYPES[extname(path)]||'application/octet-stream'});}catch{return route.abort();}
  }
  if(url.hostname==='api.mccluster.org'){
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(url.pathname==='/v1/world/access'){mapReads++;return persona==='failed'?json({},503):json({release:{version:'globe-admin-preview/v1',admin_preview:owner},level:owner?'owner':persona,unlocked_layers:owner?['flights','satellites','launches','music','audience','transport']:[],locked_layers:FEATURES.filter(x=>!owner||['ion','cctv','intel'].includes(x)).map(id=>({id,reason:'admin_preview'})),layers:{}});}
   if(persona==='halo'&&HALO_FIXTURES[url.pathname]){calls++;return json(HALO_FIXTURES[url.pathname]);}
   if(persona==='halo'&&url.pathname==='/v1/world/geocode')return json({ok:true,query:url.searchParams.get('q'),results:[{name:'Paris, Île-de-France, France',kind:'city',lon:2.3522,lat:48.8566,bbox:[2.22,48.81,2.47,48.90]},{name:'Paris, Texas, United States',kind:'town',lon:-95.5555,lat:33.6609,bbox:null}],attribution:'Photon by Komoot · © OpenStreetMap contributors',license:'ODbL-1.0'});
   if(url.pathname.includes('/v1/world/layers/')){calls++;if(slow)await new Promise(r=>setTimeout(r,250));return json({aircraft:[],count:0});}
   return json({},404);
  }
  if(url.hostname.endsWith('supabase.co'))return json(url.pathname.includes('/rpc/')?[]:{});
  if(route.request().resourceType()==='image')return route.fulfill({body:PNG,contentType:'image/png',headers});
  return route.abort();
 });
 const host=await ctx.newPage();host.on('pageerror',e=>errors.push(e.message));
 await host.goto(BASE+(persona==='creator'?'/__world-release_host':persona==='halo'?'/action-globe.html?explore=1&halo=1':'/action-globe.html?explore=1'));const page=persona==='creator'?host.frames().find(f=>f.url().includes('action-globe.html')):host;await page.waitForFunction(()=>typeof window.__huGlobeSettled==='function');
 await page.waitForTimeout(300);
 check(scope,'base globe remains available',await page.locator('#globe canvas').count()>0);
 check(scope,'no document horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 if(!owner){
  await page.waitForTimeout(400);
  check(scope,'no Halo console, and no Halo code fetched, for anyone but the owner',!(await page.$('.halo-pill'))&&!(await page.evaluate(()=>!!window.HaloConsole))&&haloCode===0,{haloCode});
  if(persona==='creator')check(scope,"the World frame's Halo door stays hidden",await page.evaluate(()=>{const d=document.getElementById('ctlHalo');return !!d&&d.hidden}));
  check(scope,'optional controls hidden',await page.evaluate(ids=>ids.every(id=>document.getElementById(id).hidden),BUTTONS));
  await page.evaluate(ids=>ids.forEach(id=>document.getElementById(id).click()),BUTTONS);await page.waitForTimeout(100);
  check(scope,'synthetic clicks cannot fetch a layer',calls===0);
  if(persona==='creator'){await host.evaluate(()=>{const f=document.querySelector('iframe').contentWindow;f.postMessage({type:'hu:creator-mode',on:true},location.origin);f.postMessage({type:'hu:audience-points',points:[{lon:-74,lat:41,views:7,name:'Fixture'}]},location.origin);});await page.waitForTimeout(100);check(scope,'parent messages cannot bypass release policy',await page.evaluate(()=>window.__huAudienceCount()===0));}
 }else if(persona==='halo'){
  await haloChecks(scope,page,host,width,ctx,()=>{owner=false},()=>calls);
 }else{
  await page.locator('.globe-editorial-tools > summary').click();
  check(scope,'verified owner has preview control',await page.locator('#ctlFlights').isVisible());
  await page.locator('#ctlFlights').click();await page.waitForFunction(()=>window.__huLayerOn('flights'));
  check(scope,'owner preview works',calls===1);
  owner=false;const reads=mapReads;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForFunction(()=>document.getElementById('ctlFlights').hidden);
  check(scope,'role loss clears active data',!(await page.evaluate(()=>window.__huLayerOn('flights')))&&mapReads>reads);
  owner=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForFunction(()=>!document.getElementById('ctlFlights').hidden);
  slow=true;await page.locator('#ctlFlights').click();await page.evaluate(()=>{localStorage.removeItem('mccdb_session');window.dispatchEvent(new StorageEvent('storage',{key:'mccdb_session'}));});owner=false;
  await page.waitForTimeout(500);
  check(scope,'late response after sign-out never draws',!(await page.evaluate(()=>window.__huLayerOn('flights'))));
 }
 check(scope,'no JavaScript runtime errors',errors.length===0,errors);
 if(persona==='guest')await page.screenshot({path:join(OUT,'curated-world-'+width+'.png')});
 await ctx.close();
}
}finally{await browser.close();server.close();}
if(failed)process.exitCode=1;
