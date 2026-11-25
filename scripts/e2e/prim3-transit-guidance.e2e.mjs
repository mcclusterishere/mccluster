/* Local actual UI movement proof: selection, hover/tap preview, desktop double-click and touch confirm.
   Synthetic owner authentication; same-origin files and cached Three.js only; no production writes. */
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire((process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules')+'/fixture.cjs')('playwright');
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),three=process.env.THREE_DIR||'/tmp/prim3-three/package',base='https://matthew.mccluster.org',out=process.argv[2]||'/tmp/prim3-transit-guidance';
await mkdir(out,{recursive:true});const results=[];
const sourceFiles=['js/prim3-tactics/movement-guidance.mjs','prim3-transit.html','js/prim3-tactics/transit.mjs','js/prim3-tactics/lifecycle.mjs','js/prim3-tactics/aftermath.mjs','js/prim3-tactics/tactical-resolver.mjs','js/prim3-tactics/tactical-hints.mjs','js/prim3-tactics/tactical-threat-ai.mjs','js/prim3-tactics/level3d.mjs','js/prim3-world/app.mjs','js/prim3-world/missions.mjs'];
const sourceHashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await readFile(resolve(root,f))).digest('hex')])));
const sourcesBefore=await sourceHashes();
function check(width,name,pass,detail){results.push({width,name,pass,detail});console.log(`${pass?'PASS':'FAIL'} [${width}] ${name} ${detail?JSON.stringify(detail):''}`);}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
try{for(const width of (process.env.WIDTHS||'390,1280').split(',').map(Number)){
 const ctx=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,reducedMotion:'reduce',serviceWorkers:'block'});
 await ctx.addInitScript(()=>{localStorage.setItem('mccdb_session',JSON.stringify({access_token:'e2e-owner',expires_at:Math.floor(Date.now()/1000)+3600}));localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));localStorage.setItem('prim3.tactics.preview.gfx','low');sessionStorage.setItem('mcc_premiere','1');});
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());
 if(u.hostname==='api.mccluster.org'||u.hostname.endsWith('supabase.co'))return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:'{}'});
 let f;if(u.origin===base)f=resolve(root,'.'+decodeURIComponent(u.pathname));else if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/three@0.180.0/'))f=resolve(three,u.pathname.slice('/npm/three@0.180.0/'.length));else return route.abort();
 try{return route.fulfill({body:await readFile(f),contentType:types[extname(f)]||'application/octet-stream',headers:{'access-control-allow-origin':'*'}})}catch{return route.fulfill({status:404,body:''})}
 });


 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const settle=()=>page.waitForFunction(()=>window.__tx?.r3&&!__tx.busy,null,{timeout:60000});
 try {
  await page.goto(base+'/prim3-transit.html?new=1&seed=31',{waitUntil:'domcontentloaded'});await settle();
  await page.locator('[data-unit="E1"]').click();await settle();await page.waitForTimeout(400);
  const before=await page.evaluate(()=>JSON.stringify(__tx.state));
  check(width,'selection shows capabilities and both affordable AP bands',await page.evaluate(()=>document.querySelector('.tx-capabilities').textContent.includes('Move')&&__tx.reach().tiles.some(t=>t.apCost===1)&&__tx.reach().tiles.some(t=>t.apCost===2)));
  await page.locator('#tx3d').scrollIntoViewIfNeeded();
  if(width!==390){
   const blue=await page.evaluate(()=>{for(const t of __tx.reach().tiles.filter(t=>t.apCost===1&&t.z===0)){const p=__tx.r3.screenOf(t.x,t.y,0,0),h=__tx.r3.tileAt(p.x,p.y);if(document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS'&&h?.x===t.x&&h?.y===t.y)return p;}return null;});
   if(!blue)throw Error('No visible legal blue destination');
   await page.mouse.dblclick(blue.x,blue.y,{delay:80});
   check(width,'blue doubleclick remains preview only',(await page.evaluate(()=>JSON.stringify(__tx.state)))===before);
   await page.locator('[data-sheet="back"]').click();
  }
  let point=await page.evaluate(()=>{
   const candidates=__tx.reach().tiles.filter(t=>t.apCost===2&&t.z===0).sort((a,b)=>a.steps-b.steps);
   for(const t of candidates){const p=__tx.r3.screenOf(t.x,t.y,0,t.z),hit=__tx.r3.tileAt(p.x,p.y);if(p.x>20&&p.x<innerWidth-20&&p.y>20&&p.y<innerHeight-20&&document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS'&&hit?.x===t.x&&hit?.y===t.y&&(hit.z||0)===t.z)return{...p,t};}
   return null;
  });
  if(!point)throw Error('No visible legal dash destination');
  if(width!==390){const previousPoint={x:point.x,y:point.y};await page.mouse.move(point.x,point.y);await page.waitForTimeout(100);const hoveredPoint=await page.evaluate(t=>__tx.r3.screenOf(t.x,t.y,0,t.z),point.t);check(width,'hover keeps battlefield fixed under pointer',Math.abs(previousPoint.x-hoveredPoint.x)<1&&Math.abs(previousPoint.y-hoveredPoint.y)<1,{before:previousPoint,after:hoveredPoint});check(width,'hover previews without spending AP',await page.evaluate(()=>__tx.ui.preview?.kind==='move')&&(await page.evaluate(()=>JSON.stringify(__tx.state)))===before);}
  await page.waitForTimeout(500);
  point={...point,...await page.evaluate(t=>__tx.r3.screenOf(t.x,t.y,0,t.z),point.t)};
  if(width===390)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
  check(width,'first tap previews2AP without changing state',(await page.evaluate(()=>JSON.stringify(__tx.state)))===before&&await page.evaluate(()=>__tx.ui.preview?.apCost===2),await page.evaluate(p=>({point:p,hit:__tx.r3.tileAt(p.x,p.y),preview:__tx.ui.preview?{dest:__tx.ui.preview.dest,apCost:__tx.ui.preview.apCost,source:__tx.ui.preview.source}:null,scroll:scrollY,element:document.elementFromPoint(p.x,p.y)?.tagName}),point));
  check(width,'preview gives waypoint distance and AP',/Next waypoint/.test(await page.locator('#txSheet').innerText())&&/2 AP/.test(await page.locator('#txSheet').innerText())&&/m waypoint route/.test(await page.locator('#txSheet').innerText()));
  await page.waitForTimeout(500);
  point={...point,...await page.evaluate(t=>__tx.r3.screenOf(t.x,t.y,0,t.z),point.t)};
  if(width===390){await page.touchscreen.tap(point.x,point.y);check(width,'second touch still requires explicit confirm',(await page.evaluate(()=>JSON.stringify(__tx.state)))===before);await page.locator('[data-sheet="confirm-move"]').tap();}
  else await page.mouse.dblclick(point.x,point.y,{delay:80});
  await settle();
  const after=await page.evaluate(()=>({unit:__tx.state.units.find(u=>u.id==='E1'),moves:__tx.state.events.filter(e=>e.type==='MOVE')}));
  check(width,'dash commits once for exactly2AP',after.unit.ap===0&&after.unit.x===point.t.x&&after.unit.y===point.t.y,{ap:after.unit.ap,x:after.unit.x,y:after.unit.y});
  check(width,'spent operative has no movement highlight',await page.evaluate(()=>!__tx.ui.reach));
  await page.screenshot({path:resolve(out,'guidance-'+width+'.png'),fullPage:true});
  check(width,'no pageerrors',errors.length===0,errors);
 }catch(error){check(width,'scenario completed',false,error.message);}finally{await ctx.close();}
}}finally{await browser.close();}
const sourcesAfter=await sourceHashes();check(0,'runtime sources stable',JSON.stringify(sourcesBefore)===JSON.stringify(sourcesAfter));
await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));
if(results.some(r=>!r.pass))process.exitCode=1;
