// Synthetic owner responses; real local HQ renderer, engine and UI clicks. No production writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire((process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules')+'/x');
let chromium; try { ({chromium}=require('playwright')); } catch { ({chromium}=require('playwright-core')); }
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),three=process.env.THREE_DIR,base='https://matthew.mccluster.org',out=process.argv[2] || process.env.ARTIFACT_DIR || '/tmp/prim3-hq-stairs';
if(!three) throw Error('Set THREE_DIR to a local three@0.180.0 package (no network fetch).');
await mkdir(out,{recursive:true});const results=[];
function check(width,name,pass,detail){results.push({width,name,pass,detail});console.log(`${pass?'PASS':'FAIL'} [${width}] ${name} ${detail?JSON.stringify(detail):''}`);}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
try{for(const width of [1280,390]){
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
 await page.waitForFunction(()=>window.__tx?.r3,{timeout:60000});
 check(width,'Transit renderer mounts',await page.locator('#tx3d canvas').count()===1);
 const brief=page.locator('[data-sheet="brief-go"]');if(await brief.count()) {await brief.click();check(width,'brief dismissed',await page.locator('#txEnd').isHidden());}else check(width,'Transit has no blocking mission briefing',await page.locator('#txEnd').isHidden());
 await page.locator('[data-unit="E1"]').click();check(width,'squad card selects Entry',await page.evaluate(()=>__tx.ui.sel==='E1'));
 await page.locator('[data-act="move"]').click();
 await page.locator('#tx3d').scrollIntoViewIfNeeded();await page.waitForFunction(()=>!__tx.busy,{timeout:60000});
 async function confirm(){await page.locator('[data-sheet="confirm-move"]').click();await page.waitForFunction(()=>!__tx.busy,{timeout:60000});}
 await page.locator('[data-sheet="landing:6:8:1"]').click(); await confirm();
 await page.locator('[data-act="move"]').click();
 assert.equal(await page.evaluate(()=>__tx.state.units.find(u=>u.id==='E1').z),1);
 const target={x:8,y:4,z:1};
 await page.locator('#tx3d').scrollIntoViewIfNeeded();
 const point=await page.evaluate(t=>({p:__tx.r3.screenOf(t.x,t.y,0,t.z)}),target);
 assert.deepEqual(await page.evaluate(p=>__tx.r3.tileAt(p.x,p.y),point.p),target);
 await page.mouse.click(point.p.x,point.p.y);await confirm();
 await page.locator('#txEndTurn').click();await page.waitForFunction(()=>!__tx.busy&&__tx.state.round===2,{timeout:60000});
 await page.locator('[data-act="move"]').click();
 console.log('BEFOREUP',JSON.stringify(await page.evaluate(()=>({u:__tx.state.units.find(u=>u.id==='E1'),cut:__tx.r3.cut}))));
 // Every offered landing must belong to the current engine reach graph.
 assert.ok(await page.evaluate(()=>[...document.querySelectorAll('[data-sheet^="landing:"]')].every(b=>{const [,x,y,z]=b.dataset.sheet.split(':').map(Number);return __tx.reach().stepsTo(x,y,z)>0;})));
 await page.screenshot({fullPage:true,path:out+`/hq-before-up-${width}.png`});
 await page.locator('[data-sheet="landing:8:3:2"]').click();
 assert.equal(await page.evaluate(()=>__tx.state.units.find(u=>u.id==='E1').z),1,'preview does not move');
 assert.equal(await page.evaluate(()=>__tx.r3.cut),2,'preview exposes destination storey');
 await confirm();
 assert.equal(await page.evaluate(()=>__tx.state.units.find(u=>u.id==='E1').z),2);
 assert.equal(await page.evaluate(()=>__tx.state.units.find(u=>u.id==='E1').ap),1);
 console.log('AFTERUP',JSON.stringify(await page.evaluate(()=>({u:__tx.state.units.find(u=>u.id==='E1'),cut:__tx.r3.cut}))));
 await page.screenshot({fullPage:true,path:out+`/hq-after-up-${width}.png`});
 await page.locator('[data-act="move"]').click();await page.locator('[data-sheet="landing:8:4:1"]').click();await confirm();
 assert.equal(await page.evaluate(()=>__tx.state.units.find(u=>u.id==='E1').z),1);
 assert.equal(await page.evaluate(()=>__tx.state.units.find(u=>u.id==='E1').ap),0);
 console.log('AFTERDOWN',JSON.stringify(await page.evaluate(()=>({u:__tx.state.units.find(u=>u.id==='E1'),cut:__tx.r3.cut}))));
 await page.screenshot({fullPage:true,path:out+`/hq-after-down-${width}.png`});
 check(width,'no page errors',errors.length===0,errors);
 }catch(e){check(width,'smoke completed',false,e.message);await page.screenshot({path:out+`/failure-${width}.png`}).catch(()=>{});}
 await ctx.close();
}}finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);if(results.some(r=>!r.pass))process.exitCode=1;
