/* Real HTMLAudioElement playback against synthetic WAV bytes and the actual
   Music/World documents. No production API, account or audio request escapes
   the route fixtures. The globe renderer itself is covered by World suites. */
import {createRequire} from 'node:module';
import { withTravel } from './world-switch.mjs';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, join, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/music-world-continuity-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--autoplay-policy=document-user-activation-required']});
const HOUSE='https://matthew.mccluster.org',WORLD='https://mccluster.org';
const USER='11111111-1111-4111-8111-111111111111';
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
/* motion: 'reduce' keeps the album room's light off, as this suite always ran; 'no-preference'
   is what most listeners have, with js/chamber.js drawing the room (music map PB-13) */
/* deliver({key,start,n}) answers each audio read as the network would (music slice M3): null for the plain answer,
   {cut} bytes at most (a short 206: the browser asks for the rest with a Range read) or {status} instead */
async function setup(width=390,member=false,{parentScript,privacy=true,start='/listen.html',motion='reduce',deliver=null}={}){
  const context=await browser.newContext({viewport:{width,height:844},hasTouch:true,reducedMotion:motion,serviceWorkers:'block'});
  const requests=[],messages=[],errors=[],reads=[];
  await context.addInitScript(({HOUSE,member,token,privacy})=>{
    if(privacy)localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(member&&location.origin===HOUSE&&!localStorage.getItem('mccdb_session'))localStorage.setItem('mccdb_session',JSON.stringify({access_token:token,refresh_token:'fixture-house-refresh',expires_at:Math.floor(Date.now()/1000)+3600}));
    try{sessionStorage.setItem('mcc_premiere','1');}catch{}
    /* every AudioContext a page makes, so a check can suspend them all the way WebKit does when Safari leaves the screen */
    window.__audioContexts=[];
    const NativeContext=window.AudioContext;
    if(NativeContext){const Recorded=function(...args){const c=new NativeContext(...args);window.__audioContexts.push(c);return c;};Recorded.prototype=NativeContext.prototype;window.AudioContext=Recorded;window.webkitAudioContext=Recorded;}
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
        const read={key:p.split('/').pop(),start:range?Number(range[1]):0,n:0,at:Date.now(),status:0};
        read.n=reads.filter(q=>q.key===read.key).length+1;reads.push(read);
        const fault=deliver?await deliver(read):null;
        try{
          if(fault&&fault.status){read.status=fault.status;return await r.fulfill({status:fault.status,body:''});}
          if(range){const start=read.start;let end=Math.min(Number(range[2]||AUDIO.length-1),AUDIO.length-1);if(fault&&fault.cut)end=Math.min(end,start+fault.cut-1);read.status=206;return await r.fulfill({status:206,contentType:'audio/wav',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${AUDIO.length}`},body:AUDIO.subarray(start,end+1)});}
          read.status=200;return await r.fulfill({status:200,contentType:'audio/wav',headers:{'accept-ranges':'bytes'},body:AUDIO});
        }catch{/* the page moved on while this read was held */}
        return;
      }
      const path=resolve(ROOT,'.'+(p==='/'?'/mnet.html':decodeURIComponent(p)));
      if(path.startsWith(resolve(ROOT)+sep)){
        /* the World's first touch here is Travel's Where to, so this suite drives the World with Travel switched on */
        try{let body=await readFile(path);if(path===resolve(ROOT,'mnet.html'))body=Buffer.from(withTravel(body));return r.fulfill({body,contentType:MIME[extname(path)]||'application/octet-stream'});}catch{}
      }
      if(/\.(?:png|jpe?g|webp|gif)$/.test(p))return r.fulfill({contentType:'image/gif',body:IMAGE});
      return r.fulfill({status:404,body:'Fixture: file absent'});
    }
    return r.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(HOUSE+start,{waitUntil:parentScript?'domcontentloaded':'load'});
  if(start==='/listen.html')await page.waitForFunction(ready=>(!ready||!!window.MCC_WORLD_AUDIO)&&!!window.MCC_MUSIC&&!!window.MCC_BAR&&document.querySelector('[data-music-play][data-album="here"]'),!parentScript);
  return {context,page,requests,messages,errors,reads};
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
    /* A LOCKED PREVIEW NEVER STOPS THE QUEUE (music slice M3; decision D-11's default): the preview ends at its
       four seconds, one short line says what it was, and the next song plays in the same player, never the theme */
    const {context,page}=await setup();
    /* where the preview was stopped, read at the engine's own pause (the next song's source is set before the pause event is heard) */
    await page.evaluate(()=>{window.__previewStops=[];const a=MCC_MUSIC.audio,pause=a.pause;a.pause=function(){if(/niggy-nigg-preview/.test(a.currentSrc)&&!a.paused)__previewStops.push(a.currentTime);return pause.apply(this,arguments);};});
    await play(page,'cia-mind-control','Niggy Nigg Niggr');await world(page);
    await page.waitForFunction(()=>MCC_MUSIC.current()&&MCC_MUSIC.current().title!=='Niggy Nigg Niggr'&&!MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.currentTime>.2,null,{timeout:12000}).catch(()=>{});
    const state=await audioState(page),stops=await page.evaluate(()=>__previewStops);
    check('guest preview remains capped at four seconds after World entry (stopped within one clock tick of its boundary)',stops.length===1&&stops[0]>=3.8&&stops[0]<=4.3,stops);
    check('a locked preview never stops the queue: the next song plays on in the same player',await page.evaluate(()=>MCC_MUSIC.current().title!=='Niggy Nigg Niggr'&&MCC_MUSIC.access()==='full'&&!MCC_MUSIC.audio.paused),{state,current:await page.evaluate(()=>MCC_MUSIC.current()&&MCC_MUSIC.current().title)});
    check('theme never replaces a completed preview',state.playing===1&&await page.evaluate(()=>__audioObjects.filter(a=>!a.paused).every(a=>a===MCC_MUSIC.audio)),state);
    check('the preview says what it was in one short line',await page.evaluate(()=>/^That was the preview of Niggy Nigg Niggr\./.test((document.getElementById('musicMiniNote')||{}).textContent||'')));
    await context.close();
  }
  {
    /* SONGS PLAY TO THE END (music slice M3): the read under a song in the World's retained player stops mid-track and
       the network stays down for a moment. The World's control says so and never shows Pause over silence; the same
       Audio element picks up at the second it stopped. */
    const song='who-did-the-shoot.mp3';let failedAt=0;
    const deliver=async q=>{
      if(q.key!==song)return null;
      if(!failedAt){if(q.n===1)return {cut:240000};if(q.start>0){await new Promise(r=>setTimeout(r,6000));failedAt=Date.now();return {status:503};}return null;}
      if(Date.now()-failedAt<2500)return {status:503};
      return q.start===0?{cut:16044}:null;
    };
    const {context,page,reads}=await setup(390,false,{deliver});
    await play(page);const frame=await world(page);
    await page.evaluate(()=>{window.__originalAudio=MCC_MUSIC.audio;window.__playingAt=[];MCC_MUSIC.audio.addEventListener('playing',()=>__playingAt.push(MCC_MUSIC.audio.currentTime));});
    await page.waitForFunction(()=>MCC_MUSIC.delivery&&MCC_MUSIC.delivery().state==='reconnecting',null,{timeout:15000}).catch(()=>{});
    const down=await page.evaluate(()=>({paused:MCC_MUSIC.audio.paused,state:document.getElementById('mccWorldAudioState').textContent,play:document.querySelector('#mccWorldAudioControls .world-audio__play').getAttribute('aria-label'),at:MCC_MUSIC.delivery?MCC_MUSIC.delivery().at:null}));
    /* the element is quiet and the World's control says why; its button is Pause, which stops the tries (music slice M3,
       review PB-R3: it showed Play, and Play tried again at once) */
    check('a drop under the World says Reconnecting…, and the World\'s control offers Pause, which stops the tries',down.paused&&down.state==='Reconnecting…'&&down.play==='Pause music',down);
    const at=down.at||0;
    await page.waitForFunction(at=>!MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.currentTime>at+1,at,{timeout:20000}).catch(()=>{});
    const back=await page.evaluate(()=>({same:__originalAudio===MCC_MUSIC.audio,paused:MCC_MUSIC.audio.paused,time:MCC_MUSIC.audio.currentTime,resumed:__playingAt[__playingAt.length-1],state:document.getElementById('mccWorldAudioState').textContent,unloads:__unloads}));
    check('the same Audio element picks up at the second it stopped, with the World still open',back.same&&!back.paused&&back.resumed>=at-.5&&back.unloads===0&&await page.evaluate(()=>MCC_WORLD_AUDIO.active()),{at,back});
    check('the World control is back to Playing',back.state==='Playing',back);
    check('the way back is a Range read from the middle of the file',reads.some(q=>q.key===song&&failedAt&&q.at>=failedAt&&q.start>0&&q.status===206),reads.filter(q=>q.key===song));
    check('the World frame is untouched by the drop',await frame.evaluate(()=>document.body.dataset.worldAudioChild==='ready'));
    await context.close();
  }
  {
    /* THE WORLD'S PAUSE IS THE LISTENER'S (music slice M3, review PB-R2). The album's song is being picked up again under
       the World: the deck is already quiet, so the World's control used to call deck.pause(), which changed nothing and
       fired no event, and the next try started the music again behind the listener. It now goes through the album's own
       Pause; so do the World's "pause" message and the sleep timer. */
    /* until the drop every read is short and slow, so the deck keeps asking for the song as it plays (it reads the
       start of it when the page opens); once the World is open the next read fails, and every one after it */
    const song='who-did-the-shoot.mp3';let armed=false,failedAt=0,back=false;
    const deliver=async q=>{
      if(q.key!==song)return null;
      if(!armed){await new Promise(r=>setTimeout(r,1500));return {cut:64000};}
      if(!failedAt){failedAt=Date.now();return {status:503};}
      return back?null:{status:503};
    };
    const {context,page,reads,errors}=await setup(390,false,{deliver,start:'/album.html?album=here'});
    await page.waitForFunction(()=>!!window.MCC_WORLD_AUDIO&&typeof window.MCC_NP_PLAY==='function');
    await page.locator('#playAll').click();
    await page.waitForFunction(()=>!document.getElementById('deck').paused&&document.getElementById('deck').currentTime>.15);
    await world(page);
    armed=true;
    await page.waitForFunction(()=>/^Reconnecting…/.test(document.getElementById('npTime').textContent),null,{timeout:20000}).catch(()=>{});
    const state=()=>page.evaluate(()=>({paused:document.getElementById('deck').paused,time:document.getElementById('npTime').textContent,
      state:document.getElementById('mccWorldAudioState').textContent,play:document.querySelector('#mccWorldAudioControls .world-audio__play').getAttribute('aria-label')}));
    const down=await state();
    check('album under the World: a drop says Reconnecting… on the World\'s control, which offers Pause',down.paused&&down.state==='Reconnecting…'&&down.play==='Pause music',down);
    const clickAt=Date.now();
    await page.locator('.world-audio__play').click();   // the World's own Pause, while a try is waiting
    back=true;                                          // the network comes back
    await page.waitForTimeout(10000);
    const after=await state(),later=reads.filter(q=>q.key===song&&q.at>clickAt+50);
    check('album under the World: the World\'s Pause during a try is the listener\'s: nothing reads or plays behind it',after.paused&&later.length===0&&after.play==='Play music',{after,later});
    check('album under the World: the World\'s control says how to pick it up',after.state==='Connection lost · tap play',after);
    check('album under the World, the World\'s Pause: no script errors',errors.length===0,errors);
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
  /* WITHOUT REDUCED MOTION (music map PB-13): every check above ran with reduced motion, so the album room's light
     (js/chamber.js) never ran and nothing here ever saw the deck routed through Web Audio. Here the light is on, as
     for most listeners, and every AudioContext the page made is suspended once the World is open: that is what WebKit
     does to Web Audio when Safari leaves the screen. The music must keep advancing all the same. */
  for(const start of ['/listen.html','/album.html?album=here']){
    const {context,page,errors}=await setup(390,false,{motion:'no-preference',start});
    const album=start.startsWith('/album');
    if(album){
      await page.waitForFunction(()=>!!window.MCC_WORLD_AUDIO&&typeof window.MCC_NP_PLAY==='function');
      await page.locator('#playAll').click();
      await page.waitForFunction(()=>!document.getElementById('deck').paused&&document.getElementById('deck').currentTime>.15);
    }else await play(page);
    const element=()=>page.evaluate(album=>{const a=album?document.getElementById('deck'):MCC_MUSIC.audio;return {time:a.currentTime,paused:a.paused,src:a.currentSrc};},album);
    check(`default motion ${album?'album':'listen'}: the room's light is on`,!album||await page.evaluate(()=>document.documentElement.classList.contains('sig-live')));
    const before=await element();
    await world(page);
    await page.evaluate(()=>Promise.all(window.__audioContexts.map(c=>c.suspend().catch(()=>{}))));
    const suspended=await element();await page.waitForTimeout(900);const after=await element();
    check(`default motion ${album?'album':'listen'}: across Globe, with every AudioContext suspended, the same music keeps advancing`,
      after.src===before.src&&!after.paused&&after.time>suspended.time+.6,{before,suspended,after,contexts:await page.evaluate(()=>window.__audioContexts.length)});
    check(`default motion ${album?'album':'listen'}: parent fits the phone`,await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    check(`default motion ${album?'album':'listen'}: no script errors`,errors.length===0,errors);
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
    const {context,page,requests}=await setup();
    /* timed lyrics come from the lyrics file data/albums.json names for the song; a song it lists without one has no words.
       The draw is pinned to the first public song that names a file, and the fixture supplies two lines for it */
    const songs=JSON.parse(await readFile(join(ROOT,'data/albums.json'),'utf8')).albums.flatMap(a=>a.tracks||[]).filter(t=>!t.gated&&/^assets\/audio\/[a-z0-9._-]+\.(?:mp3|m4a)$/i.test(t.src||'')&&!/preview/i.test(t.src));
    const worded=songs.findIndex(t=>typeof t.lyrics==='string'&&t.lyrics);
    await page.addInitScript(([i,n])=>{Math.random=()=>(i+0.5)/n;},[worded,songs.length]);
    await context.route('**/data/lyrics/*.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({title:'Fixture song',lines:[{t:0.2,text:'Fixture line one'},{t:40,text:'Fixture line two'}]})}));
    const mark=requests.length;
    await page.goto(WORLD+'/?view=feed');
    await page.waitForFunction(()=>!!window.MCC_WORLD_AUDIO?.song()?.pool&&document.getElementById('mnWorldPlay'));
    const theme=await page.evaluate(()=>MCC_WORLD_AUDIO.song());
    await page.waitForTimeout(600);
    /* music slice M3 (PB-12): the theme's element read its fallback song (twice, its index sat at the end) and then the drawn one */
    const themeReads=requests.slice(mark).map(r=>new URL(r.url)).filter(u=>u.pathname.startsWith('/assets/audio/')).map(u=>u.pathname.split('/').pop());
    check('standalone World reads only the song it drew before the first touch (never the fallback first)',themeReads.every(f=>f.replace(/\.[a-z0-9]+$/,'')===theme.slug),{themeReads,drawn:theme.slug});
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
  /* THE PRIVACY NOTICE IS SHOWN ONCE (owner, 2026-10-20): nothing seeded here. The first page shows it; once it is
     answered no other page, neither McCluster host, nor the World that Music opens in a frame shows it again. */
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
    check('privacy: a first visit to a document page sees the banner, not the wall',first.banner&&!first.wall&&!first.pending,first);
    await page.locator('#mccPrivacyNoticeLater').click();
    check('privacy: Not now closes the banner',none(await notice(page)));
    const jar=await context.cookies(HOUSE),seen=jar.find(c=>c.name==='mcc_privacy_seen');
    check('privacy: Not now is kept for every mccluster.org host, as seen and never as agreed',seen?.domain==='.mccluster.org'&&seen.value==='2026-10-19'&&!jar.some(c=>c.name==='mcc_privacy_ack'),jar);
    for(const url of [HOUSE+'/newsroom.html',HOUSE+'/account.html',WORLD+'/mnet.html?view=feed']){
      await page.goto(url,{waitUntil:'load'});
      const u=new URL(url);
      check(`privacy: after Not now, ${u.host}${u.pathname} shows neither banner nor wall, and nothing counts as agreed`,none(await notice(page))&&await page.evaluate(()=>!MCC_PRIVACY.accepted()&&MCC_PRIVACY.seen()));
    }
    check('privacy: after Not now, analytics on the World still records nothing',await page.evaluate(()=>window.MCC_TRACK('privacy_fixture')===false));
    await page.goto(HOUSE+'/listen.html',{waitUntil:'load'});await musicReady(page);
    check('privacy: after Not now, Music shows no wall',none(await notice(page)));
    await play(page);const frame=await world(page);
    check('privacy: after Not now, the World that Music opens does not show it either',none(await notice(page))&&none(await notice(frame))&&await frame.evaluate(()=>!MCC_PRIVACY.accepted()&&MCC_PRIVACY.seen()));
    check('privacy: no notice errors after Not now',privacyErrors(errors).length===0,errors);
    await context.close();
  }
  {
    /* owner finding, 2026-10-28: "The policy promises 'Not now', but the live entry dialog doesn't offer it."
       The wall offers it now, with the behaviour privacy.html#entry-notice describes: in without a reload, seen and
       never agreed, analytics off, not asked again on either host or in the World that Music opens. */
    const {context,page,errors}=await setup(390,false,{privacy:false});
    const first=await notice(page);
    check('privacy: the entry dialog offers Not now',first.wall&&first.pending==='pending'&&await page.locator('#mccPrivacyLater').isVisible()&&(await page.locator('#mccPrivacyLater').boundingBox()).height>=44,first);
    let reloaded=false;page.on('framenavigated',f=>{if(f===page.mainFrame())reloaded=true;});
    await page.locator('#mccPrivacyLater').click();
    check('privacy: Not now on the entry dialog lets the visitor in without a reload',none(await notice(page))&&!reloaded&&await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    const jar=await context.cookies(HOUSE),seen=jar.find(c=>c.name==='mcc_privacy_seen');
    check('privacy: Not now on the entry dialog is kept as seen, never as agreed',seen?.domain==='.mccluster.org'&&seen.value==='2026-10-19'&&!jar.some(c=>c.name==='mcc_privacy_ack')&&await page.evaluate(()=>!MCC_PRIVACY.accepted()&&MCC_PRIVACY.seen()),jar);
    for(const url of [HOUSE+'/account.html',WORLD+'/mnet.html?view=feed']){
      await page.goto(url,{waitUntil:'load'});
      const u=new URL(url);
      check(`privacy: after Not now on the entry dialog, ${u.host}${u.pathname} does not ask again`,none(await notice(page))&&await page.evaluate(()=>!MCC_PRIVACY.accepted()));
    }
    check('privacy: after Not now on the entry dialog, analytics records nothing',await page.evaluate(()=>window.MCC_TRACK('privacy_fixture')===false));
    check('privacy: no notice errors after Not now on the entry dialog',privacyErrors(errors).length===0,errors);
    await context.close();
  }
  {
    /* owner, 2026-10-20: "they see the privacy policy, and then they never see it again". The banner is seen once shown. */
    const {context,page,errors}=await setup(390,false,{privacy:false,start:'/press.html'});
    const first=await notice(page);
    check('privacy: an ignored banner is shown on the first document page',first.banner&&!first.wall&&!first.pending,first);
    const jar=await context.cookies(HOUSE),seen=jar.find(c=>c.name==='mcc_privacy_seen');
    check('privacy: the banner counts as seen with no tap, for every mccluster.org host, and never as agreed',seen?.domain==='.mccluster.org'&&seen.value==='2026-10-19'&&!jar.some(c=>c.name==='mcc_privacy_ack')&&await page.evaluate(()=>MCC_PRIVACY.seen()&&!MCC_PRIVACY.accepted()),jar);
    for(const url of [HOUSE+'/newsroom.html',HOUSE+'/account.html',WORLD+'/',WORLD+'/mnet.html?view=feed']){
      await page.goto(url,{waitUntil:'load'});
      const u=new URL(url);
      check(`privacy: after an ignored banner, ${u.host}${u.pathname} shows neither banner nor wall, and nothing counts as agreed`,none(await notice(page))&&await page.evaluate(()=>!MCC_PRIVACY.accepted()&&MCC_PRIVACY.seen()));
    }
    await page.goto(HOUSE+'/listen.html',{waitUntil:'load'});await musicReady(page);
    check('privacy: after an ignored banner, Music shows no wall',none(await notice(page)));
    await play(page);const frame=await world(page);
    check('privacy: after an ignored banner, the World that Music opens shows no notice',none(await notice(page))&&none(await notice(frame))&&await frame.evaluate(()=>!MCC_PRIVACY.accepted()));
    check('privacy: no notice errors after an ignored banner',privacyErrors(errors).length===0,errors);
    await context.close();
  }
}finally{
  await writeFile(join(OUT,'results.json'),JSON.stringify(result,null,2));await browser.close();
}
