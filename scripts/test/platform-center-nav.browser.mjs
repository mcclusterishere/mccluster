// Offline browser fixture. PLAYWRIGHT_MODULE_PATH points to a scratch installation.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright');
const root=fileURLToPath(new URL('../../',import.meta.url));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
try {
 for(const host of ['matthew.mccluster.org','mccluster.org']) {
  for(const owner of [false,true]) {
   const page=await browser.newPage({viewport:{width:390,height:844}});
   const token='e30.'+Buffer.from(JSON.stringify({sub:'fixture-member',exp:4102444800})).toString('base64url')+'.fixture';
   await page.addInitScript(({token})=>{
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:token}));
    window.MCC={user:async()=>({id:'fixture-member',email:'fixture@example.invalid'}),api:async()=>new Response(JSON.stringify({identity:{mccluster_id:'member.fixture'},profile:{display_name:'Member Fixture'}}))};
   },{token});
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='api.mccluster.org')return route.fulfill({status:owner?200:403,contentType:'application/json',body:'{}'});
    if(url.pathname==='/fixture.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="css/style.css"></head><body><main>Navigation fixture</main><script src="js/tabbar.js"></script></body></html>'});
    if(!['matthew.mccluster.org','mccluster.org'].includes(url.hostname))return route.abort();
    try { const body=await readFile(resolve(root,'.'+url.pathname));return route.fulfill({body,contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.png')?'image/png':'application/json'}); }catch{return route.abort();}
   });
   await page.goto(`https://${host}/fixture.html`);
   await page.waitForFunction(owner=>window.MCC_BAR?.auth().verified&&window.MCC_BAR.admin()===owner,owner);
   for(const perspective of [{kind:'member',handle:'member.fixture',name:'Member Fixture'},{kind:'artist',handle:'artist.fixture',name:'Artist Fixture'},{kind:'house'}]) {
    await page.evaluate(p=>window.MCC_BAR.perspective(p),perspective);
    const state=await page.evaluate(()=>{const tab=document.querySelector('.appbar [data-appnav="home"]');return {href:tab.href,src:tab.querySelector('img')?.src,profile:document.getElementById('mccAuthChip').href,width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth};});
    assert.equal(state.href,'https://matthew.mccluster.org/platform-home.html');
    assert.match(state.src,/equity-uprise-mark-white\.png$/);
    assert.match(state.profile,/\?view=profile$/);
    assert.equal(state.width,state.scroll);
   }
   if(!owner){
    await page.evaluate(()=>{window.MCC_BAR.perspective({kind:'artist',handle:'artist.fixture',name:'Artist Fixture'});window.MCC_BAR.morph('home');});
    const links=await page.locator('.appbar a').evaluateAll(nodes=>nodes.map(a=>a.href));
    assert.ok(links.some(h=>h.endsWith('index.html?front=house')));
    assert.ok(links.some(h=>h.endsWith('music-creator.html?handle=artist.fixture')));
    await page.evaluate(()=>window.MCC_BAR.revert());
   }
   // Cross-host sign-in keeps the existing fragment handoff; no provider call.
   if(host==='mccluster.org'){
    const carried=await page.evaluate(()=>window.MCC_BAR.navigation.handoff('https://matthew.mccluster.org/platform-home.html'));
    assert.match(carried,/#mcc_handoff=/);
   }
   // Switching owner back to normal restores the platform center, not a cached personal mark.
   await page.evaluate(()=>{localStorage.removeItem('mccdb_session');window.dispatchEvent(new Event('mcc:auth-changed'));});
   await page.waitForFunction(()=>window.MCC_BAR.auth().verified&&!window.MCC_BAR.auth().signed_in&&!window.MCC_BAR.admin());
   assert.equal(await page.locator('[data-appnav="home"]').getAttribute('href'),'https://matthew.mccluster.org/platform-home.html');
   await page.evaluate(()=>document.documentElement.dataset.theme='light');
   assert.match(await page.locator('.appbar__platform').evaluate(el=>getComputedStyle(el).content),/equity-uprise-mark\.png/);
   await page.close();
  }
 }
 console.log('Platform center: guest/member/artist/owner, owner-to-normal restore, both hosts, wing profiles, handoff and 390px layout passed.');
}finally{await browser.close();}
