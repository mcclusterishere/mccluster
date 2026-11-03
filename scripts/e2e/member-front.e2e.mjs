/* Every account's front page: the editor (front-studio.html), the page it makes (front.html?u=<handle>) and the doors to
   both. Real pages and scripts from this checkout, the real Worker routes (workers/mccluster/src/member-fronts.js) and
   the real check (packages/front-config) answering the browser; the database and the storage bucket are in-memory
   fixtures that keep what the browser sends (no Supabase, no Worker deploy, no third party).
   Owner, 2026-10-21: "all the accounts need to be able to recreate with their own media this exact same experience ...
   The experience being my front page with a VR, with the scroll dependent video, all this."
   PLAYWRIGHT_DIR=<node_modules> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/member-front.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/member-front-proof';
const FIX=join(ROOT,'scripts/e2e/fixtures/front-media');
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const {handleMemberFronts}=await import(pathToFileURL(join(ROOT,'workers/mccluster/src/member-fronts.js')).href);
const BASE='https://matthew.mccluster.org',SB='https://zmnhbrjyhxzhkxmhkexs.supabase.co';
const ENV={SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:'service-fixture',ALLOWED_ORIGINS:BASE};
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.mp4':'video/mp4','.mp3':'audio/mpeg'};
const BENJI={id:'22222222-2222-4222-8222-222222222222',m_uid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',handle:'benji.chase',name:'Benji Chase'};
const VISITOR={id:'44444444-4444-4444-8444-444444444444',m_uid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',handle:'visitor.one',name:'Visitor One'};
const NOHANDLE={id:'55555555-5555-4555-8555-555555555555',m_uid:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',handle:'',name:''};
const ACCOUNTS=[BENJI,VISITOR,NOHANDLE];
const results=[];
function check(scope,name,condition,detail){results.push({scope,name,pass:!!condition});console.log((condition?'PASS ':'FAIL ')+'['+scope+'] '+name+(condition?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});

/* ONE WORLD for the whole run: the database rows and the bucket's objects persist across the pages, as they would */
const world={fronts:[],objects:new Map(),uploads:[],refused:[],reads:[]};
const sub=auth=>{try{return JSON.parse(atob(String(auth||'').replace(/^Bearer\s+/i,'').split('.')[1])).sub;}catch{return null;}};
const who=auth=>ACCOUNTS.find(a=>a.id===sub(auth))||null;
/* PostgREST and auth, as the Worker's service calls reach them */
async function supabase(url,init={}){
  const u=new URL(String(url)),h=new Headers(init.headers||{}),method=init.method||'GET';
  const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json'}});
  const q=k=>(u.searchParams.get(k)||'').replace(/^eq\./,'');
  if(u.pathname==='/auth/v1/user'){const a=who(h.get('authorization'));return a?json({id:a.id}):json({msg:'bad jwt'},401);}
  if(u.pathname==='/rest/v1/m_auth_user_links'){const a=ACCOUNTS.find(x=>x.id===q('auth_user_id'));return json(a?[{m_uid:a.m_uid}]:[]);}
  if(u.pathname==='/rest/v1/platform_profiles'){const a=ACCOUNTS.find(x=>x.id===q('user_id'));return json(a?[{mccluster_id:a.handle||null,display_name:a.name,avatar_url:''}]:[]);}
  if(u.pathname==='/rest/v1/network_profiles'){const a=ACCOUNTS.find(x=>x.m_uid===q('m_uid'));return json(a?[{display_name:a.name,avatar_url:'',headline:'Producer',visibility:'public'}]:[]);}
  if(u.pathname==='/rest/v1/member_fronts'){
    if(method==='GET'){
      let rows=world.fronts.slice();
      if(u.searchParams.get('m_uid'))rows=rows.filter(r=>r.m_uid===q('m_uid'));
      if(u.searchParams.get('handle'))rows=rows.filter(r=>r.handle===q('handle'));
      if(u.searchParams.get('removed_at')==='is.null')rows=rows.filter(r=>!r.removed_at);
      if(u.searchParams.get('published')==='not.is.null')rows=rows.filter(r=>r.published);
      return json(rows);
    }
    const b=init.body?JSON.parse(init.body):{};
    if(method==='POST'){const i=world.fronts.findIndex(r=>r.m_uid===b.m_uid);if(i>=0)world.fronts[i]={...world.fronts[i],...b};else world.fronts.push({removed_at:null,published:null,published_at:null,...b});return new Response(null,{status:201});}
    if(method==='PATCH'){world.fronts=world.fronts.map(r=>(r.m_uid===q('m_uid')||r.handle===q('handle'))?{...r,...b}:r);return new Response(null,{status:204});}
  }
  return json({message:'unexpected '+u.pathname},404);
}
const cors={'access-control-allow-origin':BASE,'access-control-allow-headers':'*','access-control-allow-methods':'*'};
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});

async function setup(viewport,account){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true});
  const errors=[],media=[];
  await ctx.addInitScript(({account})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(!account)return;
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:account.id,email:account.handle+'@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:account.id,email:account.handle+'@fixture.invalid'}}));
  },{account});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    if(u.origin==='https://api.mccluster.org'){
      if(p.startsWith('/v1/fronts')){
        /* the real Worker route, over the in-memory database */
        const headers=new Headers(req.headers());headers.set('origin',BASE);
        const body=['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()||undefined;
        const res=await handleMemberFronts(new Request(req.url(),{method:req.method(),headers,body}),ENV,{fetchImpl:supabase});
        if(!res)return json(route,{error:'Not found'},404);
        return route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())});
      }
      if(p==='/v1/collect')return json(route,{ok:true});
      if(p==='/v1/status')return json(route,{error:'Forbidden'},403);
      const a=who(req.headers().authorization);
      if(p==='/v1/mnet/bootstrap')return a?json(route,{identity:{m_uid:a.m_uid,mccluster_id:a.handle||null},profile:{display_name:a.name,avatar_url:''}}):json(route,{error:'Sign in'},401);
      if(p.startsWith('/v1/mnet/people/')){const h=decodeURIComponent(p.split('/').pop()),t=ACCOUNTS.find(x=>x.handle===h);return t?json(route,{identity:{mccluster_id:t.handle},profile:{display_name:t.name,headline:'Producer',bio:''},counts:{posts:3,followers:10,following:2}}):json(route,{error:'No such member'},404);}
      return json(route,{ok:true,items:[],threads:[],apps:[],events:[],tenants:[],total:0});
    }
    if(u.origin===SB){
      if(p==='/auth/v1/user'){const a=who(req.headers().authorization);return a?json(route,{id:a.id,email:a.handle+'@fixture.invalid'}):json(route,{msg:'no session'},401);}
      /* the bucket: an upload lands only in the uploader's own folder (the storage policies), a read is public */
      const up=p.match(/^\/storage\/v1\/object\/front-media\/(.+)$/);
      if(up&&req.method()==='POST'){
        const path=decodeURIComponent(up[1]),a=who(req.headers().authorization);
        if(!a||path.split('/')[0]!==a.id){world.refused.push(path);return route.fulfill({status:403,headers:cors,contentType:'application/json',body:'{"message":"new row violates row-level security policy"}'});}
        /* Chromium hands the interceptor no body for a picked file sent as it is (the 360 photo, the track): the bytes
           are the fixture the test picked, so it is kept from there */
        const picked=/\/cabin-[^/]+\.jpg$/.test(path)?'room360.jpg':/\/sound-[^/]+\.wav$/.test(path)?'beat.wav':'';
        const body=req.postDataBuffer()||(picked?await readFile(join(FIX,picked)):null);
        if(!body)return route.fulfill({status:400,headers:cors,contentType:'application/json',body:'{"message":"empty upload"}'});
        world.objects.set(path,{type:req.headers()['content-type'],body});world.uploads.push(path);
        return route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify({Key:'front-media/'+path})});
      }
      /* listing and removing, each held to the caller's own folder (the select and delete policies) */
      if(p==='/storage/v1/object/list/front-media'&&req.method()==='POST'){
        const a=who(req.headers().authorization),b=req.postDataJSON()||{};let prefix=String(b.prefix||'');if(prefix&&!prefix.endsWith('/'))prefix+='/';
        world.lists=(world.lists||0)+1;
        if(!a)return route.fulfill({status:403,headers:cors,contentType:'application/json',body:'{"message":"unauthorized"}'});
        const seen=new Map();
        for(const k of world.objects.keys()){if(!k.startsWith(a.id+'/')||!k.startsWith(prefix))continue;const rest=k.slice(prefix.length),i=rest.indexOf('/');
          if(i>=0)seen.set(rest.slice(0,i),{name:rest.slice(0,i),id:null});else seen.set(rest,{name:rest,id:'obj-'+rest,metadata:{size:world.objects.get(k).body.length}});}
        return route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify([...seen.values()])});
      }
      if(p==='/storage/v1/object/front-media'&&req.method()==='DELETE'){
        const a=who(req.headers().authorization),b=req.postDataJSON()||{},out=[];
        for(const k of b.prefixes||[]){if(a&&k.startsWith(a.id+'/')&&world.objects.delete(k)){out.push({name:k});world.removed=(world.removed||[]).concat(k);}}
        return route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify(out)});
      }
      const pub=p.match(/^\/storage\/v1\/object\/public\/front-media\/(.+)$/);
      if(pub){const o=world.objects.get(decodeURIComponent(pub[1]));media.push(decodeURIComponent(pub[1]));world.reads.push(decodeURIComponent(pub[1]));return o?route.fulfill({status:200,headers:{...cors,'access-control-allow-origin':'*'},contentType:o.type,body:o.body}):route.fulfill({status:404,body:''});}
      /* the artist page (music-creator.html): Benji's artist profile, and who the signed-in account is */
      if(p==='/rest/v1/music_creator_profiles')return json(route,u.searchParams.get('handle')==='eq.benji.chase'?[{m_uid:BENJI.m_uid,handle:'benji.chase',artist_name:'Hitman Benji',bio:'',avatar_url:'',banner_url:'',website_url:'',verification_state:'',settings:{}}]:[]);
      if(p==='/rest/v1/rpc/current_m_uid'){const a=who(req.headers().authorization);return json(route,a?a.m_uid:null);}
      if(p.startsWith('/rest/v1/'))return json(route,[]);
      return json(route,{});
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
  return {ctx,page,errors,media};
}
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
const studio=page=>page.evaluate(()=>{const S=window.__MCC_FRONT_STUDIO;return S?{state:S.state,dirty:S.dirty,msg:S.msg,bad:S.bad,busy:Object.keys(S.busy).filter(k=>S.busy[k]),draft:JSON.parse(JSON.stringify(S.draft||null)),me:S.me&&{handle:S.me.handle,published:!!S.me.published}}:null;});
const previewFrame=page=>page.frames().find(f=>/\/front\.html$/.test(new URL(f.url()).pathname));
/* the preview frame, once it has the draft and its engine is running */
async function previewReady(page,seqAbove=0){
  await page.waitForFunction(n=>{const f=document.getElementById('fsFrame');if(!f)return false;const m=/studio=(\d+)/.exec(f.src||'');if(!m||Number(m[1])<=n)return false;
    try{const w=f.contentWindow;return w.location.search.indexOf('studio='+m[1])>=0&&w.document.documentElement.getAttribute('data-front-state')==='ready'&&w.MCC_FRONT&&w.__MCC_FRONT_GOTO;}catch(e){return false;}},seqAbove,{timeout:30000});
  return previewFrame(page);
}
const frameSeq=page=>page.evaluate(()=>{const m=/studio=(\d+)/.exec(document.getElementById('fsFrame').src||'');return m?Number(m[1]):0;});
async function uploadInto(page,key,file){
  await page.setInputFiles(`[data-upload="${key}"]`,join(FIX,file));
  await page.waitForFunction(k=>{const S=window.__MCC_FRONT_STUDIO;return S&&!S.busy[k];},key,{timeout:90000});
  return studio(page);
}

try{
  /* 1. THE EDITOR'S DOORS: signed out it asks to sign in; an account with no handle is sent to finish it */
  {
    const scope='studio-gates';
    for(const [acct,want,label] of [[null,'signin',/Sign in to build your front page/],[NOHANDLE,'handle',/Choose your handle first/]]){
      const app=await setup({width:390,height:844},acct);const {page,errors}=app;
      await page.goto(BASE+'/front-studio.html',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(w=>window.__MCC_FRONT_STUDIO&&window.__MCC_FRONT_STUDIO.state===w,want,{timeout:20000}).catch(()=>{});
      const s=await studio(page),txt=await page.textContent('#fsRoot');
      check(scope,(acct?'an account with no handle':'signed out')+': the editor says what to do first',s&&s.state===want&&label.test(txt),{s,txt});
      check(scope,(acct?'no handle':'signed out')+': no overflow at 390, no errors',(await overflow(page))===0&&errors.length===0,errors);
      await app.ctx.close();
    }
  }

  /* 2. BENJI BUILDS HIS PAGE ON HIS PHONE: words, a film cut into frames, a 360 photo, a track, a link, a tag; publish */
  {
    const scope='studio-390';const app=await setup({width:390,height:844},BENJI);const {page,errors}=app;
    await page.goto(BASE+'/front-studio.html',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#fsForm [name="words.title1"]',{timeout:30000});
    let s=await studio(page);
    check(scope,'the editor opens on his own account, nothing published yet',s.state==='ready'&&s.me.handle==='benji.chase'&&!s.me.published&&/Not published yet/.test(await page.textContent('#fsLive'))&&/Benji Chase/.test(await page.textContent('.fs-head h1')),s);
    let fr=await previewReady(page);
    let words=await fr.evaluate(()=>({t1:document.querySelector('[data-fw-word="title1"]').getAttribute('data-word'),t2:document.querySelector('[data-fw-word="title2"]').getAttribute('data-word'),sub:document.querySelector('[data-fw="sub"]').textContent,source:window.MCC_FRONT.source,studio:window.MCC_FRONT_SOURCE&&window.MCC_FRONT_SOURCE.studio}));
    check(scope,'the preview is the real page, fed his draft by the editor: his name as the title until he types one',words.t1==='BENJI'&&words.t2==='CHASE'&&words.sub==='@benji.chase'&&words.source==='member'&&words.studio===true,words);
    check(scope,'the editor and its preview fit the phone: no horizontal overflow at 390',(await overflow(page))===0,await overflow(page));
    await page.screenshot({path:join(OUT,'studio-open-390.png'),fullPage:false});

    /* words, typed: markup stays text */
    let seq=await frameSeq(page);
    await page.fill('[name="words.title1"]','HITMAN');
    await page.fill('[name="words.title2"]','<b>B</b>');
    await page.fill('[name="words.title2"]','BENJI');
    await page.fill('[name="words.eyebrow"]','Producer · <img src=x onerror="window.__pwned=1">');
    s=await studio(page);
    check(scope,'typing marks the draft unsaved and says the preview shows it',s.dirty&&/Unsaved changes/.test(await page.textContent('#fsStatus')),s);
    fr=await previewReady(page,seq);
    words=await fr.evaluate(()=>({t1:document.querySelector('[data-fw-word="title1"]').getAttribute('data-word'),t2:document.querySelector('[data-fw-word="title2"]').getAttribute('data-word'),eyebrow:document.querySelector('[data-fw="eyebrow"]').textContent,imgs:document.querySelectorAll('.hero__eyebrow img').length,pwned:!!window.__pwned,letters:document.querySelectorAll('#heroTitle .ch').length}));
    check(scope,'the preview reloads with his words; the title is built letter by letter, markup stays text',words.t1==='HITMAN'&&words.t2==='BENJI'&&words.letters===11&&/<img src=x/.test(words.eyebrow)&&words.imgs===0&&!words.pwned,words);

    /* the opening film: cut into frames in his browser, uploaded to his own folder */
    seq=await frameSeq(page);
    s=await uploadInto(page,'hero','film.webm');
    const hero=s.draft.media&&s.draft.media.hero;
    const heroDir=hero?hero.base.replace(SB+'/storage/v1/object/public/front-media/',''):'';
    const big=[...world.objects.keys()].filter(k=>k.startsWith(heroDir)&&!k.includes('/sm/')),small=[...world.objects.keys()].filter(k=>k.startsWith(heroDir+'sm/'));
    check(scope,'his video is cut into frames (48 for 3 seconds), full size and phone size, as WebP',!!hero&&hero.count===48&&hero.ext==='webp'&&hero.sm===true&&big.length===48&&small.length===48&&world.objects.get(heroDir+'0001.webp').type==='image/webp',{hero,big:big.length,small:small.length,msg:s.msg});
    check(scope,'every frame went to his own folder of the bucket, none anywhere else',world.uploads.every(k=>k.startsWith(BENJI.id+'/'))&&world.refused.length===0,{refused:world.refused});
    check(scope,'it says the film is in, and to save or publish',/Added/.test(s.msg)&&/48 frames/.test(await page.textContent('[data-media="hero"]')),s.msg);
    fr=await previewReady(page,seq);
    await page.waitForTimeout(1200);
    const reads=app.media.filter(k=>k.startsWith(heroDir));
    check(scope,'the preview plays his film from his folder, the phone-size frames at 390',reads.length>0&&reads.every(k=>k.startsWith(heroDir+'sm/')),reads.slice(0,4));

    /* a 360 that is not a 360 is refused; a real one goes in */
    await page.setInputFiles('[data-upload="cabin"]',join(FIX,'notround.jpg'));
    await page.waitForFunction(()=>{const S=window.__MCC_FRONT_STUDIO;return S&&!S.busy.cabin&&S.msg;},null,{timeout:20000});
    s=await studio(page);
    check(scope,'a photo that is not twice as wide as it is tall is refused, and it says why',s.bad&&/not a 360 \(800×600\)/.test(s.msg)&&!(s.draft.media||{}).cabin,s.msg);
    seq=await frameSeq(page);
    s=await uploadInto(page,'cabin','room360.jpg');
    const cabin=(s.draft.media||{}).cabin;
    check(scope,'his 360 photo goes in, from his folder',!!cabin&&cabin.kind==='image'&&cabin.src.startsWith(SB+'/storage/v1/object/public/front-media/'+BENJI.id+'/cabin-'),cabin);

    /* the soundtrack */
    s=await uploadInto(page,'sound','beat.wav');
    const snd=(s.draft.media||{}).sound,sndKey=snd?snd.src.split('/front-media/')[1]:'';
    check(scope,'his track goes in, stored as audio/wav',!!snd&&world.objects.get(sndKey)&&world.objects.get(sndKey).type==='audio/wav',{snd,type:sndKey&&world.objects.get(sndKey)&&world.objects.get(sndKey).type});

    /* links: a bad one stops the save and says which; fixed, it goes */
    await page.click('[data-act="link"]');
    await page.fill('[name="links.0.label"]','Instagram');
    await page.fill('[name="links.0.href"]','javascript:alert(1)');
    const stopped=await page.evaluate(()=>({pub:document.querySelector('#fsTop [data-act="publish"]').disabled,save:document.querySelector('#fsTop [data-act="save"]').disabled,msg:document.getElementById('fsStatus').textContent}));
    check(scope,'a script link stops Save and Publish and names the link to fix',stopped.pub&&stopped.save&&/Fix link 1/.test(stopped.msg),stopped);
    await page.fill('[name="links.0.href"]','https://instagram.com/hitmanbenji');
    check(scope,'fixed, Save and Publish come back',await page.evaluate(()=>!document.querySelector('#fsTop [data-act="publish"]').disabled));

    /* the 360 room in the preview: open it, take its view as the opening view, pin a tag where it looks */
    fr=await previewReady(page,seq);
    await page.click('[data-act="view"]');
    s=await studio(page);
    check(scope,'"Use the preview\'s view" with the room closed says to open it first',s.bad&&/Open the 360 room in the preview first/.test(s.msg),s.msg);
    await page.click('[data-go="cabin"]');
    fr=previewFrame(page);
    await fr.waitForFunction(()=>window.__MCC_VR&&window.__MCC_VR.viewer,null,{timeout:20000}).catch(()=>{});
    const room=await fr.evaluate(()=>({viewer:!!(window.__MCC_VR&&window.__MCC_VR.viewer),src:(document.querySelector('#workVR [data-vr-src]')||{}).getAttribute?.('data-vr-src')||'',held:!!(window.__MCC_VR&&window.__MCC_VR.held)}));
    check(scope,'the preview\'s "360 room" button takes the page into his 360 room',room.viewer,room);
    const houseTags=await fr.evaluate(()=>({spots:window.MCC_FRONT.config.vr.spots.length,shown:[...document.querySelectorAll('#workVR .vr360-spot')].map(a=>a.textContent.trim())}));
    check(scope,'with no tags of his own, his room has none: never the house\'s (Codex #595)',houseTags.spots===0&&houseTags.shown.length===0,houseTags);
    await fr.evaluate(()=>{const v=window.__MCC_VR.viewer;v.state.yaw=Math.PI/4;v.state.pitch=-Math.PI/18;});
    await page.click('[data-act="view"]');
    s=await studio(page);
    check(scope,'his opening view is taken from where the preview looks (45°, -10°)',s.draft.vr&&s.draft.vr.yaw===45&&s.draft.vr.pitch===-10,s.draft.vr);
    await page.click('[data-act="tag"]');
    await page.fill('[name="vr.spots.0.label"]','My studio');
    await page.fill('[name="vr.spots.0.href"]','https://example.com/studio');
    await page.click('[data-act="pin"][data-i="0"]');
    s=await studio(page);
    check(scope,'a tag is added and pinned where the preview looks',s.draft.vr.spots.length===1&&s.draft.vr.spots[0].label==='My studio'&&typeof s.draft.vr.spots[0].yaw==='number',s.draft.vr.spots);
    await page.uncheck('[name="vr.hold"]');
    await page.selectOption('[name="feel"]','smooth');
    s=await studio(page);
    check(scope,'the hold and the scroll feel are his to set',s.draft.vr.hold===false&&s.draft.scroll.duration===1.2&&s.draft.scroll.touchLerp===0.1,{vr:s.draft.vr,scroll:s.draft.scroll});

    /* save, then publish */
    await page.click('#fsTop [data-act="save"]');
    await page.waitForFunction(()=>/Draft saved/.test(window.__MCC_FRONT_STUDIO.msg),null,{timeout:15000}).catch(()=>{});
    s=await studio(page);
    const row=world.fronts.find(r=>r.handle==='benji.chase');
    check(scope,'Save keeps a draft through the Worker, not published',!s.dirty&&!!row&&row.draft&&!row.published&&row.draft.words.title1==='HITMAN'&&row.draft.media.hero.count===48,{msg:s.msg,row:row&&{published:row.published}});
    await page.click('#fsTop [data-act="publish"]');
    await page.waitForFunction(()=>/Published/.test(window.__MCC_FRONT_STUDIO.msg),null,{timeout:15000}).catch(()=>{});
    s=await studio(page);
    const live=world.fronts.find(r=>r.handle==='benji.chase');
    check(scope,'Publish puts it live at front.html?u=benji.chase, with every setting he made',/front\.html\?u=benji\.chase/.test(s.msg)&&!s.bad&&live.published&&live.published.media.cabin&&live.published.media.sound&&live.published.links[0].href==='https://instagram.com/hitmanbenji'&&live.published.vr.spots.length===1&&live.published.vr.hold===false,{msg:s.msg,pub:live&&live.published});
    /* he replaces his opening film and publishes again: the old frames leave his folder, nothing else does (Codex #595) */
    const oldHero=live.published.media.hero.base.split('/front-media/')[1];
    await page.evaluate(()=>window.scrollTo(0,0));
    let s2=await uploadInto(page,'hero','film.webm');
    const newHero=s2.draft.media.hero.base.split('/front-media/')[1];
    await page.click('#fsTop [data-act="save"]');
    await page.waitForFunction(()=>/Draft saved/.test(window.__MCC_FRONT_STUDIO.msg),null,{timeout:15000}).catch(()=>{});
    await page.waitForTimeout(800);
    const keys=()=>[...world.objects.keys()];
    check(scope,'saving a draft keeps the published page\'s film: the live page still plays',newHero!==oldHero&&keys().filter(k=>k.startsWith(oldHero)).length===96&&keys().filter(k=>k.startsWith(newHero)).length===96,{old:keys().filter(k=>k.startsWith(oldHero)).length,new:keys().filter(k=>k.startsWith(newHero)).length});
    await page.click('#fsTop [data-act="publish"]');
    await page.waitForFunction(()=>/Published/.test(window.__MCC_FRONT_STUDIO.msg),null,{timeout:15000}).catch(()=>{});
    for(let i=0;i<40&&keys().some(k=>k.startsWith(oldHero));i++)await page.waitForTimeout(100);
    const after=world.fronts.find(r=>r.handle==='benji.chase').published.media;
    const stillThere=[after.cabin.src,after.sound.src].map(u=>u.split('/front-media/')[1]).every(k=>world.objects.has(k));
    check(scope,'publishing again removes the replaced film\'s frames, and only those',!keys().some(k=>k.startsWith(oldHero))&&keys().filter(k=>k.startsWith(newHero)).length===96&&stillThere&&after.hero.base.includes(newHero)&&!keys().some(k=>/\/cabin-[^/]+\.jpg$/.test(k)&&!k.endsWith(after.cabin.src.split('/').pop())),{old:keys().filter(k=>k.startsWith(oldHero)).length,stillThere,all:keys().filter(k=>!k.includes('/films/'))});
    check(scope,'the refused 360 left nothing behind',!keys().some(k=>k.includes('notround')),keys().filter(k=>!k.includes('/films/')));
    check(scope,'"See it live" and "Take it down" appear once it is live',await page.evaluate(()=>!document.getElementById('fsOpen').hidden&&/front\.html\?u=benji\.chase$/.test(document.getElementById('fsOpen').href)&&!document.getElementById('fsUnpublish').hidden));
    const targets=await page.evaluate(()=>[...document.querySelectorAll('.fs button:not([hidden]),.fs .fs-btn:not([hidden]),.fs input:not([type=file]):not([type=checkbox]),.fs select')].filter(b=>b.offsetParent).map(b=>({h:Math.round(b.getBoundingClientRect().height),t:(b.textContent||b.name||'').trim().slice(0,20)})).filter(x=>x.h<44));
    check(scope,'every button and field is at least 44px tall on the phone',targets.length===0,targets);
    const inputs=await page.evaluate(()=>[...document.querySelectorAll('.fs input:not([type=file]):not([type=checkbox]),.fs select')].map(i=>parseFloat(getComputedStyle(i).fontSize)).filter(x=>x<16));
    check(scope,'fields are 16px type (no zoom on focus)',inputs.length===0,inputs);
    check(scope,'no horizontal overflow at 390 after everything',(await overflow(page))===0,await overflow(page));
    check(scope,'no JavaScript errors in the editor or its preview',errors.length===0,errors);
    await page.screenshot({path:join(OUT,'studio-published-390.png')});
    await app.ctx.close();
  }

  /* 3. ON A DESKTOP: the preview beside the settings, both fitting the window */
  {
    const scope='studio-1280';const app=await setup({width:1280,height:800},BENJI);const {page,errors}=app;
    await page.goto(BASE+'/front-studio.html',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#fsForm [name="words.title1"]',{timeout:30000});
    await previewReady(page);
    const s=await studio(page);
    check(scope,'it opens on the saved draft, live',s.me.published&&s.draft.words.title1==='HITMAN'&&!s.dirty&&/Live at front\.html\?u=benji\.chase/.test(await page.textContent('#fsLive')),s.me);
    await page.click('[data-device="desktop"]');
    await page.waitForTimeout(300);
    const box=await page.evaluate(()=>{const st=document.querySelector('.fs-stage').getBoundingClientRect(),fm=document.querySelector('.fs-form').getBoundingClientRect(),dv=document.getElementById('fsDevice').getBoundingClientRect();return {side:fm.left>=st.right-1,dev:Math.round(dv.width),stage:Math.round(st.width),devH:Math.round(dv.bottom),win:innerHeight};});
    check(scope,'the preview and the settings sit side by side; the desktop preview fits its column',box.side&&box.dev<=box.stage&&box.dev>200,box);
    check(scope,'no overflow at 1280, no errors',(await overflow(page))===0&&errors.length===0,errors);
    await page.screenshot({path:join(OUT,'studio-1280.png')});
    await app.ctx.close();
  }

  /* 4. A VISITOR (signed out) GETS HIS PAGE: his words, his film, his 360 room, his track, his links */
  for(const vp of [{width:390,height:844},{width:1280,height:800}]){
    const scope='visitor-'+vp.width;const app=await setup(vp,null);const {page,errors}=app;
    await page.goto(BASE+'/front.html?u=benji.chase',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.documentElement.getAttribute('data-front-state')==='ready'&&window.MCC_FRONT&&window.__MCC_FRONT_GOTO,null,{timeout:30000});
    await page.waitForTimeout(1500);
    const f=await page.evaluate(()=>({source:window.MCC_FRONT.source,c:window.MCC_FRONT.config,title:document.title,t1:document.querySelector('[data-fw-word="title1"]').getAttribute('data-word'),
      door1:(document.querySelector('[data-fw-door="door1"]')||{}).getAttribute?.('href'),links:[...document.querySelectorAll('[data-fw-links] a')].map(a=>[a.textContent,a.getAttribute('href'),a.target]),
      audio:[...document.querySelectorAll('#track-whodidtheshoot source')].map(x=>x.src),night:getComputedStyle(document.getElementById('pillars')).display,foot:!document.querySelector('[data-fw-foot]')||!document.querySelector('[data-fw-foot]').hidden}));
    check(scope,'his published page, run by the house engine with his settings',f.source==='member'&&f.t1==='HITMAN'&&f.title==='Benji Chase · McCluster'&&f.c.scroll.duration===1.2&&f.c.vr.hold===false&&f.c.vr.yaw===45,{source:f.source,t1:f.t1,title:f.title,scroll:f.c.scroll,vr:f.c.vr});
    check(scope,'his link opens in a new tab; his button 1 is his profile',f.links.some(l=>l[0]==='Instagram'&&l[1]==='https://instagram.com/hitmanbenji'&&l[2]==='_blank')&&/mnet\.html\?view=profile&handle=benji\.chase/.test(f.door1||''),f);
    check(scope,'his soundtrack is the page\'s track',f.audio.length===1&&f.audio[0].includes('/front-media/'+BENJI.id+'/sound-'),f.audio);
    check(scope,'no closing film: the night scene is off and his links are at the foot',f.night==='none'&&f.foot,f);
    const sizes=app.media.filter(k=>/\/films\//.test(k));
    check(scope,vp.width<1000?'the phone gets the phone-size frames':'the desktop gets the full-size frames',sizes.length>0&&sizes.every(k=>vp.width<1000?k.includes('/sm/'):!k.includes('/sm/')),sizes.slice(0,3));
    await page.screenshot({path:join(OUT,`visitor-hero-${vp.width}.png`)});
    await page.evaluate(()=>window.__MCC_FRONT_GOTO('cabin'));
    await page.waitForFunction(()=>window.__MCC_VR&&window.__MCC_VR.viewer,null,{timeout:20000}).catch(()=>{});
    const vr=await page.evaluate(()=>({viewer:!!(window.__MCC_VR&&window.__MCC_VR.viewer),spots:[...document.querySelectorAll("#workVR .vr360-spot")].map(a=>a.textContent.trim()),reads:0}));
    const roomRead=app.media.some(k=>k.startsWith(BENJI.id+'/cabin-'));
    check(scope,'his 360 room opens from his own photo, with his tag',vr.viewer&&roomRead&&vr.spots.some(t=>/My studio/.test(t)),{vr,roomRead});
    await page.waitForTimeout(800);
    await page.screenshot({path:join(OUT,`visitor-cabin-${vp.width}.png`)});
    check(scope,'no horizontal overflow at '+vp.width,(await overflow(page))===0,await overflow(page));
    check(scope,'no JavaScript errors',errors.length===0,errors);
    await app.ctx.close();
  }

  /* 5. THE DOORS: his card takes visitors into his page; his own card says Edit; a page that is not there says so */
  {
    const scope='doors';
    let app=await setup({width:390,height:844},VISITOR);
    await app.page.goto(BASE+'/member-front.html?handle=benji.chase',{waitUntil:'domcontentloaded'});
    await app.page.waitForURL(/front\.html\?u=benji\.chase/,{timeout:20000}).catch(()=>{});
    check(scope,'a signed-in visitor to his card is taken into his front page',/\/front\.html\?u=benji\.chase$/.test(app.page.url()),app.page.url());
    await app.page.goto(BASE+'/member-front.html?handle=benji.chase&card=1',{waitUntil:'domcontentloaded'});
    await app.page.waitForFunction(()=>!document.getElementById('mfFront').hidden,null,{timeout:20000}).catch(()=>{});
    const card=await app.page.evaluate(()=>({front:document.getElementById('mfFront').textContent,href:document.getElementById('mfFront').getAttribute('href'),build:document.getElementById('mfBuild').hidden,back:!document.getElementById('mfBack').hidden}));
    check(scope,'asking for the card keeps it, with the way in and the way back to their own page',/Enter Benji Chase’s front page/.test(card.front)&&card.href==='front.html?u=benji.chase'&&card.build&&card.back,card);
    check(scope,'no errors on the card',app.errors.length===0,app.errors);
    await app.ctx.close();

    app=await setup({width:390,height:844},null);
    await app.page.goto(BASE+'/member-front.html?handle=benji.chase',{waitUntil:'domcontentloaded'});
    await app.page.waitForURL(/front\.html\?u=benji\.chase/,{timeout:20000}).catch(()=>{});
    check(scope,'a signed-out visitor to his card is taken into his front page too (it is public)',/\/front\.html\?u=benji\.chase$/.test(app.page.url()),app.page.url());
    await app.ctx.close();

    app=await setup({width:390,height:844},BENJI);
    await app.page.goto(BASE+'/member-front.html?handle=benji.chase',{waitUntil:'domcontentloaded'});
    await app.page.waitForFunction(()=>!document.getElementById('mfFront').hidden,null,{timeout:20000}).catch(()=>{});
    const mine=await app.page.evaluate(()=>({url:location.pathname,front:document.getElementById('mfFront').textContent,build:document.getElementById('mfBuild').textContent,buildHref:document.getElementById('mfBuild').getAttribute('href'),buildShown:!document.getElementById('mfBuild').hidden}));
    check(scope,'on his own card he stays, with "My front page" and "Edit my front page"',/member-front\.html$/.test(mine.url)&&/My front page/.test(mine.front)&&/Edit my front page/.test(mine.build)&&/front-studio\.html/.test(mine.buildHref)&&mine.buildShown,mine);
    await app.ctx.close();

    /* his artist page: he gets his two editors there; anyone else does not */
    for(const [acct,mine] of [[BENJI,true],[VISITOR,false]]){
      app=await setup({width:390,height:844},acct);
      await app.page.goto(BASE+'/music-creator.html?handle=benji.chase',{waitUntil:'domcontentloaded'});
      await app.page.waitForSelector('#apDoors .creator-action-network',{timeout:30000}).catch(()=>{});
      if(mine)await app.page.waitForSelector('#apOwnerFront',{timeout:15000}).catch(()=>{});else await app.page.waitForTimeout(1500);
      const doors=await app.page.evaluate(()=>({front:(document.getElementById('apOwnerFront')||{}).getAttribute?.('href')||null,edit:(document.getElementById('apOwnerEdit')||{}).getAttribute?.('href')||null}));
      check(scope,mine?'on his artist page he gets "Edit my artist page" and "Build my front page"':'a visitor to his artist page gets neither',mine?doors.front==='front-studio.html'&&doors.edit==='creator.html?edit=profile':!doors.front&&!doors.edit,doors);
      check(scope,'no horizontal overflow on the artist page at 390 ('+(mine?'his':'a visitor')+')',(await overflow(app.page))===0,await overflow(app.page));
      await app.ctx.close();
    }

    app=await setup({width:390,height:844},null);
    await app.page.goto(BASE+'/front.html?u=nobody.here',{waitUntil:'domcontentloaded'});
    await app.page.waitForFunction(()=>document.documentElement.getAttribute('data-front-state')==='empty',null,{timeout:20000}).catch(()=>{});
    const empty=await app.page.evaluate(()=>({t:document.getElementById('frontEmptyTitle').textContent,links:[...document.querySelectorAll('#frontEmptyLinks a')].map(a=>a.getAttribute('href')),main:document.getElementById('top').hidden,engine:!!window.MCC_FRONT}));
    check(scope,'an account with no page: it says so plainly, links their card and the editor, starts no engine',/No front page yet/.test(empty.t)&&empty.links.includes('front-studio.html')&&empty.main&&!empty.engine,empty);
    check(scope,'no errors on the empty page, no overflow',app.errors.length===0&&(await overflow(app.page))===0,app.errors);
    await app.ctx.close();
  }

  /* 6. TAKEN DOWN BY HIM: visitors get no page; his draft stays */
  {
    const scope='take-down';const app=await setup({width:390,height:844},BENJI);const {page,errors}=app;
    await page.goto(BASE+'/front-studio.html',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#fsUnpublish:not([hidden])',{timeout:30000});
    await page.click('#fsUnpublish');
    await page.waitForFunction(()=>/Taken down/.test(window.__MCC_FRONT_STUDIO.msg),null,{timeout:15000}).catch(()=>{});
    const row=world.fronts.find(r=>r.handle==='benji.chase');
    check(scope,'"Take it down" unpublishes and keeps the draft',!row.published&&row.draft&&row.draft.words.title1==='HITMAN'&&await page.evaluate(()=>document.getElementById('fsUnpublish').hidden),row&&{published:row.published});
    const v=await setup({width:390,height:844},null);
    await v.page.goto(BASE+'/front.html?u=benji.chase',{waitUntil:'domcontentloaded'});
    await v.page.waitForFunction(()=>document.documentElement.getAttribute('data-front-state')==='empty',null,{timeout:20000}).catch(()=>{});
    check(scope,'a visitor now gets "No front page yet"',/No front page yet/.test(await v.page.textContent('#frontEmptyTitle')));
    check(scope,'no errors',errors.length===0&&v.errors.length===0,[errors,v.errors]);
    await v.ctx.close();await app.ctx.close();
  }
}finally{await browser.close();}
const failed=results.filter(r=>!r.pass);
console.log(`\n${results.length-failed.length}/${results.length} passed · screenshots in ${OUT}`);
process.exit(failed.length?1:0);
