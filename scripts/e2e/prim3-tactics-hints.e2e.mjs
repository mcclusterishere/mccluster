/* PRIM3 phone tactical board: interactions and answers, on the real preview page over the vendored
   resolver + hint engine (exact copies; SOURCE.json). Checks behaviour, not pixels:
   tap a unit on the board → only legal actions; Move shows path-checked reachable tiles, a tap previews,
   Back cancels, nothing is spent until Confirm; the optional hint never acts, scaffolds wrong answers on
   the board (x run, then y run), unlocks a suggestion on a correct or equivalent answer; a changed board
   refuses an old hint; the unseen hostile is never drawn; saved progress survives a reload and never
   restores a hint; another player's hint is refused; zoom/pan never fires a tap; reduced motion;
   44px targets; axes match the engine; no sideways scroll at 390 and 1280; no page errors.
   3D checks need three@0.180.0 locally (THREE_DIR=<.../node_modules/three> or installed beside Playwright);
   without it they print SKIP and are not counted.
   PLAYWRIGHT_DIR=<node_modules> [THREE_DIR=…] node scripts/e2e/prim3-tactics-hints.e2e.mjs [outDir] */
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
  await ctx.addInitScript(()=>{try{localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));localStorage.setItem('mccdb_session',JSON.stringify({access_token:'e2e-owner',expires_at:Math.floor(Date.now()/1000)+3600}));sessionStorage.setItem('mcc_premiere','1');}catch(e){}});
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


/* the games are the house owner's (owner, 2026-11-03): every context carries a session and api.mccluster.org answers
   200, so GET /v1/status says owner and js/owner-only.mjs opens the page */
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
const unit=(page,id)=>page.evaluate(id=>{const u=window.__tac.state.units.find(u=>u.id===id);return {x:u.x,y:u.y,ap:u.ap};},id);
const cell=(page,x,y)=>page.locator(`#tacBoard .tb-cell[data-x="${x}"][data-y="${y}"]`);
const answerOf=page=>page.evaluate(()=>{const a=window.__tac.session.challenge.secret.answer.value;return a.d===1?String(a.n):a.n+'/'+a.d;});
for(const vp of [{width:390,height:844},{width:1280,height:900}]){
  const scope=String(vp.width);
  const {page,errors,ctx}=await context(vp);
  await page.goto(`${BASE}/prim3-tactics-preview.html?view=2d&menu=0`,{waitUntil:'domcontentloaded'});
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
  check(scope,'zoom in scales the 2D board',/scale\(2\)/.test(await page.locator('#tacBoard').getAttribute('style')));
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
  await ctx.addInitScript(()=>{try{localStorage.setItem('mccdb_session',JSON.stringify({access_token:'e2e-owner',expires_at:Math.floor(Date.now()/1000)+3600}));}catch(e){}});
  await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.href.startsWith('https://api.mccluster.org/v1/status'))return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"ok":true}'});if(u.origin!==BASE)return route.abort();const f=resolve(ROOT,decodeURIComponent(u.pathname).slice(1));try{return route.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}});
  const page=await ctx.newPage();await page.goto(`${BASE}/prim3-tactics-preview.html?view=2d&menu=0`);await page.waitForSelector('#tacBoard .tb-cell');
  check('reduced-motion','reduced motion turns animation off',await page.evaluate(()=>document.documentElement.classList.contains('reduce-motion')&&getComputedStyle(document.querySelector('.tac-board')).transitionDuration==='0s'));
  await ctx.close();
}

/* 3D view: the same board drawn by three.js; taps go through the real WebGL canvas (raycast) */
const THREE_DIR=process.env.THREE_DIR||(()=>{try{return createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x')).resolve('three/package.json').replace(/package\.json$/,'')}catch{return null}})();
if(!THREE_DIR){console.log('SKIP [3d] three@0.180.0 not installed locally (set THREE_DIR); the 3D checks did not run');}
else for(const vp of [{width:390,height:844},{width:1280,height:900}]){
  const scope='3d-'+vp.width;
  const browser3=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser3.newContext({viewport:vp,serviceWorkers:'block',hasTouch:vp.width<1000});
  await ctx.addInitScript(()=>{try{localStorage.clear();localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));localStorage.setItem('mccdb_session',JSON.stringify({access_token:'e2e-owner',expires_at:Math.floor(Date.now()/1000)+3600}));}catch(e){}});
  await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.href.startsWith('https://api.mccluster.org/v1/status'))return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"ok":true}'});
    if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/three@0.180.0/'))return route.fulfill({body:await readFile(join(THREE_DIR,u.pathname.replace('/npm/three@0.180.0/',''))),contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}});
    if(u.origin!==BASE)return route.abort();const f=resolve(ROOT,decodeURIComponent(u.pathname).slice(1));if(!f.startsWith(resolve(ROOT)+sep))return route.abort();
    try{return route.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${BASE}/prim3-tactics-preview.html?menu=0`);
  await page.waitForFunction(()=>window.__tac&&window.__tac.mode3d,null,{timeout:20000});await page.waitForTimeout(400);
  const settle=async()=>{for(let i=0;i<60&&await page.evaluate(()=>window.__tac.busy3d());i++)await page.waitForTimeout(100);};
  const tap=async(x,y,h=0)=>{await settle();const p=await page.evaluate(([x,y,h])=>window.__tac.screenOf(x,y,h),[x,y,h]);await page.mouse.click(p.x,p.y);await page.waitForTimeout(150);};
  const tapUnit=async(id)=>{await settle();const p=await page.evaluate(id=>window.__tac.unitScreenPoint(id),id);if(!p)throw Error('Missing rendered operative '+id);await page.mouse.click(p.x,p.y);await page.waitForTimeout(150);};
  check(scope,'3D is the default view and draws into a WebGL canvas',await page.locator('#tac3d canvas').count()===1&&await page.evaluate(()=>getComputedStyle(document.getElementById('tacBoard')).display==='none'));
  // textures and the HDR stream in after first paint; sample a few times so a mid-load frame is not a false failure
  let painted=0;for(let i=0;i<10&&painted<=30;i++){painted=await page.evaluate(()=>{const c=document.querySelector('#tac3d canvas');const g=c.getContext('webgl2')||c.getContext('webgl');const px=new Uint8Array(4);g.readPixels(Math.floor(c.width/2),Math.floor(c.height/2),1,1,g.RGBA,g.UNSIGNED_BYTE,px);return px[0]+px[1]+px[2];});if(painted<=30)await page.waitForTimeout(300);}
  check(scope,'the canvas actually renders the courtyard (centre pixel is not empty)',painted>30,painted);
  await tapUnit('E1');
  check(scope,'tapping E1 in 3D (body raycast) opens its menu beside it',await page.evaluate(()=>window.__tac.ui.menu&&window.__tac.ui.selected==='E1')&&await page.locator('#tacMenu.is-float').count()===1);
  const acts=await page.evaluate(()=>[...document.querySelectorAll('#tacMenu [data-act]')].map(b=>b.dataset.act));
  check(scope,'the 3D menu leads with Move, Inspect and Get hint; the rest sit under More',['move','inspect','hint','more'].every(a=>acts.includes(a))&&!acts.includes('dash'),acts);
  await page.locator('[data-act="move"]').click();
  const before=await unit(page,'E1');
  await tap(3,3);
  check(scope,'a 3D tap on a lit tile previews it; nothing spent',await page.evaluate(()=>window.__tac.ui.preview&&window.__tac.ui.preview.x===3&&window.__tac.ui.preview.y===3)&&JSON.stringify(await unit(page,'E1'))===JSON.stringify(before));
  await tap(9,9);
  check(scope,'a 3D tap on an unreachable tile spends nothing',JSON.stringify(await unit(page,'E1'))===JSON.stringify(before));
  await tap(3,3);await page.locator('[data-sheet="confirm-move"]').click();
  const after=await unit(page,'E1');
  check(scope,'Confirm moves E1 through the resolver in the 3D view',after.x===3&&after.y===3&&after.ap===1,after);
  check(scope,'the confirmed move plays as a walk (the body is animating right after Confirm)',await page.evaluate(()=>window.__tac.busy3d()));
  await settle();
  check(scope,'the walk ends on the engine\'s tile',JSON.stringify(await page.evaluate(()=>window.__tac.unitPosition('E1')))===JSON.stringify({x:3,y:3}),await page.evaluate(()=>window.__tac.unitPosition('E1')));
  const sBefore=await page.evaluate(()=>window.__tac.screenOf(3,3,0));await page.locator('#tacRotate').click();await settle();
  const sAfter=await page.evaluate(()=>window.__tac.screenOf(3,3,0));
  check(scope,'rotate turns the camera a quarter turn',Math.hypot(sAfter.x-sBefore.x,sAfter.y-sBefore.y)>5,[sBefore,sAfter]);
  await page.evaluate(()=>{window.__tac.ui.menu=false;});await tapUnit('E1');
  check(scope,'after rotating, a tap on E1 still selects E1 (raycast follows the camera)',await page.evaluate(()=>window.__tac.ui.menu&&window.__tac.ui.selected==='E1'));
  await page.locator('#tacMenu [data-act="close"]').click();
  await page.locator('#tacRotate').click();await page.locator('#tacRotate').click();await page.locator('#tacRotate').click();await settle();
  await tapUnit('E1');await page.locator('[data-act="hint"]').click();
  const labels=await page.evaluate(()=>[...document.querySelectorAll('.b3-label')].map(l=>l.textContent));
  check(scope,'the challenge labels Origin and Target in the scene',labels.some(t=>/^Origin \(3, 3\)$/.test(t))&&labels.some(t=>/^Target \(/.test(t)),labels.filter(t=>/Origin|Target/.test(t)));
  check(scope,'axis labels 0–9 are drawn in the scene',['0','9'].every(n=>labels.includes(n)));
  check(scope,'the unseen hostile is not labelled in 3D',!labels.includes('H2'));
  const z0=await page.evaluate(()=>window.__tac.zoomLevel());await page.locator('#zoomIn').click();
  check(scope,'zoom in moves the 3D camera closer',await page.evaluate(()=>window.__tac.zoomLevel())<z0);
  await page.locator('#tacView').click();
  check(scope,'the 2D grid toggle shows the same board as labelled tiles',await page.evaluate(()=>!window.__tac.mode3d&&getComputedStyle(document.getElementById('tacBoard')).display!=='none')&&/x 3, y 3.*squad E1/.test(await page.locator('#tacBoard .tb-cell[data-x="3"][data-y="3"]').getAttribute('aria-label')));
  check(scope,'no sideways scroll',(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))===0);
  check(scope,'no page errors',!errors.length,errors);
  await page.locator('#tacView').click();await page.waitForTimeout(300);
  await page.screenshot({path:join(OUT,`prim3-tactics-3d-${vp.width}.png`)});
  await ctx.close();await browser3.close();
}
/* 3D fire: the shot the resolver already rolled plays out (turn, burst, tracer, camera), then hands back;
   and the high presentation tier (image light, GTAO, bloom, SMAA) loads and renders without errors */
if(THREE_DIR){
  const scope='3d-fire';
  const browser3=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser3.newContext({viewport:{width:390,height:844},serviceWorkers:'block',hasTouch:true});
  await ctx.addInitScript(()=>{try{localStorage.clear();localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));localStorage.setItem('mccdb_session',JSON.stringify({access_token:'e2e-owner',expires_at:Math.floor(Date.now()/1000)+3600}));}catch(e){}});
  await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.href.startsWith('https://api.mccluster.org/v1/status'))return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"ok":true}'});
    if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/three@0.180.0/'))return route.fulfill({body:await readFile(join(THREE_DIR,u.pathname.replace('/npm/three@0.180.0/',''))),contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}});
    if(u.origin!==BASE)return route.abort();const f=resolve(ROOT,decodeURIComponent(u.pathname).slice(1));if(!f.startsWith(resolve(ROOT)+sep))return route.abort();
    try{return route.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${BASE}/prim3-tactics-preview.html?fx=high&menu=0`);
  await page.waitForFunction(()=>window.__tac&&window.__tac.mode3d,null,{timeout:20000});await page.waitForTimeout(2500);
  check(scope,'the high tier is active when asked for',await page.evaluate(()=>window.__tac.tier)==='high');
  const painted=await page.evaluate(()=>{const c=document.querySelector('#tac3d canvas');const g=c.getContext('webgl2')||c.getContext('webgl');const px=new Uint8Array(4);g.readPixels(Math.floor(c.width/2),Math.floor(c.height/2),1,1,g.RGBA,g.UNSIGNED_BYTE,px);return px[0]+px[1]+px[2];});
  check(scope,'the post-processed frame renders (centre pixel not empty)',painted>30,painted);
  const settle=async()=>{for(let i=0;i<300&&await page.evaluate(()=>window.__tac.busy3d());i++)await page.waitForTimeout(100);};
  let shooter=null;
  for(const id of ['E1','R1','T1']){
    const u=await unit(page,id);if(!u)continue;await settle();
    const p=await page.evaluate(id=>window.__tac.unitScreenPoint(id),id);await page.mouse.click(p.x,p.y);await page.waitForTimeout(200);
    const acts=await page.evaluate(()=>[...document.querySelectorAll('#tacMenu [data-act]')].map(b=>b.dataset.act));
    const f=acts.find(a=>a.startsWith('fire:'));if(f){shooter={id,act:f};break;}
  }
  if(!shooter)console.log('SKIP [3d-fire] no squad member has a legal shot at the start of this mission');
  else{
    await page.locator(`#tacMenu [data-act="${shooter.act}"]`).click();
    const tid=shooter.act.slice(5);const hpOf=()=>page.evaluate(id=>{const u=window.__tac.state.units.find(u=>u.id===id);return u?{hp:u.hp}:null;},tid);const hp0=(await hpOf()).hp;
    await page.locator('[data-sheet="confirm-fire"]').click();
    check(scope,'Confirm fire plays the shot in the scene',await page.evaluate(()=>window.__tac.busy3d()));
    const ev=await page.evaluate(()=>window.__tac.state.events.filter(e=>e.type==='FIRE').slice(-1)[0]);
    const t=await hpOf();
    check(scope,'the shot\'s outcome is the resolver\'s (hp changed only on a hit)',ev&&(ev.hit?(!t||t.hp===Math.max(0,hp0-ev.damage)):(t&&t.hp===hp0)),{ev,hp0,t});
    await settle();
    check(scope,'the shot hands control back (no animation left running)',!(await page.evaluate(()=>window.__tac.busy3d())));
  }
  await page.screenshot({path:join(OUT,'prim3-tactics-3d-fire-high.png')});
  check(scope,'no page errors',!errors.length,errors);
  await ctx.close();await browser3.close();
}
/* main menu: real buttons over the battlefield in showcase; Deploy / Continue / New / Training / Graphics */
if(THREE_DIR) for(const vp of [{width:390,height:844},{width:1280,height:900}]){
  const scope='menu-'+vp.width;
  const browser3=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser3.newContext({viewport:vp,serviceWorkers:'block',hasTouch:vp.width<1000});
  await ctx.addInitScript(()=>{try{if(!sessionStorage.getItem('seeded')){localStorage.clear();sessionStorage.setItem('seeded','1');}localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));localStorage.setItem('mccdb_session',JSON.stringify({access_token:'e2e-owner',expires_at:Math.floor(Date.now()/1000)+3600}));}catch(e){}});
  await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.href.startsWith('https://api.mccluster.org/v1/status'))return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"ok":true}'});
    if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/three@0.180.0/'))return route.fulfill({body:await readFile(join(THREE_DIR,u.pathname.replace('/npm/three@0.180.0/',''))),contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}});
    if(u.origin!==BASE)return route.abort();const f=resolve(ROOT,decodeURIComponent(u.pathname).slice(1));if(!f.startsWith(resolve(ROOT)+sep))return route.abort();
    try{return route.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${BASE}/prim3-tactics-preview.html`);
  await page.waitForFunction(()=>window.__tac&&window.__tac.menuKey,null,{timeout:20000});await page.waitForTimeout(500);
  const opts=()=>page.evaluate(()=>[...document.querySelectorAll('#pmList [data-pm]')].map(b=>b.dataset.pm));
  check(scope,'a first visit opens the main menu; the battlefield waits behind it',await page.evaluate(()=>window.__tac.menuOpen&&!document.getElementById('p3Menu').hidden&&getComputedStyle(document.querySelector('.tac-stage')).display==='none'&&!window.__tac.mode3d));
  check(scope,'with no save the menu includes the courtyard, Transit, HQ, B1, Training and Graphics',JSON.stringify(await opts())===JSON.stringify(['new','transit','hq','b1','training','graphics']),await opts());
  await page.waitForTimeout(800);const painted=await page.evaluate(()=>{const c=document.querySelector('#menu3d canvas');const g=c.getContext('webgl2')||c.getContext('webgl');const px=new Uint8Array(4);g.readPixels(Math.floor(c.width/2),Math.floor(c.height/2),1,1,g.RGBA,g.UNSIGNED_BYTE,px);return px[0]+px[1]+px[2];});
  check(scope,'the menu backdrop renders the battlefield courtyard',painted>20&&await page.evaluate(()=>window.__tac.menuKey)==='new',painted);
  check(scope,'menu buttons are at least 44px tall',await page.evaluate(()=>[...document.querySelectorAll('#p3Menu button')].every(b=>b.getBoundingClientRect().height>=44)));
  check(scope,'no sideways scroll on the menu',(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))===0);
  await page.locator('[data-pm="training"]').click();
  check(scope,'choosing Training changes the Go button',await page.evaluate(()=>window.__tac.menuKey)==='training'&&(await page.locator('#pmGo').textContent())==='Start training');
  await page.locator('[data-pm="graphics"]').click();await page.locator('[data-pm="graphics"]').click();
  check(scope,'tapping Graphics again changes the setting and keeps it',await page.evaluate(()=>window.__tac.gfx)==='high'&&await page.evaluate(()=>localStorage.getItem('prim3.tactics.preview.gfx'))==='high');
  await page.locator('[data-pm="graphics"]').click();await page.locator('[data-pm="graphics"]').click();
  check(scope,'Graphics cycles to Battery saver',await page.evaluate(()=>window.__tac.gfx)==='low');
  await page.locator('[data-pm="training"]').click();await page.locator('#pmGo').click();
  check(scope,'Go plays the camera dive before leaving',await page.evaluate(()=>window.__tac.menuLaunching));
  await page.waitForFunction(()=>!window.__tac.menuOpen,null,{timeout:20000});
  await page.waitForFunction(()=>window.__tac.mode3d,null,{timeout:20000});
  check(scope,'Start training opens the game with the optional hint card',!!(await page.evaluate(()=>window.__tac.session))&&await page.locator('#tacSheet').isVisible());
  check(scope,'the battlefield uses the chosen graphics tier',await page.evaluate(()=>window.__tac.tier)==='low');
  const before=await page.evaluate(()=>JSON.stringify(window.__tac.state.units.find(u=>u.id==='E1')));
  check(scope,'training moved nobody and spent nothing',before===JSON.stringify(await page.evaluate(()=>window.__tac.state.units.find(u=>u.id==='E1'))));
  // a played turn → the menu offers Continue first, and New mission resets
  await page.evaluate(()=>window.__tac.ui);await page.locator('#tacEnd').click();await page.waitForTimeout(200);
  const round=await page.evaluate(()=>window.__tac.state.round);
  await page.locator('#tacMenuOpen').click();await page.waitForFunction(()=>window.__tac.menuKey,null,{timeout:20000});
  check(scope,'the Menu button reopens the menu with Continue first',(await opts())[0]==='continue'&&/Turn 0?\d+/.test(await page.locator('[data-pm="continue"]').textContent()),await opts());
  await page.locator('#pmGo').click();await page.waitForFunction(()=>!window.__tac.menuOpen,null,{timeout:20000});
  check(scope,'Continue returns to the same mission',await page.evaluate(()=>window.__tac.state.round)===round);
  await page.locator('#tacMenuOpen').click();await page.waitForFunction(()=>window.__tac.menuKey,null,{timeout:20000});
  await page.locator('[data-pm="new"]').click();await page.locator('#pmGo').click();await page.waitForFunction(()=>!window.__tac.menuOpen,null,{timeout:20000});
  check(scope,'New mission starts over at turn 1',await page.evaluate(()=>window.__tac.state.round)<round);
  await page.reload();await page.waitForFunction(()=>window.__tac&&window.__tac.menuOpen,null,{timeout:20000});
  check(scope,'after a reload the menu offers Continue',(await opts())[0]==='continue',await opts());
  if(vp.width===390){await page.waitForTimeout(800);await page.screenshot({path:join(OUT,'prim3-tactics-menu-390.png')});}
  check(scope,'no page errors',!errors.length,errors);
  await ctx.close();await browser3.close();
}
/* three.js unreachable: the game falls back to the 2D grid and still plays */
{
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await ctx.addInitScript(()=>{try{localStorage.setItem('mccdb_session',JSON.stringify({access_token:'e2e-owner',expires_at:Math.floor(Date.now()/1000)+3600}));}catch(e){}});
  await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.href.startsWith('https://api.mccluster.org/v1/status'))return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"ok":true}'});if(u.origin!==BASE)return route.abort();const f=resolve(ROOT,decodeURIComponent(u.pathname).slice(1));try{return route.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${BASE}/prim3-tactics-preview.html?menu=0`);await page.waitForSelector('#tacBoard .tb-cell');
  await page.waitForFunction(()=>window.__tac&&!window.__tac.loading3d,null,{timeout:10000});
  check('fallback','with three.js blocked the 2D grid is shown and says why',await page.evaluate(()=>!window.__tac.mode3d&&getComputedStyle(document.getElementById('tacBoard')).display!=='none')&&/2D grid/.test(await page.locator('#tacSheet').innerText()));
  await page.locator('#tacBoard .tb-cell[data-x="1"][data-y="2"]').click();
  check('fallback','the fallback board still plays (menu opens)',await page.locator('#tacMenu [data-act="move"]').count()===1);
  await page.goto(`${BASE}/prim3-tactics-preview.html`);await page.waitForSelector('#pmList [data-pm]');
  await page.waitForFunction(()=>document.getElementById('menu3d').classList.contains('no-3d'),null,{timeout:10000});
  check('fallback','with three.js blocked the main menu still shows its buttons (no scene)',await page.locator('#pmList [data-pm]').count()>=3);
  await page.locator('#pmGo').click();
  check('fallback','and its Go button still enters the game',await page.evaluate(()=>!window.__tac.menuOpen)&&await page.locator('#tacBoard').isVisible());
  check('fallback','no page errors',!errors.length,errors);
  await ctx.close();
}
await browser.close();
const failed=results.filter(r=>!r.pass);console.log(`${results.length-failed.length}/${results.length} passed`);process.exit(failed.length?1:0);
