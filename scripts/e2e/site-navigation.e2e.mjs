/* Actual shared bar and pages, synthetic auth/API fixtures. All network is
   intercepted; this suite never calls production or creates an account. */
import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
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
    const req=r.request(),u=new URL(req.url()),p=u.pathname;calls.push({url:u.href,method:req.method()});
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
async function open(page){await page.click('#mccControlToggle');await page.locator('#mccDestinations:popover-open').waitFor();}
async function fits(page){return page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth);}
async function topRight(page,selector='#mccAuthChip'){
  return page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.top<=24&&r.right<=innerWidth&&r.right>=innerWidth-24&&r.width>=44&&r.height>=44;});
}
try{
  for(const width of [390,820,1280]){
    const {ctx,page,auth,errors}=await setup(width);
    await page.goto(BASE+'/control.html?org=o1#home');
    await page.waitForSelector('body[data-admin-navigation][data-site-navigation]');
    check(width+' owner never sees the guest three-tab bar during entry',await page.evaluate(()=>__navFrames.every(n=>n===5)),await page.evaluate(()=>__navFrames));
    check(width+' profile is top right',await topRight(page));
    check(width+' one global bottom bar',await page.locator('.appbar').count()===1&&await page.locator('.cr-rail').isHidden()&&await page.locator('.cr-bottom').isHidden());
    await open(page);
    await page.keyboard.press('Tab');
    check(width+' keyboard reaches destination search',await page.locator('#mccDestinationSearch').evaluate(el=>document.activeElement===el));
    const inventory=await page.evaluate(()=>({actual:[...document.querySelectorAll('[data-control-route]')].map(a=>a.dataset.controlRoute).sort(),expected:CR.workspaceCore.routes.map(r=>r.hash).sort()}));
    check(width+' every native destination is in the dock',JSON.stringify(inventory.actual)===JSON.stringify(inventory.expected));
    check(width+' all destinations preserve organization',await page.locator('[data-control-route]').evaluateAll(links=>links.every(a=>new URL(a.href).searchParams.get('org')==='o1')));
    check(width+' no horizontal overflow',await fits(page));
    await page.locator('[data-destination-group="Studio"]').click();
    check(width+' Studio filters destinations',await page.locator('[data-control-route="#create:funding"]').isVisible()&&await page.locator('[data-control-route="#work:people"]').count()===0);
    await page.locator('[data-destination-group="All"]').click();
    await page.fill('#mccDestinationSearch','zzzzzz');
    check(width+' empty search is explicit',await page.locator('#mccDestinationCount').textContent()==='No destinations match. Try another search.');
    await page.fill('#mccDestinationSearch','people');
    await page.locator('[data-control-route="#work:people"]').click();
    await page.waitForFunction(()=>location.hash==='#work:people');
    check(width+' native route opens with context',new URL(page.url()).searchParams.get('org')==='o1');
    await page.goBack();await page.waitForFunction(()=>location.hash==='#home');
    check(width+' browser Back works',true);
    await open(page);await page.keyboard.press('Escape');
    check(width+' Escape closes and restores dock focus',await page.locator('#mccControlToggle').evaluate(el=>document.activeElement===el&&el.getAttribute('aria-expanded')==='false'));
    await page.click('#mccAuthChip');
    check(width+' profile retains Control account actions',await page.locator('#crAccountMenu').evaluate(el=>el.classList.contains('is-open'))&&await page.locator('#crOut').isVisible());
    await page.keyboard.press('Escape');
    await open(page);await page.screenshot({path:join(OUT,'destinations-'+width+'.png')});
    await page.keyboard.press('Escape');

    for(const path of ['/license.html','/brief.html','/asset-lab.html','/music-admin.html','/control.html?org=o1#analytics','/control.html?org=o1#home']){
      await page.goto(BASE+path);await page.waitForSelector('body[data-admin-navigation][data-site-navigation]');
      check(width+' consistent owner bar on '+path,await page.evaluate(()=>document.querySelectorAll('.appbar [data-appnav]').length===5&&__navFrames.every(n=>n===5)));
    }
    const routes=await page.evaluate(()=>CR.workspaceCore.routes.map(r=>r.hash));
    for(const hash of routes){await page.evaluate(h=>{location.hash=h;},hash);await page.waitForFunction(h=>location.hash===h&&document.getElementById('crSurface')?.childElementCount>0,hash);check(width+' owner navigation stable at '+hash,await page.evaluate(()=>document.querySelectorAll('.appbar [data-appnav]').length===5&&!document.querySelector('#crInspector')?.classList.contains('is-open')));}
    // Permission withdrawal is checked when opening, not trusted from an old UI.
    auth.status=403;await page.click('#mccControlToggle');
    await page.waitForFunction(()=>!window.MCC_BAR.admin());
    check(width+' revocation removes admin panel and returns public bar',await page.locator('#mccControlToggle').count()===0&&await page.locator('#mccDestinations').count()===0&&await page.locator('.appbar [data-appnav]').count()===3);
    check(width+' navigation has no script errors',errors.length===0,errors);
    await ctx.close();
  }
  /* Universal perspective: guests get the house, signed-in people get their
     own front, public profile selection switches center, and exit clears it. */
  {
    const {ctx,page,errors}=await setup(390,'member');
    await page.goto(BASE+'/license.html');
    await page.waitForFunction(()=>MCC_BAR.ownPerspective()?.handle==='qa-member');
    check('signed-in center defaults to this member front page',
      (await page.locator('.appbar [data-appnav="home"]').getAttribute('href'))===BASE+'/member-front.html?handle=qa-member');
    await page.evaluate(()=>dispatchEvent(new CustomEvent('mcc:perspective',{detail:{kind:'member',handle:'other-member',name:'Other member'}})));
    check('opening another member changes the center destination',
      (await page.locator('.appbar [data-appnav="home"]').getAttribute('href'))===BASE+'/member-front.html?handle=other-member');
    await page.reload();
    await page.waitForFunction(()=>MCC_BAR.auth().verified);
    check('chosen center perspective survives reloading within account',
      (await page.locator('.appbar [data-appnav="home"]').getAttribute('href'))===BASE+'/member-front.html?handle=other-member');
    await page.goto(BASE+'/index.html?front=house');
    await page.waitForFunction(()=>MCC_BAR.auth().verified);
    check('visiting founder switches center back to original house',
      (await page.locator('.appbar [data-appnav="home"]').getAttribute('href'))===BASE+'/index.html');
    await page.goto(BASE+'/member-front.html?handle=qa-member');
    await page.waitForSelector('#mfCustomize:not([hidden])');
    check('self profile has its own editable page without a duplicate identity',
      await page.textContent('#mfName')==='QA member'&&await page.locator('.mf__avatar').count()===1);
    await page.click('#mfCustomize');
    check('only the actual owner sees the customize editor',await page.locator('#mfEditor').isVisible());
    await page.locator('#mfCancel').click();
    await page.goto(BASE+'/member-front.html?handle=other-member');
    await page.waitForFunction(()=>document.getElementById('mfName').textContent==='Other member');
    check('other member front has no profile editor controls',await page.isHidden('#mfCustomize'));
    await page.evaluate(async()=>{await window.MCC.signOut();});
    await page.waitForFunction(()=>MCC_BAR.auth().signed_in===false);
    check('signing out clears selected identity and restores house',
      (await page.locator('.appbar [data-appnav="home"]').getAttribute('href'))===BASE+'/index.html');
    check('member front and bar have no page exceptions',errors.length===0,errors);
    await ctx.close();
  }
  {
    const {ctx,page}=await setup(390,'guest');
    await page.goto(BASE+'/license.html');
    await page.waitForFunction(()=>MCC_BAR.auth().verified);
    check('guest always starts with Matthews supplied M and house',
      (await page.locator('.appbar [data-appnav="home"]').getAttribute('href'))===BASE+'/index.html');
    await ctx.close();
  }
  for(const persona of ['guest','member']){
    const {ctx,page}=await setup(390,persona);await page.goto(BASE+'/license.html');
    await page.waitForSelector('body[data-site-navigation]');
    await page.waitForFunction(()=>window.MCC_BAR.auth().verified);
    check(persona+' has no admin destinations',await page.locator('#mccControlToggle').count()===0&&await page.locator('.appbar [data-appnav]').count()===3);
    check(persona+' profile/sign in is top right',await topRight(page));
    if(persona==='member'){await page.click('#mccAuthChip');check('member profile menu opens',await page.locator('#mccProfileMenu:popover-open').count()===1);await page.keyboard.press('Escape');}
    await page.evaluate(()=>window.scrollTo(0,500));check(persona+' profile remains pinned while scrolling',await topRight(page));
    await ctx.close();
  }
  {
    const {ctx,page,auth}=await setup(390);await page.goto(BASE+'/license.html');await page.waitForSelector('#mccControlToggle');
    auth.delay=true;await page.click('#mccControlToggle');
    await page.waitForTimeout(100);
    await page.evaluate(()=>{localStorage.removeItem('mccdb_session');localStorage.removeItem('mcc_sess_keep');dispatchEvent(new Event('mcc:auth-changed'));});
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/status');
    auth.release?.();await response;await page.waitForTimeout(50);await page.waitForFunction(()=>!window.MCC_BAR.admin());
    check('late owner response cannot resurrect signed-out navigation',await page.locator('#mccDestinations').count()===0&&await page.locator('#mccControlToggle').count()===0);
    await ctx.close();
  }
  {
    const {ctx,page,calls}=await setup(390);
    await ctx.addInitScript(()=>{const s=JSON.parse(localStorage.getItem('mccdb_session'));s.expires_at=1;localStorage.setItem('mccdb_session',JSON.stringify(s));});
    await page.goto(BASE+'/license.html');await page.waitForSelector('#mccControlToggle');
    check('canonical token refresh can complete owner navigation',calls.some(c=>new URL(c.url).pathname==='/auth/v1/token')&&await page.evaluate(()=>MCC_BAR.auth().verified));
    await ctx.close();
  }
  {
    const {ctx,page,auth}=await setup(390);await page.goto(BASE+'/license.html');await page.waitForSelector('#mccControlToggle');
    auth.status=503;await page.click('#mccControlToggle');await page.waitForFunction(()=>!window.MCC_BAR.admin());
    check('unavailable owner authority closes admin navigation',await page.locator('#mccDestinations').count()===0&&await page.locator('#mccControlToggle').count()===0);
    await ctx.close();
  }
  {
    const {ctx,page}=await setup(1280);
    await ctx.route('**/js/control-room/workspace-core.js*',route=>route.abort());
    await page.goto(BASE+'/control.html#home');await page.waitForSelector('.appbar--admin');
    check('route-module failure retains the original Control door and sidebar',await page.locator('.appbar a[data-appnav="admin-home"]').count()===1&&await page.locator('.cr-rail').isVisible());
    await ctx.close();
  }
  {
    const {ctx,page}=await setup(390);await page.goto('https://mccluster.org/?view=feed');
    await page.waitForSelector('body[data-admin-navigation][data-site-navigation]');
    await page.waitForSelector('#mnMe:not([hidden])');
    check('World keeps one top-right native profile',await topRight(page,'#mnMe')&&await page.locator('#mccAuthChip').isHidden());
    await open(page);const url=await page.locator('[data-control-route="#create:library"]').getAttribute('href');
    check('World routes Control to Matthew’s host',url===BASE+'/control.html#create:library');
    await page.keyboard.press('Escape');await page.click('#mnMe');
    check('World account menu still opens',await page.locator('#mnMenu').isVisible());
    check('World has no horizontal overflow',await fits(page));
    await page.screenshot({path:join(OUT,'world-profile-390.png')});
    await ctx.close();
  }
  {
    const {ctx,page}=await setup(390,'guest');await page.goto('https://mccluster.org/?view=feed');
    await page.waitForSelector('body[data-site-navigation]');
    await page.waitForFunction(()=>document.getElementById('mnGuestBar').hidden===false);
    const overlap=await page.evaluate(()=>{
      const profile=document.getElementById('mccAuthChip').getBoundingClientRect();
      return [...document.querySelectorAll('.mn__top button:not([hidden]),.mn__top input')].filter(el=>el.getClientRects().length).some(el=>{
        const r=el.getBoundingClientRect();return r.left<profile.right&&r.right>profile.left&&r.top<profile.bottom&&r.bottom>profile.top;
      });
    });
    check('World guest profile does not cover header controls',!overlap);
    await page.screenshot({path:join(OUT,'world-guest-390.png')});await ctx.close();
  }
  /* NO SCREEN FLASHES (owner, 2026-10-20: "just a smooth transition from screen to screen"): a tab asks for the next page at
     once (it used to hold 460ms under the veil first), and the veil into the World is the World's own colour */
  {
    const {ctx,page,errors}=await setup(390,'guest');await page.goto(BASE+'/license.html');
    await page.waitForFunction(()=>window.MCC_BAR&&window.MCC_BAR.auth().verified);
    await page.evaluate(()=>{navigation.addEventListener('navigate',()=>sessionStorage.setItem('__navDelay',String(Math.round(performance.now()-window.__clickAt))));
      window.__clickAt=performance.now();document.querySelector('.appbar [data-appnav="home"]').click();});
    await page.waitForURL(/\/index\.html$/,{timeout:15000});
    const delay=Number(await page.evaluate(()=>sessionStorage.getItem('__navDelay')));
    check('a bar tab asks for the next page at once, with no hold before it',Number.isFinite(delay)&&delay<200,delay);
    await page.goto(BASE+'/license.html');
    await page.waitForFunction(()=>window.MCC_BAR&&window.MCC_DAYLIGHT_CORE);
    const veil=await page.evaluate(()=>{const h=document.documentElement;document.querySelector('.appbar [data-appnav="world"]').click();
      return {out:h.classList.contains('pt-out'),day:h.classList.contains('pt-to-day'),night:h.classList.contains('pt-to-night'),want:MCC_DAYLIGHT_CORE.estimate(new Date()),house:!h.dataset.daylight};});
    check('the veil into the World is the World\'s colour for this hour, and the house page itself is untouched',veil.out&&veil.house&&(veil.want==='day'?veil.day&&!veil.night:veil.night&&!veil.day),veil);
    check('veil checks have no page errors',errors.length===0,errors);
    await ctx.close();
  }
  {
    const {ctx,page}=await setup(390);await page.goto(BASE+'/action-globe.html?embedded=1&surface=network');
    check('embedded globe has no duplicate navigation or profile',await page.locator('.appbar,#mccAuthChip,#mccControlToggle').count()===0);
    await ctx.close();
  }
}finally{await writeFile(join(OUT,'results.json'),JSON.stringify(results,null,2));await browser.close();}
