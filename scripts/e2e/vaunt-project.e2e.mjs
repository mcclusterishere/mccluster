/* Local files and synthetic API responses only. Never contacts production. */
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const ROOT = process.cwd(), OUT = process.argv[2] || '/tmp/vaunt-proof';
const BASE = 'https://matthew.mccluster.org';
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.mp4':'video/mp4','.mp3':'audio/mpeg'};
await mkdir(OUT,{recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];
async function serve(route){
 const u=new URL(route.request().url());
 if(u.origin!==BASE)return route.fulfill({status:200,contentType:'application/json',body:'{}'});
 const file=resolve(ROOT,'.'+u.pathname);
 if(!file.startsWith(ROOT+'/'))return route.abort();
 try{return route.fulfill({status:200,contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
}
try {
 for (const [width,height] of [[390,844],[820,1180],[1180,820],[1440,1000]]) {
  /* the site's service worker would answer the reload itself, past this test's routing, and wait on the real network */
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',serviceWorkers:'block'});
  await context.addInitScript(()=>localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()})));
  await context.route('**/*',serve);
  /* OWNER, 2026-10-29: index.html opens INSIDE the Vaunt cabin, playing at once, muted, no Allow / Cancel; scrolling,
     Escape or Continue moves on to the plane, then the night descent and LOCK IN, then the World. Antisocial is the one
     song, and the first gesture turns it on. This context has motion on (the cabin plays); the one below has it off. */
  {
   /* phones and tablets with touch, as a visitor's hand would be: the touch path must be gate-free too */
   const mctx=await browser.newContext({viewport:{width,height},serviceWorkers:'block',hasTouch:width<1000,isMobile:false});
   await mctx.addInitScript(()=>localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()})));
   await mctx.route('**/*',serve);
   const home=await mctx.newPage(); const herr=[];
   home.on('pageerror',e=>herr.push(e.message));
   await home.goto(BASE+'/index.html');
   await home.waitForFunction(()=>window.__MCC_VR&&window.__MCC_VR.viewer&&window.__MCC_FRONT_GOTO,null,{timeout:20000});
   await home.waitForTimeout(1200);
   assert.equal(await home.locator('#hero,#orbitCanvas,#hudDeg,#heroFallback').count(),0,'no orbit hero');
   assert.equal(await home.locator('#vrGateAllow,#vrGateDeny,#workVRCompass,#vrGate,.vrbrief--gate').count(),0,'no gate');
   assert.equal(await home.getByText(/Allow to see|Blurred until/i).count(),0,'no Allow / Cancel words anywhere on the page');
   assert.equal(await home.evaluate(()=>matchMedia('(pointer: coarse)').matches||navigator.maxTouchPoints>0),width<1000,'touch path is exercised below 1000px');
   const open=await home.evaluate(()=>{const c=document.getElementById('cabin').getBoundingClientRect(),v=window.__MCC_VR;
     return {top:Math.round(c.top),fills:c.height>=innerHeight-1,live:v.live,playing:v.playing,allowed:v.allowed,muted:v.viewer.media.muted,gated:document.getElementById('workVR').classList.contains('is-gated'),shown:getComputedStyle(document.getElementById('workVR')).opacity,y:scrollY,song:window.MCC_FRONT.config.song};});
   assert.ok(open.top===0&&open.fills&&open.y===0,'the page opens in the cabin: '+JSON.stringify(open));
   assert.ok(open.live&&open.playing&&open.allowed&&open.muted&&!open.gated&&open.shown==='1','the cabin plays at once, muted, ungated: '+JSON.stringify(open));
   assert.equal(open.song,'antisocial');
   assert.equal(await home.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
   /* every tag in the cabin is whole on screen and clear of the page's own words, doors and Continue */
   const tags=await home.evaluate(()=>{
     const R=e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom};};
     const hit=(a,b)=>a.l<b.r&&a.r>b.l&&a.t<b.b&&a.b>b.t;
     const words=[...document.querySelectorAll('#cabinTitle,.cabin-open__k,#cabin .hero__doors a,#cabinContinue,#cabin .workvr__tag')].filter(e=>e.offsetWidth).map(R);
     return [...document.querySelectorAll('#workVR .vr360-spot')].filter(e=>getComputedStyle(e).display!=='none').map(e=>{const s=R(e.querySelector('span')),d=R(e.querySelector('i'));
       return {label:e.textContent,inside:d.l>=0&&s.l>=0&&s.t>=0&&s.r<=innerWidth&&s.b<=innerHeight,clear:!words.some(w=>hit(s,w)||hit(d,w))};});});
   assert.ok(tags.length>0,'the cabin shows its tags');
   assert.ok(tags.every(t=>t.inside&&t.clear),'every visible tag is whole on screen and clear of the title, hint, doors and Continue: '+JSON.stringify(tags));
   await home.screenshot({path:join(OUT,`cabin-${width}.png`)});
   /* the first gesture anywhere turns on Antisocial, and only Antisocial */
   assert.equal(await home.evaluate(()=>document.getElementById('soundToggle').classList.contains('is-on')),false,'silent until a gesture');
   await home.locator('#workVRCanvas').click({position:{x:Math.round(width/2),y:200}});
   await home.waitForFunction(()=>document.getElementById('soundToggle').classList.contains('is-on'),null,{timeout:8000});
   await home.waitForTimeout(800);
   const snd=await home.evaluate(()=>[...document.querySelectorAll('audio[id^="track-"]')].filter(a=>!a.paused&&!a.muted).map(a=>a.id));
   assert.deepEqual(snd,['track-antisocial'],'one song, Antisocial: '+JSON.stringify(snd));
   /* the Sound pill still decides: off stays off through later taps */
   await home.locator('#soundToggle').click();
   await home.locator('#workVRCanvas').click({position:{x:Math.round(width/2),y:200}});
   await home.waitForTimeout(600);
   assert.equal(await home.evaluate(()=>document.getElementById('soundToggle').classList.contains('is-on')),false,'the visitor turned it off: it stays off');
   /* Escape moves on, out of the cabin to the plane; the cabin pauses off screen */
   await home.keyboard.press('Escape');
   await home.waitForFunction(()=>scrollY>=document.getElementById('cabin').offsetHeight-2,null,{timeout:8000});
   await home.waitForTimeout(1500);
   assert.equal(await home.evaluate(()=>window.__MCC_VR.playing),false,'the cabin pauses once it is off screen');
   assert.ok(await home.evaluate(()=>{const w=document.getElementById('work').getBoundingClientRect();return w.top<=1&&w.bottom>innerHeight;}),'the plane has the screen');
   await home.evaluate(()=>window.__MCC_FRONT_GOTO('plane'));
   await home.waitForFunction(()=>window.__MCC.lastDrawn('vaunt')>10,null,{timeout:10000}).catch(()=>{});
   await home.waitForTimeout(800);
   assert.ok(await home.evaluate(()=>window.__MCC.lastDrawn('vaunt')>10),'the fly-through scrubs with the scroll');
   assert.ok(await home.evaluate(()=>{const w=document.getElementById('work').getBoundingClientRect(),c=document.getElementById('cmdCanvas4').getBoundingClientRect();return w.top<0&&w.bottom>innerHeight&&Math.abs(c.top)<=1&&c.height>=innerHeight-1;}),'the plane fills the screen, pinned');
   assert.equal(await home.locator('#cmdCanvas5').count(),0);
   await home.screenshot({path:join(OUT,`plane-${width}.png`)});
   /* the night descent, and LOCK IN at the bottom of it */
   /* through the page's own scroll engine (a native jump can be undone by the smooth scroller mid-glide, on touch most of all) */
   await home.evaluate(()=>window.__MCC_FRONT_GOTO('lockin'));
   await home.waitForFunction(()=>+getComputedStyle(document.getElementById('nightRoom')).opacity>0.9,null,{timeout:10000}).catch(()=>{});
   await home.waitForTimeout(1200);
   const lock=await home.evaluate(()=>({o:+getComputedStyle(document.getElementById('nightRoom')).opacity,room:!!document.querySelector('#lockRoom')}));
   assert.ok(lock.o>0.9&&lock.room,'LOCK IN arrives: '+JSON.stringify(lock));
   await home.screenshot({path:join(OUT,`lockin-${width}.png`)});
   await home.evaluate(()=>window.__MCC_FRONT_GOTO('world'));await home.waitForTimeout(600);
   assert.equal(await home.locator('#guestWorld').isVisible(),true);
   assert.equal(await home.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
   assert.equal(await home.evaluate(()=>window.__MCC_ERR||null),null);
   assert.deepEqual(herr,[]);
   await mctx.close();
  }
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE+'/index.html?front=house');
  await page.waitForTimeout(3000);
  /* reduced motion: the cabin is its poster until it is asked for, and still first */
  const still=await page.evaluate(()=>({first:document.querySelector('main section:not(noscript section)').id,viewer:!!(window.__MCC_VR&&window.__MCC_VR.viewer),look:!document.getElementById('cabinLook').hidden,poster:getComputedStyle(document.querySelector('.cabin-open__poster')).opacity}));
  assert.deepEqual(still,{first:'cabin',viewer:false,look:true,poster:'1'});
  await page.locator('#cabinLook').click();
  await page.waitForFunction(()=>window.__MCC_VR&&window.__MCC_VR.viewer,null,{timeout:10000});
  assert.equal(await page.locator('#work.command--plane').count(),1);
  assert.equal(await page.locator('#cmdCanvas5').count(),0);
  assert.equal(await page.locator('#cmdCanvas4,#workVR').count(),2);
  assert.equal(await page.evaluate(()=>window.__MCC_ERR||null),null);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  await page.evaluate(()=>window.__MCC_FRONT_GOTO('vaunt'));
  await page.waitForTimeout(500);
  await page.screenshot({path:join(OUT,`portfolio-${width}.png`)});
  if(width===820){await page.locator('[data-cta="vaunt-project"]').focus();await page.keyboard.press('Enter');}
  else await page.locator('[data-cta="vaunt-project"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.frontState==='ready'&&!!window.__MCC_FRONT_GOTO);
  assert.match(await page.title(),/Vaunt/);
  assert.match(await page.locator('.front-project-note').textContent(),/Managed by Matthew McCluster/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  assert.equal(await page.evaluate(()=>window.MCC_FRONT.config.media.scene1.prefix),'vauntlive_');
  assert.equal(await page.evaluate(()=>window.MCC_FRONT.config.media.scene2.prefix),'vaunt_');
  assert.equal(await page.locator('a[href="album.html?album=vaunt-ep"]').count(),3);
  await page.screenshot({path:join(OUT,`vaunt-${width}.png`)});
  await page.evaluate(()=>window.__MCC_FRONT_GOTO('cabin'));
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>window.__MCC_FRONT_HOLDING()),true);
  /* the PROJECT page's cabin (front.html?project=vaunt keeps its gate); index.html's own opening is cabin-${width}.png */
  await page.screenshot({path:join(OUT,`project-cabin-${width}.png`)});
  await page.locator('#vrGateAllow').click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>window.__MCC_FRONT_HOLDING()),false);
  await page.locator('#guestWorld').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#guestWorld').isVisible(),true);
  assert.equal(await page.locator('[data-world-entry]').getAttribute('href'),'account.html');
  await page.screenshot({path:join(OUT,`world-${width}.png`)});
  // The shell's existing verified auth contract drives the CTA; no permissions are fabricated.
  await page.evaluate(()=>{window.MCC_BAR={refreshAuth:()=>Promise.resolve({verified:true,signed_in:true})};window.dispatchEvent(new Event('mcc:auth-changed'));});
  await page.waitForFunction(()=>document.querySelector('[data-world-entry]').textContent==='Enter the World →');
  assert.equal(await page.locator('#guestWorld').isVisible(),true);
  await page.evaluate(()=>{window.MCC_BAR={refreshAuth:()=>Promise.resolve({verified:true,signed_in:false})};window.dispatchEvent(new Event('mcc:auth-changed'));});
  await page.waitForFunction(()=>document.querySelector('[data-world-entry]').getAttribute('href')==='account.html');
  assert.equal(await page.evaluate(()=>window.__MCC_ERR||null),null);
  if(width===820){
    await page.reload();
    await page.waitForFunction(()=>!!window.__MCC_FRONT_GOTO);
    await page.evaluate(()=>window.__MCC_FRONT_GOTO('cabin'));
    await page.waitForTimeout(1000);
    await page.locator('#vrGateDeny').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(()=>window.__MCC_FRONT_HOLDING()),false);
  }
  assert.deepEqual(errors,[]);
  results.push({width,height,pass:true,checks:'index opens in the ungated muted cabin, Antisocial on first gesture, Escape to the plane, LOCK IN; reduced-motion poster; project page ordering, album links, cabin consent/Escape, auth transition, overflow, JS errors'});
  console.log('PASS',width,height);
  await context.close();
 }
} finally {await writeFile(join(OUT,'results.json'),JSON.stringify(results,null,2));await browser.close();}
