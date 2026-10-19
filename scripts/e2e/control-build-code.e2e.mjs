/* Control → Build → Code browser proof. Real control.html and modules from this
   checkout; EVERY network call is a synthetic fixture. A "queued" or
   "completed" build here is fixture state, never an executed code change,
   never Core, never GitHub.
   PLAYWRIGHT_DIR=<node_modules> node scripts/e2e/control-build-code.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/control-build-code-proof';
const require=createRequire(import.meta.url);
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB='623e4567-e89b-42d3-a456-426614174555';
const results=[];
function check(scope,name,condition,detail){results.push({scope,name,pass:!!condition});console.log((condition?'PASS ':'FAIL ')+'['+scope+'] '+name+(condition?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
function contract(enabled){return {capability:'code.build',job_type:'code_patch',binding:'core.code.build',enabled,state:enabled?'available':'unavailable',unavailable_reason:enabled?null:'control_build_code_disabled',repositories:['mcclusterishere/mccluster'],risk:'write',approval:'review-required',execution:'async',output:'draft_pr_only',max_attempts:2,priority:80,limits:{task_max:20000,title_max:500,paths_max:20},protected_paths:[],safety:{auto_merge:false,production_deploy:false,isolated_worktree:true,human_review:true}};}
function receipt(state,extra={}){const base={state,job_id:JOB,correlation_id:JOB,capability:'code.build',job_type:'code_patch',repository:'mcclusterishere/mccluster',idempotency_key:null,title:'Fixture build',allowed_paths:['scripts/test'],attempts:state==='queued'?0:1,max_attempts:2,last_error:null,locked_by:state==='running'?'core:ovh-primary':null,created_at:'2026-10-19T02:00:00Z',updated_at:'2026-10-19T02:01:00Z',run_after:'2026-10-19T02:00:00Z',approval:null,reported:null,verification:{draft_pr_verified:false,head_sha:null,note:null}};return {...base,...extra};}
async function setup(viewport,{owner=true,enabled=true,ledger}={}){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true});
  const posts=[],errors=[];
  await ctx.addInitScript(()=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-09-26',accepted_at:new Date().toISOString()}));
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:'11111111-1111-4111-8111-111111111111',email:'owner@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:'11111111-1111-4111-8111-111111111111',email:'owner@fixture.invalid'}}));
  });
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.hostname==='cesium.com'||/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname))return route.abort();
    if(u.origin==='https://api.mccluster.org'){
      if(p==='/health')return json(route,{ok:true});
      if(p==='/v1/status')return owner?json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}}):json(route,{error:'Forbidden'},403);
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:'11111111-1111-4111-8111-111111111111'},default_org_id:'o1',workspaces:[{org_id:'o1',slug:'mccluster',kind:'studio',role:owner?'owner':'viewer',enabled:true,name:'McCluster'}]});
      if(p.startsWith('/v1/ai/build/code')){
        if(!owner)return json(route,{error:'McCluster house owner access required'},403);
        if(p==='/v1/ai/build/code'&&req.method()==='GET')return json(route,contract(enabled));
        if(p==='/v1/ai/build/code'&&req.method()==='POST'){
          const body=req.postDataJSON();posts.push(body);
          if(!enabled)return json(route,{state:'unavailable',reason:'control_build_code_disabled',capability:'code.build',enabled:false},503);
          if(!UUID.test(body.idempotency_key||''))return json(route,{error:'idempotency_key must be a UUID'},400);
          const dup=posts.filter(b=>b.idempotency_key===body.idempotency_key).length>1;
          ledger.state='queued';
          return json(route,{queued:!dup,replayed:dup,job_id:JOB,receipt:receipt('queued',{idempotency_key:body.idempotency_key,title:body.title||null,allowed_paths:body.allowed_paths||[]})},dup?200:202);
        }
        if(p==='/v1/ai/build/code/'+JOB&&req.method()==='GET'){
          const st=ledger.state;
          return json(route,{receipt:receipt(st,st==='completed'?{reported:{branch:'core/job-abc123',pushed:true,draft_pr:'https://github.com/mcclusterishere/mccluster/pull/999',forbidden:null,tests:{ok:true,command:'npm test'},summary:'Fixture summary',agent_output_tail:'fixture log tail'}}:st==='failed'?{last_error:'opencode exited 1 (fixture)'}:{})});
        }
        return json(route,{error:'build not found'},404);
      }
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/user')return json(route,{id:'11111111-1111-4111-8111-111111111111',email:'owner@fixture.invalid'});
      return json(route,[]);
    }
    if(u.origin===BASE){
      const rel=p==='/'?'index.html':p.replace(/^\//,'');const file=resolve(ROOT,rel);
      if(!file.startsWith(resolve(ROOT)+sep))return route.abort();
      try{return route.fulfill({body:await readFile(file),contentType:TYPES[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(/TypeError|ReferenceError|SyntaxError/.test(m.text()))errors.push(m.text().slice(0,200));});
  await page.goto(BASE+'/control.html#create:build',{waitUntil:'domcontentloaded'});
  return {ctx,page,posts,errors};
}
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
try{
  for(const vp of [{width:390,height:844},{width:820,height:1180},{width:1280,height:800}]){
    const scope=vp.width+'px';const ledger={state:'queued'};
    const app=await setup(vp,{ledger});const {page,posts}=app;
    await page.waitForSelector('[data-crb-form]',{state:'visible',timeout:30000});
    check(scope,'the Build view is reachable at #create:build with the contract shown',await page.locator('.crb-contract').isVisible()&&/draft pull request only/i.test(await page.locator('.crb-contract').textContent()));
    check(scope,'no horizontal overflow',(await overflow(page))===0,await overflow(page));
    await page.fill('[data-crb-form] [name="task"]','Add a unit test for route-core distance rounding in scripts/test.');
    await page.fill('[data-crb-form] [name="title"]','Fixture build');
    await page.fill('[data-crb-form] [name="paths"]','scripts/test');
    await page.screenshot({path:join(OUT,`build-form-${vp.width}.png`)});
    const submit=page.locator('[data-crb-form] button[type="submit"]');
    await submit.click();await submit.click({force:true}).catch(()=>{});
    await page.waitForSelector('.crb-receipt[data-crb-state="queued"]',{timeout:15000});
    check(scope,'one submit queues exactly one job with a UUID idempotency key and the typed scope',posts.length===1&&UUID.test(posts[0].idempotency_key)&&posts[0].repository==='mcclusterishere/mccluster'&&JSON.stringify(posts[0].allowed_paths)==='["scripts/test"]',posts);
    check(scope,'the receipt shows the stored state, correlation id and no fabricated progress',/Queued/.test(await page.locator('.crb-state').textContent())&&(await page.locator('.crb-meta').textContent()).includes(JOB)&&!(await page.locator('.crb-receipt').textContent()).includes('%'));
    await page.screenshot({path:join(OUT,`build-queued-${vp.width}.png`)});
    const before=posts.length;
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('.crb-receipt',{timeout:30000});
    await page.waitForFunction(()=>document.querySelector('.crb-receipt')?.textContent.includes('Queued'),null,{timeout:15000});
    check(scope,'a reload resumes the same receipt from the ledger without a second submission',posts.length===before&&(await page.locator('.crb-meta').textContent()).includes(JOB));
    ledger.state='running';await page.locator('[data-crb="refresh"]').click();
    await page.waitForFunction(()=>document.querySelector('.crb-receipt')?.dataset.crbState==='running',null,{timeout:15000});
    check(scope,'refresh maps the running state and names the runner',/core:ovh-primary/.test(await page.locator('.crb-meta').textContent()));
    ledger.state='completed';await page.locator('[data-crb="refresh"]').click();
    await page.waitForFunction(()=>document.querySelector('.crb-receipt')?.dataset.crbState==='completed',null,{timeout:15000});
    const done=await page.locator('.crb-receipt').textContent();
    check(scope,'a completed job shows the reported branch and draft PR marked reported, not verified',/core\/job-abc123/.test(done)&&/reported, not verified/.test(done)&&/No independent GitHub read-back/.test(done)&&await page.locator('.crb-reported a[href="https://github.com/mcclusterishere/mccluster/pull/999"]').count()===1);
    check(scope,'no horizontal overflow on the receipt',(await overflow(page))===0);
    await page.screenshot({path:join(OUT,`build-completed-${vp.width}.png`)});
    ledger.state='failed';await page.locator('[data-crb="refresh"]').click();
    await page.waitForFunction(()=>document.querySelector('.crb-receipt')?.dataset.crbState==='failed',null,{timeout:15000});
    check(scope,'a failed job shows the ledger error, never a success',/opencode exited 1/.test(await page.locator('.crb-receipt').textContent()));
    await page.locator('[data-crb="new"]').click();
    await page.waitForSelector('[data-crb-form]',{state:'visible'});
    await page.fill('[data-crb-form] [name="task"]','Second bounded objective for the same session.');
    await page.locator('[data-crb-form] button[type="submit"]').click();
    await page.waitForFunction(n=>document.querySelector('.crb-receipt')&&n,posts.length,{timeout:15000});
    await page.waitForSelector('.crb-receipt[data-crb-state="queued"]',{timeout:15000});
    check(scope,'starting another build uses a fresh idempotency key',posts.length===2&&posts[1].idempotency_key!==posts[0].idempotency_key&&UUID.test(posts[1].idempotency_key),posts.map(p=>p.idempotency_key));
    check(scope,'no script errors',app.errors.length===0,app.errors);
    await app.ctx.close();
  }
  {
    const ledger={state:'queued'};const app=await setup({width:390,height:844},{enabled:false,ledger});
    await app.page.waitForSelector('.crb-state--unavailable',{timeout:30000});
    const disabled=await app.page.evaluate(()=>[...document.querySelectorAll('[data-crb-form] button[type="submit"],[data-crb-form] textarea,[data-crb-form] select')].every(el=>el.disabled));
    check('flag-off','with the flag off the view says Unavailable, disables every control and cannot submit',disabled&&app.posts.length===0&&/switched off on the API/.test(await app.page.locator('.crb-state--unavailable').textContent()));
    await app.page.screenshot({path:join(OUT,'build-unavailable-390.png')});
    await app.ctx.close();
  }
  {
    const ledger={state:'queued'};const app=await setup({width:390,height:844},{owner:false,ledger});
    await app.page.waitForTimeout(2500);
    const gated=await app.page.evaluate(()=>{const gate=document.getElementById('cpGate');const form=document.querySelector('[data-crb-form]');const err=document.querySelector('.crb .cro-note--bad');return {gateShown:!!gate&&!gate.hidden&&getComputedStyle(gate).display!=='none',formShown:!!form,errorShown:!!err};});
    check('member','a signed-in non-owner never reaches an enabled Build form and submits nothing',app.posts.length===0&&(!gated.formShown||gated.errorShown),gated);
    await app.ctx.close();
  }
}finally{await browser.close();}
const failed=results.filter(r=>!r.pass);
console.log(`\n${results.length-failed.length}/${results.length} checks passed`);
if(failed.length){console.log('FAILED: '+failed.map(f=>'['+f.scope+'] '+f.name).join('; '));process.exit(1);}
