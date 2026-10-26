// Real dashboard + Worker/SQL authority; all browser requests are intercepted.
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import assert from 'node:assert/strict';
import {freeSiteFixture,A,B,O} from '../../workers/mccluster/test/support/free-site-fixture.mjs';
import {handleManagedProjects} from '../../workers/mccluster/src/managed-projects.js';
import {handleCanonicalArtists,CANONICAL_ARTISTS} from '../../workers/mccluster/src/canonical-artists.js';
const {chromium}=createRequire(resolve(process.env.PLAYWRIGHT_DIR||'/tmp/first-offer-tools/node_modules','fixture.cjs'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']}),ROOT=process.cwd(),BASE='https://matthew.mccluster.org',OUT=process.argv[2]||'/tmp/canonical-artist-owner-proof';await mkdir(OUT,{recursive:true});
try{for(const width of [390,1440]){
 const f=await freeSiteFixture(),ctx=await browser.newContext({viewport:{width,height:900}}),artist=Object.keys(CANONICAL_ARTISTS)[1];let holdMine=false,releaseMine,posts=[];
 try{
  await f.sql.query("insert into managed_projects(slug,owner_user_id,m_uid,name) values('owner-fixture',$1,$1,'Equity Uprise'),('other-fixture',$2,$2,'Equity Uprise')",[A,B]);
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='api.mccluster.org'){
    const req=route.request(),request=new Request(req.url(),{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postData()});
    const response=await (u.pathname.startsWith('/v1/canonical-artists')?handleCanonicalArtists:handleManagedProjects)(request,f.env,{fetchImpl:f.restFetch});
    if(u.pathname.endsWith('/bind'))posts.push({token:req.headers().authorization,body:req.postDataJSON()});
    if(holdMine&&u.pathname.endsWith('/mine')&&req.headers().authorization==='Bearer fixture-alice'){holdMine=false;await new Promise(r=>releaseMine=r);}
    return route.fulfill({status:response?.status||404,headers:{'content-type':'application/json','access-control-allow-origin':'*'},body:response?await response.text():'{}'});
   }
   if(u.pathname==='/js/mcc-auth.js')return route.fulfill({contentType:'text/javascript',body:"window.fixtureSession={access_token:'fixture-alice'};window.MCC={session:()=>fixtureSession,refreshIfNeeded:()=>window.refreshHold||Promise.resolve(fixtureSession)};"});
   if(['/js/tabbar.js','/js/shell-boot.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   if(u.origin!==BASE)return route.fulfill({body:'{}'});
   try{const path=resolve(ROOT,'.'+u.pathname);assert.ok(path.startsWith(ROOT+'/'));return route.fulfill({body:await readFile(path),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await ctx.newPage();await page.goto(BASE+'/customer-projects.html',{waitUntil:'domcontentloaded'});await page.getByRole('link',{name:'Edit project',exact:true}).waitFor();assert.equal(await page.locator('#artistBindings').count(),0);
  await f.sql.query("select canonical_artist_binding_v1('grant',$1,$2,$3,null,'Synthetic reviewed artist ownership')",[artist,O,A]);
  await page.getByRole('button',{name:'Refresh projects'}).click();await page.locator('#artistBindings').waitFor();
  assert.equal(await page.locator('#artistBindings select option').count(),2);await page.locator('#artistBindings select').selectOption({label:'Equity Uprise'});
  // Account switches during refresh must not submit old selected project using B.
  await page.evaluate(()=>{window.refreshHold=new Promise(r=>window.releaseRefresh=r);});await page.getByRole('button',{name:'Bind artist destination'}).click();
  await page.evaluate(()=>{window.fixtureSession={access_token:'fixture-bob'};window.dispatchEvent(new Event('mcc:auth-changed'));window.releaseRefresh(fixtureSession);window.refreshHold=null;});
  await page.getByRole('link',{name:'Edit project',exact:true}).waitFor();assert.equal(posts.length,0);assert.equal(await page.locator('#artistBindings').count(),0);
  // Delayed A grant reads cannot paint into B's dashboard.
  holdMine=true;await page.evaluate(()=>{window.fixtureSession={access_token:'fixture-alice'};window.dispatchEvent(new Event('mcc:auth-changed'));});
  const deadline=Date.now()+10000;while(!releaseMine&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.ok(releaseMine,'Deferred owner response was reached');
  await page.evaluate(()=>{window.fixtureSession={access_token:'fixture-bob'};window.dispatchEvent(new Event('mcc:auth-changed'));});releaseMine();await page.getByRole('link',{name:'Edit project',exact:true}).waitFor();assert.equal(await page.locator('#artistBindings').count(),0);
  await page.evaluate(()=>{window.fixtureSession={access_token:'fixture-alice'};window.dispatchEvent(new Event('mcc:auth-changed'));});await page.locator('#artistBindings select').waitFor();await page.locator('#artistBindings select').selectOption({label:'Equity Uprise'});await page.getByRole('button',{name:'Bind artist destination'}).click();await page.getByText('Bound to Equity Uprise',{exact:true}).waitFor();
  assert.equal(posts.length,1);assert.equal(posts[0].token,'Bearer fixture-alice');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  await page.screenshot({path:join(OUT,'artist-owner-'+width+'.png'),fullPage:true});console.log('PASS '+width+': real owner grant binding, same-name foreign project excluded, refresh/account-switch mutation fence, stale grant response discarded, no overflow');
 }finally{await ctx.close();await f.close();}
}}finally{await browser.close();}
