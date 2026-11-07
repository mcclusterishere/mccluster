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
export async function runTopologyLearningBrowser({handleLearning,env,options}){
 assert.equal(JSON.parse(await readFile(join(THREE,'package.json'),'utf8')).version,'0.180.0');
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{for(const [variant,topology,width] of [['transit-relay','square',390],['equity-uprise-hq','square',390],['equity-uprise-b1','square',390],['equity-uprise-b1-attack','square',390],['courtyard','square',390],['city','square',390],['city','hex',390],['city','hex',1280]]){
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
  console.log(`Learning journey ${variant}/${topology} ${width}px`);
  await page.goto(BASE+'/prim3-released-mission.html');
  await page.waitForFunction(()=>document.getElementById('releasePublish')?.disabled===false);
  await page.fill('#releaseSeed',String(10000+width+['transit-relay','equity-uprise-hq','equity-uprise-b1','equity-uprise-b1-attack','courtyard','city'].indexOf(variant)*10+(topology==='hex'?1:0)));
  await page.check('#releaseFiction');await page.check('#releaseGeography');await page.click('#releasePublish');
  await page.locator('#releaseBrief').waitFor({state:'visible'});await page.selectOption('#learningVariant',variant);await page.selectOption('#learningTopology',topology);await page.click('#releaseStart');
  const frame=await (await page.locator('#releaseGame').elementHandle()).contentFrame();
  if(variant==='city'){await frame.locator('summary').click();await frame.locator('#start').click();await frame.waitForFunction(()=>window.__prim3CityLearningSnapshot?.());assert.equal(await frame.locator('#topology').inputValue(),topology);}
  else if(variant==='courtyard')await frame.waitForFunction(()=>window.__PRIM3?.snapshot());
  else {await frame.waitForFunction(()=>window.__tx?.r3&&!__tx.busy,null,{timeout:60000});if(await frame.locator('[data-sheet=brief-go]').count())await frame.locator('[data-sheet=brief-go]').click();}
  assert.equal(await page.locator('#releaseSubmit').isDisabled(),true);
  for(let i=0;i<3;i++){
   if(variant==='city')await frame.locator('#end').click();
   else if(variant==='courtyard')await frame.locator('#end-turn').click();
   else {await frame.locator('#txEndTurn').click();await frame.waitForFunction(()=>!__tx.busy);}
   await page.waitForFunction(()=>!document.getElementById('releaseSubmit').disabled);
   if(i===0){await page.fill('#releaseAnswer','-1');await page.click('#releaseSubmit');await page.waitForFunction(()=>document.getElementById('releaseStatus').textContent.includes('lattice steps'));await page.click('#releaseHint');await page.waitForFunction(()=>document.getElementById('releaseStatus').textContent.includes('absolute')||document.getElementById('releaseStatus').textContent.includes('Δq'));}
   const text=await page.locator('#releaseQuestion').textContent(),m=text.match(/from \((-?\d+), (-?\d+)\) to \((-?\d+), (-?\d+)\)/),[,x,y,X,Y]=m.map(Number),dq=X-x,dr=Y-y;
   const old=await page.locator('#releaseCheckpoint').textContent();
   await page.fill('#releaseAnswer',String(topology==='hex'?Math.max(Math.abs(dq),Math.abs(dr),Math.abs(dq+dr)):Math.abs(dq)+Math.abs(dr)));await page.click('#releaseSubmit');
   await page.waitForFunction(previous=>document.getElementById('releaseCheckpoint').textContent!==previous,old);
  }
  await page.selectOption('#releaseOutcome','abandoned');await page.click('#releaseFinish');await page.waitForFunction(()=>document.getElementById('releaseSummary').textContent.includes('3/4 answers correct'));
  await page.reload();await page.waitForFunction(()=>document.getElementById('releaseSummary')?.textContent.includes('3/4 answers correct'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);assert.deepEqual(errors,[]);
  console.log(`PASS ${variant}/${topology} ${width}px brief → real turns → wrong/hinted/correct math → abandoned debrief/reload (no combat completion claim)`);await ctx.close();
 }}finally{await browser.close();}
}
