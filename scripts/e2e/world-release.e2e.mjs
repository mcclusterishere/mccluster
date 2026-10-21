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


const FEATURES=['flights','satellites','launches','intel','music','cctv','audience','transport','ion'];
const BUTTONS=['ctlFlights','ctlSats','ctlLaunch','ctlIntel','ctlMusic','ctlCctv','ctlTransport'];
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try {
for(const width of [390,1280])for(const persona of (process.env.WORLD_QA_PERSONA?[process.env.WORLD_QA_PERSONA]:['guest','member','creator','owner','failed'])){
 const scope=width+' '+persona, ctx=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390});
 let owner=persona==='owner', calls=0, slow=false, mapReads=0;const errors=[];
 await ctx.addInitScript(p=>{localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));if(p!=='guest')localStorage.setItem('mccdb_session',JSON.stringify({access_token:p}));},persona);
 await ctx.route('**/*',async route=>{
  const url=new URL(route.request().url()), headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
  const json=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
  if(url.origin===BASE){if(url.pathname==='/__world-release_host')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><iframe style="width:100%;height:100vh;border:0" src="/action-globe.html?embedded=1&surface=network"></iframe></body></html>'});return route.continue();}
  if(url.hostname==='cesium.com'){
   const path=url.pathname.split('/Build/Cesium/')[1];try{return route.fulfill({body:await readFile(join(process.env.CESIUM_DIR,path)),contentType:TYPES[extname(path)]||'application/octet-stream'});}catch{return route.abort();}
  }
  if(url.hostname==='api.mccluster.org'){
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(url.pathname==='/v1/world/access'){mapReads++;return persona==='failed'?json({},503):json({release:{version:'globe-admin-preview/v1',admin_preview:owner},level:owner?'owner':persona,unlocked_layers:owner?['flights','satellites','launches','music','audience','transport']:[],locked_layers:FEATURES.filter(x=>!owner||['ion','cctv','intel'].includes(x)).map(id=>({id,reason:'admin_preview'})),layers:{}});}
   if(url.pathname.includes('/v1/world/layers/')){calls++;if(slow)await new Promise(r=>setTimeout(r,250));return json({aircraft:[],count:0});}
   return json({},404);
  }
  if(url.hostname.endsWith('supabase.co'))return json(url.pathname.includes('/rpc/')?[]:{});
  if(route.request().resourceType()==='image')return route.fulfill({body:PNG,contentType:'image/png',headers});
  return route.abort();
 });
 const host=await ctx.newPage();host.on('pageerror',e=>errors.push(e.message));
 await host.goto(BASE+(persona==='creator'?'/__world-release_host':'/action-globe.html?explore=1'));const page=persona==='creator'?host.frames().find(f=>f.url().includes('action-globe.html')):host;await page.waitForFunction(()=>typeof window.__huGlobeSettled==='function');
 await page.waitForTimeout(300);
 check(scope,'base globe remains available',await page.locator('#globe canvas').count()>0);
 check(scope,'no document horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 if(!owner){
  check(scope,'optional controls hidden',await page.evaluate(ids=>ids.every(id=>document.getElementById(id).hidden),BUTTONS));
  await page.evaluate(ids=>ids.forEach(id=>document.getElementById(id).click()),BUTTONS);await page.waitForTimeout(100);
  check(scope,'synthetic clicks cannot fetch a layer',calls===0);
  if(persona==='creator'){await host.evaluate(()=>{const f=document.querySelector('iframe').contentWindow;f.postMessage({type:'hu:creator-mode',on:true},location.origin);f.postMessage({type:'hu:audience-points',points:[{lon:-74,lat:41,views:7,name:'Fixture'}]},location.origin);});await page.waitForTimeout(100);check(scope,'parent messages cannot bypass release policy',await page.evaluate(()=>window.__huAudienceCount()===0));}
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
