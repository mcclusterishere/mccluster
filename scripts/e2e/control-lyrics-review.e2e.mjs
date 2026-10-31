/* Control → Create → Music → Lyrics: the owner checks what the lyric machine made, at phone width first.
   Real control.html + js/control-room/lyrics-review.js + js/lyrics-sync.js from this checkout; every network call
   is a fixture (no Supabase, no Worker). Audio is a silent WAV of the track's length.
     - a shelf track (Hundun): flagged lines marked, the playhead lights its line, words and times edited,
       marked reviewed, the corrected file downloads and passes the lyrics schema;
     - an uploaded release: loads through music-access operator-lyrics-get, saves through operator-lyrics-save
       with reviewed:true, re-runs through operator-lyrics-queue;
     - not the house operator: the music service refuses, and the screen says so instead of pretending.
   PLAYWRIGHT_DIR=<node_modules> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/control-lyrics-review.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/control-lyrics-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const {validateLyrics}=await import(pathToFileURL(join(ROOT,'core/src/lyrics/align.mjs')).href);
const BASE='https://matthew.mccluster.org';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const OWNER='11111111-1111-4111-8111-111111111111';
const UPLOAD='22222222-2222-4222-8222-222222222222';
const results=[];
function check(scope,name,ok,detail){results.push({scope,name,pass:!!ok});console.log((ok?'PASS ':'FAIL ')+'['+scope+'] '+name+(ok?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});
function silentWav(seconds){const n=Math.ceil(seconds*8000),b=Buffer.alloc(44+n,128);b.write('RIFF',0);b.writeUInt32LE(36+n,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(8000,28);b.writeUInt16LE(1,32);b.writeUInt16LE(8,34);b.write('data',36);b.writeUInt32LE(n,40);return b;}
const WAV=silentWav(150);
function serveWav(route,req){const m=/bytes=(\d+)-(\d*)/.exec(req.headers().range||'');if(!m)return route.fulfill({status:200,contentType:'audio/wav',headers:{'accept-ranges':'bytes','access-control-allow-origin':'*'},body:WAV});const a=+m[1],b=m[2]?Math.min(+m[2],WAV.length-1):WAV.length-1;return route.fulfill({status:206,contentType:'audio/wav',headers:{'accept-ranges':'bytes','content-range':`bytes ${a}-${b}/${WAV.length}`,'access-control-allow-origin':'*'},body:WAV.subarray(a,b+1)});}
const HUNDUN=JSON.parse(await readFile(join(ROOT,'data/lyrics/hundun-b-side.json'),'utf8'));
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required','--mute-audio']});

async function setup(viewport,{owner=true}={}){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,serviceWorkers:'block',acceptDownloads:true});
  const db={calls:[]},errors=[];
  await ctx.addInitScript(({OWNER})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:OWNER,email:'owner@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:OWNER,email:'owner@fixture.invalid'}}));
  },{OWNER});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.origin==='https://api.mccluster.org'){
      if(p==='/v1/status')return owner?json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}}):json(route,{error:'Forbidden'},403);
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:OWNER},default_org_id:'o1',workspaces:[{org_id:'o1',slug:'mccluster',kind:'studio',role:'owner',enabled:true,name:'McCluster'}]});
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.hostname==='fixture-storage.invalid')return serveWav(route,req);
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/user')return json(route,{id:OWNER,email:'owner@fixture.invalid'});
      if(p==='/functions/v1/music-access'){
        const b=req.postDataJSON()||{};db.calls.push(b);
        if(!owner)return json(route,{error:'operator permission required'},403);
        if(b.action==='operator-dashboard')return json(route,{ok:true,tracks:[{id:UPLOAD,title:'Fixture Upload',artist:'A Creator',status:'pending_review',m_uid:'m1'}],creators:[],offers:[]});
        if(b.action==='operator-lyrics-get'){
          /* the slow release: answers late, with a different three-line file */
          if(db.slow){db.slow=false;await new Promise(r=>setTimeout(r,1500));return json(route,{ok:true,track_id:UPLOAD,title:'Fixture Upload',lyrics:{...HUNDUN,source:'auto',timed:{line:HUNDUN.timed.line.slice(0,3)}},listen_url:'https://fixture-storage.invalid/master.wav'});}
          return json(route,{ok:true,track_id:UPLOAD,title:'Fixture Upload',lyrics:{...HUNDUN,source:'auto'},listen_url:'https://fixture-storage.invalid/master.wav'});
        }
        if(b.action==='operator-lyrics-save')return json(route,{ok:true,track_id:b.track_id,reviewed:b.reviewed===true});
        if(b.action==='operator-lyrics-queue')return json(route,{ok:true,queued:true,job_id:'j1'});
        return json(route,{ok:true});
      }
      return json(route,[]);
    }
    if(u.origin===BASE){
      const rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));
      if(/^assets\/audio\//.test(rel))return serveWav(route,req);
      if(/\.(mp4|webm)$/i.test(rel))return route.fulfill({status:404,body:''});
      const file=resolve(ROOT,rel);if(!file.startsWith(resolve(ROOT)+sep))return route.abort();
      try{return route.fulfill({body:await readFile(file),contentType:TYPES[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page,db,errors};
}
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
async function openLyrics(page){
  await page.goto(`${BASE}/control.html#create:music`,{waitUntil:'domcontentloaded'});
  const tab=page.locator('[data-crom-section="lyrics"]');
  await tab.waitFor({timeout:30000});await tab.click();
  await page.locator('[data-crl-pick]').waitFor({timeout:15000});
  await page.waitForFunction(()=>document.querySelectorAll('[data-crl-pick] option').length>5,null,{timeout:15000});
}

/* ---- the owner, at 390px ---- */
{
  const {ctx,page,db,errors}=await setup({width:390,height:844});
  await openLyrics(page);
  check('390','the Lyrics tab lists shelf tracks and uploads',await page.locator('[data-crl-pick] option',{hasText:'Hundun (B-Side)'}).count()===1&&await page.locator('[data-crl-pick] option',{hasText:'Fixture Upload'}).count()===1,{});
  await page.selectOption('[data-crl-pick]',{label:'Hundun (B-Side) — Whip Equipped'});
  await page.locator('.crl-line').first().waitFor({timeout:15000});
  const n=await page.locator('.crl-line').count();
  check('390',`every line is editable (${HUNDUN.timed.line.length})`,n===HUNDUN.timed.line.length,{n});
  const flagged=HUNDUN.timed.line.filter(l=>l.mismatch).length;
  check('390',`flagged lines are marked (${flagged})`,await page.locator('.crl-line.is-flag').count()===flagged,{});
  check('390','says it needs the owner\'s check',/Needs your check/.test(await page.locator('.crl-status').innerText()),{});
  await page.locator('[data-crl-filter="flag"]').click();
  check('390','Flagged shows only flagged lines',await page.locator('.crl-line:not([hidden])').count()===flagged,{});
  await page.locator('[data-crl-filter="all"]').click();
  /* the playhead lights its line */
  await page.waitForFunction(()=>{const a=document.querySelector('.crl-audio');return a&&isFinite(a.duration)&&a.duration>0;},null,{timeout:15000});
  const L=HUNDUN.timed.line[10];
  await page.evaluate(t=>new Promise(r=>{const a=document.querySelector('.crl-audio');a.addEventListener('seeked',()=>setTimeout(r,120),{once:true});a.currentTime=t;}),L.begin+0.01);
  check('390','the line being played is lit',await page.locator('.crl-line.is-live').getAttribute('data-i')==='10',{});
  /* fix the words of a flagged line, nudge its start, stamp another to the playhead */
  const fi=HUNDUN.timed.line.findIndex(l=>l.mismatch&&l.begin>1);
  const input=page.locator(`[data-crl-text="${fi}"]`);
  await input.fill('First get yo monyon then stack a hundun');await input.press('Enter');await input.blur();
  check('390','an edited line stops being flagged',!(await page.locator(`.crl-line[data-i="${fi}"]`).getAttribute('class')).includes('is-flag'),{});
  await page.locator(`[data-crl-nudge="0.1"][data-i="${fi}"]`).click();
  const shown=await page.locator(`[data-crl-seek="${fi}"]`).innerText();
  check('390','+ nudges the start by a tenth',shown.includes((Math.round((HUNDUN.timed.line[fi].begin+0.1)*100)/100).toFixed(2).replace(/^\d+\./,'')),{shown,was:HUNDUN.timed.line[fi].begin});
  await page.locator('[data-crl-reviewed]').check();
  check('390','no sideways scroll',(await overflow(page))===0,{});
  const fonts=await page.evaluate(()=>[...document.querySelectorAll('.crl-text,[data-crl-pick]')].map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(f=>f<16).length);
  check('390','form controls are at least 16px (no iOS zoom)',fonts===0,{fonts});
  await page.screenshot({path:join(OUT,'control-lyrics-390.png')});
  const [dl]=await Promise.all([page.waitForEvent('download'),page.locator('[data-crl-download]').click()]);
  const out=JSON.parse(await readFile(await dl.path(),'utf8'));
  check('390','downloads <slug>.json',dl.suggestedFilename()==='hundun-b-side.json',{name:dl.suggestedFilename()});
  check('390','the corrected file is marked reviewed and keeps the machine record',out.reviewed===true&&!!out.reviewed_at&&out.source==='aligned'&&!!out.machine,{reviewed:out.reviewed});
  check('390','the edit is in it, words and all',out.timed.line[fi].content==='First get yo monyon then stack a hundun'&&out.timed.line[fi].words.map(w=>w.content).join(' ')===out.timed.line[fi].content,out.timed.line[fi]);
  check('390','it passes the lyrics schema',validateLyrics(out,{duration:143}).length===0,validateLyrics(out,{duration:143}));
  /* an upload: load, save, re-run */
  await page.selectOption('[data-crl-pick]',{label:'Fixture Upload — A Creator (upload)'});
  await page.locator('[data-crl-save]').waitFor({timeout:15000});
  await page.locator('[data-crl-reviewed]').check();
  await page.locator('[data-crl-save]').click();
  await page.waitForFunction(()=>/Saved/.test(document.querySelector('.crl-msg').textContent),null,{timeout:10000});
  const save=db.calls.find(c=>c.action==='operator-lyrics-save');
  check('upload','saves through music-access with reviewed:true',save&&save.track_id===UPLOAD&&save.reviewed===true&&save.lyrics.reviewed===true&&save.lyrics.timed.line.length===HUNDUN.timed.line.length,{save:!!save});
  await page.locator('[data-crl-queue]').click();
  await page.waitForFunction(()=>/Queued on McCluster Core/.test(document.querySelector('.crl-msg').textContent),null,{timeout:10000});
  check('upload','re-run queues the machine on Core',db.calls.some(c=>c.action==='operator-lyrics-queue'&&c.track_id===UPLOAD),{});
  check('upload','no sideways scroll',(await overflow(page))===0,{});
  /* a late answer for a track that is no longer selected is dropped (review finding, PR #684) */
  db.slow=true;
  await page.selectOption('[data-crl-pick]',{label:'Fixture Upload — A Creator (upload)'});
  await page.selectOption('[data-crl-pick]',{label:'Hundun (B-Side) — Whip Equipped'});
  await page.waitForTimeout(2500);
  const after=await page.evaluate(()=>({lines:document.querySelectorAll('.crl-line').length,save:!!document.querySelector('[data-crl-save]'),dl:!!document.querySelector('[data-crl-download]'),key:window.CR.lyricsReview.state.key,doc:window.CR.lyricsReview.state.doc&&window.CR.lyricsReview.state.doc.timed.line.length}));
  check('race','switching A→B mid-load: B stays selected with B\'s lyrics, A\'s late answer is dropped',after.key.startsWith('shelf:')&&after.lines===HUNDUN.timed.line.length&&after.doc===HUNDUN.timed.line.length&&after.dl&&!after.save,after);
  check('390','no page errors',errors.length===0,errors.slice(0,5));
  await ctx.close();
}
/* ---- desktop gets room, loses nothing ---- */
{
  const {ctx,page,errors}=await setup({width:1280,height:900});
  await openLyrics(page);
  await page.selectOption('[data-crl-pick]',{label:'Hundun (B-Side) — Whip Equipped'});
  await page.locator('.crl-line').first().waitFor({timeout:15000});
  check('desktop','the same lines and controls',await page.locator('.crl-line').count()===HUNDUN.timed.line.length&&await page.locator('[data-crl-download]').count()===1,{});
  check('desktop','no sideways scroll',(await overflow(page))===0,{});
  await page.screenshot({path:join(OUT,'control-lyrics-desktop.png')});
  check('desktop','no page errors',errors.length===0,errors.slice(0,5));
  await ctx.close();
}
/* ---- not the house operator ---- */
{
  const {ctx,page,db}=await setup({width:390,height:844},{owner:false});
  await page.goto(`${BASE}/control.html#create:music`,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);
  const tab=await page.locator('[data-crom-section="lyrics"]').count();
  if(tab){
    await page.locator('[data-crom-section="lyrics"]').click();
    await page.locator('[data-crl-pick]').waitFor({timeout:15000}).catch(()=>{});
  }
  const gotLyrics=db.calls.filter(c=>c.action==='operator-lyrics-get'||c.action==='operator-lyrics-save').length;
  check('non-owner','no upload lyrics are read or written for a non-operator',gotLyrics===0,{gotLyrics});
  const uploads=tab?await page.locator('[data-crl-pick] option',{hasText:'(upload)'}).count():0;
  check('non-owner','no creator uploads are offered (the music service refused the operator dashboard)',uploads===0,{uploads});
  await ctx.close();
}
await browser.close();
const failed=results.filter(r=>!r.pass);
console.log(`\n${results.length-failed.length}/${results.length} checks passed`);
process.exit(failed.length?1:0);
