// Actual pages/navigation/media transport. All identity, API and audio bytes are
// fixtures; no production requests, credentials, scores or account changes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, join, extname} from 'node:path';
const {chromium}=createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '/opt/node-tools/node_modules','package.json'))('playwright');
const ROOT=resolve('.'), BASE='https://matthew.mccluster.org';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const wav=Buffer.alloc(44+8000*2*180);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader']});
await mkdir('/tmp/music-journeys-proof',{recursive:true});
try {
 for (const width of [390,844]) {
  const context=await browser.newContext({viewport:{width,height:width===844?390:844},hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});
  let owner=true, failRoom=false;
  const calls=[],errors=[];
  await context.addInitScript(()=>{
    try { localStorage.getItem('mcc_privacy_ack'); } catch { return; }
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(!localStorage.getItem('mccdb_session')){const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({sub:'11111111-1111-4111-8111-111111111111',exp}))+'.y',expires_at:exp,user:{id:'11111111-1111-4111-8111-111111111111'}}));}
    window.__audios=0;const Audio=window.Audio;window.Audio=function(...args){window.__audios++;return new Audio(...args);};
  });
  await context.route('**/*',async r=>{
    const u=new URL(r.request().url());calls.push(u.href);
    if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
    const json=(body,status=200)=>r.fulfill({status,json:body,headers:{'access-control-allow-origin':'*'}});
    if(/\.(mp3|wav|m4a)$/.test(u.pathname)) {
      const range=/bytes=(\d+)-(\d*)/.exec(r.request().headers().range||'');
      if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||wav.length-1),wav.length-1);return r.fulfill({status:206,contentType:'audio/wav',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${wav.length}`},body:wav.subarray(start,end+1)});}
      return r.fulfill({contentType:'audio/wav',headers:{'accept-ranges':'bytes'},body:wav});
    }
    if(u.hostname==='api.mccluster.org'){
      if(u.pathname.startsWith('/v1/music/gates/'))return json({gate:{allowed:false}});
      if(u.pathname==='/v1/status')return json({ok:owner},owner?200:403);
      if(u.pathname==='/v1/workspaces/me')return json({ok:true,profile:{id:'11111111-1111-4111-8111-111111111111'},default_org_id:'o1',workspaces:[{org_id:'o1',slug:'mccluster',name:'McCluster',kind:'studio',role:owner?'owner':'viewer',enabled:true}]});
      return json({ok:true,threads:[],apps:[],posts:[],events:[],jobs:[],tools:[],decisions:[],missions:[],layers:[],workspaces:[],sources:[],features:[]});
    }
    if(u.hostname.endsWith('supabase.co'))return json(u.pathname==='/auth/v1/user'?{id:'11111111-1111-4111-8111-111111111111'}:[]);
    if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/three@0.180.0/')) {
      const f=resolve(process.env.THREE_DIR || '/tmp/music-journey-deps/node_modules/three',u.pathname.slice('/npm/three@0.180.0/'.length));
      try {return r.fulfill({body:await readFile(f),contentType:'text/javascript'});}catch{return r.abort();}
    }
    if(u.origin===BASE){
      if(failRoom&&u.pathname==='/prim3.html')return typeof failRoom==='number'?r.fulfill({status:failRoom,contentType:'text/html',body:'<!doctype html><title>Unavailable</title><p>Fixture page unavailable</p>'}):r.abort();
      const f=resolve(ROOT,'.'+decodeURIComponent(u.pathname));
      if(f.startsWith(ROOT+'/')){try{return r.fulfill({body:await readFile(f),contentType:MIME[extname(f)]||'application/octet-stream'});}catch{}}
      return r.fulfill({status:404,body:'Missing fixture file'});
    }
    return r.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE+'/game-hub.html#m=chem108&play=molecule-rush');
  await page.locator('[data-start]').waitFor();
  await page.locator('[data-hub-music-play]').click();
  await page.waitForFunction(()=>MCC_MUSIC.current()&&!MCC_MUSIC.audio.paused);
  await page.evaluate(()=>{window.__originalAudio=MCC_MUSIC.audio;window.__song=MCC_MUSIC.current().title;window.__unloads=0;addEventListener('beforeunload',()=>__unloads++);});
  await page.locator('[data-start]').click();
  const question=await page.locator('[data-q]').innerHTML();
  const start=await page.evaluate(()=>MCC_MUSIC.audio.currentTime);
  async function go(path){await page.evaluate(url=>MCC_BAR.navigation.go(url),BASE+path);await page.waitForFunction(()=>!!window.MCC_MUSIC_JOURNEYS?.active());}
  async function room(path){const frame=page.frameLocator('#mccMusicRoom iframe');await frame.locator('html').waitFor();await page.waitForFunction(path=>{const f=document.querySelector('#mccMusicRoom iframe');return f?.contentWindow.location.pathname===path&&f.contentWindow.__mccMusicRoomAttached;},path);return frame;}
  async function retained(){assert.ok(await page.evaluate(()=>__originalAudio===MCC_MUSIC.audio&&!MCC_MUSIC.audio.paused&&__unloads===0));}
  await go('/listen.html');let f=await room('/listen.html');await f.locator('#q').waitFor();await retained();
  await page.locator('.appbar [data-appnav=music][aria-current=page]').waitFor();
  const handle=page.locator('#mccJourneyCapsule [data-capsule-drag]');await handle.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Home');
  if(process.env.AXE_PATH){await page.addScriptTag({path:process.env.AXE_PATH});const result=await page.evaluate(()=>axe.run('#mccJourneyCapsule'));assert.deepEqual(result.violations.map(v=>v.id),[]);}
  assert.equal(await f.locator('body').evaluate(()=>window.MCC_MUSIC===parent.MCC_MUSIC),true);
  assert.equal(await f.locator('body').evaluate(()=>window.__audios),0);
  await page.locator('#mccJourneyCapsule [data-capsule-toggle]').click();
  await page.locator('[data-context]').click();assert.ok(await f.locator('#q').evaluate(el=>el===document.activeElement));
  // A real Listen play button must still operate the original engine.
  const title=await page.evaluate(()=>MCC_MUSIC.current().title);
  const titles=await f.locator('[data-music-play]').evaluateAll(nodes=>nodes.map(n=>n.dataset.track));
  await f.locator('[data-music-play]').nth(titles.findIndex(t=>t!==title)).click();
  await page.waitForFunction(()=>MCC_MUSIC.current().title!==__song);
  console.log('Listen controls passed');
  await page.locator('#mccJourneyCapsule [data-play]').click();assert.ok(await page.evaluate(()=>MCC_MUSIC.audio.paused));
  await page.locator('#mccJourneyCapsule [data-play]').click();await retained();
  await go('/control.html#home:today');f=await room('/control.html');await f.locator('#crSurface').waitFor();await retained();
  await page.locator('#mccControlToggle[aria-current=page]').waitFor();
  // One host history step per same-room fragment change; the iframe replaces its
  // fragment entry and never adds a second joint-session-history stop.
  await go('/control.html#home:ask');await room('/control.html');
  await page.waitForFunction(()=>document.querySelector('#mccMusicRoom iframe').contentWindow.location.hash==='#home:ask');
  await page.evaluate(()=>history.back());
  await page.waitForFunction(()=>document.querySelector('#mccMusicRoom iframe').contentWindow.location.hash==='#home:today');await retained();
  await page.evaluate(()=>history.forward());
  await page.waitForFunction(()=>document.querySelector('#mccMusicRoom iframe').contentWindow.location.hash==='#home:ask');await retained();
  assert.ok(await page.locator('#mccJourneyCapsule').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('#mccMusicRoom').getBoundingClientRect().top));
  await go('/prim3.html');f=await room('/prim3.html');await f.locator('#courseGate, #course').first().waitFor({state:'attached'});await retained();
  await page.evaluate(()=>history.back());await room('/control.html');await retained();
  await page.evaluate(()=>history.forward());await room('/prim3.html');await retained();
  await go('/prim3-transit.html');f=await room('/prim3-transit.html');
  await f.locator('html[data-owner-access="open"]').waitFor();await f.locator('canvas').first().waitFor();await retained();
  await page.screenshot({path:`/tmp/music-journeys-proof/standalone-${width}.png`});
  // Return to source without re-creating its audio or writing an assessment.
  await page.evaluate(url=>MCC_BAR.navigation.go(url),BASE+'/game-hub.html#m=chem108&play=molecule-rush');
  await page.waitForFunction(()=>!MCC_MUSIC_JOURNEYS.active());await page.locator('.mr-opt').first().waitFor();await retained();
  assert.equal(await page.locator('[data-q]').innerHTML(),question,'retained study question unchanged');
  assert.ok(await page.evaluate(t=>MCC_MUSIC.audio.currentTime>t,start));
  assert.equal(await page.evaluate(()=>localStorage.getItem('mcc.gamehub.chem108.v1')),null);
  // Failed room keeps media and offers retry/direct/return, rather than silently unloading.
  for(const failure of [true,503,404]) {
    failRoom=failure;await go('/prim3.html');await page.waitForFunction(()=>document.querySelector('[data-room-status] [role=status]')?.textContent.includes('not finished'),null,{timeout:20000});await retained();
    assert.ok(await page.locator('[data-room-status]').isVisible(),'failed document keeps recovery visible');
    failRoom=false;await page.locator('[data-room-status] [data-retry]').click();await room('/prim3.html');await retained();
    // Leave this room before testing a fresh failed navigation into it.
    await go('/listen.html');await room('/listen.html');
  }
  // A new owner room must refuse a denied role despite the host's old positive check.
  owner=false;await go('/game-hub.html?denied=1');f=await room('/game-hub.html');await f.locator('html[data-owner-access="closed"]').waitFor();
  assert.equal(await f.locator('[data-start]').count(),0);assert.ok(await page.evaluate(()=>__originalAudio===MCC_MUSIC.audio));
  // Legacy rooms without a shared bar still acknowledge their authored owner gate.
  for(const path of ['/screens/terminal.html','/equity-uprise-server-lab-3d.html']) {
    await go(path);f=await room(path);await f.locator('html[data-owner-access="closed"]').waitFor();
    assert.equal(await page.locator('[data-room-status]').isVisible(),false);await retained();
  }
  // Returning to a retained owner source rechecks access before showing private UI.
  await page.evaluate(url=>MCC_BAR.navigation.go(url),BASE+'/game-hub.html#m=chem108&play=molecule-rush');
  await page.locator('html[data-owner-access="closed"]').waitFor();
  assert.equal(await page.locator('[data-start]').count(),0);
  // Listen starts a separate real document, then retains its engine into Games.
  owner=true;const reverse=await context.newPage();await reverse.goto(BASE+'/listen.html');
  await reverse.locator('[data-music-play]').first().click();
  await reverse.waitForFunction(()=>!!MCC_MUSIC.current()&&!MCC_MUSIC.audio.paused);
  await reverse.evaluate(()=>{window.__originalAudio=MCC_MUSIC.audio;});
  await reverse.locator('.appbar [data-appnav=games]').click();
  const game=reverse.frameLocator('#mccMusicRoom iframe');await game.locator('#ghCapsule').waitFor();
  await game.locator('[data-capsule-toggle]').click();await game.locator('button[data-module=chem108]').click();
  await game.locator('[data-play=molecule-rush]').click();await game.locator('[data-start]').waitFor();
  await reverse.locator('.appbar [data-appnav=games][aria-current=page]').waitFor();
  assert.ok(await game.locator('body').evaluate(()=>MCC_MUSIC.audio===parent.__originalAudio));
  assert.equal(await game.locator('body').evaluate(()=>__audios),0);
  await game.locator('[data-hub-music-play]').click();assert.ok(await reverse.evaluate(()=>MCC_MUSIC.audio.paused));
  await game.locator('[data-hub-music-play]').click();await reverse.waitForFunction(()=>!MCC_MUSIC.audio.paused);
  await game.locator('[data-capsule-toggle]').click();await game.locator('button[data-module=prim3-security]').click();
  assert.ok(await reverse.evaluate(()=>MCC_MUSIC.audio===__originalAudio&&!MCC_MUSIC.audio.paused));
  await game.locator('[data-capsule-toggle]').click();await game.locator('button[data-module=chem108]').click();
  await game.locator('[data-play=molecule-rush]').click();await game.locator('[data-start]').click();
  for(const a of await game.locator('.mr-opt').all()) {
    await a.scrollIntoViewIfNeeded();assert.ok(await a.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  }
  assert.ok(await reverse.locator('#mccAuthChip').isVisible(),'host account control remains visible');
  await reverse.screenshot({path:`/tmp/music-journeys-proof/chemistry-${width}.png`});
  await reverse.evaluate(url=>MCC_BAR.navigation.go(url),BASE+'/listen.html');
  await reverse.waitForFunction(()=>!MCC_MUSIC_JOURNEYS.active());
  assert.ok(await reverse.evaluate(()=>MCC_MUSIC.audio===__originalAudio&&!MCC_MUSIC.audio.paused));
  // Locked audio remains a preview across rooms; the shell cannot earn a play.
  const albums=JSON.parse(await readFile(join(ROOT,'data/albums.json'),'utf8')).albums;
  const album=albums.find(a=>a.tracks.some(t=>t.gated)), gated=album.tracks.find(t=>t.gated);
  await reverse.locator('#q').fill(gated.title);
  await reverse.locator('[data-music-play]').first().click();
  await reverse.waitForFunction(()=>MCC_MUSIC.access()==='preview'&&!MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.currentTime>0);
  await reverse.evaluate(url=>MCC_BAR.navigation.go(url),BASE+'/game-hub.html#m=chem108');
  await reverse.frameLocator('#mccMusicRoom iframe').locator('#ghCapsule').waitFor();
  await reverse.waitForFunction(()=>MCC_MUSIC.audio.paused&&MCC_MUSIC.audio.currentTime>=3.8,null,{timeout:8000});
  assert.equal(await reverse.evaluate(()=>MCC_MUSIC.access()),'preview');
  // Changing the canonical account revokes the retained private room, without
  // turning the new account's gated preview into a grant or restarting audio.
  owner=false;
  await reverse.evaluate(()=>{
    const exp=Math.floor(Date.now()/1000)+3600,id='22222222-2222-4222-8222-222222222222';
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({sub:id,exp}))+'.y',expires_at:exp,user:{id}}));
    dispatchEvent(new CustomEvent('mcc:auth-changed'));
  });
  await reverse.frameLocator('#mccMusicRoom iframe').locator('html[data-owner-access="closed"]').waitFor();
  assert.equal(await reverse.frameLocator('#mccMusicRoom iframe').locator('#ghCapsule').count(),0);
  assert.ok(await reverse.evaluate(()=>MCC_MUSIC.audio===__originalAudio&&MCC_MUSIC.audio.paused));
  assert.equal(await reverse.evaluate(()=>MCC_MUSIC.access()),'preview');
  assert.ok(!calls.some(u=>/\/v1\/music\/gates\/[^/]+\/play$/.test(new URL(u).pathname)),'navigation never claims earned audio');
  await context.close();console.log('PASS '+width+' actual Game Hub → Listen → Control → PRIM3 course, back/forward, single original audio, play buttons, recovery and denied owner');
  // Control's optional content can report fixture omissions; browser exceptions are still failures.
  assert.deepEqual(errors,[]);
 }

} finally {await browser.close();}
