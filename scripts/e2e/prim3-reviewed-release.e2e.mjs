// Called by the isolated PostgreSQL harness. Real handler/SQL/gameplay; synthetic owner.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(join(process.env.PRIM3_BROWSER_TOOLS||'/tmp/prim3-release-browser/node_modules','x'));
const {chromium}=require('playwright');
const THREE=join(process.env.PRIM3_BROWSER_TOOLS||'/tmp/prim3-release-browser/node_modules','three');
const ROOT=resolve(import.meta.dirname,'../..'),BASE='https://matthew.mccluster.org';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
export async function runReviewedReleaseBrowser({handleLearning,env,options}){
 assert.equal(JSON.parse(await readFile(join(THREE,'package.json'),'utf8')).version,'0.180.0');
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{for(const width of [390,1280]){
  const ctx=await browser.newContext({viewport:{width,height:900}}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await ctx.addInitScript(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'synthetic-owner'})));
  await ctx.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.origin==='https://api.mccluster.org'){
    if(u.pathname==='/v1/status')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"ok":true}'});
    const r=await handleLearning(new Request(req.url(),{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postData()}),{...env,ALLOWED_ORIGINS:BASE},options);
    if(!r)return route.abort();return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()});
   }
   if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/three@0.180.0/')){
    const f=resolve(THREE,u.pathname.slice('/npm/three@0.180.0/'.length));assert.ok(f.startsWith(resolve(THREE)+sep));return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:await readFile(f)});
   }
   if(u.origin!==BASE)return route.abort();
   if(['/js/tabbar.js','/js/shell-boot.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   const f=resolve(ROOT,u.pathname.slice(1));if(!f.startsWith(ROOT+sep))return route.abort();
   try{return route.fulfill({contentType:mime[extname(f)]||'application/octet-stream',body:await readFile(f)});}catch{return route.fulfill({status:404,body:''});}
  });
  console.log(`Browser release journey ${width}px: review`);
  await page.goto(BASE+'/prim3-released-mission.html');
  await page.waitForFunction(()=>document.getElementById('releasePublish')?.disabled===false);
  await page.fill('#releaseSeed',String(width));await page.check('#releaseFiction');await page.check('#releaseGeography');await page.click('#releasePublish');
  await page.locator('#releaseBrief').waitFor({state:'visible'});await page.click('#releaseStart');
  const frame=await (await page.locator('#releaseGame').elementHandle()).contentFrame();
  await frame.waitForFunction(()=>window.__tx?.r3&&!__tx.busy,null,{timeout:60000});
  console.log(`Browser release journey ${width}px: renderer ready`);
  await frame.locator('[data-sheet=brief-go]').click();
  assert.equal(await page.locator('#releaseSubmit').isDisabled(),true,'math waits for local checkpoint presentation');
  for(let step=0;step<180;step++){
   if(step%20===0)console.log(`Browser release journey ${width}px: action ${step}`);
   await frame.waitForFunction(()=>!__tx.busy);
   if(await frame.evaluate(()=>__tx.ui.ended)){assert.equal(await frame.evaluate(()=>__tx.ui.ended),'win');break;}
   // Same canonical planning primitives as #762's ordinary-threat acceptance.
   const cmd=await frame.evaluate(async()=>{
    const R=await import('/js/prim3-tactics/tactical-resolver.mjs'),{playerProjection}=await import('/js/prim3-tactics/tactical-hints.mjs'),{loadLevel}=await import('/js/prim3-tactics/levels/index.mjs');
    const level=await loadLevel('generated'),s=__tx.state,known=playerProjection(s),done=s.nodes.every(n=>n.state==='VERIFIED');
    for(const u of s.units.filter(u=>u.faction==='PLAYER'&&!u.dead&&!u.downed&&!u.statuses.includes('EXTRACTED'))){
     if(done)try{R.extractUnit(s,u.id);return{id:u.id,act:'extract'};}catch{}
     if(u.ap<1)continue;
     const special=level.HOOKS.actions(s,u.id)[0];if(special)return{id:u.id,act:special.id};
     const target=known.units.filter(e=>e.faction!=='PLAYER'&&!e.dead&&!e.downed).find(e=>{try{return R.shotPreview(s,u.id,e.id).legal;}catch{return false;}});if(target)return{id:u.id,act:'fire',target:target.id};
     if(!u.ammo&&u.reserveAmmo)return{id:u.id,act:'reload'};
     const goal=done?s.battlefield.extractionZone:s.nodes.find(n=>n.state!=='VERIFIED'&&n.at.roles.includes(u.role))?.at;if(!goal)continue;
     const points=done?[{x:goal.x,y:goal.y,z:0}]:[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>({x:goal.x+x,y:goal.y+y,z:0}));
     const path=points.map(p=>R.findPath(s,u.id,p)).filter(Boolean).sort((a,b)=>a.length-b.length)[0],reach=R.computeReach(s,u.id,u.moveRange);
     const dest=path&&[...path].reverse().find(p=>reach.costAt(p.x,p.y,p.z)!==undefined&&!s.units.some(o=>o.id!==u.id&&!o.dead&&!o.statuses.includes('EXTRACTED')&&o.x===p.x&&o.y===p.y&&o.z===p.z));if(dest)return{id:u.id,act:'move',dest};
    }return{act:'end'};
   });
   if(cmd.act==='end')await frame.locator('#txEndTurn').click();else{
    await frame.locator(`[data-unit="${cmd.id}"]`).click();await frame.locator(`[data-act="${cmd.act}"]`).click();
    if(cmd.act==='move'){await frame.evaluate(p=>__tx.onTap(p),cmd.dest);await frame.locator('[data-sheet=confirm-move]').click();}
    if(cmd.act==='fire'){const aim=frame.locator(`[data-sheet="aim:${cmd.target}"]`);if(await aim.count())await aim.click();await frame.locator('[data-sheet=confirm-fire]').click();}
   }
   await frame.waitForFunction(()=>!__tx.busy);
   for(let i=0;i<3;i++){
    const ready=await page.evaluate(async()=>{const {checkpointReady}=await import('/js/prim3-mission/released-learning.mjs'),s=document.getElementById('releaseGame').contentWindow.__tx.state,cp=document.getElementById('releaseCheckpoint').textContent.split(' · ')[0];return checkpointReady(s,s.battlefield.generated.recipeId,cp);});
    if(!ready)break;
    await page.waitForFunction(()=>!document.getElementById('releaseSubmit').disabled);
    const previous=await page.locator('#releaseCheckpoint').textContent(),n=(await page.locator('#releaseQuestion').textContent()).match(/-?\d+/g).map(Number);
    await page.fill('#releaseAnswer',String(Math.abs(n[2]-n[0])));await page.click('#releaseSubmit');
    await page.waitForFunction(old=>document.getElementById('releaseCheckpoint').textContent!==old,previous);
   }
  }
  assert.equal(await frame.evaluate(()=>__tx.ui.ended),'win');
  await page.selectOption('#releaseOutcome','completed');await page.click('#releaseFinish');
  await page.waitForFunction(()=>document.getElementById('releaseSummary').textContent.includes('3/3 answers correct'));
  await page.reload();await page.waitForFunction(()=>document.getElementById('releaseSummary')?.textContent.includes('3/3 answers correct'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);assert.deepEqual(errors,[]);
  console.log(`PASS ${width}px real SQL review → existing tactical gameplay → inline validated checkpoints → debrief/reload; ordinary opponents, no state injection`);
  await ctx.close();
 }}finally{await browser.close();}
}
