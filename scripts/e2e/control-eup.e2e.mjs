/* Control › System › E=Up browser proof: real control.html and scripts, every
   remote call intercepted with synthetic fixtures (owner, denied, 503
   not_implemented, timeout). Never touches production. Proves at 390 and 1440:
   the five LOCAL tabs switch without remounting the one globe host, no
   horizontal overflow, keyboard tab movement, a 403 renders the denied state,
   not_implemented sections say so, a source refresh carries an idempotency key.
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
  '/v1/eup/overview':{ok:true,modules:[{id:'league',label:'Environmental Justice League',state:'draft',detail:'one campaign draft'},{id:'civic',label:'Civic League',state:'planned'},{id:'sources',label:'Sources & Review',state:'planned'}],geography:{selected:null},campaigns:{drafts:1,released:0},queues:{applications:0,proofs:0,reviews:null},freshness:[{id:'league',label:'League intake',state:'current',updated_at:'2026-11-09T12:00:00Z'}],blockers:[{id:'league_schema',text:'Apply supabase/pending/eup_league_v1.sql before League intake works.',gate:'schema'}]},
  '/v1/eup/league/campaigns':{ok:true,campaigns:[{id:'c1',title:'Environmental Justice League',state:'draft',revision:1,missions:[{id:'m1',title:'Write a song for a healthier world',state:'draft'}]}]},
  '/v1/eup/league/applications':{ok:true,applications:[]},
  '/v1/eup/league/proofs':{ok:true,proofs:[]},
  '/v1/eup/sources':{ok:true,sources:[{id:'sec',label:'SEC companyfacts',provider:'sec.gov',configured:false,access:'not_reviewed',availability:'unavailable',last_attempt_at:null,last_success_at:null,records:null,unresolved:null,next_run_at:null,quota_reset_at:null,url:'https://www.sec.gov/',rights:'public domain'}]},
  '/v1/eup/sources/review':{ok:true,items:[]},
  '/v1/eup/civic/jurisdictions?parent=none':{ok:true,jurisdictions:[{id:'us-ct',name:'Connecticut',kind:'state',provenance:PROV}]}
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});

async function setup(viewport,{owner=true,reduced=false}={}){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true,serviceWorkers:'block',reducedMotion:reduced?'reduce':'no-preference'});
  const db={mode:'owner',posts:[],hang:false},errors=[];
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
