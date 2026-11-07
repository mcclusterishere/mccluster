/* Narrow native-transition regression, Chromium only. Actual shared bar/pages;
   delayed external CSS and synthetic auth/API. No live requests or payments.
   Kept free of pagereveal/ready/finished observers: they are not product code. */
import {createRequire} from 'node:module';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, join, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/site-navigation-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const BASE='https://matthew.mccluster.org', USER='11111111-1111-4111-8111-111111111111';
const MIME={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const results=[];
function check(name,ok,detail){results.push({name,pass:!!ok});console.log((ok?'PASS ':'FAIL ')+name+(ok?'':' '+JSON.stringify(detail)));assert.ok(ok,name);}
await mkdir(OUT,{recursive:true});
async function setup(width,persona='owner'){
  const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});
  const auth={status:persona==='owner'?200:403,signed:persona!=='guest',delay:false,release:null},calls=[],errors=[];
  await ctx.addInitScript(({signed,USER})=>{
    window.__navFrames=[];const sample=()=>{const b=document.querySelector('.appbar');if(b){const c=getComputedStyle(b);if(c.visibility==='visible'&&c.display!=='none')window.__navFrames.push(b.querySelectorAll('[data-appnav]').length);}requestAnimationFrame(sample);};requestAnimationFrame(sample);
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(signed){const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({sub:USER,exp,email:'qa@fixture.invalid'}))+'.y',expires_at:exp,refresh_token:'fixture-only',user:{id:USER,email:'qa@fixture.invalid'}}));}
  },{signed:auth.signed,USER});
  const json=(r,body,status=200)=>r.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
  await ctx.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url()),p=u.pathname;
    // Exercise opt-in before the incoming page's external stylesheet arrives.
    if(p==='/css/platform-home.css'&&process.env.DELAY_PLATFORM_CSS)await new Promise(resolve=>setTimeout(resolve,150));
    calls.push({url:u.href,method:req.method()});
    if(req.method()==='OPTIONS')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/token'){
        const exp=Math.floor(Date.now()/1000)+3600;
        return json(r,{access_token:'x.'+Buffer.from(JSON.stringify({sub:USER,exp,email:'qa@fixture.invalid',iat:123})).toString('base64url')+'.y',expires_at:exp,refresh_token:'fixture-only',user:{id:USER,email:'qa@fixture.invalid'}});
      }
      return json(r,p==='/auth/v1/user'?{id:USER,email:'qa@fixture.invalid'}:[]);
    }
    if(u.hostname==='api.mccluster.org'){
      if(p==='/v1/status') {const status=auth.status;if(auth.delay)await new Promise(resolve=>auth.release=resolve);return json(r,{ok:status===200},status);}
      if(p==='/v1/workspaces/me')return json(r,{ok:true,profile:{id:USER},default_org_id:'o1',workspaces:[{org_id:'o1',slug:'mccluster',name:'McCluster',kind:'studio',role:auth.status===200?'owner':'viewer',enabled:true}]});
      if(p==='/v1/mnet/bootstrap')return json(r,{ok:true,profile:{display_name:'QA member',onboarding_complete:true},identity:{mccluster_id:'qa-member'},needs_onboarding:false,stats:{}});
      if(/^\/v1\/mnet\/people\/[^/]+$/.test(p)){
        const handle=decodeURIComponent(p.split('/').at(-1));
        return json(r,{identity:{mccluster_id:handle},
          profile:{display_name:handle==='qa-member'?'QA member':'Other member',bio:'Public introduction',headline:'Member profile'},
          counts:{followers:3,following:1,posts:2}});
      }
      if(p==='/api/drivers/me')return json(r,{driver:null});
      if(p==='/v1/mnet/profile'&&req.method()==='PATCH')return json(r,{ok:true});
      return json(r,{ok:true,threads:[],apps:[],posts:[],events:[],jobs:[],tools:[],decisions:[],missions:[],layers:[],workspaces:[],sources:[],features:[]});
    }
    if(u.hostname==='cesium.com'&&process.env.CESIUM_DIR){const rel=p.split('/Build/Cesium/')[1];if(rel){const path=resolve(process.env.CESIUM_DIR,rel);if(path.startsWith(resolve(process.env.CESIUM_DIR)+sep)){try{return r.fulfill({body:await readFile(path),contentType:MIME[extname(path)]||'application/octet-stream'});}catch{}}}return r.abort();}
    if([BASE,'https://mccluster.org'].includes(u.origin)){
      const path=resolve(ROOT,'.'+(p==='/'?'/mnet.html':decodeURIComponent(p)));
      if(path.startsWith(resolve(ROOT)+sep)){try{return r.fulfill({body:await readFile(path),contentType:MIME[extname(path)]||'application/octet-stream'});}catch{}}
      return r.fulfill({status:404,body:'Fixture: missing file'});
    }
    return r.abort();
  });
  const page=await ctx.newPage();page.on('pageerror',error=>errors.push(error.message));
  return {ctx,page,auth,calls,errors};
}
try{
  const target=await readFile(join(ROOT,'platform-home.html'),'utf8');
  check('native navigation opts in before external CSS', /<style>@view-transition\{navigation:auto\}<\/style>[\s\S]*<link rel="stylesheet"/.test(target));
  /* NO SCREEN FLASHES (owner, 2026-10-20: "just a smooth transition from screen to screen"): a tab asks for the next page at
     once (it used to hold 460ms under the veil first), and the veil into the World is the World's own colour */
  for(let repeat=0;repeat<3;repeat++){
    const {ctx,page,errors}=await setup(390,'guest');await page.goto(BASE+'/license.html');
    await page.waitForFunction(()=>window.MCC_BAR&&window.MCC_BAR.auth().verified);
    await page.evaluate(()=>{navigation.addEventListener('navigate',()=>sessionStorage.setItem('__navDelay',String(Math.round(performance.now()-window.__clickAt))));
      window.__clickAt=performance.now();document.querySelector('.appbar [data-appnav="home"]').click();});
    await page.waitForURL(/\/platform-home\.html$/,{timeout:15000,waitUntil:'domcontentloaded'});
    await page.waitForLoadState('load');
    const delay=Number(await page.evaluate(()=>sessionStorage.getItem('__navDelay')));
    check('a bar tab asks for the next page at once, with no hold before it',Number.isFinite(delay)&&delay<200,delay);
    await page.goto(BASE+'/license.html');
    await page.waitForLoadState('load');
    await page.waitForFunction(()=>window.MCC_BAR&&window.MCC_DAYLIGHT_CORE);
    const veil=await page.evaluate(()=>{const h=document.documentElement;document.querySelector('.appbar [data-appnav="world"]').click();
      return {out:h.classList.contains('pt-out'),day:h.classList.contains('pt-to-day'),night:h.classList.contains('pt-to-night'),want:MCC_DAYLIGHT_CORE.estimate(new Date()),house:!h.dataset.daylight};});
    check('the veil into the World is the World\'s colour for this hour, and the house page itself is untouched',veil.out&&veil.house&&(veil.want==='day'?veil.day&&!veil.night:veil.night&&!veil.day),veil);
    check('veil checks have no page errors',errors.length===0,errors);
    await ctx.close();
  }
}finally{await browser.close();}
