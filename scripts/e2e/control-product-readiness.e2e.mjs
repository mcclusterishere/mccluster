/* Real Control HTML/scripts; all remote calls intercepted with synthetic fixtures. No production access.
   PLAYWRIGHT_DIR=<node_modules> CHROMIUM_EXECUTABLE=<chromium> node scripts/e2e/control-product-readiness.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/control-front-page-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.mp4':'video/mp4','.mp3':'audio/mpeg'};
const OWNER='11111111-1111-4111-8111-111111111111';
const results=[];
function check(scope,name,condition,detail){results.push({scope,name,pass:!!condition});console.log((condition?'PASS ':'FAIL ')+'['+scope+'] '+name+(condition?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});

async function setup(viewport,{signedIn=true,owner=true,rows=[]}={}){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const db={readiness:[],mode:'locked',collects:[]},errors=[];
  await ctx.addInitScript(({signedIn,OWNER})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(!signedIn)return;
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:OWNER,email:'owner@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:OWNER,email:'owner@fixture.invalid'}}));
  },{signedIn,OWNER});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.origin==='https://api.mccluster.org'){
      if(p==='/v1/owner/product-widgets'){
        db.readiness.push(req.method());
        const base={contract:'mccluster-owner-product-readiness/v1',org_id:'11111111-1111-4111-8111-222222222222',checked_at:new Date().toISOString(),read_only:true};
        if(db.mode==='error')return json(route,{error:'Fixture service unavailable'},503);
        if(req.method()==='GET')return json(route,{...base,apps:[{app_key:'fixture',name:'Fixture product',enabled:true}]});
        const b=req.postDataJSON();
        return json(route,{...base,app_key:'fixture',name:'Fixture product',state:db.mode==='unconfigured'?'unconfigured':'inspected',next:'Registry inspection only.',widgets:db.mode==='unconfigured'?[]:[{widget_id:'summary',state:'locked',allowed:false,preview_plans:['fixture-plan'],...(b.preview_plan?{presentation:{plan_code:'fixture-plan',grants_access:false}}:{})}]});
      }
      if(p==='/v1/collect'){const f=req.frame();db.collects.push((f&&f.parentFrame()?'framed:':'top:')+(f?f.url():''));return json(route,{ok:true});}
      if(p==='/v1/status')return owner&&signedIn?json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}}):json(route,{error:'Forbidden'},403);
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:OWNER},default_org_id:'11111111-1111-4111-8111-222222222222',workspaces:[{org_id:'11111111-1111-4111-8111-222222222222',slug:'mccluster',kind:'studio',role:owner?'owner':'viewer',enabled:true,name:'McCluster'}]});
      /* the owner's own member profile exists, which is what used to turn his M into a member card */
      if(p==='/v1/mnet/bootstrap')return json(route,{identity:{mccluster_id:'matthew'},profile:{display_name:'Matthew McCluster',avatar_url:''}});
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/user')return signedIn?json(route,{id:OWNER,email:'owner@fixture.invalid'}):json(route,{msg:'no session'},401);
      return json(route,[]);
    }
    if(u.origin===BASE){
      const rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));const file=resolve(ROOT,rel);
      if(!file.startsWith(resolve(ROOT)+sep))return route.abort();
      try{return route.fulfill({body:await readFile(file),contentType:TYPES[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page,db,errors};
}

try{
 for(const width of [390,1280]){
  const {page,ctx,db,errors}=await setup({width,height:844});
  await page.goto(BASE+'/control.html#system:apps');
  await page.locator('[data-pwr-inspect]').waitFor();
  await page.locator('[data-pwr-inspect]').click();
  await page.locator('[data-pwr-preview]').waitFor();
  check(width,'actual locked decision visible',(await page.locator('[data-pwr-report]').innerText()).includes('Subscription requirement not met'));
  await page.locator('[data-pwr-preview]').click();
  await page.waitForFunction(()=>document.querySelector('[data-pwr-report]').textContent.includes('Presentation simulation'));
  check(width,'preview never grants access',(await page.locator('[data-pwr-report]').innerText()).includes('actual access remains denied'));
  const download=page.waitForEvent('download');await page.locator('[data-pwr-export]').click();
  check(width,'export works',(await download).suggestedFilename()==='product-readiness.json');
  db.mode='unconfigured';await page.locator('[data-pwr-inspect]').click();
  await page.waitForFunction(()=>document.querySelector('[data-pwr-report]').textContent.includes('Configuration required'));
  check(width,'missing policy truthful',await page.locator('[data-pwr-preview]').count()===0);
  db.mode='error';await page.locator('[data-pwr-refresh]').click();
  await page.waitForFunction(()=>document.querySelector('[data-pwr-status]').textContent.includes('Could not verify'));
  check(width,'error clears stale evidence',await page.locator('[data-pwr-export]').count()===0);
  db.mode='locked';await page.locator('[data-pwr-refresh]').click();await page.locator('[data-pwr-inspect]').waitFor();
  check(width,'retry recovers',true);
  await page.evaluate(()=>window.dispatchEvent(new Event('mcc:auth-changed')));
  check(width,'account change clears registry',await page.locator('[data-pwr-inspect]').count()===0);
  check(width,'no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  check(width,'no script errors',errors.length===0,errors);
  await page.screenshot({path:join(OUT,'readiness-'+width+'.png'),fullPage:true});await ctx.close();
 }
}finally{await browser.close();}
if(results.some(r=>!r.pass))process.exitCode=1;
