/* Movement guidance and real pointer interactions; fixtures seed blocked states through saved games.
   Synthetic auth/local assets; software Chromium at390/1280, not physical-device certification. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire((process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules')+'/fixture.cjs')('playwright');
const root=fileURLToPath(new URL('../../',import.meta.url)),three=process.env.THREE_DIR||'/tmp/prim3-three/package',base='https://matthew.mccluster.org',out=process.argv[2]||'/tmp/prim3-courtyard-movement';
await mkdir(out,{recursive:true});const results=[];
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{for(const width of (process.env.WIDTHS||'1280,390').split(',').map(Number)){
 const ctx=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390,reducedMotion:'reduce',serviceWorkers:'block'});
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
 const initial=await page.evaluate(()=>JSON.stringify(__tac.state));
 await page.locator('#tacDisplay summary').click();await page.locator('[data-projection="top"]').click();await page.locator('#tacDisplay summary').click();
 await page.locator('#tacViewport').scrollIntoViewIfNeeded();
 check('selection exposes 1 AP blue and 2 AP orange legal ranges',await page.locator('.is-walk').count()>0&&await page.locator('.is-dash').count()>0);
 check('capabilities and movement legend visible',/Entry.*Available:.*Blue: 1 AP.*orange: 2 AP/.test(await page.locator('#tacCapabilities').innerText()));
 const target=await page.locator('.tb-cell.is-dash').evaluateAll(cells=>{const c=cells.find(c=>+c.dataset.x===4&&+c.dataset.y===5)||cells[0];return{x:+c.dataset.x,y:+c.dataset.y};});
 const point=await page.evaluate(t=>__tac.screenOf(t.x,t.y),target);
 if(width===1280){
 await page.mouse.move(point.x,point.y);await page.waitForFunction(()=>__tac.ui.preview?.hover);
 check('hover previews path and waypoint without spending',await page.evaluate(s=>JSON.stringify(__tac.state)===s&&__tac.ui.preview.path.length>0,initial)&&/Current:.*Next:.*Destination:/.test(await page.locator('#tacSheet').innerText()));
 await page.mouse.click(point.x,point.y);
 check('first mouse click previews without AP spend',await page.evaluate(s=>JSON.stringify(__tac.state)===s&&!__tac.ui.preview.hover,initial));
 await page.locator('#tacViewport').screenshot({path:out+`/dash-preview-${width}.png`});
 await page.mouse.dblclick(point.x,point.y,{delay:80});
 }else{
 await page.touchscreen.tap(point.x,point.y);await page.touchscreen.tap(point.x,point.y);
 check('two touch taps still require explicit confirmation',await page.evaluate(s=>JSON.stringify(__tac.state)===s,initial));
 await page.locator('[data-sheet="confirm-move"]').tap();
 }
 check('dash arrives once and costs exactly 2 AP',await page.evaluate(t=>{const u=__tac.state.units.find(u=>u.id==='E1');return u.x===t.x&&u.y===t.y&&u.ap===0&&__tac.state.events.filter(e=>e.type==='DASH').length===1;},target));
 check('AP exhaustion removes all affordable reach',await page.locator('.is-reach').count()===0);
 const spent=await page.evaluate(()=>JSON.stringify(__tac.state));
 await page.mouse.dblclick(point.x,point.y,{delay:80});
 check('repeated double-click cannot duplicate move',await page.evaluate(s=>JSON.stringify(__tac.state)===s,spent));
 for(const blocked of ['dead','downed','extracted','phase']){
 await page.evaluate(({initial,blocked})=>{const state=JSON.parse(initial),u=state.units.find(u=>u.id==='E1');if(blocked==='phase')state.phase='THREAT';else if(blocked==='extracted')u.statuses.push('EXTRACTED');else u[blocked]=true;localStorage.setItem(__tac.SAVE_KEY,JSON.stringify({v:1,state}));},{initial,blocked});
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tac?.mode3d,null,{timeout:60000});
 const before=await page.evaluate(()=>JSON.stringify(__tac.state));
 check(`${blocked} blocks legal reach and capabilities`,await page.locator('.is-reach').count()===0&&!/Available: Move/.test(await page.locator('#tacCapabilities').innerText()));
 await page.locator('#tacViewport').scrollIntoViewIfNeeded();const p=await page.evaluate(t=>__tac.screenOf(t.x,t.y),target);await page.mouse.dblclick(p.x,p.y,{delay:80});
 check(`${blocked} double-click spends nothing`,await page.evaluate(s=>JSON.stringify(__tac.state)===s,before));
 }
 if(width===1280){
 await page.evaluate(initial=>localStorage.setItem(__tac.SAVE_KEY,JSON.stringify({v:1,state:JSON.parse(initial)})),initial);
 await page.goto(base+'/prim3-tactics-preview.html?menu=0&view=2d',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tac);
 const tile=page.locator(`.tb-cell[data-x="${target.x}"][data-y="${target.y}"]`);
 await tile.click();check('2D first click remains preview only',await page.evaluate(s=>JSON.stringify(__tac.state)===s,initial));
 await tile.dblclick({delay:80});
 check('2D deliberate double-click performs one exact-cost dash',await page.evaluate(t=>{const u=__tac.state.units.find(u=>u.id==='E1');return u.x===t.x&&u.y===t.y&&u.ap===0&&__tac.state.events.filter(e=>e.type==='DASH').length===1;},target));
 }
 check('phone and desktop avoid horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 check('no page errors',errors.length===0);
 }catch(e){results.push({width,name:'flow',pass:false,error:e.stack});console.error(e);await page.screenshot({path:out+`/failure-${width}.png`,fullPage:true}).catch(()=>{});}finally{await ctx.close();}
}}finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);if(results.some(r=>!r.pass))process.exitCode=1;
