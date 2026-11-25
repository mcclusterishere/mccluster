/* End-to-end owner dogfood: World Edit → Save & play test → complete the real Transit mission.
   Only UI interactions mutate game state. __tx hooks are read-only observations/projections.
   Seed 89 is fixed via the browser clock; the 67-action strategy was solved with the canonical
   engine against full-strength enemies, then replayed here through UI clicks. No save injection.
   External requests are intercepted; synthetic owner session, no production data writes.
   WIDTHS=390 THREE_DIR=/path/to/three node scripts/e2e/prim3-transit-completion.e2e.mjs [outDir]
*/
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire((process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules')+'/fixture.cjs')('playwright');
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),three=process.env.THREE_DIR||'/tmp/prim3-three/package',base='https://matthew.mccluster.org',out=process.argv[2]||'/tmp/prim3-transit-completion';
await mkdir(out,{recursive:true});const results=[];
const sourceFiles=['prim3-transit.html','js/prim3-tactics/transit.mjs','js/prim3-tactics/lifecycle.mjs','js/prim3-tactics/aftermath.mjs','js/prim3-tactics/tactical-resolver.mjs','js/prim3-tactics/tactical-hints.mjs','js/prim3-tactics/tactical-threat-ai.mjs','js/prim3-tactics/level3d.mjs','js/prim3-world/app.mjs','js/prim3-world/missions.mjs'];
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

const commands=[{"round":1,"id":"E1","action":"move","dest":{"x":41,"y":48,"z":0}},{"round":1,"id":"E1","action":"move","dest":{"x":34,"y":48,"z":0}},{"round":1,"id":"R1","action":"move","dest":{"x":45,"y":50,"z":0}},{"round":1,"id":"R1","action":"move","dest":{"x":38,"y":49,"z":0}},{"round":1,"id":"T1","action":"move","dest":{"x":45,"y":50,"z":0}},{"round":1,"id":"T1","action":"move","dest":{"x":38,"y":50,"z":0}},{"action":"end","round":2},{"round":2,"id":"E1","action":"move","dest":{"x":30,"y":45,"z":0}},{"round":2,"id":"E1","action":"move","dest":{"x":31,"y":41,"z":0}},{"round":2,"id":"R1","action":"move","dest":{"x":31,"y":48,"z":0}},{"round":2,"id":"R1","action":"move","dest":{"x":29,"y":42,"z":0}},{"round":2,"id":"T1","action":"move","dest":{"x":33,"y":48,"z":0}},{"round":2,"id":"T1","action":"move","dest":{"x":30,"y":44,"z":0}},{"action":"end","round":3},{"round":3,"id":"E1","action":"breach"},{"round":3,"id":"E1","action":"move","dest":{"x":31,"y":34,"z":0}},{"round":3,"id":"R1","action":"move","dest":{"x":31,"y":36,"z":0}},{"round":3,"id":"R1","action":"fire","target":"H2"},{"round":3,"id":"T1","action":"move","dest":{"x":30,"y":37,"z":0}},{"round":3,"id":"T1","action":"move","dest":{"x":32,"y":32,"z":0}},{"action":"end","round":4},{"round":4,"id":"E1","action":"fire","target":"H2"},{"round":4,"id":"E1","action":"fire","target":"H2"},{"round":4,"id":"R1","action":"fire","target":"H2"},{"round":4,"id":"R1","action":"move","dest":{"x":29,"y":31,"z":0}},{"round":4,"id":"T1","action":"move","dest":{"x":31,"y":31,"z":0}},{"round":4,"id":"T1","action":"link"},{"action":"end","round":5},{"round":5,"id":"E1","action":"move","dest":{"x":33,"y":31,"z":0}},{"round":5,"id":"E1","action":"fire","target":"H1"},{"round":5,"id":"R1","action":"move","dest":{"x":29,"y":30,"z":0}},{"round":5,"id":"R1","action":"move","dest":{"x":29,"y":31,"z":0}},{"round":5,"id":"T1","action":"link"},{"round":5,"id":"T1","action":"move","dest":{"x":31,"y":38,"z":0}},{"action":"end","round":6},{"round":6,"id":"E1","action":"fire","target":"H1"},{"round":6,"id":"E1","action":"reload"},{"round":6,"id":"R1","action":"move","dest":{"x":27,"y":37,"z":0}},{"round":6,"id":"R1","action":"move","dest":{"x":21,"y":39,"z":0}},{"round":6,"id":"T1","action":"move","dest":{"x":30,"y":44,"z":0}},{"round":6,"id":"T1","action":"move","dest":{"x":30,"y":51,"z":0}},{"action":"end","round":7},{"round":7,"id":"E1","action":"move","dest":{"x":33,"y":38,"z":0}},{"round":7,"id":"E1","action":"move","dest":{"x":31,"y":43,"z":0}},{"round":7,"id":"R1","action":"move","dest":{"x":17,"y":43,"z":0}},{"round":7,"id":"R1","action":"fire","target":"H3"},{"round":7,"id":"T1","action":"move","dest":{"x":29,"y":57,"z":0}},{"round":7,"id":"T1","action":"move","dest":{"x":22,"y":57,"z":0}},{"action":"end","round":8},{"round":8,"id":"E1","action":"move","dest":{"x":30,"y":49,"z":0}},{"round":8,"id":"E1","action":"move","dest":{"x":30,"y":56,"z":0}},{"round":8,"id":"R1","action":"reload"},{"round":8,"id":"R1","action":"fire","target":"H3"},{"round":8,"id":"T1","action":"move","dest":{"x":15,"y":57,"z":0}},{"round":8,"id":"T1","action":"move","dest":{"x":8,"y":57,"z":0}},{"round":8,"id":"T1","action":"extract"},{"action":"end","round":9},{"round":9,"id":"E1","action":"move","dest":{"x":24,"y":57,"z":0}},{"round":9,"id":"E1","action":"move","dest":{"x":17,"y":57,"z":0}},{"round":9,"id":"R1","action":"fire","target":"H3"},{"round":9,"id":"R1","action":"move","dest":{"x":12,"y":46,"z":0}},{"action":"end","round":10},{"round":10,"id":"E1","action":"move","dest":{"x":10,"y":57,"z":0}},{"round":10,"id":"E1","action":"extract"},{"round":10,"id":"R1","action":"move","dest":{"x":12,"y":54,"z":0}},{"round":10,"id":"R1","action":"move","dest":{"x":8,"y":57,"z":0}},{"round":10,"id":"R1","action":"extract"}];
 const page=await ctx.newPage(),errors=[];page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 const missionId='e2e-transit-'+width,title='Transit acceptance '+width,briefing='Secure the relay and bring every operative home. This browser draft verifies the complete mission loop.';
 const settle=()=>page.waitForFunction(()=>window.__tx&&!__tx.busy,null,{timeout:60000});
 const observe=()=>page.evaluate(()=>({round:__tx.state.round,phase:__tx.state.phase,units:__tx.state.units.map(u=>({id:u.id,x:u.x,y:u.y,z:u.z,hp:u.hp,ap:u.ap,statuses:u.statuses})),end:__tx.ui.ended}));
 try{
 await page.clock.setFixedTime(new Date(1700000000089));
 await page.goto(base+'/prim3-world.html',{waitUntil:'domcontentloaded'});
 await page.locator('[data-mode="edit"]').click();
 await page.locator('#pwF-id').fill(missionId);
 await page.locator('#pwF-title').fill(title);
 await page.locator('#pwF-briefing').fill(briefing);
 await page.locator('#pwF-level').selectOption('transit-relay');
 await page.locator('[data-act="playtest"]').click({noWaitAfter:true});
 await page.waitForURL('**/prim3-transit.html?**',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__tx?.r3,null,{timeout:60000});
 await page.waitForFunction(t=>document.title.includes(t),title,{timeout:15000});
 check(width,'World edited mission ID/title/briefing survives Save & play test',new URL(page.url()).searchParams.get('mission')===missionId&&await page.locator('#txObj').textContent().then(t=>t.includes(briefing)));
 check(width,'new deployment flag is consumed after saving',!new URL(page.url()).searchParams.has('new'));
 check(width,'fresh deterministic mission, no injected save',await page.evaluate(()=>__tx.state.round===1&&__tx.state.rng.seed===89&&__tx.state.events.every(e=>e.type==='PLAYER_PHASE_BEGIN')));
 const opening=await page.evaluate(()=>JSON.stringify(__tx.state));
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tx?.r3,null,{timeout:60000});
 check(width,'opening reload preserves fresh mission and edited identity',await page.evaluate(({state,title})=>JSON.stringify(__tx.state)===state&&document.title.includes(title),{state:opening,title}));
 const brief=page.locator('[data-sheet="brief-go"]');if(await brief.count())await brief.click();
 for(let i=0;i<commands.length;i++){
  const c=commands[i];await settle();
  if(c.action==='end'){
   await page.locator('#txEndTurn').click();await settle();
   const round=await page.evaluate(()=>__tx.state.round);if(round!==c.round)throw Error(`command ${i}: round ${round}, expected ${c.round}`);
   console.log(`[${width}] round ${round}`);
   if(round===6){const mid=await page.evaluate(()=>JSON.stringify(__tx.state));await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tx?.r3,null,{timeout:60000});check(width,'mid-mission reload preserves complete state and briefing',await page.evaluate(({mid,title,briefing})=>JSON.stringify(__tx.state)===mid&&document.title.includes(title)&&document.querySelector('#txObj').textContent.includes(briefing),{mid,title,briefing}));}
   continue;
  }
  await page.locator(`[data-unit="${c.id}"]`).click();
  const before=await observe(),beforeUnit=before.units.find(u=>u.id===c.id);
  await page.locator(`[data-act="${c.action}"]`).click();
  if(c.action==='move'){
   await page.locator('#tx3d').scrollIntoViewIfNeeded();await settle();
   const point=()=>page.evaluate(d=>{const p=__tx.r3.screenOf(d.x,d.y,0,d.z),t=__tx.r3.tileAt(p.x,p.y);return{...p,ok:p.x>0&&p.x<innerWidth&&p.y>0&&p.y<innerHeight&&document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS'&&t?.x===d.x&&t?.y===d.y&&(t?.z||0)===d.z};},c.dest);
   let p=await point();
   if(!p.ok){
    if(await page.locator('#txMap').isHidden())await page.locator('#txMapTog').click();
    const map=page.locator('#txMini');await map.scrollIntoViewIfNeeded();const b=await map.boundingBox();
    await page.mouse.click(b.x+(c.dest.x+.5)/64*b.width,b.y+(c.dest.y+.5)/64*b.height);
    await page.locator('#tx3d').scrollIntoViewIfNeeded();await settle();p=await point();
   }
   if(!p.ok)throw Error(`command ${i}: target cannot be clicked ${JSON.stringify({c,p})}`);
   await page.mouse.click(p.x,p.y);
   await page.locator('[data-sheet="confirm-move"]').waitFor({timeout:10000});
   const pv=await page.evaluate(()=>__tx.ui.preview?.dest);
   if(pv.x!==c.dest.x||pv.y!==c.dest.y)throw Error('preview destination mismatch');
   await page.locator('[data-sheet="confirm-move"]').click();await settle();
   const after=(await observe()).units.find(u=>u.id===c.id);
   if(after.x!==c.dest.x||after.y!==c.dest.y||after.ap!==beforeUnit.ap-1)throw Error(`command ${i}: move mismatch ${JSON.stringify(after)}`);
  }else if(c.action==='fire'){
   const aim=page.locator(`[data-sheet="aim:${c.target}"]`);
   if(await aim.count())await aim.click();
   const target=await page.evaluate(()=>__tx.ui.preview?.target);
   if(target!==c.target)throw Error(`command ${i}: fire preview target ${target} not ${c.target}`);
   await page.locator('[data-sheet="confirm-fire"]').click();await settle();
  }
  console.log(`[${width}] action ${i+1}/${commands.length}: ${c.id} ${c.action}`);
 }
 const final=await observe();
 check(width,'relay verified and all three operatives extracted alive by round 10',await page.evaluate(()=>__tx.ui.ended==='win'&&__tx.state.round===10&&__tx.state.nodes.find(n=>n.id==='RELAY').state==='VERIFIED'&&__tx.state.units.filter(u=>u.faction==='PLAYER').every(u=>!u.dead&&!u.downed&&u.statuses.includes('EXTRACTED'))),final);
 check(width,'terminal completion is visible',await page.locator('#txEnd').isVisible()&&/Relay secured/i.test(await page.locator('#txEnd').innerText()));
 check(width,'aftermath shows three squad outcomes, objectives, replay and World return',await page.locator('#txAftermathSquad [data-result-unit]').count()===3&&await page.locator('#txAftermathGoals [data-goal]').count()>0&&await page.locator('[data-sheet=restart]').isVisible()&&(await page.locator('#txReturn').getAttribute('href')).includes('prim3-world.html'));
 check(width,'terminal combat controls are disabled',await page.locator('#txEndTurn').isDisabled()&&await page.locator('#txActs button:not([disabled])').count()===0);
 await page.screenshot({path:out+`/win-${width}.png`,fullPage:true});
 const saved=await page.evaluate(()=>JSON.stringify(__tx.state));
 // The deployed URL uses new=1. Reload the same mission's continue URL so it resumes, not redeploys.
 const continueUrl=new URL(page.url());continueUrl.searchParams.delete('new');await page.goto(continueUrl.href,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__tx?.r3,null,{timeout:60000});
 check(width,'terminal state and edited mission restore on reopen',await page.evaluate(({saved,title})=>JSON.stringify(__tx.state)===saved&&__tx.ui.ended==='win'&&document.title.includes(title),{saved,title}));
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tx?.r3,null,{timeout:60000});
 check(width,'terminal state survives actual reload',await page.evaluate(s=>JSON.stringify(__tx.state)===s&&__tx.ui.ended==='win',saved));
 check(width,'no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 check(width,'no page errors',errors.length===0,errors);
 await writeFile(out+`/final-${width}.json`,JSON.stringify(await observe(),null,2));
 await writeFile(out+`/earned-save-${width}.json`,await page.evaluate(()=>localStorage.getItem(__tx.SAVE_KEY)));
 await page.locator('#txReturn').click({noWaitAfter:true});
 await page.waitForURL('**/prim3-world.html',{waitUntil:'domcontentloaded'});
 await page.locator('[data-mode="edit"]').click();await page.locator('#pwF-pick').selectOption(missionId);
 check(width,'Return opens World and keeps the edited browser draft',(await page.locator('#pwF-title').inputValue())===title&&(await page.locator('#pwF-briefing').inputValue())===briefing);
 // World Deploy intentionally starts anew; reopening the existing run uses its existing continue URL.
 await page.goto(continueUrl.href,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tx?.r3,null,{timeout:60000});
 check(width,'reopening earned saved run after World return keeps the win',await page.evaluate(s=>JSON.stringify(__tx.state)===s&&__tx.ui.ended==='win',saved));
 await page.locator('[data-sheet="restart"]').click();await page.waitForFunction(()=>window.__tx?.r3&&!__tx.busy,null,{timeout:60000});
 check(width,'Replay starts a fresh mission with the same briefing',await page.evaluate(({title,briefing})=>__tx.state.round===1&&__tx.ui.ended===null&&__tx.state.nodes.find(n=>n.id==='RELAY').state==='OBSERVED'&&__tx.state.units.every(u=>!u.statuses.includes('EXTRACTED'))&&document.title.includes(title)&&document.querySelector('#txObj').textContent.includes(briefing),{title,briefing}));

 }catch(e){check(width,'completion flow',false,e.stack);await page.screenshot({path:out+`/failure-${width}.png`,fullPage:true}).catch(()=>{});await writeFile(out+`/failure-${width}.json`,JSON.stringify(await observe().catch(()=>null),null,2));}
 await ctx.close();
}}finally{await browser.close();const sourcesAfter=await sourceHashes();check('source','runtime sources unchanged during acceptance',JSON.stringify(sourcesBefore)===JSON.stringify(sourcesAfter));await writeFile(out+'/source-manifest.json',JSON.stringify({before:sourcesBefore,after:sourcesAfter},null,2));await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);if(results.some(r=>!r.pass))process.exitCode=1;
