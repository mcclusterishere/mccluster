/* Now Playing follows the record (handoff 2026-11-02, items 2A-2C).
   Real album.html + js/label.js + js/licensedesk.js; silent WAV audio of each track's length; network stubbed.
   - natural ended -> next: the OPEN sheet's title, artist, credit, license target and lyrics change with the deck,
     with no tap and no timer, and the deck advances exactly once;
   - manual next/previous update the sheet synchronously;
   - the sheet's extra action is License this track only (no studio booking, no catalog link; the sleep timer
     was removed on the owner's direction 2026-11-02);
   - a license request is saved as a house lead naming the rights holder, and the confirmation does not claim an email.
   album.html has no repeat or shuffle control, so neither is tested.
   PLAYWRIGHT_DIR=<node_modules> node scripts/e2e/now-playing-continuity.e2e.mjs [outDir] */
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
const OUT=process.argv[2]||'/tmp/now-playing-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain'};
const results=[];const LEADS=[];
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
    if(u.hostname.endsWith('supabase.co')&&u.pathname.endsWith('/rest/v1/leads')&&req.method()==='POST'){LEADS.push(JSON.parse(req.postData()||'{}'));return route.fulfill({status:201,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'[]'});}
    if(u.hostname.endsWith('supabase.co')||u.hostname==='api.mccluster.org')return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:u.pathname.includes('/rest/v1/')?'[]':'{}'});
    return route.abort();
  });
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page,errors};
}
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);

const {page,errors,ctx}=await context({width:390,height:844});
const ALBUM='prim3';
const tracks=albums.albums.find(a=>a.slug===ALBUM).tracks;
await page.goto(`${BASE}/album.html?album=${ALBUM}`,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelectorAll('#tracks li').length>0,null,{timeout:20000});
await page.locator(`#tracks li[data-title="${tracks[0].title}"]`).first().click();
await page.waitForFunction(()=>{const d=document.getElementById('deck');return d&&isFinite(d.duration)&&d.duration>0;},null,{timeout:15000});
await page.locator('#deckbar .deckbar__meta').click();
await page.waitForFunction(()=>document.getElementById('now').dataset.on==='1',null,{timeout:10000});
const snap=()=>page.evaluate(()=>({
  title:document.getElementById('nowTitle').textContent,by:document.getElementById('nowBy').textContent,
  cred:document.getElementById('nowCred').textContent,deck:document.getElementById('npTitle').textContent,
  lic:document.getElementById('ecoLic').getAttribute('data-license-title'),holder:document.getElementById('ecoLic').getAttribute('data-license-holder'),
  lyr:(document.querySelector('#nowLyr p')||{}).textContent||'',on:document.getElementById('now').dataset.on}));
const first=await snap();
check('open','the open sheet shows the first track',first.title===tracks[0].title&&first.lic===tracks[0].title&&first.on==='1',first);
const events=[];await page.exposeFunction('__np',d=>events.push(d));
await page.evaluate(()=>addEventListener('mcc:now-playing',e=>window.__np(e.detail)));
/* natural end of the record: play the last second and let the deck finish on its own */
await page.evaluate(()=>{const d=document.getElementById('deck');d.currentTime=Math.max(0,d.duration-0.6);return d.play();});
await page.waitForFunction(t=>document.getElementById('nowTitle').textContent===t,tracks[1].title,{timeout:15000}).catch(()=>{});
await page.waitForTimeout(1200);
const auto=await snap();
check('autoplay','ended -> next updates the OPEN sheet title without a tap',auto.title===tracks[1].title&&auto.on==='1',auto);
check('autoplay','deck, sheet and license target name the same record',auto.deck===tracks[1].title&&auto.lic===tracks[1].title,auto);
check('autoplay','artist and credit follow the record',auto.by.length>0&&auto.cred.length>0&&auto.holder===auto.by,auto);
await page.waitForFunction(old=>{const p=document.querySelector('#nowLyr p');return p&&p.textContent!==old;},first.lyr,{timeout:10000}).catch(()=>{});
const lyr=await snap();
check('autoplay','the lyrics change to the new record',lyr.lyr&&lyr.lyr!==first.lyr,{before:first.lyr,after:lyr.lyr});
check('autoplay','the deck advanced exactly once',(await page.evaluate(()=>document.getElementById('nowTitle').textContent))===tracks[1].title&&events.filter(e=>e.title===tracks[1].title).length===1,events.map(e=>e.title));
/* manual next/previous: the sheet is right in the same task as the tap, no timer */
const syncNext=await page.evaluate(()=>{document.getElementById('nowNext').click();return document.getElementById('nowTitle').textContent;});
check('manual','Next updates the sheet synchronously',syncNext===tracks[2].title,syncNext);
const syncPrev=await page.evaluate(()=>{const d=document.getElementById('deck');d.currentTime=0;document.getElementById('nowPrev').click();return document.getElementById('nowTitle').textContent;});
check('manual','Previous updates the sheet synchronously',syncPrev===tracks[1].title,syncPrev);
/* the extra actions */
const doors=await page.evaluate(()=>[...document.querySelectorAll('.now__doors > *')].filter(x=>!x.hidden).map(x=>({id:x.id,text:x.textContent.trim(),href:x.getAttribute('href')})));
check('actions','only License this track remains (sleep timer removed, owner 2026-11-02)',doors.length===1&&doors[0].id==='ecoLic',doors);
check('actions','no studio booking or catalog link on the sheet',!(await page.evaluate(()=>!!document.querySelector('.now__doors a[href*="hire.html"],.now__doors a[href*="catalogue.html"]'))));
check('actions','no sleep timer anywhere on the page',!(await page.evaluate(()=>!!document.querySelector('#nowNap,#nowNapOff')||typeof window.MCC_NIGHTCAP!=='undefined')));
const h=await page.evaluate(()=>[...document.querySelectorAll('.now__doors > *')].filter(x=>!x.hidden).map(x=>x.getBoundingClientRect().height));
check('actions','the actions are 44px tap targets',h.every(x=>x>=44),h);
/* license request */
await page.locator('#ecoLic').click();
await page.waitForSelector('#lcdName',{timeout:5000});
await page.fill('#lcdName','Test Buyer');await page.fill('#lcdEmail','buyer@example.com');await page.fill('#lcdUse','A short film');
await page.locator('#lcdGo').click();
await page.waitForFunction(()=>!document.getElementById('lcdDone').hidden,null,{timeout:8000}).catch(()=>{});
const lead=LEADS[LEADS.length-1]||{};
check('license','the request is saved as a lead naming the rights holder and the record',/rights holder: /.test(lead.note||'')&&(lead.want||'').includes(tracks[1].title),lead);
check('license','the confirmation does not claim an email was sent',/Nobody is emailed automatically/.test(await page.evaluate(()=>document.getElementById('lcdDoneNote').textContent)));
check('page','no sideways scroll at 390',(await overflow(page))===0,await overflow(page));
check('page','no page errors',!errors.length,errors);
await page.screenshot({path:join(OUT,'now-playing-390.png')});
await ctx.close();await browser.close();
const failed=results.filter(r=>!r.pass);console.log(`${results.length-failed.length}/${results.length} passed`);process.exit(failed.length?1:0);
