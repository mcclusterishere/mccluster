/* Actual rider page and World transport module. The World shell is isolated from
   auth/feed/Cesium for this UI proof; existing suites cover those integrations.
   PLAYWRIGHT_DIR=/path/to/node_modules PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium node scripts/e2e/whip-driving-demo.e2e.mjs */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTravelAndMissions } from './world-switch.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules','x'));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const base='http://whip.test';
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json'};
const out=process.argv[2] || '/tmp/whip-driving-proof'; await mkdir(out,{recursive:true});
let assertions=0; const check=value=>{assert.ok(value);assertions++;};
try {
for (const width of [390,1280]) {
 const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});
 const page=await context.newPage(), unexpected=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!==base){unexpected.push(u.href);return route.abort();}
  let path=u.pathname==='/'?'/whip/rider/index.html':u.pathname;
  try {
   let body=await readFile(join(ROOT,path));
   if(path==='/mnet.html') {
    body=withTravelAndMissions(body).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi,'<iframe id="mnWorldFrame" src="about:blank"></iframe>');
    body=body.replace('</body>','<script type="module" src="/js/travel/world-travel.mjs"></script></body>');
   }
   await route.fulfill({status:200,contentType:types[extname(path)]||'application/octet-stream',body});
  }catch{await route.fulfill({status:404,body:''});}
 });
 await page.goto(base); await page.locator('#wtBookWhip').waitFor();
 check((await page.locator('main').innerText()).includes('No real ride is booked.'));
 for (const entry of ['rider','world']) {
  if(entry==='world') {
   await page.goto(base+'/mnet.html?mode=travel');
   await page.locator('#wtBookWhip').waitFor({state:'attached'});
   // Isolate the transport panel from host overlays; do not alter its content or gate.
   await page.evaluate(()=>{const p=document.querySelector('#wtPlanner');document.body.replaceChildren(p,document.querySelector('#wtWhipDialog'));p.style.cssText='position:relative;display:block;width:100%;max-width:100%;height:auto;max-height:none;transform:none';document.querySelector('#wtRidePanel').hidden=false;});
   check(await page.locator('[data-travel-chip="flights"]').isHidden());
   check(await page.locator('[data-travel-kind="walk"]').isHidden());
   check(await page.locator('[data-travel-sub="rentals"]').isHidden());
   check(await page.locator('#wtUber').isHidden());
   check((await page.locator('#wtPlanner').innerText()).includes('Driving & cab demo.'));
  }
  const before=unexpected.length;
  await page.locator('#wtBookWhip').click();
  check(await page.locator('#wtWhipDialog').isVisible());
  await page.locator('#weDemoRoute').selectOption({index:1});
  await page.locator('#weDemoReview').click();
  check((await page.locator('#weDemoJourney').innerText())==='Library to grocery store');
  await page.locator('#weDemoInvite').click();
  const text=await page.locator('#weDemoInvitation').innerText();
  check(text.includes('maximum of 49 drivers')&&text.includes('not enrollment'));
  check(text.includes('Paid fares and financial design are deferred'));
  check(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
  check(await page.locator('#wtWhipDialog').evaluate(e=>e.scrollWidth===e.clientWidth));
  check(await page.locator('#wtWhipDialog input').count()===0);
  await page.screenshot({path:join(out,`${entry}-${width}.png`)});
  await page.keyboard.press('Escape');
  check(await page.locator('#wtWhipDialog').isHidden());
  check(await page.locator('#wtBookWhip').evaluate(e=>e===document.activeElement));
  await page.locator('#wtBookWhip').click();
  check(await page.locator('#weDemoExplore').isVisible());
  await page.locator('#weDemoClose').click();
  check(unexpected.length===before);
  check(await page.evaluate(()=>localStorage.length===0&&sessionStorage.length===0));
 }
 check(errors.length===0); await context.close();
}
console.log(`${assertions} browser assertions passed; screenshots: ${out}`);
} finally {await browser.close();}
