/* Real HTMLAudioElement playback against synthetic WAV bytes and the actual
   Music/World documents. No production API, account or audio request escapes
   the route fixtures. The globe renderer itself is covered by World suites. */
import {createRequire} from 'node:module';
import { withTravelAndMissions } from './world-switch.mjs';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, join, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/music-world-continuity-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--autoplay-policy=document-user-activation-required']});
/* THE BACK/FORWARD CACHE NEEDS THE FULL BROWSER. Playwright's default headless shell has none, and Playwright switches
   the cache off besides (--disable-back-forward-cache). The restore scenarios at the end run in a second browser, the
   full Chromium in its own headless mode with the cache left on, started only when they are reached. A restored
   document fires pageshow and no load event, so those scenarios wait on 'commit'. */
const FULL=process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined;
let keeper=null;
const HOUSE='https://matthew.mccluster.org',WORLD='https://mccluster.org';
const USER='11111111-1111-4111-8111-111111111111';
/* WATCH runs in every document before any script of the page. It keeps the first moment at which the page was NOT
   behind the wall while the visitor had NOT agreed (fx_exposed; the Privacy Policy is readable before any answer, so it
   is not counted), at which the question could be answered (fx_asked) and at which a session was stored (fx_signed), in
   sessionStorage so a reload does not forget what the first document showed; and each pageshow, with whether the
   browser restored the document, and each window focus it was given. */
const WATCH=()=>{
  const mark=k=>{try{if(!sessionStorage.getItem(k))sessionStorage.setItem(k,String(Date.now()));}catch(e){}};
  const look=()=>{
    if(!window.MCC_PRIVACY||!document.body)return;
    let agreed=false;try{agreed=!!MCC_PRIVACY.accepted();}catch(e){}
    if(!agreed&&!/\/privacy\.html$/.test(location.pathname)&&document.documentElement.getAttribute('data-privacy-gate')!=='pending')mark('fx_exposed');
    const agree=document.getElementById('mccPrivacyAgree');
    if(agree&&agree.getClientRects().length)mark('fx_asked');
    try{if(localStorage.getItem('mccdb_session'))mark('fx_signed');}catch(e){}
  };
  /* observed from the document node: this runs before the page has a root element */
  new MutationObserver(look).observe(document,{subtree:true,attributes:true,attributeFilter:['data-privacy-gate']});
  (function tick(){look();requestAnimationFrame(tick);})();
  window.__shows=[];window.__focuses=0;
  addEventListener('pageshow',e=>window.__shows.push(e.persisted));
  addEventListener('focus',()=>window.__focuses++);
};
const MIME={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'};
const result=[];
await mkdir(OUT,{recursive:true});
function check(name,pass,detail){result.push({name,pass:!!pass});console.log(`${pass?'PASS':'FAIL'} ${name}${pass?'':' '+JSON.stringify(detail)}`);assert.ok(pass,name);}
function wav(seconds=24){
  const rate=8000,count=rate*seconds,b=Buffer.alloc(44+count*2);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*220*i/rate)*1000),44+i*2);
  return b;
}
const AUDIO=wav();
const IMAGE=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
function token(origin){return 'x.'+Buffer.from(JSON.stringify({sub:USER,exp:Math.floor(Date.now()/1000)+3600,email:'audio-fixture@invalid.test',origin})).toString('base64url')+'.y';}
async function setup(width=390,member=false,{parentScript,privacy=true,start='/listen.html',from=browser,watch=false}={}){
  const context=await from.newContext({viewport:{width,height:844},hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});
  const requests=[],messages=[],errors=[];
  if(watch)await context.addInitScript(WATCH);
  await context.addInitScript(({HOUSE,member,token,privacy})=>{
    if(privacy)localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(member&&location.origin===HOUSE&&!localStorage.getItem('mccdb_session'))localStorage.setItem('mccdb_session',JSON.stringify({access_token:token,refresh_token:'fixture-house-refresh',expires_at:Math.floor(Date.now()/1000)+3600}));
    const NativeAudio=window.Audio;
    window.__audioObjects=[];window.__audioEvents=[];window.__unloads=0;window.__bridgeMessages=[];
    window.Audio=function(...args){const a=new NativeAudio(...args);window.__audioObjects.push(a);for(const type of ['play','pause','emptied','seeking'])a.addEventListener(type,()=>window.__audioEvents.push({type,src:a.currentSrc||a.src,time:a.currentTime}));return a;};
    window.Audio.prototype=NativeAudio.prototype;
    addEventListener('beforeunload',()=>window.__unloads++);
    addEventListener('message',e=>{if(e.data?.channel==='mcc-world-audio-v1')window.__bridgeMessages.push(e.data);});
  },{HOUSE,member,token:token(HOUSE),privacy});
  const json=(r,body,status=200)=>r.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
  await context.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url()),p=u.pathname;requests.push({url:u.href,method:req.method(),authorization:req.headers().authorization});
    if(req.method()==='OPTIONS')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.hostname==='api.mccluster.org'){
      if(p==='/v1/auth/handoff')return json(r,{token_hash:'fixture-one-use-hash'});
      if(p==='/v1/status')return json(r,{ok:false},403);
      if(p==='/v1/mnet/bootstrap')return json(r,{ok:true,profile:{display_name:'Fixture member',onboarding_complete:true},identity:{mccluster_id:'fixture-member'},needs_onboarding:false,stats:{}});
      return json(r,{ok:true,threads:[],posts:[],events:[],missions:[],layers:[],features:[],sources:[],locations:[],rights:{}});
    }
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/verify')return json(r,{access_token:token(WORLD),refresh_token:'fixture-world-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:USER,email:'audio-fixture@invalid.test'}});
      if(p==='/auth/v1/user')return json(r,{id:USER,email:'audio-fixture@invalid.test'});
      return json(r,[]);
    }
    if([HOUSE,WORLD].includes(u.origin)){
      if(u.origin===HOUSE&&p==='/js/world-audio-continuity.js'&&parentScript&&await parentScript()===false)return r.abort();
      if(p.startsWith('/assets/audio/')){
        const range=/bytes=(\d+)-(\d*)/.exec(req.headers().range||'');
        if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||AUDIO.length-1),AUDIO.length-1);return r.fulfill({status:206,contentType:'audio/wav',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${AUDIO.length}`},body:AUDIO.subarray(start,end+1)});}
        return r.fulfill({status:200,contentType:'audio/wav',headers:{'accept-ranges':'bytes'},body:AUDIO});
      }
      const path=resolve(ROOT,'.'+(p==='/'?'/mnet.html':decodeURIComponent(p)));
      if(path.startsWith(resolve(ROOT)+sep)){
        /* the World's first touch here is Travel's Where to, so this suite drives the World with Travel switched on */
        try{let body=await readFile(path);if(path===resolve(ROOT,'mnet.html'))body=Buffer.from(withTravelAndMissions(body));return r.fulfill({body,contentType:MIME[extname(path)]||'application/octet-stream'});}catch{}
      }
      if(/\.(?:png|jpe?g|webp|gif)$/.test(p))return r.fulfill({contentType:'image/gif',body:IMAGE});
      return r.fulfill({status:404,body:'Fixture: file absent'});
    }
    return r.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(HOUSE+start,{waitUntil:parentScript?'domcontentloaded':'load'});
  if(start==='/listen.html')await page.waitForFunction(ready=>(!ready||!!window.MCC_WORLD_AUDIO)&&!!window.MCC_MUSIC&&!!window.MCC_BAR&&document.querySelector('[data-music-play][data-album="here"]'),!parentScript);
  return {context,page,requests,messages,errors};
}
async function play(page,album='here',title='Who Did The Shoot'){
  const selector=`[data-music-play][data-album=${JSON.stringify(album)}][data-track=${JSON.stringify(title)}]`;
  await page.locator(selector).first().click();
  await page.waitForFunction(()=>MCC_MUSIC.current()&&!MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.currentTime>.15);
}
async function world(page){
  await page.locator('.appbar [data-appnav="world"]').click();
  await page.waitForFunction(()=>MCC_WORLD_AUDIO.active());
  const frame=await (await page.$('#mccWorldAudioFrame')).contentFrame();
  await frame.locator('body[data-world-audio-child="ready"]').waitFor();
  await page.locator('.world-audio-status').waitFor({state:'hidden'});
  return frame;
}
async function audioState(page){return page.evaluate(()=>({time:MCC_MUSIC.audio.currentTime,src:MCC_MUSIC.audio.currentSrc,paused:MCC_MUSIC.audio.paused,muted:MCC_MUSIC.audio.muted,playing:__audioObjects.filter(a=>!a.paused).length,unloads:__unloads}));}
try{
  {
    let release;
    const held=new Promise(resolve=>release=resolve);
    const {context,page}=await setup(390,false,{parentScript:()=>held});
    await play(page);
    await page.evaluate(()=>{window.__originalAudio=MCC_MUSIC.audio;window.__earlyTransitions=[];for(const type of ['pause','emptied','seeking'])__originalAudio.addEventListener(type,()=>__earlyTransitions.push(type));});
    const before=await audioState(page);
    await page.locator('.appbar [data-appnav="world"]').click();
    await page.locator('#mccWorldAudioLoading').waitFor();
    await page.waitForTimeout(650);const pending=await audioState(page);
    check('early Globe tap waits for its helper without unloading or interrupting Music',await page.evaluate(()=>!window.MCC_WORLD_AUDIO&&__unloads===0)&&pending.src===before.src&&!pending.paused&&pending.time>before.time+.4,pending);
    release(true);
    await page.waitForFunction(()=>window.MCC_WORLD_AUDIO?.active());
    await page.locator('.world-audio-status').waitFor({state:'hidden'});
    check('delayed helper opens World with the exact advancing Audio element and no reset',await page.evaluate(()=>__originalAudio===MCC_MUSIC.audio&&__unloads===0&&__earlyTransitions.length===0)&&!(await audioState(page)).paused&&(await audioState(page)).time>pending.time);
    check('successful delayed opening removes the loading card',await page.locator('#mccWorldAudioLoading').count()===0);
    await context.close();
  }
  {
    let release,attempts=0;
    const held=new Promise(resolve=>release=resolve);
    const {context,page}=await setup(390,false,{parentScript:()=>++attempts===1?held:Promise.resolve(true)});
    await play(page);await page.evaluate(()=>window.__originalAudio=MCC_MUSIC.audio);
    const before=await audioState(page);
    await page.locator('.appbar [data-appnav="world"]').click();
    release(false);
    await page.locator('[data-world-audio-retry]:visible').waitFor();
    check('helper failure keeps playing Music with visible retry and stay controls',await page.locator('#mccWorldAudioLoading [role="status"]').textContent()==='World could not open.'&&await page.locator('[data-world-audio-cancel]').isVisible()&&await page.evaluate(()=>__originalAudio===MCC_MUSIC.audio&&__unloads===0&&!MCC_MUSIC.audio.paused));
    check('loader recovery fits a phone with usable controls',await page.locator('#mccWorldAudioLoading').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&[...el.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=44);}));
    await page.locator('[data-world-audio-retry]').click();
    await page.waitForFunction(()=>window.MCC_WORLD_AUDIO?.active());
    await page.locator('.world-audio-status').waitFor({state:'hidden'});
    const after=await audioState(page);
    check('retry loads the helper once more and retains the same track',attempts===2&&after.unloads===0&&after.src===before.src&&after.time>before.time&&!after.paused&&await page.evaluate(()=>__originalAudio===MCC_MUSIC.audio),{attempts,before,after});
    await context.close();
  }
  {
    let release;
    const held=new Promise(resolve=>release=resolve);
    const {context,page}=await setup(390,false,{parentScript:()=>held});
    await play(page);await page.evaluate(()=>window.__originalAudio=MCC_MUSIC.audio);
    await page.locator('.appbar [data-appnav="world"]').click();
    await page.locator('[data-world-audio-cancel]').click();
    check('Stay in Music cancels a pending World opening',await page.locator('#mccWorldAudioLoading').count()===0&&await page.evaluate(()=>__unloads===0&&!MCC_MUSIC.audio.paused));
    await page.locator('.appbar [data-appnav="world"]').click();
    await page.locator('.appbar [data-appnav="music"]').click();
    release(true);await page.waitForFunction(()=>!!window.MCC_WORLD_AUDIO);await page.waitForTimeout(100);
    check('explicit Music destination cancels queued World even when its helper arrives later',await page.locator('#mccWorldAudioLoading').count()===0&&await page.evaluate(()=>!MCC_WORLD_AUDIO.active()&&__unloads===0&&__originalAudio===MCC_MUSIC.audio&&!MCC_MUSIC.audio.paused));
    await context.close();
  }
  for(const width of [390,1280]){
    const {context,page,errors}=await setup(width);
    await play(page);
    await page.evaluate(()=>{window.__originalAudio=MCC_MUSIC.audio;window.__retentionEvents=__audioEvents.length;
      /* NO WORDS AND NO WRONG COLOUR WHILE THE WORLD OPENS (owner, 2026-10-20: "other screens flash up"): every frame from the
         moment the World frame shows, whether the "Opening World…" copy was on screen and which colour the frame stood in */
      window.__openFrames=[];let opened=0;const tick=()=>{const shell=document.getElementById('mccWorldAudioShell');
        if(shell&&!shell.hidden){opened=opened||performance.now();const st=shell.querySelector('.world-audio-status'),p=st&&st.querySelector('p');
          __openFrames.push({at:Math.round(performance.now()-opened),copy:!!p&&!st.hidden&&getComputedStyle(p).visibility!=='hidden'&&p.getClientRects().length>0,day:shell.classList.contains('is-day')});}
        if(!opened||performance.now()-opened<2500)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
    const before=await audioState(page),frame=await world(page);
    await page.waitForTimeout(400);
    const opening=await page.evaluate(()=>({early:__openFrames.filter(f=>f.at<1400&&f.copy).length,frames:__openFrames.length,day:__openFrames.length?__openFrames[0].day:null,
      want:window.MCC_DAYLIGHT_CORE?MCC_DAYLIGHT_CORE.estimate(new Date())==='day':null}));
    check(`${width}: the World frame says nothing for its first moment (no "Opening World…" before 1.4s)`,opening.frames>0&&opening.early===0,opening);
    check(`${width}: the World frame opens in the World's own colour (white by day, dark by night)`,opening.want!==null&&opening.day===opening.want,opening);
    await page.waitForTimeout(650);const after=await audioState(page);
    check(`${width}: Music document and exact Audio element survive Globe`,after.unloads===0&&await page.evaluate(()=>__originalAudio===MCC_MUSIC.audio));
    check(`${width}: audio keeps advancing with the same source`,after.src===before.src&&after.time>before.time+.4&&!after.paused,{before,after});
    check(`${width}: no pause, seek or source reset during World entry`,await page.evaluate(()=>__audioEvents.slice(__retentionEvents).every(e=>!['pause','emptied','seeking'].includes(e.type))));
    check(`${width}: only one player is running`,after.playing===1,after);
    check(`${width}: embedded World uses its actual canonical origin`,new URL(frame.url()).origin===WORLD);
    check(`${width}: one visible bottom bar`,await frame.locator('.appbar').isHidden()&&await page.locator('.appbar').isVisible());
    const globe=await (await frame.$('#mnWorldFrame')).contentFrame();
    check(`${width}: nested globe keeps its actual embedded navigation opt-out`,await globe.locator('.appbar').count()===0);
    check(`${width}: native World account remains usable`,await frame.locator('#mccAuthChip').isVisible()||await frame.locator('#mnGuestSignIn').isVisible());
    check(`${width}: parent and World fit the viewport`,await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth)&&await frame.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    check(`${width}: parent grants travel/media frame capabilities`,await page.locator('#mccWorldAudioFrame').evaluate(f=>['geolocation','autoplay','fullscreen'].every(v=>f.allow.includes(v))));
    await page.screenshot({path:join(OUT,`world-with-music-${width}.png`)});
    const layout=await page.evaluate(()=>({nav:document.querySelector('.appbar').getBoundingClientRect().toJSON(),controls:document.querySelector('#mccWorldAudioControls').getBoundingClientRect().toJSON(),hidden:document.querySelector('#mccWorldAudioControls').hidden,height:innerHeight}));
    const reserve=await frame.evaluate(()=>parseFloat(document.documentElement.style.getPropertyValue('--mn-bar-clear')));
    check(`${width}: World audio is a compact globe-side control; bottom clearance belongs only to navigation`,
      reserve>=layout.height-layout.nav.top&&layout.controls.height>=44&&layout.controls.width<=60&&layout.controls.top<layout.nav.top,{layout,reserve});
    check(`${width}: old title and mute chrome is not visible on the globe`,
      await page.locator('#mccWorldAudioControls .world-audio__title').isHidden()&&await page.locator('#mccWorldAudioControls .world-audio__mute').isHidden());
    await page.evaluate(()=>{MCC_MUSIC.audio.muted=true;});
    check(`${width}: music preferences still persist when changed on the player`,(await audioState(page)).muted&&!(await audioState(page)).paused);
    await page.locator('.appbar [data-appnav="music"]').click();
    await page.waitForFunction(()=>!MCC_WORLD_AUDIO.active());
    check(`${width}: Music return retains mute and track`,(await audioState(page)).muted&&(await audioState(page)).src===before.src&&await page.evaluate(()=>__unloads===0));
    await world(page);
    await page.locator('#mccWorldAudioControls .world-audio__play').click();
    const paused=await audioState(page);await page.waitForTimeout(350);
    check(`${width}: explicit pause holds position`,paused.paused&&Math.abs((await audioState(page)).time-paused.time)<.1);
    await page.locator('.appbar [data-appnav="music"]').click();await page.waitForFunction(()=>!MCC_WORLD_AUDIO.active());
    await world(page);check(`${width}: World re-entry respects pause and mute`,(await audioState(page)).paused&&(await audioState(page)).muted&&(await audioState(page)).playing===0);
    await page.evaluate(()=>{MCC_MUSIC.audio.muted=false;});
    await page.locator('#mccWorldAudioControls .world-audio__play').click();
    await page.waitForFunction(()=>!MCC_MUSIC.audio.paused);
    await page.goBack();await page.waitForFunction(()=>!MCC_WORLD_AUDIO.active());
    const back=await audioState(page);await page.goForward();await page.waitForFunction(()=>MCC_WORLD_AUDIO.active());
    check(`${width}: browser Back/Forward retains the music document`,(await audioState(page)).src===back.src&&await page.evaluate(()=>__unloads===0));
    // A malformed message, even from the parent origin, has the wrong source.
    await frame.evaluate(()=>window.postMessage({channel:'mcc-world-audio-v1',id:'forged',type:'layout',clearance:279},location.origin));
    check(`${width}: another window cannot alter the reserved controls area`,await frame.evaluate(()=>document.documentElement.style.getPropertyValue('--mn-bar-clear')!=='279px'));
    check(`${width}: no bridge, Music or travel script errors`,errors.length===0,errors);
    await context.close();
  }
  {
    const {context,page,requests}=await setup(390,true);
    await play(page);const frame=await world(page);
    await frame.waitForFunction(()=>!!localStorage.getItem('mccdb_session'));
    const identity=await frame.evaluate(()=>JSON.parse(localStorage.getItem('mccdb_session')));
    check('signed-in World uses the existing handoff and its own refreshed session',requests.some(r=>new URL(r.url).pathname==='/v1/auth/handoff')&&identity.refresh_token==='fixture-world-refresh');
    check('handoff fragment is scrubbed before World is ready',!frame.url().includes('mcc_handoff'));
    /* the World takes the carried session in place (js/mnet.js cancels mcc:handoff): it is never painted twice */
    check('the World takes the carried sign-in without reloading itself',await frame.evaluate(()=>(performance.getEntriesByType('navigation')[0]||{}).type)!=='reload'&&await frame.evaluate(()=>!document.documentElement.classList.contains('mn-guest')),
      await frame.evaluate(()=>({nav:(performance.getEntriesByType('navigation')[0]||{}).type,guest:document.documentElement.classList.contains('mn-guest')})));
    const wire=await page.evaluate(()=>JSON.stringify(__bridgeMessages));
    check('generic bridge contains no tokens, audio sources or user data',!/(?:access_token|refresh_token|mcc_handoff|fixture-house-refresh|fixture-world-refresh|audio-fixture|assets\/audio)/.test(wire));
    check('handoff reload never reloads or interrupts the parent player',await page.evaluate(()=>__unloads===0&&!MCC_MUSIC.audio.paused));
    await context.close();
  }
  {
    const {context,page}=await setup();await play(page);
    let releaseBridge,releaseTravel;
    const bridgeGate=new Promise(resolve=>releaseBridge=resolve),travelGate=new Promise(resolve=>releaseTravel=resolve);
    await context.addInitScript(({WORLD})=>{
      if(location.origin!==WORLD)return;
      window.__travelGpsStarts=0;
      // Existing analytics performs its own permission-granted location read;
      // this regression measures Travel's delayed initialization and watches.
      const recordTravel=()=>{if(/\/js\/travel\//.test(new Error().stack))__travelGpsStarts++;};
      Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(){recordTravel();},watchPosition(){recordTravel();return 1;},clearWatch(){}}});
      Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}});
    },{WORLD});
    await context.route(u=>u.origin===WORLD&&u.pathname==='/js/world-audio-continuity.js',async r=>{await bridgeGate;await r.fallback();});
    await context.route(u=>u.origin===WORLD&&u.pathname==='/js/travel/world-travel.mjs',async r=>{await travelGate;await r.fallback();});
    const requested=page.waitForRequest(u=>u.url().startsWith(WORLD+'/js/world-audio-continuity.js'));
    await page.locator('.appbar [data-appnav="world"]').click();await requested;
    /* the frame keeps quiet while the World is alive (no "Back to Music" card to tap): the way back is the bar's Music tab,
       which stays over the World frame */
    await page.locator('.appbar [data-appnav="music"]').click();await page.waitForFunction(()=>!MCC_WORLD_AUDIO.active());
    releaseBridge();
    const frame=await (await page.$('#mccWorldAudioFrame')).contentFrame();
    await frame.waitForFunction(()=>document.body.dataset.worldAudioChild==='ready'&&document.body.dataset.worldAudioVisible==='false',null,{polling:50});
    releaseTravel();await frame.waitForFunction(()=>!!document.getElementById('wtLocate'),null,{polling:50});await page.waitForTimeout(150);
    const late={child:await frame.evaluate(()=>({visible:document.body.dataset.worldAudioVisible,gps:__travelGpsStarts})),parent:await audioState(page),active:await page.evaluate(()=>MCC_WORLD_AUDIO.active())};
    check('quick Music return before World readiness keeps late Travel initialization hidden and Travel GPS idle',late.child.visible==='false'&&late.child.gps===0&&!late.active&&!late.parent.paused&&late.parent.unloads===0,late);
    await context.close();
  }
  {
    const {context,page}=await setup();await play(page,'cia-mind-control','Niggy Nigg Niggr');await world(page);
    await page.waitForFunction(()=>MCC_MUSIC.audio.paused,{timeout:7000});
    const state=await audioState(page);
    check('guest preview remains capped at four seconds after World entry',state.time>=3.8&&state.time<=4.01&&await page.evaluate(()=>MCC_MUSIC.access()==='preview'),state);
    check('theme never replaces a completed preview',state.playing===0);
    await context.close();
  }
  {
    const {context,page}=await setup();await page.goto(HOUSE+'/album.html?album=here');
    await page.waitForFunction(()=>!!window.MCC_WORLD_AUDIO&&typeof window.MCC_NP_PLAY==='function');
    await page.locator('#playAll').click();
    await page.waitForFunction(()=>!document.getElementById('deck').paused&&document.getElementById('deck').currentTime>.15);
    const before=await page.evaluate(()=>{window.__retainedDeck=document.getElementById('deck');return {src:__retainedDeck.currentSrc,time:__retainedDeck.currentTime};});
    await world(page);await page.waitForTimeout(650);
    const after=await page.evaluate(()=>({same:__retainedDeck===document.getElementById('deck'),src:__retainedDeck.currentSrc,time:__retainedDeck.currentTime,paused:__retainedDeck.paused,unloads:__unloads}));
    check('album player also retains its exact live deck across Globe',after.same&&after.unloads===0&&after.src===before.src&&after.time>before.time+.4&&!after.paused,{before,after});
    await page.locator('.world-audio__play').click();
    check('World transport controls the original album deck',await page.evaluate(()=>document.getElementById('deck').paused));
    await context.close();
  }
  {
    const {context,page}=await setup();
    const catalog=JSON.parse(await readFile(join(ROOT,'data/albums.json'),'utf8'));
    const album=catalog.albums.find(a=>a.slug==='cia-mind-control');
    album.tracks=album.tracks.filter(t=>t.gated);
    await context.route('**/data/albums.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({albums:[album]})}));
    await context.route('**/assets/audio/fixture-grant.wav',r=>r.fulfill({contentType:'audio/wav',body:wav(2)}));
    await page.evaluate(()=>{
      window.__gateClaims=0;window.__gateSpent=false;window.__resolveGate=null;
      window.MCC_GATED={resolve:()=>__gateSpent?new Promise(resolve=>window.__resolveGate=resolve):Promise.resolve({state:'earned'}),claim:()=>{__gateClaims++;return Promise.resolve({state:'full',url:'https://matthew.mccluster.org/assets/audio/fixture-grant.wav'});},forget:()=>window.__gateSpent=true};
    });
    await play(page,'cia-mind-control','Niggy Nigg Niggr');await world(page);
    await page.waitForFunction(()=>MCC_MUSIC.access()==='spent');
    check('one-use master finishes as spent in the retained player',await page.evaluate(()=>__gateClaims===1&&MCC_MUSIC.audio.paused));
    await page.locator('.world-audio__play').click();
    await page.waitForFunction(()=>MCC_MUSIC.access()==='loading'&&typeof __resolveGate==='function');
    check('World Play reacquires a spent grant through the existing access gate',await page.locator('.world-audio__play').isDisabled()&&await page.locator('#mccWorldAudioState').textContent()==='Opening music…');
    await page.evaluate(()=>MCC_MUSIC.resume());
    check('repeated Play while access loads cannot replay the cached master',await page.evaluate(()=>MCC_MUSIC.audio.paused&&__gateClaims===1));
    await page.evaluate(()=>__resolveGate({state:'unavailable'}));
    await page.waitForFunction(()=>MCC_MUSIC.access()==='unavailable');
    check('failed access is visible and leaves old audio paused',await page.locator('#mccWorldAudioState').textContent()==='Unable to play · try again'&&await page.evaluate(()=>MCC_MUSIC.audio.paused));
    await page.locator('.world-audio__play').click();
    await page.waitForFunction(()=>MCC_MUSIC.access()==='loading');
    await page.evaluate(()=>__resolveGate({state:'locked'}));
    // HTMLAudioElement.currentSrc can lag the selected access state until
    // the new media resource starts loading. Assert the final actual source,
    // not an instantaneous intermediate state after access resolution.
    await page.waitForFunction(()=>MCC_MUSIC.access()==='preview'&&!MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.currentSrc.includes('niggy-nigg-preview'),{timeout:7000});
    check('retry resolves current access and uses the public preview when locked',await page.evaluate(()=>__gateClaims===1&&MCC_MUSIC.audio.currentSrc.includes('niggy-nigg-preview')&&MCC_MUSIC.audio.currentTime<4.1));
    await context.close();
  }
  {
    const {context,page}=await setup();
    /* the theme is drawn at random from every public song in data/albums.json, Heal the 3rd World among them */
    const catalog=JSON.parse(await readFile(join(ROOT,'data/albums.json'),'utf8')).albums.flatMap(a=>a.tracks||[]).filter(t=>!t.gated&&/^assets\/audio\/[a-z0-9._-]+\.(?:mp3|m4a)$/i.test(t.src||'')&&!/preview/i.test(t.src));
    await page.waitForFunction(()=>window.MCC_WORLD_AUDIO?.song()?.pool>1);
    await world(page);
    await page.waitForFunction(()=>{const s=MCC_WORLD_AUDIO.song();return s&&__audioObjects.some(a=>a.src.includes('/assets/audio/'+s.slug+'.')&&!a.paused);});
    const picked=await page.evaluate(()=>MCC_WORLD_AUDIO.song());
    check('World tap with no selected music starts a song drawn from the whole public catalog',picked.pool===catalog.length&&catalog.some(t=>t.title===picked.title)&&await page.locator('#mccWorldAudioTitle').textContent()===picked.title,{picked,pool:catalog.length});
    await page.locator('.appbar [data-appnav="music"]').click();await page.waitForFunction(()=>!MCC_WORLD_AUDIO.active());
    await play(page,'here','Runway Walk');
    check('choosing music silences the theme before a second player can overlap',await page.evaluate(()=>__audioObjects.filter(a=>!a.paused).length===1&&MCC_MUSIC.current().title==='Runway Walk'));
    await context.close();
  }
  {
    /* the catalog's draw can land on the song the theme already holds (1 in the pool): it is still the catalog's pick, and
       its events say so (pick random, the whole pool), never a fallback of one. The draw is pinned to Heal the 3rd World
       (the theme's fallback) wherever it sits in the public catalog, so a longer or reordered shelf cannot move it */
    const {context,page}=await setup();
    const shelf=JSON.parse(await readFile(join(ROOT,'data/albums.json'),'utf8')).albums.flatMap(a=>a.tracks||[]).filter(t=>!t.gated&&/^assets\/audio\/[a-z0-9._-]+\.(?:mp3|m4a)$/i.test(t.src||'')&&!/preview/i.test(t.src));
    const heal=shelf.findIndex(t=>t.src==='assets/audio/heal-the-3rd-world.m4a');
    if(heal<0)throw new Error('Heal the 3rd World is no longer a public song: this check needs a new fixed point');
    await page.addInitScript(([i,n])=>{Math.random=()=>(i+0.5)/n;},[heal,shelf.length]);
    await page.goto(WORLD+'/?view=feed');
    await page.waitForFunction(()=>!!window.MCC_WORLD_AUDIO?.song()?.pool);
    await page.waitForTimeout(200);
    const same=await page.evaluate(()=>MCC_WORLD_AUDIO.song());
    check('a catalog draw of the song already loaded is still the catalog\'s pick',same.slug==='heal-the-3rd-world'&&same.pick==='random'&&same.pool>1,same);
    await context.close();
  }
  {
    const {context,page}=await setup();
    /* timed lyrics come from the lyrics file data/albums.json names for the song; a song it lists without one has no words.
       The draw is pinned to the first public song that names a file, and the fixture supplies two lines for it */
    const songs=JSON.parse(await readFile(join(ROOT,'data/albums.json'),'utf8')).albums.flatMap(a=>a.tracks||[]).filter(t=>!t.gated&&/^assets\/audio\/[a-z0-9._-]+\.(?:mp3|m4a)$/i.test(t.src||'')&&!/preview/i.test(t.src));
    const worded=songs.findIndex(t=>typeof t.lyrics==='string'&&t.lyrics);
    await page.addInitScript(([i,n])=>{Math.random=()=>(i+0.5)/n;},[worded,songs.length]);
    await context.route('**/data/lyrics/*.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({title:'Fixture song',lines:[{t:0.2,text:'Fixture line one'},{t:40,text:'Fixture line two'}]})}));
    await page.goto(WORLD+'/?view=feed');
    await page.waitForFunction(()=>!!window.MCC_WORLD_AUDIO?.song()?.pool&&document.getElementById('mnWorldPlay'));
    const theme=await page.evaluate(()=>MCC_WORLD_AUDIO.song());
    await page.evaluate(()=>{window.__songEvents=[];window.MCC_TRACK=(name,params)=>{if(/^song_/.test(name))__songEvents.push({name,...params});};});
    check('standalone World prepares the theme without autoplay',await page.evaluate(()=>__audioObjects.every(a=>a.paused)));
    check('the corner play button sits in the globe stack with the fullscreen control and the floating transport stays out of the World',
      await page.locator('#mnWorldStack #mnWorldPlay').isVisible()&&await page.locator('#mnWorldStack .mn__world-expand').isVisible()&&await page.locator('#mccWorldAudioControls').isHidden()
      &&await page.evaluate(()=>{const p=document.getElementById('mnWorldPlay').getBoundingClientRect(),x=document.querySelector('.mn__world-expand').getBoundingClientRect();return p.width>=44&&p.height>=44&&((Math.abs(p.right-x.right)<2&&p.bottom<=x.top+1)||(Math.abs(p.top-x.top)<2&&p.right<=x.left+1));}));
    check('before the first touch the title is named but still, and the headline is the headline',(await page.locator('#mnNowPlayingText').textContent())===theme.title&&!(await page.locator('#mnNowPlaying').getAttribute('class')||'').includes('is-playing')&&(await page.locator('.wt-headline').textContent())==='The world is your feed.');
    await page.locator('#wtTo').click();
    await page.waitForFunction(()=>__audioObjects.some(a=>!a.paused));
    check('standalone World first touch starts its own theme directly',await page.evaluate(()=>__audioObjects.filter(a=>!a.paused).length===1));
    await page.waitForFunction(()=>document.getElementById('mnNowPlaying').classList.contains('is-playing'));
    /* paused flips at once; the media element's play event, which records the start, is queued after it */
    await page.waitForFunction(()=>__songEvents.some(e=>e.name==='song_start'),null,{timeout:5000}).catch(()=>{});
    check('the first touch is recorded once as the start of that song, the event adding no account or place of its own',
      await page.evaluate(s=>__songEvents.length===1&&__songEvents[0].name==='song_start'&&__songEvents[0].trigger==='first_tap'&&__songEvents[0].song===s.slug&&__songEvents[0].pool===s.pool&&__songEvents[0].pick==='random'&&!Object.keys(__songEvents[0]).some(k=>/user|email|lat|lng|country/i.test(k)),theme),await page.evaluate(()=>__songEvents));
    check('the song title scrolls in the top bar while the theme plays',await page.locator('#mnNowPlaying').isVisible()&&(await page.locator('#mnNowPlayingText').textContent())===theme.title
      &&await page.evaluate(()=>{/* the title sits between the mark and whatever the header shows next (the bell for members, the sign-in controls for guests) */const now=document.getElementById('mnNowPlaying'),b=now.getBoundingClientRect(),m=document.querySelector('.mn__brand').getBoundingClientRect();let next=now.nextElementSibling;while(next&&!(next.offsetWidth||next.offsetHeight))next=next.nextElementSibling;const edge=next?next.getBoundingClientRect().left:document.querySelector('.mn__top').getBoundingClientRect().right-16;return b.width>=100&&b.left>=m.right-1&&b.right<=edge+1&&getComputedStyle(document.getElementById('mnNowPlayingText')).color==='rgb(255, 255, 255)';}));
    await page.waitForFunction(()=>document.querySelector('.wt-headline').textContent==='Fixture line one',null,{timeout:8000});
    check('timed lyrics take the headline line by line',await page.locator('.wt-headline').getAttribute('class')==='wt-headline is-lyric'&&await page.locator('#mnWorldPlay').getAttribute('aria-label')==='Pause music');
    await page.locator('#mnWorldPlay').click();
    await page.waitForFunction(()=>document.querySelector('.wt-headline').textContent==='The world is your feed.');
    /* the headline follows at once; the media element's pause event, which records the pause, is queued after it */
    await page.waitForFunction(()=>__songEvents.some(e=>e.name==='song_pause'),null,{timeout:5000}).catch(()=>{});
    check('pausing from the corner is recorded as the listener pausing that song',await page.evaluate(s=>__songEvents.some(e=>e.name==='song_pause'&&e.by==='button'&&e.song===s.slug),theme),await page.evaluate(()=>__songEvents));
    check('pausing from the corner restores the headline and keeps the title static',await page.evaluate(()=>__audioObjects.every(a=>a.paused))&&!(await page.locator('#mnNowPlaying').getAttribute('class')||'').includes('is-playing')&&await page.locator('#mnNowPlaying').isVisible());
    await page.reload();
    await page.waitForSelector('#mnWorldPlay');await page.locator('#wtTo').click();
    check('World remembers an explicit pause on later visits',
      await page.evaluate(()=>__audioObjects.every(a=>a.paused))&&await page.locator('#mnWorldPlay').getAttribute('aria-label')==='Play music');
    await context.close();
  }
  {
    const {context,page}=await setup();await play(page);const frame=await world(page);
    await frame.evaluate(()=>{const a=document.createElement('a');a.id='fixtureCreator';a.href='https://matthew.mccluster.org/music-creator.html?handle=fixture-artist';a.textContent='Artist profile';a.style.cssText='position:fixed;top:85px;left:15px;z-index:99999';document.body.appendChild(a);});
    await frame.locator('#fixtureCreator').click();
    await page.waitForURL(HOUSE+'/music-creator.html?handle=fixture-artist');
    check('World artist links preserve the exact destination at top level',page.url()===HOUSE+'/music-creator.html?handle=fixture-artist');
    await context.close();
  }
  {
    const {context,page}=await setup();await play(page);
    await context.route(WORLD+'/**',r=>r.fulfill({status:503,contentType:'text/html',body:'Fixture: World unavailable'}));
    await page.locator('.appbar [data-appnav="world"]').click();
    await page.waitForFunction(()=>MCC_WORLD_AUDIO.active());
    /* the recovery words and controls appear once the World is genuinely slow, after the frame's quiet first moment */
    await page.locator('.world-audio-status button').waitFor({state:'visible',timeout:6000}).catch(()=>{});
    check('World load failure keeps audio and visible recovery controls',await page.evaluate(()=>!MCC_MUSIC.audio.paused&&__unloads===0)&&await page.locator('.world-audio-status button').isVisible()&&await page.locator('.world-audio-status a').isVisible());
    await page.locator('.world-audio-status button').click();await page.waitForFunction(()=>!MCC_WORLD_AUDIO.active());
    check('failed World can return to the same playing Music document',await page.evaluate(()=>!MCC_MUSIC.audio.paused&&__unloads===0));
    await context.close();
  }
  /* The privacy wall is shown until consent, and agreed consent is shared across McCluster hosts. */
  const notice=f=>f.evaluate(()=>({wall:!!document.getElementById('mccPrivacyGate'),pending:document.documentElement.getAttribute('data-privacy-gate'),banner:!!document.getElementById('mccPrivacyNotice')}));
  const none=n=>!n.wall&&!n.pending&&!n.banner;
  const privacyErrors=errors=>errors.filter(e=>/privacy|cookie/i.test(e));
  const musicReady=page=>page.waitForFunction(()=>!!window.MCC_WORLD_AUDIO&&!!window.MCC_MUSIC&&!!window.MCC_BAR&&document.querySelector('[data-music-play][data-album="here"]'));
  {
    const {context,page,errors}=await setup(390,false,{privacy:false});
    const first=await notice(page);
    check('privacy: a first visit sees the notice',first.wall&&first.pending==='pending',first);
    check('privacy: the notice fits a phone',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth&&document.getElementById('mccPrivacyAgree').getBoundingClientRect().height>=44));
    await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('#mccPrivacyAgree').click()]);
    check('privacy: I agree enters the page',none(await notice(page))&&await page.evaluate(()=>MCC_PRIVACY.accepted()));
    const agreed=(await context.cookies(HOUSE)).find(c=>c.name==='mcc_privacy_ack');
    check('privacy: the agreement is one cookie every mccluster.org host reads',agreed?.domain==='.mccluster.org'&&agreed.value==='2026-10-19'&&agreed.secure&&agreed.sameSite==='Lax'&&agreed.path==='/',agreed);
    for(const url of [HOUSE+'/press.html',HOUSE+'/account.html',WORLD+'/',WORLD+'/mnet.html?view=feed']){
      await page.goto(url,{waitUntil:'load'});
      const u=new URL(url);
      check(`privacy: after I agree, ${u.host}${u.pathname} does not show it again`,none(await notice(page))&&await page.evaluate(()=>MCC_PRIVACY.accepted()));
    }
    await page.goto(HOUSE+'/listen.html',{waitUntil:'load'});await musicReady(page);
    await play(page);const frame=await world(page);
    check('privacy: after I agree, the World that Music opens does not show it again',none(await notice(page))&&none(await notice(frame))&&await frame.evaluate(()=>MCC_PRIVACY.accepted()));
    check('privacy: no notice errors after I agree',privacyErrors(errors).length===0,errors);
    await context.close();
  }
  {
    const {context,page,errors}=await setup(390,false,{privacy:false,start:'/press.html'});
    const first=await notice(page);
    check('privacy: first document visit is a blocking wall, never a dismissible banner',
      first.wall&&first.pending==='pending'&&!first.banner,first);
    check('privacy: entry offers only agree and go back',
      await page.locator('#mccPrivacyGate button').allTextContents().then(x=>x.map(s=>s.trim()).join('|')==='I agree & continue|Go back'));
    await page.goto(HOUSE+'/privacy.html',{waitUntil:'load'});
    check('privacy: policy remains readable without consent',none(await notice(page))&&await page.locator('#mccPrivacyAnswerBack').isVisible());
    await page.goto(HOUSE+'/press.html',{waitUntil:'load'});
    const returned=page.waitForURL('**/privacy.html',{timeout:10000});
    await page.locator('#mccPrivacyBack').click();
    await returned;
    const jar=await context.cookies(HOUSE);
    check('privacy: Go back really returns to preceding page and stores no consent',
      !jar.some(c=>c.name==='mcc_privacy_ack')&&await page.evaluate(()=>!MCC_PRIVACY.accepted()&&!localStorage.getItem('mcc_privacy_seen')));
    await page.goto(HOUSE+'/account.html',{waitUntil:'load'});
    check('privacy: returning without consent asks again', (await notice(page)).wall);
    await page.goto(HOUSE+'/privacy.html',{waitUntil:'load'});
    await page.locator('#mccPrivacyAnswerAgree').click();
    await page.goto(HOUSE+'/press.html',{waitUntil:'load'});
    check('privacy: agreement from the readable policy grants entry',none(await notice(page))&&await page.evaluate(()=>MCC_PRIVACY.accepted()));
    check('privacy: no privacy console errors',privacyErrors(errors).length===0,errors);
    await context.close();
  }
  /* A3 and A4 (deep audit, 2026-11-09). What each scenario may look at: */
  const seen=p=>p.evaluate(()=>({exposed:sessionStorage.getItem('fx_exposed'),asked:sessionStorage.getItem('fx_asked'),signed:sessionStorage.getItem('fx_signed')}));
  /* the page under the wall can be neither seen nor touched: every other child of the body is hidden, and the wall is what a tap lands on */
  const under=p=>p.evaluate(()=>document.documentElement.getAttribute('data-privacy-gate')==='pending'&&[...document.body.children].filter(n=>n.id!=='mccPrivacyGate').every(n=>getComputedStyle(n).visibility==='hidden')&&!!document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('#mccPrivacyGate'));
  /* the question is on the screen and BOTH answers can be pressed */
  const asking=p=>p.evaluate(()=>['mccPrivacyAgree','mccPrivacyBack'].every(id=>{const n=document.getElementById(id);return !!n&&!n.disabled&&n.getClientRects().length>0;}));
  const state=p=>p.evaluate(()=>({agree:document.getElementById('mccPrivacyAgree')?.disabled,back:document.getElementById('mccPrivacyBack')?.disabled,focus:document.activeElement?.id||document.activeElement?.tagName,gate:document.documentElement.getAttribute('data-privacy-gate'),accepted:window.MCC_PRIVACY?MCC_PRIVACY.accepted():null,url:location.href,entries:history.length,shows:window.__shows,nav:(performance.getEntriesByType('navigation')[0]||{}).type}));
  const reply=(r,body,status=200)=>r.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
  /* the session Supabase hands a member whose OWN account record already agrees to this version of the notice */
  const agreedMember=r=>reply(r,{access_token:'x.'+Buffer.from(JSON.stringify({sub:USER,exp:Math.floor(Date.now()/1000)+3600,email:'audio-fixture@invalid.test',user_metadata:{privacy_policy_version:'2026-10-19',privacy_acknowledged_at:'2026-10-19T12:00:00Z'}})).toString('base64url')+'.y',refresh_token:'fixture-world-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:USER,email:'audio-fixture@invalid.test'}});
  const carried=path=>WORLD+path+'#mcc_handoff='+encodeURIComponent(token(HOUSE));

  /* A4: A SIGN-IN STILL BEING CARRIED IN WAITS BEHIND THE WALL. Before, the whole page stood open to a visitor who had
     not agreed for as long as the handoff took, ten seconds when nobody answered, on a fragment anyone can write. */
  {
    /* nobody answers: the API never replies */
    const {context,page,errors}=await setup(390,false,{privacy:false,start:'/privacy.html',watch:true});
    const unanswered=[];
    await context.route('https://api.mccluster.org/v1/auth/handoff',r=>{unanswered.push(r.request().method());});
    const started=Date.now();
    await page.goto(carried('/mnet.html?view=feed'),{waitUntil:'domcontentloaded'});
    const held=await notice(page);
    check('handoff wait: the page is behind the wall from its first paint',held.wall&&held.pending==='pending'&&await under(page),held);
    check('handoff wait: one line says what is waited for, and no answer is offered yet',await page.locator('#mccPrivacyGateWait').isVisible()&&!await page.locator('#mccPrivacyAgree').isVisible()&&!await page.locator('#mccPrivacyBack').isVisible()&&!await page.locator('#mccPrivacyGateBody').isVisible()&&await page.evaluate(()=>document.activeElement?.id==='mccPrivacyGateTitle'&&document.getElementById('mccPrivacyGate').getAttribute('aria-describedby')==='mccPrivacyGateWait'),await state(page));
    check('handoff wait: the wait fits a phone',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    check('handoff wait: waiting is not agreeing, and analytics record nothing',await page.evaluate(()=>!MCC_PRIVACY.accepted()&&window.MCC_TRACK('privacy_fixture')===false&&!localStorage.getItem('mcc_privacy_ack'))&&!(await context.cookies(WORLD)).some(c=>c.name==='mcc_privacy_ack'));
    check('handoff wait: the sign-in really is still on its way',unanswered.includes('POST')&&await page.evaluate(()=>!localStorage.getItem('mccdb_session')),unanswered);
    await page.screenshot({path:join(OUT,'privacy-handoff-wait-390.png')});
    await page.locator('#mccPrivacyAgree').waitFor({state:'visible',timeout:15000});
    const waited=Date.now()-started;
    check('handoff timeout: the question comes when the ten seconds are up, not before',waited>=10000,waited);
    check('handoff timeout: it ends in both answers, working, with the page still behind the wall',await asking(page)&&await under(page)&&await page.evaluate(()=>document.activeElement?.id==='mccPrivacyAgree'&&!MCC_PRIVACY.accepted()),await state(page));
    check('handoff timeout: the page was never open to a visitor who had not agreed',(await seen(page)).exposed===null&&!!(await seen(page)).asked,await seen(page));
    await page.screenshot({path:join(OUT,'privacy-handoff-timeout-390.png')});
    await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('#mccPrivacyAgree').click()]);
    check('handoff timeout: agreeing then enters',none(await notice(page))&&await page.evaluate(()=>MCC_PRIVACY.accepted()));
    check('handoff timeout: no privacy console errors',privacyErrors(errors).length===0,errors);
    await context.close();
  }
  {
    /* the World takes the session where it stands, and the member's own record answers */
    const {context,page,errors}=await setup(390,false,{privacy:false,start:'/privacy.html',watch:true});
    await context.route('**/auth/v1/verify',agreedMember);
    await page.goto(carried('/mnet.html?view=feed'),{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!localStorage.getItem('mccdb_session')&&!document.documentElement.hasAttribute('data-privacy-gate'),null,{timeout:15000}).catch(()=>{});
    const saw=await seen(page);
    check("handoff: the arriving member's own record enters, and the question is never asked",none(await notice(page))&&saw.asked===null&&!!saw.signed&&await page.evaluate(()=>MCC_PRIVACY.accepted()),{saw,notice:await notice(page)});
    check('handoff: the page was never open before the agreement was known',saw.exposed===null,saw);
    check('handoff: entered in place, signed in, with no reload',await page.evaluate(()=>(performance.getEntriesByType('navigation')[0]||{}).type!=='reload'&&JSON.parse(localStorage.getItem('mccdb_session')).refresh_token==='fixture-world-refresh'&&!document.documentElement.classList.contains('mn-guest')));
    check('handoff: with the wall down the page can be seen and touched',await page.evaluate(()=>!document.getElementById('mccPrivacyGateStyle')&&[...document.body.children].some(n=>n.offsetHeight>0&&getComputedStyle(n).visibility==='visible')));
    check('handoff: the answer is kept for the next page',await page.evaluate(()=>JSON.parse(localStorage.getItem('mcc_privacy_ack')).accepted_at==='2026-10-19T12:00:00Z')&&(await context.cookies(WORLD)).some(c=>c.name==='mcc_privacy_ack'&&c.value==='2026-10-19'));
    check('handoff: no privacy console errors',privacyErrors(errors).length===0,errors);
    await context.close();
  }
  {
    /* the same arrival with no record of this version: signed in, and asked as the sign-in lands */
    const {context,page,requests}=await setup(390,false,{privacy:false,start:'/privacy.html',watch:true});
    await page.goto(carried('/mnet.html?view=feed'),{waitUntil:'domcontentloaded'});
    await page.locator('#mccPrivacyAgree').waitFor({state:'visible',timeout:15000});
    const saw=await seen(page);
    check('handoff: a member with no record is asked as the sign-in lands, not four seconds later',!!saw.signed&&Number(saw.asked)-Number(saw.signed)<2500&&await asking(page)&&await under(page),saw);
    check('handoff: signed in is not agreed, and the page was never open',saw.exposed===null&&await page.evaluate(()=>!MCC_PRIVACY.accepted()&&!!localStorage.getItem('mccdb_session')),saw);
    await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('#mccPrivacyAgree').click()]);
    const wrote=requests.filter(r=>r.method==='PUT'&&new URL(r.url).pathname==='/auth/v1/user');
    check("handoff: agreeing writes the member's own record with this host's session, then enters",wrote.length===1&&/^Bearer x\./.test(wrote[0].authorization||'')&&none(await notice(page))&&await page.evaluate(()=>MCC_PRIVACY.accepted()&&!!localStorage.getItem('mccdb_session')),wrote);
    await context.close();
  }
  {
    /* every other page reloads signed in: it stays behind the wall, unasked, until it does */
    const {context,page}=await setup(390,false,{privacy:false,start:'/privacy.html',watch:true});
    await context.route('**/auth/v1/verify',agreedMember);
    await page.goto(carried('/account.html'),{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>(performance.getEntriesByType('navigation')[0]||{}).type==='reload'&&document.readyState==='complete'&&!!window.MCC_PRIVACY,null,{timeout:15000}).catch(()=>{});
    const saw=await seen(page);
    check('handoff: a page that reloads signed in stays behind the wall until it does, then enters on the record',none(await notice(page))&&saw.exposed===null&&saw.asked===null&&!!saw.signed&&await page.evaluate(()=>MCC_PRIVACY.accepted()&&(performance.getEntriesByType('navigation')[0]||{}).type==='reload'),{saw,state:await state(page)});
    await context.close();
  }
  {
    /* refused: a fragment that carries no sign-in at all */
    const {context,page}=await setup(390,false,{privacy:false,start:'/privacy.html',watch:true});
    await context.route('https://api.mccluster.org/v1/auth/handoff',r=>reply(r,{error:'forbidden'},403));
    await page.goto(HOUSE+'/press.html#mcc_handoff=not-a-sign-in',{waitUntil:'load'});
    await page.locator('#mccPrivacyAgree').waitFor({state:'visible',timeout:8000});
    const saw=await seen(page);
    check('handoff refused: the question, both answers working, and the page never open',await asking(page)&&await under(page)&&saw.exposed===null&&await page.evaluate(()=>!MCC_PRIVACY.accepted()&&!localStorage.getItem('mccdb_session')),saw);
    const returned=page.waitForURL('**/privacy.html',{timeout:10000});
    await page.locator('#mccPrivacyBack').click();
    await returned;
    check('handoff refused: Go back leaves, and nothing was agreed',!(await context.cookies(HOUSE)).some(c=>c.name==='mcc_privacy_ack')&&await page.evaluate(()=>!MCC_PRIVACY.accepted()));
    await context.close();
  }

  /* A3: GO BACK IS A TRANSITION, NOT AN END STATE. Before, Go back switched both answers off for good; a document the
     browser kept and showed again, or never left, was a wall with nothing to press. */
  keeper=await chromium.launch({...(FULL?{executablePath:FULL}:{channel:'chromium'}),ignoreDefaultArgs:['--disable-back-forward-cache'],args:['--no-sandbox']});
  const kept=p=>p.waitForFunction(()=>window.__kept==='this very document'&&window.__shows.includes(true),null,{timeout:10000}).then(()=>true,()=>false);
  {
    /* Go back, then the browser's Forward: the back/forward cache shows the very document that was left */
    const {context,page,errors}=await setup(390,false,{privacy:false,start:'/privacy.html',watch:true,from:keeper});
    await page.goto(HOUSE+'/press.html',{waitUntil:'load'});
    await page.evaluate(()=>{window.__kept='this very document';});
    await page.locator('#mccPrivacyBack').click();
    await page.waitForURL('**/privacy.html',{waitUntil:'commit',timeout:10000});
    await page.goForward({waitUntil:'commit'});
    check("restore: Go back, then the browser's Forward, shows the very document again from the back/forward cache",await kept(page),await page.evaluate(()=>({kept:window.__kept||null,shows:window.__shows,nav:(performance.getEntriesByType('navigation')[0]||{}).type})));
    check('restore: it is still behind the wall, and both answers work',await under(page)&&await asking(page)&&await page.evaluate(()=>!MCC_PRIVACY.accepted()&&!localStorage.getItem('mcc_privacy_ack')),await state(page));
    check('restore: focus is on the answer that was used, not moved onto Agree',await page.evaluate(()=>document.activeElement?.id==='mccPrivacyBack'),await state(page));
    await page.screenshot({path:join(OUT,'privacy-restored-390.png')});
    await page.locator('#mccPrivacyBack').click();
    await page.waitForURL('**/privacy.html',{waitUntil:'commit',timeout:10000});
    check('restore: Go back leaves a second time, and still records nothing',!(await context.cookies(HOUSE)).some(c=>c.name==='mcc_privacy_ack')&&await page.evaluate(()=>!MCC_PRIVACY.accepted()&&!localStorage.getItem('mcc_privacy_seen')));
    await page.goForward({waitUntil:'commit'});
    await page.waitForFunction(()=>window.__shows.filter(Boolean).length===2,null,{timeout:10000}).catch(()=>{});
    await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('#mccPrivacyAgree').click()]);
    check('restore: agreeing on the restored page enters',none(await notice(page))&&await page.evaluate(()=>MCC_PRIVACY.accepted()));
    check('restore: no privacy console errors',privacyErrors(errors).length===0,errors);
    await context.close();
  }
  {
    /* the policy link, Agree there, then the browser's Back: the entry page is shown again with its wall still up */
    const {context,page}=await setup(390,false,{privacy:false,start:'/press.html',watch:true,from:keeper});
    await page.evaluate(()=>{window.__kept='this very document';});
    await Promise.all([page.waitForURL('**/privacy.html',{waitUntil:'load',timeout:10000}),page.locator('#mccPrivacyGate .mccpg__review').click()]);
    await page.locator('#mccPrivacyAnswerAgree').click();
    await page.goBack({waitUntil:'commit'});
    check("restore: the policy link, Agree there, then the browser's Back shows the entry page again from the back/forward cache",await kept(page),await page.evaluate(()=>({kept:window.__kept||null,shows:window.__shows})));
    await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-privacy-gate'),null,{timeout:5000}).catch(()=>{});
    check('restore: the agreement given on the policy page takes the wall down where it stands',none(await notice(page))&&await page.evaluate(()=>MCC_PRIVACY.accepted()&&(performance.getEntriesByType('navigation')[0]||{}).type==='navigate'&&[...document.body.children].some(n=>n.offsetHeight>0&&getComputedStyle(n).visibility==='visible')),await state(page));
    await context.close();
  }
  {
    /* a history with nothing behind this entry: the page was opened in a tab of its own (a Playwright page is born with
       a blank entry behind it, a tab opened onto a link is not), the visitor read the policy and came BACK to it, so the
       tab has two entries and Go back has nowhere to go */
    const {context,page:opener}=await setup(390,false,{privacy:false,start:'/privacy.html',watch:true});
    const [page]=await Promise.all([context.waitForEvent('page'),opener.evaluate(u=>{window.open(u,'_blank','noopener,noreferrer');},HOUSE+'/press.html')]);
    await page.waitForLoadState('load');
    await Promise.all([page.waitForURL('**/privacy.html',{waitUntil:'load',timeout:10000}),page.locator('#mccPrivacyGate .mccpg__review').click()]);
    await page.goBack({waitUntil:'load'});
    await page.locator('#mccPrivacyBack').click();
    const during=await state(page);
    check('no way back: while the browser is given its moment, neither answer can be pressed',during.entries===2&&during.agree===true&&during.back===true&&new URL(during.url).pathname==='/press.html'&&await under(page),during);
    await page.waitForFunction(()=>document.getElementById('mccPrivacyBack')?.disabled===false,null,{timeout:6000}).catch(()=>{});
    const after=await state(page);
    check('no way back: still here, so both answers work again and nobody was let through',await asking(page)&&await under(page)&&!after.accepted&&new URL(after.url).pathname==='/press.html'&&after.focus==='mccPrivacyBack'&&(await seen(page)).exposed===null,after);
    await page.locator('#mccPrivacyBack').click();
    await page.waitForURL('about:blank',{timeout:10000}).catch(()=>{});
    check('no way back: the next Go back leaves by the other way out, to a blank page',page.url()==='about:blank',page.url());
    await context.close();
  }
  {
    /* a step back that stays in this document (the page had put an entry of its own in the history) */
    const {context,page}=await setup(390,false,{privacy:false,start:'/privacy.html',watch:true});
    await page.goto(HOUSE+'/press.html',{waitUntil:'load'});
    await page.evaluate(()=>history.pushState(null,'',location.pathname+'#deeper'));
    await page.locator('#mccPrivacyBack').click();
    const soon=await page.waitForFunction(()=>document.getElementById('mccPrivacyBack')?.disabled===false&&location.hash==='',null,{timeout:1000}).then(()=>true,()=>false);
    check('same document: a step back that stays here gives both answers back at once, behind the same wall',soon&&await asking(page)&&await under(page)&&await page.evaluate(()=>!MCC_PRIVACY.accepted()&&document.activeElement?.id==='mccPrivacyBack'),await state(page));
    const returned=page.waitForURL('**/privacy.html',{timeout:10000});
    await page.locator('#mccPrivacyBack').click();
    await returned;
    check('same document: the next Go back leaves by history, to the page before',new URL(page.url()).pathname==='/privacy.html'&&await page.evaluate(()=>!MCC_PRIVACY.accepted()));
    await context.close();
  }
  {
    /* another tab of the same site agrees: this tab hears it and its wall comes down, without being touched */
    const {context,page}=await setup(390,false,{privacy:false,start:'/press.html',watch:true});
    const other=await context.newPage();
    await other.goto(HOUSE+'/privacy.html',{waitUntil:'load'});
    check('another tab: until someone agrees, this tab is still behind its wall',await under(page)&&await asking(page));
    await other.locator('#mccPrivacyAnswerAgree').click();
    await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-privacy-gate'),null,{timeout:5000}).catch(()=>{});
    check('another tab: agreeing on the policy in another tab of this site takes this wall down where it stands',none(await notice(page))&&(await seen(page)).exposed===null&&await page.evaluate(()=>MCC_PRIVACY.accepted()&&(performance.getEntriesByType('navigation')[0]||{}).type==='navigate'),await state(page));
    await context.close();
  }
  {
    /* another McCluster host agrees in another tab: the shared cookie is read when this tab is looked at again. Playwright
       tells every page it is focused; with that switched off for this tab, the browser's own focus event arrives. */
    const {context,page}=await setup(390,false,{privacy:false,start:'/privacy.html',watch:true,from:keeper});
    await page.goto(WORLD+'/mnet.html?view=feed',{waitUntil:'load'});
    await (await context.newCDPSession(page)).send('Emulation.setFocusEmulationEnabled',{enabled:false});
    const other=await context.newPage();
    await other.bringToFront();
    await other.goto(HOUSE+'/privacy.html',{waitUntil:'load'});
    await other.locator('#mccPrivacyAnswerAgree').click();
    await page.waitForTimeout(400);
    check('another host: a tab nobody is looking at keeps its wall',(await notice(page)).wall&&await under(page)&&(await context.cookies(WORLD)).some(c=>c.name==='mcc_privacy_ack'),await state(page));
    const before=await page.evaluate(()=>window.__focuses);
    await page.bringToFront();
    /* which signal reached the page is said in the check's own name, whatever the wall then did with it */
    const given=await page.waitForFunction(n=>window.__focuses>n,before,{timeout:3000}).then(()=>true,()=>false);
    if(!given)await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-privacy-gate'),null,{timeout:3000}).catch(()=>{});
    check(`another host: coming back to the tab takes the wall down where it stands (${given?'the browser gave the tab focus':'this browser gave the tab no focus event, so the test dispatched one'})`,none(await notice(page))&&await page.evaluate(()=>MCC_PRIVACY.accepted()&&(performance.getEntriesByType('navigation')[0]||{}).type==='navigate'),await state(page));
    await context.close();
  }
}finally{
  await writeFile(join(OUT,'results.json'),JSON.stringify(result,null,2));await browser.close();if(keeper)await keeper.close();
}
