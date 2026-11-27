/* Local source + isolated Chromium. Every request intercepted; in-memory API
   fixtures are deliberately synthetic and do NOT prove a deployed owner session or database. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(import.meta.url);
const {chromium}=process.env.PLAYWRIGHT_DIR?createRequire(join(process.env.PLAYWRIGHT_DIR,'x'))('playwright'):require('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined});
const base='https://mccluster.org', api='https://api.mccluster.org', endpoint='/v1/prim3/learning/course-studio';
const owner='11111111-1111-4111-8111-111111111111', org='11111111-1111-4111-8111-222222222222';
const reads=[{title:'Fixture: linear models',url:'https://readings.invalid/linear',topic:'algebra',keywords:['slope'],attribution:'Sample author for this reading',license:'Example public license',license_url:'https://readings.invalid/license'},{title:'Fixture: rate of change',url:'https://readings.invalid/rate',topic:'calculus',keywords:['derivative'],license:'Second sample license',license_url:'http://readings.invalid/unverified'}];
const bundle={sources:reads,brief:[{text:'A line has a constant rate of change.',source:reads[0].url}],rounds:[{prompt:'What is the slope of y = 2x?',choices:['2','4'],source:reads[0].url},{prompt:'What is the slope of y = 4x?',choices:['2','4'],source:reads[1].url}]};
const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers,body:JSON.stringify(body)});
async function setup(width,logged=true,hasOwner=true) {
  const ctx=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1, serviceWorkers:'block',reducedMotion:'reduce'});
  const db={row:null,answers:[],creates:[],calls:[],denied:!hasOwner},errors=[];
  await ctx.addInitScript(({logged,owner})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(logged) {const exp=Math.floor(Date.now()/1000)+3600; const user={id:owner,email:'owner@fixture.invalid'};
      localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:owner,email:user.email})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user})); }
  },{logged,owner});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(u.origin===api){
      if(p.startsWith(endpoint)) {
        db.calls.push(req.method()+' '+p);
        assert.match(req.headers().authorization||'',/^Bearer /);
        if(db.denied||!logged)return json(route,{error:'Forbidden'},403);
        const tail=p.slice(endpoint.length);
        if(!tail&&req.method()==='GET')return json(route,{ok:true,courses:db.row?[db.row]:[],readings:reads,cadence:{years:4,exams_per_year:4,badges_per_month:1}});
        if(!tail&&req.method()==='POST'){
          const b=req.postDataJSON(); db.creates.push(b);
          if(!db.row)db.row={id:'fixture-course',school:b.school,course_code:b.course_code,term:b.term,title:b.title,state:'queued',total:0,completed:0,score:0};
          if(db.creates.length===1)return json(route,{error:'fixture: response lost after save'},503);
          return json(route,{ok:true,id:db.row.id});
        }
        if(tail==='/fixture-course'&&req.method()==='GET')return json(route,{ok:true,course:db.row,bundle:db.row.state==='ready'?bundle:null,answers:db.answers});
        if(tail==='/fixture-course/retry'&&req.method()==='POST'){db.row.state='queued'; return json(route,{ok:true});}
        if(tail==='/fixture-course/answers'&&req.method()==='POST'){
          const {round,choice}=req.postDataJSON(),correct=choice===round;
          db.answers.push({round,choice,correct,explanation:'Compare the coefficient of x with the choices.'});
          db.row.completed++; if(correct)db.row.score++;return json(route,{ok:true});
        }
        return json(route,{error:'unexpected studio route'},404);
      }
      if(p==='/v1/status')return hasOwner&&logged?json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}}):json(route,{error:'Forbidden'},403);
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:owner},default_org_id:org,workspaces:[{org_id:org,slug:'mccluster',kind:'studio',role:hasOwner?'owner':'viewer',enabled:true,name:'Fixture'}]});
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co'))return p==='/auth/v1/user'&&logged?json(route,{id:owner,email:'owner@fixture.invalid'}):json(route,[]);
    if(u.origin===base||u.origin==='https://matthew.mccluster.org'){
      const path=resolve(root,'.'+decodeURIComponent(p)); if(!path.startsWith(resolve(root)+sep))return route.abort();
      try{return await route.fulfill({contentType:types[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
  });
  const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));return {db,page,ctx,errors};
}
const heading=(p,name)=>p.getByRole('heading',{name,exact:true}).waitFor();
const click=(p,name)=>p.getByRole('button',{name,exact:true}).click();
async function fits(page,width,stage) {
  const dims=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  assert.deepEqual(dims,[width,width],stage); console.log('PASS',stage,dims.join('='));
}
async function proof(page,width,stage) {
  if(!process.env.COURSE_STUDIO_QA_OUT)return;
  await mkdir(process.env.COURSE_STUDIO_QA_OUT,{recursive:true});
  await page.screenshot({path:join(process.env.COURSE_STUDIO_QA_OUT,'synthetic-course-studio-'+stage+'-'+width+'.png'),fullPage:true});
}
try {
  for(const width of [390,1280]) {
    const {db,ctx,page,errors}=await setup(width);
    await page.goto(base+'/control.html#home:today');
    await page.locator('#mccControlToggle').click();
    await page.locator('#mccDestinationSearch').fill('Course Studio');
    await page.locator('[data-control-route="#create:course-studio"]').click();
    await heading(page,'Your courses');
    assert.equal(await page.locator('.appbar').count(),1);
    await fits(page,width,'course form');
    await page.getByLabel('School',{exact:true}).fill('Example College');
    await page.getByLabel('Course code',{exact:true}).fill('MTH 101');
    await page.getByLabel('Course title',{exact:true}).fill('Synthetic studio');
    await page.getByLabel('Term (optional)',{exact:true}).fill('Sample term');
    await click(page,'Build study game');
    await page.getByText('Choose a public reading first.').waitFor();
    await click(page,'Suggest readings');await page.getByText(/No reviewed reading matches/).waitFor();
    assert.equal(await page.locator('input[name=source_urls]:checked').count(),0);
    await page.getByLabel('Course title',{exact:true}).fill('Synthetic slope lab');
    await page.getByLabel(reads[1].title,{exact:true}).check();
    await click(page,'Suggest readings');await page.getByText(/Selected by topic/).waitFor();
    assert.equal(await page.locator('input[name=source_urls]:checked').count(),2);
    await proof(page,width,'setup');
    await click(page,'Build study game');
    await page.getByText(/Could not confirm the course was saved/).waitFor();
    await click(page,'Build study game');
    await page.getByText('Queued',{exact:true}).waitFor();
    assert.deepEqual(db.creates[0],db.creates[1]);assert.deepEqual(db.creates[0].source_urls,reads.map(s=>s.url));
    assert.match(db.creates[0].request_id,/^[\da-f-]{36}$/i);
    db.row.state='failed';await click(page,'Check status');
    await click(page,'Retry build');await page.getByText('Queued',{exact:true}).waitFor();
    db.row.state='running';await click(page,'Check status');await page.getByText('Building',{exact:true}).waitFor();
    db.row.state='ready';db.row.total=2;await click(page,'Check status');await heading(page,'Study brief');
    assert.equal(await page.locator('.cs-studio img').count(),0);
    assert.equal(await page.getByRole('link',{name:reads[0].title,exact:true}).first().getAttribute('href'),reads[0].url);
    await page.getByText(reads[0].attribution,{exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:reads[0].license,exact:true}).getAttribute('href'),reads[0].license_url);
    assert.equal(await page.getByRole('link',{name:reads[1].license,exact:true}).count(),0);
    await proof(page,width,'practice');
    await click(page,'2');await heading(page,'Round 1: Correct');
    await page.reload();await heading(page,'Your courses');
    await page.getByRole('button',{name:/Synthetic slope lab/}).click();await heading(page,'Round 1: Correct');
    await click(page,'2');await heading(page,'Round 2: Incorrect');
    await page.getByText('2 of 2 rounds complete · 1 correct',{exact:true}).waitFor();
    assert.equal(await page.getByText(/Practice complete/).isVisible(),true);
    await fits(page,width,'completed game');
    await proof(page,width,'score');
    assert.equal(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]).includes('Synthetic slope lab')),false);
    db.row.title='Synthetic slope lab <em>section A</em>';await click(page,'All courses');
    await page.getByRole('button',{name:/Synthetic slope lab/}).click();
    await heading(page,db.row.title);assert.equal(await page.locator('.cs-studio em').count(),0);
    db.denied=true;await click(page,'All courses');await page.getByText(/Owner access required/).waitFor();
    assert.equal(await page.getByText(/Synthetic slope lab/).count(),0);assert.equal(await page.getByLabel('School',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);await ctx.close();
    console.log('PASS',width,'real Control entry, unknown create outcome, retry, cited brief, rounds, reload, progress, revocation (synthetic API)');
  }
  for (const [logged,ownerRole] of [[false,false],[true,false]]) {
    const {page,ctx,db}=await setup(390,logged,ownerRole);
    await page.goto(base+'/control.html#create:course-studio');
    if(logged){await page.getByText(/Owner access required/).waitFor();assert.ok(db.calls.length>0);}
    else{await page.waitForFunction(async()=>document.readyState==='complete'&&window.MCC_SUPA&&!(await window.MCC_SUPA.token())&&!document.querySelector('#cpGate').hidden&&document.querySelector('#crApp').hidden);assert.equal(db.calls.length,0);}
    assert.equal(await page.getByLabel('School',{exact:true}).isVisible(),false);await ctx.close();
    console.log('PASS',logged?'member':'guest','no studio form');
  }
} finally {await browser.close();}
