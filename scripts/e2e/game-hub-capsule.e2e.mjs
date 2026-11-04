// Real browser, local HTTP only. Owner API is a fixture; no production session or writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '/opt/node-tools/node_modules','package.json'))('playwright');
const root = resolve('.');
const server = createServer(async (req,res) => {
  const path = resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!path.startsWith(root+'/')) {res.writeHead(403).end(); return;}
  try { const data=await readFile(path); res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(path)] || 'application/octet-stream');res.end(data); }
  catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
await mkdir('/tmp/game-hub-selector-evidence',{recursive:true});
const errors=[];
try {
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'});
 // A valid silent WAV exercises real browser media events without streaming a production asset.
 const wav=Buffer.alloc(44+8000*2*60);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 await context.route('**/*',route=>{
 const u=new URL(route.request().url());
 if(/\.(mp3|wav|m4a)(?:$|\?)/.test(u.href)) return route.fulfill({contentType:'audio/wav',body:wav});
 if(u.origin===base) return route.continue();
 if(u.href==='https://api.mccluster.org/v1/status') return route.fulfill({json:{ok:true},headers:{'access-control-allow-origin':'*'}});
 return route.abort();
 });
 await context.addInitScript(()=>{
 localStorage.setItem('mccdb_session',JSON.stringify({access_token:'local-test-fixture'}));
 localStorage.setItem('mcc.gamehub.music.v1',JSON.stringify({modules:{chem108:{track:1,time:12}}}));
 const NativeAudio=window.Audio;window.audioCount=0;window.Audio=function(...args){window.audioCount++;return new NativeAudio(...args);};
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const url=base+'/game-hub.html#m=chem108&play=molecule-rush';
 await page.goto(url);await page.locator('[data-start]').waitFor();
 const toggle=page.locator('[data-capsule-toggle]'), handle=page.locator('[data-capsule-drag]');
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await page.waitForFunction(()=>!!window.MCC_MUSIC);
 assert.equal(await page.evaluate(()=>audioCount),1,'one shared audio transport');
 await page.locator('[data-hub-music-play]').tap();
 await page.waitForFunction(()=>MCC_MUSIC.audio.paused===false);
 const first=await page.evaluate(()=>MCC_MUSIC.current().title);
 await page.locator('[data-music-next]').tap();
 await page.waitForFunction(first=>MCC_MUSIC.current().title!==first,first);
 const song=await page.evaluate(()=>MCC_MUSIC.current().title);
 await toggle.tap();await page.locator('[data-module=prim3-security]').tap();
 assert.equal(await page.evaluate(()=>MCC_MUSIC.current().title),song);
 assert.equal(await page.evaluate(()=>MCC_MUSIC.audio.paused),false);
 await page.locator('[data-hub-music-play]').tap();
 assert.equal(await page.evaluate(()=>MCC_MUSIC.audio.paused),true);
 assert.equal(await page.locator('#musicMini').isVisible(),false);
 await page.goto(url);await page.locator('[data-start]').waitFor();
 await handle.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
 const moved=await page.locator('#ghCapsule').boundingBox();assert.ok(moved.x>12&&moved.y>64);
 await toggle.focus();await page.keyboard.press('Enter');
 assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 await page.locator('button[data-module=chem108]').focus();await page.keyboard.press('Escape');
 assert.equal(await toggle.evaluate(el=>el===document.activeElement),true);
 const h=await handle.boundingBox();await page.mouse.move(h.x+20,h.y+20);await page.mouse.down();await page.mouse.move(h.x+100,h.y+110,{steps:10});await page.mouse.up();
 const saved=await page.evaluate(()=>localStorage.getItem('mcc.gamehub.capsule.v1'));assert.ok(saved);
 await page.reload();await page.locator('[data-start]').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('mcc.gamehub.capsule.v1')),saved);
 // Real touch pointer sequence on the dedicated handle, not synthetic DOM drag events.
 const session=await context.newCDPSession(page);const touch=await handle.boundingBox();
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touch.x+20,y:touch.y+20}]});
 await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+20,y:touch.y+60}]});
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.ok((await handle.boundingBox()).y>touch.y,'touch drag moves controls');
 assert.equal(await toggle.getAttribute('aria-expanded'),'false','drag does not expand');
 await toggle.click();await page.locator('[data-capsule-move=reset]').click();await page.keyboard.press('Escape');
 const reset=await page.locator('#ghCapsule').boundingBox();assert.equal(reset.x,12);assert.equal(reset.y,64);
 for(const [width,height] of [[320,568],[390,568],[390,844],[844,390],[1024,768]]) {
  await page.setViewportSize({width,height});await page.locator('[data-start]').click();
  for(const expanded of [false,true]) {
   if(expanded) await toggle.click();
   for(const answer of await page.locator('.mr-opt').all()) {
    await answer.scrollIntoViewIfNeeded();
    assert.ok(await answer.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`answer hit target ${width} expanded=${expanded}`);
   }
   assert.ok(await page.evaluate(()=>{const a=document.querySelector('#ghCapsule').getBoundingClientRect(),b=document.querySelector('#ghMain').getBoundingClientRect();return a.bottom<=b.top&&b.height>=80;}),'reserved workspace');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),'no horizontal overflow');
   if(expanded) await page.keyboard.press('Escape');
  }
  await page.screenshot({path:`/tmp/game-hub-selector-evidence/playing-${width}x${height}.png`});
  await page.locator('.mr-opt').first().click();await page.locator('[data-answer-title]').waitFor();
  await page.reload();await page.locator('[data-start]').waitFor();
 }
 await page.setViewportSize({width:390,height:844});
 await page.addStyleTag({content:'html{font-size:200%}'});
 await page.locator('[data-start]').click();
 await page.locator('.mr-opt').first().click();await page.locator('[data-answer-title]').waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),'200% text no page overflow');
 await page.screenshot({path:'/tmp/game-hub-selector-evidence/text-200.png'});
 if(process.env.AXE_PATH) {await page.addScriptTag({path:process.env.AXE_PATH});const result=await page.evaluate(()=>axe.run('#ghCapsule'));assert.deepEqual(result.violations.map(v=>v.id),[]);}
 const fallback=await context.newPage();
 await fallback.route('**/js/music-engine.js',route=>route.abort());
 await fallback.goto(url);await fallback.locator('[data-start]').click();
 await fallback.getByText('Music unavailable',{exact:true}).waitFor();
 assert.equal(await fallback.locator('[data-hub-music-play]').isDisabled(),true);
 assert.equal(await fallback.locator('.mr-opt').count(),4,'music failure does not block study');
 await fallback.close();
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mcc.gamehub.music.v1')).modules.chem108.time),12,'legacy music preferences preserved');
 console.log('PASS: one real shared transport, playback/course switch/next/pause, mouse/touch/keyboard movement, reset/persistence, collapse/focus, answer hit-testing compact+expanded at 320/390/844/1024, 200% text, screenshots. Auth and audio fixtures; actual shared navigation loaded.');
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
