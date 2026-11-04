// Synthetic owner responses; real local HQ renderer, engine and UI clicks. No production writes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire((process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules')+'/x');
let chromium; try { ({chromium}=require('playwright')); } catch { ({chromium}=require('playwright-core')); }
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),three=process.env.THREE_DIR,base='https://matthew.mccluster.org',out=process.argv[2] || process.env.ARTIFACT_DIR || '/tmp/prim3-direct-landings';
if(!three) throw Error('Set THREE_DIR to a local three@0.180.0 package (no network fetch).');
await mkdir(out,{recursive:true});const results=[];
const sourceFiles=['prim3-transit.html','js/prim3-tactics/transit.mjs','js/prim3-tactics/level3d.mjs','js/prim3-tactics/movement-guidance.mjs','js/prim3-tactics/tactical-resolver.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await readFile(resolve(root,f))).digest('hex')])));
const beforeSources=await hashes();
function check(width,name,pass,detail){results.push({width,name,pass,detail});console.log(`${pass?'PASS':'FAIL'} [${width}] ${name} ${detail?JSON.stringify(detail):''}`);}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
try{for(const width of (process.env.WIDTHS || '1280,390').split(',').map(Number)) for(const stair of (process.env.STAIRS || 'A,B').split(',')){
 const tag=`${width}-${stair}`,sx=stair==='A'?8:4;
 const ctx=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,reducedMotion:'reduce',serviceWorkers:'block'});
 await ctx.addInitScript(()=>{localStorage.setItem('mccdb_session',JSON.stringify({access_token:'e2e-owner',expires_at:Math.floor(Date.now()/1000)+3600}));localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));localStorage.setItem('prim3.tactics.preview.gfx','low');sessionStorage.setItem('mcc_premiere','1');});
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());
 if(u.hostname==='api.mccluster.org'||u.hostname.endsWith('supabase.co'))return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:'{}'});
 let f;if(u.origin===base)f=resolve(root,'.'+decodeURIComponent(u.pathname));else if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/three@0.180.0/'))f=resolve(three,u.pathname.slice('/npm/three@0.180.0/'.length));else return route.abort();
 try{return route.fulfill({body:await readFile(f),contentType:types[extname(f)]||'application/octet-stream',headers:{'access-control-allow-origin':'*'}})}catch{return route.fulfill({status:404,body:''})}
 });
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.goto(base+'/prim3-transit.html?level=equity-uprise-hq&seed=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__tx?.r3,null,{timeout:60000});
 const brief=page.locator('[data-sheet="brief-go"]');if(await brief.count()) await brief.click();
 await page.locator('[data-unit="E1"]').click();
 async function ensureMove(){if(!await page.evaluate(()=>['move','dash'].includes(__tx.ui.mode)))await page.locator('[data-act="move"]').click();}
 async function confirm(){await page.locator('[data-sheet="confirm-move"]').click();await page.waitForFunction(()=>!__tx.busy,null,{timeout:60000});}
 const operative=()=>page.evaluate(()=>({...__tx.state.units.find(u=>u.id==='E1')}));
 await ensureMove();await page.locator('[data-sheet="landing:6:8:1"]').click();await confirm();
 await ensureMove();await page.locator('#tx3d').scrollIntoViewIfNeeded();
 async function clickGround(t){
  await page.locator('#txStage').scrollIntoViewIfNeeded();
  let point;
  for(let turns=0;turns<4;turns++){
   point=await page.evaluate(t=>{for(const [dx,dy] of [[0,0],[.25,0],[-.25,0],[0,.25],[0,-.25],[.38,.38],[-.38,.38],[.38,-.38],[-.38,-.38]]){const p=__tx.r3.screenOf(t.x+dx,t.y+dy,0,t.z),hit=__tx.r3.tileAt(p.x,p.y);if(hit&&!hit.unitId&&hit.x===t.x&&hit.y===t.y&&hit.z===t.z&&document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS')return p;}return null;},t);
   if(point)break;await page.locator('#camRot').click();await page.waitForFunction(()=>!__tx.busy,null,{timeout:60000});
  }
  assert.ok(point,'visible ground point is unobstructed by a landing control or body');
  if(width===390)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
  assert.deepEqual(await page.evaluate(()=>__tx.ui.preview?.dest),t,'ground click previews exact floor');await confirm();
 }
 await clickGround({x:sx,y:4,z:1});
 await page.locator('#txEndTurn').click();await page.waitForFunction(()=>!__tx.busy&&__tx.state.round===2,null,{timeout:60000});await ensureMove();
 if(stair==='B') {
  // The first path reveals H1 in the stair approach and correctly interrupts at (4,6).
  assert.deepEqual(await page.evaluate(()=>{const u=__tx.state.units.find(u=>u.id==='E1');return {x:u.x,y:u.y,z:u.z};}),{x:4,y:6,z:1});
  for(let shots=0;shots<2&&!await page.evaluate(()=>__tx.state.units.find(u=>u.id==='H1').dead);shots++){
    if(!await page.evaluate(()=>__tx.ui.mode==='fire'))await page.locator('[data-act="fire"]').click();
    if(await page.locator('[data-sheet="aim:H1"]').count())await page.locator('[data-sheet="aim:H1"]').click();
    assert.equal(await page.evaluate(()=>__tx.ui.preview?.target),'H1');await page.locator('[data-sheet="confirm-fire"]').click();await page.waitForFunction(()=>!__tx.busy,null,{timeout:60000});
  }
  assert.equal(await page.evaluate(()=>__tx.state.units.find(u=>u.id==='H1').dead),true,'clear revealed blocker with actual combat');
  await page.locator('#txEndTurn').click();await page.waitForFunction(()=>!__tx.busy&&__tx.state.round===3,null,{timeout:60000});await ensureMove();
  await clickGround({x:4,y:4,z:1});await ensureMove();
  assert.deepEqual(await page.evaluate(()=>{const u=__tx.state.units.find(u=>u.id==='E1');return {x:u.x,y:u.y,z:u.z};}),{x:4,y:4,z:1});
 }
 for(const [direction,dest] of [['up',{x:sx,y:3,z:2}],['down',{x:sx,y:4,z:1}]]){
  if((await operative()).ap===0){const round=await page.evaluate(()=>__tx.state.round);await page.locator('#txEndTurn').click();await page.waitForFunction(r=>!__tx.busy&&__tx.state.round===r+1,round,{timeout:60000});await ensureMove();}
  const before=await operative(),whole=await page.evaluate(()=>JSON.stringify(__tx.state));
  const route=await page.evaluate(t=>{const r=__tx.reach().at(t.x,t.y,t.z);return {apCost:r.apCost,steps:r.steps};},dest);
  assert.equal(route.steps,3,'canonical weighted stair cost');assert.equal(route.apCost,1);
  await page.locator('#txStage').scrollIntoViewIfNeeded();
  const marker=page.locator(`[data-landing="${dest.x}:${dest.y}:${dest.z}"]`);
  if(!await marker.isVisible()){await page.locator('[data-unit="E1"]').click();await ensureMove();await page.waitForFunction(()=>!__tx.busy,null,{timeout:60000});await page.locator('#txStage').scrollIntoViewIfNeeded();}
  await marker.waitFor({state:'visible'});
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('[data-landing]')].every(b=>{const [x,y,z]=b.dataset.landing.split(':').map(Number);return !!__tx.reach().at(x,y,z);})), 'all handles are canonical reachable endpoints');
  check(tag,`${direction} marker labels floor and AP`,(await marker.innerText()).includes('1 AP'));
  await page.locator('#txStage').screenshot({path:out+`/before-${direction}-${tag}.png`});
  const hit=await marker.boundingBox();const click={x:hit.x+hit.width/2,y:hit.y+hit.height/2};
  assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.dataset.landing,click),`${dest.x}:${dest.y}:${dest.z}`,'marker is actual hit target');
  if(width===390)await page.touchscreen.tap(click.x,click.y);else await page.mouse.click(click.x,click.y);
  assert.equal(await page.evaluate(()=>JSON.stringify(__tx.state)),whole,'marker only previews');
  assert.deepEqual(await page.evaluate(()=>__tx.ui.preview.dest),dest);
  check(tag,`${direction} click previews without AP/floor mutation`,true);
  await confirm();const after=await operative();
  assert.equal(after.z,dest.z);assert.equal(after.x,dest.x);assert.equal(after.y,dest.y);assert.equal(after.ap,before.ap-route.apCost);
  check(tag,`${direction} Confirm spends weighted AP once`,true);
  await page.locator('#txStage').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>{const u=__tx.state.units.find(u=>u.id==='E1'),p=__tx.r3.screenOf(u.x,u.y,.25,u.z),r=document.querySelector('#tx3d canvas').getBoundingClientRect();return p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom;}),'arriving operative stays in the battlefield view');
  await page.locator('#txStage').screenshot({path:out+`/after-${direction}-${tag}.png`});
  if(direction==='up'&&(await operative()).ap>0)await ensureMove();
 }
 if((await operative()).ap>0)await page.locator('[data-act="hunker"]').click();
 check(tag,'no markers after AP exhausted',await page.locator('[data-landing]').count()===0);
 check(tag,'no page errors',errors.length===0,errors);
 }catch(e){console.log('DIAG',JSON.stringify(await page.evaluate(()=>({cut:window.__tx?.r3?.cut,preview:window.__tx?.ui?.preview?.dest,markers:[...document.querySelectorAll('[data-landing]')].map(b=>{const r=b.getBoundingClientRect();return {id:b.dataset.landing,hidden:b.hidden,rect:{x:r.x,y:r.y,w:r.width,h:r.height},at:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,180)}})}))));check(tag,'smoke completed',false,e.message);await page.screenshot({path:out+`/failure-${tag}.png`}).catch(()=>{});}
 await ctx.close();
}}finally{await browser.close();const afterSources=await hashes();check('sources','runtime remained unchanged',JSON.stringify(beforeSources)===JSON.stringify(afterSources));await writeFile(out+'/source-manifest.json',JSON.stringify({before:beforeSources,after:afterSources},null,2));await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);if(results.some(r=>!r.pass))process.exitCode=1;
