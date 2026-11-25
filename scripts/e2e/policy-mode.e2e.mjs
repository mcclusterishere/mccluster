/* Policy real-page regression: delayed identity, visibility races, live denial and revocation.
   Network identity and data answers are synthetic fixtures.
   PLAYWRIGHT_DIR=<node_modules> CESIUM_DIR=<Cesium Build dir> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/policy-mode.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/policy-mode-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org',CESIUM=process.env.CESIUM_DIR;
if(!CESIUM)throw Error('CESIUM_DIR is required; the test never downloads runtime assets.');
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.geojson':'application/json','.wasm':'application/wasm','.glb':'model/gltf-binary','.ktx2':'image/ktx2'};
const OWNER='11111111-1111-4111-8111-111111111111';
const results=[];
function check(scope,name,ok,detail){results.push(ok);console.log((ok?'PASS ':'FAIL ')+'['+scope+'] '+name+(ok?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});
const json=(r,b,s=200)=>r.fulfill({status:s,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(b)});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
async function setup(viewport,who){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const errors=[],broadcasts=[];let owner=who===OWNER,hold=false,releaseEligibility;
  let eligibilitySeen;const pendingEligibility=new Promise(r=>eligibilitySeen=r);
  await ctx.addInitScript(({who})=>{window.__policyMediaRequests=0;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{window.__policyMediaRequests++;throw Error('Fixture forbids media capture');};localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:who,email:who+'@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture',expires_at:exp,user:{id:who}}));},{who});
  await ctx.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.hostname==='cesium.com'){const rel=p.split('/Build/Cesium/')[1];const f=rel&&resolve(CESIUM,rel);if(f&&f.startsWith(resolve(CESIUM)+sep)){try{return r.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'});}catch{}}return r.abort();}
    if(u.origin==='https://api.mccluster.org'){
      if(req.method()!=='GET'&&/live/.test(p))broadcasts.push(p);
      if(p==='/v1/mnet/live/eligibility'){
        if(hold){hold=false;await new Promise(resolve=>{releaseEligibility=resolve;eligibilitySeen();});return json(r,{can_host:true,enabled:true});}
        return json(r,{can_host:true,enabled:false});
      }
      if(p==='/v1/status')return owner?json(r,{ok:true,operator:{email:'owner@fixture.invalid'}}):json(r,{error:'Forbidden'},403);
      if(p==='/v1/world/access')return json(r,{release:{version:'globe-admin-preview/v1',admin_preview:owner},level:owner?'owner':'public',levels:[],unlocked_layers:[],locked_layers:[]});
      if(p==='/v1/mnet/bootstrap')return json(r,{identity:{mccluster_id:owner?'matthew':'member.one',m_uid:'m-'+who.slice(0,4)},profile:{display_name:owner?'Matthew McCluster':'Member One'}});
      return json(r,{ok:true,items:[],threads:[],events:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co')){if(p==='/auth/v1/user'){await page.waitForSelector('#policyMode',{state:'attached',timeout:10000});return json(r,{id:who,email:who+'@fixture.invalid'});}return json(r,[]);}
    if(u.origin===BASE){const rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));const f=resolve(ROOT,rel);if(!f.startsWith(resolve(ROOT)+sep))return r.abort();
      try{return r.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'});}catch{return r.fulfill({status:404,body:''});}}
    return r.abort();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page,errors,broadcasts,revoke:()=>{owner=false;},holdEligibility:()=>{hold=true;return pendingEligibility;},releaseEligibility:()=>releaseEligibility()};
}
const overflow=p=>p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);

try {
  for(const width of [390,820,1280]){
    const fixture=await setup({width,height:900},OWNER);
    const {ctx,page,errors,broadcasts}=fixture;
    await page.goto(BASE+'/mnet.html?view=feed&policy=1',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('html.policy-active',{timeout:15000});
    check(width,'delayed identity activates owner Policy without focus workaround',await page.locator('[data-policy-action=live]').isEnabled());
    check(width,'all Policy buttons have 44px targets',await page.locator('[data-policy-action]').evaluateAll(xs=>xs.every(x=>{const r=x.getBoundingClientRect();return r.width>=44&&r.height>=44;})));
    for(const view of ['feed','globe']){
      await page.click(`[data-policy-action=${view}]`);
      check(width,view+' switches the real existing surfaces',await page.evaluate(v=>document.documentElement.dataset.policyView===v&&getComputedStyle(document.getElementById('mnWorld')).display!=='none'===(v==='globe')&&getComputedStyle(document.getElementById('mnWorldFeed')).display!=='none'===(v==='feed'),view));
      check(width,view+' has no horizontal overflow',await overflow(page)===0);
    }
    await page.click('[data-policy-action=live]');
    await page.waitForFunction(()=>document.querySelector('#policyMode [role=status]').textContent.includes('not enabled'));
    check(width,'disabled live service does not open studio',!(await page.locator('#mnStudio').evaluate(x=>x.open)));
    const pending=fixture.holdEligibility();
    await page.click('[data-policy-action=live]');
    let timer;try{await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Eligibility fixture was not reached')),10000);})]);}finally{clearTimeout(timer);}
    check(width,'live request disables controls while pending',await page.locator('[data-policy-action=live]').isDisabled());
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(()=>!document.querySelector('[data-policy-action=live]').disabled);
    fixture.releaseEligibility();
    await page.click('[data-policy-action=feed]');
    check(width,'visibility revalidation restores usable controls and invalidates old studio request',await page.locator('[data-policy-action=feed]').getAttribute('aria-pressed')==='true'&&!(await page.locator('#mnStudio').evaluate(x=>x.open)));
    await page.screenshot({path:OUT+'/policy-'+width+'.png'});
    fixture.revoke();
    await page.evaluate(()=>window.MCC_BAR.verifyAdmin());
    check(width,'canonical owner denial withdraws Policy and disables all controls',await page.evaluate(()=>!document.documentElement.classList.contains('policy-active')&&[...document.querySelectorAll('[data-policy-action]')].every(x=>x.disabled)));
    check(width,'no camera or microphone requests',await page.evaluate(()=>window.__policyMediaRequests===0));
    check(width,'no broadcast writes',broadcasts.length===0,broadcasts);
    check(width,'no JavaScript errors',errors.length===0,errors);
    await ctx.close();
  }
} finally {await browser.close();}
console.log(`${results.filter(Boolean).length}/${results.length} passed · screenshots in ${OUT}`);
if(results.some(x=>!x))process.exitCode=1;
