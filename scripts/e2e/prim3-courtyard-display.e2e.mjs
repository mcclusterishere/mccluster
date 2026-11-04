/* Owner controls → true orthographic raycast play, with unchanged engine coordinates.
   Synthetic auth/local assets; software Chromium at390/1280, not physical-device certification. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire((process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules')+'/fixture.cjs')('playwright');
const root=fileURLToPath(new URL('../../',import.meta.url)),three=process.env.THREE_DIR||'/tmp/prim3-three/package',base='https://matthew.mccluster.org',out=process.argv[2]||'/tmp/prim3-courtyard-display';
await mkdir(out,{recursive:true});const results=[];
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{for(const width of (process.env.WIDTHS||'390,1280').split(',').map(Number)){
 const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
 await ctx.addInitScript(()=>{localStorage.setItem('mccdb_session',JSON.stringify({access_token:'synthetic-owner',expires_at:Math.floor(Date.now()/1000)+3600}));localStorage.setItem('prim3.tactics.preview.gfx','low');sessionStorage.setItem('mcc_premiere','1');});
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());
 if(u.hostname==='api.mccluster.org'||u.hostname.endsWith('supabase.co'))return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{}'});
 let f;if(u.origin===base)f=resolve(root,'.'+decodeURIComponent(u.pathname));else if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/three@0.180.0/'))f=resolve(three,u.pathname.slice('/npm/three@0.180.0/'.length));else return route.abort();
 try{return route.fulfill({body:await readFile(f),contentType:types[extname(f)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const check=(name,ok)=>{results.push({width,name,pass:!!ok});console.log(`${ok?'PASS':'FAIL'} [${width}] ${name}`);assert.ok(ok,name);};
 try{
 await page.goto(base+'/prim3-tactics-preview.html?menu=0',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__tac?.mode3d,null,{timeout:60000});
 const before=await page.evaluate(()=>JSON.stringify(__tac.state));
 await page.locator('#tacDisplay summary').click();
 await page.locator('[data-projection="top"]').click();
 check('owner control selects actual orthographic camera',await page.evaluate(()=>__tac.cameraType==='OrthographicCamera'));
 const points=await page.evaluate(()=>({a:__tac.screenOf(4.5,4.5),east:__tac.screenOf(5.5,4.5),north:__tac.screenOf(4.5,3.5),high:__tac.screenOf(4.5,4.5,3)}));
 check('east is screen-right, north is screen-up, height has no perspective shift',points.east.x>points.a.x&&points.north.y<points.a.y&&Math.abs(points.high.x-points.a.x)<.01&&Math.abs(points.high.y-points.a.y)<.01);
 check('centre signed coordinates use1metre cells',/E: X -3.5, Y \+2.5 m/.test(await page.locator('#tacCoordinates').innerText()));
 await page.locator('[data-origin="objective"]').click();
 check('objective origin reads zero and changes no engine state',/Relay: X 0, Y 0 m/.test(await page.locator('#tacCoordinates').innerText())&&await page.evaluate(b=>JSON.stringify(__tac.state)===b,before));
 await page.locator('#tacDisplay').screenshot({path:out+`/controls-${width}.png`});
 await page.locator('#tacDisplay summary').click();await page.locator('#tacViewport').scrollIntoViewIfNeeded();
 await page.locator('#tacViewport').screenshot({path:out+`/top-objective-${width}.png`});
 const unit=await page.evaluate(()=>__tac.unitScreenPoint('E1'));await page.mouse.click(unit.x,unit.y);
 await page.locator('#tacMenu [data-act="move"]').click();
 const target=await page.evaluate(()=>__tac.screenOf(2,2));await page.mouse.click(target.x,target.y);
 await page.locator('[data-sheet="confirm-move"]').click();
 check('top-down raycast move spends1AP at unchanged engine cell',await page.evaluate(()=>{const u=__tac.state.units.find(x=>x.id==='E1');return u.x===2&&u.y===2&&u.ap===1;}));
 const moved=await page.evaluate(()=>JSON.stringify(__tac.state));
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tac?.mode3d,null,{timeout:60000});
 check('reload retains projection/origin and tactical save',await page.evaluate(s=>__tac.cameraType==='OrthographicCamera'&&__tac.display.origin==='objective'&&JSON.stringify(__tac.state)===s,moved));
 await page.locator('#tacDisplay summary').click();await page.locator('[data-projection="perspective"]').click();
 check('perspective restore changes no tactical state',await page.evaluate(s=>__tac.cameraType==='PerspectiveCamera'&&JSON.stringify(__tac.state)===s,moved));
 await page.locator('#tacDisplay summary').click();await page.locator('#tacViewport').scrollIntoViewIfNeeded();await page.locator('#tacViewport').screenshot({path:out+`/perspective-${width}.png`});
 check('phone and desktop avoid horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 check('no page errors',errors.length===0);
 }catch(e){results.push({width,name:'flow',pass:false,error:e.stack});console.error(e);await page.screenshot({path:out+`/failure-${width}.png`,fullPage:true}).catch(()=>{});}finally{await ctx.close();}
}}finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);if(results.some(r=>!r.pass))process.exitCode=1;
