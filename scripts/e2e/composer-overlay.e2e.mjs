/* Actual World and advanced Create documents with intercepted auth/API. No live posts. */
import {createRequire} from 'node:module';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, join, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/composer-overlay-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const BASE='https://matthew.mccluster.org', USER='11111111-1111-4111-8111-111111111111';
const MIME={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const results=[];
function check(name,ok,detail){results.push({name,pass:!!ok});console.log((ok?'PASS ':'FAIL ')+name+(ok?'':' '+JSON.stringify(detail)));assert.ok(ok,name);}
await mkdir(OUT,{recursive:true});
async function setup(width,persona='owner'){
  const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});
  const auth={external:false,postRequests:[],posts:new Map(),media:new Map(),holdGrant:false,grantRelease:null,dropPost:false,partialPost:false,holdToken:false,tokenFail:false,tokenRelease:null,externalFail:false,status:persona==='owner'?200:403,signed:persona!=='guest',delay:false,release:null},calls=[],errors=[];
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
        if(auth.holdToken)await new Promise(resolve=>{auth.tokenRelease=resolve;auth.tokenStarted?.();});
        if(auth.tokenFail)return json(r,{error:'Fixture refresh failed'},401);
        const exp=Math.floor(Date.now()/1000)+3600;
        return json(r,{access_token:'x.'+Buffer.from(JSON.stringify({sub:USER,exp,email:'qa@fixture.invalid',iat:123})).toString('base64url')+'.y',expires_at:exp,refresh_token:'fixture-only',user:{id:USER,email:'qa@fixture.invalid'}});
      }
      return json(r,p==='/auth/v1/user'?{id:USER,email:'qa@fixture.invalid'}:[]);
    }
    if(u.hostname==='api.mccluster.org'){
      if(p==='/v1/creator-billing/entitlement')return json(r,{workspaces:auth.external?[{org_id:'44444444-4444-4444-8444-444444444444'}]:[]});
      if(p==='/v1/customer-social/status')return json(r,{configured:true,capability:{eligible:auth.external,can_publish:auth.external,formats:['instagram_reels']},connection:{status:'connected',account_id:'55555555-5555-4555-8555-555555555555',handle:'fixture'}});
      if(p==='/v1/mnet/media/upload-url'){
        const b=req.postDataJSON(),id=crypto.randomUUID(),asset={id,media_type:b.mime_type.startsWith('video/')?'video':'image',mime_type:b.mime_type};auth.media.set(id,asset);
        if(auth.holdGrant)await new Promise(resolve=>{auth.grantRelease=resolve;auth.grantStarted?.();});
        return json(r,{asset,upload:{path:USER+'/'+id,token:'fixture'}});
      }
      if(p==='/v1/mnet/media/finalize')return json(r,{asset:auth.media.get(req.postDataJSON().asset_id)});
      if(p==='/v1/mnet/media/drafts')return json(r,{assets:u.searchParams.get('ids').split(',').map(id=>auth.media.get(id)).filter(Boolean)});
      if(p==='/v1/mnet/deliveries')return json(r,{deliveries:Array.from(auth.posts.values()).map(out=>out.delivery).filter(Boolean)});
      if(p.startsWith('/v1/customer-social/deliveries/')&&p.endsWith('/submit')){if(auth.externalFail){auth.externalFail=false;return json(r,{error:'Fixture provider unavailable'},503);}return json(r,{publish_job:{id:'job-fixture',state:'queued'}});}
      if(p==='/v1/mnet/posts'&&req.method()==='POST'){
        const b=req.postDataJSON(),key=b.delivery?.operation_key||crypto.randomUUID();auth.postRequests.push(b);
        if(!auth.posts.has(key)){const out={post:{id:crypto.randomUUID()}};if(b.delivery)out.delivery={id:crypto.randomUUID(),user:USER,key,org:b.delivery.org_id,account:b.delivery.account_id,worldId:out.post.id,state:'draft'};auth.posts.set(key,out);}
        if(auth.dropPost){auth.dropPost=false;return r.abort('failed');}if(auth.partialPost){auth.partialPost=false;return json(r,{post:auth.posts.get(key).post});}return json(r,auth.posts.get(key));
      }
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
  const page=await ctx.newPage();page.on('pageerror',error=>{errors.push(error.message);console.log('PAGEERROR',error.message);});
  return {ctx,page,auth,calls,errors};
}
try{
 for(const width of [390,1440]){
  const {ctx,page,errors}=await setup(width,'member');
  await page.goto(BASE+'/mnet.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.MCC_BAR?.auth().verified&&window.MCC_WORLD_OVERLAY&&document.getElementById('mnComposeOpen')?.offsetParent);
  await page.click('#mnComposeOpen');await page.waitForFunction(()=>document.getElementById('mnComposerDialog').open);
  check('one existing composer moved into dialog',await page.locator('#mnComposer').count()===1&&await page.locator('#mnComposerDialog #mnComposer').count()===1);
  await page.fill('#mnPostBody','Retain this local composition');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('mnComposerDialog').open);
  check('Escape restores plus focus and retains draft',await page.locator('#mnPostBody').inputValue()==='Retain this local composition'&&await page.evaluate(()=>document.activeElement.id)==='mnComposeOpen',await page.evaluate(()=>({focus:document.activeElement.id,body:document.getElementById('mnPostBody').value,open:document.getElementById('mnComposerDialog').open})));
  await page.focus('#mnPostBody');await page.waitForFunction(()=>document.getElementById('mnComposerDialog').open);
  await page.goBack();await page.waitForFunction(()=>!document.getElementById('mnComposerDialog').open);
  check('Back closes textarea-opened dialog without reopening',await page.evaluate(()=>document.activeElement.id)==='mnComposeOpen');
  await page.click('#mnComposeOpen');await page.waitForFunction(()=>document.getElementById('mnComposerDialog').open);await page.getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('mnComposerDialog').open);
  await page.click('#mnComposeOpen');await page.keyboard.press('Shift+Tab');
  check('native dialog retains keyboard focus',await page.evaluate(()=>document.getElementById('mnComposerDialog').contains(document.activeElement)));
  check('legacy capture/trim destination remains explicit',await page.locator('#mnComposer a[href="create.html"]').textContent()==='Advanced capture / trim');
  check('overlay width is bounded at '+width,await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth&&document.getElementById('mnComposerDialog').getBoundingClientRect().width<=innerWidth));
  await page.screenshot({path:join(OUT,'composer-'+width+'.png')});
  await page.evaluate(()=>window.dispatchEvent(new Event('mcc:auth-changed')));
  check('auth transition closes overlay and cleans only its history marker',await page.evaluate(()=>!document.getElementById('mnComposerDialog').open&&!history.state?.mccComposer));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('mnPostBody').value==='Retain this local composition');
  check('World draft survives reload without opening a second composer',await page.locator('#mnPostBody').inputValue()==='Retain this local composition');
  await page.evaluate(()=>{MCC.user=async()=>({id:'22222222-2222-4222-8222-222222222222'});window.dispatchEvent(new Event('mcc:auth-changed'));});
  check('World account switch clears prior private composition immediately',await page.locator('#mnPostBody').inputValue()==='');
  await page.evaluate(user=>{MCC.user=async()=>({id:user});window.dispatchEvent(new Event('mcc:auth-changed'));},USER);
  await page.waitForFunction(()=>document.getElementById('mnPostBody').value==='Retain this local composition');
  await page.evaluate(()=>{const original=MCC.api;MCC.api=function(path,init){if(path.startsWith('/v1/mnet/posts')&&init?.method==='POST')return Promise.reject(new Error('Response lost after submission'));return original.apply(this,arguments);};});
  await page.click('#mnComposeOpen');await page.click('#mnPost');await page.waitForFunction(()=>document.getElementById('mnDraftStatus').textContent.includes('unconfirmed'));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('mnDraftStatus').textContent.includes('unconfirmed'));
  check('unknown native post remains blocked across reload instead of silently duplicating',await page.locator('#mnPost').isDisabled()&&await page.locator('#mnCompositionRetry').isHidden());
  await page.evaluate(()=>{MCC.user=async()=>({id:'22222222-2222-4222-8222-222222222222'});window.dispatchEvent(new Event('mcc:auth-changed'));});
  await page.waitForFunction(()=>!document.getElementById('mnPost').disabled);
  await page.evaluate(user=>{MCC.user=async()=>({id:user});window.dispatchEvent(new Event('mcc:auth-changed'));},USER);
  await page.waitForFunction(()=>document.getElementById('mnDraftStatus').textContent.includes('unconfirmed'));
  check('account switching does not discard unresolved native identity',await page.locator('#mnPost').isDisabled());
  await page.click('#mnComposeOpen');await page.check('#mnNativeReviewed');await page.click('#mnStartSeparateDraft');
  check('explicit profile-review acknowledgement starts a separate draft and retains prior request',await page.locator('#mnPostBody').inputValue()===''&&!await page.locator('#mnPost').isDisabled()&&await page.locator('#mnReviewedBody').textContent()==='Latest manually reviewed, unconfirmed post: Retain this local composition');

  await page.goto(BASE+'/create.html',{waitUntil:'domcontentloaded'});await page.waitForSelector('#crWrite:visible');
  await page.click('#crWrite');await page.fill('#crCaption','OWNER A PRIVATE DRAFT');
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('crCaption').value==='OWNER A PRIVATE DRAFT');
  check('advanced draft recovers only for verified owner',await page.locator('#crCaption').inputValue()==='OWNER A PRIVATE DRAFT');
  await page.evaluate(()=>{window.MCC.user=async()=>({id:'22222222-2222-4222-8222-222222222222'});window.dispatchEvent(new Event('mcc:auth-changed'));});
  check('account switch clears advanced private text synchronously',await page.locator('#crCaption').inputValue()==='');
  await page.waitForSelector('#crWrite:visible');await page.click('#crWrite');await page.fill('#crCaption','OWNER B DRAFT');await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));
  await page.evaluate(user=>{window.MCC.user=async()=>({id:user});window.dispatchEvent(new Event('mcc:auth-changed'));},USER);
  await page.waitForFunction(()=>document.getElementById('crCaption').value==='OWNER A PRIVATE DRAFT');
  check('switching back restores A instead of B',await page.locator('#crCaption').inputValue()==='OWNER A PRIVATE DRAFT');
  await page.evaluate(()=>{
    const original=MCC.api;window.__mutations=[];
    MCC.api=function(path,init){
      if(init?.method&&init.method!=='GET')__mutations.push({path,method:init.method,body:init.body});
      if(path==='/v1/mnet/media/upload-url')return new Promise(resolve=>window.__releaseGrant=()=>resolve(new Response(JSON.stringify({asset:{id:'33333333-3333-4333-8333-333333333333'},upload:{path:'old-owner/photo.png',token:'fixture'}}),{status:200})));
      return original.apply(this,arguments);
    };
  });
  await page.setInputFiles('#crLibrary',join(ROOT,'assets/img/equity-uprise-mark.png'));
  await page.waitForFunction(()=>typeof window.__releaseGrant==='function');await page.click('#crEditNext');await page.fill('#crCaption','OLD OWNER MUST NEVER POST AS NEW OWNER');await page.click('#crPost');
  await page.evaluate(()=>{MCC.user=async()=>({id:'22222222-2222-4222-8222-222222222222'});window.dispatchEvent(new Event('mcc:auth-changed'));__releaseGrant();});
  await page.waitForFunction(()=>document.getElementById('crCaption').value==='OWNER B DRAFT');
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
  check('account switch during pending post upload prevents old post, finalize and foreign cleanup',await page.evaluate(()=>__mutations.length===1&&__mutations[0].path==='/v1/mnet/media/upload-url'),await page.evaluate(()=>__mutations));
  check('old upload result cannot repaint new account draft or busy state',await page.evaluate(()=>document.getElementById('crCaption').value==='OWNER B DRAFT'&&!document.getElementById('crPost').disabled));
  check('documents have no uncaught errors',errors.length===0,errors);
  await ctx.close();
 }
 // Combined response lost after commit: reload replays the same payload/key on the existing outbox.
 {
  const {ctx,page,auth,errors}=await setup(390,'member');auth.external=true;auth.dropPost=true;auth.externalFail=true;
  const reel=join(OUT,'fixture-reel.mp4');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x160:d=1','-an','-c:v','libx264','-pix_fmt','yuv420p','-y',reel]);
  await page.goto(BASE+'/mnet.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!document.getElementById('mnExternalOptIn').disabled);
  await page.click('#mnComposeOpen');await page.fill('#mnPostBody','One World post, one durable delivery');await page.setInputFiles('#mnMediaInput',reel);
  await page.waitForFunction(()=>document.getElementById('mnMediaStatus').textContent.includes('ready.'));
  await page.locator('#mnExternalDestinations').evaluate(el=>el.open=true);await page.check('#mnExternalOptIn');await page.click('#mnPost');await page.waitForFunction(()=>document.getElementById('mnDraftStatus').textContent.includes('unconfirmed'));
  check('lost combined response leaves one server post and a retained operation key',auth.posts.size===1&&auth.postRequests.length===1);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!document.getElementById('mnCompositionRetry').hidden);
  auth.partialPost=true;await page.click('#mnComposeOpen');await page.click('#mnCompositionRetry');await page.waitForFunction(()=>document.getElementById('mnDraftStatus').textContent.includes('incomplete'));
  check('partial successful response retains the unresolved key and blocks a new post',await page.locator('#mnPost').isDisabled()&&auth.posts.size===1);
  await page.click('#mnCompositionRetry');await page.getByRole('button',{name:'Retry Instagram only'}).waitFor();
  check('reload recovery replays byte-equivalent request with original key and no duplicate World post',auth.posts.size===1&&auth.postRequests.length===3&&auth.postRequests.every(r=>JSON.stringify(r)===JSON.stringify(auth.postRequests[0])));
  await page.getByRole('button',{name:'Retry Instagram only'}).click();await page.getByRole('button',{name:'Refresh Instagram status'}).waitFor();
  check('external-only retry never creates a second World post',auth.posts.size===1&&auth.postRequests.length===3);
  check('combined recovery has no uncaught errors',errors.length===0,errors);await ctx.close();
 }
 // A delayed session refresh must not send an old caption using the new account's bearer.
 {
  const {ctx,page,calls}=await setup(390,'member');await page.goto(BASE+'/create.html',{waitUntil:'domcontentloaded'});await page.waitForSelector('#crWrite:visible');await page.click('#crWrite');await page.fill('#crCaption','DO NOT SEND UNDER ACCOUNT B');
  await page.evaluate(()=>{MCC.refreshIfNeeded=()=>new Promise(resolve=>window.__releaseRefresh=resolve);});await page.click('#crPost');await page.waitForFunction(()=>typeof window.__releaseRefresh==='function');
  await page.evaluate(()=>{const id='22222222-2222-4222-8222-222222222222',exp=Math.floor(Date.now()/1000)+3600,s={access_token:'x.'+btoa(JSON.stringify({sub:id,exp}))+'.y',expires_at:exp,user:{id}};localStorage.setItem('mccdb_session',JSON.stringify(s));MCC.user=async()=>({id});window.dispatchEvent(new Event('mcc:auth-changed'));__releaseRefresh(s);});
  await page.waitForSelector('#crWrite:visible');await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,50)));
  check('session-refresh account switch blocks the mutation before fetch',!calls.some(c=>c.method==='POST'&&new URL(c.url).pathname==='/v1/mnet/posts'));await ctx.close();
 }
 // Cancellation and switching accounts during a native upload use the actual World uploader.
 for(const mode of ['cancel','switch']){
  const {ctx,page,auth,calls,errors}=await setup(390,'member');auth.holdGrant=true;
  await page.goto(BASE+'/mnet.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.MCC_BAR?.auth().verified&&!document.getElementById('mnPost').disabled);await page.click('#mnComposeOpen');await page.fill('#mnPostBody','Keep my composition');
  const reserved=new Promise(resolve=>auth.grantStarted=resolve);await page.setInputFiles('#mnMediaInput',join(ROOT,'assets/img/equity-uprise-mark.png'));await reserved;
  if(mode==='cancel')await page.click('#mnUploadCancel');else await page.evaluate(()=>{MCC.user=async()=>({id:'22222222-2222-4222-8222-222222222222'});window.dispatchEvent(new Event('mcc:auth-changed'));});
  const completed=page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/mnet/media/upload-url');auth.grantRelease();await completed;await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
  const mutations=calls.filter(c=>c.method!=='GET'&&c.method!=='OPTIONS');
  check(mode+' during World upload prevents finalize and late attachment',!mutations.some(c=>new URL(c.url).pathname==='/v1/mnet/media/finalize')&&await page.locator('#mnMediaQueue [data-remove-media]').count()===0);
  check(mode+' preserves correct account text and cleanup authority',mode==='cancel'?await page.locator('#mnPostBody').inputValue()==='Keep my composition':await page.locator('#mnPostBody').inputValue()===''&&!mutations.some(c=>new URL(c.url).pathname==='/v1/mnet/media/discard'));
  check(mode+' upload has no uncaught errors',errors.length===0,errors);await ctx.close();
 }
 // The refresh implementation itself must not overwrite or clear a newer session.
 for(const tokenFail of [false,true]){
  const {ctx,page,auth}=await setup(390,'member');await page.goto(BASE+'/create.html',{waitUntil:'domcontentloaded'});await page.waitForSelector('#crWrite:visible');auth.holdToken=true;auth.tokenFail=tokenFail;
  const requested=new Promise(resolve=>auth.tokenStarted=resolve);await page.evaluate(()=>{window.__refresh=MCC.refresh();});await requested;
  await page.evaluate(()=>{const id='22222222-2222-4222-8222-222222222222',exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({sub:id,exp}))+'.y',expires_at:exp,refresh_token:'new-account-fixture',user:{id}}));});auth.tokenRelease();
  check('late old-account refresh '+(tokenFail?'failure':'success')+' preserves the new signed-in session',await page.evaluate(async()=>{const s=await __refresh;return s.user.id==='22222222-2222-4222-8222-222222222222'&&MCC.session().user.id===s.user.id;}));await ctx.close();
 }
 {
  const {ctx,page,calls}=await setup(390,'member');await page.goto(BASE+'/mnet.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.MCC_BAR?.auth().verified&&!document.getElementById('mnPost').disabled);await page.click('#mnComposeOpen');
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('Fixture storage unavailable');};});await page.fill('#mnPostBody','Keep in this tab only');await page.click('#mnPost');
  check('unavailable draft storage is explicit and prevents an unrecoverable post',await page.locator('#mnDraftStatus').textContent()==='Draft stays in this tab. Browser storage is unavailable.'&&!calls.some(c=>c.method==='POST'&&new URL(c.url).pathname==='/v1/mnet/posts'));
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('mnComposerDialog').open);check('closing with unavailable storage retains in-memory text without promising a save',await page.locator('#mnPostBody').inputValue()==='Keep in this tab only');await ctx.close();
 }
}finally{await browser.close();}
