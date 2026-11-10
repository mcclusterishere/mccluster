/* Run: node scripts/e2e/world-environment.mjs
 * Actual mnet DOM, styles and World mode module. Unrelated application scripts and
 * Cesium rendering are isolated; canonical API responses are explicit fixtures.
 * No live service, deployment, capture or production-streaming claim is made.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright'));}
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url))); // no trailing slash: the containment check below appends path.sep
const id='11111111-1111-4111-8111-111111111111',assignment='22222222-2222-4222-8222-222222222222';
const event={id:'usgs:test',title:'Fixture government observation',category:'Earthquake',lat:41,lon:-73,observed_at:'2026-11-06T12:00:00Z',fetched_at:'2026-11-07T12:00:00Z',stale:true,source:{label:'USGS',url:'https://earthquake.usgs.gov/earthquakes/eventpage/test'},actions:[{id:'verify',title:'Verify public guidance',description:'Check official notices remotely.',proof:'Link to official notice',safety:'Do not enter a hazardous area.'}]};
const fixture={schema:'world-environment/v1',events:[event],sources:[{label:'USGS',status:'available',coverage:'Global',observed_at:event.observed_at,fetched_at:event.fetched_at},{label:'NASA EONET',status:'unavailable',coverage:'Selected events'}],missions:[]};
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  let body=await readFile(file);const ext=path.extname(file);
  if(pathname==='/mnet.html'){
   // Keep the shipped DOM and CSS. Only load the modules under test and their real imports.
   body=body.toString().replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi,(whole,attrs)=>/src="js\/(?:travel\/world-travel\.mjs|world-environment(?:-mccluster)?\.mjs)/.test(attrs)?whole:'');
  }
  res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp'})[ext]||'application/octet-stream');res.end(body);
 }catch{res.writeHead(404);res.end();}
});
// One startup attempt; report a denied socket rather than bypassing restrictions.
try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}catch(error){console.error('BLOCKED: local HTTP listener at 127.0.0.1: '+error.message);process.exitCode=2;throw error;}
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  let joined=false,assigned=false,failJoin=true,approved=false,unavailable=false,holdOwner=false,releaseOwner,proof=null,proofShare=false,malformedTeam=true;
  const posts=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));if(process.env.WORLD_ENVIRONMENT_DEBUG)page.on('console',m=>console.error('console:',m.type(),m.text().slice(0,160)));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===origin && url.pathname==='/action-globe.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Globe rendering isolated in fixture harness</body></html>'});
   if(url.origin===origin)return route.continue();
   if(url.origin!=='https://api.mccluster.org'||!url.pathname.startsWith('/v1/world/environment'))return route.fulfill({contentType:'application/json',body:'{}'});
   const endpoint=url.pathname.slice('/v1/world/environment'.length),method=request.method(),who=request.headers().authorization;
   const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'authorization, content-type'},body:JSON.stringify(body)});
   // Private success envelopes are derived from the pinned transport contract (vendor transport requires ok:true; audit EQ4).
   const ok=(body,status=200)=>reply(status<400?{ok:true,...body}:body,status);
   if(method==='OPTIONS')return reply({});
   if(method==='POST')posts.push({endpoint,body:request.postDataJSON(),who});
   if(endpoint==='')return unavailable?reply({error:'Unavailable'},503):reply({...fixture,missions:approved?[{id,event_id:event.id,action_id:'verify',status:'open'}]:[]});
   if(!who)return reply({error:'Sign in'},401);
   if(endpoint==='/proofs')return who==='Bearer owner'?ok({proofs:proof?[{proof_id:proof.id,assignment_id:assignment,title:'Saved environmental mission',statement:proof.statement,status:proof.status,proof_revision:proof.revision}]:[]}):reply({error:'Owner required'},403);
   if(endpoint==='/assignments/'+assignment+'/proof'){
    if(method==='POST'){const input=request.postDataJSON();proof={id:'33333333-3333-4333-8333-333333333333',proof_id:'33333333-3333-4333-8333-333333333333',statement:input.statement,status:'pending',revision:'0123456789abcdef0123456789abcdef'};proofShare=input.share;return ok({proof_id:proof.id,assignment_id:assignment,status:'submitted',share:proofShare});}
    return ok({assignment_id:assignment,status:proof?'submitted':'joined',mission_status:'open',can_submit:true,can_share:false,share:proofShare,proof});
   }
   if(endpoint==='/team'){
    if(malformedTeam){malformedTeam=false;return reply({membership:{joined},assignments:[]});} // deliberately missing ok:true: explicit negative case
    if(method==='POST')joined=request.postDataJSON().join;
    return ok({membership:{joined},assignments:assigned?[{mission_id:id,assignment_id:assignment,status:'joined',mission_status:'open',title:'Saved environmental mission',event_id:event.id,source:event.source,observed_at:event.observed_at,capture_path:'/live-mission.html?assignment='+assignment}]:[]});
   }
   if(endpoint==='/oversight'){
    if(holdOwner && who==='Bearer owner'){holdOwner=false;await new Promise(resolve=>releaseOwner=resolve);return ok({missions:[{id,title:'Private owner proposal',status:'proposed',assignments:[{display_name:'Private member name',user_id:'secret',status:'joined'}]}]});}
    return who==='Bearer owner'?ok({missions:[{id,title:'Owner-reviewed proposal',status:approved?'open':'proposed',assignments:[{display_name:'Private member name',status:'joined'}]}]}):reply({error:'Owner required'},403);
   }
   if(endpoint.endsWith('/join')){if(failJoin)return ok({});assigned=true;return ok({assignment_id:assignment});}
   if(endpoint.endsWith('/review')){approved=request.postDataJSON().decision==='open';return ok({});}
   if(endpoint==='/missions/propose')return ok({id,status:'proposed'});
   return reply({error:'Unexpected endpoint'},404);
  });
  await page.addInitScript(()=>{window.__testToken=null;window.MCC_SUPA={token:async()=>window.__testToken};});
  const auth=async value=>{await page.evaluate(value=>{window.__testToken=value;window.dispatchEvent(new Event('mcc:auth-changed'));},value);};
  const waitText=async(selector,text)=>{await page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent.includes(text),{selector,text});};
  await page.goto(origin+'/mnet.html');await page.waitForFunction(()=>!!window.MCC_WORLD_MODE);
  assert.equal(await page.locator('#mnWorldFrame').count(),1);
  assert.equal(await page.locator('.wt-world-modes [data-world-mode="travel"]').isVisible(),false);
  assert.equal(await page.locator('.wt-world-modes [data-world-mode="missions"]').isVisible(),false);
  const originalFrame=await page.locator('#mnWorldFrame').getAttribute('src');
  await page.locator('.wt-world-modes [data-world-mode="environment"]').click();
  await waitText('#weEvents','Fixture government observation');assert.equal(posts.length,0);
  assert.match(await page.locator('#weStatus').textContent(),/Some sources are unavailable/);
  await page.locator('#weEvents button').click();
  assert.match(await page.locator('#weDetail').textContent(),/Observed[\s\S]*2026[\s\S]*Retrieved[\s\S]*2026/);
  assert.equal(await page.locator('#weDetail a').getAttribute('href'),event.source.url);
  assert.equal(await page.locator('#weOwner').isVisible(),false);
  assert.equal(await page.locator('a[href*="live-mission.html"]:visible').count(),0);
  const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,panel:document.getElementById('wePanel').scrollWidth,panelClient:document.getElementById('wePanel').clientWidth}));
  assert.equal(dimensions.scroll,dimensions.client,JSON.stringify(dimensions));assert.ok(dimensions.panel<=dimensions.panelClient,JSON.stringify(dimensions));
  for(let i=0;i<3;i++){await page.locator('.wt-world-modes [data-world-mode="posts"]').click();assert.equal(await page.locator('#wePanel').isVisible(),false);await page.locator('.wt-world-modes [data-world-mode="environment"]').click();}
  assert.equal(await page.locator('#mnWorldFrame').getAttribute('src'),originalFrame);assert.equal(await page.locator('#mnWorldFrame').count(),1);
  await auth('member');await waitText('#weTeam','Team membership is not available yet');assert.equal(posts.length,0);
  await page.getByRole('button',{name:'Check membership'}).click();await waitText('#weTeam','Join the team');
  await page.getByRole('button',{name:'Join the team',exact:true}).click();assert.equal(posts.length,0);
  await page.locator('#weJoinConsent').check();await page.getByRole('button',{name:'Join the team',exact:true}).click();await waitText('#weTeam','You are on');assert.equal(posts[0].endpoint,'/team');
  await page.getByRole('button',{name:'Suggest this mission for review'}).click();await waitText('#weStatus','saved for owner review');assert.equal(posts[1].endpoint,'/missions/propose');
  assert.equal(await page.getByRole('button',{name:'Join approved mission'}).count(),0);
  await auth('owner');await waitText('#weOwner','Owner-reviewed proposal');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Approve mission',exact:true}).click();assert.equal(posts.length,2);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Approve mission',exact:true}).click();await waitText('#weOwner','Status: open');
  await auth('member');await waitText('#weTeam','You are on');assert.equal(await page.locator('#weOwner').isVisible(),false);assert.equal(await page.getByText('Private member name').count(),0);
  await page.getByRole('button',{name:'Join approved mission'}).click();await waitText('#weStatus','No assignment was confirmed');
  assert.equal(await page.getByRole('link',{name:'Check recording availability'}).count(),0);
  failJoin=false;await page.getByRole('button',{name:'Join approved mission'}).click();await waitText('#weDetail','Your mission: joined');
  assert.equal(await page.getByRole('link',{name:'Check recording availability'}).getAttribute('href'),'/live-mission.html?assignment='+assignment);
  assert.equal(posts.filter(p=>p.endpoint.endsWith('/join')).length,2);
  await page.getByRole('button',{name:'Open mission evidence'}).click();
  await waitText('#weProof','No evidence has been submitted');
  await page.getByLabel('What did you complete? Include dates, sources and what remains uncertain.').fill('Checked the dated official accessibility guidance remotely.');
  const sharing=page.getByLabel('After owner verification, I want this proof and statement posted to the public Action Network feed.');assert.equal(await sharing.isChecked(),false);
  await page.getByLabel('I checked this evidence, have permission to submit it, and removed other people’s private information.').check();
  await page.getByRole('button',{name:'Submit evidence for review'}).click();
  await waitText('#weStatus','public sharing off');assert.equal(await page.locator('#weProof').isVisible(),false);assert.equal(proofShare,false);
  await page.getByRole('button',{name:'Open mission evidence'}).click();await waitText('#weProof','Evidence review: pending');await page.getByRole('button',{name:'Close evidence'}).click();
  // An owner response completing after sign-out must never restore private rows.
  holdOwner=true;await auth('owner');
  for(let i=0;i<100&&!releaseOwner;i++)await page.waitForTimeout(20);assert.ok(releaseOwner,'owner request started');
  await page.locator('.wt-world-modes [data-world-mode="posts"]').click();await auth(null);releaseOwner();await page.waitForTimeout(100);
  await page.locator('.wt-world-modes [data-world-mode="environment"]').click();
  assert.equal(await page.locator('#weOwner').isVisible(),false);assert.equal(await page.getByText('Private member name').count(),0);assert.equal(await page.getByRole('link',{name:'Check recording availability'}).count(),0);
  await auth('member');await waitText('#weTeam','You are on');
  unavailable=true;await page.getByRole('button',{name:'Refresh sources'}).click();await waitText('#weStatus','No current observations');assert.equal(await page.locator('#weEvents button').count(),0);await waitText('#weAssignments','Saved environmental mission');assert.match(await page.locator('#weAssignments').textContent(),/not in the current feed/);
  assert.deepEqual(errors,[],'No runtime errors in the tested modules');
  const out=process.env.WORLD_ENVIRONMENT_ARTIFACT_DIR;if(out){await mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'world-environment-'+width+'.png'),fullPage:true});}
  console.log(`PASS ${width}px: actual World DOM, no overflow, one iframe, hidden owner modes, repeated switching, source dates/unavailability, malformed-envelope refusal, explicit team/proposal/review/join, confirmed assignment link, auth race privacy. Fixtures only.`);
  await context.close();
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
