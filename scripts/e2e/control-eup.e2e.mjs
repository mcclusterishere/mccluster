/* Control › System › E=Up browser proof: real control.html and scripts, every
   remote call intercepted with synthetic fixtures (owner, denied, 503
   not_implemented, timeout). Never touches production. Proves at 390 and 1440:
   the five LOCAL tabs switch without remounting the one globe host, no
   horizontal overflow, keyboard tab movement, a 403 renders the denied state,
   not_implemented sections say so, a source refresh carries an idempotency key.
   Module policy (Overview › Modules card), against an in-memory stand-in for
   /v1/eup/modules that follows the Worker's documented answers: Install, Enable,
   Drain and Disable by keyboard, 44px targets and 16px inputs, an unknown
   outcome with a same-key resend, revision_conflict, drain_busy, and no
   horizontal overflow with the controls and their notes open.
   League tab (js/control-room/eup-league.js), at 390 and 1440, against the
   in-process League plane (scripts/test/support/eup-league-plane.mjs: the REAL
   Worker router over the REAL pending SQL in PGlite, the media lane's storage
   double, a token map for the session check; its header says what is emulated).
   The owner side is driven only through the page; the member side (applying,
   accepting, recording, submitting, consenting, revoking, appealing) through
   plane.call over HTTP, as the member page would send it. Proves: policy, campaign
   and song mission from the fixture, rubric and capacity, release, invited
   audience and tester grants; the preview card equals the member read field for
   field; approve with rubric, capacity exhausted, accommodation read (audited),
   request changes, decline, self-approval refused; a proof's audio plays in the
   page from the storage double through the 300 s link, which the page drops when
   it expires (page clock) and signs again on request; three-dimension review, a
   stale revision refused, self-review refused; publish to the campaign audience,
   a refused connection settled by its receipt and a same-key resend, a revoked
   consent reflected; hold and release; an appeal whose answer never came found
   by its receipt; a retention purge that removes the object. No signed URL in
   DOM text, storage or console; no horizontal overflow; 44px targets.
   Two writes the page does not make are labelled: the member's own HTTP calls,
   and one clock step (an upload's staged deadline moved into the past), as in
   scripts/test/eup-league-journey.integration.mjs. PGLITE_MODULE is required;
   without it the League checks FAIL (they are never skipped).
   PGLITE_MODULE=<pglite dist/index.js> PLAYWRIGHT_DIR=<node_modules> CHROMIUM_EXECUTABLE=<chromium> node scripts/e2e/control-eup.e2e.mjs [outDir]
   MCC_SERVE_ROOT=<export dir> ... the same, with the page served from scripts/build-public-export.sh output. */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
/* the tree the browser is served from: the checkout, or an emitted export (scripts/build-public-export.sh <dir>) */
const SERVE=resolve(process.env.MCC_SERVE_ROOT||ROOT);
const OUT=process.argv[2]||'/tmp/control-eup-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const OWNER='11111111-1111-4111-8111-111111111111', ORG='11111111-1111-4111-8111-222222222222';
const results=[];
function check(scope,name,condition,detail){results.push({scope,name,pass:!!condition});console.log((condition?'PASS ':'FAIL ')+'['+scope+'] '+name+(condition?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','cache-control':'private, no-store'},body:JSON.stringify(body)});
const PROV={source_id:'ct-sots',source_record_id:'r1',url:'https://portal.ct.gov/x',observed_at:'2026-11-01T00:00:00Z',fetched_at:'2026-11-09T12:00:00Z',upstream_updated_at:'2026-11-02T00:00:00Z',parser_version:'v1',review_state:'reviewed',coverage:'partial'};
const EUP={
  '/v1/eup':{ok:true,sections:['overview','league','civic','companies','sources']},
  '/v1/eup/overview':{ok:true,modules:[{id:'league',label:'Environmental Justice League',state:'draft',detail:'one campaign draft',policy_module:'league',policy:{installed:false,state:null,revision:null,updated_at:null}},{id:'civic',label:'Civic League',state:'planned',policy_module:'intake',policy:{installed:false,state:null,revision:null,updated_at:null}},{id:'sources',label:'Sources & Review',state:'planned',policy_module:'intake',policy:{installed:false,state:null,revision:null,updated_at:null}},{id:'consumer_environment',label:'Consumer environment globe',state:'held',policy_module:'environment',policy:{installed:false,state:null,revision:null,updated_at:null}},{id:'arcade',label:'City Arcade cloud',state:'dormant',policy_module:null,policy:null}],module_policy:{status:'available',reason:null},geography:{selected:null},campaigns:{drafts:1,released:0},queues:{applications:0,proofs:0,reviews:null},freshness:[{id:'league',label:'League intake',state:'current',updated_at:'2026-11-09T12:00:00Z'}],blockers:[{id:'league_schema',text:'Apply supabase/pending/eup_league_v1.sql before League intake works.',gate:'schema'}]},
  '/v1/eup/league/campaigns':{ok:true,campaigns:[{id:'c1',title:'Environmental Justice League',state:'draft',revision:1,missions:[{id:'m1',title:'Write a song for a healthier world',state:'draft'}]}]},
  '/v1/eup/league/applications':{ok:true,applications:[]},
  '/v1/eup/league/proofs':{ok:true,proofs:[]},
  '/v1/eup/sources':{ok:true,sources:[{id:'sec',label:'SEC companyfacts',provider:'sec.gov',configured:false,access:'not_reviewed',availability:'unavailable',last_attempt_at:null,last_success_at:null,records:null,unresolved:null,next_run_at:null,quota_reset_at:null,url:'https://www.sec.gov/',rights:'public domain'}]},
  '/v1/eup/sources/review':{ok:true,items:[]},
  '/v1/eup/civic/jurisdictions?parent=none':{ok:true,jurisdictions:[{id:'us-ct',name:'Connecticut',kind:'state',provenance:PROV}]}
};
/* The three module routes, in memory. It follows the answers workers/mccluster/src/eup/modules.js documents
   (install creates disabled at revision 0; a state command needs the current revision; enabled → disabled is
   drain_required; a replayed key returns its receipt). A fixture: not the Worker and not the SQL. */
const UNITS=['environment','league','intake'];
function policyRead(P){return {ok:true,installationId:'mccluster',modules:UNITS.map(id=>{const r=P.rows[id];if(!r)return {moduleId:id,installed:false,state:null,revision:null,updated_at:null,updated_by:null,last_command:null};const c=P.commands.find(x=>x.module_id===id)||null;return {moduleId:id,installed:true,state:r.state,revision:r.revision,updated_at:r.updated_at,updated_by:OWNER,last_command:c};}),commands:P.commands};}
function policyApply(P,id,verb,body){
  const refuse=(status,reason)=>({status,body:{ok:false,error:'fixture refusal',reason}});
  if(!UNITS.includes(id))return refuse(404,'unknown_module');
  if(typeof body?.idempotency_key!=='string')return refuse(400,'idempotency_key_required');
  if(typeof body.reason!=='string'||!body.reason.trim()||/[\u0000-\u001f\u007f]/.test(body.reason))return refuse(422,'reason_required');
  const prior=P.commands.find(c=>c.idempotency_key===body.idempotency_key);
  if(prior)return {status:200,body:{ok:true,receipt:prior.receipt}};
  const at=new Date(Date.UTC(2026,10,9,12,0,P.commands.length)).toISOString(),row=P.rows[id];let receipt;
  if(verb==='install'){
    if(row)return refuse(409,'module_already_installed');
    P.rows[id]={state:'disabled',revision:0,updated_at:at};
    receipt={policy:{schema:'equity-uprise.module-policy/v1',installationId:'mccluster',moduleId:id,state:'disabled',revision:0},changed:true,prior:null,recorded_at:at};
  }else{
    if(!row)return refuse(404,'module_not_installed');
    if(!['enabled','draining','disabled'].includes(body.state))return refuse(422,'invalid');
    if(!Number.isSafeInteger(body.expected_revision))return refuse(400,'expected_revision_required');
    if(row.revision!==body.expected_revision)return refuse(409,'revision_conflict');
    if(row.state==='enabled'&&body.state==='disabled')return refuse(409,'drain_required');
    const before={state:row.state,revision:row.revision},changed=row.state!==body.state;
    if(changed){row.state=body.state;row.revision+=1;row.updated_at=at;}
    receipt={policy:{schema:'equity-uprise.module-policy/v1',installationId:'mccluster',moduleId:id,state:row.state,revision:row.revision},changed,prior:before,recorded_at:at};
  }
  P.commands.unshift({seq:P.commands.length+1,module_id:id,command:verb==='install'?'install':'set_state',requested_state:verb==='install'?'disabled':body.state,expected_revision:verb==='install'?null:body.expected_revision,reason:body.reason.trim(),actor:OWNER,prior_state:null,prior_revision:null,idempotency_key:body.idempotency_key,receipt,created_at:at});
  return {status:200,body:{ok:true,receipt}};
}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});

async function setup(viewport,{owner=true,reduced=false}={}){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true,serviceWorkers:'block',reducedMotion:reduced?'reduce':'no-preference'});
  const db={mode:'owner',posts:[],hang:false,policy:{rows:{},commands:[]},policyPosts:[],policyFail:null},errors=[];
  await ctx.addInitScript(({OWNER})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:OWNER,email:'owner@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:OWNER,email:'owner@fixture.invalid'}}));
  },{OWNER});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,key=p+(u.search||'');
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.origin==='https://api.mccluster.org'){
      if(p.startsWith('/v1/eup')){
        if(db.mode==='denied'||!owner)return json(route,{ok:false,error:'McCluster house owner access required',reason:'owner_required'},403);
        const pm=/^\/v1\/eup\/modules(?:\/([a-z_]+)\/([a-z]+))?$/.exec(p);
        if(pm&&req.method()==='GET'&&!pm[1])return json(route,policyRead(db.policy));
        if(pm&&req.method()==='POST'&&pm[1]){
          const body=req.postDataJSON();db.policyPosts.push({path:p,body});
          if(db.policyFail){const f=db.policyFail;db.policyFail=null;return json(route,{ok:false,error:'fixture refusal',reason:f.reason},f.status);}
          const r=policyApply(db.policy,pm[1],pm[2]==='install'?'install':'state',body);return json(route,r.body,r.status);
        }
        if(req.method()==='POST'){db.posts.push({path:p,body:req.postDataJSON()});if(db.hang)return new Promise(()=>{});return json(route,{ok:true,state:'queued'});}
        if(EUP[key])return json(route,EUP[key]);
        if(EUP[p])return json(route,EUP[p]);
        const section=p.split('/')[3];
        return json(route,{ok:false,error:'E=Up '+section+' is not implemented yet',reason:'not_implemented'},503);
      }
      if(p==='/v1/status')return json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}});
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:OWNER},default_org_id:ORG,workspaces:[{org_id:ORG,slug:'mccluster',kind:'studio',role:'owner',enabled:true,name:'McCluster'}]});
      if(p==='/v1/mnet/bootstrap')return json(route,{identity:{mccluster_id:'matthew'},profile:{display_name:'Matthew McCluster',avatar_url:''}});
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/user')return json(route,{id:OWNER,email:'owner@fixture.invalid'});
      return json(route,[]);
    }
    if(u.origin===BASE){
      const rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));const file=resolve(SERVE,rel);
      if(!file.startsWith(SERVE+sep))return route.abort();
      try{return route.fulfill({body:await readFile(file),contentType:TYPES[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort(); /* Cesium CDN included: the globe reports it did not load; cards still work */
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page,db,errors};
}
const pane=page=>page.locator('[data-eup-pane]');
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const unitState=(page,id,st)=>page.waitForFunction(([id,st])=>document.querySelector('[data-eup-policy="'+id+'"]')?.getAttribute('data-eup-policy-state')===id+':'+st&&!document.querySelector('[data-eup-policy-outcome$=":pending"]')&&!/reading again/.test(document.querySelector('[data-eup-policy-read]')?.textContent||''),[id,st]);
const focusIs=(page,sel)=>page.evaluate(sel=>!!document.activeElement&&document.activeElement.matches(sel),sel);
const commandsOf=(page,id)=>page.evaluate(id=>[...document.querySelectorAll('[data-eup-policy="'+id+'"] [data-eup-policy-command]')].map(b=>b.textContent.trim()),id);
/* a command sent with the keyboard only: the reason field is typed into, Tab reaches the button, Enter presses it */
async function byKeyboard(page,id,verb,reason,tabs=1){
  await page.locator('[data-eup-policy-reason="'+id+'"]').focus();
  await page.keyboard.press('Control+A'); /* a reason kept from a refused command is replaced, not appended to */
  await page.keyboard.type(reason);
  for(let i=0;i<tabs;i+=1)await page.keyboard.press('Tab');
  const on=await focusIs(page,'[data-eup-policy-command="'+id+':'+verb+'"]');
  await page.keyboard.press('Enter');
  return on;
}
/* Overview › Modules: the owner controls, at this width */
async function policyProof(page,db,width){
  await page.locator('[data-eup-policy="environment"]').waitFor();
  await unitState(page,'intake','not_installed');
  check(width,'policy: three units, each offering Install only',JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('[data-eup-policy-command]')].map(b=>b.getAttribute('data-eup-policy-command'))))===JSON.stringify(['environment:install','league:install','intake:install']));
  check(width,'policy: release posture and policy are two chips on a governed module',await page.evaluate(()=>{const li=document.querySelector('[data-eup-module="league"]');return !!li.querySelector('[data-eup-posture="draft"]')&&!!li.querySelector('[data-eup-policy-chip="not_installed"]');}));
  check(width,'policy: the environment unit says what enabling does',/The consumer E=Up tab answers nothing until this unit is installed and enabled\./.test(await page.locator('[data-eup-policy="environment"]').innerText()));
  check(width,'policy: no horizontal overflow with the controls open',await overflow(page));
  const sizes=await page.evaluate(()=>{const box=e=>e.getBoundingClientRect();
    const buttons=[...document.querySelectorAll('[data-eup-policy-command],[data-eup-policy-reload]')].map(b=>({h:box(b).height,w:box(b).width,font:parseFloat(getComputedStyle(b).fontSize)}));
    const inputs=[...document.querySelectorAll('[data-eup-policy-reason]')].map(i=>({h:box(i).height,w:box(i).width,font:parseFloat(getComputedStyle(i).fontSize),labelled:!!i.labels&&i.labels.length===1}));
    const units=[...document.querySelectorAll('[data-eup-policy]')].map(u=>({top:Math.round(box(u).top),left:Math.round(box(u).left),inner:u.clientWidth-parseFloat(getComputedStyle(u).paddingLeft)-parseFloat(getComputedStyle(u).paddingRight)}));
    return {buttons,inputs,units};});
  check(width,'policy: every button is at least 44px tall',sizes.buttons.length===4&&sizes.buttons.every(b=>b.h>=44),sizes.buttons);
  check(width,'policy: every reason field is labelled, at least 44px tall and at least 16px type',sizes.inputs.length===3&&sizes.inputs.every(i=>i.h>=44&&i.font>=16&&i.labelled),sizes.inputs);
  if(width<720){
    check(width,'policy: one column, full-width buttons at phone width',sizes.units.every((u,i)=>u.left===sizes.units[0].left&&(i===0||u.top>sizes.units[i-1].top))&&sizes.buttons.slice(0,3).every((b,i)=>Math.abs(b.w-sizes.units[i].inner)<=1),sizes);
  }else check(width,'policy: the three units sit side by side with room',sizes.units.every(u=>u.top===sizes.units[0].top)&&new Set(sizes.units.map(u=>u.left)).size===3,sizes.units);
  /* keyboard: from the selected tab, Tab alone reaches the first reason field */
  await page.locator('[data-eup-tab="overview"]').focus();
  let reached=false;for(let i=0;i<40&&!reached;i+=1){await page.keyboard.press('Tab');reached=await focusIs(page,'[data-eup-policy-reason="environment"]');}
  check(width,'policy: Tab from the selected tab reaches the first reason field',reached);
  await page.keyboard.press('Tab');
  check(width,'policy: the next Tab stop is that unit\'s command',await focusIs(page,'[data-eup-policy-command="environment:install"]'));
  await page.keyboard.press('Enter');
  await page.locator('[data-eup-policy-outcome="environment:error"]').waitFor();
  check(width,'policy: a command without a reason sends nothing and returns focus to the reason field',db.policyPosts.length===0&&await focusIs(page,'[data-eup-policy-reason="environment"]'));
  const longReason='tester-phase-install-'+'x'.repeat(140);
  check(width,'policy: Install by keyboard',await byKeyboard(page,'environment','install',longReason));
  await unitState(page,'environment','disabled');
  check(width,'policy: install posts a key and a reason only, then reads back disabled at rev 0',db.policyPosts.length===1&&db.policyPosts[0].path==='/v1/eup/modules/environment/install'&&JSON.stringify(Object.keys(db.policyPosts[0].body).sort())==='["idempotency_key","reason"]'&&UUID.test(db.policyPosts[0].body.idempotency_key)&&await page.locator('[data-eup-policy-rev="environment:0"]').count()===1,db.policyPosts);
  check(width,'policy: disabled offers Enable only',JSON.stringify(await commandsOf(page,'environment'))==='["Enable"]');
  check(width,'policy: focus stays inside the unit after its button changed',await page.evaluate(()=>!!document.activeElement&&!!document.activeElement.closest('[data-eup-policy="environment"]')));
  check(width,'policy: the last command shows its reason and time',/Last command: install \(created disabled\) · reason: tester-phase-install-x+ · /.test(await page.locator('[data-eup-policy-last="environment"]').innerText()));
  check(width,'policy: no horizontal overflow with a long unbroken reason recorded',await overflow(page));
  check(width,'policy: Enable by keyboard',await byKeyboard(page,'environment','enabled','open the tab to testers'));
  await unitState(page,'environment','enabled');
  check(width,'policy: enable carries the revision that was read and a new key',db.policyPosts[1].path==='/v1/eup/modules/environment/state'&&db.policyPosts[1].body.state==='enabled'&&db.policyPosts[1].body.expected_revision===0&&db.policyPosts[1].body.idempotency_key!==db.policyPosts[0].body.idempotency_key,db.policyPosts[1]);
  check(width,'policy: enabled offers Drain only',JSON.stringify(await commandsOf(page,'environment'))==='["Drain"]');
  check(width,'policy: Drain by keyboard',await byKeyboard(page,'environment','draining','stop new writes'));
  await unitState(page,'environment','draining');
  check(width,'policy: draining offers Disable and Re-enable and says what draining means',JSON.stringify(await commandsOf(page,'environment'))==='["Disable","Re-enable"]'&&await page.locator('[data-eup-policy-meaning="environment:draining"]').count()===1&&db.policyPosts[2].body.expected_revision===1);
  check(width,'policy: no horizontal overflow while draining',await overflow(page));
  /* an unknown outcome: the Worker answers 503 storage_unavailable; nothing is resent until the owner asks */
  db.policyFail={status:503,reason:'storage_unavailable'};
  check(width,'policy: Re-enable is the second Tab stop after the reason field',await byKeyboard(page,'environment','enabled','back on',2));
  await page.locator('[data-eup-policy-resend="environment"]').waitFor();
  const unknownText=await page.locator('[data-eup-policy-outcome="environment:unknown"]').innerText();
  check(width,'policy: a 503 is an unknown outcome, not resent, with the key looked up in the read-back',db.policyPosts.length===4&&/outcome is unknown and it was not resent\. Its key is not in the command log/.test(unknownText),unknownText);
  check(width,'policy: the state shown is still what was read',await page.evaluate(()=>document.querySelector('[data-eup-policy="environment"]').getAttribute('data-eup-policy-state'))==='environment:draining');
  check(width,'policy: no horizontal overflow with the unknown outcome and the resend open',await overflow(page));
  check(width,'policy: the resend button is at least 44px tall',await page.evaluate(()=>document.querySelector('[data-eup-policy-resend="environment"]').getBoundingClientRect().height>=44));
  await page.locator('[data-eup-policy-resend="environment"]').focus();
  await page.keyboard.press('Enter');
  await unitState(page,'environment','enabled');
  check(width,'policy: the resend carries the same key and the same body',db.policyPosts.length===5&&JSON.stringify(db.policyPosts[4].body)===JSON.stringify(db.policyPosts[3].body)&&db.policy.commands.filter(c=>c.idempotency_key===db.policyPosts[3].body.idempotency_key).length===1,db.policyPosts.slice(3));
  /* revision_conflict: the League is installed here, then changed elsewhere before this page sends Enable */
  check(width,'policy: Install League by keyboard',await byKeyboard(page,'league','install','install the League'));
  await unitState(page,'league','disabled');
  db.policy.rows.league={state:'enabled',revision:1,updated_at:'2026-11-09T12:30:00.000Z'};
  await byKeyboard(page,'league','enabled','open the League');
  await page.locator('[data-eup-policy-outcome="league:conflict"]').waitFor();
  await unitState(page,'league','enabled');
  check(width,'policy: revision_conflict says it changed elsewhere and reloads the state',/changed elsewhere since it was read\. This command changed nothing/.test(await page.locator('[data-eup-policy-outcome="league:conflict"]').innerText())&&JSON.stringify(await commandsOf(page,'league'))==='["Drain"]'&&await page.locator('[data-eup-policy-rev="league:1"]').count()===1&&await page.locator('[data-eup-policy-resend="league"]').count()===0);
  /* drain_busy: nothing changed, the same key may be sent again */
  db.policyFail={status:503,reason:'drain_busy'};
  await byKeyboard(page,'league','draining','drain the League');
  await page.locator('[data-eup-policy-outcome="league:busy"]').waitFor();
  await page.locator('[data-eup-policy-resend="league"]').waitFor();
  check(width,'policy: drain_busy says writes are still in flight and nothing changed',/writes are still in flight; nothing changed/.test(await page.locator('[data-eup-policy-outcome="league:busy"]').innerText())&&await page.evaluate(()=>document.querySelector('[data-eup-policy="league"]').getAttribute('data-eup-policy-state'))==='league:enabled');
  check(width,'policy: no horizontal overflow with every unit in a different state',await overflow(page));
  check(width,'policy: the page did not scroll sideways',await page.evaluate(()=>window.scrollX===0));
  check(width,'policy: a reason is kept after a refusal and each command sent the reason that was typed',await page.locator('[data-eup-policy-reason="league"]').inputValue()==='drain the League'&&JSON.stringify(db.policyPosts.map(p=>p.body.reason))===JSON.stringify([longReason,'open the tab to testers','stop new writes','back on','back on','install the League','open the League','drain the League']),db.policyPosts.map(p=>p.body.reason));
  await page.locator('[data-eup-modules]').screenshot({path:join(OUT,'eup-policy-'+width+'.png')});
  await page.locator('[data-eup-policy="league"]').evaluate(e=>e.scrollIntoView({block:'start'}));
  await page.screenshot({path:join(OUT,'eup-policy-units-'+width+'.png')});
  check(width,'policy: still no horizontal overflow after scrolling to the units',await overflow(page));
}

/* ================================================================ League tab over the in-process plane */
/* A synthetic WAV (a 440 Hz tone, 8 kHz, 8-bit mono): playable bytes that describe no recording. */
function wav(seconds){
  const rate=8000,n=Math.round(seconds*rate),b=Buffer.alloc(44+n);
  b.write('RIFF',0);b.writeUInt32LE(36+n,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(rate,24);b.writeUInt32LE(rate,28);b.writeUInt16LE(1,32);b.writeUInt16LE(8,34);b.write('data',36);b.writeUInt32LE(n,40);
  for(let i=0;i<n;i+=1)b[44+i]=128+Math.round(60*Math.sin(2*Math.PI*440*i/rate));
  return new Uint8Array(b);
}
async function setupPlane(viewport,plane){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const errors=[],consoleText=[];
  await ctx.addInitScript(()=>{localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));});
  await ctx.addInitScript(plane.sessionScript('owner'));
  const sub=(h)=>{try{return JSON.parse(Buffer.from(String(h||'').replace(/^Bearer\s+/i,'').split('.')[1],'base64').toString('utf8'));}catch{return null;}};
  /* the test's own route, registered FIRST: static files and the shell's other calls; the plane's route (attached
     after it) wins for /v1/eup* on the API origin and for the storage origin */
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.origin==='https://api.mccluster.org'){
      const who=sub(req.headers().authorization);
      if(p==='/v1/status')return json(route,{ok:true,operator:{email:who?.email||'owner@plane.invalid'},database:{reachable:true}});
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:who?.sub},default_org_id:ORG,workspaces:[{org_id:ORG,slug:'mccluster',kind:'studio',role:'owner',enabled:true,name:'McCluster'}]});
      if(p==='/v1/mnet/bootstrap')return json(route,{identity:{mccluster_id:'matthew'},profile:{display_name:'Plane owner',avatar_url:''}});
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/user'){const who=sub(req.headers().authorization);return who?json(route,{id:who.sub,email:who.email}):json(route,{msg:'invalid'},401);}
      return json(route,[]);
    }
    if(u.origin===BASE){
      const rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));const file=resolve(SERVE,rel);
      if(!file.startsWith(SERVE+sep))return route.abort();
      try{return route.fulfill({body:await readFile(file),contentType:TYPES[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
  });
  await plane.attach(ctx);
  const page=await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>consoleText.push(m.text()));
  /* the page clock flows like real time; it is moved forward twice, to expire a 300 s link and a 15 s deadline */
  await page.clock.install();
  return {ctx,page,errors,consoleText};
}
async function leagueProof(width){
  const scope='league '+width;
  if(!process.env.PGLITE_MODULE){check(scope,'PGLITE_MODULE is set: the League proof runs over the in-process plane and is never skipped',false,'PGLITE_MODULE unset');return;}
  const {createLeaguePlane,ACCOUNTS,RIGHTS,PLANE_POLICY}=await import('../test/support/eup-league-plane.mjs');
  const C=await import('../../workers/mccluster/src/eup/league-contract.js');
  const {randomUUID,createHash}=await import('node:crypto');
  const plane=await createLeaguePlane();
  let ctx=null;
  try{
    const s=await setupPlane({width,height:900},plane);ctx=s.ctx;const {page,errors,consoleText}=s;
    const ids=ACCOUNTS,key=(l)=>'e2e-'+l+'-'+randomUUID().slice(0,8),sha=(b)=>createHash('sha256').update(b).digest('hex');
    const M=(r='')=>C.PREFIX.member+(r?'/'+r:''),O=(r='')=>C.PREFIX.owner+(r?'/'+r:'');
    const as=async(who,method,path,body,status=200)=>{const r=await plane.call(who,method,path,body);if(r.status!==status)throw new Error(who+' '+method+' '+path+': '+r.status+' '+JSON.stringify(r.body));return r.body;};
    const field=(form,name)=>page.locator('[data-eup-league-input="'+form+'|'+name+'"]');
    const cmd=(action,id='',arg='')=>page.locator('[data-eup-league-command="'+action+'"][data-eup-league-id="'+id+'"][data-eup-league-arg="'+arg+'"]');
    const ui=(what,id='')=>page.locator('[data-eup-league-do="'+what+'"][data-eup-league-id="'+id+'"]');
    const outcome=(slot,kind)=>page.locator('[data-eup-league-outcome="'+slot+':'+kind+'"]');
    const statusIs=(attr,id,status)=>page.waitForFunction(([a,i,s])=>document.querySelector('['+a+'="'+i+'"]')?.getAttribute('data-eup-league-status')===s,[attr,id,status]);
    /* the League panel says aria-busy="true" until the last read of a load (and any record read) has settled */
    const settled=()=>page.waitForFunction(()=>document.querySelector('[data-eup-league-view]')?.getAttribute('aria-busy')==='false');
    const view=async(id)=>{await page.locator('[data-eup-league-tab="'+id+'"]').click();await page.waitForFunction(id=>document.querySelector('[data-eup-league]')?.getAttribute('data-eup-league')===id,id);await settled();};
    const shot=async(sel,name)=>{await settled();await page.locator(sel).screenshot({path:join(OUT,name+'-'+width+'.png')});};
    const noOverflow=async(what)=>check(scope,'no horizontal overflow ('+what+')',await overflow(page));
    const linksHidden=async(what)=>{const r=await page.evaluate(()=>{const html=document.documentElement.outerHTML,tokens=(html.match(/token=/g)||[]).length;
      const inMedia=[...document.querySelectorAll('audio[src],video[src]')].filter(e=>/token=/.test(e.getAttribute('src'))).length;
      let stored='';try{stored=JSON.stringify(localStorage)+JSON.stringify(sessionStorage);}catch{}
      return {tokens,inMedia,text:/token=|league-plane\.invalid/.test(document.body.innerText),stored:/token=|league-plane\.invalid/.test(stored)};});
      check(scope,'no signed link outside the media element ('+what+')',r.tokens===r.inMedia&&!r.text&&!r.stored,r);};

    /* ---------------- Setup ---------------- */
    await page.goto(BASE+'/control.html#system:eup');
    await page.locator('[data-eup]').waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-eup-policy="league"]')?.getAttribute('data-eup-policy-state')==='league:enabled');
    const globeStamp=await page.evaluate(()=>{const g=document.querySelector('[data-eup-globe]');g.__s=Math.random();return g.__s;});
    await page.locator('[data-eup-tab="league"]').click();
    await page.locator('[data-eup-league-policy-revision="0"]').waitFor();
    check(scope,'the League tab reads the module state from the Overview read: enabled',await page.locator('[data-eup-league-module="enabled"]').count()===1);
    const empty=await page.evaluate(()=>[...document.querySelectorAll('[data-eup-league-input^="policy|"]')].filter(e=>e.type!=='checkbox').every(e=>e.value==='')&&[...document.querySelectorAll('[data-eup-league-input^="policy|"]')].filter(e=>e.type==='checkbox').every(e=>!e.checked));
    check(scope,'setup: with no stored policy every policy field starts empty (nothing ships a default)',empty);
    const P=PLANE_POLICY,pf='policy';
    await field(pf,'entitlement').selectOption(P.entitlement);
    await field(pf,'media_enabled').check();await field(pf,'kind_audio').check();await field(pf,'kind_video').check();
    await field(pf,'audio_max_bytes').fill(String(P.media.audio_max_bytes));await field(pf,'video_max_bytes').fill(String(P.media.video_max_bytes));
    await field(pf,'max_duration_seconds').fill(String(P.media.max_duration_seconds));
    await field(pf,'completed_days').fill(String(P.retention.completed_days));await field(pf,'withdrawn_days').fill(String(P.retention.withdrawn_days));
    for(const n of ['participation','private_review','publication']){await field(pf,n+'_revision').fill(P.notices[n].revision);await field(pf,n+'_text').fill(P.notices[n].text);}
    await field(pf,'reason').fill('E2E: the synthetic test-fixture League policy.');
    await cmd('policy.set').click();
    await page.locator('[data-eup-league-policy-revision="1"]').waitFor();
    const stored=(await as('owner','GET',O('policy'))).policy;
    check(scope,'setup: the policy typed into the page is stored exactly, valid, revision 1',stored.revision===1&&stored.valid===true&&isDeepStrictEqual(stored.document,JSON.parse(JSON.stringify(P))),stored);
    const policyRpc=plane.rpcLog.filter(r=>r.action==='policy.set');
    check(scope,'setup: the policy command reached the store once, with a uuid key',policyRpc.length===1&&/^[0-9a-f-]{36}$/.test(policyRpc[0].key||'')&&policyRpc[0].status===200,policyRpc);
    await cmd('campaigns.create').click();
    const campaignId=await (await page.waitForSelector('[data-eup-league-campaign]')).getAttribute('data-eup-league-campaign');
    await statusIs('data-eup-league-campaign',campaignId,'draft');
    await cmd('missions.create',campaignId).click();
    const missionId=await (await page.waitForSelector('[data-eup-league-mission]')).getAttribute('data-eup-league-mission');
    check(scope,'setup: the song mission is created from the fixture as a draft',await page.locator('[data-eup-league-mission="'+missionId+'"] h5').innerText()==='Write a song for a healthier world');
    check(scope,'setup: a mission of a draft campaign is not offered for release, and the page says why',await cmd('missions.transition',missionId,'released').count()===0&&/Release the campaign first/.test(await page.locator('[data-eup-league-blocked="'+missionId+'"]').innerText()));
    await ui('edit',missionId).click();
    const mf='mission:'+missionId;
    await field(mf,'capacity').fill('1');
    await field(mf,'rubric_application').fill('fit: Says what the song is about');
    await field(mf,'rubric_proof').fill('complete: Lyrics, credits and one take');
    await cmd('missions.update',missionId).click();
    await outcome('mission:'+missionId,'done').waitFor();
    let missionRow=(await as('owner','GET',O('missions?campaign='+campaignId))).missions[0];
    check(scope,'setup: capacity and rubric saved; the rubric change starts requirements revision 2',missionRow.capacity===1&&missionRow.requirements_revision===2&&missionRow.document.rubric.proof[0].id==='complete',missionRow);
    await cmd('campaigns.transition',campaignId,'released').click();await statusIs('data-eup-league-campaign',campaignId,'released');
    await cmd('missions.transition',missionId,'released').click();await statusIs('data-eup-league-mission',missionId,'released');
    await cmd('campaigns.audience.set',campaignId,'invited').click();await cmd('campaigns.audience.set',campaignId,'admin_preview').waitFor();
    for(const [who,n] of [['tester',1],['peer',2]]){
      await field('grant:'+campaignId,'account').fill(ids[who]);await field('grant:'+campaignId,'note').fill('E2E test fixture '+who+'.');
      await cmd('audience.grants.grant',campaignId).click();
      await page.waitForFunction(n=>document.querySelectorAll('[data-eup-league-grant][data-eup-league-status="open"]').length===n,n);
    }
    check(scope,'setup: released, invited, two open tester grants',(await as('owner','GET',O('campaigns/'+campaignId+'/audience/grants'))).grants.filter(g=>g.state==='open').length===2);
    await ui('preview',missionId).click();
    await page.locator('[data-eup-league-preview="'+missionId+'"] [data-eup-league-card-field="title"]').waitFor();
    const shown=await page.evaluate(id=>Object.fromEntries([...document.querySelectorAll('[data-eup-league-preview="'+id+'"] [data-eup-league-card-field]')].map(e=>[e.dataset.eupLeagueCardField,JSON.parse(e.dataset.eupLeagueCardValue)])),missionId);
    const memberCard=(await as('tester','GET',M())).league.catalogue[0].missions[0];
    check(scope,'setup: the preview card equals the member read of the tester, field for field',JSON.stringify(Object.keys(shown).sort())===JSON.stringify(Object.keys(memberCard).sort())&&Object.keys(memberCard).every(k=>isDeepStrictEqual(shown[k],memberCard[k])),{shown,memberCard});
    await noOverflow('setup');
    await shot('[data-eup-league-campaign="'+campaignId+'"]','eup-league-setup');
    await page.locator('[data-eup-league-tab="setup"]').focus();await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>document.querySelector('[data-eup-league-tab="applications"]')?.getAttribute('aria-selected')==='true');
    check(scope,'keyboard: ArrowRight moves to the next League view and focuses its tab',await focusIs(page,'[data-eup-league-tab="applications"]'));

    /* ---------------- Applications ---------------- */
    const apply=(who,extra={})=>as(who,'POST',M('missions/'+missionId+'/application'),{idempotency_key:key('apply'),expected_revision:0,application:{submit:true,requirements_revision:2,statement:'E2E test fixture statement of '+who+'.',...extra}}).then(b=>b.application);
    const appT=await apply('tester'),appP=await apply('peer',{accommodation:{statement:'E2E test fixture: I need to take part in writing.'}}),appO=await apply('owner');
    await view('applications');
    await page.waitForFunction(()=>document.querySelectorAll('[data-eup-league-application]').length===3);
    await field('decide:'+appT.id,'decision').selectOption('approved');await field('decide:'+appT.id,'met:fit').check();
    await cmd('applications.decide',appT.id).click();await statusIs('data-eup-league-application',appT.id,'approved');
    check(scope,'applications: approve with the rubric answered offers one assignment',(await as('tester','GET',M())).league.assignments.length===1);
    await field('decide:'+appP.id,'decision').selectOption('approved');await field('decide:'+appP.id,'met:fit').check();
    await cmd('applications.decide',appP.id).click();await outcome('application:'+appP.id,'error').waitFor();
    check(scope,'applications: capacity exhausted is said, and nothing changed',/no seat is free on this mission/.test(await outcome('application:'+appP.id,'error').innerText())&&await page.locator('[data-eup-league-application="'+appP.id+'"]').getAttribute('data-eup-league-status')==='submitted');
    const reads=async()=>(await plane.league.admin('select count(*)::int as n from public.eup_accommodation_reads where application_id = $1',[appP.id]))[0].n;
    check(scope,'applications: the owner row carries a flag, never the accommodation text',!/I need to take part in writing/.test(await page.locator('[data-eup-league-view]').innerText()));
    const before=await reads();
    await ui('accommodation',appP.id).click();
    await page.locator('[data-eup-league-accommodation-text="'+appP.id+'"]').waitFor();
    check(scope,'applications: the restricted accommodation read shows the text and is recorded (evidence read)',/I need to take part in writing/.test(await page.locator('[data-eup-league-accommodation-text="'+appP.id+'"]').innerText())&&await reads()===before+1);
    await field('decide:'+appP.id,'decision').selectOption('changes_requested');await field('decide:'+appP.id,'reason').fill('E2E test fixture: please say more about the song.');
    await cmd('applications.decide',appP.id).click();await statusIs('data-eup-league-application',appP.id,'changes_requested');
    const peerNow=(await as('peer','GET',M())).league.applications.find(a=>a.id===appP.id);
    check(scope,'applications: the applicant reads the request for changes and its reason',peerNow.status==='changes_requested'&&peerNow.decisions.at(-1).reason==='E2E test fixture: please say more about the song.');
    await as('peer','POST',M('missions/'+missionId+'/application'),{idempotency_key:key('resubmit'),expected_revision:peerNow.revision,application:{submit:true,requirements_revision:2,statement:'E2E test fixture: more about the song.'}});
    await view('applications');await statusIs('data-eup-league-application',appP.id,'submitted');
    await field('decide:'+appP.id,'decision').selectOption('declined');await field('decide:'+appP.id,'reason').fill('E2E test fixture: declined.');
    await cmd('applications.decide',appP.id).click();await statusIs('data-eup-league-application',appP.id,'declined');
    await field('decide:'+appO.id,'decision').selectOption('approved');await field('decide:'+appO.id,'met:fit').check();
    await cmd('applications.decide',appO.id).click();await outcome('application:'+appO.id,'error').waitFor();
    check(scope,'applications: self-approval is refused and said; the workspace stays open',/nobody approves, reviews or resolves their own work/.test(await outcome('application:'+appO.id,'error').innerText())&&await page.locator('[data-eup-note="denied"]').count()===0);
    await noOverflow('applications');
    await view('proofs');await view('applications');
    check(scope,'applications: a view switch drops the accommodation text, and nothing reads it again by itself',!/I need to take part in writing/.test(await page.content())&&await reads()===before+1);
    await view('setup');
    await ui('edit',missionId).click();await field(mf,'capacity').fill('5');await cmd('missions.update',missionId).click();await outcome('mission:'+missionId,'done').waitFor();
    const ownDecided=(await as('reviewer','POST',O('applications/'+appO.id+'/decision'),{idempotency_key:key('approve'),expected_revision:appO.revision,decision:'approved',rubric:[{id:'fit',met:true}]})).application;

    /* ---------------- Proofs ---------------- */
    const notices=P.notices;
    const accept=async(who,asg)=>(await as(who,'POST',M('assignments/'+asg.id+'/accept'),{idempotency_key:key('accept'),expected_revision:asg.revision,requirements_revision:2,notice_revision:notices.participation.revision})).assignment;
    const asgT=await accept('tester',(await as('tester','GET',M())).league.assignments[0]);
    const asgO=await accept('owner',ownDecided.assignment);
    const record=async(who,asg,bytes)=>{
      const begun=await as(who,'POST',M('assignments/'+asg.id+'/uploads'),{idempotency_key:key('begin'),upload:{kind:'audio',mime:'audio/wav',bytes:bytes.byteLength,duration_seconds:1}});
      const put=await plane.fetch(begun.grant.url,{method:begun.grant.method,headers:begun.grant.headers,body:bytes});
      if(put.status!==200)throw new Error('storage PUT '+put.status);
      return (await as(who,'POST',M('uploads/'+begun.upload.id+'/complete'),{})).upload;
    };
    const take=wav(0.5),sealed=await record('tester',asgT,take);
    check(scope,'member side: the take is sealed with the digest of exactly its bytes',sealed.state==='sealed'&&sealed.sha256===sha(take));
    const song=(title)=>({title,lyrics:'E2E test fixture line one\nLine two: the river runs clear',credits:[{name:'E2E Fixture Writer',role:'lyrics'}],rights:RIGHTS,media:[{upload_id:sealed.id,sha256:sealed.sha256}],review_notice_revision:notices.private_review.revision});
    const proofT=(await as('tester','POST',M('assignments/'+asgT.id+'/proof'),{idempotency_key:key('proof'),expected_revision:0,proof:song('E2E test fixture: river song')})).proof;
    const proofO=(await as('owner','POST',M('assignments/'+asgO.id+'/proof'),{idempotency_key:key('proof'),expected_revision:0,proof:{title:'E2E test fixture: owner song',lyrics:'E2E test fixture line',credits:[{name:'E2E Fixture Owner',role:'lyrics'}],rights:RIGHTS,accommodation:{statement:'E2E test fixture: the owner writes it.'},review_notice_revision:notices.private_review.revision}})).proof;
    await view('proofs');
    await statusIs('data-eup-league-proof',proofT.id,'submitted:clear:private');
    await ui('review',proofT.id).click();
    const ready=()=>page.waitForFunction(()=>{const a=document.querySelector('[data-eup-league-media]');return !!a&&a.readyState>=1&&isFinite(a.duration);});
    await ready();
    const first=await page.evaluate(()=>{const a=document.querySelector('[data-eup-league-media]');return {src:a.getAttribute('src'),duration:a.duration,tag:a.tagName};});
    const signedReads=plane.log.filter(l=>l.path.startsWith('/storage/v1/object/sign/'+C.MEDIA.bucket+'/')&&(l.status===200||l.status===206));
    check(scope,'proofs: the audio plays in the page from the storage double through the review link',first.tag==='AUDIO'&&Math.abs(first.duration-0.5)<0.05&&new URL(first.src).origin===plane.supabase&&signedReads.length>=1,{first,signedReads:signedReads.length});
    const panel=await page.locator('[data-eup-league-review-panel="'+proofT.id+'"]').innerText();
    check(scope,'proofs: the fingerprint shown is the sealed digest; "not scanned" is said; lyrics, credits and rights are shown',panel.includes(sealed.sha256)&&/Not scanned/.test(panel)&&/the river runs clear/.test(panel)&&/E2E Fixture Writer/.test(panel)&&/Owns the master recording: yes/.test(panel));
    await linksHidden('review open');
    await shot('[data-eup-league-proof="'+proofT.id+'"]','eup-league-review');
    await noOverflow('review open');
    await page.clock.fastForward('05:01');
    await page.locator('[data-eup-league-expired="'+proofT.id+'"]').waitFor();
    check(scope,'proofs: past 300 s the page drops the link and the player',await page.locator('[data-eup-league-media]').count()===0&&!(await page.content()).includes('token='));
    await ui('review',proofT.id).click();
    await ready();
    const second=await page.evaluate(()=>document.querySelector('[data-eup-league-media]').getAttribute('src'));
    check(scope,'proofs: opening the media again signs a new link that plays',second!==first.src&&new URL(second).origin===plane.supabase);
    /* the participant resubmits while revision 1 is open: the review of revision 1 is refused */
    const proofT2=(await as('tester','POST',M('assignments/'+asgT.id+'/proof'),{idempotency_key:key('proof2'),expected_revision:1,proof:song('E2E test fixture: river song, take two')})).proof;
    const rf='review:'+proofT.id;
    for(const d of ['mission','rights','safety'])await field(rf,d).selectOption('pass');
    await field(rf,'met:complete').check();
    await cmd('proofs.review',proofT.id).click();
    await outcome('proof:'+proofT.id,'conflict').waitFor();
    check(scope,'proofs: a stale revision is refused with a conflict message, and the review and its link close',/changed since it was read/.test(await outcome('proof:'+proofT.id,'conflict').innerText())&&await page.locator('[data-eup-league-review-panel]').count()===0&&await page.locator('[data-eup-league-media]').count()===0);
    await page.locator('[data-eup-league-do="review"][data-eup-league-id="'+proofT.id+'"]',{hasText:'revision 2'}).click();
    await ready();
    for(const d of ['mission','rights','safety'])await field(rf,d).selectOption('pass');
    await field(rf,'met:complete').check();
    await cmd('proofs.review',proofT.id).click();
    await statusIs('data-eup-league-proof',proofT.id,'accepted:clear:private');
    const credits=(await as('owner','GET',O('credits?mission='+missionId))).credits;
    check(scope,'proofs: three passes accept revision 2 and write one credit for it',credits.length===1&&credits[0].proof_revision===2&&credits[0].asset_revision===proofT2.asset_revision&&await page.locator('[data-eup-league-credit="'+proofT.id+'"]').count()===1,credits);
    await ui('review',proofO.id).click();
    await page.locator('[data-eup-league-proof-accommodation]').waitFor();
    check(scope,'proofs: the accommodation proof shows its statement and no player',await page.locator('[data-eup-league-media]').count()===0);
    const of='review:'+proofO.id;
    for(const d of ['mission','rights','safety'])await field(of,d).selectOption('pass');
    await field(of,'met:complete').check();
    await cmd('proofs.review',proofO.id).click();
    await outcome('proof:'+proofO.id,'error').waitFor();
    check(scope,'proofs: self-review is refused and said; the workspace stays open',/nobody approves, reviews or resolves their own work/.test(await outcome('proof:'+proofO.id,'error').innerText())&&await page.locator('[data-eup-note="denied"]').count()===0);
    await noOverflow('proofs');

    /* ---------------- Consent and publication ---------------- */
    const current=(await as('owner','GET',O('proofs?assignment='+asgT.id))).proofs[0];
    const consent=(await as('tester','POST',M('proofs/'+proofT.id+'/consent'),{idempotency_key:key('consent'),expected_revision:current.revision,consent:{purpose:'publish_proof',audience:'released_audience',asset_revision:current.asset_revision,notice_revision:notices.publication.revision,expires_at:new Date(Date.now()+30*86400000).toISOString()}})).consent;
    await view('publication');
    await statusIs('data-eup-league-consent',consent.id,'open');
    check(scope,'publication: the page says publication reaches the campaign audience only',/Nothing here is public/.test(await page.locator('[data-eup-league-view]').innerText()));
    await cmd('publications.decide',proofT.id,'published:'+consent.id).click();
    await statusIs('data-eup-league-publication-card',proofT.id,'published_released_audience');
    await shot('[data-eup-league-publication-card="'+proofT.id+'"]','eup-league-publication');
    check(scope,'publication: the invited audience sees it (member read)',(await as('peer','GET',M())).league.published.length===1);
    const refused=plane.faults.add({method:'POST',path:new RegExp('/proofs/'+proofT.id+'/publication$'),mode:'refuse'});
    await field('publication:'+proofT.id,'reason').fill('E2E test fixture: withdrawn by the owner.');
    await cmd('publications.decide',proofT.id,'withdrawn').click();
    await outcome('publication:'+proofT.id,'unknown').waitFor();
    await ui('resend','publication:'+proofT.id).waitFor();
    check(scope,'publication: a refused connection is an unknown outcome settled by the receipt (not recorded), and nothing was resent',refused.hits===1&&/not recorded when its receipt was read/.test(await outcome('publication:'+proofT.id,'unknown').innerText())&&plane.rpcLog.filter(r=>r.action==='publications.decide').length===1);
    await ui('resend','publication:'+proofT.id).click();
    await statusIs('data-eup-league-publication-card',proofT.id,'withdrawn');
    const decides=plane.rpcLog.filter(r=>r.action==='publications.decide');
    check(scope,'publication: the same command sent again by hand is recorded once, with the same key',decides.length===2&&decides[1].status===200&&(await as('peer','GET',M())).league.published.length===0,decides);
    await cmd('publications.decide',proofT.id,'published:'+consent.id).click();
    await statusIs('data-eup-league-publication-card',proofT.id,'published_released_audience');
    await as('tester','POST',M('consents/'+consent.id+'/revoke'),{idempotency_key:key('revoke')});
    await view('publication');
    await statusIs('data-eup-league-consent',consent.id,'revoked');
    check(scope,'publication: a revoked consent is reflected and its publication shows withdrawn (consent revoked)',await page.locator('[data-eup-league-publication][data-eup-league-status="withdrawn:consent_revoked"]').count()===1&&await cmd('publications.decide',proofT.id,'published:'+consent.id).count()===0);
    await noOverflow('publication');

    /* ---------------- Moderation ---------------- */
    await view('proofs');
    await field('moderate:'+proofT.id,'reason').fill('E2E test fixture: hold for a check.');
    await cmd('proofs.moderate',proofT.id,'hold').click();await statusIs('data-eup-league-proof',proofT.id,'accepted:held:withdrawn');
    await field('moderate:'+proofT.id,'reason').fill('E2E test fixture: the check is done.');
    await cmd('proofs.moderate',proofT.id,'release').click();await statusIs('data-eup-league-proof',proofT.id,'accepted:clear:withdrawn');
    check(scope,'moderation: hold and release, each with a reason',true);

    /* ---------------- Appeals: the answer never comes ---------------- */
    const appeal=(await as('peer','POST',M('applications/'+appP.id+'/appeal'),{idempotency_key:key('appeal'),appeal:{statement:'E2E test fixture: please look again.'}})).appeal;
    await view('appeals');
    await statusIs('data-eup-league-appeal',appeal.id,'open');
    await field('resolve:'+appeal.id,'outcome').selectOption('overturned');await field('resolve:'+appeal.id,'reason').fill('E2E test fixture: overturned.');
    const hung=plane.faults.add({method:'POST',path:/\/resolve$/,mode:'hang'});
    await cmd('appeals.resolve',appeal.id).click();
    await outcome('appeal:'+appeal.id,'pending').waitFor();
    await page.clock.fastForward('00:16');
    await outcome('appeal:'+appeal.id,'done').waitFor();
    await statusIs('data-eup-league-appeal',appeal.id,'overturned');
    const resolves=plane.rpcLog.filter(r=>r.action==='appeals.resolve');
    check(scope,'appeals: an answer that never came is found by its receipt, and the command was sent once',hung.hits===1&&resolves.length===1&&/was recorded: its receipt was found by its key/.test(await outcome('appeal:'+appeal.id,'done').innerText()),resolves);
    check(scope,'appeals: overturned returns the declined application to submitted (member read)',(await as('peer','GET',M())).league.applications.find(a=>a.id===appP.id).status==='submitted');
    await noOverflow('appeals');

    /* ---------------- Retention ---------------- */
    const extra=await record('owner',asgO,wav(0.25));
    await as('owner','POST',M('uploads/'+extra.id+'/discard'),{idempotency_key:key('discard')});
    /* clock step (as in the journey test): the upload's staged deadline moves into the past, so it is due */
    await plane.league.admin("update public.eup_media_uploads set expires_at = now() - interval '1 second' where id = $1",[extra.id]);
    await view('retention');
    await statusIs('data-eup-league-due',extra.id,'discarded:discarded');
    await ui('confirm','purge').click();
    await cmd('media.purged','',extra.id).click();
    await outcome('purge','done').waitFor();
    const path=C.mediaObjectPath({tenant:ids.owner,assignment:asgO.id,upload:extra.id,ext:'wav'});
    const row=(await plane.league.admin('select state from public.eup_media_uploads where id = $1',[extra.id]))[0];
    check(scope,'retention: the due upload is purged: its row says purged and no object is stored (evidence reads)',row.state==='purged'&&plane.storage.object(path)===null,row);
    await noOverflow('retention');

    /* ---------------- the whole page ---------------- */
    const sizes=await page.evaluate(()=>{const els=[...document.querySelectorAll('[data-eup-league] button, [data-eup-league] input, [data-eup-league] select, [data-eup-league] textarea')].filter(e=>e.offsetParent!==null);
      return els.map(e=>({h:e.getBoundingClientRect().height,f:parseFloat(getComputedStyle(e).fontSize),t:e.tagName+(e.type?':'+e.type:'')}));});
    check(scope,'every League control is at least 44px tall (checkboxes sit in 44px labels) and every field is at least 16px type',sizes.length>0&&sizes.every(s=>s.t==='INPUT:checkbox'||(s.h>=44&&s.f>=16)),sizes.filter(s=>!(s.t==='INPUT:checkbox'||(s.h>=44&&s.f>=16))));
    await page.locator('[data-eup-tab="overview"]').click();await page.locator('[data-eup-policy="league"]').waitFor();
    await page.locator('[data-eup-tab="league"]').click();await page.locator('[data-eup-league]').waitFor();
    check(scope,'the one globe host is kept across tab switches',await page.evaluate(s=>document.querySelector('[data-eup-globe]').__s===s&&document.querySelector('[data-eup-globe]').dataset.eupGlobeMounts==='1',globeStamp));
    await linksHidden('end');
    check(scope,'no signed link or token in the console',!consoleText.some(t=>/token=|league-plane\.invalid|plane\./.test(t)),consoleText.filter(t=>/token=|plane/.test(t)));
    check(scope,'no page errors',errors.length===0,errors);
    await page.screenshot({path:join(OUT,'eup-league-'+width+'.png'),fullPage:true});
  }catch(e){
    check(scope,'the League proof ran to the end',false,String(e&&e.stack||e).slice(0,1500));
  }finally{
    if(ctx)await ctx.close().catch(()=>{});
    await plane.close();
  }
}

try{
 for(const width of [390,1440]){
  const {page,ctx,db,errors}=await setup({width,height:900});
  await page.goto(BASE+'/control.html#products:eup');
  await page.locator('[data-eup]').waitFor();
  check(width,'#products:eup lands on the System › E=Up leaf',await page.evaluate(()=>location.hash)==='#system:eup');
  await page.waitForFunction(()=>/Apply supabase\/pending\/eup_league_v1\.sql/.test(document.querySelector('[data-eup-pane]')?.textContent||''));
  const text=await pane(page).innerText();
  check(width,'overview shows modules, drafts, unknown counts and blockers',/Environmental Justice League/.test(text)&&/Drafts: 1/.test(text)&&/Reviews: unknown/.test(text)&&/gate: schema/.test(text));
  check(width,'freshness chip from the Worker row shape',await page.locator('[data-eup-fresh="current"]').count()===1);
  check(width,'no horizontal overflow (overview)',await overflow(page));
  await policyProof(page,db,width);
  const globeId=await page.evaluate(()=>{const g=document.querySelector('[data-eup-globe]');g.__eupStamp=g.__eupStamp||Math.random();return g.__eupStamp;});
  for(const [id,expect] of [['league',/Write a song for a healthier world/],['civic',/Connecticut/],['companies',/Search to list companies/],['sources',/SEC companyfacts/]]){
    await page.locator('[data-eup-tab="'+id+'"]').click();
    await page.waitForFunction(([re])=>new RegExp(re).test(document.querySelector('[data-eup-pane]')?.textContent||''),[expect.source]);
    check(width,'tab '+id+' renders its pane',true);
    check(width,'tab '+id+' keeps the one globe host',await page.evaluate(s=>document.querySelector('[data-eup-globe]')?.__eupStamp===s&&document.querySelector('[data-eup-globe]').dataset.eupGlobeMounts==='1',globeId));
    check(width,'tab '+id+' aria-selected and panel label',await page.evaluate(id=>document.querySelector('[data-eup-tab="'+id+'"]').getAttribute('aria-selected')==='true'&&document.getElementById('eupPane').getAttribute('aria-labelledby')==='eupTab-'+id,id));
    check(width,'no horizontal overflow ('+id+')',await overflow(page));
  }
  const civicText=await (async()=>{await page.locator('[data-eup-tab="civic"]').click();await page.locator('[data-eup-jurisdiction="us-ct"]').waitFor();await page.locator('[data-eup-jurisdiction="us-ct"]').click();await page.waitForFunction(()=>/not implemented yet/i.test(document.querySelector('[data-eup-pane]')?.textContent||''));return pane(page).innerText();})();
  check(width,'civic breadcrumb follows the chosen jurisdiction and 503 sections say not implemented',/Connecticut/.test(civicText)&&/Not implemented yet/.test(civicText));
  await page.locator('[data-eup-tab="sources"]').click();
  await page.locator('[data-eup-source-action="refresh"]').waitFor();
  await page.locator('[data-eup-source-action="refresh"]').click();
  await page.waitForFunction(()=>/accepted/.test(document.querySelector('[data-eup-pane]')?.textContent||''));
  check(width,'refresh posts an idempotency key and reads back',db.posts.length===1&&/^[0-9a-f-]{36}$/.test(db.posts[0].body.idempotency_key)&&db.posts[0].path==='/v1/eup/sources/sec/refresh');
  await page.locator('[data-eup-tab="sources"]').focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(()=>document.querySelector('[data-eup-tab="companies"]').getAttribute('aria-selected')==='true');
  check(width,'keyboard ArrowLeft moves to the previous tab and focuses it',await page.evaluate(()=>document.activeElement===document.querySelector('[data-eup-tab="companies"]')));
  db.mode='denied';
  await page.locator('[data-eup-tab="overview"]').click();
  await page.waitForFunction(()=>/House owner access required/.test(document.querySelector('[data-eup-pane]')?.textContent||''));
  check(width,'403 renders the denied state and clears the pane',!/Drafts: 1/.test(await pane(page).innerText()));
  await page.evaluate(()=>window.dispatchEvent(new Event('mcc:auth-changed')));
  check(width,'account change conceals E=Up',/Reopen E=Up|Account changed/.test(await pane(page).innerText()));
  check(width,'no script errors',errors.length===0,errors);
  await page.screenshot({path:join(OUT,'eup-'+width+'.png'),fullPage:true});
  await ctx.close();
 }
 {
  const {page,ctx}=await setup({width:390,height:844},{reduced:true});
  await page.goto(BASE+'/control.html#system:eup');await page.locator('[data-eup]').waitFor();
  check('reduced','reduced motion loads the workspace',await page.locator('[data-eup-tabs]').count()===1);
  await ctx.close();
 }
 /* the League tab against the real router over the real pending SQL, one fresh plane per width */
 for(const width of [390,1440])await leagueProof(width);
}finally{await browser.close();}
if(results.some(r=>!r.pass))process.exitCode=1;
console.log(results.filter(r=>r.pass).length+'/'+results.length+' checks passed');
