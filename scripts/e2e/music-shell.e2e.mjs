/* ONE PLAYER ACROSS MUSIC PAGES (music slice M5). The first music page a tab opens stays the one document
   that plays; the other music pages open over it as views, each in a fresh same-origin frame (js/music-shell.js).
   Real Listen, artist, album and account documents, real HTMLAudioElement playback of synthetic WAV bytes, every
   request a route fixture (no production API, account or audio), real taps on real links, and the Audio
   constructor, beforeunload and Media Session instrumented in every document, top and frames. Chromium only, with
   Safari's per-document autoplay rule (--autoplay-policy=document-user-activation-required). What an iPhone does is
   Inferred until Matthew's devices run the rows in docs/music/MUSIC-RELEASE-20261119.md.

   Usage: node scripts/e2e/music-shell.e2e.mjs [outdir] [scenario,...]
   Every check is recorded and the suite goes on; a scenario that cannot go on is recorded as aborted. The exit
   code is 1 when anything failed. MUSIC_SHELL_RENDER=<dir> renders Matthew's screenshots (device scale 2) instead. */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, join, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(process.env.MUSIC_SHELL_ROOT||fileURLToPath(new URL('../../',import.meta.url)));
const OUT=process.argv[2]||'/tmp/music-shell-proof';
const ONLY=(process.argv[3]||'').split(',').filter(Boolean);
const RENDER=process.env.MUSIC_SHELL_RENDER||'';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const HOUSE='https://matthew.mccluster.org',WORLD='https://mccluster.org';
const USER='22222222-2222-4222-8222-222222222222';
const ARTIST='44444444-4444-4444-8444-444444444444',ARTIST2='45454545-4545-4545-8545-454545454545';
const T_PUBLIC='55555555-5555-4555-8555-555555555555',T_ACCOUNT='66666666-6666-4666-8666-666666666666',T_SECOND='77777777-7777-4777-8777-777777777777';
const MIME={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon','.txt':'text/plain','.webmanifest':'application/manifest+json'};
await mkdir(OUT,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--autoplay-policy=document-user-activation-required']});
const results=[];
function check(name,pass,detail){results.push({name,pass:!!pass,detail:pass?undefined:detail});console.log(`${pass?'PASS':'FAIL'} ${name}${pass?'':' '+JSON.stringify(detail===undefined?null:detail).slice(0,600)}`);return !!pass;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function wav(seconds=90){
  const rate=8000,count=rate*seconds,b=Buffer.alloc(44+count*2);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*220*i/rate)*1000),44+i*2);
  return b;
}
const AUDIO=wav(90);
const WORLD_TITLE=(/doc\.title = "([^"]+)"/.exec(await readFile(join(ROOT,'js/world-audio-continuity.js'),'utf8'))||[])[1]||'(the World sets no title)';
const GIF=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
function jwt(){return 'x.'+Buffer.from(JSON.stringify({sub:USER,exp:Math.floor(Date.now()/1000)+3600,email:'shell-fixture@invalid.test'})).toString('base64url')+'.y';}
function session(){const t=jwt();return {access_token:t,refresh_token:'shell-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:USER,email:'shell-fixture@invalid.test',identities:[{provider:'email'}]}};}
const PROFILES=[
  {m_uid:ARTIST,handle:'probe-artist',artist_name:'Probe Artist',bio:'Fixture artist for the music shell suite.',avatar_url:'',banner_url:'',website_url:'https://probe-artist.invalid/',verification_state:'unverified',settings:{},status:'active'},
  {m_uid:ARTIST2,handle:'second-artist',artist_name:'Second Artist',bio:'Another fixture artist.',avatar_url:'',banner_url:'',website_url:'',verification_state:'unverified',settings:{},status:'active'}];
const TRACKS=[
  {id:T_PUBLIC,m_uid:ARTIST,title:'Probe Single',artist:'Probe Artist',description:'',poster_url:'',audio_url:'',preview_bucket:'creator-previews',preview_path:'probe/probe-single.wav',access_mode:'public',genre:'',duration_ms:90000,music_video_url:'',lyrics_url:'',experience:null,published_at:'2026-11-02T00:00:00Z'},
  {id:T_ACCOUNT,m_uid:ARTIST,title:'Probe Members Cut',artist:'Probe Artist',description:'',poster_url:'',audio_url:'',preview_bucket:'creator-previews',preview_path:'probe/probe-members.wav',access_mode:'account',genre:'',duration_ms:90000,music_video_url:'',lyrics_url:'',experience:null,published_at:'2026-11-01T00:00:00Z'},
  {id:T_SECOND,m_uid:ARTIST2,title:'Second Song',artist:'Second Artist',description:'',poster_url:'',audio_url:'',preview_bucket:'creator-previews',preview_path:'second/second-song.wav',access_mode:'public',genre:'',duration_ms:90000,music_video_url:'',lyrics_url:'',experience:null,published_at:'2026-10-30T00:00:00Z'}];

/* every document, top and frames: the Audio constructor, beforeunload, Media Session writes, framed documents */
const INSTRUMENT=({member,token,privacy,standalone})=>{
  try{
    if(privacy)localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    sessionStorage.setItem('mcc_premiere','1');
    if(member&&!localStorage.getItem('__shellSeeded')){localStorage.setItem('mccdb_session',JSON.stringify({access_token:token,refresh_token:'shell-refresh',expires_at:Math.floor(Date.now()/1000)+3600}));localStorage.setItem('__shellSeeded','1');}
  }catch(e){}
  if(standalone){try{Object.defineProperty(navigator,'standalone',{value:true,configurable:true});}catch(e){}}
  const top=window===window.top;
  window.__audioObjects=[];window.__audioEvents=[];window.__unloads=0;window.__ms=[];
  const Native=window.Audio;
  window.Audio=function(...a){const x=new Native(...a);window.__audioObjects.push(x);for(const t of ['play','pause','emptied','seeking'])x.addEventListener(t,()=>window.__audioEvents.push({t,time:x.currentTime,src:x.currentSrc}));try{if(!top)window.top.__framedAudio=(window.top.__framedAudio||0)+1;}catch(e){}return x;};
  window.Audio.prototype=Native.prototype;
  addEventListener('beforeunload',()=>window.__unloads++);
  try{
    const ms=navigator.mediaSession;
    if(ms){
      const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ms),'metadata');
      const log=e=>{try{window.top.__msLog=(window.top.__msLog||[]).concat([Object.assign({top,path:location.pathname},e)]);}catch(x){window.__ms.push(e);}};
      if(d)Object.defineProperty(ms,'metadata',{configurable:true,get(){return d.get.call(ms);},set(v){log({what:'metadata',title:v&&v.title});d.set.call(ms,v);}});
      const sah=ms.setActionHandler.bind(ms);ms.setActionHandler=(a,h)=>{log({what:'action',action:a,on:!!h});return sah(a,h);};
    }
  }catch(e){}
  if(!top)document.addEventListener('DOMContentLoaded',()=>{try{window.top.__framedReady=(window.top.__framedReady||[]).concat([location.pathname+location.search]);}catch(e){}});
};

const DELAY={};          // path -> ms: hold a house document's answer (the failure card)
const HOLD={authorize:0,cut:0}; // hold the provider's authorize answer; cut every audio read at this many bytes, the rest held 4 s and refused (a dropped read)
async function setup({width=390,height=844,member=false,privacy=true,start='/listen.html',google=false,standalone=false,scale=1,motion='reduce',server=null}={}){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:scale,hasTouch:true,isMobile:width<700,reducedMotion:motion,serviceWorkers:server?'allow':'block'});
  const log={requests:[],collect:[],errors:[],external:[],frames:[]};
  await context.addInitScript(INSTRUMENT,{member,token:jwt(),privacy,standalone});
  const json=(r,body,status=200)=>r.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},body:JSON.stringify(body)});
  const signedIn=req=>/Bearer x\./.test(req.headers().authorization||'');
  if(!server)await context.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url()),p=u.pathname;
    log.requests.push({url:u.href,method:req.method(),frame:(()=>{try{return req.frame()===req.frame().page().mainFrame()?'top':'frame';}catch{return '?';}})()});
    if(req.method()==='OPTIONS')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.hostname==='api.mccluster.org'){
      if(p==='/v1/collect'){try{log.collect.push(...(JSON.parse(req.postData()||'{}').events||[]));}catch{}return json(r,{ok:true});}
      if(p==='/v1/status')return json(r,{ok:false},403);
      if(p==='/v1/mnet/bootstrap')return json(r,{ok:true,profile:{display_name:'Shell member',onboarding_complete:true},identity:{mccluster_id:'shell-member'},needs_onboarding:false,next_step:null,stats:{}});
      if(/^\/v1\/music\/gates\/[^/]+\/play$/.test(p))return json(r,{error:'not in this suite'},403);
      if(/^\/v1\/music\/gates\//.test(p))return json(r,{ok:true,gate:signedIn(req)?{mode:'rule',allowed:true}:{mode:'rule',allowed:false,reason:'gate_not_ready'}});
      /* the ledger's start answers its listen id, so a finish can be counted (review JRN-2) */
      if(/^\/v1\/music\/listens/.test(p))return json(r,{ok:true,id:'shell-listen',listen_id:'shell-listen'});
      if(p==='/v1/auth/handoff')return json(r,{token_hash:'shell-hash'});
      return json(r,{ok:true,threads:[],posts:[],events:[],missions:[],layers:[],features:[],sources:[],locations:[],rights:{}});
    }
    if(u.hostname.endsWith('supabase.co')){
      if(p.startsWith('/storage/v1/object/public/'))return r.fulfill({status:200,contentType:'audio/wav',headers:{'accept-ranges':'bytes','access-control-allow-origin':'*'},body:AUDIO});
      if(p==='/auth/v1/token')return json(r,session());
      if(p==='/auth/v1/user')return signedIn(req)?json(r,{id:USER,email:'shell-fixture@invalid.test',identities:[{provider:'email'}],user_metadata:{name:'Shell member'}}):json(r,{msg:'no session'},401);
      if(p==='/auth/v1/settings')return json(r,{external:{email:true,google}});
      if(p==='/auth/v1/logout')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*'}});
      if(p==='/auth/v1/authorize'){if(HOLD.authorize)await sleep(HOLD.authorize);return r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>provider</title><p>provider fixture</p>'}).catch(()=>{});}
      if(p==='/functions/v1/music-access')return json(r,{url:'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-previews/probe/full.wav',expires_in:3600});
      if(p==='/rest/v1/music_creator_profiles'){const h=u.searchParams.get('handle');return json(r,h?PROFILES.filter(x=>'eq.'+x.handle===h):PROFILES);}
      if(p==='/rest/v1/creator_tracks'){const m=u.searchParams.get('m_uid');return json(r,m?TRACKS.filter(t=>'eq.'+t.m_uid===m):TRACKS);}
      if(p==='/rest/v1/rpc/music_creator_state')return json(r,{creator:false});
      if(p==='/rest/v1/rpc/current_m_uid')return json(r,null);
      return json(r,[]);
    }
    if(u.origin===HOUSE||u.origin===WORLD){
      if(p.startsWith('/assets/audio/')){
        const m=/bytes=(\d+)-(\d*)/.exec(req.headers().range||'');
        /* the synthetic WAV, or for a dropped read the house's own file (a WAV's metadata needs its last bytes) */
        let body=AUDIO,type='audio/wav';
        if(HOLD.cut){try{body=await readFile(resolve(ROOT,'.'+decodeURIComponent(p)));type=/\.m4a$/.test(p)?'audio/mp4':'audio/mpeg';}catch{}}
        try{
          if(HOLD.cut&&m&&Number(m[1])>=HOLD.cut){await sleep(4000);return await r.fulfill({status:503,body:''});}
          if(m){const s=Number(m[1]);let e=Math.min(m[2]?Number(m[2]):body.length-1,body.length-1);if(HOLD.cut)e=Math.min(e,HOLD.cut-1);return await r.fulfill({status:206,contentType:type,headers:{'accept-ranges':'bytes','content-range':`bytes ${s}-${e}/${body.length}`},body:body.subarray(s,e+1)});}
          return await r.fulfill({status:200,contentType:type,headers:{'accept-ranges':'bytes'},body});
        }catch{return;}
      }
      if(DELAY[p])await sleep(DELAY[p]);
      const path=resolve(ROOT,'.'+(p==='/'?(u.origin===WORLD?'/mnet.html':'/index.html'):decodeURIComponent(p)));
      if(path.startsWith(ROOT+sep)){try{const body=await readFile(path);return await r.fulfill({body,contentType:MIME[extname(path)]||'application/octet-stream'});}catch{}}
      if(/\.(?:png|jpe?g|webp|gif)$/.test(p))return r.fulfill({contentType:'image/gif',body:GIF});
      return r.fulfill({status:404,body:'shell fixture: absent'});
    }
    log.external.push(u.href);
    return r.abort();
  });
  const page=await context.newPage();
  page.on('pageerror',e=>log.errors.push(String(e.message).slice(0,200)));
  page.on('framenavigated',f=>{if(f!==page.mainFrame())log.frames.push(f.url());});
  const base=server||HOUSE;
  if(start)await page.goto(base+start,{waitUntil:'load'});
  await page.evaluate(()=>{window.__docMark='retained';}).catch(()=>{});
  return {context,page,log,base};
}
/* ---------- helpers ---------- */
const viewSel='#mccMusicView[data-view-state="shown"] #mccMusicViewFrame[data-mcc-ready="1"]';
async function waitView(page,re,timeout=9000){
  const end=Date.now()+timeout;let last='';
  while(Date.now()<end){
    for(const h of await page.locator(viewSel).elementHandles().catch(()=>[])){const f=await h.contentFrame().catch(()=>null);if(f){last=f.url();if(!re||re.test(last))return f;}}
    await sleep(100);
  }
  throw new Error('no view shown'+(last?' (the view shown is at '+last+')':'')+' within '+timeout+' ms');
}
async function view(page){const h=await page.$(viewSel);return h?h.contentFrame():null;}
/* every view frame in the layer, the one shown and any still opening */
async function frames(page){return page.evaluate(()=>document.querySelectorAll('#mccMusicView .mcc-music-frame').length).catch(()=>-1);}
/* every playing media element in the top and in every frame (audio, and video that is not muted) */
async function playing(page){
  let n=0;const where=[];
  for(const f of page.frames()){
    const k=await f.evaluate(()=>{const s=new Set([...(window.__audioObjects||[]),...document.querySelectorAll('audio,video')]);return [...s].filter(a=>!a.paused&&!(a.tagName==='VIDEO'&&a.muted)).length;}).catch(()=>0);
    if(k){n+=k;where.push(f===page.mainFrame()?'top':f.url().replace(/^https?:\/\/[^/]+/,''));}
  }
  return {n,where};
}
async function engine(page){return page.evaluate(()=>window.MCC_MUSIC&&MCC_MUSIC.audio?{t:MCC_MUSIC.audio.currentTime,src:MCC_MUSIC.audio.currentSrc,paused:MCC_MUSIC.audio.paused,muted:MCC_MUSIC.audio.muted,same:window.__orig===MCC_MUSIC.audio,mark:window.__docMark||null,title:MCC_MUSIC.current()&&MCC_MUSIC.current().title,events:(window.__audioEvents||[]).length}:{t:0,mark:window.__docMark||null,same:false}).catch(e=>({error:String(e)}));}
async function deck(page){return page.evaluate(()=>{const d=document.getElementById('deck');return d?{t:d.currentTime,src:d.currentSrc,paused:d.paused,same:window.__orig===d,mark:window.__docMark||null}:{t:0,mark:window.__docMark||null,same:false};}).catch(e=>({error:String(e)}));}
async function markEngine(page){await page.evaluate(()=>{window.__orig=MCC_MUSIC.audio;window.__trans=[];for(const t of ['pause','emptied','seeking','play'])MCC_MUSIC.audio.addEventListener(t,()=>window.__trans.push(t));});}
async function markDeck(page){await page.evaluate(()=>{const d=document.getElementById('deck');window.__orig=d;window.__trans=[];for(const t of ['pause','emptied','seeking','play'])d.addEventListener(t,()=>window.__trans.push(t));});}
async function trans(page){return page.evaluate(()=>window.__trans||null).catch(()=>null);}
/* Listen lists artists and albums; a song is found by its search (music quick wins Q2, 2026-11-23) */
async function findListen(where,title,album){
  const sel=`[data-music-play][data-album="${album}"][data-track="${title}"]`;
  await where.waitForSelector('#q',{timeout:15000});
  await where.fill('#q',title);
  await where.waitForSelector(sel,{state:'visible',timeout:15000});
  return where.locator(sel).first();
}
async function playListen(page,title='Who Did The Shoot',album='here',where=page){
  await (await findListen(where,title,album)).click();
  await page.waitForFunction(t=>window.MCC_MUSIC&&MCC_MUSIC.current()&&MCC_MUSIC.current().title===t&&!MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.currentTime>.3,title,{timeout:15000});
}
async function playAlbumRow(page,n=1){
  await page.waitForSelector('#tracks li',{timeout:15000});
  await page.locator('#tracks li').nth(n).click();
  await page.waitForFunction(()=>{const d=document.getElementById('deck');return d&&!d.paused&&d.currentTime>.3;},null,{timeout:15000});
}
async function settle(page,ms=1600){await sleep(ms);await page.waitForLoadState('load').catch(()=>{});}
async function path(page){return page.evaluate(()=>location.pathname+location.search).catch(()=>new URL(page.url()).pathname);}
async function scenario(name,fn){
  if(ONLY.length&&!ONLY.includes(name))return;
  console.log('== '+name);
  try{await fn();}catch(e){check(`${name}: aborted (${String(e&&e.message||e).split('\n')[0].slice(0,160)})`,false);}
}
/* ENGINE STAGE 0, A0.3: a card's play button inside its link. Listen's cards wrap the button in the card's link: a
   creator's card in the artist page's (js/music-community.js), and a song card in its album's (js/listen.js card(), shown
   while the song rails are on). Where a page renders no such card today (an artist page; Listen with the song rails
   off) the same card is put on it here, Listen's own markup: the handlers that misread it are the page's, not the
   card's. */
async function songCard(where,album,title){
  await where.evaluate(([album,title])=>{
    document.getElementById('a03Card')?.remove();
    const a=document.createElement('a');
    a.className='feat__card';a.id='a03Card';a.setAttribute('data-cta','listen-card');
    a.href='album.html?album='+encodeURIComponent(album)+'&t='+encodeURIComponent(title);
    a.style.cssText='display:block;position:relative;margin:12px 16px;min-height:72px';
    const b=document.createElement('b');b.textContent=title;
    const acts=document.createElement('span');acts.className='feat__acts';
    const play=document.createElement('span');
    play.className='feat__play';play.id='a03Play';play.setAttribute('role','button');play.tabIndex=0;
    play.setAttribute('aria-label','Play '+title);play.setAttribute('aria-pressed','false');
    play.setAttribute('data-music-play','');play.setAttribute('data-album',album);play.setAttribute('data-track',title);
    play.style.cssText='display:inline-flex;width:44px;height:44px;align-items:center;justify-content:center';
    play.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    acts.appendChild(play);a.appendChild(b);a.appendChild(acts);
    (document.querySelector('main')||document.body).prepend(a);
  },[album,title]);
  return where.locator('#a03Play');
}
/* what the top document is, its address and history, and the view frame shown (marked by the caller) */
async function where(page){return page.evaluate(()=>{const f=document.getElementById('mccMusicViewFrame');return {path:location.pathname+location.search,len:history.length,mark:window.__docMark||null,unloads:window.__unloads,frames:document.querySelectorAll('#mccMusicView .mcc-music-frame').length,frame:f?f.__mark||null:null};}).catch(e=>({error:String(e).slice(0,120)}));}
/* the retained engine plays this song (a catalogue title, or a creator track id), its clock moving */
async function nowPlays(page,test){
  return page.waitForFunction(t=>{const m=window.MCC_MUSIC,c=m&&m.current&&m.current();return !!c&&(c.title===t||c.creatorTrackId===t)&&!!m.audio&&!m.audio.paused&&m.audio.currentTime>.3;},test,{timeout:15000}).then(()=>true,()=>false);
}

/* ---------- MATTHEW'S RENDERS (device scale 2), run on their own ---------- */
if(RENDER){
  await mkdir(RENDER,{recursive:true});
  const shot=async(page,name)=>{await sleep(500);await page.screenshot({path:join(RENDER,name+'.png')});console.log('rendered',name);};
  for(const width of [390,1280]){
    {const {context,page}=await setup({width,scale:2});
     await playListen(page);await shot(page,`listen-${width}-playing`);
     await page.locator('a.artist[href*="handle=probe-artist"]').first().click();await waitView(page,/music-creator/);await (await view(page)).waitForSelector('#creatorArtist .ap-hero__line');
     await shot(page,`artist-view-over-listen-${width}-song-plays-on`);
     await page.goBack();await settle(page,900);await shot(page,`listen-${width}-back-song-plays-on`);
     await context.close();}
    /* the album, contained in Release 2: a page of its own with its own deck (no view ever opens over it) */
    {const {context,page}=await setup({width,scale:2,start:'/album.html?album=here'});
     await playAlbumRow(page,1);await shot(page,`album-${width}-playing`);
     await context.close();}
    /* signing in over the music: the account page as a view over Listen, the song playing on */
    {const {context,page}=await setup({width,scale:2});
     await playListen(page);await page.locator('#mccAuthChip').click();await waitView(page,/account\.html/);
     await shot(page,`account-view-over-listen-${width}-song-plays-on`);await context.close();}
    /* engine stage 0: a creator card's play button tapped in Listen shown over an artist page plays it; the view stays */
    {const {context,page}=await setup({width,scale:2,start:'/music-creator.html?handle=probe-artist'});
     await page.waitForSelector('a.music-contextbar__brand');await page.locator('a.music-contextbar__brand').click();
     const v=await waitView(page,/listen\.html/);
     await v.locator(`#creatorRail [data-music-play][data-creator-track="${T_SECOND}"]`).click();
     await nowPlays(page,T_SECOND);
     await shot(page,`listen-view-over-artist-${width}-card-play-plays`);await context.close();}
  }
  {DELAY['/music-creator.html']=10000;const {context,page}=await setup({width:390,scale:2});await playListen(page);
   await page.locator('a.artist[href*="handle=probe-artist"]').first().click();await page.waitForSelector('.mcc-music-fail',{timeout:12000});
   await shot(page,'failure-card-390');delete DELAY['/music-creator.html'];await context.close();}
  await browser.close();process.exit(0);
}

try{
/* ---------- STAGE 1: Listen and the artist pages ---------- */
await scenario('s1',async()=>{
  /* tests 1, 2, 5, 9, 16: Listen playing -> an artist card -> Back -> Forward -> the bar's Music tab */
  const {context,page,log}=await setup();
  await playListen(page);await markEngine(page);
  const startLen=await page.evaluate(()=>history.length);
  const before=await engine(page);
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  await settle(page);
  const after=await engine(page),sound=await playing(page);
  check('1. Listen -> artist card: the top document stays (no page load, no beforeunload)',after.mark==='retained'&&await page.evaluate(()=>window.__unloads===0).catch(()=>false),after);
  check('1. the same Audio object plays on',after.same===true,after);
  check('1. its clock advances by more than 1 s across the switch',after.t>before.t+1,{before:before.t,after:after.t});
  check('1. the same source, and no pause, emptied or seeking on it',after.src===before.src&&JSON.stringify(await trans(page))==='[]',{src:after.src,trans:await trans(page)});
  check('1. exactly one playing media element across the top and every frame',sound.n===1,sound);
  check('1. the address is the artist page',await path(page)==='/music-creator.html?handle=probe-artist',await path(page));
  const v=await waitView(page,/music-creator\.html\?handle=probe-artist/,4000);
  await v.waitForSelector('#creatorArtist .ap-hero__line',{timeout:10000});
  check('1. the artist page is shown as a view, in one frame',await frames(page)===1);
  const ms=await page.evaluate(()=>({title:navigator.mediaSession.metadata&&navigator.mediaSession.metadata.title,log:window.__msLog||[]}));
  check('5. the lock screen still names the playing song after the switch',ms.title==='Who Did The Shoot',ms.title);
  check('5. no frame ever sets Media Session metadata or a handler',ms.log.every(e=>e.top),ms.log.filter(e=>!e.top));
  const focus=await v.evaluate(()=>({h1:document.activeElement&&document.activeElement.id,top:window.top.document.activeElement&&window.top.document.activeElement.id,ring:document.activeElement?getComputedStyle(document.activeElement).outlineStyle:null,glow:document.activeElement?getComputedStyle(document.activeElement).boxShadow:null}));
  check('16. the focus moves into the view, onto its heading',focus.h1==='creatorArtist'&&focus.top==='mccMusicViewFrame',focus);
  check('16. the heading takes the focus without a control\'s ring or glow (it is not a control)',focus.ring==='none'&&focus.glow==='none',focus);
  const bars=await page.evaluate(()=>{const vis=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};const f=document.getElementById('mccMusicViewFrame');return {top:[...document.querySelectorAll('.appbar')].filter(vis).length,view:[...f.contentDocument.querySelectorAll('.appbar,.mcc-auth-nav')].filter(vis).length,chips:[...document.querySelectorAll('#mccAuthChip')].filter(vis).length};});
  check('9. one visible bar and one account chip across the top and the frame',bars.top===1&&bars.view===0&&bars.chips===1,bars);
  const frameA=await page.evaluate(()=>{const f=document.getElementById('mccMusicViewFrame');f.__mark='first';return true;});
  const t1=(await engine(page)).t;
  await page.goBack();await settle(page,1200);
  const back=await engine(page);
  check('2. Back reveals Listen: the same element, still advancing',back.same&&back.t>t1+.5&&!back.paused,{back,t1});
  check('2. Back removes the view frame',await frames(page)===0&&await path(page)==='/listen.html',await path(page));
  check('16. after Back the focus is on the card that opened the view',await page.evaluate(()=>!!document.activeElement&&document.activeElement.matches('a.artist[href*="handle=probe-artist"]')),await page.evaluate(()=>document.activeElement&&document.activeElement.outerHTML.slice(0,80)));
  await page.goForward();await waitView(page,/probe-artist/);await settle(page,800);
  const fwd=await engine(page);
  check('2. Forward shows the artist view again, the same element still advancing',fwd.same&&fwd.t>back.t+.5&&!fwd.paused,{fwd,back:back.t});
  check('2. Forward builds a new frame (a fresh document per view)',await page.evaluate(()=>{const f=document.getElementById('mccMusicViewFrame');return !!f&&f.__mark!=='first';}));
  check('2. history grew only by the top\'s own push',await page.evaluate(()=>history.length)===startLen+1,{start:startLen,now:await page.evaluate(()=>history.length)});
  await page.locator('.appbar [data-appnav="music"]').click();await settle(page,1000);
  check('9. the bar\'s Music tab in an artist view reveals Listen, the song playing on',await path(page)==='/listen.html'&&await frames(page)===0&&(await engine(page)).same&&!(await engine(page)).paused,await path(page));
  check('1. no page error in any document',log.errors.length===0,log.errors);
  await context.close();
});
await scenario('s2',async()=>{
  /* test 3: the artist page as the retained document, its release playing -> the Music brand link */
  const {context,page}=await setup({start:'/music-creator.html?handle=probe-artist'});
  await page.waitForSelector(`#creatorPublicTracks [data-creator-track="${T_PUBLIC}"]`,{timeout:15000});
  await page.locator(`#creatorPublicTracks [data-creator-track="${T_PUBLIC}"]`).click();
  await page.waitForFunction(()=>!MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.currentTime>.3,null,{timeout:15000});
  await markEngine(page);const before=await engine(page);
  await page.locator('a.music-contextbar__brand').click();await settle(page);
  const after=await engine(page);
  check('3. artist page -> Music brand link: the top document stays and the release plays on',after.mark==='retained'&&after.same&&after.t>before.t+1&&!after.paused,{before,after});
  check('3. Listen opens as a view at its own address',await path(page)==='/listen.html'&&!!(await view(page).catch(()=>null)),await path(page));
  const v=await waitView(page,/listen\.html/,4000);
  check('3. one playing element across the documents',(await playing(page)).n===1,await playing(page));
  /* test 4: a catalogue song chosen inside the Listen view plays in the retained engine, through its resolver */
  await (await findListen(v,'OSINT','prim3')).click();
  await page.waitForFunction(()=>MCC_MUSIC.current()&&MCC_MUSIC.current().title==='OSINT'&&!MCC_MUSIC.audio.paused,null,{timeout:10000});
  const inView=await v.evaluate(()=>({audios:(window.__audioObjects||[]).length,mini:!!document.getElementById('musicMini'),pressed:[...document.querySelectorAll('[data-music-play][data-track="OSINT"]')].some(b=>b.getAttribute('aria-pressed')==='true')}));
  check('4. a catalogue song tapped in a Listen view plays on the retained engine\'s element',(await engine(page)).same&&(await playing(page)).n===1,await playing(page));
  check('4. the view made no Audio and no player of its own, and shows the song as playing',inView.audios===0&&!inView.mini&&inView.pressed,inView);
  /* the queue is the engine's: near its end the song completes and the next catalogue song follows */
  await page.evaluate(()=>{MCC_MUSIC.audio.currentTime=MCC_MUSIC.audio.duration-1.2;});
  await page.waitForFunction(()=>MCC_MUSIC.current()&&MCC_MUSIC.current().title!=='OSINT'&&!MCC_MUSIC.audio.paused,null,{timeout:12000});
  check('4. a catalogue song plays to its end and the engine\'s queue moves on',(await engine(page)).same,await engine(page));
  /* test 14: a view to another view: a new frame element (a fresh document), the old one gone once the new one painted, one entry */
  const len0=await page.evaluate(()=>history.length);
  await page.evaluate(()=>{document.getElementById('mccMusicViewFrame').__mark='listen';});
  await v.waitForSelector('a.artist[href*="handle=second-artist"]',{timeout:15000});
  await v.locator('a.artist[href*="handle=second-artist"]').first().click();
  await waitView(page,/second-artist/);await settle(page,600);
  const sw=await page.evaluate(()=>({n:document.querySelectorAll('#mccMusicViewFrame').length,fresh:!!document.getElementById('mccMusicViewFrame')&&document.getElementById('mccMusicViewFrame').__mark!=='listen',len:history.length,path:location.pathname+location.search}));
  check('14. a view to another view: a fresh frame element, the old one gone, one history entry',sw.n===1&&sw.fresh&&sw.len===len0+1&&sw.path==='/music-creator.html?handle=second-artist',{...sw,len0});
  check('14. the song plays on across it, on the same element',(await engine(page)).same&&!(await engine(page)).paused&&(await playing(page)).n===1,await engine(page));
  await context.close();
});
await scenario('s3',async()=>{
  /* test 4: a creator release chosen inside an artist view; a guest's protected preview stops at 30 s, and the record stops
     after the artist's last song (music quick wins Q6); the held closing song stays held from a view, and no claim is ever
     sent (Q5) */
  const {context,page,log}=await setup();
  await page.waitForSelector('a.artist[href*="handle=probe-artist"]',{timeout:15000});
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  const v=await waitView(page,/probe-artist/);
  await v.waitForSelector(`#creatorPublicTracks [data-creator-track="${T_PUBLIC}"]`,{timeout:15000});
  await v.locator(`#creatorPublicTracks [data-creator-track="${T_PUBLIC}"]`).click();
  await page.waitForFunction(id=>MCC_MUSIC.current()&&MCC_MUSIC.current().creatorTrackId===id&&!MCC_MUSIC.audio.paused,T_PUBLIC,{timeout:10000});
  await markEngine(page);
  check('4. a creator release tapped in an artist view plays on the retained engine',(await playing(page)).n===1&&await v.evaluate(()=>(window.__audioObjects||[]).length===0),await playing(page));
  check('4. it came from its own public preview object, as on the page',log.requests.some(q=>/\/storage\/v1\/object\/public\/creator-previews\/probe\/probe-single\.wav/.test(q.url)));
  await page.evaluate(()=>MCC_MUSIC.next());
  await page.waitForFunction(id=>MCC_MUSIC.current()&&MCC_MUSIC.current().creatorTrackId===id,T_ACCOUNT,{timeout:10000});
  check('4. Next moves along the engine\'s queue to the artist\'s next release',await page.evaluate(()=>MCC_MUSIC.access()==='preview'||MCC_MUSIC.access()==='loading'));
  await page.waitForFunction(()=>!MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.duration>0,null,{timeout:10000});
  await page.evaluate(()=>{MCC_MUSIC.audio.currentTime=28.6;});
  /* the artist's last song: the record stops there, at the preview's end, never past it (music quick wins Q6) */
  await page.waitForFunction(()=>MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.currentTime>=29,null,{timeout:12000});
  await sleep(800);
  const stop=await page.evaluate(()=>({now:MCC_MUSIC.current()&&MCC_MUSIC.current().creatorTrackId,paused:MCC_MUSIC.audio.paused,at:MCC_MUSIC.audio.currentTime,events:window.__trans}));
  check('4. a guest\'s protected preview stops at 30 s; the artist\'s last song, so the record stops there, never past the preview (music quick wins Q6)',stop.now===T_ACCOUNT&&stop.paused&&stop.at>=29&&stop.at<30,stop);
  check('4. still one element, never a second',(await engine(page)).same,await engine(page));
  /* the closing song from a Listen view over the artist top: it stays held (music quick wins Q5, 2026-11-23). The
     view's one pop-up says why; nothing is read for it, nothing plays, and no claim is ever sent. It is found as the
     held song of its album, never named here */
  const HELD=(JSON.parse(await readFile(join(ROOT,'data/albums.json'),'utf8')).albums.find(a=>a.slug==='cia-mind-control').tracks.find(t=>t.hold)||{}).title;
  await page.goto(HOUSE+'/music-creator.html?handle=probe-artist');await page.waitForLoadState('load');
  await page.waitForSelector('a.music-contextbar__brand');await page.locator('a.music-contextbar__brand').click();
  const lv=await waitView(page,/listen\.html/);
  const reads0=log.requests.filter(q=>/\/assets\/audio\/|\/storage\/v1\/object\//.test(q.url)).length;
  await (await findListen(lv,HELD,'cia-mind-control')).click();
  await lv.waitForFunction(()=>{const d=document.getElementById('mccHold');return !!d&&d.open;},null,{timeout:12000}).catch(()=>{});
  await sleep(1200);
  const held=await page.evaluate(t=>{const top=document.getElementById('mccHold');return {heldNow:!!(MCC_MUSIC.current()&&MCC_MUSIC.current().title===t),playing:!MCC_MUSIC.audio.paused,topPopup:!!top&&top.open};},HELD);
  const said=await lv.evaluate(()=>{const d=document.getElementById('mccHold');return d&&d.open?{title:d.querySelector('h2').textContent,text:d.querySelector('p').textContent,action:d.querySelector('a').getAttribute('href')}:null;});
  const reads=log.requests.filter(q=>/\/assets\/audio\/|\/storage\/v1\/object\//.test(q.url)).length-reads0;
  check('4. the closing song stays held from a view: the view\'s one pop-up says why, nothing is read or played, no claim is ever sent (music quick wins Q5)',!!HELD&&!!said&&/sign in/i.test(said.text)&&/^account\.html/.test(said.action)&&!held.heldNow&&!held.playing&&!held.topPopup&&reads===0&&!log.requests.some(q=>/\/v1\/music\/gates\/[^/]+\/play/.test(q.url)),{said,held,reads});
  await context.close();
});
await scenario('s4',async()=>{
  /* test 6: pause and mute stay deliberate across three switches */
  const {context,page}=await setup();
  await playListen(page);await markEngine(page);
  await page.locator('#musicMiniPlay').click();await page.waitForFunction(()=>MCC_MUSIC.audio.paused);
  const t0=(await engine(page)).t;await page.evaluate(()=>{window.__trans=[];});
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();await settle(page,1200);
  await page.goBack();await settle(page,900);await page.goForward();await settle(page,1200);
  const e=await engine(page);
  check('6. paused, then three switches: still paused, the same second, no play',e.same&&e.paused&&Math.abs(e.t-t0)<.05&&!(await trans(page)||['?']).includes('play'),{e,t0,trans:await trans(page)});
  await page.goBack();await settle(page,800);
  await page.locator('#musicMiniPlay').click();await page.waitForFunction(()=>!MCC_MUSIC.audio.paused);
  await page.evaluate(()=>{MCC_MUSIC.audio.muted=true;});
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();await settle(page,1200);
  await page.goBack();await settle(page,900);await page.goForward();await settle(page,1200);
  const m=await engine(page);
  check('6. muted, then three switches: still muted and playing',m.same&&m.muted&&!m.paused,m);
  await context.close();
});
await scenario('s5',async()=>{
  /* test 7: the live head follows the page shown; the retained page's own identity comes back byte for byte */
  const {context,page}=await setup();
  const ident=()=>page.evaluate(()=>[...document.head.querySelectorAll('title,meta[name="description"],link[rel="canonical"],script[type="application/ld+json"],meta[property^="og:"],meta[name^="twitter:"]')].map(n=>n.outerHTML));
  const own=await ident();
  await page.waitForSelector('a.artist[href*="handle=probe-artist"]',{timeout:15000});
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  const v=await waitView(page,/probe-artist/);await v.waitForSelector('#creatorArtist .ap-hero__line',{timeout:10000});await sleep(400);
  const vh=await v.evaluate(()=>({title:document.title,desc:(document.querySelector('meta[name="description"]')||{}).content||null,canonical:!!document.querySelector('link[rel="canonical"]')}));
  const th=await page.evaluate(()=>({title:document.title,desc:(document.querySelector('meta[name="description"]')||{}).content||null,canonical:document.querySelectorAll('link[rel="canonical"]').length,ld:document.querySelectorAll('script[type="application/ld+json"]').length,og:document.querySelectorAll('meta[property^="og:"]').length}));
  check('7. in an artist view the top shows the artist page\'s title, after its profile loaded',th.title===vh.title&&/Probe Artist/.test(th.title),{th,vh});
  check('7. its description, and no canonical (the artist page has none)',th.desc===vh.desc&&th.canonical===0&&!vh.canonical,{th,vh});
  check('7. no JSON-LD and no og: of the retained page readable while the view shows',th.ld===0&&th.og===0,th);
  await page.goBack();await settle(page,900);
  const back=await ident();
  check('7. on reveal the retained page\'s title, description, canonical, JSON-LD and og: are back byte for byte',JSON.stringify(back)===JSON.stringify(own),{own:own.length,back:back.length});
  /* artist top -> Listen view: Listen's canonical is mirrored, the artist page's own head comes back */
  await page.goto(HOUSE+'/music-creator.html?handle=probe-artist');await page.waitForFunction(()=>/Probe Artist/.test(document.title));
  const own2=await ident();
  await page.locator('a.music-contextbar__brand').click();await waitView(page,/listen\.html/);await sleep(400);
  const lt=await page.evaluate(()=>({title:document.title,canonical:(document.querySelector('link[rel="canonical"]')||{}).href||null}));
  check('7. in a Listen view over an artist page the top names Listen and its canonical',/^Listen/.test(lt.title)&&lt.canonical==='https://matthew.mccluster.org/listen.html',lt);
  await page.goBack();await settle(page,900);
  check('7. and the artist page\'s own head comes back byte for byte',JSON.stringify(await ident())===JSON.stringify(own2));
  /* the album, contained in Release 2 (SPEC-ENGINE 4.10; changed on purpose from "the album as the retained document: its
     JSON-LD and og: are held aside under a Listen view and come back byte for byte"): the album is never covered, so its
     head is never held aside or mirrored; its Music tab is a page load of Listen, which arrives with its own head */
  await page.goto(HOUSE+'/album.html?album=here');await page.waitForLoadState('load');await sleep(600);
  const own3=await ident();
  check('7. the album\'s own head is whole on the album, its JSON-LD with it',own3.some(n=>/application\/ld\+json/.test(n))&&own3.some(n=>/og:/.test(n)),{own:own3.length});
  await page.evaluate(()=>{window.__docMark='album';});
  await page.locator('.appbar [data-appnav="music"]').click();
  await page.waitForURL(/\/listen\.html$/,{timeout:10000}).catch(()=>{});await page.waitForLoadState('load');await sleep(400);
  const al=await page.evaluate(()=>({mark:window.__docMark||null,title:document.title,canonical:(document.querySelector('link[rel="canonical"]')||{}).href||null,frames:document.querySelectorAll('#mccMusicViewFrame').length}));
  check('7. the album\'s Music tab is a page load of Listen (no view over the album): Listen\'s own title and canonical',al.mark!=='album'&&al.frames===0&&/^Listen/.test(al.title)&&al.canonical==='https://matthew.mccluster.org/listen.html',al);
  await page.goBack();await settle(page,900);
  check('7. and Back is the album with its own head, byte for byte',JSON.stringify(await ident())===JSON.stringify(own3));
  await context.close();
});
await scenario('s6',async()=>{
  /* test 8: analytics, with consent and without */
  const {context,page,log}=await setup();
  await playListen(page);await sleep(3000);log.collect.length=0;
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  const v=await waitView(page,/probe-artist/);await v.waitForSelector('#creatorArtist .ap-hero__line',{timeout:10000});await sleep(3500);
  const views=log.collect.filter(e=>e.name==='page_view');
  check('8. entering a view sends exactly one page_view, with the view\'s path and title',views.length===1&&views[0].path==='music-creator.html'&&views[0].props&&views[0].props.creator_handle==='probe-artist',views.map(e=>({path:e.path,props:e.props&&{title:e.props.title,h:e.props.creator_handle}})));
  check('8. the view\'s referrer is the page it was opened from',views[0]&&views[0].referrer==='https://matthew.mccluster.org/listen.html',views[0]&&views[0].referrer);
  /* the Listen song ends while the artist view shows: filed under Listen, with no creator_handle */
  log.collect.length=0;
  await page.evaluate(()=>{MCC_MUSIC.audio.currentTime=MCC_MUSIC.audio.duration-1;});
  await page.waitForFunction(()=>MCC_MUSIC.current()&&MCC_MUSIC.current().title!=='Who Did The Shoot',null,{timeout:12000});await sleep(3500);
  const done=log.collect.filter(e=>e.name==='music_complete');
  check('8. a Listen song completing under an artist view is filed under Listen, with no creator_handle',done.length>=1&&done.every(e=>e.path==='listen.html'&&!(e.props&&e.props.creator_handle)),done.map(e=>({path:e.path,h:e.props&&e.props.creator_handle})));
  log.collect.length=0;
  await v.locator(`#creatorPublicTracks [data-creator-track="${T_PUBLIC}"]`).click();
  await page.waitForFunction(id=>MCC_MUSIC.current()&&MCC_MUSIC.current().creatorTrackId===id,T_PUBLIC,{timeout:10000});await sleep(3500);
  const chosen=log.collect.filter(e=>e.name==='music_play');
  check('8. a release chosen in an artist view carries that artist\'s creator_handle',chosen.length>=1&&chosen.every(e=>e.props&&e.props.creator_handle==='probe-artist'),chosen.map(e=>({path:e.path,h:e.props&&e.props.creator_handle})));
  log.collect.length=0;
  await page.goBack();await settle(page,900);await page.goForward();await waitView(page,/probe-artist/);await sleep(3500);
  const again=log.collect.filter(e=>e.name==='page_view');
  check('8. a view rebuilt by Back and Forward still names the page it was opened from',again.length===1&&again[0].referrer==='https://matthew.mccluster.org/listen.html',again.map(e=>e.referrer));
  check('8. revealing the retained page records no page_view of its own',!again.some(e=>e.path==='listen.html'));
  await context.close();
  const quiet=await setup({privacy:false});
  /* the privacy gate answered "Not now": seen, not agreed (js/live-content.js) */
  await quiet.page.waitForSelector('#mccPrivacyLater',{timeout:10000});await quiet.page.locator('#mccPrivacyLater').click();
  await quiet.page.waitForSelector('a.artist[href*="handle=probe-artist"]',{timeout:15000});
  await quiet.page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  await waitView(quiet.page,/probe-artist/);await sleep(3500);
  check('8. without consent nothing is sent from either document',quiet.log.collect.length===0&&!quiet.log.requests.some(q=>/\/v1\/collect|functions\/v1\/collect/.test(q.url)),quiet.log.collect.length);
  await quiet.context.close();
});
await scenario('s7',async()=>{
  /* test 10: the World over a view */
  const {context,page}=await setup();
  await playListen(page);await markEngine(page);
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  const v=await waitView(page,/probe-artist/);await v.waitForSelector('#creatorArtist .ap-hero__line',{timeout:10000});await sleep(300);
  const artistTitle=await page.title();
  await page.locator('.appbar [data-appnav="world"]').click();
  await page.waitForFunction(()=>window.MCC_WORLD_AUDIO&&MCC_WORLD_AUDIO.active(),null,{timeout:10000});await sleep(1500);
  const w=await engine(page);
  check('10. the Globe in an artist view opens the World with the same element advancing',w.same&&!w.paused&&w.mark==='retained',w);
  check('10. the address is the artist view\'s, with world=1',await path(page)==='/music-creator.html?handle=probe-artist&world=1',await path(page));
  check('10. the title is the World\'s (the one js/world-audio-continuity.js sets)',await page.title()===WORLD_TITLE,{title:await page.title(),WORLD_TITLE});
  await page.goBack();await settle(page,1000);
  check('10. Back closes the World onto the artist view',!(await page.evaluate(()=>MCC_WORLD_AUDIO.active()))&&await path(page)==='/music-creator.html?handle=probe-artist'&&await frames(page)===1,await path(page));
  check('10. the artist view\'s title comes back',await page.title()===artistTitle,{now:await page.title(),artistTitle});
  await page.goBack();await settle(page,1000);
  check('10. Back again reveals Listen with its own title, the same element playing',await path(page)==='/listen.html'&&/^Listen/.test(await page.title())&&(await engine(page)).same&&!(await engine(page)).paused,{path:await path(page),title:await page.title()});
  /* a link to the World inside a view takes the bar's Globe path: the World opens from the retained document */
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  const v2=await waitView(page,/probe-artist/);await v2.waitForSelector('#creatorArtist .ap-hero__line',{timeout:10000});
  await v2.evaluate(()=>{const a=document.createElement('a');a.href='https://mccluster.org/?view=feed';a.id='worldLink';a.textContent='World';document.body.appendChild(a);});
  await v2.locator('#worldLink').click();
  await page.waitForFunction(()=>window.MCC_WORLD_AUDIO&&MCC_WORLD_AUDIO.active(),null,{timeout:10000}).catch(()=>{});await sleep(800);
  const lw=await engine(page);
  check('10. a link to the World inside a view opens the World over it from the retained document, the same element playing',lw.same&&!lw.paused&&lw.mark==='retained'&&await page.evaluate(()=>!!(window.MCC_WORLD_AUDIO&&MCC_WORLD_AUDIO.active()))&&await frames(page)===1,{lw,path:await path(page)});
  await context.close();
});
await scenario('s8',async()=>{
  /* test 11: unexpected documents never render in the frame and are routed; one Back lands where the person was */
  const {context,page}=await setup();
  await playListen(page);
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  const v=await waitView(page,/probe-artist/);await v.waitForSelector('#creatorArtist .ap-hero__line',{timeout:10000});
  await v.evaluate(()=>location.replace('/index.html')).catch(()=>{});
  await page.waitForURL(/\/index\.html$/,{timeout:10000});await page.waitForLoadState('load');
  const framed=await page.evaluate(()=>window.__framedReady||[]).catch(()=>[]);
  check('11. location.replace("/index.html") inside a view becomes a page load of the top',new URL(page.url()).pathname==='/index.html');
  check('11. index.html never rendered inside the frame',!framed.some(p=>/index\.html/.test(p)),framed);
  await page.goBack();await page.waitForLoadState('load');await sleep(800);
  check('11. one Back lands on the artist page, where the person was',await path(page)==='/music-creator.html?handle=probe-artist',await path(page));
  await context.close();
  /* Listen's search Enter inside a Listen view over an artist page: routed by the table (the album is a page load from an engine page) */
  const s=await setup({start:'/music-creator.html?handle=probe-artist'});
  await s.page.waitForSelector('a.music-contextbar__brand');await s.page.locator('a.music-contextbar__brand').click();
  const lv=await waitView(s.page,/listen\.html/);
  await lv.waitForSelector('#q',{timeout:15000});
  await lv.locator('#q').fill('Runway');await lv.waitForSelector('#all a.row',{state:'visible',timeout:15000});await sleep(300);await lv.locator('#q').press('Enter');
  await s.page.waitForURL(/album\.html/,{timeout:10000});await s.page.waitForLoadState('load');
  const f2=await s.page.evaluate(()=>window.__framedReady||[]).catch(()=>[]);
  check('11. Listen\'s search Enter in a view is routed (an album from an engine page is a page load), never rendered in the frame',/album\.html/.test(s.page.url())&&!f2.some(p=>/album\.html/.test(p)),{url:s.page.url(),f2});
  await s.page.goBack();await s.page.waitForLoadState('load');await sleep(800);
  check('11. one Back lands on the Listen address the person was at',await path(s.page)==='/listen.html',await path(s.page));
  await s.context.close();
});
await scenario('s8-offline',async()=>{
  /* test 11: the real sw.js answers an offline view request with index.html: the failure card shows, the music plays on */
  const root=ROOT;
  const srv=createServer(async(req,res)=>{
    const u=new URL(req.url,'http://x'),p=u.pathname;
    if(p.startsWith('/assets/audio/')){res.writeHead(200,{'content-type':'audio/wav','accept-ranges':'bytes','content-length':AUDIO.length});return res.end(AUDIO);}
    const f=resolve(root,'.'+(p==='/'?'/index.html':decodeURIComponent(p)));
    if(!f.startsWith(root+sep)){res.writeHead(404);return res.end();}
    try{const body=await readFile(f);res.writeHead(200,{'content-type':MIME[extname(f)]||'application/octet-stream'});res.end(body);}
    catch{if(/\.(png|jpe?g|webp|gif)$/.test(p)){res.writeHead(200,{'content-type':'image/gif'});return res.end(GIF);}res.writeHead(404);res.end('absent');}
  });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+srv.address().port;
  const {context,page}=await setup({server:base,start:'/listen.html'});
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
  try{
    await page.waitForFunction(()=>navigator.serviceWorker&&navigator.serviceWorker.controller||false,null,{timeout:4000}).catch(()=>{});
    await page.reload({waitUntil:'load'});await page.evaluate(()=>{window.__docMark='retained';});
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:10000});
    await page.evaluate(()=>fetch('/index.html').then(r=>r.text()));
    await playListen(page);await markEngine(page);
    await page.evaluate(()=>{const a=document.createElement('a');a.href='music-creator.html?handle=offline-artist';a.id='offlineLink';a.textContent='offline';document.querySelector('main').appendChild(a);});
    await context.setOffline(true);
    await page.locator('#offlineLink').click();
    await page.waitForSelector('.mcc-music-fail',{timeout:15000});
    const framed=await page.evaluate(()=>window.__framedReady||[]);
    check('11. offline, the service worker\'s index.html fallback shows the failure card and never renders in the frame',!framed.some(p=>/offline-artist/.test(p)),framed);
    check('11. the music plays on behind the failure card',await page.evaluate(()=>window.__orig===MCC_MUSIC.audio&&!MCC_MUSIC.audio.paused&&window.__docMark==='retained'));
  }finally{await context.setOffline(false).catch(()=>{});await context.close();srv.close();}
});
await scenario('s9',async()=>{
  /* test 12: links that leave are page loads (a guard: so they were at dc0185aa); a new tab leaves the retained
     element playing (that half starts from a view, which did not exist then) */
  const {context,page}=await setup();
  await playListen(page);await markEngine(page);
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  await page.waitForURL(/music-creator\.html\?handle=probe-artist/,{timeout:10000});await settle(page,800);
  const v=await view(page);
  await (v||page).waitForSelector('#apDoors a[target="_blank"]',{timeout:10000});
  const [tab]=await Promise.all([context.waitForEvent('page',{timeout:8000}),(v||page).locator('#apDoors a[target="_blank"]').first().click()]);
  await sleep(1200);const e=await engine(page);
  check('12. a target="_blank" link in a view opens a new page and the retained element keeps advancing',!!tab&&e.same&&!e.paused&&e.mark==='retained'&&!!v,e);
  await tab.close().catch(()=>{});
  const where=v||page.mainFrame();
  await where.evaluate(()=>{const a=document.createElement('a');a.href='https://example.invalid/leaving';a.id='outLink';a.textContent='out';document.body.appendChild(a);});
  const req=page.waitForRequest(r=>/example\.invalid\/leaving/.test(r.url())&&r.frame()===page.mainFrame(),{timeout:8000}).catch(()=>null);
  await where.locator('#outLink').click();
  check('12. a same-tab external link is a page load of the top document, never of a frame',!!(await req));
  await context.close();
  const h=await setup();
  await playListen(h.page);
  await h.page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  await h.page.waitForURL(/music-creator\.html/,{timeout:10000});await settle(h.page,800);
  await h.page.locator('.appbar [data-appnav="home"]').click();
  await h.page.waitForURL(/\/index\.html/,{timeout:10000});
  check('12. the M tab is a page load of the top document (from a view too)',new URL(h.page.url()).pathname==='/index.html');
  await h.context.close();
  const k=await setup({start:'/music-creator.html?handle=probe-artist'});
  await k.page.waitForSelector('a.music-contextbar__brand');await k.page.locator('a.music-contextbar__brand').click();
  await k.page.waitForURL(/listen\.html/,{timeout:10000});await settle(k.page,800);
  const kv=await view(k.page)||k.page.mainFrame();
  await kv.waitForSelector('a.artist--house',{timeout:15000});
  await kv.locator('a.artist--house').click();
  /* one McCluster (Matthew, 2026-11-23, "Quick wins" Q1 in docs/music/MUSIC-RELEASE-20261119.md): his card on Listen
     is his artist page, never the house's root */
  await k.page.waitForURL(/music-creator\.html\?handle=mccluster$/,{timeout:10000}).catch(()=>{});
  check('12. McCluster\'s card on Listen opens his artist page (from a view too), never the house root',new URL(k.page.url()).pathname==='/music-creator.html'&&new URL(k.page.url()).searchParams.get('handle')==='mccluster',k.page.url());
  await k.context.close();
});
await scenario('s10',async()=>{
  /* test 13: a refresh is honest: nothing claims the song carried over (a guard: so it was at dc0185aa) */
  const {context,page}=await setup();
  await playListen(page);
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  await page.waitForURL(/music-creator\.html/,{timeout:10000});await settle(page,900);
  await page.reload({waitUntil:'load'});await sleep(1500);
  const r=await page.evaluate(()=>({path:location.pathname+location.search,frames:document.querySelectorAll('#mccMusicViewFrame').length,current:!!(window.MCC_MUSIC&&MCC_MUSIC.current()),text:document.body.innerText}));
  check('13. reloading an artist address makes the artist page the document, with nothing playing',r.path==='/music-creator.html?handle=probe-artist'&&r.frames===0&&!r.current&&(await playing(page)).n===0,r);
  check('13. no words claim the music carried on',!/Pick up at|still playing|keeps playing/i.test(r.text));
  await page.goto(HOUSE+'/listen.html',{waitUntil:'load'});
  await page.waitForFunction(()=>{const a=document.getElementById('musicMiniAlbum');return a&&/Pick up at \d+:\d\d/.test(a.textContent);},null,{timeout:10000}).catch(()=>{});
  check('13. Listen afterwards offers "Pick up at m:ss" (the banked record, paused)',await page.evaluate(()=>/Pick up at \d+:\d\d/.test((document.getElementById('musicMiniAlbum')||{}).textContent||'')));
  await context.close();
});
await scenario('s11',async()=>{
  /* test 14: twenty switches leave at most one frame, no Audio in any frame, the same element */
  const {context,page}=await setup();
  await playListen(page);await markEngine(page);
  let most=0,ok=true;
  for(let i=0;i<10;i++){
    const h=i%2?'second-artist':'probe-artist';
    await page.locator(`a.artist[href*="handle=${h}"]`).first().click();
    try{await waitView(page,new RegExp(h),6000);}catch{ok=false;break;}
    most=Math.max(most,await frames(page));
    await (await view(page)).locator('a.music-contextbar__brand').click();
    await page.waitForFunction(()=>document.querySelectorAll('#mccMusicViewFrame').length===0&&location.pathname==='/listen.html',null,{timeout:6000}).catch(()=>{ok=false;});
    most=Math.max(most,await frames(page));
  }
  const e=await engine(page);
  check('14. twenty switches between Listen and two artist views: at most one view frame at any time',ok&&most<=1,{ok,most});
  check('14. no Audio made in any frame, and the retained element the same, still playing',(await page.evaluate(()=>window.__framedAudio||0))===0&&e.same&&!e.paused,e);
  await context.close();
});
await scenario('s12',async()=>{
  /* test 15: phone first at 320, 390, 820 and 1280 px with a view showing */
  for(const width of [320,390,820,1280]){
    const {context,page}=await setup({width});
    await playListen(page);
    await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
    const v=await waitView(page,/probe-artist/);await v.waitForSelector('#creatorArtist .ap-hero__line',{timeout:10000});await sleep(500);
    const fit=await page.evaluate(()=>{const d=document.documentElement,f=document.getElementById('mccMusicViewFrame').contentDocument.documentElement;return {top:[d.scrollWidth,d.clientWidth],view:[f.scrollWidth,f.clientWidth]};});
    check(`15. ${width} px: no sideways scroll in the top or the view`,fit.top[0]===fit.top[1]&&fit.view[0]===fit.view[1],fit);
    await v.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await sleep(400);
    const foot=await page.evaluate(()=>{const f=document.getElementById('mccMusicViewFrame'),fr=f.getBoundingClientRect(),d=f.contentDocument;const last=[...d.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.height>0&&getComputedStyle(e).visibility!=='hidden';}).pop();const lb=last.getBoundingClientRect().bottom+fr.top;const tops=['.appbar','#musicMini'].map(s=>document.querySelector(s)).filter(e=>e&&!e.hidden&&e.getBoundingClientRect().height>0).map(e=>e.getBoundingClientRect().top);return {last:Math.round(lb),stack:Math.round(Math.min(...tops))};});
    check(`15. ${width} px: the view's last element sits above the bar and the mini player`,foot.last<=foot.stack+1,foot);
    await context.close();
  }
  for(const width of [320,390]){
    DELAY['/music-creator.html']=11000;
    const {context,page}=await setup({width});
    await playListen(page);
    await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
    await page.waitForSelector('.mcc-music-fail',{timeout:12000}).catch(()=>{});
    const card=await page.evaluate(()=>{const c=document.querySelector('.mcc-music-fail');if(!c)return null;return {text:c.innerText,buttons:[...c.querySelectorAll('a,button')].map(b=>{const r=b.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)];}),fit:document.documentElement.scrollWidth===document.documentElement.clientWidth};});
    check(`15. ${width} px: a view that does not open shows the card, its buttons at least 44 px, the music still playing`,!!card&&card.buttons.length===2&&card.buttons.every(([w,h])=>w>=44&&h>=44)&&card.fit&&/still playing/.test(card.text)&&!(await engine(page)).paused,card);
    delete DELAY['/music-creator.html'];
    await context.close();
  }
});
await scenario('s13',async()=>{
  /* test 16: Tab never reaches concealed content */
  const {context,page}=await setup({width:1280});
  await playListen(page);
  /* site-wide rules make open parts visible again under a hidden parent (css/style.css: .psycard.is-open and others) */
  await page.evaluate(()=>{const b=document.createElement('button');b.id='probeVisible';b.type='button';b.textContent='probe';b.style.visibility='visible';(document.querySelector('main')||document.body).appendChild(b);});
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  const v=await waitView(page,/probe-artist/);await v.waitForSelector('#creatorArtist .ap-hero__line',{timeout:10000});
  const probe=await page.evaluate(()=>{const b=document.getElementById('probeVisible');b.focus();return {focused:document.activeElement===b,inert:!!b.closest('[inert]')};});
  check('16. a part of the covered page that makes itself visible takes no focus (the covered page is inert)',!probe.focused&&probe.inert,probe);
  const leaked=[];
  await page.evaluate(()=>document.getElementById('mccMusicViewFrame').blur());
  for(let i=0;i<40;i++){
    await page.keyboard.press('Tab');
    const at=await page.evaluate(()=>{const a=document.activeElement;if(!a||a===document.body)return null;return a.closest('main')||a.closest('[inert]')?'concealed:'+a.tagName+'.'+a.className:null;});
    if(at)leaked.push(at);
  }
  check('16. Tab never reaches the retained page\'s concealed content',leaked.length===0,leaked.slice(0,4));
  await context.close();
});
await scenario('s14',async()=>{
  /* test 17: an account change in another tab while an artist view shows */
  const {context,page,log}=await setup();
  await playListen(page);await markEngine(page);
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  const v=await waitView(page,/probe-artist/);
  await v.waitForSelector('[data-creator-offer] [data-offer="signin"]:not([hidden])',{timeout:12000});
  const other=await context.newPage();await other.goto(HOUSE+'/privacy.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  const gatesBefore=log.requests.filter(q=>/functions\/v1\/music-access|\/v1\/music\/gates\//.test(q.url)).length;
  await other.evaluate(s=>{localStorage.setItem('mccdb_session',JSON.stringify(s));localStorage.setItem('mcc_sess_keep',JSON.stringify(s));},session());
  await page.waitForFunction(()=>(document.querySelector('#mccAuthChip .mcc-auth-chip__text')||{}).textContent==='Profile',null,{timeout:12000}).catch(()=>{});
  await v.waitForFunction(()=>{const o=document.querySelector('[data-creator-offer]');return !!o&&![...o.querySelectorAll('[data-offer]')].some(e=>!e.hidden&&e.getAttribute('data-offer')==='signin');},null,{timeout:12000}).catch(()=>{});
  const offer=await v.evaluate(()=>{const o=document.querySelector('[data-creator-offer]');return o?[...o.querySelectorAll('[data-offer]')].filter(e=>!e.hidden).map(e=>e.getAttribute('data-offer')):null;});
  check('17. a sign-in in another tab: the bar\'s chip says Profile',await page.evaluate(()=>(document.querySelector('#mccAuthChip .mcc-auth-chip__text')||{}).textContent)==='Profile');
  check('17. the artist view repaints its offer for the member',Array.isArray(offer)&&!offer.includes('signin'),offer);
  const e=await engine(page);
  check('17. the catalogue song keeps playing on the same element',e.same&&!e.paused,e);
  check('17. no access re-check from the view: the engine\'s checks stay in the retained document',log.requests.filter(q=>/functions\/v1\/music-access|\/v1\/music\/gates\//.test(q.url)&&q.frame==='frame').length===0,log.requests.filter(q=>q.frame==='frame'&&/music/.test(q.url)).map(q=>q.url).slice(0,4));
  await other.evaluate(()=>{localStorage.removeItem('mcc_sess_keep');localStorage.removeItem('mccdb_session');});
  await page.waitForFunction(()=>(document.querySelector('#mccAuthChip .mcc-auth-chip__text')||{}).textContent==='Sign in',null,{timeout:12000}).catch(()=>{});
  check('17. a sign-out in another tab: the chip says Sign in again, the song still plays',await page.evaluate(()=>(document.querySelector('#mccAuthChip .mcc-auth-chip__text')||{}).textContent)==='Sign in'&&!(await engine(page)).paused);
  void gatesBefore;
  await context.close();
});

/* ---------- ENGINE STAGE 0 (docs/control-plane/handoff-20261123/specs/SPEC-ENGINE.md, section 10) ---------- */
/* A0.3: a tap on a card's play button inside its link plays that song; the address, the view and the history stay.
   Every journey the shell has with the album contained: Listen at the top, an artist page as a view over Listen, an
   artist page at the top, Listen as a view over an artist page. Each check of a play starts from the same place and
   says where the tap must not go. */
async function cardPlays(page,label,tapIt,test){
  const before=await where(page);
  await tapIt();
  const played=await nowPlays(page,test);
  await sleep(400);
  const after=await where(page);
  check(`A0.3 ${label}: the song plays on the retained engine`,played,await engine(page));
  check(`A0.3 ${label}: the address, the view shown and the history stay (no page load, no view opened or closed)`,
    !after.error&&after.path===before.path&&after.len===before.len&&after.mark===before.mark&&after.unloads===before.unloads&&after.frames===before.frames&&after.frame===before.frame,{before,after});
}
await scenario('a03-listen',async()=>{
  /* Listen at the top: a creator's card (its link: the artist page, a view) and a song card (its link: the album) */
  const {context,page,log}=await setup();
  const creator=page.locator(`#creatorRail [data-music-play][data-creator-track="${T_PUBLIC}"]`);
  await creator.waitFor({state:'visible',timeout:15000});
  await cardPlays(page,'Listen at the top, a creator card',()=>creator.click(),T_PUBLIC);
  const song=await songCard(page,'here','Runway Walk');
  await cardPlays(page,'Listen at the top, a song card in its album\'s link',()=>song.click(),'Runway Walk');
  check('A0.3 Listen at the top: no page error',log.errors.length===0,log.errors);
  await context.close();
});
await scenario('a03-artist-view',async()=>{
  /* an artist page as a view over Listen: a song card in its album's link, on the artist page */
  const {context,page,log}=await setup();
  await page.waitForSelector('a.artist[href*="handle=probe-artist"]',{timeout:15000});
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  const v=await waitView(page,/probe-artist/);await v.waitForSelector('#creatorArtist .ap-hero__line',{timeout:10000});
  await page.evaluate(()=>{document.getElementById('mccMusicViewFrame').__mark='artist-view';});
  const song=await songCard(v,'here','Runway Walk');
  await cardPlays(page,'an artist page as a view over Listen, a song card in its album\'s link',()=>song.click(),'Runway Walk');
  check('A0.3 an artist view over Listen: the view made no Audio of its own',await v.evaluate(()=>(window.__audioObjects||[]).length===0).catch(()=>false));
  check('A0.3 an artist view over Listen: no page error',log.errors.length===0,log.errors);
  await context.close();
});
await scenario('a03-artist',async()=>{
  /* an artist page at the top: a song card in its album's link */
  const {context,page,log}=await setup({start:'/music-creator.html?handle=probe-artist'});
  await page.waitForSelector('#creatorArtist .ap-hero__line',{timeout:15000});
  const song=await songCard(page,'here','Runway Walk');
  await cardPlays(page,'an artist page at the top, a song card in its album\'s link',()=>song.click(),'Runway Walk');
  check('A0.3 an artist page at the top: no page error',log.errors.length===0,log.errors);
  await context.close();
});
await scenario('a03-listen-view',async()=>{
  /* Listen as a view over an artist page: the retained artist's own card (its link reveals the artist page), another
     artist's card (its link opens that page as a view) and a song card (its link loads the album) */
  const {context,page,log}=await setup({start:'/music-creator.html?handle=probe-artist'});
  await page.waitForSelector('a.music-contextbar__brand');await page.locator('a.music-contextbar__brand').click();
  const v=await waitView(page,/listen\.html/);
  await page.evaluate(()=>{document.getElementById('mccMusicViewFrame').__mark='listen-view';});
  const other=v.locator(`#creatorRail [data-music-play][data-creator-track="${T_SECOND}"]`);
  await other.waitFor({state:'visible',timeout:15000});
  await cardPlays(page,'Listen as a view over an artist page, another artist\'s card',()=>other.click(),T_SECOND);
  const own=v.locator(`#creatorRail [data-music-play][data-creator-track="${T_PUBLIC}"]`);
  await cardPlays(page,'Listen as a view over an artist page, the retained artist\'s own card',()=>own.click(),T_PUBLIC);
  const song=await songCard(v,'here','Runway Walk');
  await cardPlays(page,'Listen as a view over an artist page, a song card in its album\'s link',()=>song.click(),'Runway Walk');
  check('A0.3 Listen over an artist page: one playing element across the documents',(await playing(page)).n===1,await playing(page));
  check('A0.3 Listen over an artist page: no page error',log.errors.length===0,log.errors);
  await context.close();
});

/* THE ALBUM, CONTAINED (SPEC-ENGINE 4.10): Release 2 ships M5 with ROUTES.album = { top: false, view: false }. The album
   is a page of its own, as at Release 1 with the quick wins: its own deck, one player on the page, a link to it is a page
   load and every link on it is the page's own. No view ever opens over the deck and two players never share the bar. */
await scenario('contained',async()=>{
  const {context,page,log}=await setup();
  await playListen(page);
  await page.fill('#q','');   /* the search found the song; with the field empty Listen shows its albums again */
  await page.waitForSelector('#shelf a[href="album.html?album=here"]',{state:'visible',timeout:15000});
  const listenState=await page.evaluate(()=>history.state);
  await page.locator('#shelf a[href="album.html?album=here"]').first().click();
  await page.waitForURL(/\/album\.html\?album=here$/,{timeout:10000});await page.waitForLoadState('load');await sleep(600);
  const arrived=await page.evaluate(()=>({mark:window.__docMark||null,state:history.state,shell:!!window.MCC_MUSIC_SHELL,active:!!(window.MCC_MUSIC_SHELL&&MCC_MUSIC_SHELL.active())}));
  check('contained: from Listen a tap on an album is a page load (the album is not a view), and Listen\'s entry names no view',arrived.mark!=='retained'&&!(listenState&&listenState.mccMusicView),{arrived,listenState});
  check('contained: on the album the shell is loaded but retains nothing',arrived.shell&&!arrived.active,arrived);
  await playAlbumRow(page,1);await markDeck(page);
  await page.evaluate(()=>{window.__docMark='album';});
  const one=await page.evaluate(()=>({engine:!!window.MCC_MUSIC,engineScript:!!document.querySelector('script[src*="js/music-engine.js"]'),mini:!!document.getElementById('musicMini'),owner:document.documentElement.getAttribute('data-music-owner'),state:history.state,deck:!document.getElementById('deck').paused}));
  check('contained: the album page holds one player, its own deck (no engine beside it, no mini player, no owner flag)',one.deck&&!one.engine&&!one.engineScript&&!one.mini&&one.owner===null,one);
  check('contained: exactly one playing element on the album',(await playing(page)).n===1,await playing(page));
  check('contained: the album writes no history entry of the shell\'s',!(one.state&&(one.state.mccMusicView||one.state.mccMusicShell)),one.state);
  /* the bar's Music tab on the album: a page load of Listen, as at Release 1 (no view over the deck) */
  await page.locator('.appbar [data-appnav="music"]').click();
  await page.waitForURL(/\/listen\.html$/,{timeout:10000}).catch(()=>{});await page.waitForLoadState('load');await sleep(800);
  const tab=await page.evaluate(()=>({mark:window.__docMark||null,path:location.pathname+location.search,frames:document.querySelectorAll('#mccMusicViewFrame').length,state:history.state}));
  check('contained: the album\'s Music tab is a page load of Listen, never a view over the album',tab.mark!=='album'&&tab.path==='/listen.html'&&tab.frames===0,tab);
  await page.goBack();await page.waitForLoadState('load');await sleep(800);
  const back=await page.evaluate(()=>({path:location.pathname+location.search,state:history.state,frames:document.querySelectorAll('#mccMusicViewFrame').length}));
  check('contained: Back is the album again, by the browser, its entry naming no view and no retained page',back.path==='/album.html?album=here'&&back.frames===0&&!(back.state&&(back.state.mccMusicView||back.state.mccMusicShell)),back);
  /* the chip on the album: a page load of the account page, as at Release 1 */
  await page.evaluate(()=>{window.__docMark='album-again';});
  await page.waitForSelector('#mccAuthChip',{timeout:10000});await page.locator('#mccAuthChip').click();
  await page.waitForURL(/\/account\.html/,{timeout:10000}).catch(()=>{});await page.waitForLoadState('load');await sleep(600);
  const chip=await page.evaluate(()=>({mark:window.__docMark||null,path:location.pathname,frames:document.querySelectorAll('#mccMusicViewFrame').length}));
  check('contained: the album\'s Sign in chip is a page load of the account page, never a sign-in view over the album',chip.mark!=='album-again'&&chip.path==='/account.html'&&chip.frames===0,chip);
  /* McCluster's album from his artist page shown as a view over Listen: a page load of the top, no album view entry */
  await page.goto(HOUSE+'/listen.html',{waitUntil:'load'});await page.evaluate(()=>{window.__docMark='listen';});
  await page.waitForSelector('a.artist--house',{timeout:15000});await page.locator('a.artist--house').click();
  const hv=await waitView(page,/handle=mccluster/);
  await hv.waitForSelector('#apHouseShelf a.ap-card[href="album.html?album=here"]',{timeout:15000});
  await hv.locator('#apHouseShelf a.ap-card[href="album.html?album=here"]').click();
  await page.waitForURL(/\/album\.html\?album=here$/,{timeout:10000}).catch(()=>{});await page.waitForLoadState('load');await sleep(600);
  const fromView=await page.evaluate(()=>({mark:window.__docMark||null,path:location.pathname+location.search,state:history.state,frames:document.querySelectorAll('#mccMusicViewFrame').length}));
  check('contained: an album link in an artist view is a page load of the top (no album view, no album view entry)',fromView.mark!=='listen'&&fromView.path==='/album.html?album=here'&&fromView.frames===0&&!(fromView.state&&fromView.state.mccMusicView),fromView);
  check('contained: no page error',log.errors.length===0,log.errors);
  await context.close();
});

/* ---------- STAGE 2, CONTAINED IN RELEASE 2 (SPEC-ENGINE 4.10) ---------- */
/* M5's stage 2 retained the album with its own deck, and Listen and the artist pages opened over it as views. Release 2
   ships M5 with ROUTES.album = { top: false, view: false }, so each scenario below changed on purpose to what the album
   does now: it is a page of its own, as at Release 1 with the quick wins, every link on it a page load. What stage 2
   proved that still holds without the album (the bar's own gestures over a view, the heading's focus where the house
   focus-visible rule applies, the view's place under the bar) is now proved over an artist page. Stage 1 of the engine
   turns the album back on as a page of the one engine. */
await scenario('s15',async()=>{
  /* test 18, contained (was: the album's deck plays on under a Listen view; its bar stays on top) */
  const {context,page}=await setup({start:'/album.html?album=here'});
  await playAlbumRow(page,1);await markDeck(page);
  check('18. the album is not the retained document',await page.evaluate(()=>!!window.MCC_MUSIC_SHELL&&!MCC_MUSIC_SHELL.active()));
  await page.evaluate(()=>{window.__docMark='album';});
  await page.locator('.appbar [data-appnav="music"]').click();
  await page.waitForURL(/\/listen\.html$/,{timeout:10000}).catch(()=>{});await page.waitForLoadState('load');await sleep(800);
  const l=await page.evaluate(()=>({mark:window.__docMark||null,frames:document.querySelectorAll('#mccMusicViewFrame').length,path:location.pathname+location.search}));
  check('18. album -> the bar\'s Music tab: a page load of Listen, as at Release 1 (no view over the deck)',l.mark!=='album'&&l.frames===0&&l.path==='/listen.html',l);
  check('18. nothing plays on Listen after the page load: the album\'s song ended with its page',(await playing(page)).n===0,await playing(page));
  await page.goBack();await page.waitForLoadState('load');await sleep(800);
  const b=await page.evaluate(()=>({path:location.pathname+location.search,frames:document.querySelectorAll('#mccMusicViewFrame').length,state:history.state}));
  check('18. Back is the album, by the browser: its entry names no view and no retained page',b.path==='/album.html?album=here'&&b.frames===0&&!(b.state&&(b.state.mccMusicView||b.state.mccMusicShell)),b);
  await context.close();
  /* test 16 (moved from over the album): the bar's Music tab on an artist page opens Listen over it; the heading focus here
     matches the house :focus-visible rule (js/masthead.js), which draws an outline and a glow */
  const k=await setup({start:'/music-creator.html?handle=probe-artist'});
  await k.page.waitForSelector(`#creatorPublicTracks [data-creator-track="${T_PUBLIC}"]`,{timeout:15000});
  await k.page.locator(`#creatorPublicTracks [data-creator-track="${T_PUBLIC}"]`).click();
  await k.page.waitForFunction(()=>!MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.currentTime>.3,null,{timeout:15000});
  await markEngine(k.page);
  await k.page.locator('.appbar [data-appnav="music"]').click();
  await waitView(k.page,/listen\.html/);await sleep(400);
  const ring=await k.page.evaluate(()=>{const f=document.getElementById('mccMusicViewFrame');const a=f&&f.contentDocument&&f.contentDocument.activeElement;if(!a)return null;const cs=f.contentWindow.getComputedStyle(a);return {tag:a.tagName,fv:a.matches(':focus-visible'),outline:cs.outlineStyle,glow:cs.boxShadow};});
  check('16. over an artist page the Listen heading takes the focus without a ring or glow, also where the house focus-visible rule applies',!!ring&&ring.tag==='H1'&&ring.fv&&ring.outline==='none'&&ring.glow==='none',ring);
  /* the bar's Music tab again, in the Listen view: the way to Listen (the view goes to its top), never the player's Pause */
  await k.page.locator('.appbar [data-appnav="music"]').click();await sleep(800);
  const again=await engine(k.page);
  check('9. the bar\'s Music tab in a Listen view over an artist page never pauses the song, and the view stays',again.same&&!again.paused&&await frames(k.page)===1&&await path(k.page)==='/listen.html',{again,path:await path(k.page)});
  await k.context.close();
});
await scenario('s15b',async()=>{
  /* test 9, contained (was: the bar keeps its own gestures over the album; the next tap opens Listen over it, and Step
     inside a held wing slot over a view reveals the album): the bar's gestures are its own on the album too, and the next
     tap is a page load; over a view (an artist page over Listen) the bar's gestures hold, and Step inside the album slot
     is a page load of the top */
  const {context,page}=await setup({start:'/album.html?album=here'});
  await playAlbumRow(page,1);await markDeck(page);
  const box=await page.locator('.appbar [data-appnav="music"]').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await sleep(700);await page.mouse.up();await sleep(700);
  const held=await page.evaluate(()=>({frames:document.querySelectorAll('#mccMusicView .mcc-music-frame').length,path:location.pathname+location.search,wing:!!document.querySelector('.appbar.appbar--morph, .appbar--morph'),slots:document.querySelectorAll('.appbar a[data-dock]').length}));
  check('9. a held Music tab on the album opens the music wing and no view',held.frames===0&&held.path==='/album.html?album=here'&&held.slots>0,held);
  await page.evaluate(()=>{window.__docMark='album';});
  await page.locator('.appbar [data-appnav="music"]').click();
  await page.waitForURL(/\/listen\.html$/,{timeout:10000}).catch(()=>{});await page.waitForLoadState('load');await sleep(600);
  check('9. the next tap on the Music tab is a page load of Listen (the album is not retained)',await page.evaluate(()=>window.__docMark!=='album'&&!document.querySelector('#mccMusicViewFrame'))&&await path(page)==='/listen.html',await path(page));
  await context.close();
  /* over a view the bar's own gestures still hold: a held wing slot shows its card (the hold's click is the bar's, never a
     navigation), and Step inside the album's slot is a page load of the top */
  const o=await setup();
  await playListen(o.page);await markEngine(o.page);
  await o.page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  await waitView(o.page,/probe-artist/);
  const hold=async loc=>{const b=await o.page.locator(loc).first().boundingBox();await o.page.mouse.move(b.x+b.width/2,b.y+b.height/2);await o.page.mouse.down();await sleep(700);await o.page.mouse.up();await sleep(700);};
  await hold('.appbar [data-appnav="music"]');
  await hold('.appbar a[data-dock$="/album.html"]');
  const card=await o.page.evaluate(()=>({peek:!!document.querySelector('.dk-peek'),frames:document.querySelectorAll('#mccMusicView .mcc-music-frame').length,path:location.pathname+location.search}));
  check('9. over a view, a held wing slot shows its card and goes nowhere (the hold stays the bar\'s)',card.peek&&card.frames===1&&card.path==='/music-creator.html?handle=probe-artist',card);
  const e=await engine(o.page);
  check('9. and the song plays on under it',e.same&&!e.paused,e);
  await o.page.locator('.dk-peek__go').click();
  await o.page.waitForURL(/\/album\.html/,{timeout:10000}).catch(()=>{});await o.page.waitForLoadState('load');await sleep(600);
  check('9. and Step inside the album\'s slot is a page load of the top, never a view of the album',await o.page.evaluate(()=>window.__docMark!=='retained'&&!document.querySelector('#mccMusicViewFrame'))&&/^\/album\.html/.test(await path(o.page)),await path(o.page));
  await o.context.close();
});
await scenario('s16',async()=>{
  /* test 19, contained (was: one owner of sound in the album document, the engine loaded beside the deck when a view
     opened over it): the album never holds a second player. Its deck is the one player on the page, its bar the one
     transport, the pocket holds its song; the engine is never loaded there, so there is no owner to choose */
  const {context,page}=await setup({start:'/album.html?album=here'});
  await playAlbumRow(page,1);await markDeck(page);
  const s1=await page.evaluate(()=>({engine:!!window.MCC_MUSIC,guest:!!window.MCC_MUSIC_GUEST,engineScript:!!document.querySelector('script[src*="js/music-engine.js"]'),owner:document.documentElement.getAttribute('data-music-owner'),
    deckbar:getComputedStyle(document.getElementById('deckbar')).display!=='none'&&getComputedStyle(document.getElementById('deckbar')).visibility!=='hidden',
    mini:!!document.getElementById('musicMini'),pocket:(JSON.parse(localStorage.getItem('mcc-pocket')||'{}')||{}).title,row:document.querySelectorAll('#tracks li')[1].getAttribute('data-title')}));
  check('19. the album page holds one player, its deck: no engine beside it, no mini player, no owner flag',!s1.engine&&!s1.guest&&!s1.engineScript&&s1.owner===null&&!s1.mini,s1);
  check('19. exactly one element plays',(await playing(page)).n===1,await playing(page));
  check('19. the deck bar shows',s1.deckbar,s1);
  check('19. the pocket holds the deck\'s song',s1.pocket===s1.row,s1);
  await page.locator('#tracks li').nth(2).click();
  await page.waitForFunction(()=>!document.getElementById('deck').paused&&document.getElementById('npTitle').textContent===document.querySelectorAll('#tracks li')[2].getAttribute('data-title'),null,{timeout:12000});await sleep(500);
  const s2=await page.evaluate(()=>({engine:!!window.MCC_MUSIC,owner:document.documentElement.getAttribute('data-music-owner'),pocket:(JSON.parse(localStorage.getItem('mcc-pocket')||'{}')||{}).title,row:document.querySelectorAll('#tracks li')[2].getAttribute('data-title'),same:window.__orig===document.getElementById('deck')}));
  check('19. another row: the same deck plays it, still the one player',s2.same&&!s2.engine&&s2.owner===null&&(await playing(page)).n===1,s2);
  check('19. the pocket holds the deck\'s new song',s2.pocket===s2.row,s2);
  await context.close();
});
await scenario('s17',async()=>{
  /* test 20, contained (was: the album's own controls act on the deck while a view shows): no view ever shows over the
     album, so its own controls act on its deck on the album page itself, as at Release 1 */
  const {context,page}=await setup({start:'/album.html?album=here'});
  await playAlbumRow(page,1);await markDeck(page);
  await page.locator('#tpPlay').click();await page.waitForFunction(()=>document.getElementById('deck').paused,null,{timeout:5000}).catch(()=>{});
  check('20. the deck bar\'s Pause pauses the deck',await page.evaluate(()=>document.getElementById('deck').paused));
  await page.locator('#tpPlay').click();await page.waitForFunction(()=>!document.getElementById('deck').paused,null,{timeout:5000}).catch(()=>{});
  const row0=await page.evaluate(()=>document.getElementById('npTitle').textContent);
  await page.locator('#deckbar .deckbar__meta').click();await sleep(600);
  await page.locator('#nowNext').click();await sleep(900);
  check('20. the sheet\'s Next moves the deck on',await page.evaluate(()=>document.getElementById('npTitle').textContent)!==row0&&(await deck(page)).same,{row0});
  await page.locator('#nowDown').click().catch(()=>{});await sleep(400);
  /* the World over the album: its compact transport acts on the deck, the album's one player */
  await page.locator('.appbar [data-appnav="world"]').click();
  await page.waitForFunction(()=>window.MCC_WORLD_AUDIO&&MCC_WORLD_AUDIO.active(),null,{timeout:10000});
  await page.waitForSelector('#mccWorldAudioControls .world-audio__play',{state:'visible',timeout:10000});
  await page.locator('#mccWorldAudioControls .world-audio__play').click();await sleep(600);
  check('20. the World\'s compact transport pauses the deck, the album\'s one player (no engine beside it)',await page.evaluate(()=>document.getElementById('deck').paused&&!window.MCC_MUSIC&&!document.documentElement.hasAttribute('data-music-owner')));
  check('20. never a view over the album',await frames(page)===0);
  await context.close();
  /* the deck's words during a dropped read show on the deck bar (music slice M3, unchanged) */
  HOLD.cut=170000;
  const c=await setup({start:'/album.html?album=here'});
  try{
    await playAlbumRow(c.page,1);
    await c.page.waitForFunction(()=>/Reconnecting|Connection lost/.test(document.getElementById('deckbar').innerText),null,{timeout:30000}).catch(()=>{});
    const words=await c.page.evaluate(()=>({bar:document.getElementById('deckbar').innerText,delivery:window.MCC_DECK_DELIVERY&&MCC_DECK_DELIVERY()}));
    check('20. during a dropped read the deck bar says Reconnecting\u2026 or Connection lost (M3 unchanged)',/Reconnecting|Connection lost/.test(words.bar)&&!!words.delivery&&!!words.delivery.state,words);
  }finally{HOLD.cut=0;await c.context.close();}
  /* the installed app's dock acts on the deck, and its Music tab is a page load of Listen (no view over the album) */
  const i=await setup({start:'/album.html?album=here',standalone:true});
  await playAlbumRow(i.page,1);
  await i.page.waitForSelector('[data-app-player="play"]',{timeout:10000}).catch(()=>{});
  await i.page.locator('[data-app-player="play"]').click();await sleep(600);
  check('20. the installed dock pauses the deck',await i.page.evaluate(()=>document.getElementById('deck').paused));
  await i.page.evaluate(()=>{window.__docMark='album';});
  await i.page.locator('#mccInstalledDockTabs [data-appnav="music"], .appbar [data-appnav="music"]').first().click();
  await i.page.waitForURL(/\/listen\.html$/,{timeout:10000}).catch(()=>{});await i.page.waitForLoadState('load');await sleep(400);
  check('20. the installed app\'s Music tab on the album is a page load of Listen, never a view over the album',await i.page.evaluate(()=>window.__docMark!=='album'&&!document.querySelector('#mccMusicViewFrame'))&&await path(i.page)==='/listen.html',await path(i.page));
  await i.context.close();
});
await scenario('s18',async()=>{
  /* test 21, contained (was: a link to the album the retained album shows, with another t=, reveals it with that row in
     view): the album is never retained, so its context bar's Music link is a page load of Listen, and a Listen row of the
     album is a page load of the album that seats the row it names, paused, as at Release 1 */
  const {context,page}=await setup({start:'/album.html?album=here'});
  await playAlbumRow(page,1);await markDeck(page);
  await page.evaluate(()=>{window.__docMark='album';});
  await page.locator('a.music-contextbar__brand').click();
  await page.waitForURL(/\/listen\.html$/,{timeout:10000}).catch(()=>{});await page.waitForLoadState('load');
  check('21. the album\'s Music link is a page load of Listen (no view over the album)',await page.evaluate(()=>window.__docMark!=='album'&&!document.querySelector('#mccMusicViewFrame'))&&await path(page)==='/listen.html',await path(page));
  await page.waitForSelector('#q',{timeout:15000});await page.fill('#q','Lightroom');
  await page.waitForSelector('#all a.row[href*="album=here"][href*="t=Lightroom"]',{state:'visible',timeout:15000});
  await page.evaluate(()=>{window.__docMark='listen';});
  await page.locator('#all a.row[href*="album=here"][href*="t=Lightroom"]').first().click();
  await page.waitForURL(/album=here&t=Lightroom/,{timeout:10000}).catch(()=>{});await page.waitForLoadState('load');await sleep(1200);
  const r=await page.evaluate(()=>({mark:window.__docMark||null,path:location.pathname+location.search,frames:document.querySelectorAll('#mccMusicViewFrame').length,seated:document.getElementById('npTitle').textContent,paused:document.getElementById('deck').paused}));
  check('21. a Listen row of the album is a page load of the album, which seats the row it names, paused (nothing starts by itself)',r.mark!=='listen'&&r.frames===0&&/album\.html\?album=here&t=Lightroom/.test(r.path)&&r.seated==='Lightroom'&&r.paused,r);
  await page.goto(HOUSE+'/listen.html',{waitUntil:'load'});
  await page.waitForSelector('#q',{timeout:15000});await page.fill('#q','OSINT');
  await page.waitForSelector('#all a.row[href*="album=prim3"]',{state:'visible',timeout:15000});
  await page.evaluate(()=>{window.__docMark='listen';});
  await page.locator('#all a.row[href*="album=prim3"]').first().click();
  await page.waitForURL(/album=prim3/,{timeout:10000});await page.waitForLoadState('load');
  check('21. a row of another album is a page load too',await page.evaluate(()=>window.__docMark!=='listen'));
  await context.close();
});

await scenario('s24',async()=>{
  /* test 15 at 320 and 390 px, contained (was: Listen over the album and the account view over the album): the album is
     a page of its own and fits as one; the account view over Listen; Listen over an artist page; Listen and an artist page
     at the top (the artist view over Listen at every width is s12); no sideways scroll in the top or the view */
  const fit=page=>page.evaluate(()=>{const d=document.documentElement,f=document.getElementById('mccMusicViewFrame');const v=f&&f.contentDocument&&f.contentDocument.documentElement;return {top:[d.scrollWidth,d.clientWidth],view:v?[v.scrollWidth,v.clientWidth]:null};});
  const ok=x=>!!x.view&&x.top[0]===x.top[1]&&x.view[0]===x.view[1];
  const flat=x=>x.top[0]===x.top[1]&&!x.view;
  for(const width of [320,390]){
    const {context,page}=await setup({width,start:'/album.html?album=here'});
    await playAlbumRow(page,1);await sleep(400);
    const a=await fit(page);check(`15. ${width} px: the album fits, a page of its own with no view`,flat(a),a);
    await context.close();
    const l=await setup({width});
    await playListen(l.page);await l.page.fill('#q','');await l.page.waitForSelector('#shelf a',{state:'visible',timeout:15000});await sleep(400);
    const lt=await fit(l.page);check(`15. ${width} px: Listen at the top fits`,flat(lt),lt);
    await l.page.locator('#mccAuthChip').click();
    const av=await waitView(l.page,/account\.html/);await av.waitForSelector('#acInEmail',{timeout:10000});await sleep(300);
    const b=await fit(l.page);check(`15. ${width} px: the account view over Listen fits, top and view`,ok(b),b);
    await l.context.close();
    const k=await setup({width,start:'/music-creator.html?handle=probe-artist'});
    await k.page.waitForSelector('#creatorArtist .ap-hero__line',{timeout:15000});await sleep(300);
    const kt=await fit(k.page);check(`15. ${width} px: an artist page at the top fits`,flat(kt),kt);
    await k.page.waitForSelector('a.music-contextbar__brand');await k.page.locator('a.music-contextbar__brand').click();
    const kv=await waitView(k.page,/listen\.html/);await kv.waitForSelector('#shelf a',{timeout:15000});await sleep(400);
    const c=await fit(k.page);check(`15. ${width} px: Listen over an artist page fits, top and view`,ok(c),c);
    await k.context.close();
  }
});

/* ---------- STAGE 3: signing in without leaving the music (over Listen and the artist pages) ---------- */
/* M5 proved stage 3 over the retained album. With the album contained in Release 2 the sign-in view opens over Listen
   and the artist pages, so each scenario below changed on purpose to Listen at the top; on the album the comment box's
   and the chip's Sign in are page loads of the account page, as at Release 1. */
await scenario('s19',async()=>{
  /* test 22, contained (was: album playing -> the comment box's Sign in -> password -> back on the album, the same element
     playing): the comment box's Sign in is a page load of the account page, which goes on to the album after the password
     sign-in; the album's gated row is painted for the member */
  const {context,page}=await setup({start:'/album.html?album=here'});
  await playAlbumRow(page,1);await markDeck(page);
  await page.waitForSelector('[data-comments] a[href^="account.html?next="]',{timeout:15000});
  await page.evaluate(()=>{window.__docMark='album';});
  await page.locator('[data-comments] a[href^="account.html?next="]').first().click();
  await page.waitForURL(/\/account\.html\?next=/,{timeout:10000}).catch(()=>{});await page.waitForLoadState('load');
  check('22. the comment box\'s Sign in is a page load of the account page (no sign-in view over the album)',await page.evaluate(()=>window.__docMark!=='album'&&!document.querySelector('#mccMusicViewFrame'))&&/^\/account\.html\?next=%2Falbum\.html/.test(await path(page)),await path(page));
  await page.waitForSelector('#acInEmail',{timeout:10000});
  await page.fill('#acInEmail','shell-fixture@invalid.test');await page.fill('#acInPass','fixture-password');await page.locator('#acGo').click();
  await page.waitForURL(/\/album\.html\?album=here/,{timeout:15000}).catch(()=>{});await page.waitForLoadState('load');await sleep(1500);
  check('22. after the password sign-in the account page goes on to the album it came from',await path(page)==='/album.html?album=here',await path(page));
  check('22. the chip says Profile',await page.evaluate(()=>(document.querySelector('#mccAuthChip .mcc-auth-chip__text')||{}).textContent)==='Profile');
  await page.waitForFunction(()=>{const r=[...document.querySelectorAll('#tracks li')].find(li=>li.hasAttribute('data-gated-bucket'));return !r||r.getAttribute('data-gate')==='earned';},null,{timeout:8000}).catch(()=>{});
  check('22. the album\'s gated row is painted for the member',await page.evaluate(()=>{const r=[...document.querySelectorAll('#tracks li')].find(li=>li.hasAttribute('data-gated-bucket'));return !r||r.getAttribute('data-gate')==='earned';}));
  await context.close();
});
await scenario('s20',async()=>{
  /* test 23, over Listen (was over the album): Listen playing -> the chip (no next) -> password -> Listen again, the same
     element playing */
  const {context,page}=await setup();
  await playListen(page);await markEngine(page);
  await page.waitForSelector('#mccAuthChip');await page.locator('#mccAuthChip').click();
  const v=await waitView(page,/account\.html/);
  check('23. the chip opens the account view, carrying Listen as next',/^\/account\.html\?next=%2Flisten\.html$/.test(await path(page)),await path(page));
  check('22. no pocket mounts in the account view',await v.evaluate(()=>!document.querySelector('.pocket')));
  const e0=await engine(page);await sleep(1000);const e1=await engine(page);
  check('22. the song advances while the account view shows',e1.same&&e1.t>e0.t+.5&&!e1.paused,{e0,e1});
  await v.fill('#acInEmail','shell-fixture@invalid.test');await v.fill('#acInPass','fixture-password');await v.locator('#acGo').click();
  await page.waitForFunction(()=>location.pathname==='/listen.html'&&!document.querySelector('#mccMusicViewFrame'),null,{timeout:15000});await sleep(1200);
  const e=await engine(page);
  check('23. after sign-in Listen is back with the same element playing (not the World)',e.mark==='retained'&&e.same&&!e.paused&&e.t>e1.t,{e,path:await path(page)});
  check('22. the chip says Profile',await page.evaluate(()=>(document.querySelector('#mccAuthChip .mcc-auth-chip__text')||{}).textContent)==='Profile');
  await context.close();
  /* the same from an artist page: the chip carries the artist page as next and the sign-in comes back to it */
  const a=await setup({start:'/music-creator.html?handle=probe-artist'});
  await a.page.waitForSelector(`#creatorPublicTracks [data-creator-track="${T_PUBLIC}"]`,{timeout:15000});
  await a.page.locator(`#creatorPublicTracks [data-creator-track="${T_PUBLIC}"]`).click();
  await a.page.waitForFunction(()=>!MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.currentTime>.3,null,{timeout:15000});
  await markEngine(a.page);
  await a.page.locator('#mccAuthChip').click();
  const av=await waitView(a.page,/account\.html/);
  check('23. on an artist page the chip carries that page as next',/^\/account\.html\?next=%2Fmusic-creator\.html%3Fhandle%3Dprobe-artist$/.test(await path(a.page)),await path(a.page));
  await av.fill('#acInEmail','shell-fixture@invalid.test');await av.fill('#acInPass','fixture-password');await av.locator('#acGo').click();
  await a.page.waitForFunction(()=>location.pathname==='/music-creator.html'&&!document.querySelector('#mccMusicViewFrame'),null,{timeout:15000});await sleep(1000);
  const ae=await engine(a.page);
  check('23. after sign-in the artist page is back with the same element playing',ae.mark==='retained'&&ae.same&&!ae.paused,ae);
  await a.context.close();
});
await scenario('s21',async()=>{
  /* test 24, over Listen (was over the album): the sign-in in the view makes exactly the calls and storage writes
     account.html makes on its own */
  const run=async viewMode=>{
    const s=await setup({start:viewMode?'/listen.html':'/account.html?next=%2Flisten.html'});
    let doc=s.page.mainFrame();
    if(viewMode){await s.page.waitForSelector('#mccAuthChip');await s.page.locator('#mccAuthChip').click();doc=await waitView(s.page,/account\.html/);}
    await doc.waitForSelector('#acInEmail');
    const keys0=await s.page.evaluate(()=>Object.keys(localStorage).sort());
    const mark=s.log.requests.length;
    await doc.fill('#acInEmail','shell-fixture@invalid.test');await doc.fill('#acInPass','fixture-password');await doc.locator('#acGo').click();
    await s.page.waitForURL(/\/listen\.html/,{timeout:15000});await s.page.waitForLoadState('load');await sleep(1500);
    const auth=s.log.requests.slice(mark).filter(q=>/auth\/v1\/(token|user)|\/v1\/mnet\/bootstrap/.test(q.url)).map(q=>q.method+' '+q.url.replace(/^https:\/\/[^/]+/,'').replace(/\?.*$/,m=>m.includes('grant_type')?m:''));
    const keys1=await s.page.evaluate(()=>Object.keys(localStorage).sort());
    await s.context.close();
    return {auth:[...new Set(auth)].sort(),added:keys1.filter(k=>!keys0.includes(k)&&/sess|session|auth|pkce|oauth|^sb-/i.test(k))};
  };
  const direct=await run(false),inView=await run(true);
  check('24. the same sign-in calls in the view as on account.html loaded directly',JSON.stringify(direct.auth)===JSON.stringify(inView.auth)&&direct.auth.some(a=>/grant_type=password/.test(a)),{direct:direct.auth,inView:inView.auth});
  check('24. the same storage keys written',JSON.stringify(direct.added)===JSON.stringify(inView.added)&&inView.added.includes('mccdb_session'),{direct:direct.added,inView:inView.added});
});
await scenario('s22',async()=>{
  /* test 25, over Listen (was over the album): a provider starts in the top window; Create account and Forgot password
     are page loads of the top */
  const {context,page,log}=await setup({google:true});
  await playListen(page);
  await page.locator('#mccAuthChip').click();const v=await waitView(page,/account\.html/);
  await v.waitForSelector('#acProviders .ac__prov',{timeout:10000});
  HOLD.authorize=4000;
  const asked=page.waitForRequest(r=>/\/auth\/v1\/authorize\?/.test(r.url()),{timeout:10000});
  await v.locator('#acProviders .ac__prov').first().click();
  const areq=await asked;
  check('25. the authorize request is the top document\'s navigation, not the frame\'s',areq.frame()===page.mainFrame()&&areq.isNavigationRequest());
  await page.waitForURL(/supabase\.co\/auth\/v1\/authorize/,{timeout:10000});HOLD.authorize=0;
  check('25. a provider started in the account view navigates the top to the authorize address',/\/auth\/v1\/authorize\?/.test(page.url()));
  check('25. the frame never navigated to another origin',log.frames.every(u=>/^https:\/\/matthew\.mccluster\.org\//.test(u)||u==='about:blank'),log.frames);
  /* the way back from the provider is a top-level /auth/ load in this tab: its verifier is the tab's, and it is the one the challenge was made from */
  const sent=new URL(areq.url()).searchParams.get('code_challenge');
  await page.goBack({waitUntil:'load'}).catch(()=>{});
  const pk=await page.evaluate(async()=>{const v=sessionStorage.getItem('mcc.pkce');if(!v)return null;const d=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));let b='';for(const x of d)b+=String.fromCharCode(x);return {length:v.length,challenge:btoa(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};}).catch(e=>({error:String(e)}));
  check('25. the PKCE verifier is in the tab\'s sessionStorage, the one the challenge sent was made from',!!pk&&!!sent&&pk.challenge===sent&&pk.length>20,{pk,sent});
  await context.close();
  const c=await setup();
  await c.page.locator('#mccAuthChip').click();const cv=await waitView(c.page,/account\.html/);
  await cv.locator('#acCreateTab').click();await cv.locator('#acCreateGo').click();
  await c.page.waitForURL(/mnet\.html\?join=1|mccluster\.org\/\?join=1/,{timeout:10000});
  check('25. Create account is a page load of the top, to today\'s address',/\/mnet\.html\?join=1&next=%2Flisten\.html/.test(c.page.url()),c.page.url());
  await c.context.close();
  const f=await setup();
  await f.page.locator('#mccAuthChip').click();const fv=await waitView(f.page,/account\.html/);
  await fv.locator('#acForgot').click();
  await f.page.waitForURL(/forgot-password\.html/,{timeout:10000});
  check('25. Forgot password is a page load of the top',/\/forgot-password\.html/.test(f.page.url())&&!(await f.page.evaluate(()=>window.__docMark==='retained')));
  await f.context.close();
});
await scenario('s23',async()=>{
  /* test 26, over Listen (was over the album): signing out in the account view: the chip says Sign in, Listen repaints
     its offer as a guest's (the album's gated rows were the album's own way of saying so), the song plays on */
  const {context,page}=await setup({member:true});
  await page.waitForFunction(()=>(document.querySelector('#mccAuthChip .mcc-auth-chip__text')||{}).textContent==='Profile',null,{timeout:12000});
  await playListen(page);await markEngine(page);
  await page.evaluate(()=>{const a=document.createElement('a');a.href='account.html?stay=1';a.id='acLink';a.textContent='Account';(document.querySelector('main')||document.body).prepend(a);});
  await page.locator('#acLink').click();const v=await waitView(page,/account\.html\?stay=1/);
  await v.waitForSelector('#acOut',{state:'visible',timeout:10000});await v.locator('#acOut').click();
  await page.waitForFunction(()=>(document.querySelector('#mccAuthChip .mcc-auth-chip__text')||{}).textContent==='Sign in',null,{timeout:12000}).catch(()=>{});
  await sleep(1200);
  check('26. signing out in the account view: the chip says Sign in',await page.evaluate(()=>(document.querySelector('#mccAuthChip .mcc-auth-chip__text')||{}).textContent)==='Sign in');
  await page.waitForFunction(()=>{const s=document.querySelector('[data-creator-offer] .music-launch__go[data-offer="signin"]');return !!s&&!s.hidden;},null,{timeout:8000}).catch(()=>{});
  check('26. Listen repaints its offer as a guest\'s (Sign in)',await page.evaluate(()=>{const s=document.querySelector('[data-creator-offer] .music-launch__go[data-offer="signin"]');return !!s&&!s.hidden;}));
  const e=await engine(page);
  check('26. the song keeps playing on the same element',e.same&&!e.paused&&e.mark==='retained',e);
  await context.close();
});

/* ---------- ENGINE STAGE 0, THE REVIEW'S FINDINGS (2026-11-24) ---------- */
/* what is on screen: the address, the retained document's kind, the view shown (its own address) and the title */
async function onScreen(page){return page.evaluate(()=>{const f=document.getElementById('mccMusicViewFrame');let view=null;try{if(f&&f.getAttribute('data-mcc-ready')==='1')view=f.contentWindow.location.pathname+f.contentWindow.location.search;}catch(e){view='unreadable';}return {path:location.pathname+location.search,top:document.documentElement.getAttribute('data-music-view'),view,title:document.title};}).catch(e=>({error:String(e).slice(0,120)}));}
/* the page shown is Listen (the retained Listen with no view, or a Listen view), or this artist page */
const showsListen=s=>!s.error&&s.path==='/listen.html'&&(s.view?s.view==='/listen.html':s.top==='listen')&&/^Listen/.test(s.title);
const showsArtist=s=>!s.error&&s.path==='/music-creator.html?handle=probe-artist'&&(s.view?/handle=probe-artist$/.test(s.view):s.top==='artist')&&/Probe Artist/.test(s.title);
await scenario('jrn1-back',async()=>{
  /* JRN-1: Listen -> an artist card -> a reload there -> Back. The reload makes the artist page the retained document,
     and Listen's entry is now its own: Back is a pop inside it. Release 1 showed Listen there (a page load). */
  const {context,page,log}=await setup();
  await playListen(page);await page.fill('#q','');
  await page.waitForSelector('a.artist[href*="handle=probe-artist"]',{state:'visible',timeout:15000});
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  await waitView(page,/probe-artist/);
  await page.reload({waitUntil:'load'});await page.waitForFunction(()=>/Probe Artist/.test(document.title),null,{timeout:10000}).catch(()=>{});
  const r0=await onScreen(page);
  check('JRN-1 a reload at the artist view\'s address: the artist page is the document there',showsArtist(r0)&&!r0.view,r0);
  await page.goBack();await waitView(page,/\/listen\.html$/,6000).catch(()=>{});await sleep(600);
  const r1=await onScreen(page);
  check('JRN-1 then Back: Listen at /listen.html, never the artist page under Listen\'s address',showsListen(r1),r1);
  await page.goForward();await settle(page,1000);
  const r2=await onScreen(page);
  check('JRN-1 and Forward: the artist page at its own address',showsArtist(r2)&&!r2.view,r2);
  check('JRN-1 no page error',log.errors.length===0,log.errors);
  await context.close();
  /* Listen -> an artist card -> Creator Studio, a page out of music (a page load) -> Back -> Back */
  const s=await setup();
  await playListen(s.page);await s.page.fill('#q','');
  await s.page.waitForSelector('a.artist[href*="handle=probe-artist"]',{state:'visible',timeout:15000});
  await s.page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  const av=await waitView(s.page,/probe-artist/);
  await av.locator('nav.music-contextbar__nav a[href="creator.html"]').first().click();
  await s.page.waitForURL(/\/creator\.html$/,{timeout:10000});await s.page.waitForLoadState('load');await sleep(600);
  await s.page.goBack();await s.page.waitForLoadState('load');await s.page.waitForFunction(()=>/Probe Artist/.test(document.title),null,{timeout:10000}).catch(()=>{});
  const c1=await onScreen(s.page);
  check('JRN-1 out of music (Creator Studio), then Back: the artist page',showsArtist(c1),c1);
  await s.page.goBack();await waitView(s.page,/\/listen\.html$/,6000).catch(()=>{});await sleep(600);
  const c2=await onScreen(s.page);
  check('JRN-1 and Back again: Listen at /listen.html, never the artist page there',showsListen(c2),c2);
  check('JRN-1 no page error on the way out and back',s.log.errors.length===0,s.log.errors);
  await s.context.close();
});
await scenario('jrn2-ledger',async()=>{
  /* JRN-2: a member, an artist page as the retained document, Listen over it from the context bar; a catalogue song
     chosen there is counted (the listen ledger) and banked (the pocket), as on Listen itself */
  const {context,page,log}=await setup({member:true,start:'/music-creator.html?handle=probe-artist'});
  /* a record banked on this device: the artist page loaded on its own holds nothing, as before */
  await page.evaluate(()=>localStorage.setItem('mcc-pocket',JSON.stringify({src:'assets/audio/lightroom.mp3',title:'Lightroom',album:'here',t:42,playing:false,at:Date.now()})));
  await page.reload({waitUntil:'load'});await page.evaluate(()=>{window.__docMark='retained';});await sleep(1000);
  const own=await page.evaluate(()=>({ledger:!!window.MCC_LISTENS,pocket:!!window.MCC_POCKET,current:!!(MCC_MUSIC.current&&MCC_MUSIC.current()),mini:(document.getElementById('musicMiniAlbum')||{}).textContent||''}));
  check('JRN-2 an artist page on its own: no ledger, no pocket, nothing held (unchanged)',!own.ledger&&!own.pocket&&!own.current&&!/Pick up at/.test(own.mini),own);
  await page.locator('a.music-contextbar__brand').click();
  const v=await waitView(page,/listen\.html/);
  const r0=log.requests.length;
  await playListen(page,'Who Did The Shoot','here',v);
  await sleep(1500);
  await page.evaluate(()=>{MCC_MUSIC.audio.currentTime=Math.max(0,MCC_MUSIC.audio.duration-1);});
  await page.waitForFunction(()=>MCC_MUSIC.current()&&MCC_MUSIC.current().title!=='Who Did The Shoot'&&!MCC_MUSIC.audio.paused,null,{timeout:15000}).catch(()=>{});
  await sleep(3000);
  const listens=log.requests.slice(r0).filter(q=>q.method==='POST'&&/\/v1\/music\/listens/.test(q.url)).map(q=>q.url.replace(/^https?:\/\/[^/]+/,''));
  const top=await page.evaluate(()=>({ledger:!!window.MCC_LISTENS,pocket:!!window.MCC_POCKET,now:MCC_MUSIC.current()&&MCC_MUSIC.current().title,
    saved:(()=>{try{return JSON.parse(localStorage.getItem('mcc-pocket')||'null');}catch(e){return null;}})(),mini:(document.getElementById('musicMiniAlbum')||{}).textContent||''}));
  check('JRN-2 Listen over an artist page: the retained artist page has the listen ledger and the pocket',top.ledger&&top.pocket,top);
  check('JRN-2 a catalogue song chosen there is counted: its start, its finish at its end, then the next song\'s start',
    listens.filter(u=>u==='/v1/music/listens').length>=2&&listens.includes('/v1/music/listens/shell-listen/finish'),listens);
  check('JRN-2 and banked: the pocket holds the song playing',!!top.saved&&!!top.now&&top.saved.title===top.now,{saved:top.saved&&top.saved.title,now:top.now});
  check('JRN-2 the pocket, arriving under a song, held nothing by surprise',!/Pick up at/.test(top.mini),top.mini);
  check('JRN-2 no page error',log.errors.length===0,log.errors);
  await context.close();
});
await scenario('jrn3-hold',async()=>{
  /* JRN-3: the held closing song's pop-up on Listen at the top: its way forward closes it, whoever takes the link (the
     shell's account view for a guest, the World for a member). Found by the catalogue's hold flag, never named here. */
  const held=async(where)=>{
    await where.waitForSelector('#q',{timeout:15000});
    await where.fill('#q','CIA Mind Control');
    await where.waitForSelector('[data-music-play][data-album="cia-mind-control"]',{state:'visible',timeout:15000});
    return where.evaluate(async()=>{const d=await (await fetch('data/albums.json')).json();const titles=d.albums.find(a=>a.slug==='cia-mind-control').tracks.filter(t=>t.hold).map(t=>t.title);
      const b=[...document.querySelectorAll('[data-music-play][data-album="cia-mind-control"]')].find(x=>titles.includes(x.getAttribute('data-track')));if(b)b.id='heldPlay';return !!b;});
  };
  const g=await setup();
  check('JRN-3 the held song is listed in Listen\'s search',await held(g.page));
  await g.page.locator('#heldPlay').click();
  await g.page.waitForFunction(()=>{const d=document.getElementById('mccHold');return !!d&&d.open;},null,{timeout:12000});
  await g.page.locator('#mccHold .mcc-hold__go').click();
  const av=await waitView(g.page,/account\.html/).catch(()=>null);await sleep(600);
  const after=await g.page.evaluate(()=>{const d=document.getElementById('mccHold'),f=document.getElementById('mccMusicViewFrame');let hit=null;
    if(f&&f.contentDocument){const e=f.contentDocument.getElementById('acInEmail');if(e){const r=f.getBoundingClientRect(),er=e.getBoundingClientRect();const el=document.elementFromPoint(r.left+er.left+er.width/2,r.top+er.top+er.height/2);hit=el?(el.id||el.tagName):null;}}
    return {open:!!d&&d.open,path:location.pathname+location.search,hit};});
  check('JRN-3 a guest\'s Sign in in the pop-up: the account view opens, the pop-up closed, the form within reach',!!av&&!after.open&&after.hit==='mccMusicViewFrame'&&/^\/account\.html\?next=/.test(after.path),after);
  check('JRN-3 no page error',g.log.errors.length===0,g.log.errors);
  await g.context.close();
  const m=await setup({member:true});
  await m.page.waitForFunction(()=>(document.querySelector('#mccAuthChip .mcc-auth-chip__text')||{}).textContent==='Profile',null,{timeout:12000}).catch(()=>{});
  check('JRN-3 (a member) the held song is listed',await held(m.page));
  await m.page.locator('#heldPlay').click();
  await m.page.waitForFunction(()=>{const d=document.getElementById('mccHold');return !!d&&d.open;},null,{timeout:12000});
  const go=await m.page.evaluate(()=>document.querySelector('#mccHold .mcc-hold__go').getAttribute('href'));
  await m.page.locator('#mccHold .mcc-hold__go').click();
  await m.page.waitForFunction(()=>window.MCC_WORLD_AUDIO&&MCC_WORLD_AUDIO.active(),null,{timeout:10000}).catch(()=>{});await sleep(800);
  const w=await m.page.evaluate(()=>({open:!!(document.getElementById('mccHold')||{}).open,world:!!(window.MCC_WORLD_AUDIO&&MCC_WORLD_AUDIO.active())}));
  check('JRN-3 a member\'s Complete your profile: the World opens, the pop-up closed under it',/view=profile/.test(go)&&w.world&&!w.open,{go,...w});
  await m.context.close();
});
await scenario('jrn4-chip',async()=>{
  /* JRN-4: the Sign in chip stays on screen over the sign-in view; tapped again it keeps that view and its way back */
  const {context,page,log}=await setup();
  await playListen(page);await markEngine(page);
  await page.locator('#mccAuthChip').click();
  await waitView(page,/account\.html/);await sleep(600);
  const a=await page.evaluate(()=>({path:location.pathname+location.search,len:history.length}));
  await page.locator('#mccAuthChip').click();await sleep(1500);
  const b=await page.evaluate(()=>({path:location.pathname+location.search,len:history.length,frames:document.querySelectorAll('#mccMusicView .mcc-music-frame').length}));
  check('JRN-4 the chip tapped again over the sign-in view: the same view, no new entry, never the account page as its own way back',
    a.path==='/account.html?next=%2Flisten.html'&&b.path===a.path&&b.len===a.len&&b.frames===1,{a,b});
  const v=await view(page);
  await v.waitForSelector('#acInEmail',{timeout:10000});
  await v.fill('#acInEmail','shell-fixture@invalid.test');await v.fill('#acInPass','fixture-password');await v.locator('#acGo').click();
  await page.waitForFunction(()=>location.pathname==='/listen.html'&&!document.querySelector('#mccMusicViewFrame'),null,{timeout:15000}).catch(()=>{});await sleep(1200);
  const e=await engine(page);
  check('JRN-4 then the password sign-in: back on Listen, the same song playing (never the World as a page load)',e.mark==='retained'&&e.same&&!e.paused&&await path(page)==='/listen.html',{e,path:await path(page)});
  check('JRN-4 no page error',log.errors.length===0,log.errors);
  await context.close();
});
await scenario('msl1-double',async()=>{
  /* MSL-1: a double tap on one artist link, 60 ms apart, before its view painted */
  const {context,page,log}=await setup();
  await playListen(page);await page.fill('#q','');
  await page.waitForSelector('a.artist[href*="handle=probe-artist"]',{state:'visible',timeout:15000});
  await sleep(3000);log.collect.length=0;
  const len0=await page.evaluate(()=>history.length);
  const link=page.locator('a.artist[href*="handle=probe-artist"]').first();
  await link.click();await sleep(60);await link.click({force:true}).catch(()=>{});
  await waitView(page,/probe-artist/);await sleep(3500);
  const views=log.collect.filter(e=>e.name==='page_view'&&e.path==='music-creator.html');
  const d=await page.evaluate(()=>({len:history.length,frames:document.querySelectorAll('#mccMusicView .mcc-music-frame').length}));
  check('MSL-1 a double tap on an artist link: one view, one page_view, one history entry',views.length===1&&d.len===len0+1&&d.frames===1,{views:views.length,...d,len0});
  await page.goBack();await settle(page,900);
  check('MSL-1 and one Back is Listen',await path(page)==='/listen.html'&&await frames(page)===0,{path:await path(page),frames:await frames(page)});
  await context.close();
  /* artist A, then artist B while A still opens (its document held 1.5 s): Back is Listen, never A */
  DELAY['/music-creator.html']=1500;
  const s=await setup();
  try{
    await playListen(s.page);await s.page.fill('#q','');
    await s.page.waitForSelector('a.artist[href*="handle=second-artist"]',{state:'visible',timeout:15000});
    const l0=await s.page.evaluate(()=>history.length);
    await s.page.locator('a.artist[href*="handle=probe-artist"]').first().click();await sleep(200);
    await s.page.locator('a.artist[href*="handle=second-artist"]').first().click({force:true});
    await waitView(s.page,/second-artist/,12000);await sleep(400);
    delete DELAY['/music-creator.html'];
    const b=await s.page.evaluate(()=>({len:history.length,path:location.pathname+location.search}));
    check('MSL-1 another artist tapped while the first still opens: that view, and one history entry',b.len===l0+1&&b.path==='/music-creator.html?handle=second-artist',{...b,l0});
    await s.page.goBack();await settle(s.page,1500);
    check('MSL-1 and one Back is Listen, never the artist page that never showed',await path(s.page)==='/listen.html'&&await frames(s.page)===0,{path:await path(s.page),frames:await frames(s.page)});
  }finally{delete DELAY['/music-creator.html'];await s.context.close();}
});
await scenario('jrn5-scroll',async()=>{
  /* JRN-5: a view left by Back comes back on Forward where it was scrolled to */
  const {context,page}=await setup();
  await playListen(page);await page.fill('#q','');
  await page.waitForSelector('a.artist[href*="handle=probe-artist"]',{state:'visible',timeout:15000});
  await page.locator('a.artist[href*="handle=probe-artist"]').first().click();
  const v=await waitView(page,/probe-artist/);await v.waitForSelector('#creatorArtist .ap-hero__line',{timeout:10000});await sleep(400);
  const want=await v.evaluate(()=>{window.scrollTo(0,Math.min(305,document.documentElement.scrollHeight-innerHeight));return Math.round(scrollY);});
  await sleep(1200);
  await page.goBack();await settle(page,900);
  await page.goForward();const v2=await waitView(page,/probe-artist/);await sleep(900);
  const got=await v2.evaluate(()=>Math.round(scrollY));
  check('JRN-5 a view left by Back comes back on Forward where it was scrolled to',want>=100&&Math.abs(got-want)<=2,{want,got});
  await context.close();
});
await scenario('jrn6-search',async()=>{
  /* JRN-6: Listen's search Enter in a Listen view over an artist page navigates the frame (location.href); the shell stops
     it and loads the album in the top: one navigation, one entry */
  const {context,page}=await setup({start:'/music-creator.html?handle=probe-artist'});
  await page.waitForSelector('a.music-contextbar__brand');await page.locator('a.music-contextbar__brand').click();
  const lv=await waitView(page,/listen\.html/);
  await lv.waitForSelector('#q',{timeout:15000});
  const len0=await page.evaluate(()=>history.length);
  await lv.locator('#q').fill('Lightroom');await lv.waitForSelector('#all a.row',{state:'visible',timeout:15000});await sleep(300);
  await lv.locator('#q').press('Enter');
  await page.waitForURL(/album\.html/,{timeout:10000});await page.waitForLoadState('load');await sleep(600);
  const len1=await page.evaluate(()=>history.length);
  check('JRN-6 Listen\'s search Enter in a view: a page load of the album, one history entry for it',len1===len0+1,{len0,len1});
  await page.goBack();await page.waitForLoadState('load');await sleep(1000);
  const b1=await onScreen(page);
  check('JRN-6 one Back: Listen at its address',showsListen(b1),b1);
  await page.goBack();await waitView(page,/probe-artist/,6000).catch(()=>{});await sleep(800);
  const b2=await onScreen(page);
  check('JRN-6 the next Back: the artist page, never Listen a second time',showsArtist(b2),b2);
  await context.close();
});
}finally{
  const pass=results.filter(r=>r.pass).length;
  console.log(`\nmusic shell: ${pass} of ${results.length} checks pass`);
  await writeFile(join(OUT,'music-shell.json'),JSON.stringify({root:ROOT,at:new Date().toISOString(),pass,total:results.length,results},null,1));
  await browser.close();
  process.exitCode=pass===results.length&&results.length?0:1;
}
