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
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
  await context.addInitScript(()=>localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()})));
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin==='https://api.mccluster.org'&&u.pathname==='/v1/projects/vaunt')return route.fulfill({status:404,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:false,code:'project_not_found'})});
   if(u.origin!==BASE)return route.fulfill({status:200,contentType:'application/json',body:'{}'});
   const file=resolve(ROOT,'.'+u.pathname);
   if(!file.startsWith(ROOT+'/'))return route.abort();
   try{return route.fulfill({status:200,contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE+'/index.html?front=house');
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
  await page.screenshot({path:join(OUT,`cabin-${width}.png`)});
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
  results.push({width,height,pass:true,checks:'portfolio, ordering, album links, cabin consent/Escape, auth transition, overflow, JS errors'});
  console.log('PASS',width,height);
  await context.close();
 }
} finally {await writeFile(join(OUT,'results.json'),JSON.stringify(results,null,2));await browser.close();}
