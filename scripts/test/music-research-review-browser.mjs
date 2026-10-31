import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/selfservice-tools/node_modules/playwright/index.mjs');
const root=new URL('../../',import.meta.url),owner='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',track='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',foreign='cccccccc-cccc-cccc-cccc-cccccccccccc',job='dddddddd-dddd-dddd-dddd-dddddddddddd';
async function fixture(browser,width=390,{enabled=true,unavailable=false,hostileLink=false}={}){
 const page=await browser.newPage({viewport:{width,height:844}}),calls=[],errors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
 const state={enqueue_enabled:enabled,execution_enabled:false,tracks:[{id:track,title:'Private fixture original',status:'pending_review',rights_status:'attested',eligible:true}],models:[{model_id:'fixture_analyze',stage:'analyze',version:'1'},{model_id:'fixture_separate',stage:'separate',version:'1'}],jobs:[{id:job,track_id:track,stage:'analyze',status:'awaiting_review',model_id:'fixture_analyze',result:{schema:'fixture'},created_at:'2026-10-26T00:00:00Z'}],artifacts:[{id:'fixture-artifact',job_id:job,kind:'features',object_path:'research/'+owner+'/'+job+'/features.json',byte_size:12,status:'quarantined'}]};
 let denyNext=true;
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.hostname==='fixture.invalid'){
   if(u.pathname==='/music-research.html')return route.fulfill({contentType:'text/html',body:(await readFile(new URL('music-research.html',root),'utf8')).replace(/<script[\s\S]*?<\/script>/g,'')});
   if(u.pathname.startsWith('/css/'))return route.fulfill({contentType:'text/css',body:await readFile(new URL('css/music-research-queue.css',root),'utf8')});
   return route.fulfill({status:204,body:''});
  }
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body),headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type,apikey'}});
  if(req.method()==='OPTIONS')return json({});
  const token=req.headers().authorization;
  calls.push({url:u.href,method:req.method(),token,body:req.postData()?req.postDataJSON():null});
  if(u.hostname==='api.mccluster.org'&&u.pathname==='/v1/music-workspace/analysis'){
   if(unavailable)return json({error:'Fixture configuration unavailable'},503);
   if(req.method()==='GET')return json(token==='Bearer owner-session'?state:{...state,tracks:[],jobs:[],artifacts:[]});
   const b=req.postDataJSON();if(token!=='Bearer owner-session'||b.track_id!==track)return json({error:'Owner required'},403);
   if(denyNext){denyNext=false;return json({error:'Temporary fixture failure; retry'},503)}return json({accepted:true,job_id:job,published:false},202);
  }
  if(u.hostname==='zmnhbrjyhxzhkxmhkexs.supabase.co'&&u.pathname.includes('/storage/v1/object/sign/'))return json({signedURL:hostileLink?'https://foreign.invalid/private':'/object/sign/creator-research-outputs/fixture?token=fixture'});
  if(u.hostname==='zmnhbrjyhxzhkxmhkexs.supabase.co'&&u.pathname.endsWith('/mcc_music_research_review')){
   if(token!=='Bearer owner-session')return json({error:'Owner required'},403);
   state.jobs[0].status=req.postDataJSON().p_decision;return json(job);
  }
  return json({error:'Unexpected fixture request'},400);
 });
 await page.goto('https://fixture.invalid/music-research.html?track='+foreign);
 await page.evaluate(owner=>{window.currentSession={access_token:'owner-session',user:{id:owner}};window.MCC={session:()=>window.currentSession,refreshIfNeeded:async()=>window.currentSession,mUid:async()=>window.currentSession?.user.id};},owner);
 await page.addScriptTag({type:'module',content:await readFile(new URL('js/music-research-queue.mjs',root),'utf8')});
 return {page,calls,errors,state};
}
test('390/1440 private review requires consent, ignores foreign selection, retries same request and waits for owner stage approval',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 for(const width of [390,1440]){
  const {page,calls,errors}=await fixture(browser,width);await page.waitForFunction(()=>document.getElementById('mrStatus').textContent.includes('Loaded'));
  assert.equal(await page.locator('#mrTrack').inputValue(),track);assert.equal(await page.locator('#mrEnqueue').isDisabled(),true);assert.equal(calls.filter(c=>c.method==='POST').length,0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  assert.match(await page.locator('#mrAvailability').innerText(),/processing is disabled/);
  await page.locator('#mrResearchConsent').check();await page.locator('#mrEnqueue').click();await page.waitForFunction(()=>document.getElementById('mrStatus').textContent.includes('Temporary fixture failure'));
  await page.locator('#mrEnqueue').click();await page.waitForFunction(()=>!document.getElementById('mrResearchConsent').checked);
  const attempts=calls.filter(c=>c.method==='POST');assert.equal(attempts.length,2);assert.equal(attempts[0].body.idempotency_key,attempts[1].body.idempotency_key);assert.equal(attempts[0].body.consent,true);assert.equal(attempts[0].body.track_id,track);
  await page.locator('#mrStage').selectOption('separate');await page.locator('#mrResearchConsent').check();assert.equal(await page.locator('#mrEnqueue').isDisabled(),true);assert.match(await page.locator('#mrDependency').innerText(),/first approve/);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Approve this stage',exact:true}).click();await page.waitForFunction(()=>document.getElementById('mrDependency').textContent.includes('Prerequisite approved'));
  assert.equal(await page.locator('#mrEnqueue').isDisabled(),true);await page.locator('#mrResearchConsent').check();assert.equal(await page.locator('#mrEnqueue').isEnabled(),true);await page.locator('#mrEnqueue').click();await page.waitForFunction(()=>!document.getElementById('mrResearchConsent').checked);
  const separation=calls.filter(c=>c.url.includes('/analysis')&&c.method==='POST').at(-1);assert.equal(separation.body.parent_job_id,job);assert.equal(separation.body.stage,'separate');
  assert.equal(calls.some(c=>c.url.includes('/storage/')||c.url.includes('claim')),false);assert.deepEqual(errors,[]);
  await page.evaluate(()=>{window.currentSession={access_token:'other-session',user:{id:'other'}};window.dispatchEvent(new Event('mcc:auth-changed'))});await page.waitForFunction(()=>document.getElementById('mrStatus').textContent.includes('Loaded 0'));
  assert.equal(await page.locator('.mr-job').count(),0);assert.equal(await page.locator('#mrEnqueue').isDisabled(),true);await page.close();
 }
 }finally{await browser.close()}
});
test('disabled or missing configuration never permits enqueue and still allows existing private review when available',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 for(const unavailable of [false,true]){
  const {page,calls}=await fixture(browser,390,{enabled:false,unavailable});await page.waitForFunction(()=>/Loaded|unavailable/.test(document.getElementById('mrStatus').textContent));
  await page.locator('#mrResearchConsent').check();assert.equal(await page.locator('#mrEnqueue').isDisabled(),true);assert.equal(calls.filter(c=>c.method==='POST').length,0);
  assert.equal(await page.getByRole('button',{name:'Approve this stage',exact:true}).count(),unavailable?0:1);await page.close();
 }
 }finally{await browser.close()}
});

test('private artifacts are signed only on request and reject foreign preview origins',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 for(const hostileLink of [false,true]){
  const {page,calls}=await fixture(browser,390,{enabled:false,hostileLink});await page.waitForFunction(()=>document.getElementById('mrStatus').textContent.includes('Loaded'));
  assert.equal(calls.some(c=>c.url.includes('/storage/')),false);await page.getByRole('button',{name:'View private features',exact:true}).click();
  if(hostileLink){await page.waitForFunction(()=>document.getElementById('mrStatus').textContent.includes('host mismatch'));assert.equal(await page.locator('.mr-templink a').count(),0);}
  else {await page.locator('.mr-templink a').waitFor();assert.match(await page.locator('.mr-templink a').getAttribute('href'),/^https:\/\/zmnhbrjyhxzhkxmhkexs\.supabase\.co\/storage\/v1\/object\/sign/);}
  const signing=calls.find(c=>c.url.includes('/storage/'));assert.equal(signing.body.expiresIn,120);assert.equal(signing.token,'Bearer owner-session');
  await page.evaluate(()=>{window.currentSession=null;window.dispatchEvent(new Event('mcc:auth-changed'))});await page.waitForFunction(()=>document.getElementById('mrStatus').textContent.includes('Sign into'));assert.equal(await page.locator('.mr-templink').count(),0);await page.close();
 }
 }finally{await browser.close()}
});
