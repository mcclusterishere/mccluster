/* PRIM3 phone tactical board: interactions and answers, on the real preview page over the vendored
   resolver + hint engine (exact copies; SOURCE.json). Checks behaviour, not pixels:
   tap a unit on the board → only legal actions; Move shows path-checked reachable tiles, a tap previews,
   Back cancels, nothing is spent until Confirm; the optional hint never acts, scaffolds wrong answers on
   the board (x run, then y run), unlocks a suggestion on a correct or equivalent answer; a changed board
   refuses an old hint; the unseen hostile is never drawn; saved progress survives a reload and never
   restores a hint; another player's hint is refused; zoom/pan never fires a tap; reduced motion;
   44px targets; axes match the engine; no sideways scroll at 390 and 1280; no page errors.
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
const unit=(page,id)=>page.evaluate(id=>{const u=window.__tac.state.units.find(u=>u.id===id);return {x:u.x,y:u.y,ap:u.ap};},id);
const cell=(page,x,y)=>page.locator(`#tacBoard .tb-cell[data-x="${x}"][data-y="${y}"]`);
const answerOf=page=>page.evaluate(()=>{const a=window.__tac.session.challenge.secret.answer.value;return a.d===1?String(a.n):a.n+'/'+a.d;});
for(const vp of [{width:390,height:844},{width:1280,height:900}]){
  const scope=String(vp.width);
  const {page,errors,ctx}=await context(vp);
  await page.goto(`${BASE}/prim3-tactics-preview.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('#tacBoard .tb-cell').length===100,null,{timeout:15000});
  await page.evaluate(()=>{try{localStorage.clear()}catch(e){}});await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('#tacBoard .tb-cell').length===100);
  /* axes match the engine: x = column, y = row */
  const axes=await page.evaluate(()=>({x:[...document.querySelectorAll('.tb-axis--x')].map(e=>e.textContent).join(''),y:[...document.querySelectorAll('.tb-axis--y')].map(e=>e.textContent).join('')}));
  check(scope,'x and y axes are labelled 0–9',axes.x==='0123456789'&&axes.y==='0123456789',axes);
  check(scope,'the board cell named x 1, y 2 holds E1, where the engine puts it',/x 1, y 2.*squad E1/.test(await cell(page,1,2).getAttribute('aria-label')));
  check(scope,'the unseen hostile is never drawn or announced',await page.evaluate(()=>![...document.querySelectorAll('.tb-cell')].some(c=>/H2/.test(c.getAttribute('aria-label')))));
  /* tap the character → only legal actions */
  await cell(page,1,2).click();
  const acts=await page.evaluate(()=>[...document.querySelectorAll('#tacMenu [data-act]')].map(b=>b.dataset.act));
  check(scope,'tapping E1 on the board opens its action menu',acts.includes('move')&&acts.includes('hint')&&acts.includes('close'),acts);
  check(scope,'only legal actions: no Reload with a full magazine',!acts.includes('reload'),acts);
  check(scope,'Fire is offered only at a known hostile in line of sight',acts.filter(a=>a.startsWith('fire:')).every(a=>a==='fire:H1'),acts);
  await page.locator('[data-act="close"]').click();
  await cell(page,0,4).click();
  check(scope,'R1 (3 of 4 rounds) is offered Reload',await page.locator('[data-act="reload"]').count()===1);
  await page.locator('[data-act="close"]').click();
  /* move: path-checked reach, preview, back, confirm */
  await cell(page,1,2).click();await page.locator('[data-act="move"]').click();
  const lit=await page.evaluate(()=>[...document.querySelectorAll('.tb-cell.is-reach')].map(c=>c.dataset.x+','+c.dataset.y));
  const engine=await page.evaluate(async()=>{const H=await import('./js/prim3-tactics/tactical-hints.mjs');const p=H.playerProjection(window.__tac.state);return H.legalCandidates(p,'E1').filter(c=>c.action==='MOVE').map(c=>c.x+','+c.y);});
  check(scope,'lit tiles are exactly the engine\'s path-checked moves',JSON.stringify([...lit].sort())===JSON.stringify([...engine].sort()),{lit:lit.length,engine:engine.length});
  check(scope,'no lit tile is a wall',!lit.some(t=>['5,4','5,5'].includes(t)));
  const before=await unit(page,'E1');
  await cell(page,3,3).click();
  check(scope,'a tap previews: path, steps and AP shown, nothing spent',(await page.locator('#tacSheet').innerText()).includes('(3, 3)')&&await page.locator('.tb-cell.is-dest').count()===1&&JSON.stringify(await unit(page,'E1'))===JSON.stringify(before));
  await page.locator('[data-sheet="back"]').click();
  check(scope,'Back cancels the preview with nothing spent',JSON.stringify(await unit(page,'E1'))===JSON.stringify(before)&&await page.locator('.tb-cell.is-dest').count()===0);
  await cell(page,9,9).click();
  check(scope,'tapping an unreachable tile spends nothing',JSON.stringify(await unit(page,'E1'))===JSON.stringify(before));
  await cell(page,3,3).click();await page.locator('[data-sheet="confirm-move"]').click();
  const after=await unit(page,'E1');
  check(scope,'Confirm moves through the real resolver and spends 1 AP',after.x===3&&after.y===3&&after.ap===before.ap-1,after);
  /* optional hint from a preview: the math on the board */
  await cell(page,3,3).click();await page.locator('[data-act="move"]').click();await cell(page,4,1).click();
  await page.locator('[data-sheet="practice"]').click();
  const g=await page.evaluate(()=>({o:[...document.querySelectorAll('.tb-cell.is-origin')].map(c=>c.dataset.x+','+c.dataset.y),t:[...document.querySelectorAll('.tb-cell.is-target')].map(c=>c.dataset.x+','+c.dataset.y)}));
  check(scope,'the challenge highlights origin (3,3) and target (4,1) on the board',g.o.join()==='3,3'&&g.t.join()==='4,1',g);
  check(scope,'opening a hint leaves move mode (no lit tiles compete with the math)',await page.locator('.tb-cell.is-reach').count()===0);
  await page.fill('#tacAns','99');await page.locator('#tacForm button[type=submit]').click();
  check(scope,'a wrong answer scaffolds: the x run appears on the board with a step',await page.locator('.tb-cell.run-x').count()===1&&/Not yet/.test(await page.locator('#tacStep').innerText()));
  await page.fill('#tacAns','98');await page.locator('#tacForm button[type=submit]').click();
  check(scope,'a second wrong answer adds the y run',await page.locator('.tb-cell.run-y').count()===2);
  const pos0=await unit(page,'E1');
  await page.fill('#tacAns','3.0');await page.locator('#tacForm button[type=submit]').click();
  check(scope,'an equivalent form (3.0) is accepted and a suggestion appears',await page.locator('.tb-cell.is-hint').count()===1&&await page.locator('.ts-why li').count()>=3);
  check(scope,'the hint did not move E1 or spend AP',JSON.stringify(await unit(page,'E1'))===JSON.stringify(pos0));
  check(scope,'the explanation never promises a guaranteed outcome',/not a guaranteed one/.test(await page.locator('.ts-why').innerText()));
  /* stale + account isolation */
  await cell(page,3,3).click();await page.locator('[data-act="hint"]').click();
  await page.evaluate(()=>{window.__keep=window.__tac.session;});
  const ans=await answerOf(page);
  const other=await page.evaluate(async(a)=>{const H=await import('./js/prim3-tactics/tactical-hints.mjs');return H.answerHint(window.__keep,{tenantId:'preview',playerId:'someone-else',missionId:'TR02-PREVIEW'},window.__tac.state,a).response.code;},ans);
  check(scope,'another player cannot use this hint',other==='NOT_YOUR_HINT',other);
  await page.locator('#tacEnd').click();
  const stale=await page.evaluate(async(a)=>{const H=await import('./js/prim3-tactics/tactical-hints.mjs');return H.answerHint(window.__keep,{tenantId:'preview',playerId:'you',missionId:'TR02-PREVIEW'},window.__tac.state,a).response.code;},ans);
  check(scope,'after End turn the old hint is stale',stale==='STALE_BOARD',stale);
  check(scope,'End turn restores 2 AP and ends any open hint',(await unit(page,'E1')).ap===2&&!(await page.evaluate(()=>!!window.__tac.session)));
  /* saved progress */
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelectorAll('#tacBoard .tb-cell').length===100);
  const restored=await unit(page,'E1');
  check(scope,'saved progress survives a reload (E1 still at 3,3; round kept)',restored.x===3&&restored.y===3&&await page.evaluate(()=>window.__tac.state.round)===2,restored);
  check(scope,'a hint is never restored from storage',await page.evaluate(()=>window.__tac.session===null));
  check(scope,'the save key is scoped to tenant, player and mission',await page.evaluate(()=>window.__tac.SAVE_KEY.endsWith(':preview:you:TR02-PREVIEW')));
  /* zoom/pan never taps */
  await page.locator('#zoomIn').click();await page.locator('#zoomIn').click();
  check(scope,'zoom in scales the board',/scale\(2\)/.test(await page.locator('#tacBoard').getAttribute('style')));
  const selBefore=await page.evaluate(()=>window.__tac.ui.selected);
  const box=await page.locator('#tacViewport').boundingBox();
  await page.mouse.move(box.x+box.width*0.6,box.y+box.height*0.6);await page.mouse.down();await page.mouse.move(box.x+box.width*0.3,box.y+box.height*0.3,{steps:6});await page.mouse.up();
  check(scope,'a pan drag moves the view and is not treated as a tap',/translate\(-?\d/.test(await page.locator('#tacBoard').getAttribute('style'))&&await page.evaluate(()=>window.__tac.ui.menu)===false&&await page.evaluate(()=>window.__tac.ui.selected)===selBefore);
  await page.locator('#zoomOut').click();await page.locator('#zoomOut').click();
  /* reset */
  await page.locator('.tac-about summary').click();await page.locator('#tacReset').click();
  check(scope,'Start over clears the save and the board',JSON.stringify(await unit(page,'E1'))===JSON.stringify({x:1,y:2,ap:2})&&await page.evaluate(()=>{try{return localStorage.getItem(window.__tac.SAVE_KEY)}catch(e){return 'x'}})===null);
  /* tap targets, overflow, errors */
  await cell(page,1,2).click();
  const small=await page.evaluate(()=>[...document.querySelectorAll('.tbtn,.tm-btn,.ts-btn,#tacAns')].filter(e=>e.offsetParent&&e.getBoundingClientRect().height<44).map(e=>e.id||e.textContent.trim()));
  check(scope,'controls are at least 44px tall',!small.length,small);
  check(scope,'no sideways scroll',(await overflow(page))===0,await overflow(page));
  check(scope,'no page errors',!errors.length,errors);
  await page.screenshot({path:join(OUT,`prim3-tactics-${scope}.png`),fullPage:true});
  await ctx.close();
}
/* reduced motion */
{
  const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==BASE)return route.abort();const f=resolve(ROOT,decodeURIComponent(u.pathname).slice(1));try{return route.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}});
  const page=await ctx.newPage();await page.goto(`${BASE}/prim3-tactics-preview.html`);await page.waitForSelector('#tacBoard .tb-cell');
  check('reduced-motion','reduced motion turns animation off',await page.evaluate(()=>document.documentElement.classList.contains('reduce-motion')&&getComputedStyle(document.querySelector('.tac-board')).transitionDuration==='0s'));
  await ctx.close();
}
await browser.close();
const failed=results.filter(r=>!r.pass);console.log(`${results.length-failed.length}/${results.length} passed`);process.exit(failed.length?1:0);
