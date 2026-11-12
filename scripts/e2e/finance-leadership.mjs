/* Actual World mode, existing Cesium viewer and Finance modules. All HTTP is intercepted;
   issuer facts use the checked-in reference, identity/quotes are explicit fixtures.
   No real owner session, provider request, database write or production access. */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve,join,extname,sep} from 'node:path';
import {handleIntelRequest} from '../../workers/mccluster/src/intel/router.js';
import {IntelError} from '../../workers/mccluster/src/intel/store.js';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),BASE='https://matthew.mccluster.org';
const CESIUM=process.env.CESIUM_DIR;if(!CESIUM)throw Error('CESIUM_DIR must point to the locally installed Cesium Build/Cesium directory');
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/codex/cua_node/lib/node_modules','x'))('playwright');
const OUT=process.env.FINANCE_LEADERSHIP_ARTIFACT_DIR||'/tmp/finance-leadership-e2e';await mkdir(OUT,{recursive:true});
const MIME={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.wasm':'application/wasm'};
const OWNER='11111111-1111-4111-8111-111111111111';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const results=[];
try{for(const width of [390,1280]){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],requests=[];let allowed=true,delayAMD=false,releaseAMD;
 await context.addInitScript(owner=>{const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:owner}))+'.y',expires_at:exp,user:{id:owner}}));localStorage.setItem('mcc_world_owner',JSON.stringify({sub:owner}));localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));},OWNER);
 const json=(r,d,status=200)=>r.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':BASE,'access-control-allow-headers':'*'},body:JSON.stringify(d)});
 await context.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url()),p=u.pathname;
  if(request.method()==='OPTIONS')return json(route,{});
  if(u.origin==='https://api.mccluster.org'){
   if(p.startsWith('/v1/intel/finance/')){
    requests.push({path:p+u.search,method:request.method()});
    if(delayAMD&&p.endsWith('/leadership')&&u.searchParams.get('symbol')==='AMD'){delayAMD=false;await new Promise(r=>releaseAMD=r);}
    const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',FINANCE_DEV_ENABLED:'true'};
    const res=await handleIntelRequest(new Request(request.url(),{method:request.method()}),env,{requireHouseOwner:async()=>{if(!allowed)throw new IntelError('denied',403,'forbidden');return {id:OWNER};},financeMarket:{search:async()=>{throw Object.assign(new Error('needs_key'),{code:'needs_key',status:503});},quote:async(_env,symbol)=>({instrument:{symbol,mic:symbol==='AMD'||symbol==='AEP'?'XNAS':'XNYS'},bid:123.45,ask:123.47,as_of:'2026-11-11T00:00:00Z',feed:'iex',status:'stale',session:'closed'})}});
    return json(route,await res.json(),res.status);
   }
   if(p==='/v1/world/access')return json(route,{release:{version:'globe-admin-preview/v1',admin_preview:allowed},level:allowed?'owner':'public',levels:[],unlocked_layers:[],locked_layers:[]});
   if(p==='/v1/status')return json(route,allowed?{ok:true,operator:{email:'owner@fixture.invalid'}}:{error:'Forbidden'},allowed?200:403);
   return json(route,{ok:true,items:[],events:[],missions:[],threads:[],total:0});
  }
  if(u.hostname.endsWith('supabase.co'))return json(route,p==='/auth/v1/user'?{id:OWNER}:[]);
  let file;
  if(u.hostname==='cesium.com'){const part=p.split('/Build/Cesium/')[1];if(part){const f=resolve(CESIUM,part);if(f.startsWith(resolve(CESIUM)+sep))file=f;}}
  else if(u.origin===BASE){const f=resolve(ROOT,decodeURIComponent(p.slice(1)));if(f.startsWith(resolve(ROOT)+sep))file=f;}
  if(file){try{let body=await readFile(file);if(p==='/mnet.html')body=Buffer.from(body.toString().replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi,(whole,attrs)=>/src="js\/(?:world-owner-modes\.js|world-news-globe\.js|travel\/world-travel\.mjs|halo\/finance(?:-roster|-dashboard|-ownership)?\.js|world-finance\.mjs)/.test(attrs)?whole:''));return route.fulfill({body,contentType:MIME[extname(file)]||'application/octet-stream',headers:{'access-control-allow-origin':'*'}});}catch{return route.fulfill({status:404,body:''});}}
  return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(BASE+'/mnet.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.MCC_WORLD_MODE&&document.getElementById('mnWorldFrame')?.contentWindow?.HuGlobe?.viewer(),{},{timeout:60000});
 const frame=page.frameLocator('#mnWorldFrame');
 await page.evaluate(()=>{window.__originalFrame=document.getElementById('mnWorldFrame');window.__originalViewer=window.__originalFrame.contentWindow.HuGlobe.viewer();});
 await page.locator('.wt-world-modes [data-world-mode="finance"]').click();
 await page.waitForSelector('#worldFinance [data-r-symbol="AMD"]');
 assert.equal(await page.locator('#mnWorldFrame').count(),1);assert.match(await page.locator('[data-r-status]').textContent(),/5 company business addresses/);
 await page.waitForFunction(()=>document.querySelectorAll('.hm__ownership-route').length===13);
 assert.match(await page.locator('[data-o-routes]').textContent(),/Plan nominee holding; whole-share DRS exit/);
 assert.match(await page.locator('[data-o-routes]').textContent(),/1 existing whole share/);
 assert.match(await page.locator('[data-o-routes]').textContent(),/Unknown, not a zero fee/);
 await page.locator('[data-o-domicile]').selectOption('JP');
 assert.equal(await page.locator('.hm__ownership-route').count(),1);
 assert.match(await page.locator('[data-o-routes]').textContent(),/Registered ADRs, not underlying ordinary shares/);
 await page.locator('[data-o-all]').click();await page.waitForFunction(()=>document.querySelectorAll('.hm__ownership-route').length===13);
 await page.screenshot({path:join(OUT,'finance-ownership-'+width+'.png'),fullPage:true});
 await page.locator('[data-r-symbol="AMD"]').click();await page.waitForFunction(()=>document.querySelector('[data-r-detail]')?.textContent.includes('Lisa T. Su'));
 assert.match(await page.locator('[data-r-detail]').textContent(),/2485 Augustine Drive/);assert.match(await page.locator('[data-r-detail]').textContent(),/address range interpolated/);
 await page.locator('[data-r-detail] [data-f-ownership-issuer]').click();
 await page.waitForFunction(()=>document.querySelector('[data-o-routes]')?.textContent.includes('No verified reference match'));
 assert.ok(requests.some(r=>r.path==='/v1/intel/finance/ownership-options?issuer_id=sec%3A0000002488'),'Roster selects exact issuer, not ticker coincidence');
 await page.locator('[data-r-map]').click();await page.waitForFunction(()=>document.querySelector('[data-r-status]').textContent.includes('5 company business addresses'));
 const count=await page.evaluate(()=>window.__originalViewer.scene.primitives.length);
 await page.locator('[data-r-locate]').click();await page.waitForTimeout(1200);
 const screen=await page.evaluate(()=>{const w=document.getElementById('mnWorldFrame').contentWindow,v=w.HuGlobe.viewer(),p=w.Cesium.SceneTransforms.worldToWindowCoordinates(v.scene,w.Cesium.Cartesian3.fromDegrees(-121.971776930382,37.382307061778,100));return {x:p.x,y:p.y};});
 const bounds=await page.locator('#mnWorldFrame').boundingBox();await page.mouse.move(bounds.x+screen.x,bounds.y+screen.y);await page.waitForFunction(()=>document.querySelector('[data-r-quote-status]')?.textContent.includes('123.45'));
 assert.equal(requests.filter(r=>r.path.startsWith('/v1/intel/finance/leadership-quote?symbol=AMD')).length,1,'Pin hover requests a financial snapshot before the accessible button is used');
 await page.locator('[data-r-quote]').click();await page.waitForFunction(()=>document.querySelector('[data-r-quote-status]')?.textContent.includes('123.45'));
 assert.match(await page.locator('[data-r-quote-status]').textContent(),/stale.*iex.*closed/);assert.equal(requests.filter(r=>r.path.startsWith('/v1/intel/finance/leadership-quote?symbol=AMD')).length,1);
 assert.ok(await page.evaluate(()=>window.__originalViewer.scene.primitives.length>=2));
 const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert.equal(dimensions.scroll,dimensions.client,JSON.stringify(dimensions));
 await page.screenshot({path:join(OUT,'finance-roster-'+width+'.png'),fullPage:true});
 // The latest selection wins even when an older issuer request finishes last.
 delayAMD=true;await page.locator('[data-r-symbol="AMD"]').click();for(let n=0;n<100&&!releaseAMD;n++)await page.waitForTimeout(10);assert.ok(releaseAMD);
 await page.locator('[data-r-symbol="VZ"]').click();await page.waitForFunction(()=>document.querySelector('[data-r-detail]')?.textContent.includes('Verizon Communications'));releaseAMD();await page.waitForTimeout(100);assert.match(await page.locator('[data-r-detail]').textContent(),/Verizon Communications/);
 for(let n=0;n<3;n++){await page.locator('.wt-world-modes [data-world-mode="posts"]').click();assert.equal(await page.locator('#worldFinance').count(),0);assert.ok(await page.evaluate(()=>window.__originalViewer.scene.primitives.length)<count);await page.locator('.wt-world-modes [data-world-mode="finance"]').click();await page.waitForSelector('[data-r-symbol="AMD"]');}
 assert.ok(await page.evaluate(()=>document.getElementById('mnWorldFrame')===window.__originalFrame&&window.__originalFrame.contentWindow.HuGlobe.viewer()===window.__originalViewer));
 allowed=false;await page.locator('[data-r-reload]').click();await page.waitForFunction(()=>document.querySelector('[data-r-status]')?.textContent==='Owner authentication required.');assert.equal(await page.locator('[data-r-detail]').textContent(),'');
 await page.waitForFunction(()=>document.querySelector('[data-o-status]')?.textContent==='Owner authentication required.');assert.equal(await page.locator('[data-o-routes]').textContent(),'');assert.ok(await page.locator('[data-o-all]').isDisabled());
 assert.ok(requests.every(r=>r.method==='GET'),'No mutation or trade');assert.deepEqual(errors,[]);
 results.push({width,same_viewer:true,owner_tab:true,public_roster:true,address_pins:5,source_precision:true,quote_fixture:true,ownership_routes:13,ownership_units_and_unknowns:true,adr_distinct:true,issuer_bound_research:true,no_overflow:true,repeated_modes:true,stale_selection_discarded:true,denied_clears:true,no_writes:true});await context.close();
 }
 await writeFile(join(OUT,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
