/* Focused lifecycle UI checks with local files and synthetic auth. No production requests.
   This exercises failure/resume behavior, not WebGL playability or real-device performance.
   PLAYWRIGHT_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chromium node scripts/e2e/prim3-transit-lifecycle.e2e.mjs */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import * as L from '../../js/prim3-tactics/levels/transit-relay.mjs';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = 'https://matthew.mccluster.org';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg' };
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const fresh = () => R.beginPlayerPhase(R.createState(L.engineConfig({seed:31})));
async function open({saved=null, failAI=false, failStorage=false, webgl=false}={}) {
 const ctx=await browser.newContext({viewport:{width:390,height:844}});
 await ctx.addInitScript(({saved,failStorage,webgl})=>{
  const context=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(kind,...args){return !webgl && /^webgl/.test(kind)?null:context.call(this,kind,...args);};
  const token='x.'+btoa(JSON.stringify({sub:'11111111-1111-4111-8111-111111111111',exp:Math.floor(Date.now()/1000)+3600}))+'.y';
  localStorage.setItem('mccdb_session',JSON.stringify({access_token:token,expires_at:Math.floor(Date.now()/1000)+3600}));
  if(saved!==null) localStorage.setItem('prim3.transit.v1',saved);
  if(failStorage){const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='prim3.transit.v1')throw new DOMException('Quota exceeded','QuotaExceededError');return set.call(this,k,v);};}
 },{saved,failStorage,webgl});
 await ctx.route('**/*',async r=>{
  const u=new URL(r.request().url());
  if(u.hostname==='api.mccluster.org') return r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(u.pathname==='/v1/status'?{ok:true,operator:{email:'fixture@invalid'}}:{items:[]})});
  if(u.origin!==BASE)return r.abort();
  const f=resolve(ROOT,decodeURIComponent(u.pathname.slice(1)));if(!f.startsWith(resolve(ROOT)+sep))return r.abort();
  if(failAI && u.pathname.endsWith('/tactical-threat-ai.mjs')) return r.fulfill({contentType:'text/javascript',body:'export function runThreatPhase(){throw new Error("fixture AI failure");}'});
  try{return r.fulfill({contentType:MIME[extname(f)]||'application/octet-stream',body:await readFile(f)});}catch{return r.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();
 await page.goto(BASE+'/prim3-transit.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!window.__tx,{timeout:20000});
 return {ctx,page};
}
try {
 {const {ctx,page}=await open({failAI:true});
  const before=await page.evaluate(()=>JSON.stringify(window.__tx.state));
  await page.evaluate(()=>window.__tx.endTurn());
  assert.equal(await page.evaluate(()=>JSON.stringify(window.__tx.state)),before);
  assert.match(await page.locator('#txSheet').innerText(),/No turn or clock was spent/);
  assert.equal(await page.locator('#txEndTurn').isDisabled(),false);
  await ctx.close();console.log('PASS AI failure retains state and offers retry');}
 {const {ctx,page}=await open({failAI:true,webgl:true});
  await page.evaluate(()=>window.__tx.endTurn());
  await page.waitForTimeout(500);
  assert.match(await page.locator('#txSheet').innerText(),/No turn or clock was spent/);
  await ctx.close();console.log('PASS renderer load failure does not erase the turn error');}
 {const s=fresh();s.mission.clock=0;s.mission.escalation='TERMINAL';const {ctx,page}=await open({saved:JSON.stringify({v:1,state:s,log:[]})});
  assert.match(await page.locator('#txEnd').innerText(),/Mission failed/i);
  assert.equal(await page.locator('#txEndTurn').isDisabled(),true);
  await ctx.close();console.log('PASS terminal saved mission resumes as failed');}
 for (const saved of ['{"v":1,"state":{"units":[]}}', JSON.stringify({v:1,state:{...fresh(),machines:{}}})]) {const {ctx,page}=await open({saved});
  assert.match(await page.locator('#txSaveNotice').innerText(),/kept unchanged/);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.evaluate(()=>localStorage.getItem('prim3.transit.v1')),saved);
  await page.evaluate(()=>window.__tx.restart());
  assert.equal(await page.locator('#txSaveNotice').isVisible(),false);
  assert.ok(JSON.parse(await page.evaluate(()=>localStorage.getItem('prim3.transit.v1'))).state.units.length>0);
  await ctx.close();console.log('PASS corrupt save retained until explicit restart: '+(saved.includes('machines')?'malformed machines':'missing state'));}
 {const {ctx,page}=await open({failStorage:true});
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  assert.match(await page.locator('#txSaveNotice').innerText(),/could not be saved/);
  assert.equal(await page.locator('#txEndTurn').isDisabled(),false);
  await ctx.close();console.log('PASS storage failure is visible without destroying play state');}
}finally{await browser.close();}
