/* Isolated browser proof against synthetic API fixtures, no production updates. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)), require=createRequire(import.meta.url);
const {chromium}=process.env.PLAYWRIGHT_DIR?createRequire(join(process.env.PLAYWRIGHT_DIR,'x'))('playwright'):require('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined});
const base='https://mccluster.org',api='https://api.mccluster.org',course='/v1/prim3/learning/course-studio';
const owner='11111111-1111-4111-8111-111111111111',org='11111111-1111-4111-8111-222222222222',practice='11111111-1111-4111-8111-333333333333';
const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers,body:JSON.stringify(body)});
const ref=(school,equivalent,credits,status='posted')=>({school,equivalent,credits,status,evidence_date:status==='proposed'?'':'2025-02-03',evidence_type:status==='proposed'?'':'degree_audit'});
const item=(id,label,kind,status,destinations=[],prerequisites=[],goal_ids=[])=>({id,label,kind,status,start:'2026-09-01',end:'2026-11-12',next_action:'Check the study calendar',destinations,prerequisites,goal_ids});
const sample={
 version:1,token:'drop-secret-value',transcript_text:'drop-raw-transcript',
 goals:[{id:'ID-TO-REMAP',label:'Associate degree',school:'Example College',student_id:'drop-student-id'}],
 budget:{amount_usd:600,note:'Only after aid is confirmed'},
 items:[
  {...item('FIRST','Placement examination','exam','passed',[ref('Example College','MAT 110',3),ref('Fictional Institute','ALG 120',4)],[],['ID-TO-REMAP']),study_course_id:practice},
  item('SECOND','Alternative test','exam','passed',[ref('example college','mat 110',3)]),
  item('THIRD','Review lab','course','completed',[ref('Example College','LAB 105',2)]),
  item('FOURTH','Alternate lab','course','completed',[ref('Example College','LAB 105',4)]),
  item('FIFTH','Plan the next term','task','planned',[],['FIRST'],['ID-TO-REMAP']),
  {...item('SIXTH','Exam-backed networking credential','certification','passed'),earned_on:'2025-03-05'},
  {...item('SEVENTH','Lab participation badge','badge','completed'),earned_on:'2025-05-05'},
  item('EIGHTH','Workshop badge','badge','completed'),
  item('NINTH','Credential registration','certification','studying'),
  item('TENTH','Credential coursework','certification','completed'),
  {...item('ELEVENTH','Archived badge','badge','completed'),earned_on:'2024-11-12'},
 ]
};
async function setup(width,logged=true,hasOwner=true){
  const ctx=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
  const db={revision:0,plan:{version:1,goals:[],items:[]},gets:0,writes:[],denied:!hasOwner},errors=[],practiceRows=[{id:practice,title:'Practice module',completed:1,total:3,state:'ready'}];
  await ctx.addInitScript(({logged,owner})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(logged){const exp=Math.floor(Date.now()/1000)+3600,user={id:owner,email:'owner@fixture.invalid'};
      localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:owner,email:user.email})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user}));}
  },{logged,owner});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(u.origin===api){
      if(p===course+'/timeline'){
        assert.match(req.headers().authorization||'',/^Bearer /);
        if(db.denied||!logged)return json(route,{error:'Forbidden'},403);
        if(req.method()==='PUT'){
          const input=req.postDataJSON();db.writes.push(input);
          if(input.expected_revision!==db.revision)return json(route,{error:'conflict'},409);
          db.plan=structuredClone(input.plan);db.revision++;
        }else db.gets++;
        return json(route,{ok:true,revision:db.revision,plan:db.plan,links:[],practice:practiceRows});
      }
      if(p===course||p===course+'/'+practice){
        if(!logged||!hasOwner)return json(route,{error:'Forbidden'},403);
        if(p===course)return json(route,{ok:true,courses:[],readings:[{title:'Fixture reading',url:'https://readings.invalid/algebra'}],cadence:{years:4,exams_per_year:4,badges_per_month:1}});
        return json(route,{ok:true,course:{...practiceRows[0],school:'Example College',course_code:'MAT 110',term:'Sample term'},bundle:{brief:[],sources:[],rounds:[]},answers:[]});
      }
      if(p==='/v1/status')return hasOwner&&logged?json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}}):json(route,{error:'Forbidden'},403);
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:owner},default_org_id:org,workspaces:[{org_id:org,slug:'mccluster',kind:'studio',role:hasOwner?'owner':'viewer',enabled:true,name:'Fixture'}]});
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co'))return p==='/auth/v1/user'&&logged?json(route,{id:owner,email:'owner@fixture.invalid'}):json(route,[]);
    if(u.origin===base||u.origin==='https://matthew.mccluster.org'){
      const file=resolve(root,'.'+decodeURIComponent(p));if(!file.startsWith(resolve(root)+sep))return route.abort();
      try{return await route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
  });
  const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));return {db,ctx,page,errors};
}
const btn=(p,name)=>p.getByRole('button',{name,exact:true});
const text=(p,pattern)=>p.getByText(pattern,{exact:typeof pattern==='string'}).first();
const heading=(p,name)=>p.getByRole('heading',{name,exact:true}).first().waitFor();
const fill=(p,name,value)=>p.getByLabel(name,{exact:true}).fill(value);
const visible=(p,name)=>text(p,name).waitFor();
const choose=(p,name,value)=>p.getByLabel(name,{exact:true}).selectOption(value);
const check=(p,name)=>p.getByRole('checkbox',{name,exact:false}).first().check();
async function fits(p,w,label){
 const width=await p.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
 assert.deepEqual(width,[w,w],label);console.log('PASS',label,width.join('='));
}
async function open(p,first=false){
 if(first){
   await p.goto(base+'/control.html#home:today');
   await p.locator('#mccControlToggle').click();await p.locator('#mccDestinationSearch').fill('Course Studio');
   await p.locator('[data-control-route="#create:course-studio"]').click();
 }
 await btn(p,'Degree timeline').click();await heading(p,'Degree timeline');
}
async function shot(p,name){
 if(!process.env.COURSE_STUDIO_QA_OUT)return;
 await mkdir(process.env.COURSE_STUDIO_QA_OUT,{recursive:true});
 await p.screenshot({path:join(process.env.COURSE_STUDIO_QA_OUT,name+'.png')});
}
try {
 for(const width of [390,1280]){
  const {page:p,ctx,db,errors}=await setup(width);
  await open(p,true);await visible(p,'No goals yet.');await fits(p,width,'Empty timeline');
  await btn(p,'Import plan JSON').click();
  if(width===390)await fill(p,'Paste plan JSON',JSON.stringify(sample));
  else await p.getByLabel('Choose local JSON file',{exact:true}).setInputFiles({name:'synthetic-plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sample))});
  await btn(p,'Preview import').click();await heading(p,'Review import').catch(async e=>{console.error('Import status:',await p.locator('[data-tl-status]').textContent());throw e;});assert.equal(db.writes.length,0);
  await check(p,'I reviewed this preview');assert.equal(await btn(p,'Save imported plan').isEnabled(),false);
  await check(p,'I checked the dated transcript');await btn(p,'Save imported plan').click();await visible(p,'Private timeline saved.');
  assert.equal(db.writes[0].confirm_evidence,true);
  assert.equal(db.plan.items.find(i=>i.label==='Placement examination').study_course_id,undefined);
  const saved=JSON.stringify(db.writes[0].plan);
  for(const forbidden of ['drop-secret','drop-raw','drop-student','ID-TO-REMAP','FIRST',practice])assert.ok(!saved.includes(forbidden),forbidden);
  await visible(p,'3 posted credits · 0 preapproved · 0 proposed');await visible(p,'4 posted credits · 0 preapproved · 0 proposed');
  await visible(p,/Conflicting units excluded for: LAB 105/);await heading(p,'Sep – Dec 2026');
  await fill(p,'Four-year window starts','2025');await btn(p,'Show window').click();
  await visible(p,'Earned in 2025–2028 (self-reported): 1 of 16 certifications · 1 of 48 badges.');
  await visible(p,'Undated, not assigned to a period: 0 certifications · 1 badge.');
  await visible(p,'Earned outside this window: 0 certifications · 1 badge.');
  await text(p,'2025: 1 of 4 certifications · 1 of 12 badges').click();
  await visible(p,'May: 1 of 1 badge target');await visible(p,'March: 0 of 1 badge target');
  await fits(p,width,'Expanded credential cadence');
  await btn(p,'Edit Workshop badge').click();await fill(p,'Actual earned date (optional)','2025-05-06');
  await btn(p,'Save milestone').click();await visible(p,'Earned in 2025–2028 (self-reported): 1 of 16 certifications · 2 of 48 badges.');
  assert.equal(db.plan.items.find(i=>i.label==='Workshop badge').earned_on,'2025-05-06');
  await btn(p,'Edit Placement examination').click();
  assert.equal(await p.getByLabel('Actual earned date (optional)',{exact:true}).isVisible(),false);
  await btn(p,'Cancel').click();
  await btn(p,'By month').click();await heading(p,'September 2026');await fits(p,width,'Populated timeline');
  await shot(p,'synthetic-degree-timeline-'+width);
  await btn(p,'Edit Plan the next term').click();
  await choose(p,'Self-reported progress','studying');await choose(p,'Optional Course Studio practice',practice);
  await fits(p,width,'Milestone editor');
  await btn(p,'Save milestone').click();await visible(p,'Private timeline saved.');assert.equal(db.writes.at(-1).confirm_evidence,undefined);
  await visible(p,/Practice only: Practice module · 1 of 3 rounds complete/);
  await p.reload();await open(p);await visible(p,/Practice only: Practice module · 1 of 3 rounds complete/);
  assert.equal(db.plan.items.find(i=>i.label==='Plan the next term').status,'studying');
  await btn(p,'Edit Plan the next term').click();await fill(p,'Next action','Bring the test score report');
  db.revision++;await btn(p,'Save milestone').click();await visible(p,/A newer plan was saved elsewhere/);
  assert.equal(await p.getByLabel('Next action',{exact:true}).inputValue(),'Bring the test score report');
  await btn(p,'Discard draft and reload latest plan').click();await visible(p,/Practice only: Practice module/);
  await btn(p,'Add goal').click();await fill(p,'Degree, minor or other goal','Writing minor');await fill(p,'Goal school','Example College');
  await btn(p,'Save goal').click();await heading(p,'Writing minor');
  await btn(p,'Add milestone').click();await fill(p,'Milestone name','Writing class');await choose(p,'Type','course');
  await fill(p,'Start date','2026-12-01');await fill(p,'Target date','2027-03-30');
  await btn(p,'Add destination').click();await fill(p,'Destination school','Example College');await fill(p,'Exact course equivalent','ENG 100');
  await fill(p,'Credits (blank if unknown)','3');await choose(p,'Credit status','posted');
  await btn(p,'Save milestone').click();await visible(p,/requires an exact school equivalent and dated evidence/);
  await fill(p,'Evidence date','2025-10-01');await choose(p,'Evidence type','registrar');
  await btn(p,'Save milestone').click();await visible(p,/only after passing or completing/);
  await choose(p,'Self-reported progress','completed');await btn(p,'Save milestone').click();await visible(p,/Confirm the dated school evidence/);
  await check(p,'I checked the dated transcript');await btn(p,'Save milestone').click();await heading(p,'Writing class');
  await visible(p,'6 posted credits · 0 preapproved · 0 proposed');
  assert.equal(db.writes.at(-1).confirm_evidence,true);
  assert.equal(await p.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]).includes('Writing class')),false);
  db.denied=true;await btn(p,'Back to Course Studio').click();await open(p);await visible(p,/Owner access required/);
  assert.equal(await p.getByRole('heading',{name:'Writing class'}).count(),0);
  assert.deepEqual(errors,[]);await ctx.close();
  console.log('PASS',width,'owner route, import guard, school totals, evidence, practice, reload, revision conflict and revocation');
 }
 for(const logged of [false,true]){
  const {page:p,ctx,db}=await setup(390,logged,false);await p.goto(base+'/control.html#create:course-studio');
  if(logged)await visible(p,/Owner access required/);
  else await p.waitForFunction(async()=>document.readyState==='complete'&&window.MCC_SUPA&&!(await window.MCC_SUPA.token())&&!document.querySelector('#cpGate').hidden&&document.querySelector('#crApp').hidden);
  assert.ok(!await btn(p,'Degree timeline').isVisible());assert.equal(db.gets,0);await ctx.close();
  console.log('PASS',logged?'member denied':'signed-out gate');
 }
}finally{await browser.close();}
