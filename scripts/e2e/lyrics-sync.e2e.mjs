/* Timed lyrics in the real players, for EVERY track on the shelf that has lyrics.
   Owner, 2026-10-31: "it wasn't working, so you need to put it together with every single song that has lyrics."

   Real album.html / music-videos.html and js/lyrics-sync.js from this checkout; the audio is a synthetic
   silent WAV of the track's length (so the browser's codec set does not matter), every other network call
   a fixture. For each track: open its album, play it, open the record (the now sheet), put the playhead on
   lines from the JSON and assert the lit line is that line; where the file has word times, assert the sung
   words light to the right word; tap a line and the song jumps there. Then 390px: no sideways scroll.

   PLAYWRIGHT_DIR=<node_modules> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/lyrics-sync.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/lyrics-sync-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain'};
const results=[];
function check(scope,name,ok,detail){results.push({scope,name,pass:!!ok});console.log((ok?'PASS ':'FAIL ')+'['+scope+'] '+name+(ok?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});
const albums=JSON.parse(await readFile(join(ROOT,'data/albums.json'),'utf8'));

/* 8 kHz 8-bit mono silence: small, and every Chromium build plays WAV */
function silentWav(seconds){
  const n=Math.ceil(seconds*8000),b=Buffer.alloc(44+n,128);
  b.write('RIFF',0);b.writeUInt32LE(36+n,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(8000,24);b.writeUInt32LE(8000,28);b.writeUInt16LE(1,32);b.writeUInt16LE(8,34);b.write('data',36);b.writeUInt32LE(n,40);
  return b;
}
const WAVS={};const secondsBySrc={};for(const a of albums.albums)for(const t of a.tracks)if(t.src)secondsBySrc[t.src]=t.seconds||240;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required','--mute-audio']});
async function context(viewport){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,serviceWorkers:'block'});
  await ctx.addInitScript(()=>{try{localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));sessionStorage.setItem('mcc_premiere','1');}catch(e){}});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=decodeURIComponent(u.pathname);
    if(u.origin===BASE){
      const rel=p==='/'?'index.html':p.replace(/^\//,'');
      if(/^assets\/audio\//.test(rel)){
        /* served with byte ranges, as Pages serves the real files: seeking needs them */
        const wav=WAVS[rel]||(WAVS[rel]=silentWav(secondsBySrc[rel]||240));
        const m=/bytes=(\d+)-(\d*)/.exec(req.headers().range||'');
        if(!m)return route.fulfill({status:200,contentType:'audio/wav',headers:{'accept-ranges':'bytes','content-length':String(wav.length)},body:wav});
        const a=+m[1],b=m[2]?Math.min(+m[2],wav.length-1):wav.length-1;
        return route.fulfill({status:206,contentType:'audio/wav',headers:{'accept-ranges':'bytes','content-range':`bytes ${a}-${b}/${wav.length}`,'content-length':String(b-a+1)},body:wav.subarray(a,b+1)});
      }
      if(/\.(mp4|webm|mov)$/i.test(rel))return route.fulfill({status:404,body:''});
      const file=resolve(ROOT,rel);if(!file.startsWith(resolve(ROOT)+sep))return route.abort();
      try{return route.fulfill({body:await readFile(file),contentType:TYPES[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    }
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
    if(u.hostname.endsWith('supabase.co')||u.hostname==='api.mccluster.org')return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:u.pathname.includes('/rest/v1/')?'[]':'{}'});
    return route.abort();
  });
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page,errors};
}
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);

async function openTrack(page,album,title){
  await page.goto(`${BASE}/album.html?album=${album}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('#tracks li').length>0,null,{timeout:20000});
  const row=page.locator(`#tracks li[data-title="${title.replace(/"/g,'\\"')}"]`).first();
  await row.click();
  await page.waitForFunction(()=>{const d=document.getElementById('deck');return d&&isFinite(d.duration)&&d.duration>0;},null,{timeout:15000});
  await page.evaluate(()=>{document.getElementById('deck').pause();});
  await page.locator('#deckbar .deckbar__meta').click();
  await page.waitForFunction(()=>document.getElementById('now').dataset.on==='1'&&document.getElementById('nowLyr').getAttribute('data-lyrics-mode'),null,{timeout:10000});
}
async function at(page,t){
  return page.evaluate(t=>new Promise(res=>{const d=document.getElementById('deck');const done=()=>{d.dispatchEvent(new Event('timeupdate'));requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const live=[...document.querySelectorAll('#nowLyr p.is-live')];
    res({n:live.length,text:live[0]?live[0].textContent:'',sung:live[0]?live[0].querySelectorAll('.lyr-w.is-sung').length:0,words:live[0]?live[0].querySelectorAll('.lyr-w').length:0,bar:(document.getElementById('npLyr')||{}).textContent||''});}));};
    if(Math.abs(d.currentTime-t)<1e-3)return done();d.addEventListener('seeked',done,{once:true});d.currentTime=t;}),t);
}

const {page,errors,ctx}=await context({width:390,height:844});
let tracks=0;
for(const a of albums.albums){
  for(const t of a.tracks){
    if(!t.lyrics||t.gated)continue;
    const doc=JSON.parse(await readFile(join(ROOT,t.lyrics),'utf8'));
    const lines=(doc.timed&&doc.timed.line)||[];
    const scope=`${a.slug} · ${t.title}`;
    if(!lines.length){check(scope,'has timed lines',false,{file:t.lyrics});continue;}
    tracks++;
    try{await openTrack(page,a.slug,t.title);}catch(e){check(scope,'opens and plays',false,{e:e.message});continue;}
    const mode=await page.getAttribute('#nowLyr','data-lyrics-mode');
    check(scope,'the record shows timed lyrics',mode==='timed',{mode});
    const count=await page.locator('#nowLyr p.lyr-line').count();
    check(scope,`every line is painted (${lines.length})`,count===lines.length,{count});
    /* lines with a distinct start (two lines can share a begin after tidy) */
    const picks=[0,Math.floor(lines.length/2),lines.length-1].filter((i,k,arr)=>arr.indexOf(i)===k).map(i=>{let j=i;while(j+1<lines.length&&lines[j+1].begin===lines[j].begin)j++;return j;});
    for(const i of picks){
      const L=lines[i],r=await at(page,L.begin+0.001);
      const want=L.words&&L.words.length?L.words.map(w=>w.content).join(' '):L.content;
      check(scope,`at ${L.begin.toFixed(2)}s line ${i+1} is lit`,r.n===1&&norm(r.text)===norm(want),{got:r.text,want});
      check(scope,`at ${L.begin.toFixed(2)}s the deck bar shows it`,norm(r.bar)===norm(L.content),{bar:r.bar});
    }
    const wl=lines.findIndex(l=>l.words&&l.words.length>=3&&l.words[2].begin>l.words[1].begin);
    if(wl>=0){
      const w=lines[wl].words,r=await at(page,w[2].begin+0.001);
      check(scope,`word timing: at "${w[2].content}" three words are sung`,r.sung===3&&r.words===w.length,{sung:r.sung,words:r.words});
    }
    const tap=Math.min(lines.length-1,picks[1]+1);
    await page.locator('#nowLyr p.lyr-line').nth(tap).click();
    const ct=await page.evaluate(()=>document.getElementById('deck').currentTime);
    check(scope,'tap a line: the song jumps to it',ct>=lines[tap].begin-0.05&&ct-lines[tap].begin<0.75,{ct,want:lines[tap].begin});
    await page.evaluate(()=>document.getElementById('deck').pause());
    check(scope,'390px: no sideways scroll',(await overflow(page))===0,{});
    if(/hundun|antisocial/.test(t.lyrics)){
      const mid=lines[Math.floor(lines.length/3)];
      const w=mid.words&&mid.words.length>2?mid.words[Math.floor(mid.words.length/2)].begin+0.001:mid.begin+0.001;
      await at(page,w);await page.waitForTimeout(700);
      await page.screenshot({path:join(OUT,(t.lyrics.includes('hundun')?'hundun':'antisocial')+'-390.png')});
    }
  }
}
check('shelf',`every track with lyrics was played (${tracks})`,tracks>=30,{tracks});
check('shelf','no page errors',errors.length===0,errors.slice(0,5));
await ctx.close();

/* desktop: the same record, room to breathe */
{
  const {page,errors,ctx}=await context({width:1440,height:900});
  await openTrack(page,'whip-equipped','Hundun (B-Side)');
  const doc=JSON.parse(await readFile(join(ROOT,'data/lyrics/hundun-b-side.json'),'utf8'));
  const L=doc.timed.line[12];const r=await at(page,L.words[2].begin+0.001);
  check('desktop','Hundun line lit with its words',norm(r.text)===norm(L.words.map(w=>w.content).join(' '))&&r.sung===3,r);
  check('desktop','no sideways scroll',(await overflow(page))===0,{});
  await page.waitForTimeout(700);await page.screenshot({path:join(OUT,'hundun-desktop.png')});
  check('desktop','no page errors',errors.length===0,errors.slice(0,5));
  /* the music-video wall reads the same files through the same reader */
  await page.goto(`${BASE}/music-videos.html`,{waitUntil:'domcontentloaded'});
  const ok=await page.waitForFunction(()=>window.MCC_LYRICS&&typeof window.MCC_LYRICS.normalize==='function',null,{timeout:15000}).then(()=>true,()=>false);
  check('music-videos','loads the shared reader',ok,{});
  await ctx.close();
}
await browser.close();
const failed=results.filter(r=>!r.pass);
console.log(`\n${results.length-failed.length}/${results.length} checks passed`);
process.exit(failed.length?1:0);
