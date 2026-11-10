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
   PLAYWRIGHT_DIR=<node_modules> CHROMIUM_EXECUTABLE=<chromium> node scripts/e2e/control-eup.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
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
      const rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));const file=resolve(ROOT,rel);
      if(!file.startsWith(resolve(ROOT)+sep))return route.abort();
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
  check(width,'policy: draining offers Disable and Re-enable and says what draining means',JSON.stringify(await commandsOf(page,'environment'))==='["Disable","Re-enable"]'&&await page.locator('[data-eup-policy-drain="environment"]').count()===1&&db.policyPosts[2].body.expected_revision===1);
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
}finally{await browser.close();}
if(results.some(r=>!r.pass))process.exitCode=1;
console.log(results.filter(r=>r.pass).length+'/'+results.length+' checks passed');
