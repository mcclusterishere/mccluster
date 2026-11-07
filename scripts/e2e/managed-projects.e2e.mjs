/* Integrated project browser fixtures: actual dashboard/editor/renderer and managed-projects handler.
   All auth, PostgREST, storage and third-party requests are intercepted. No live mutations.
   ROOT=<integrated checkout> PLAYWRIGHT_DIR=<node_modules> CHROMIUM_EXECUTABLE=<chromium>
   node scripts/e2e/managed-projects.e2e.mjs [outDir]
   Storage/auth fixture harness adapted from member-front.e2e.mjs. */
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=process.env.ROOT || fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/managed-project-proof';
const FIX=join(ROOT,'scripts/e2e/fixtures/front-media');
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const {handleManagedProjects}=await import(pathToFileURL(join(ROOT,'workers/mccluster/src/managed-projects.js')).href);
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
const world={projects:[],visibility:'public',calls:[],fronts:[],objects:new Map(),uploads:[],refused:[],reads:[]};
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
  if(u.pathname==='/rest/v1/network_profiles'){const a=ACCOUNTS.find(x=>x.m_uid===q('m_uid'));return json(a?[{display_name:a.name,avatar_url:'',headline:'Producer',visibility:world.visibility}]:[]);}
  if(u.pathname==='/rest/v1/managed_projects'){
    if(world.projectsUnavailable)return json({message:'fixture storage unavailable'},503);
    const match=r=>[...u.searchParams].every(([k,v])=>!v.startsWith('eq.')&&v!=='is.null'||(v==='is.null'?r[k]==null:r[k]===v.slice(3)));
    if(method==='POST'){const b=JSON.parse(init.body);if(world.projects.some(r=>r.slug===b.slug))return json({code:'23505'},409);const r={published:null,published_at:null,removed_at:null,...b};world.projects.push(r);return json([r],201);}
    const rows=world.projects.filter(match);if(method==='PATCH')for(const r of rows)Object.assign(r,JSON.parse(init.body));return json(rows);
  }
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

async function setup(viewport,account,{holdReload=false}={}){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true});
  const errors=[],media=[];
  await ctx.addInitScript(({account})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(!account || sessionStorage.getItem('fixture-seeded'))return; sessionStorage.setItem('fixture-seeded','1');
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:account.id,email:account.handle+'@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:account.id,email:account.handle+'@fixture.invalid'}}));
  },{account});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    if(u.origin==='https://api.mccluster.org'){
      if(p==='/v1/customer-site/media'&&req.method()==='POST'){
        // Browser transport fixture only; authoritative quota/concurrency is tested in Worker/SQL suites.
        const a=who(req.headers().authorization),path=u.searchParams.get('path')||'';
        if(!a||!path.startsWith(a.id+'/projects/second-project/'))return json(route,{error:'Not your upload'},403);
        const body=req.postDataBuffer()||world.pickedImage||await readFile(join(FIX,'notround.jpg'));
        world.objects.set(path,{type:req.headers()['content-type'],body});world.uploads.push(path);
        return json(route,{ok:true});
      }
      if(p.startsWith('/v1/projects') || p.startsWith('/v1/fronts')){
        world.calls.push({path:p,method:req.method()});
        /* the real Worker route, over the in-memory database */
        const headers=new Headers(req.headers());headers.set('origin',BASE);
        const body=['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()||undefined;
        const res=await handleManagedProjects(new Request(req.url(),{method:req.method(),headers,body}),ENV,{fetchImpl:supabase});
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
      if(holdReload && rel==='js/front-studio.js') {
        // Suppress only navigation in this regression context so a stale callback
        // can run in the old document. Normal account-switch test reloads for real.
        const source=(await readFile(file,'utf8')).replaceAll('location.reload()', 'window.__fixtureReloadRequested = true');
        return route.fulfill({body:source,contentType:'text/javascript'});
      }
      try{return route.fulfill({body:await readFile(file),contentType:TYPES[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page,errors,media};
}
// Readiness is asserted by each journey below. Background films and embeds are
// not navigation readiness: waiting for full load can hang on media on CI.
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

try {
 const app=await setup({width:390,height:844},BENJI), {page}=app;
 await page.goto(BASE+'/customer-projects.html',{waitUntil:'domcontentloaded'});
 await page.fill('#projectName','First Project');await page.fill('#projectSlug','first-project');
 await Promise.all([page.waitForURL('**/project-studio.html?project=first-project'),page.click('#projectCreate button')]);
 await page.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.state==='ready');
 check('create','creates separate project and opens its real editor',world.projects.length===1&&world.projects[0].owner_user_id===BENJI.id);
 await page.fill('[name="words.eyebrow"]','Private project draft');
 await page.click('[data-act="save"]');await page.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.msg==='Draft saved.');
 check('draft','saves through project endpoint only',world.projects[0].draft.words.eyebrow==='Private project draft'&&!world.projects[0].published&&!world.calls.some(c=>c.path.startsWith('/v1/fronts')));
 const visitor=await setup({width:390,height:844},null);
 await visitor.page.goto(BASE+'/front.html?project=first-project',{waitUntil:'domcontentloaded'});
 await visitor.page.waitForFunction(()=>document.documentElement.getAttribute('data-front-state')!=='loading');
 check('draft','public renderer cannot read private draft',await visitor.page.getAttribute('html','data-front-state')!=='ready');
 await previewReady(page);
 check('preview','same-origin draft preview uses project words',await previewFrame(page).locator('[data-fw="eyebrow"]').first().textContent()==='Private project draft');
 const second=await app.ctx.newPage();await second.goto(BASE+'/customer-projects.html',{waitUntil:'domcontentloaded'});
 await second.fill('#projectName','Second Project');await second.fill('#projectSlug','second-project');
 await Promise.all([second.waitForURL('**/project-studio.html?project=second-project'),second.click('#projectCreate button')]);
 await second.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.state==='ready');await second.close();
 check('create','one account owns two independent project rows',world.projects.length===2&&world.projects.every(p=>p.owner_user_id===BENJI.id));
 // Seed unrelated files, then let the real editor cleanup delete only its own orphan.
 const prefix=BENJI.id+'/projects/first-project/';
 const objects=[BENJI.id+'/personal.jpg',BENJI.id+'/projects/second-project/other.jpg',prefix+'orphan.jpg'];
 for(const k of objects)world.objects.set(k,{type:'image/jpeg',body:Buffer.from('fixture')});
 const cleanupResponse=page.waitForResponse(r=>r.url()===SB+'/storage/v1/object/front-media'&&r.request().method()==='DELETE');
 await page.click('[data-act="publish"]');
 await page.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.msg.startsWith('Published.'));
 await cleanupResponse; // Cleanup is asynchronous after publication; assert its completed effect, not a 200ms guess.
 check('cleanup','cleanup preserves personal and same-owner other project files',world.objects.has(objects[0])&&world.objects.has(objects[1])&&!world.objects.has(objects[2]),world.removed);
 await visitor.page.reload({waitUntil:'domcontentloaded'});await visitor.page.waitForFunction(()=>document.documentElement.getAttribute('data-front-state')==='ready');
 check('publish','real public renderer shows published words',await visitor.page.locator('[data-fw="eyebrow"]').first().textContent()==='Private project draft');
 check('responsive','editor has no 390px overflow',await overflow(page)===0);
 await page.screenshot({path:join(OUT,'project-editor-phone.png'),fullPage:true});
 await visitor.page.screenshot({path:join(OUT,'project-public-phone.png'),fullPage:true});
 // The basic offers layout uses this same owner editor/publisher without Studio processing.
 const offerEditor=await app.ctx.newPage();await offerEditor.goto(BASE+'/project-studio.html?project=second-project&template=offers',{waitUntil:'domcontentloaded'});
 await offerEditor.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.draft?.layout==='offers');
 await offerEditor.click('[data-act="offer-example"]');await offerEditor.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.draft?.offer_page?.cards?.length===3&&!window.__MCC_FRONT_STUDIO.saving);
 await offerEditor.fill('[name="offer_page.title"]','<img src=x onerror=alert(1)> Our offers');
 await offerEditor.fill('[name="offer_page.cards.0.experiences.0.title"]','Build together');
 await uploadInto(offerEditor,'offer0','notround.jpg');
 check('offers','ordinary image upload uses the website media endpoint',world.uploads.some(p=>p.startsWith(BENJI.id+'/projects/second-project/still-')));
 await offerEditor.click('[data-act="save"]');await offerEditor.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.msg==='Draft saved.');
 const imageUrl=world.projects[1].draft.offer_page.cards[0].image;
 check('offers','saved image survives orphan cleanup',!!imageUrl&&world.objects.has(imageUrl.split('/front-media/')[1]));
 const reloadEvents=[];
 offerEditor.on('framenavigated',frame=>{reloadEvents.push({event:'navigate',main:frame===offerEditor.mainFrame(),url:frame.url()});if(reloadEvents.length>30)reloadEvents.shift();});
 offerEditor.on('requestfailed',request=>{reloadEvents.push({event:'requestfailed',url:request.url(),error:request.failure()?.errorText});if(reloadEvents.length>30)reloadEvents.shift();});
 try{await offerEditor.reload({waitUntil:'domcontentloaded'});}catch(error){console.error('OFFER_EDITOR_RELOAD',JSON.stringify({events:reloadEvents,url:offerEditor.url()}));throw error;}
 await offerEditor.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.state==='ready');
 check('offers','saved text and nine experiences recover on reload',(await studio(offerEditor)).draft.offer_page.cards.reduce((n,c)=>n+c.experiences.length,0)===9);
 await offerEditor.click('[data-act="publish"]');await offerEditor.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.msg.startsWith('Published.'));
 const offerPublic=await visitor.ctx.newPage();await offerPublic.goto(BASE+'/front.html?project=second-project',{waitUntil:'domcontentloaded'});await offerPublic.waitForFunction(()=>document.documentElement.dataset.frontState==='ready');
 check('offers','published HTML-like title stays literal text without creating elements',await offerPublic.locator('.so-hero h1').textContent()==='<img src=x onerror=alert(1)> Our offers'&&await offerPublic.locator('.so-hero img').count()===0);
 check('offers','nine experiences render through the ordinary public front',await offerPublic.locator('.so-experiences li').count()===9&&await offerPublic.locator('.so-experiences strong').first().textContent()==='Build together. ');
 check('offers','management goes to canonical owner editor without credentials',await offerPublic.locator('.so-manage').getAttribute('href')===BASE+'/project-studio.html?project=second-project');
 for(const width of [390,1440]){await offerPublic.setViewportSize({width,height:900});check('offers','published layout has no '+width+'px overflow',await overflow(offerPublic)===0);await offerPublic.screenshot({path:join(OUT,'offers-public-'+width+'.png'),fullPage:true});}
 // Keep adversarial evidence above; prepare a clean ordinary-owner template for visual review.
 await offerEditor.click('[data-act="offer-example"]');await offerEditor.waitForFunction(()=>!window.__MCC_FRONT_STUDIO.saving&&window.__MCC_FRONT_STUDIO.draft.offer_page.title==='Build something people belong to.');
 await offerEditor.click('[data-act="publish"]');await offerEditor.waitForFunction(()=>window.__MCC_FRONT_STUDIO.msg.startsWith('Published.'));
 world.projects[1].name='Equity Uprise fixture';
 world.pickedImage=await readFile(join(ROOT,'assets/img/equity-uprise-mark-white.png'));
 await offerEditor.setInputFiles('[data-upload="offer-logo"]',{name:'equity-uprise-mark-white.png',mimeType:'image/png',buffer:world.pickedImage});
 await offerEditor.waitForFunction(()=>!window.__MCC_FRONT_STUDIO.busy['offer-logo']&&!!window.__MCC_FRONT_STUDIO.draft.offer_page.logo);
 await offerEditor.waitForFunction(()=>document.getElementById('fsFrame')?.contentDocument?.querySelector('.so-logo')?.complete);
 check('offers-logo','owner preview loads the actual supplied logo upload',await previewFrame(offerEditor).locator('.so-logo').evaluate(img=>img.naturalWidth>0));
 await offerEditor.click('[data-act="publish"]');await offerEditor.waitForFunction(()=>window.__MCC_FRONT_STUDIO.msg.startsWith('Published.'));
 const logoUrl=world.projects[1].published.offer_page.logo;
 check('offers-logo','published logo bytes survive owner cleanup',world.objects.has(logoUrl.split('/front-media/')[1]));
 await offerPublic.reload({waitUntil:'domcontentloaded'});await offerPublic.waitForFunction(()=>document.documentElement.dataset.frontLayout==='offers');
 await offerPublic.waitForFunction(()=>document.querySelector('.so-logo')?.complete&&document.querySelector('[data-appnav="home"] img')?.complete);
 check('offers-logo','published page and contextual navigation use the owned logo',await offerPublic.locator('.so-logo').getAttribute('src')===logoUrl&&await offerPublic.locator('[data-appnav="home"] img').getAttribute('src')===logoUrl);
 await offerPublic.goto(BASE+'/front.html?project=first-project',{waitUntil:'domcontentloaded'});await offerPublic.waitForFunction(()=>document.documentElement.dataset.frontState==='ready');
 check('offers-logo','switching tenant clears previous logo',await offerPublic.locator('[data-appnav="home"] img').count()===0);
 await offerPublic.goto(BASE+'/front.html?project=second-project',{waitUntil:'domcontentloaded'});await offerPublic.waitForFunction(()=>document.documentElement.dataset.frontLayout==='offers');
 for(const width of [390,1440]){
  await offerPublic.setViewportSize({width,height:900});
  const cards=offerPublic.locator('.so-card');
  for(let i=0;i<3;i++){
   await cards.nth(i).scrollIntoViewIfNeeded();
   check('offers-visual','card '+i+' at '+width+' is visible with all three experiences',await cards.nth(i).isVisible()&&await cards.nth(i).locator('.so-experiences li').count()===3);
   await cards.nth(i).screenshot({path:join(OUT,'equity-card-'+i+'-'+width+'.png')});
  }
  await offerPublic.evaluate(()=>window.scrollTo(0,0));await offerPublic.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  check('offers-visual','owned template has a readable dark background at '+width,await offerPublic.evaluate(()=>getComputedStyle(document.body).backgroundColor)==='rgb(17, 21, 20)');
  await offerPublic.evaluate(()=>window.scrollTo(0,950));await offerPublic.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await offerPublic.screenshot({path:join(OUT,'equity-middle-'+width+'.png')});
  await writeFile(join(OUT,'equity-layout-'+width+'.json'),JSON.stringify(await offerPublic.evaluate(()=>({transition:!!document.activeViewTransition,at:scrollY,hit:document.elementFromPoint(100,100)?.outerHTML,root:{rect:document.documentElement.getBoundingClientRect().toJSON(),height:getComputedStyle(document.documentElement).height,background:getComputedStyle(document.documentElement).backgroundColor},body:{rect:document.body.getBoundingClientRect().toJSON(),height:getComputedStyle(document.body).height},cards:[...document.querySelectorAll('.so-card')].map(c=>({rect:c.getBoundingClientRect().toJSON(),visibility:getComputedStyle(c).visibility}))})),null,2));
  await offerPublic.evaluate(()=>window.scrollTo(0,0));await offerPublic.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await offerPublic.screenshot({path:join(OUT,'equity-top-'+width+'.png')});
  await offerPublic.screenshot({path:join(OUT,'equity-owned-'+width+'.png'),fullPage:true});
 }
 await offerEditor.screenshot({path:join(OUT,'offers-editor-phone.png'),fullPage:true});
 await offerEditor.close();await offerPublic.close();
 world.visibility='private';await visitor.page.reload({waitUntil:'domcontentloaded'});await visitor.page.waitForFunction(()=>document.documentElement.getAttribute('data-front-state')!=='loading');
 check('privacy','making owner profile private hides saved publication',await visitor.page.getAttribute('html','data-front-state')!=='ready');
 world.visibility='public';
 page.once('dialog',d=>d.accept());await page.click('[data-act="unpublish"]');await page.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.msg==='Taken down. Your draft is kept.');
 await visitor.page.reload({waitUntil:'domcontentloaded'});await visitor.page.waitForFunction(()=>document.documentElement.getAttribute('data-front-state')!=='loading');
 check('unpublish','take down keeps draft and removes public page',!!world.projects[0].draft&&!world.projects[0].published&&await visitor.page.getAttribute('html','data-front-state')!=='ready');
 await page.fill('[name="words.eyebrow"]','UNSAVED ALICE SECRET');
 // The real auth handler clears the old document synchronously and then reloads.
 // Wait for that navigation before starting the unrelated invalid-slug journey;
 // observing the cleared old state alone races its scheduled reload on CI.
 await Promise.all([
   page.waitForNavigation({waitUntil:'domcontentloaded'}),
   page.evaluate(a=>{const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:a.id})).replace(/=+$/,'')+'.y',expires_at:exp,user:{id:a.id}}));window.dispatchEvent(new Event('mcc:auth-changed'));},VISITOR)
 ]);
 await page.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.state==='off'||window.__MCC_FRONT_STUDIO?.state==='error');
 check('account-switch','reload clears old draft and new account cannot edit project',!(await page.textContent('body')).includes('UNSAVED ALICE SECRET')&&!await page.evaluate(()=>window.__MCC_FRONT_STUDIO?.draft));
 const before=world.calls.length;
 await page.goto(BASE+'/project-studio.html?project=../../bad',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.state==='error');
 check('invalid','invalid project slug fails closed without personal API requests',world.calls.length===before);
 check('isolation','no personal front writes during entire flow',!world.calls.some(c=>c.path.startsWith('/v1/fronts')&&c.method!=='GET')&&world.fronts.length===0);
 // Keep the old document alive during its reload to exercise the epoch guard,
 // rather than relying on navigation destroying a late response callback.
 for(const mode of ['reject','stall']) {
   const authCase=await setup({width:390,height:844},BENJI,{holdReload:true}), p=authCase.page;
   await p.goto(BASE+'/project-studio.html?project=first-project',{waitUntil:'domcontentloaded'});
   await p.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.state==='ready');
   await p.fill('[name="words.eyebrow"]','OLD PRIVATE '+mode);
   await p.evaluate(()=>{
     const original=window.fetch.bind(window);
     window.fetch=async function(url,init){
       const response=await original(url,init);
       if(String(url).endsWith('/v1/projects/first-project/edit') && init?.method==='POST') {
         return new Promise(resolve=>{window.releaseOldProjectResponse=()=>resolve(response);});
       }
       return response;
     };
   });
   await p.click('[data-act="save"]');
   await p.waitForFunction(()=>typeof window.releaseOldProjectResponse==='function');
   const immediate=await p.evaluate(mode=>{
     window.MCC_SUPA.token=()=>mode==='reject' ? Promise.reject(new Error('Token unavailable')) : new Promise(()=>{});
     window.dispatchEvent(new Event('mcc:auth-changed'));
     const state=window.__MCC_FRONT_STUDIO;
     return {draft:state.draft,me:state.me,frame:state.frame,dirty:state.dirty,text:document.body.textContent,iframe:!!document.getElementById('fsFrame'),reloadRequested:window.__fixtureReloadRequested};
   },mode);
   check('auth-'+mode,'auth event immediately clears private state without waiting for token',!immediate.draft&&!immediate.me&&!immediate.frame&&!immediate.dirty&&!immediate.iframe&&immediate.reloadRequested&&!immediate.text.includes('OLD PRIVATE'),immediate);
   await p.evaluate(()=>window.releaseOldProjectResponse());
   await p.waitForTimeout(100);
   const late=await p.evaluate(()=>({draft:window.__MCC_FRONT_STUDIO.draft,me:window.__MCC_FRONT_STUDIO.me,text:document.body.textContent}));
   check('auth-'+mode,'late old-account save response cannot restore draft',!late.draft&&!late.me&&!late.text.includes('OLD PRIVATE'),late);
   await authCase.ctx.close();
 }
 // Synthetic rows only: no Vaunt seed, real user or production provisioning.
 const vaunt=await setup({width:390,height:844},null), vp=vaunt.page;
 const readyProject=async()=>vp.waitForFunction(()=>document.documentElement.dataset.frontState==='ready'&&!!window.MCC_FRONT);
 const mediaContract=async p=>p.evaluate(()=>{
   const m=window.MCC_FRONT?.config.media;
   return m?.scene1?.prefix==='vauntlive_'&&m?.scene2?.prefix==='vaunt_'&&m?.cabin?.src==='assets/video/vaunt-360.mp4'&&m?.sound?.src==='assets/audio/who-did-the-shoot.mp3';
 });
 await vp.goto(BASE+'/front.html?project=vaunt',{waitUntil:'domcontentloaded'});await readyProject();
 check('vaunt','explicit project_not_found uses frozen static registry',await mediaContract(vp)&&await vp.getAttribute('html','data-front-project')==='vaunt');
 const registryConfig={words:{eyebrow:'Owner edited Vaunt words'},media:{cabin:{kind:'video',src:SB+'/storage/v1/object/public/front-media/'+BENJI.id+'/projects/vaunt/replacement.mp4'}}};
 const registryRow={slug:'vaunt',name:'Vaunt managed fixture',owner_user_id:BENJI.id,m_uid:BENJI.m_uid,registry_key:'vaunt',draft:registryConfig,published:registryConfig,published_at:new Date().toISOString(),removed_at:null};
 world.projects.push(registryRow);
 await vp.reload({waitUntil:'domcontentloaded'});await readyProject();
 check('vaunt','managed words merge while registry scene media stays immutable',(await vp.locator('[data-fw="eyebrow"]').first().textContent())==='Owner edited Vaunt words'&&await mediaContract(vp));
 check('vaunt','managed registry retains album and shared World footer',await vp.locator('a[href="album.html?album=vaunt-ep"]').count()>0&&await vp.locator('[data-profile-world]').count()>0&&await vp.locator('[data-world-entry]').count()>0);
 world.visibility='private';await vp.reload({waitUntil:'domcontentloaded'});await vp.waitForFunction(()=>document.documentElement.dataset.frontState==='empty');
 check('vaunt','private bound project never falls back to static',!await vp.evaluate(()=>window.MCC_FRONT_SOURCE));
 const privateEditor=await setup({width:390,height:844},BENJI);
 await privateEditor.page.goto(BASE+'/project-studio.html?project=vaunt',{waitUntil:'domcontentloaded'});await privateEditor.page.waitForFunction(()=>window.__MCC_FRONT_STUDIO?.state==='ready');await previewReady(privateEditor.page);
 const privatePreview=previewFrame(privateEditor.page);
 check('vaunt','private owner preview carries registry binding and immutable media',await mediaContract(privatePreview)&&(await privatePreview.locator('[data-fw="eyebrow"]').first().textContent())==='Owner edited Vaunt words');
 await privateEditor.ctx.close();world.visibility='public';
 // Independent negative responses use new visitor contexts. They must fail closed
 // on first visit, without depending on the earlier page's loaded registry/media.
 // Same-page publication/privacy transitions are exercised above.
 for (const condition of ['removed','unpublished','storage 503']) {
   registryRow.removed_at=condition==='removed'?new Date().toISOString():null;
   registryRow.published=condition==='unpublished'?null:registryConfig;
   registryRow.published_at=registryRow.published?new Date().toISOString():null;
   world.projectsUnavailable=condition==='storage 503';
   const negative=await setup({width:390,height:844},null);
   await negative.page.goto(BASE+'/front.html?project=vaunt',{waitUntil:'domcontentloaded'});
   await negative.page.waitForFunction(()=>document.documentElement.dataset.frontState==='empty');
   check('vaunt',condition+' never falls back to static',!await negative.page.evaluate(()=>window.MCC_FRONT_SOURCE)&&negative.errors.length===0,negative.errors);
   await negative.ctx.close();
 }
 world.projectsUnavailable=false;
 check('vaunt','registry public and private preview produce no uncaught errors',vaunt.errors.length===0&&privateEditor.errors.length===0,{public:vaunt.errors,preview:privateEditor.errors});
 await vaunt.ctx.close();
 check('runtime','editor and public renderer have no uncaught errors',app.errors.length===0&&visitor.errors.length===0,{editor:app.errors,public:visitor.errors});
 await app.ctx.close();await visitor.ctx.close();
 const failed=results.filter(r=>!r.pass);if(failed.length)throw new Error(failed.length+' failed browser checks');
 console.log('PASS '+results.length+'/'+results.length+' managed project integrated browser checks');
} finally {await browser.close();}
