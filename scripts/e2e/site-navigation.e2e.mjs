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
      if(p==='/v1/world/access')return json(r,{release:{version:'globe-admin-preview/v1',admin_preview:auth.status===200},locked_layers:[],unlocked_layers:[]});
      if(p==='/v1/status') {const status=auth.status;if(auth.delay)await new Promise(resolve=>auth.release=resolve);return json(r,{ok:status===200},status);}
      if(p==='/v1/observability/events')return json(r,{events:[{id:1,source:'worker',trace_id:'fixture-trace',event_name:'Fixture operation',level:'error',occurred_at:new Date().toISOString()},{id:2,source:'core',trace_id:'fixture-trace',event_name:'Fixture retry',level:'warn',occurred_at:new Date().toISOString()},{id:3,source:'worker',event_name:'Separate warning',level:'warn',occurred_at:new Date().toISOString()}],has_more:true});
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
 if(!process.env.NAV_ROLE_MATRIX&&!process.env.NAV_DOCK_ONLY){
  for(const width of [390,820,1280]){
    const {ctx,page,auth,errors}=await setup(width);
    await page.goto(BASE+'/control.html?org=o1#home');
    await page.waitForSelector('body[data-admin-navigation][data-site-navigation]');
    check(width+' owner never sees the guest three-tab bar during entry',await page.evaluate(()=>__navFrames.every(n=>n===10)),await page.evaluate(()=>__navFrames));
    check(width+' profile is top right',await topRight(page));
    const keys=await page.locator('.appbar [data-appnav]').evaluateAll(nodes=>nodes.map(n=>n.dataset.appnav));
    check(width+' Inbox is directly left of Home and Games directly right of World',keys.indexOf('admin-inbox')+1===keys.indexOf('admin-home')&&keys.indexOf('world')+1===keys.indexOf('games'));
    check(width+' owner buttons have 44px touch targets',await page.locator('.appbar [data-appnav]').evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.width>=44&&r.height>=44;})));
    check(width+' Control is labeled Home',await page.locator('#mccControlToggle span').innerText()==='Home');
    await page.evaluate(()=>window.__sliceDocument=123);
    for(let cycle=0;cycle<3;cycle++){
      await page.locator('[data-appnav="admin-inbox"]').click();
      await page.waitForFunction(()=>location.hash==='#people:inbox:conversations' && document.querySelectorAll('.cr-inbox-category').length===3);
      check(width+' Inbox categories and document retained '+cycle,await page.locator('.cr-inbox-category').count()===3&&await page.evaluate(()=>window.__sliceDocument===123));
      check(width+' Inbox alone active '+cycle,await page.locator('.appbar [aria-current="page"]').evaluateAll(n=>n.length===1&&n[0].dataset.appnav==='admin-inbox'));
      check(width+' Inbox fits '+cycle,await fits(page));
      if(cycle===0)await page.screenshot({path:join(OUT,'inbox-'+width+'.png')});
      await page.evaluate(()=>location.hash='#home:today');
      await page.waitForFunction(()=>document.querySelector('#crSurface')?.getAttribute('data-cr-route')==='#home:today');
    }
    await page.evaluate(()=>location.hash='#system:observability');
    await page.waitForSelector('.cr-system-event');
    check(width+' shared trace groups two records without claiming incidents',await page.locator('.cr-system-event').count()===2&&(await page.locator('.cr-system-summary').innerText()).includes('not incident counts'));
    await page.locator('.cr-system-event summary').first().click();
    check(width+' original evidence and impact remain reachable',await page.locator('.cr-system-event[open]').innerText().then(t=>t.includes('Impact:')&&t.includes('Original event evidence')));
    check(width+' System fits',await fits(page));
    await page.screenshot({path:join(OUT,'system-'+width+'.png')});
    await page.evaluate(()=>location.hash='#home:today');
    await page.waitForFunction(()=>document.querySelector('#crSurface')?.getAttribute('data-cr-route')==='#home:today');

    /* one bottom bar: the Control sections (NAV) are a row under the topbar on a phone and the sidebar from 1024px, never a second fixed bar */
    check(width+' one global bottom bar',await page.locator('.appbar').count()===1&&await page.locator('#crSections').evaluate(el=>getComputedStyle(el).position!=='fixed'));
    await open(page);
    await page.keyboard.press('Tab');
    check(width+' keyboard reaches destination search',await page.locator('#mccDestinationSearch').evaluate(el=>document.activeElement===el));
    const inventory=await page.evaluate(()=>({actual:[...document.querySelectorAll('[data-control-route]')].map(a=>a.dataset.controlRoute).sort(),expected:CR.workspaceCore.routes.map(r=>r.hash).sort()}));
    check(width+' every native destination is in the dock',JSON.stringify(inventory.actual)===JSON.stringify(inventory.expected));
    check(width+' all destinations preserve organization',await page.locator('[data-control-route]').evaluateAll(links=>links.every(a=>new URL(a.href).searchParams.get('org')==='o1')));
    check(width+' no horizontal overflow',await fits(page));
    await page.locator('[data-destination-group="Create"]').click();
    check(width+' Create filters destinations',await page.locator('[data-control-route="#create:front-page"]').isVisible()&&await page.locator('[data-control-route="#people:contacts"]').count()===0);
    await page.locator('[data-destination-group="All"]').click();
    await page.fill('#mccDestinationSearch','zzzzzz');
    check(width+' empty search is explicit',await page.locator('#mccDestinationCount').textContent()==='No destinations match. Try another search.');
    await page.fill('#mccDestinationSearch','contacts');
    await page.locator('[data-control-route="#people:contacts"]').click();
    await page.waitForFunction(()=>location.hash==='#people:contacts');
    check(width+' native route opens with context',new URL(page.url()).searchParams.get('org')==='o1');
    await page.goBack();await page.waitForFunction(()=>location.hash==='#home:today');
    check(width+' browser Back works',true);
    await open(page);await page.keyboard.press('Escape');
    check(width+' Escape closes and restores dock focus',await page.locator('#mccControlToggle').evaluate(el=>document.activeElement===el&&el.getAttribute('aria-expanded')==='false'));
    await page.click('#mccAuthChip');
    check(width+' profile retains Control account actions',await page.locator('#crAccountMenu').evaluate(el=>el.classList.contains('is-open'))&&await page.locator('#crOut').isVisible());
    await page.keyboard.press('Escape');
    await open(page);await page.screenshot({path:join(OUT,'destinations-'+width+'.png')});
    await page.keyboard.press('Escape');

    for(const path of ['/license.html','/brief.html','/music-admin.html','/member-front.html?handle=qa-member','/city-arcade.html','/game-hub.html','/prim3-tactics-preview.html','/equity-uprise.html','/control.html?org=o1#analytics','/control.html?org=o1#home']){
      await page.goto(BASE+path);await page.waitForSelector('body[data-admin-navigation][data-site-navigation]');
      check(width+' consistent owner bar on '+path,await page.evaluate(()=>document.querySelectorAll('.appbar [data-appnav]').length===10&&__navFrames.every(n=>n===10)));
      check(width+' one ordered accessible dock on '+path,await page.evaluate(()=>{
        const bars=document.querySelectorAll('.appbar'),tabs=[...bars[0].querySelectorAll('[data-appnav]')];
        return bars.length===1&&tabs.map(x=>x.dataset.appnav).join(',')==='music,admin-inbox,admin-home,home,analytics,world,games,admin-sell,admin-create,admin-system'&&tabs.every(x=>{const r=x.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.bottom<=innerHeight;});
      }));
    }
    const routes=await page.evaluate(()=>CR.workspaceCore.routes.map(r=>r.hash));
    for(const hash of routes){await page.evaluate(h=>{location.hash=h;},hash);await page.waitForFunction(h=>location.hash===h&&document.getElementById('crSurface')?.childElementCount>0,hash);check(width+' owner navigation stable at '+hash,await page.evaluate(()=>document.querySelectorAll('.appbar [data-appnav]').length===10&&!document.querySelector('#crInspector')?.classList.contains('is-open')));}
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
    /* The bar restores the session asynchronously after navigation; signing out
       before it has verified races the restore and can leave a signed-in bar. */
    await page.waitForFunction(()=>typeof window.MCC?.signOut==='function'&&window.MCC_BAR?.auth().verified);
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
    check('route-module failure retains the original Control door and sidebar',await page.locator('.appbar a[data-appnav="admin-home"]').count()===1&&await page.locator('#crSections').isVisible());
    await ctx.close();
  }
  {
    const {ctx,page}=await setup(390);await page.goto('https://mccluster.org/?view=feed');
    await page.waitForSelector('body[data-admin-navigation][data-site-navigation]');
    await page.waitForSelector('#mnMe:not([hidden])');
    check('World keeps one top-right native profile',await topRight(page,'#mnMe')&&await page.locator('#mccAuthChip').isHidden());
    await open(page);const url=await page.locator('[data-control-route="#create:projects:library"]').getAttribute('href');
    check('World routes Control to Matthew’s host',url===BASE+'/control.html#create:projects:library');
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
  for(const width of [390,1280]){
    const {ctx,page}=await setup(width);
    await page.goto(BASE+'/city-arcade.html');await page.waitForSelector('body[data-admin-navigation]');
    check(width+' game page marks Games active',await page.locator('[data-appnav="games"][aria-current="page"]').count()===1);
    await page.locator('#mccControlToggle').click();
    await page.locator('#mccDestinations:popover-open').waitFor();
    await page.locator('#mccDestinationList a').filter({hasText:'Hitman’s Halo'}).click();
    await page.waitForURL('**/action-globe.html?explore=1&halo=1');
    await page.waitForSelector('body[data-admin-navigation]');
    await page.locator('.appbar [data-appnav="games"]').click();await page.waitForURL('**/game-hub.html');
    await page.waitForSelector('body[data-admin-navigation]');
    await page.waitForSelector('#ghMain');
    check(width+' bottom Games tab opens owner Game Hub with course and world access',await page.locator('[data-appnav="games"][aria-current="page"]').count()===1&&await page.locator('#ghModules').count()===1&&await page.locator('.gh-worlds a[href="action-globe.html?explore=1&games=1"]').count()===1);
    await page.locator('.gh-worlds a[href="action-globe.html?explore=1&games=1"]').click();await page.waitForURL('**/action-globe.html?explore=1&games=1');
    await page.waitForSelector('body[data-admin-navigation]');
    await page.waitForFunction(()=>window.__huGames?.()?.isOpen());
    check(width+' hub opens the existing owner-only globe Games overlay',await page.locator('[data-appnav="games"][aria-current="page"]').count()===1);
    await page.locator('.games-close').click();
    await page.click('#mccAuthChip');await page.locator('#mccProfileMenu:popover-open').waitFor();
    check(width+' profile contains account and owner Home',await page.locator('#mccProfileMenu a').count()===3&&await page.locator('#mccProfileMenu [data-owner-profile-action="home"]').isVisible());
    await page.keyboard.press('Escape');check(width+' profile escape restores focus',await page.locator('#mccAuthChip').evaluate(el=>document.activeElement===el));
    await page.screenshot({path:join(OUT,'globe-owner-'+width+'.png')});
    await page.locator('.appbar [data-appnav="admin-inbox"]').click();await page.waitForURL('**/control.html#people:inbox:conversations');
    await page.waitForSelector('body[data-admin-navigation]');
    check(width+' globe to Inbox retains ten destinations',await page.locator('.appbar [data-appnav]').count()===10);
    await ctx.close();
  }
  {
    const {ctx,page}=await setup(390);await page.goto(BASE+'/action-globe.html?embedded=1&surface=network');
    check('embedded globe has no duplicate navigation or profile',await page.locator('.appbar,#mccAuthChip,#mccControlToggle').count()===0);
    await ctx.close();
  }
 }
 if(!process.env.NAV_DOCK_ONLY)for(const width of [390,1280])for(const persona of ['owner','member','guest']){
   const {ctx,page,auth}=await setup(width,persona);
   for(const path of ['/action-globe.html?explore=1','/member-front.html?handle=qa-member','/control.html#home','/control.html#create:front-page','/city-arcade.html','/control.html#insights:overview'].filter(path=>!process.env.NAV_EDITOR_ONLY||path.includes('#create:front-page'))){
     await page.goto(BASE+path);await page.waitForFunction(()=>window.MCC_BAR?.auth().verified);
     await page.waitForFunction(()=>document.body.dataset.siteNavigation==='ready');
     if(persona==='owner')await page.waitForSelector('body[data-admin-navigation]');
     check(width+' '+persona+' direct entry '+path,await page.locator('.appbar').count()===1&&await page.locator('.appbar [data-appnav]').count()===(persona==='owner'?10:3));
     if(path.includes('#create:front-page')&&persona==='owner'){await page.locator('[data-cfp-root]').waitFor();check(width+' actual editor remains mounted',await page.locator('[data-cfp-form]').isVisible());}
     if(path.startsWith('/action-globe')&&persona!=='guest'){
       // Mount the actual legacy shortcuts to exercise the duplication seen
       // with owner sessions; synthetic auth only, with all network intercepted.
       if(persona==='owner'){
         await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('mccdb_session'));s.user.email='matthew@mccluster.org';localStorage.setItem('mccdb_session',JSON.stringify(s));});
         await page.addScriptTag({url:BASE+'/js/control-registry.js'});await page.addScriptTag({url:BASE+'/js/control-palette.js'});
         check(width+' legacy shortcuts hidden after shared profile ready',await page.locator('.cmdk-owner-nav').isHidden());
       }
       await page.click('#mccAuthChip');await page.locator('#mccProfileMenu:popover-open').waitFor();
       check(width+' '+persona+' profile owner actions respect role',await page.locator('#mccProfileMenu [data-owner-profile-action="home"]').isVisible()===(persona==='owner'));
       check(width+' '+persona+' profile has account link',await page.locator('#mccProfileMenu a[href$="account.html?stay=1"]').isVisible());
       await page.screenshot({path:join(OUT,'profile-'+persona+'-'+width+'.png')});
       await page.keyboard.press('Escape');
       if(persona==='owner'){
         await page.click('#mccAuthChip');await page.locator('#mccProfileMenu [data-owner-profile-action="search"]').click();
         await page.waitForSelector('#cmdkRoot.is-open');
         check(width+' retained command search opens',await page.locator('#cmdkRoot').evaluate(el=>el.classList.contains('is-open')));await page.keyboard.press('Escape');
         auth.status=403;await page.evaluate(()=>MCC_BAR.verifyAdmin());
         await page.click('#mccAuthChip');check(width+' revocation removes Profile admin actions',await page.locator('#mccProfileMenu [data-owner-profile-action="home"]').isHidden());await page.keyboard.press('Escape');
         auth.status=200;await page.evaluate(()=>MCC_BAR.verifyAdmin());
       }
     }
   }
   await ctx.close();
 }

 for(const width of [390,1280]){
  const {ctx,page,auth,errors}=await setup(width);
  await page.goto(BASE+'/control.html#home');await page.waitForSelector('body[data-admin-navigation]');
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);
  const dock=page.locator('.appbar'),left=page.getByRole('button',{name:'Scroll navigation left',exact:true}),right=page.getByRole('button',{name:'Scroll navigation right',exact:true});
  const scroll=async n=>{await dock.evaluate((el,n)=>{el.style.scrollSnapType='none';el.scrollLeft=n;},n);await page.waitForFunction(()=>{const d=document.querySelector('.appbar'),b=document.querySelectorAll('#mccDockHints button');return b[0].hidden===(d.scrollLeft<=2)&&b[1].hidden===(d.scrollLeft>=d.scrollWidth-d.clientWidth-2);});};
  const visible=async()=>dock.evaluate(el=>{const a=el.querySelector(':focus')||el.querySelector('[aria-current="page"]'),r=a?.getBoundingClientRect(),d=el.getBoundingClientRect();return !!r&&r.left>=d.left-1&&r.right<=d.right+1;});
  check(width+' dock has no script errors',errors.length===0,errors);
  check(width+' registry adds Sell Create System once',await dock.locator('[data-dock-section]').count()===3);
  await scroll(0);
  if(width===390){
    check('phone initial hint only right',await left.isHidden()&&await right.isVisible(),await dock.evaluate(el=>({left:el.scrollLeft,width:el.clientWidth,scroll:el.scrollWidth,hints:document.getElementById('mccDockHints').outerHTML})));
    check('all seven primary owner destinations, including Games next to World, are visible without scrolling',
      await dock.evaluate(el=>[...el.querySelectorAll('[data-appnav]')].slice(0,7).every(tab=>{const a=tab.getBoundingClientRect(),b=el.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1&&a.width>=44;})));
    check('Games is directly tappable, not covered by scroll arrows',
      await dock.locator('[data-appnav="games"]').evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&(hit===el||el.contains(hit));}));
    check('reduced motion disables hint animation',await right.evaluate(el=>getComputedStyle(el).animationName==='none'));
    await right.click();await page.waitForFunction(()=>document.querySelector('.appbar').scrollLeft>2);
    // The scroll event refreshes the hints on the next animation frame; wait for
    // that accessible state instead of reading the old hidden flag immediately.
    await left.waitFor({state:'visible'});
    check('phone arrow scrolls to additional Sell/Create/System destinations',await left.isVisible()&&await dock.evaluate(el=>el.scrollLeft>2));
    await scroll(10000);check('phone end hint only left',await left.isVisible()&&await right.isHidden());
    await page.locator('#mccControlToggle').focus();await page.keyboard.press('End');
    check('keyboard End reaches System visibly',await page.locator('[data-dock-section="system"]').evaluate(el=>el===document.activeElement)&&await visible());
    await page.keyboard.press('Home');check('keyboard Home reaches Play visibly',await page.locator('[data-appnav="music"]').evaluate(el=>el===document.activeElement)&&await visible());
    await page.keyboard.press('ArrowRight');check('keyboard Right reaches Inbox',await page.locator('[data-appnav="admin-inbox"]').evaluate(el=>el===document.activeElement));
    await scroll(0);
    const box=await dock.boundingBox(),cdp=await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.8,y:box.y+box.height*.5}]});
    for(let step=1;step<=8;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*.8-step*18,y:box.y+box.height*.5}]});await page.waitForTimeout(20);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
    check('touch swipe moves owner dock',await dock.evaluate(el=>el.scrollLeft>20));await cdp.detach();
    await page.screenshot({path:join(OUT,'scroll-dock-390.png')});
    await page.setViewportSize({width:1280,height:844});await page.waitForFunction(()=>document.getElementById('mccDockHints').hidden);
    check('resize to desktop hides both hints',await left.isHidden()&&await right.isHidden());
    await page.setViewportSize({width:390,height:844});await scroll(0);
    check('resize back restores correct overflow hint',await left.isHidden()&&await right.isVisible());
  }else check('desktop fit has no hints',await left.isHidden()&&await right.isHidden());
  check(width+' screen reader controls identify navigation',await page.locator('#mccDockHints button').evaluateAll(els=>els.every(el=>el.getAttribute('aria-controls')===document.querySelector('.appbar').id&&el.getAttribute('aria-label').startsWith('Scroll navigation'))));
  auth.status=403;await page.evaluate(()=>MCC_BAR.verifyAdmin());
  check(width+' member role removes extra destinations and hints',await dock.locator('[data-appnav]').count()===3&&await page.locator('#mccDockHints').isHidden());
  auth.status=200;await page.evaluate(()=>MCC_BAR.verifyAdmin());await page.waitForSelector('body[data-admin-navigation]');
  check(width+' owner role restores registry without duplicates',await dock.locator('[data-appnav]').count()===10&&await page.locator('#mccDockHints').count()===1);
  await ctx.close();
 }
}finally{await writeFile(join(OUT,'results.json'),JSON.stringify(results,null,2));await browser.close();}
