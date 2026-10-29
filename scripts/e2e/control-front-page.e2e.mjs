/* Control → Create → Front page, and the front page it controls. Real control.html, index.html and their scripts from
   this checkout; every network call is a synthetic fixture (no Supabase, no Worker, no third party).
   Owner, 2026-10-21: "My front page as the admin is not my actual site's front page ... I should be able to control my
   site's front page ... with the scroll dependent and the VR and all that stuff from my admin panel."
   PLAYWRIGHT_DIR=<node_modules> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/control-front-page.e2e.mjs [outDir] */
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
  const db={rows:rows.slice(),sets:[],reverts:[],collects:[]},errors=[];
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
      if(p==='/v1/collect'){const f=req.frame();db.collects.push((f&&f.parentFrame()?'framed:':'top:')+(f?f.url():''));return json(route,{ok:true});}
      if(p==='/v1/status')return owner&&signedIn?json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}}):json(route,{error:'Forbidden'},403);
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:OWNER},default_org_id:'o1',workspaces:[{org_id:'o1',slug:'mccluster',kind:'studio',role:owner?'owner':'viewer',enabled:true,name:'McCluster'}]});
      /* the owner's own member profile exists, which is what used to turn his M into a member card */
      if(p==='/v1/mnet/bootstrap')return json(route,{identity:{mccluster_id:'matthew'},profile:{display_name:'Matthew McCluster',avatar_url:''}});
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/user')return signedIn?json(route,{id:OWNER,email:'owner@fixture.invalid'}):json(route,{msg:'no session'},401);
      if(p==='/rest/v1/site_content'){
        const page=(u.searchParams.get('page')||'').replace(/^eq\./,''),slot=(u.searchParams.get('slot')||'').replace(/^eq\./,'');
        return json(route,db.rows.filter(r=>r.page===page&&(!slot||r.slot===slot)).map(r=>({slot:r.slot,kind:r.kind,value:r.value,updated_at:r.updated_at})));
      }
      if(p==='/rest/v1/rpc/site_content_set'){
        const b=req.postDataJSON();db.sets.push({body:b,auth:req.headers().authorization||''});
        if(!owner)return json(route,{message:'only the house admin may edit the site'},400);
        const row={page:b.p_page,slot:b.p_slot,kind:b.p_kind,value:b.p_value,updated_at:'2026-10-21T21:00:00Z'};
        db.rows=db.rows.filter(r=>!(r.page===row.page&&r.slot===row.slot)).concat(row);return json(route,row);
      }
      if(p==='/rest/v1/rpc/site_content_revert'){const b=req.postDataJSON();db.reverts.push(b);db.rows=db.rows.filter(r=>!(r.page===b.p_page&&r.slot===b.p_slot));return route.fulfill({status:204,body:''});}
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
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
/* a visitor's own gesture: the wheel goes through the page's scroll engine (Lenis), as a hand on a trackpad does */
async function wheelFrom(page){
  await page.waitForTimeout(500);
  const y=await page.evaluate(()=>scrollY);
  await page.mouse.move(195,420);
  for(let i=0;i<6;i++){await page.mouse.wheel(0,250);await page.waitForTimeout(60);}
  await page.waitForTimeout(900);
  return page.evaluate(y=>({held:!!(window.__MCC_VR&&window.__MCC_VR.held),moved:Math.abs(scrollY-y)}),y);
}
const engine=page=>page.waitForFunction(()=>window.MCC_FRONT&&window.__MCC_FRONT_GOTO&&document.documentElement.getAttribute('data-content-loaded'),null,{timeout:30000});
const SAVED={scenes:{doors:false,night:false},scroll:{duration:1.2,touchLerp:0.1},night:{arrive:0.8},
  vr:{hold:false,spots:[{yaw:10,pitch:0,label:'<img src=x onerror="window.__pwned=1">Fly',href:'javascript:alert(1)'},{yaw:20,pitch:-5,label:'<b>Book</b> me',href:'hire.html'}]}};

try{
  /* 1. A VISITOR, NO ROW: the page is exactly as shipped */
  {
    const scope='visitor-shipped';const app=await setup({width:390,height:844},{signedIn:false});const {page,errors}=app;
    await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});await engine(page);
    const f=await page.evaluate(()=>({source:window.MCC_FRONT.source,c:window.MCC_FRONT.config,d:window.MCC_FRONT_DEFAULT}));
    check(scope,'no row: the shipped settings, opening in the cabin, Antisocial, public, the night room at 0.74',f.source==='shipped'&&f.c.vr.enabled&&f.c.start==='cabin'&&f.c.song==='antisocial'&&f.c.visible===true&&f.c.night.arrive===0.74&&f.c.scroll.duration===0.85&&f.c.vr.spots.length===3&&JSON.stringify(f.c)===JSON.stringify(f.d),f);
    check(scope,'every scene is on the page',await page.evaluate(()=>!document.querySelector('[data-front-off]')&&getComputedStyle(document.querySelector('.hero__doors')).display!=='none'&&getComputedStyle(document.getElementById('pillars')).display!=='none'));
    await page.waitForFunction(()=>window.__MCC_VR&&window.__MCC_VR.viewer,null,{timeout:15000}).catch(()=>{});
    const open=await page.evaluate(()=>({first:document.querySelector('main section').id,y:scrollY,hero:!!document.getElementById('hero'),orbit:!!document.getElementById('orbitCanvas'),gate:!!document.getElementById('vrGateAllow'),live:!!(window.__MCC_VR&&window.__MCC_VR.live),allowed:!!(window.__MCC_VR&&window.__MCC_VR.allowed),robots:!!document.querySelector('meta[name="robots"]'),tucked:document.documentElement.hasAttribute('data-front-tucked')}));
    check(scope,'the page opens in the cabin, playing, ungated; no orbit hero; public and indexable',open.first==='cabin'&&open.y===0&&!open.hero&&!open.orbit&&!open.gate&&open.live&&open.allowed&&!open.robots&&!open.tucked,open);
    const free=await wheelFrom(page);
    check(scope,'the cabin does not hold the page: a scroll moves on',!free.held&&free.moved>100,free);
    check(scope,'the plane follows, linking the whole project page',await page.locator('#work.command--plane a[data-cta="vaunt-project"]').getAttribute('href')==='front.html?project=vaunt');
    check(scope,'no JavaScript errors',errors.length===0,errors);
    await app.ctx.close();
  }
  /* 2. A VISITOR, WITH THE OWNER'S SAVED ROW: scenes off, a calmer scroll, the cabin that lets go, tags checked */
  {
    const scope='visitor-saved';const app=await setup({width:390,height:844},{signedIn:false,rows:[{page:'index.html',slot:'@front',kind:'text',value:JSON.stringify(SAVED),updated_at:'2026-10-21T20:00:00Z'}]});const {page,errors}=app;
    await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});await engine(page);
    await page.waitForFunction(()=>window.MCC_FRONT.source==='saved',null,{timeout:15000}).catch(()=>{});
    const f=await page.evaluate(()=>({source:window.MCC_FRONT.source,c:window.MCC_FRONT.config,doors:getComputedStyle(document.querySelector('.hero__doors')).display,night:getComputedStyle(document.getElementById('pillars')).display,work:getComputedStyle(document.getElementById('work')).display}));
    check(scope,'the saved row is applied: the doors and the night descent are off, the Vaunt scene stays',f.source==='saved'&&f.doors==='none'&&f.night==='none'&&f.work!=='none',f);
    check(scope,'the scroll feel and the night room are the saved ones',f.c.scroll.duration===1.2&&f.c.scroll.touchLerp===0.1&&f.c.night.arrive===0.8,f.c);
    check(scope,'a tag with a script link is dropped; the other keeps its label as text',f.c.vr.spots.length===1&&f.c.vr.spots[0].href==='hire.html',f.c.vr.spots);
    await page.waitForFunction(()=>window.__MCC_VR&&window.__MCC_VR.viewer,null,{timeout:15000}).catch(()=>{});
    const spot=await page.evaluate(()=>{const l=document.querySelector('#workVR .vr360-spots');return {imgs:l?l.querySelectorAll('img,b').length:-1,text:l?l.textContent:'',pwned:!!window.__pwned};});
    check(scope,'the tag label reaches the cabin as text, never as markup',spot.imgs===0&&/<b>Book<\/b> me/.test(spot.text)&&!spot.pwned,spot);
    check(scope,'no horizontal overflow at 390',(await overflow(page))===0,await overflow(page));
    check(scope,'no JavaScript errors',errors.length===0,errors);
    await page.screenshot({path:join(OUT,'visitor-saved-390.png')});
    await app.ctx.close();
  }
  /* 2b. TUCKED AWAY (owner, 2026-10-29): a visitor gets the holding screen, the bar, the World and the footer; noindex */
  const TUCKED=[{page:'index.html',slot:'@front',kind:'text',value:JSON.stringify({visible:false}),updated_at:'2026-10-29T20:00:00Z'}];
  for(const vp of [{width:390,height:844},{width:1280,height:800}]){
    const scope='visitor-tucked-'+vp.width;const app=await setup(vp,{signedIn:false,rows:TUCKED});const {page,errors}=app;
    await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});await engine(page);
    await page.waitForFunction(()=>document.documentElement.hasAttribute('data-front-tucked'),null,{timeout:15000}).catch(()=>{});
    await page.waitForTimeout(800);
    const v=await page.evaluate(()=>({tucked:document.documentElement.hasAttribute('data-front-tucked'),main:getComputedStyle(document.getElementById('top')).display,holding:getComputedStyle(document.getElementById('frontHolding')).display,robots:(document.querySelector('meta[name="robots"]')||{}).content||'',world:getComputedStyle(document.getElementById('guestWorld')).display,foot:getComputedStyle(document.querySelector('.site-foot')).display,bar:!!document.querySelector('.appbar [data-appnav="home"]'),note:getComputedStyle(document.getElementById('frontOwnerNote')).display,cached:localStorage.getItem('mcc_front_tucked'),playing:!!(window.__MCC_VR&&window.__MCC_VR.playing),sound:document.getElementById('soundToggle').classList.contains('is-on')}));
    check(scope,'a visitor gets the holding screen, not the page; noindex is added',v.tucked&&v.main==='none'&&v.holding!=='none'&&v.robots==='noindex'&&v.note==='none'&&!v.playing,v);
    check(scope,'the bar, the World and the footer stay, so the house still works',v.world!=='none'&&v.foot!=='none'&&v.bar,v);
    await page.mouse.click(Math.round(vp.width/2),300);await page.waitForTimeout(500);
    check(scope,'the holding screen plays no song, even after a tap',!(await page.evaluate(()=>document.getElementById('soundToggle').classList.contains('is-on'))));
    check(scope,'this browser remembers, so the next visit starts on the holding screen without a flash',v.cached==='1',v);
    check(scope,'no horizontal overflow',(await overflow(page))===0,await overflow(page));
    check(scope,'no JavaScript errors',errors.length===0,errors);
    await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(300);
    await page.screenshot({path:join(OUT,`holding-${vp.width}.png`)});
    /* the next visit: the cached flag holds the page back before the row has even been read */
    await page.reload({waitUntil:'domcontentloaded'});
    check(scope,'reloaded: tucked from the first paint',await page.evaluate(()=>document.documentElement.hasAttribute('data-front-tucked')));
    await app.ctx.close();
  }
  /* 2c. TUCKED AWAY, THE OWNER: signed in and named owner by the server, he still gets the real page */
  {
    const scope='owner-tucked';const app=await setup({width:390,height:844},{rows:TUCKED});const {page,errors}=app;
    await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});await engine(page);
    await page.waitForFunction(()=>document.body.hasAttribute('data-appbar-admin')&&document.documentElement.hasAttribute('data-front-tucked-owner'),null,{timeout:20000}).catch(()=>{});
    await page.waitForTimeout(600);
    const o=await page.evaluate(()=>({tucked:document.documentElement.hasAttribute('data-front-tucked'),owner:document.documentElement.hasAttribute('data-front-tucked-owner'),main:getComputedStyle(document.getElementById('top')).display,holding:getComputedStyle(document.getElementById('frontHolding')).display,note:getComputedStyle(document.getElementById('frontOwnerNote')).display,robots:(document.querySelector('meta[name="robots"]')||{}).content||'',cabin:!!(window.__MCC_VR&&window.__MCC_VR.viewer)}));
    check(scope,'the house owner still sees his real page, told visitors do not',!o.tucked&&o.owner&&o.main!=='none'&&o.holding==='none'&&o.note!=='none'&&o.cabin,o);
    check(scope,'and the page still asks search engines not to index it',o.robots==='noindex',o);
    check(scope,'no JavaScript errors',errors.length===0,errors);
    await page.screenshot({path:join(OUT,'owner-tucked-390.png')});
    await app.ctx.close();
  }
  /* a signed-in member who is not the owner is a visitor */
  {
    const scope='member-tucked';const app=await setup({width:390,height:844},{owner:false,rows:TUCKED});const {page,errors}=app;
    await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});await engine(page);
    await page.waitForTimeout(3000);
    check(scope,'a signed-in member who is not the house owner gets the holding screen',await page.evaluate(()=>document.documentElement.hasAttribute('data-front-tucked')&&!document.documentElement.hasAttribute('data-front-tucked-owner')));
    check(scope,'no JavaScript errors',errors.length===0,errors);
    await app.ctx.close();
  }
  /* 3. THE OWNER: his M is the real front page, and Control → Create → Front page controls it */
  for(const vp of [{width:390,height:844},{width:1280,height:800}]){
    const scope='owner-'+vp.width;const app=await setup(vp,{});const {page,db,errors}=app;
    await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.body.hasAttribute('data-appbar-admin'),null,{timeout:20000}).catch(()=>{});
    await page.waitForTimeout(800); // the bootstrap answer that used to repaint the M
    const m=await page.evaluate(()=>{const t=document.querySelector('[data-appnav="home"]');return t?{href:t.getAttribute('href'),label:t.getAttribute('aria-label')||'',persp:t.getAttribute('data-perspective')}:null;});
    check(scope,'the owner\'s M is his front page, index.html, never a member card',!!m&&/index\.html$/.test(m.href)&&!m.persp&&!/member-front/.test(m.href),m);
    await page.goto(BASE+'/control.html#create:front-page',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('[data-cfp-root] iframe[data-cfp-frame]',{timeout:30000});
    const frame=()=>page.frames().find(f=>{try{return /\/index\.html$/.test(new URL(f.url()).pathname)}catch{return false}});   // a frame still loading has an empty URL
    await page.waitForFunction(()=>document.querySelector('[data-cfp-form] [name="scenes.night"]'),null,{timeout:40000});
    let fr=frame();
    check(scope,'the preview is the real index.html, running its own scroll engine, opening in the cabin',!!fr&&await fr.evaluate(()=>!!(window.MCC_FRONT&&document.getElementById('cabin')&&document.querySelector('#work.command--plane')&&document.getElementById('pillars'))));
    check(scope,'it says the live page is as shipped',/Live: the page as shipped/.test(await page.textContent('[data-cfp-status]')));
    await page.waitForTimeout(1500);await page.screenshot({path:join(OUT,`front-page-open-${vp.width}.png`)});
    if(vp.width>=1100){
      const fitBox=await page.evaluate(async()=>{const st=document.querySelector('.cfp-stage');window.scrollTo({top:st.getBoundingClientRect().top+scrollY-8,behavior:'instant'});await new Promise(r=>setTimeout(r,300));
        const s=st.getBoundingClientRect(),p=document.querySelector('.cfp-panel'),b=document.querySelector('.appbar');
        return {top:Math.round(s.top),bottom:Math.round(s.bottom),bar:b?Math.round(b.getBoundingClientRect().top):innerHeight,panel:Math.round(p.getBoundingClientRect().height),stage:Math.round(s.height),scrolls:p.scrollHeight>p.clientHeight};});
      check(scope,'beside the settings, the whole stage fits the window above the house bar, and the settings scroll beside it at the same height',fitBox.top>=0&&fitBox.bottom<=fitBox.bar&&Math.abs(fitBox.panel-fitBox.stage)<=2&&fitBox.scrolls,fitBox);
      await page.screenshot({path:join(OUT,`front-page-fit-${vp.width}.png`)});
      const chips=await page.evaluate(()=>[...document.querySelectorAll('[data-cfp-go]')].every(b=>{const r=b.getBoundingClientRect(),c=b.parentElement.getBoundingClientRect();return r.right<=c.right+1&&r.width>0;}));
      check(scope,'every scene button is whole on screen',chips);
      /* the desktop size: the same page laid out at 1280, scaled into the room */
      await page.click('[data-cfp-device="desktop"]');
      await page.waitForFunction(()=>{const f=document.querySelector('[data-cfp-frame]');return f&&f.offsetWidth===1280;},null,{timeout:15000}).catch(()=>{});
      await page.waitForFunction(()=>document.querySelector('[data-cfp-form] [name="scenes.night"]'),null,{timeout:40000}).catch(()=>{});
      const desk=await page.evaluate(()=>{const d=document.querySelector('.cfp-device').getBoundingClientRect(),v=document.querySelector('.cfp-viewport').getBoundingClientRect(),f=document.querySelector('[data-cfp-frame]');return {iw:f.offsetWidth,dw:Math.round(d.width),vw:Math.round(v.width)};});
      check(scope,'Desktop shows the page laid out at 1280, scaled to fit',desk.iw===1280&&desk.dw<=desk.vw+1,desk);
      await page.waitForTimeout(1500);await page.screenshot({path:join(OUT,`front-page-desktop-${vp.width}.png`)});
      await page.click('[data-cfp-device="phone"]');
      await page.waitForFunction(()=>document.querySelector('[data-cfp-frame]').offsetWidth===390,null,{timeout:15000}).catch(()=>{});
      await page.waitForFunction(()=>document.querySelector('[data-cfp-form] [name="scenes.night"]'),null,{timeout:40000}).catch(()=>{});
      await page.evaluate(()=>window.scrollTo(0,0));}
    const box=await page.evaluate(()=>{const d=document.querySelector('.cfp-device').getBoundingClientRect(),v=document.querySelector('.cfp-viewport').getBoundingClientRect(),f=document.querySelector('[data-cfp-frame]');return {dw:Math.round(d.width),vw:Math.round(v.width),iw:f.offsetWidth};});
    check(scope,'the frame lays the page out at the device\'s own width and fits the room',box.iw===390&&box.dw<=box.vw+1,box);
    fr=frame();   // a size change reloads the frame: the page in it now
    await fr.waitForFunction(()=>window.MCC_FRONT&&window.__MCC_FRONT_GOTO,null,{timeout:30000});
    /* scenes and feel, shown in the preview before anything is saved */
    await page.click('[data-cfp-form] [name="scenes.night"]');
    await fr.waitForFunction(()=>document.getElementById('pillars').hasAttribute('data-front-off'),null,{timeout:8000}).catch(()=>{});
    check(scope,'turning the night descent off takes it out of the preview at once',await fr.evaluate(()=>getComputedStyle(document.getElementById('pillars')).display==='none'&&window.MCC_FRONT.source==='preview'));
    check(scope,'and nothing is saved yet: the status says the change is only in the preview',db.sets.length===0&&/unsaved changes/.test(await page.textContent('[data-cfp-status]')));
    await page.selectOption('[data-cfp-form] [name="feel"]','quick');
    await fr.waitForFunction(()=>window.MCC_FRONT.config.scroll.duration===0.55,null,{timeout:8000}).catch(()=>{});
    check(scope,'a Quick scroll feel reaches the preview\'s scroll engine',await fr.evaluate(()=>window.MCC_FRONT.config.scroll.duration===0.55&&window.MCC_FRONT.config.scroll.touchLerp===0.22));
    check(scope,'the editor offers the start scene, the song, the visibility switch and the cabin\'s settings, and still names the project page',
      await page.locator('[data-cfp-form] a[href="front.html?project=vaunt"]').count()===1&&await page.inputValue('[data-cfp-form] [name="start"]')==='cabin'&&await page.inputValue('[data-cfp-form] [name="song"]')==='antisocial'&&await page.locator('[data-cfp-form] [name="visible"]').isChecked()&&await page.locator('[data-cfp-form] [name="vr.yaw"]').count()===1&&await page.locator('.cfp-spot').count()===3);
    /* the song: still one song, now another, at once in the preview */
    await page.selectOption('[data-cfp-form] [name="song"]','here');
    await fr.waitForFunction(()=>window.MCC_FRONT.config.song==='here',null,{timeout:8000}).catch(()=>{});
    check(scope,'choosing another song reaches the preview',await fr.evaluate(()=>window.MCC_FRONT.config.song==='here'));
    await page.selectOption('[data-cfp-form] [name="song"]','antisocial');
    await fr.waitForFunction(()=>window.MCC_FRONT.config.song==='antisocial',null,{timeout:8000}).catch(()=>{});
    /* the start scene: on the plane, the cabin leaves the page; back to the cabin, it returns */
    await page.selectOption('[data-cfp-form] [name="start"]','plane');
    await fr.waitForFunction(()=>document.getElementById('cabin').hasAttribute('data-front-off'),null,{timeout:8000}).catch(()=>{});
    check(scope,'opening on the plane takes the cabin out of the preview',await fr.evaluate(()=>getComputedStyle(document.getElementById('cabin')).display==='none'&&window.MCC_FRONT.config.start==='plane'));
    await page.selectOption('[data-cfp-form] [name="start"]','cabin');
    await fr.waitForFunction(()=>!document.getElementById('cabin').hasAttribute('data-front-off')&&window.__MCC_VR&&window.__MCC_VR.viewer,null,{timeout:15000}).catch(()=>{});
    check(scope,'and the cabin comes back first',await fr.evaluate(()=>!document.getElementById('cabin').hasAttribute('data-front-off')&&window.MCC_FRONT.config.start==='cabin'));
    /* the cabin: take its view, and a bad link is refused by the page */
    await page.click('[data-cfp-go="cabin"]');
    await fr.waitForFunction(()=>window.__MCC_VR&&window.__MCC_VR.viewer,null,{timeout:15000}).catch(()=>{});
    await fr.evaluate(()=>{const v=window.__MCC_VR.viewer;v.state.yaw=30*Math.PI/180;v.state.pitch=-10*Math.PI/180;});
    await page.click('[data-cfp="view"]');
    await page.waitForFunction(()=>document.querySelector('[data-cfp-form] [name="vr.yaw"]').value==='30',null,{timeout:8000}).catch(()=>{});
    check(scope,'"Use the preview\'s view" takes the cabin\'s current view as its opening view',await page.inputValue('[data-cfp-form] [name="vr.yaw"]')==='30'&&await page.inputValue('[data-cfp-form] [name="vr.pitch"]')==='-10');
    await page.fill('[data-cfp-form] [name="spot.0.href"]','javascript:alert(1)');
    await page.dispatchEvent('[data-cfp-form] [name="spot.0.href"]','change');
    await page.waitForFunction(()=>document.querySelector('.cfp-spot.is-bad'),null,{timeout:8000}).catch(()=>{});
    await fr.waitForFunction(()=>window.MCC_FRONT.config.vr.spots.length===2,null,{timeout:8000}).catch(()=>{});
    const refused=await page.evaluate(()=>({tags:document.querySelectorAll('.cfp-spot').length,bad:[...document.querySelectorAll('.cfp-spot.is-bad')].map(x=>x.textContent),save:document.querySelector('[data-cfp="save"]').disabled,draft:window.CR.frontPage.state.draft.vr.spots.map(s=>s.href)}));
    const shown=await fr.evaluate(()=>window.MCC_FRONT.config.vr.spots.map(s=>s.href));
    check(scope,'a script link is refused: the tag stays in the form, says why, and Save waits',refused.tags===3&&refused.bad.length===1&&/link must be a page on this site/.test(refused.bad[0])&&refused.save===true&&refused.draft[0]==='javascript:alert(1)',refused);
    check(scope,'and the preview leaves that tag out, keeping the other two',JSON.stringify(shown)==='["hire.html","matthew-mccluster.html"]',shown);
    await page.fill('[data-cfp-form] [name="spot.0.href"]','sites.html');
    await page.dispatchEvent('[data-cfp-form] [name="spot.0.href"]','change');
    await page.waitForFunction(()=>!document.querySelector('.cfp-spot.is-bad')&&!document.querySelector('[data-cfp="save"]').disabled,null,{timeout:8000}).catch(()=>{});
    await fr.waitForFunction(()=>window.MCC_FRONT.config.vr.spots.length===3,null,{timeout:8000}).catch(()=>{});
    check(scope,'fixed, the tag is back in the preview and Save is open',await fr.evaluate(()=>window.MCC_FRONT.config.vr.spots[0].href==='sites.html')&&!(await page.locator('[data-cfp="save"]').isDisabled()));
    /* TUCK AWAY: the owner's preview keeps his page; "See it as a visitor" shows the holding screen */
    const honest=await page.textContent('[data-cfp-honest]');
    check(scope,'the switch says plainly it hides the page and does not make it secret (a static site)',/does not make it secret/.test(honest)&&/static site on GitHub Pages/.test(honest)&&/noindex/.test(honest),honest);
    await page.click('[data-cfp-form] [name="visible"]');
    await fr.waitForFunction(()=>window.MCC_FRONT.config.visible===false&&document.documentElement.hasAttribute('data-front-tucked-owner'),null,{timeout:8000}).catch(()=>{});
    check(scope,'tucked away, the owner\'s preview still shows his real page, marked for him',await fr.evaluate(()=>!document.documentElement.hasAttribute('data-front-tucked')&&document.documentElement.hasAttribute('data-front-tucked-owner')&&getComputedStyle(document.getElementById('top')).display!=='none'));
    await page.click('[data-cfp="viewas"]');
    await fr.waitForFunction(()=>document.documentElement.hasAttribute('data-front-tucked'),null,{timeout:8000}).catch(()=>{});
    check(scope,'"See it as a visitor" shows the holding screen in the preview',await fr.evaluate(()=>document.documentElement.hasAttribute('data-front-tucked')&&getComputedStyle(document.getElementById('frontHolding')).display!=='none'&&getComputedStyle(document.getElementById('top')).display==='none'));
    await page.waitForTimeout(400);await page.screenshot({path:join(OUT,`front-page-tucked-${vp.width}.png`)});
    await page.click('[data-cfp-form] [name="visible"]');
    await fr.waitForFunction(()=>window.MCC_FRONT.config.visible===true&&!document.documentElement.hasAttribute('data-front-tucked')&&!document.documentElement.hasAttribute('data-front-tucked-owner'),null,{timeout:8000}).catch(()=>{});
    check(scope,'unhidden, the page is everyone\'s again',await fr.evaluate(()=>window.MCC_FRONT.config.visible===true&&!document.documentElement.hasAttribute('data-front-tucked')&&!document.querySelector('meta[name="robots"][data-front-robots]')));
    await page.click('[data-cfp-form] [name="visible"]');
    await fr.waitForFunction(()=>window.MCC_FRONT.config.visible===false,null,{timeout:8000}).catch(()=>{});
    /* the World at the end is a guests' scene: the preview shows it as a guest would, and its button goes there */
    await fr.waitForFunction(()=>!document.getElementById('guestWorld').hidden,null,{timeout:8000}).catch(()=>{});
    await page.click('[data-cfp-go="world"]');
    await page.waitForTimeout(600);
    /* the page's own scroll engine carries the preview there; on a slow renderer that takes longer than 600 ms */
    await fr.waitForFunction(()=>Math.abs(document.getElementById('guestWorld').getBoundingClientRect().top)<=4,null,{timeout:10000}).catch(()=>{});
    const world=await fr.evaluate(()=>{const g=document.getElementById('guestWorld');return {hidden:g.hidden,h:g.offsetHeight,top:Math.round(g.getBoundingClientRect().top)};});
    check(scope,'the preview shows the guests\' World, and the World button goes to it',!world.hidden&&world.h>0&&Math.abs(world.top)<=4,world);
    check(scope,'no horizontal overflow',(await overflow(page))===0,await overflow(page));
    await page.screenshot({path:join(OUT,`front-page-${vp.width}.png`),fullPage:vp.width<1000});
    /* save: what the page applied goes to site_content, with the owner's session */
    await page.click('[data-cfp="save"]');
    await page.waitForFunction(()=>/Saved\./.test(document.querySelector('[data-cfp-status]').textContent),null,{timeout:10000}).catch(()=>{});
    const set=db.sets[0],v=set?JSON.parse(set.body.p_value):null;
    check(scope,'Save writes one row, index.html @front, with the owner\'s session',db.sets.length===1&&set.body.p_page==='index.html'&&set.body.p_slot==='@front'&&set.body.p_kind==='text'&&/^Bearer x\./.test(set.auth),set&&set.body);
    check(scope,'what is saved is what the page applied: night off, Quick, tucked away, the cabin first with Antisocial, the taken view, the three tags with the fixed link',!!v&&v.scenes.night===false&&v.scroll.duration===0.55&&v.visible===false&&v.start==='cabin'&&v.song==='antisocial'&&v.vr.yaw===30&&v.vr.pitch===-10&&JSON.stringify(v.vr.spots.map(s=>s.href))==='["sites.html","hire.html","matthew-mccluster.html"]',v);
    check(scope,'the status says it is live',/Live: your settings, saved/.test(await page.textContent('[data-cfp-status]')));
    /* the analytics of the page in the frame stay off: the owner's look is not a visit */
    /* inside the frame the recorder is the do-nothing one (js/analytics.js mccControlPreview), and nothing was sent from it */
    const rec=await fr.evaluate(()=>({noop:typeof window.MCC_TRACK==='function'&&window.MCC_TRACK('page_view',{})===false,sense:!!window.MCC_SENSE}));
    check(scope,'the preview records no visit: the frame\'s recorder is off and sent nothing',rec.noop&&!rec.sense&&!db.collects.some(u=>/^framed:/.test(u)),{rec,collects:db.collects});
    /* reset deletes the row */
    await page.click('[data-cfp="reset"]');
    await page.waitForFunction(()=>/Reset\./.test(document.querySelector('[data-cfp-status]').textContent),null,{timeout:10000}).catch(()=>{});
    check(scope,'Reset deletes the row and the page is as shipped again',db.reverts.length===1&&db.reverts[0].p_page==='index.html'&&db.reverts[0].p_slot==='@front'&&db.rows.length===0&&/Live: the page as shipped/.test(await page.textContent('[data-cfp-status]')));
    await fr.waitForFunction(()=>!document.getElementById('pillars').hasAttribute('data-front-off'),null,{timeout:8000}).catch(()=>{});
    check(scope,'and the preview shows every scene again, public',await fr.evaluate(()=>!document.querySelector('[data-front-off]')&&!document.documentElement.hasAttribute('data-front-tucked')&&!document.documentElement.hasAttribute('data-front-tucked-owner')));
    check(scope,'no JavaScript errors',errors.length===0,errors);
    await app.ctx.close();
  }
}finally{await browser.close();}
const failed=results.filter(r=>!r.pass);
console.log(`\n${results.length-failed.length}/${results.length} checks passed. Screenshots in ${OUT}`);
process.exit(failed.length?1:0);
