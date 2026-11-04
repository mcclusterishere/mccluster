// Actual action-globe and pinned Cesium 1.131; owner/API/imagery fixtures, no live ion claim.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,extname,resolve} from 'node:path';
import {metricFrame} from '../../js/spatial/metric-frame.mjs';
import {route} from '../../js/spatial/region-graph.mjs';
const root=process.cwd(),out=process.argv[2]||'/tmp/bridgeport-globe-evidence',build=process.env.CESIUM_BUILD||'/tmp/bridgeport-cesium/package/Build/Cesium';await mkdir(out,{recursive:true});
const {chromium}=createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'package.json'))('playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base='https://matthew.mccluster.org',results=[];
const data=JSON.parse(await readFile('data/spatial/bridgeport-golden-hill.v1.json','utf8')),frame=metricFrame(data.contract.frame.anchor);
try{for(const width of (process.env.WIDTHS||'390,1280').split(',').map(Number)){
 let owner=true,regionLoads=0;const errors=[],context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:1});
 await context.addInitScript(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'local-fixture-owner'})));
 await context.route('**/*',async r=>{const u=new URL(r.request().url()),suffix=u.pathname.split('/Build/Cesium/')[1];
  if(u.hostname==='cesium.com'&&suffix&&!suffix.includes('..')){try{return await r.fulfill({body:await readFile(join(build,suffix)),contentType:suffix.endsWith('.js')?'text/javascript':suffix.endsWith('.css')?'text/css':'application/octet-stream'});}catch{return r.abort();}}
  if(u.origin==='https://api.mccluster.org'||u.hostname.endsWith('supabase.co'))return r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(u.pathname==='/v1/world/access'?{release:{version:'globe-admin-preview/v1',admin_preview:owner},unlocked_layers:[],locked_layers:[]}:u.pathname==='/v1/world/ion'?{available:false}:[])});
  if(u.origin===base){if(u.pathname==='/__bridgeport-host.html')return r.fulfill({contentType:'text/html',body:'<!doctype html><iframe id=globe style="width:100%;height:800px" src="action-globe.html?embedded=1"></iframe><script>window.events=[];addEventListener("message",e=>{if(e.origin===location.origin&&e.source===document.getElementById("globe").contentWindow)events.push(e.data)});</script>'});if(u.pathname.endsWith('/data/spatial/bridgeport-golden-hill.v1.json'))regionLoads++;
   if(['/js/tabbar.js','/js/mcc-auth.js','/js/shell-boot.js'].includes(u.pathname))return r.fulfill({contentType:'text/javascript',body:''});
   const p=resolve(root,'.'+u.pathname);if(!p.startsWith(root+'/'))return r.abort();try{return await r.fulfill({body:await readFile(p),contentType:({'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[extname(p)]||'application/octet-stream'});}catch{return r.fulfill({status:404,body:''});}}
  return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/action-globe.html?explore=1');
 await page.locator('#bridgeportEnter').waitFor({state:'visible',timeout:30000});assert.equal(regionLoads,0);
 await page.locator('#bridgeportEnter').click();await page.waitForFunction(()=>window.BridgeportSlice?.snapshot().attached,{},{timeout:30000});
 await page.waitForFunction(()=>Math.abs(HuGlobe.viewer().camera.positionCartographic.height-360)<1);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(regionLoads,1);assert.match(await page.locator('[data-ion]').textContent(),/unavailable/);
 const first=await page.evaluate(()=>window.BridgeportSlice.snapshot());assert.ok(first.entities>200);assert.equal(first.topology,'hex');
 const path=route(data,'hex',first.position,data.graphs.hex.destinationId),target=data.graphs.hex.nodes.find(n=>n.id===path.ids[2]),geo=frame.toGeo(target.position);
 const point=await page.evaluate(g=>{const v=HuGlobe.viewer(),p=Cesium.SceneTransforms.worldToWindowCoordinates(v.scene,Cesium.Cartesian3.fromDegrees(g.lon,g.lat,0));return {x:p.x,y:p.y};},geo);
 console.log('picking',width,point,target.id);await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Preview:'));
 console.log('picked preview',await page.locator('[data-status]').textContent());await page.locator('[data-confirm]').click();try{await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Arrived'),{},{timeout:15000});}catch(e){console.log('arrival failure',await page.evaluate(()=>({state:BridgeportSlice.snapshot(),status:document.querySelector('[data-status]').textContent})));await page.screenshot({path:join(out,`failed-${width}.png`)});throw e;}
 first.position=(await page.evaluate(()=>window.BridgeportSlice.snapshot())).position;assert.ok(Math.hypot(first.position.x-target.position.x,first.position.z-target.position.z)<.01);
 await page.locator('[data-preview]').click();assert.match(await page.locator('[data-status]').textContent(),/Preview: .*hex cells/);
 assert.deepEqual((await page.evaluate(()=>window.BridgeportSlice.snapshot())).position,first.position);
 await page.locator('[data-confirm]').click();await page.waitForFunction(()=>window.BridgeportSlice.snapshot().position.x!==JSON.parse(localStorage.getItem('here.universe.bridgeport-golden-hill.v1')).position.x);
 await page.locator('[data-stop]').click();const stopped=await page.evaluate(()=>window.BridgeportSlice.snapshot().position);
 await page.locator('select[aria-label="Navigation topology"]').selectOption('square');assert.deepEqual((await page.evaluate(()=>window.BridgeportSlice.snapshot())).position,stopped);
 await page.locator('[data-preview]').click();assert.match(await page.locator('[data-status]').textContent(),/square cells/);
 await page.screenshot({path:join(out,`bridgeport-${width}.png`)});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('[data-return]').click();assert.equal((await page.evaluate(()=>window.BridgeportSlice.snapshot())).entities,0);
 await page.locator('#bridgeportEnter').click();await page.waitForFunction(()=>window.BridgeportSlice.snapshot().attached);assert.deepEqual((await page.evaluate(()=>window.BridgeportSlice.snapshot())).position,stopped);
 await page.reload();await page.locator('#bridgeportEnter').click();await page.waitForFunction(()=>window.BridgeportSlice?.snapshot().attached);assert.deepEqual((await page.evaluate(()=>window.BridgeportSlice.snapshot())).position,stopped);
 await page.evaluate(()=>HuGlobe.viewer().camera.setView({destination:Cesium.Cartesian3.fromDegrees(-73.19,41.18,1e6)}));await page.waitForFunction(()=>!window.BridgeportSlice.snapshot().attached);
 assert.equal((await page.evaluate(()=>window.BridgeportSlice.snapshot())).entities,0);
 await page.locator('[data-return]').click();owner=false;await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'mccdb_session'})));await page.waitForFunction(()=>document.getElementById('bridgeportEnter').hidden);
 const before=regionLoads;await page.evaluate(()=>window.BridgeportSlice.enter());await page.waitForTimeout(400);assert.equal(regionLoads,before);
 if(width===390){owner=true;const host=await context.newPage();await host.goto(base+'/__bridgeport-host.html');const f=host.frames().find(f=>f.url().includes('action-globe'));await f.locator('#bridgeportEnter').waitFor({state:'visible'});
 const send=async m=>host.evaluate(m=>document.getElementById('globe').contentWindow.postMessage({schema:'mccluster.spatial-lifecycle/v1',...m},location.origin),m);
 await send({type:'bridgeport:enter',entranceId:'bridgeport-main-golden-hill'});await f.waitForFunction(()=>window.BridgeportSlice?.snapshot().attached);
 await host.waitForFunction(()=>events.some(e=>e.type==='bridgeport:state'&&e.event==='ready'&&e.entranceId==='bridgeport-main-golden-hill'));
 await send({type:'bridgeport:preview',destinationId:'court-exterior-approach'});await f.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Preview:'));
 await send({type:'bridgeport:confirm'});await f.waitForFunction(()=>window.BridgeportSlice.snapshot().walking);
 await send({type:'bridgeport:leave'});await f.waitForFunction(()=>!window.BridgeportSlice.snapshot().entered);await host.waitForFunction(()=>events.some(e=>e.event==='returned'));await host.close();}

 assert.deepEqual(errors,[]);results.push({width,passed:true,regionLoads,initialEntities:first.entities,position:stopped,errors});await context.close();
}await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}finally{await browser.close();}
