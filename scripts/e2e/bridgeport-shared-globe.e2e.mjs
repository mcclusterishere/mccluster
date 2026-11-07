// Actual action-globe and pinned Cesium 1.131; owner/API/imagery fixtures, no live ion claim.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {join,extname,resolve} from 'node:path';
import {metricFrame} from '../../js/spatial/metric-frame.mjs';
import {route} from '../../js/spatial/region-graph.mjs';
const v2=process.env.SLICE==='v2',regionId=v2?'bridgeport-downtown.v2':'bridgeport-golden-hill.v1';
const root=process.cwd(),out=process.argv[2]||'/tmp/bridgeport-globe-evidence',build=process.env.CESIUM_BUILD||'/tmp/bridgeport-cesium/package/Build/Cesium';await mkdir(out,{recursive:true});
await access(join(build,'Cesium.js')); // Fail clearly when the pinned local browser dependency is absent.
const {chromium}=createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'package.json'))('playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base='https://matthew.mccluster.org',results=[];
const data=JSON.parse(await readFile('data/spatial/'+regionId+'.json','utf8')),frame=metricFrame(data.contract.frame.anchor);
try{for(const width of (process.env.WIDTHS||'390,1280').split(',').map(Number)){
 let owner=true,regionLoads=0;const errors=[],context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:1});
 await context.addInitScript(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'local-fixture-owner'})));
 await context.route('**/*',async r=>{const u=new URL(r.request().url()),suffix=u.pathname.split('/Build/Cesium/')[1];
  if(u.hostname==='cesium.com'&&suffix&&!suffix.includes('..')){try{return await r.fulfill({body:await readFile(join(build,suffix)),contentType:suffix.endsWith('.js')?'text/javascript':suffix.endsWith('.css')?'text/css':'application/octet-stream'});}catch{return r.abort();}}
  if(u.origin==='https://api.mccluster.org'||u.hostname.endsWith('supabase.co'))return r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(u.pathname==='/v1/world/access'?{release:{version:'globe-admin-preview/v1',admin_preview:owner},unlocked_layers:[],locked_layers:[]}:u.pathname==='/v1/world/ion'?{available:false}:[])});
  if(u.origin===base){if(u.pathname==='/__bridgeport-host.html')return r.fulfill({contentType:'text/html',body:'<!doctype html><iframe id=globe style="width:100%;height:800px" src="action-globe.html?embedded=1"></iframe><script>window.events=[];addEventListener("message",e=>{if(e.origin===location.origin&&e.source===document.getElementById("globe").contentWindow)events.push(e.data)});</script>'});if(u.pathname.startsWith('/data/spatial/bridgeport-'))regionLoads++;
   if(['/js/tabbar.js','/js/mcc-auth.js','/js/shell-boot.js'].includes(u.pathname))return r.fulfill({contentType:'text/javascript',body:''});
   const p=resolve(root,'.'+u.pathname);if(!p.startsWith(root+'/'))return r.abort();try{return await r.fulfill({body:await readFile(p),contentType:({'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[extname(p)]||'application/octet-stream'});}catch{return r.fulfill({status:404,body:''});}}
  return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/action-globe.html?explore=1'+(v2?'&bridgeport=2':''));
 await page.locator('#bridgeportEnter').waitFor({state:'visible',timeout:30000});if(!v2)assert.equal(regionLoads,0);
 if(!v2)await page.locator('#bridgeportEnter').click();await page.waitForFunction(()=>window.BridgeportSlice?.snapshot().attached,{},{timeout:30000});
 await page.waitForFunction(()=>Math.abs(HuGlobe.viewer().camera.positionCartographic.height-360)<1);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(regionLoads,1);assert.match(await page.locator('[data-ion]').textContent(),/unavailable/);
 const first=await page.evaluate(()=>window.BridgeportSlice.snapshot());assert.ok(first.entities>(v2?20:200));assert.equal(first.topology,'hex');
 const path=route(data,'hex',first.position,data.graphs.hex.destinationId),target=data.graphs.hex.nodes.find(n=>n.id===path.ids[2]),geo=frame.toGeo(target.position);
 const point=await page.evaluate(g=>{const v=HuGlobe.viewer(),p=Cesium.SceneTransforms.worldToWindowCoordinates(v.scene,Cesium.Cartesian3.fromDegrees(g.lon,g.lat,0));return {x:p.x,y:p.y};},geo);
 console.log('picking',width,point,target.id);await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Preview:'));
 console.log('picked preview',await page.locator('[data-status]').textContent());await page.locator('[data-confirm]').click();try{await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Arrived'),{},{timeout:15000});}catch(e){console.log('arrival failure',await page.evaluate(()=>({state:BridgeportSlice.snapshot(),status:document.querySelector('[data-status]').textContent})));await page.screenshot({path:join(out,`failed-${width}.png`)});throw e;}
 first.position=(await page.evaluate(()=>window.BridgeportSlice.snapshot())).position;assert.ok(Math.hypot(first.position.x-target.position.x,first.position.z-target.position.z)<.01);
 await page.locator('[data-preview]').click();assert.match(await page.locator('[data-status]').textContent(),/Preview: .*hex cells/);
 assert.deepEqual((await page.evaluate(()=>window.BridgeportSlice.snapshot())).position,first.position);
 await page.locator('[data-confirm]').click();await page.waitForFunction(()=>window.BridgeportSlice.snapshot().position.x!==JSON.parse(localStorage.getItem('here.universe.'+window.BridgeportSlice.snapshot().regionId)).position.x);
 await page.locator('[data-stop]').click();const stopped=await page.evaluate(()=>window.BridgeportSlice.snapshot().position);
 await page.locator('select[aria-label="Navigation topology"]').selectOption('square');assert.deepEqual((await page.evaluate(()=>window.BridgeportSlice.snapshot())).position,stopped);
 await page.locator('[data-preview]').click();assert.match(await page.locator('[data-status]').textContent(),/square cells/);
 const beforeLocate=await page.evaluate(()=>BridgeportSlice.snapshot().position);
 await page.locator('[data-locate]').click();await page.waitForTimeout(1200);
 assert.deepEqual(await page.evaluate(()=>BridgeportSlice.snapshot().position),beforeLocate);
 const located=await page.evaluate(()=>{const v=HuGlobe.viewer(),actor=v.dataSources.getByName('bridgeport-shared-navigation')[0].entities.getById('bridgeport-walker');const p=Cesium.SceneTransforms.worldToWindowCoordinates(v.scene,actor.position.getValue(Cesium.JulianDate.now()));return {x:p.x,y:p.y,top:document.getElementById('bridgeportWalk').getBoundingClientRect().top};});
 assert.ok(located.x>0&&located.x<width&&located.y>0&&located.y<located.top,'Find me keeps actor visible above controls');

 if(v2){
  await page.locator('[aria-label="Street destination"]').selectOption('bridgeport-main-elm');await page.locator('[data-preview]').click();assert.match(await page.locator('[data-status]').textContent(),/Preview:/);
  const pose=await page.evaluate(()=>BridgeportSlice.snapshot().position);await page.locator('[aria-label="Simulation road closure"]').selectOption('186839735');assert.equal(await page.locator('[data-confirm]').isDisabled(),true);assert.deepEqual(await page.evaluate(()=>BridgeportSlice.snapshot().position),pose);
  await page.locator('[data-preview]').click();assert.match(await page.locator('[data-status]').textContent(),/No legal path/);await page.locator('[aria-label="Simulation road closure"]').selectOption('');await page.locator('[data-preview]').click();assert.match(await page.locator('[data-status]').textContent(),/Preview:/);
 }

 await page.waitForTimeout(700);await page.screenshot({path:join(out,`bridgeport-${width}.png`)});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('[data-return]').click();assert.equal((await page.evaluate(()=>window.BridgeportSlice.snapshot())).entities,0);
 await page.locator('#bridgeportEnter').click();await page.waitForFunction(()=>window.BridgeportSlice.snapshot().attached);assert.deepEqual((await page.evaluate(()=>window.BridgeportSlice.snapshot())).position,stopped);
 await page.reload();if(!v2)await page.locator('#bridgeportEnter').click();await page.waitForFunction(()=>window.BridgeportSlice?.snapshot().attached);assert.deepEqual((await page.evaluate(()=>window.BridgeportSlice.snapshot())).position,stopped);
 await page.evaluate(()=>HuGlobe.viewer().camera.setView({destination:Cesium.Cartesian3.fromDegrees(-73.19,41.18,1e6)}));await page.waitForFunction(()=>!window.BridgeportSlice.snapshot().attached);
 assert.equal((await page.evaluate(()=>window.BridgeportSlice.snapshot())).entities,0);
 await page.locator('[data-return]').click();owner=false;await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'mccdb_session'})));await page.waitForFunction(()=>document.getElementById('bridgeportEnter').hidden);
 const before=regionLoads;await page.evaluate(()=>window.BridgeportSlice.enter());await page.waitForTimeout(400);assert.equal(regionLoads,before);
 if(v2){owner=true;const previous=JSON.parse(await readFile('data/spatial/bridgeport-golden-hill.v1.json','utf8')),c=previous.contract,oldValue={schema:c.state.schema,regionId:c.id,revision:1,frameId:c.frame.id,floorId:'street',position:previous.graphs.hex.nodes.find(n=>n.id===previous.graphs.hex.entryId).position,topology:'hex'};
  await page.evaluate(v=>{localStorage.setItem('here.universe.bridgeport-golden-hill.v1',JSON.stringify(v));window.dispatchEvent(new StorageEvent('storage',{key:'mccdb_session'}));},oldValue);await page.locator('#bridgeportEnter').waitFor({state:'visible'});await page.locator('#bridgeportEnter').click();await page.waitForFunction(()=>BridgeportSlice.snapshot().attached);await page.locator('[data-import]').click();await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Previous position copied'));
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('here.universe.bridgeport-golden-hill.v1'))),oldValue);assert.deepEqual(await page.evaluate(()=>BridgeportSlice.snapshot().position),oldValue.position);await page.locator('[data-return]').click();
 }

 if(width===390){owner=true;const host=await context.newPage();
 await host.route('**/js/spatial/bridgeport-globe.mjs',async r=>r.fulfill({contentType:'text/javascript',body:
  'window.bridgeportImportStarted=true;await new Promise(r=>window.releaseBridgeportImport=r);\n'+await readFile('js/spatial/bridgeport-globe.mjs','utf8')+'\nwindow.bridgeportImportFinished=true;'}));
 await host.goto(base+'/__bridgeport-host.html');const f=host.frames().find(f=>f.url().includes('action-globe'));await f.locator('#bridgeportEnter').waitFor({state:'visible'});
 const send=async m=>host.evaluate(m=>document.getElementById('globe').contentWindow.postMessage({schema:'mccluster.spatial-lifecycle/v1',...m},location.origin),m);
 await send({type:'bridgeport:enter',entranceId:'bridgeport-main-golden-hill',regionId});
 await f.waitForFunction(()=>window.bridgeportImportStarted);await send({type:'bridgeport:leave'});
 await host.waitForFunction(()=>events.some(e=>e.event==='returned'&&e.position===null&&e.loaded===false&&e.entranceId==='bridgeport-main-golden-hill'));
 await f.evaluate(()=>window.releaseBridgeportImport());await f.waitForFunction(()=>window.bridgeportImportFinished);
 await f.evaluate(()=>new Promise(r=>setTimeout(r,100)));assert.equal(await f.evaluate(()=>!!window.BridgeportSlice),false);
 assert.equal(await host.evaluate(()=>events.some(e=>e.event==='ready')),false);
 await host.evaluate(()=>events.length=0);
 await send({type:'bridgeport:enter',entranceId:'bridgeport-main-golden-hill',regionId});await f.waitForFunction(()=>window.BridgeportSlice?.snapshot().attached);
 await host.waitForFunction(()=>events.some(e=>e.type==='bridgeport:state'&&e.event==='ready'&&e.entranceId==='bridgeport-main-golden-hill'));
 await send({type:'bridgeport:preview',destinationId:'court-exterior-approach'});await f.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Preview:'));
 await send({type:'bridgeport:confirm'});await f.waitForFunction(()=>window.BridgeportSlice.snapshot().walking);
 await send({type:'bridgeport:leave'});await f.waitForFunction(()=>!window.BridgeportSlice.snapshot().entered);await host.waitForFunction(()=>events.some(e=>e.event==='returned'));await host.close();}

 assert.deepEqual(errors,[]);results.push({width,passed:true,regionLoads,initialEntities:first.entities,position:stopped,errors});await context.close();
}await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}finally{await browser.close();}
