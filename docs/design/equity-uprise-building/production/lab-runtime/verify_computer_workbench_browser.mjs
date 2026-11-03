/* Sealed browser fixture: exact checked-out app, real WebGL, mocked owner answer; never production login. */
import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const ROOT=fileURLToPath(new URL('../../../../../',import.meta.url));
const OUT=process.env.EQUIPMENT_PROOF_DIR||'/tmp/equipment-proof';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PW_MODULE||'/tmp/smoke-qa/node_modules/playwright');
const browser=await chromium.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const BASE='https://equipment.test',P='docs/design/equity-uprise-building/production/';
const remap={
 'lab-runtime/':P+'lab-runtime/',
 'electronics/server-lab-hardware-v1.json':P+'electronics/server-lab-hardware-v1.json',
 'equity-uprise-asset-registry-v1.json':P+'asset-registry/generated/equity-uprise-asset-registry-v1.json',
 'equity-uprise-electronics-connections-v1.json':P+'electronics/generated/equity-uprise-electronics-connections-v1.json',
 'equity-uprise-electronics-manifest-v1.json':P+'electronics/generated/equity-uprise-electronics-manifest-v1.json',
};
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const results=[];const check=(name,ok)=>{results.push({name,pass:!!ok});assert.ok(ok,name);};
await mkdir(OUT,{recursive:true});
async function open(width,persona='owner',mode='TRAINING'){
 const context=await browser.newContext({viewport:{width,height:width<800?844:1000},hasTouch:width<800,deviceScaleFactor:1,serviceWorkers:'block'});
 if(persona!=='guest')await context.addInitScript(()=>{localStorage.setItem('mccdb_session',JSON.stringify({access_token:'test-owner-token',expires_at:Math.floor(Date.now()/1000)+3600}));});
 const calls=[];
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());calls.push(u.href);
  if(u.origin==='https://api.mccluster.org')return route.fulfill({status:persona==='owner'?200:403,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:'{"ok":true}'});
  if(u.origin!==BASE)return route.fulfill({status:200,body:'',contentType:'text/css'});
  let path=decodeURIComponent(u.pathname.slice(1));
  if(path.startsWith('equity-uprise-preview/')){let sub=path.slice('equity-uprise-preview/'.length);let key=Object.keys(remap).find(k=>k.endsWith('/')?sub.startsWith(k):sub===k);if(!key)return route.fulfill({status:404,body:'unmapped'});path=remap[key]+(key.endsWith('/')?sub.slice(key.length):'');}
  const file=resolve(ROOT,path);if(!file.startsWith(ROOT.replace(/\/$/,'')+sep))return route.fulfill({status:403,body:''});
  try{return route.fulfill({status:200,contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:'missing '+path});}
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(BASE+'/screens/terminal.html?tab=hardware&mode='+mode+'&screen=SCR-F1-USER-MON-01-01');
 return {page,context,calls,errors};
}
async function overflow(page,name){const [s,c]=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);check(name+' no horizontal overflow',s===c);}
async function click(page,sel){await page.locator(sel).click();}
async function shot(page,name){await page.screenshot({path:join(OUT,name+'.png'),fullPage:true});}
try{
 for(const persona of ['guest','member']){const {page,context,calls}=await open(390,persona);await page.waitForFunction(()=>document.documentElement.dataset.ownerAccess==='closed');check(persona+' cannot mount equipment',await page.locator('.eq').count()===0);check(persona+' never loads hardware data',!calls.some(c=>c.includes('computer-hardware-profile')));await overflow(page,persona);await context.close();}
 for(const width of [390,1440]){
  const {page,context,errors}=await open(width);await page.waitForSelector('[data-stage][data-ready="1"]',{timeout:90000});
  check(width+' all registered computers in selector',await page.locator('[data-machine] option').count()===42);
  check(width+' real WebGL canvas',await page.locator('.eq-stage canvas').count()===1);
  check(width+' initial desktop ready',await page.locator('[data-desktop]').isEnabled());
  await overflow(page,width+' exterior');await shot(page,width+'-workstation-front');
  await click(page,'[data-view="inspect"]');await shot(page,width+'-workstation-inside');
  await click(page,'[data-view="explode"]');await shot(page,width+'-workstation-exploded');
  await click(page,'[data-act="open_cover"]');check(width+' live service refusal',/isolate|disconnect|Shut down/.test(await page.locator('[data-msg]').innerText()));
  await click(page,'[data-act="shutdown"]');check(width+' powered off cannot open app',await page.locator('[data-desktop]').isDisabled());
  const power=page.locator('.eq-port').filter({hasText:'power'}).locator('button');await power.click();await click(page,'[data-act="open_cover"]');
  await click(page,'[data-part="RAM-A2"]');await click(page,'[data-part-act="remove"]');check(width+' ESD required',/ESD/.test(await page.locator('[data-msg]').innerText()));
  await click(page,'[data-act="esd"]');await click(page,'[data-part-act="remove"]');
  await page.locator('[data-kit]').selectOption('DDR4-UDIMM-16');await click(page,'[data-part-act="install"]');check(width+' wrong RAM refused',/requires/.test(await page.locator('[data-msg]').innerText()));
  await page.locator('[data-kit]').selectOption('DDR5-UDIMM-16');await click(page,'[data-part-act="install"]');
  await click(page,'[data-act="close_cover"]');await power.click();await click(page,'[data-act="power_on"]');
  for(let i=0;i<3;i++)await click(page,'[data-act="advance"]');
  check(width+' login gates desktop',await page.locator('[data-desktop]').isDisabled());await click(page,'[data-act="sign_in"]');check(width+' boot and sign-in completed',await page.locator('[data-desktop]').isEnabled());
  const video=page.locator('.eq-port').filter({hasText:'video'}).locator('button');await video.click();check(width+' monitor cable blocks app',await page.locator('[data-desktop]').isDisabled());await video.click();check(width+' monitor restored',await page.locator('[data-desktop]').isEnabled());
  await page.locator('[data-machine]').selectOption('B1-SRV-HYP-01-I001');await page.waitForSelector('[data-stage][data-ready="1"][data-asset="B1-SRV-HYP-01-I001"]');
  check(width+' exact server DIMM IDs',await page.locator('[data-part="CPU1-DIMM-A1"]').count()===1);
  await click(page,'[data-view="inspect"]');await shot(page,width+'-server-inside');
  const feeds=page.locator('.eq-port').filter({hasText:'power'}).locator('button');check(width+' server dual power feeds',await feeds.count()===2);
  await feeds.nth(0).click();check(width+' single feed retained operation',await page.locator('[data-desktop]').isEnabled());await feeds.nth(1).click();check(width+' both feeds stop host',await page.locator('[data-desktop]').isDisabled());
  await overflow(page,width+' server');
  const sizes=await page.locator('.eq button:visible').evaluateAll(bs=>bs.map(b=>b.getBoundingClientRect().height));check(width+' touch targets at least 44 px',sizes.every(h=>h>=44));
  check(width+' no application page errors',errors.length===0);
  await context.close();
 }
 const {page,context}=await open(390,'owner','WORKPLACE');await page.waitForSelector('[data-stage][data-ready="1"]',{timeout:90000});check('Workplace all mutation controls disabled',await page.locator('[data-ops] button:enabled').count()===0);await context.close();
} finally {await writeFile(join(OUT,'results.json'),JSON.stringify({results},null,2));await browser.close();}
console.log(JSON.stringify({checks:results.length,passed:results.filter(r=>r.pass).length}));
