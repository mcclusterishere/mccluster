// Local browser proof only. Every auth/CRM call is synthetic; all off-origin network is blocked.
// PW_MODULE=/path/to/playwright PW_CHROME=/usr/bin/chromium node scripts/e2e/domain-quote.e2e.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import http from 'node:http';
import { extname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const root = resolve(new URL('../..', import.meta.url).pathname);
const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css'};
const server = http.createServer(async (req,res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://local').pathname);
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try { res.setHeader('content-type',types[extname(path)] || 'application/octet-stream');res.end(await readFile(path)); }
  catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({executablePath:process.env.PW_CHROME || '/usr/bin/chromium',headless:true});
const auth = `window.testOwner={id:'owner-a',name:'Alex Example',email:'alex@example.test',phone:''};
window.MCC_AUTH={user:()=>window.testOwner,signUpPassword:async(email,pw,data)=>{window.testOwner={id:'new-owner',email,name:data.name};window.dispatchEvent(new Event('mcc:auth-changed'));return {session:true};}};
window.MCC_SUPA={url:'${origin}/mock-crm',key:'synthetic',uid:()=>window.testOwner?.id,token:async()=>window.testOwner?'synthetic-token':null};
window.MCC_FAN={load:async()=>null};`;
let assertions = 0;
const check=(actual,expected)=>{assert.deepEqual(actual,expected);assertions++;};
try {
 for (const width of [390,768,1280]) {
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}), page=await context.newPage();
  const errors=[],posts=[];let holdResponse;
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.fulfill({status:204,body:''});
   if(url.pathname==='/js/backend.js')return route.fulfill({contentType:'text/javascript',body:auth});
   if(url.pathname.startsWith('/js/')&&!['/js/onboard.js','/js/offer-crm.js','/js/offers.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   if(url.pathname==='/mock-crm/rest/v1/site_requests'){
    posts.push(route.request().postDataJSON());
    if(holdResponse)await holdResponse;
    return route.fulfill({status:201,body:''});
   }
   return route.continue();
  });
  const url=origin+'/onboard.html?offer=runway&domain=example.test';
  await page.goto(url);await page.locator('#obName').waitFor();
  check(await page.locator('#obName').inputValue(),'Alex Example');
  check(await page.locator('#obEmail').inputValue(),'alex@example.test');
  check(await page.locator('#obStep').textContent(),'Step 1 of 1');
  check(await page.locator('a[href*="pay.html"]').count(),0);
  check(await page.locator('#obStage').innerText().then(x=>/organization|website need|brand name/i.test(x)),false);
  check(await page.locator('#obDomainSummary').innerText(),'example.test');
  check(await page.locator('.ob__domain-summary').innerText().then(x=>x.includes('Checkout is paused')),true);
  check(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  check(await page.locator('#obEmail').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16),true);
  await page.locator('#obEmail').fill('invalid');await page.locator('#obNext').click();
  check(posts.length,0);check(await page.locator('#obErr').isVisible(),true);
  await page.locator('#obEmail').fill('alex+quote@example.test');
  await page.locator('#obName').fill('Alex Saved');
  await page.locator('#obPhone').fill('+1 555 555 0100');
  await page.reload();await page.locator('#obName').waitFor();
  check(await page.locator('#obName').inputValue(),'Alex Saved');
  check(await page.locator('#obPhone').inputValue(),'+1 555 555 0100');
  // Navigation away and Back retains the same draft; no request is submitted by navigation.
  await page.goto(origin+'/sites.html');await page.goBack();await page.locator('#obName').waitFor();
  check(await page.locator('#obName').inputValue(),'Alex Saved');check(posts.length,0);
  // Shared-browser identity changes clear the old account immediately, then hydrate only the new profile.
  await page.evaluate(()=>{window.testOwner={id:'owner-b',name:'Blake Example',email:'blake@example.test'};window.dispatchEvent(new Event('mcc:auth-changed'));});
  await page.waitForFunction(()=>document.getElementById('obName').value==='Blake Example');
  check(await page.locator('#obPhone').inputValue(),'');
  check(await page.locator('#obEmail').inputValue(),'blake@example.test');
  await page.evaluate(()=>{window.testOwner={id:'owner-a',name:'Alex Example',email:'alex@example.test'};window.dispatchEvent(new Event('mcc:auth-changed'));});
  await page.waitForFunction(()=>document.getElementById('obName').value==='Alex Saved');
  check(await page.locator('#obEmail').inputValue(),'alex+quote@example.test');
  if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:resolve(process.env.SCREENSHOT_DIR,`domain-quote-${width}.png`),fullPage:true,animations:'disabled'});}
  // No request may follow a token lookup that has changed owner.
  await page.evaluate(()=>{window.MCC_SUPA.token=async()=>{window.testOwner={id:'owner-b'};return 'new-token';};});
  await page.locator('#obNext').click();await page.waitForFunction(()=>document.getElementById('obName').value==='Blake Example');
  check(posts.length,0);
  await page.evaluate(()=>{window.testOwner={id:'owner-a',name:'Alex Example',email:'alex@example.test'};window.MCC_SUPA.token=async()=>'synthetic-token';window.dispatchEvent(new Event('mcc:auth-changed'));});
  // A slow response and repeated click do not issue a second POST.
  let release;holdResponse=new Promise(r=>{release=r;});
  await page.locator('#obNext').click();
  await page.waitForFunction(()=>document.getElementById('obNext').disabled);
  await page.evaluate(()=>document.getElementById('obNext').click());
  check(posts.length,1);release();
  await page.waitForFunction(()=>document.getElementById('obQ').textContent==='Quote requested.');
  check(posts[0].kind,'onboarding');
  check(posts[0].body.includes('Domain: example.test'),true);
  check(posts[0].body.includes('No purchase, reservation or registrar contact consent.'),true);
  await page.reload();await page.waitForFunction(()=>document.getElementById('obQ').textContent==='Quote requested.');
  check(posts.length,1);check(await page.locator('a[href*="pay.html"]').count(),0);
  // Signed-out contact and account entry stay in the same screen; old owner details are absent.
  await page.evaluate(()=>{window.testOwner=null;window.dispatchEvent(new Event('mcc:auth-changed'));});
  await page.locator('#obPass').waitFor();
  check(await page.locator('#obName').inputValue(),'');
  check(await page.locator('#obEmail').inputValue(),'');
  check(await page.locator('#obStep').textContent(),'Step 1 of 1');
  await page.locator('#obName').fill('Casey New');await page.locator('#obEmail').fill('casey@example.test');
  await page.locator('#obPass').fill('synthetic-test-password');await page.locator('#obNext').click();
  await page.waitForFunction(()=>document.getElementById('obNext').textContent==='Request domain quote');
  check(await page.locator('#obName').inputValue(),'Casey New');
  check(await page.locator('#obEmail').inputValue(),'casey@example.test');
  check(posts.length,1); // Sign-in never submits an old owner's draft or purchases anything.
  // The general service brief still has its existing organization question.
  await page.goto(origin+'/onboard.html?offer=anti-social&mode=m');
  await page.waitForFunction(()=>document.getElementById('obQ')?.textContent==="What's the organization called?");
  check(await page.locator('#obIn').inputValue(),'');
  check(errors,[]);
  await context.close();
 }
 console.log(`PASS: ${assertions} assertions; 390/768/1280px, draft reload/back, identity isolation, validation, stale token guard, repeat clicks and receipt recovery. All CRM/auth mocked.`);
} finally {await browser.close();await new Promise(r=>server.close(r));}
