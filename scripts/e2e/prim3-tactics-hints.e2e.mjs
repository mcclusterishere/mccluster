/* PRIM3 optional tactical hints — the real preview page over the vendored resolver + hint engine.
   Baseline play without any challenge; hint flow (wrong → progressive step, correct → suggestion);
   the hint never moves the unit or spends AP; a changed board refuses the old hint; the unseen
   hostile is never drawn; 44px targets; no sideways scroll at 390 and 1280; no page errors.
   PLAYWRIGHT_DIR=<node_modules> node scripts/e2e/prim3-tactics-hints.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/prim3-tactics-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain'};
const results=[];const LEADS=[];
function check(scope,name,ok,detail){results.push({scope,name,pass:!!ok});console.log((ok?'PASS ':'FAIL ')+'['+scope+'] '+name+(ok?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});


/* 8 kHz 8-bit mono silence: small, and every Chromium build plays WAV */
function silentWav(seconds){
  const n=Math.ceil(seconds*8000),b=Buffer.alloc(44+n,128);
  b.write('RIFF',0);b.writeUInt32LE(36+n,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(8000,24);b.writeUInt32LE(8000,28);b.writeUInt16LE(1,32);b.writeUInt16LE(8,34);b.write('data',36);b.writeUInt32LE(n,40);
  return b;
}
const WAVS={};const secondsBySrc={};
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
for(const vp of [{width:390,height:844},{width:1280,height:900}]){
  const scope=String(vp.width);
  const {page,errors,ctx}=await context(vp);
  await page.goto(`${BASE}/prim3-tactics-preview.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('#tacGrid .tac-cell').length===100,null,{timeout:15000});
  const ap=()=>page.evaluate(()=>window.__tac.state.units.find(u=>u.id==='E1').ap);
  const pos=()=>page.evaluate(()=>{const u=window.__tac.state.units.find(u=>u.id==='E1');return [u.x,u.y];});
  /* baseline: move without solving anything */
  await page.locator('.tac-cell[data-x="2"][data-y="2"]').click();
  check(scope,'baseline move needs no challenge',JSON.stringify(await pos())==='[2,2]'&&await ap()===1,await pos());
  check(scope,'the unseen hostile is never drawn',await page.evaluate(()=>![...document.querySelectorAll('.tac-cell')].some(c=>c.textContent==='H2')));
  /* hint: wrong then right */
  await page.locator('#tacHint').click();
  await page.waitForSelector('#tacAns');
  check(scope,'a field challenge is shown',(await page.locator('#tacQ').innerText()).length>10);
  await page.fill('#tacAns','98765');await page.locator('#tacForm button[type=submit]').click();
  check(scope,'a wrong answer gets a progressive step and play is not frozen',(await page.locator('#tacStep').innerText()).startsWith('Not yet'));
  const answer=await page.evaluate(()=>{const a=window.__tac.session.challenge.secret.answer;return a.kind==='bool'?(a.value?'yes':'no'):(a.value.d===1?String(a.value.n):a.value.n+'/'+a.value.d);});
  const before={pos:await pos(),ap:await ap()};
  await page.fill('#tacAns',answer);await page.locator('#tacForm button[type=submit]').click();
  await page.waitForSelector('.tac-why',{timeout:5000}).catch(()=>{});
  check(scope,'a correct answer shows a suggested tile and why',await page.locator('.tac-cell.is-hint').count()===1&&await page.locator('.tac-why li').count()>=3);
  check(scope,'the hint did not move the unit or spend AP',JSON.stringify(await pos())===JSON.stringify(before.pos)&&await ap()===before.ap,{before,after:{pos:await pos(),ap:await ap()}});
  check(scope,'the explanation never promises a guaranteed outcome',/not a guaranteed one/.test(await page.locator('.tac-why').innerText()));
  /* stale: open a hint, change the board, answer */
  await page.locator('#tacHint').click();await page.waitForSelector('#tacAns');
  const ans2=await page.evaluate(()=>{const a=window.__tac.session.challenge.secret.answer;return a.value.d===1?String(a.value.n):a.value.n+'/'+a.value.d;});
  await page.evaluate(()=>{const s=window.__tac.session;window.__keep=s;});
  await page.locator('#tacEnd').click(); // new round: the board changed
  await page.locator('#tacHint').click();await page.waitForSelector('#tacAns');
  const stale=await page.evaluate(async(ans)=>{const m=await import('./js/prim3-tactics/tactical-hints.mjs');return m.answerHint(window.__keep,{tenantId:'preview',playerId:'you',missionId:'TR02-PREVIEW'},window.__tac.state,ans).response.code;},ans2);
  check(scope,'an answer for an older board is refused (STALE_BOARD)',stale==='STALE_BOARD',stale);
  const small=await page.evaluate(()=>[...document.querySelectorAll('.tac-btn,.tac-unit,#tacAns')].filter(e=>e.getBoundingClientRect().height<44).map(e=>e.id||e.textContent));
  check(scope,'controls are 44px tap targets',!small.length,small);
  check(scope,'no sideways scroll',(await overflow(page))===0,await overflow(page));
  check(scope,'no page errors',!errors.length,errors);
  await page.screenshot({path:join(OUT,`prim3-tactics-${scope}.png`),fullPage:true});
  await ctx.close();
}
await browser.close();
const failed=results.filter(r=>!r.pass);console.log(`${results.length-failed.length}/${results.length} passed`);process.exit(failed.length?1:0);
