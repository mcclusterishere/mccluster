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
try {
 for (const [width,height] of [[390,844],[820,1180],[1180,820],[1440,1000]]) {
  const context=await browser.newContext({viewport:{width,height},reducedMotion:width===1180?'no-preference':'reduce'});
  const historyEvents=[];
  await context.exposeBinding('__recordHistoryEvent',({frame},event)=>historyEvents.push({...event,main:frame===frame.page().mainFrame()}));
  await context.addInitScript(()=>{
    for(const type of ['popstate','hashchange','pageshow','pagehide','pagereveal','pageswap'])addEventListener(type,event=>{
      window.__recordHistoryEvent({type,url:location.href,at:Date.now(),persisted:event.persisted,
        state:document.readyState,scrollY,holding:window.__MCC_FRONT_HOLDING?.(),transition:!!event.viewTransition});
    });
  });
  // Wait for real cross-document reveal completion before the next user action.
  // Engine readiness alone can precede Chromium's input-blocking snapshot.
  await context.addInitScript(()=>addEventListener('pagereveal',event=>{
    window.__previewReveal=event.viewTransition ? event.viewTransition.finished.catch(()=>{}) : Promise.resolve();
  }));
  await context.addInitScript(()=>localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()})));
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin==='https://api.mccluster.org' && u.pathname==='/v1/projects/vaunt')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'project_not_found'})});
   if(u.origin!==BASE)return route.fulfill({status:200,contentType:'application/json',body:'{}'});
   const file=resolve(ROOT,'.'+u.pathname);
   if(!file.startsWith(ROOT+'/'))return route.abort();
   try{return route.fulfill({status:200,contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('framenavigated',frame=>historyEvents.push({type:'framenavigated',main:frame===page.mainFrame(),url:frame.url(),at:Date.now()}));
  page.on('request',request=>{if(request.isNavigationRequest())historyEvents.push({type:'navigation-request',url:request.url(),main:request.frame()===page.mainFrame(),at:Date.now()});});
  page.on('requestfailed',request=>{if(request.isNavigationRequest())historyEvents.push({type:'navigation-failed',url:request.url(),error:request.failure(),at:Date.now()});});
  const cdp=await context.newCDPSession(page);
  async function historySnapshot(label){
    const history=await cdp.send('Page.getNavigationHistory');
    const runtime=await Promise.race([page.evaluate(()=>({url:location.href,ready:document.readyState,scrollY,holding:window.__MCC_FRONT_HOLDING?.(),transition:!!document.activeViewTransition,frames:[...document.querySelectorAll('iframe')].map(f=>({src:f.src,url:f.contentWindow?.location.href}))})).catch(error=>({error:error.message})),new Promise(resolve=>setTimeout(()=>resolve({evaluation:'timed out'}),2000))]);
    const proof={label,url:page.url(),runtime,history,events:historyEvents.slice(-40)};
    await writeFile(join(OUT,`history-${width}-${label}.json`),JSON.stringify(proof,null,2));
    console.log('HISTORY',width,label,JSON.stringify(proof));
  }
  async function browserBack(label){
    await historySnapshot(label+'-before');
    const timer=setTimeout(()=>historySnapshot(label+'-pending').catch(()=>{}),5000);
    try{await page.goBack({waitUntil:'commit'});}
    catch(error){await historySnapshot(label+'-failed');throw error;}
    finally{clearTimeout(timer);}
    await historySnapshot(label+'-after');
  }
  try {
  await page.goto(BASE+'/index.html?front=house',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(3000);
  assert.equal(await page.locator('#work.project-feature').count(),1);
  assert.equal(await page.locator('#cmdCanvas5,#cmdCanvas4,#workVR').count(),0);
  assert.equal(await page.evaluate(()=>window.__MCC_ERR||null),null);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  assert.ok(await page.locator('#work').evaluate(el=>el.offsetHeight)<1000);
  await page.locator('#work').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({path:join(OUT,`portfolio-${width}.png`)});
  if(width===820){await page.locator('[data-cta="vaunt-project"]').focus();await page.keyboard.press('Enter');}
  else await page.locator('[data-cta="vaunt-project"]').click({noWaitAfter:true});
  await page.waitForFunction(()=>document.documentElement.dataset.frontState==='ready'&&!!window.__MCC_FRONT_GOTO);
  assert.match(await page.title(),/Vaunt/);
  await page.waitForFunction(()=>document.querySelector('[data-appnav="home"] img')?.src.includes('vaunt-logo.webp'));
  assert.ok(Math.abs(await page.locator('#work').evaluate(el=>el.getBoundingClientRect().top))<2);
  assert.equal(await page.locator('.hero').isVisible(),false);
  assert.notEqual(await page.locator('#guestWorld iframe').getAttribute('loading'),'lazy');
  assert.equal(await page.locator('#guestWorld iframe').getAttribute('src'),null);
  assert.equal(await page.locator('#work .scene-intro h1').isVisible(),true);
  assert.doesNotMatch(await page.locator('#work .scene-intro').textContent(),/independent|official|endorse/i);
  assert.equal(await page.locator('[data-appnav="home"]').getAttribute('href'),BASE+'/front.html?project=vaunt');
  await page.evaluate(()=>window.__previewReveal);
  await page.waitForFunction(()=>window.__MCC.ready('vauntlive')&&window.__MCC.loadedMax('vauntlive')>=30);
  await page.locator('#cmdCanvas5').evaluate(c=>{window.__firstRunwayFrame=c.toDataURL();});
  await page.mouse.wheel(0,160);
  await page.waitForFunction(()=>scrollY>50&&document.querySelector('#cmdCanvas5').toDataURL()!==window.__firstRunwayFrame);
  await page.evaluate(()=>delete window.__firstRunwayFrame);
  await page.locator('[data-appnav="home"]').click();
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(()=>window.scrollY)<4);
  assert.equal(await page.locator('#work .scene-intro').isVisible(),true);

  assert.match(await page.locator('.front-project-note').textContent(),/Managed by Matthew McCluster/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  assert.equal(await page.evaluate(()=>window.MCC_FRONT.config.media.scene1.prefix),'vauntlive_');
  assert.equal(await page.evaluate(()=>window.MCC_FRONT.config.media.scene2.prefix),'vaunt_');
  assert.equal(await page.locator('a[href="album.html?album=vaunt-ep"]').count(),3);
  await page.screenshot({path:join(OUT,`vaunt-${width}.png`)});
  await page.evaluate(()=>window.__MCC_FRONT_GOTO('cabin'));
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>window.__MCC_FRONT_HOLDING()),true);
  await page.screenshot({path:join(OUT,`cabin-${width}.png`)});
  await page.locator('#vrGateAllow').click();
  await page.waitForTimeout(500);
  await page.locator('[data-appnav="home"]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.__MCC_FRONT_HOLDING()),false);
  assert.equal(await page.locator('#work .scene-intro').isVisible(),true);
  await page.evaluate(()=>window.__MCC_FRONT_GOTO('cabin'));
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>window.__MCC_FRONT_HOLDING()),false);
  await page.locator('#guestWorld').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#guestWorld').isVisible(),true);
  await page.waitForFunction(()=>document.querySelector('#guestWorld iframe').contentWindow.location.pathname==='/guest-globe.html');
  assert.equal(await page.locator('[data-world-entry]').getAttribute('href'),'account.html');
  await page.screenshot({path:join(OUT,`world-${width}.png`)});
  // Page branding is local, safe and independent of account privileges.
  const musicHref=await page.locator('[data-appnav="music"]').getAttribute('href');
  await page.evaluate(()=>window.MCC_BAR.pageProfile({name:'Another project',home:'front.html?project=other'}));
  assert.equal(await page.locator('[data-appnav="home"] .appbar__m--initial').textContent(),'A');
  await page.evaluate(()=>window.MCC_BAR.pageProfile({name:'Unsafe',home:'javascript:alert(1)',logo:'https://bad.example/logo.png'}));
  assert.ok(!(await page.locator('[data-appnav="home"] img').getAttribute('src')).includes('vaunt'));
  assert.equal(await page.locator('[data-appnav="music"]').getAttribute('href'),musicHref);
  await page.goto(BASE+'/front.html?project=vaunt#work',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__MCC_FRONT_GOTO);
  await page.locator('#work .scene-intro a[href="album.html?album=vaunt-ep"]').click({noWaitAfter:true});
  await page.waitForURL('**/album.html?album=vaunt-ep',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>window.__previewReveal);
  assert.ok(!(await page.locator('[data-appnav="home"] img').getAttribute('src')).includes('vaunt'));
  // History restoration need not emit a new DOMContentLoaded event.
  await browserBack('album');
  assert.equal(page.url(),BASE+'/front.html?project=vaunt#work');
  await page.evaluate(()=>window.__previewReveal);
  await page.waitForFunction(()=>!!window.__MCC_FRONT_GOTO);
  assert.ok((await page.locator('[data-appnav="home"] img').getAttribute('src')).includes('vaunt-logo'));
  await page.locator('#work .scene-intro a[href="index.html#work"]').click({noWaitAfter:true});
  await page.waitForURL('**/index.html#work',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>window.__previewReveal);
  assert.ok(!(await page.locator('[data-appnav="home"] img').getAttribute('src')).includes('vaunt'));
  // History restoration need not emit a new DOMContentLoaded event.
  await browserBack('portfolio');
  assert.equal(page.url(),BASE+'/front.html?project=vaunt#work');
  await page.evaluate(()=>window.__previewReveal);
  await page.waitForFunction(()=>!!window.__MCC_FRONT_GOTO);
  // The shell's existing verified auth contract drives the CTA; no permissions are fabricated.
  await page.evaluate(()=>{window.MCC_BAR=Object.assign({},window.MCC_BAR,{refreshAuth:()=>Promise.resolve({verified:true,signed_in:true})});window.dispatchEvent(new Event('mcc:auth-changed'));});
  await page.waitForFunction(()=>document.querySelector('[data-world-entry]').textContent==='Enter the World →');
  assert.equal(await page.locator('#guestWorld').isVisible(),true);
  await page.evaluate(()=>{window.MCC_BAR=Object.assign({},window.MCC_BAR,{refreshAuth:()=>Promise.resolve({verified:true,signed_in:false})});window.dispatchEvent(new Event('mcc:auth-changed'));});
  await page.waitForFunction(()=>document.querySelector('[data-world-entry]').getAttribute('href')==='account.html');
  assert.equal(await page.evaluate(()=>window.__MCC_ERR||null),null);
  if(width===820){
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.__MCC_FRONT_GOTO);
    await page.evaluate(()=>window.__MCC_FRONT_GOTO('cabin'));
    await page.waitForTimeout(1000);
    await page.locator('#vrGateDeny').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(()=>window.__MCC_FRONT_HOLDING()),false);
  }
  assert.deepEqual(errors,[]);
  results.push({width,height,pass:true,checks:'scroll-first arrival/scrubbing, portfolio, ordering, deep entry, album/back, cabin consent/Escape/home, contextual branding/fallback/cross-profile reset, auth transition, overflow, JS errors'});
  console.log('PASS',width,height);
  } catch(error) { await historySnapshot('failure'); throw error; }
  await context.close();
 }
} finally {await writeFile(join(OUT,'results.json'),JSON.stringify(results,null,2));await browser.close();}
