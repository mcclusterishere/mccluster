// Offline browser fixture. PLAYWRIGHT_MODULE_PATH points to a scratch installation.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright');
const root=fileURLToPath(new URL('../../',import.meta.url));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
try {
 for(const host of ['matthew.mccluster.org','mccluster.org','brand.fixture.test']) {
  for(const [owner,width] of [[false,390],[true,390],[false,1280],[true,1280]]) {
   const assetBase=host==='mccluster.org'?'https://mccluster.org':'https://matthew.mccluster.org';
   const page=await browser.newPage({viewport:{width,height:844}});
   const token='e30.'+Buffer.from(JSON.stringify({sub:'fixture-member',exp:4102444800})).toString('base64url')+'.fixture';
   await page.addInitScript(({token})=>{
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:token}));
    window.MCC={user:async()=>({id:'fixture-member',email:'fixture@example.invalid'}),api:async()=>new Response(JSON.stringify({identity:{mccluster_id:'member.fixture'},profile:{display_name:'Member Fixture'}}))};
   },{token});
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='api.mccluster.org')return route.fulfill({status:owner?200:403,contentType:'application/json',body:'{}'});
    if(url.pathname==='/fixture.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head>'+(host==='brand.fixture.test'?'<base href="https://matthew.mccluster.org/">':'')+'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="css/style.css"></head><body><main>Navigation fixture</main><script src="js/tabbar.js"></script></body></html>'});
    if(!['matthew.mccluster.org','mccluster.org'].includes(url.hostname))return route.abort();
    try { const body=await readFile(resolve(root,'.'+url.pathname));return route.fulfill({body,contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.png')?'image/png':'application/json'}); }catch{return route.abort();}
   });
   await page.goto(`https://${host}/fixture.html`);
   await page.waitForFunction(owner=>window.MCC_BAR?.auth().verified&&window.MCC_BAR.admin()===owner,owner);
   for(const perspective of [{kind:'member',handle:'member.fixture',name:'Member Fixture'},{kind:'artist',handle:'artist.fixture',name:'Artist Fixture'},{kind:'house'}]) {
    await page.evaluate(p=>window.MCC_BAR.perspective(p),perspective);
    const state=await page.evaluate(()=>{const tab=document.querySelector('.appbar [data-appnav="home"]');return {href:tab.href,src:tab.querySelector('img')?.src,profile:document.getElementById('mccAuthChip').href,width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth};});
    const expected = owner || perspective.kind==='house' ? 'index.html' : (perspective.kind==='artist'?'music-creator.html':'member-front.html')+'?handle='+perspective.handle;
    assert.equal(state.href,'https://matthew.mccluster.org/'+expected);
    if(owner || perspective.kind==='house') assert.equal(state.src,assetBase+'/assets/img/m-mark.png');
    else assert.equal(await page.locator('[data-appnav="home"] .appbar__m--initial').textContent(),perspective.name[0]);
    assert.match(state.profile,/\?view=profile$/);
    assert.equal(state.width,state.scroll);
   }
   if(!owner){
    await page.evaluate(()=>{window.MCC_BAR.perspective({kind:'artist',handle:'artist.fixture',name:'Artist Fixture'});window.MCC_BAR.morph('home');});
    const links=await page.locator('.appbar a').evaluateAll(nodes=>nodes.map(a=>a.href));
    assert.ok(links.some(h=>h.endsWith('index.html?front=house')));
    assert.ok(links.some(h=>h.endsWith('music-creator.html?handle=artist.fixture')));
    assert.equal(await page.locator('.appbar__tab--slot').last().locator('span').textContent(),'Everything');
    await page.evaluate(()=>window.MCC_BAR.revert());
    await page.reload();
    await page.waitForFunction(()=>window.MCC_BAR?.auth().verified);
    assert.equal(await page.locator('[data-appnav="home"]').getAttribute('href'),'https://matthew.mccluster.org/music-creator.html?handle=artist.fixture');
    assert.equal(await page.locator('#mccControlToggle').count(),0);
   }
   if(!owner) {
   // Equity Uprise keeps its supplied mark on its explicitly branded document,
   // without becoming the fallback for Music or another creator's page.
   await page.evaluate(()=>window.MCC_BAR.pageProfile({name:'Equity Uprise',home:location.origin+'/platform-home.html',logo:'assets/img/equity-uprise-mark-white.png'}));
   assert.equal(await page.locator('[data-appnav="home"]').getAttribute('href'),`https://${host}/platform-home.html`);
   assert.equal(await page.locator('[data-appnav="home"] img').getAttribute('src'),assetBase+'/assets/img/equity-uprise-mark-white.png');
   await page.evaluate(()=>window.MCC_BAR.pageProfile(null));
   assert.equal(await page.locator('[data-appnav="home"]').getAttribute('href'),'https://matthew.mccluster.org/music-creator.html?handle=artist.fixture');
   // Public page branding wins over the viewer's account/perspective, but is
   // document-local and never persisted as another tenant's account context.
   await page.evaluate(()=>window.MCC_BAR.pageProfile({name:'Vaunt',home:location.origin+'/front.html?project=vaunt',logo:'assets/img/vaunt-logo.webp'}));
   await page.evaluate(()=>window.MCC_BAR.perspective({kind:'member',handle:'someone.else',name:'Someone Else'}));
   assert.equal(await page.locator('[data-appnav="home"]').getAttribute('href'),`https://${host}/front.html?project=vaunt`);
   assert.match(await page.locator('[data-appnav="home"] img').getAttribute('src'),/vaunt-logo.webp$/);
   await page.evaluate(()=>window.MCC_BAR.pageProfile({name:'Second profile',home:'front.html?project=second'}));
   assert.equal(await page.locator('[data-appnav="home"] .appbar__m--initial').textContent(),'S');
   assert.equal(await page.locator('[data-appnav="home"] img').count(),0);
   const uploaded='https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/front-media/11111111-1111-4111-8111-111111111111/projects/logo-site/still-logo.png';
   await page.evaluate(logo=>window.MCC_BAR.pageProfile({name:'Owned logo',home:location.pathname,logo}),uploaded);
   assert.equal(await page.locator('[data-appnav="home"] img').getAttribute('src'),uploaded);
   for(const logo of [uploaded.replace('zmnhbrjyhxzhkxmhkexs.supabase.co','other.supabase.co'),uploaded.replace('public/front-media','authenticated/front-media'),uploaded+'?token=secret',uploaded.replace('front-media','private-masters')]){
    await page.evaluate(logo=>window.MCC_BAR.pageProfile({name:'Rejected logo',home:location.pathname,logo}),logo);
    assert.equal(await page.locator('[data-appnav="home"] img').count(),0);
   }
   await page.evaluate(()=>window.MCC_BAR.pageProfile({name:'Unsafe',home:'https://other.invalid/',logo:'javascript:alert(1)'}));
   assert.equal(await page.locator('[data-appnav="home"]').getAttribute('href'),'https://matthew.mccluster.org/member-front.html?handle=someone.else');
   assert.equal(await page.evaluate(()=>window.MCC_BAR.pageProfile()),null);
   } else {
    await page.evaluate(()=>{
      window.MCC_BAR.pageProfile({name:'Other tenant',home:location.origin+'/front.html?project=other',logo:'assets/img/vaunt-logo.webp'});
      window.MCC_BAR.perspective({kind:'artist',handle:'other.artist',name:'Other'});
    });
    assert.equal(await page.locator('[data-appnav="home"]').getAttribute('href'),'https://matthew.mccluster.org/index.html');
    assert.match(await page.locator('[data-appnav="home"] img').getAttribute('src'),/m-mark\.png$/);
    assert.deepEqual(await page.locator('.appbar.appbar--admin').first().locator('[data-appnav]').evaluateAll(nodes=>nodes.map(n=>n.dataset.appnav).sort()),['music','admin-inbox','admin-home','home','analytics','world','games','admin-sell','admin-create','admin-system'].sort());
    const worldBefore = await page.locator('.appbar.appbar--admin [data-appnav="world"]').getAttribute('href');
    assert.equal(worldBefore,'https://mccluster.org/?view=feed');
    for (const policy of [{world:false},{world:true,world_href:'https://matthew.mccluster.org/customer-world.html'}]) {
      await page.evaluate(policy=>window.MCC_BAR.sitePolicy(policy),policy);
      const world = page.locator('.appbar.appbar--admin [data-appnav="world"]');
      assert.equal(await world.getAttribute('href'),worldBefore);
      assert.equal(await world.isVisible(),true);
    }
    await page.evaluate(()=>{window.MCC_BAR.sitePolicy(null);window.MCC_BAR.pageProfile(null);});
   }
   // Cross-host sign-in keeps the existing fragment handoff; no provider call.
   if(host==='mccluster.org'){
    const carried=await page.evaluate(()=>window.MCC_BAR.navigation.handoff('https://matthew.mccluster.org/platform-home.html'));
    assert.match(carried,/#mcc_handoff=/);
   }
   // Sign-out clears account context and restores the established personal M.
   await page.evaluate(()=>{localStorage.removeItem('mccdb_session');window.dispatchEvent(new Event('mcc:auth-changed'));});
   await page.waitForFunction(()=>window.MCC_BAR.auth().verified&&!window.MCC_BAR.auth().signed_in&&!window.MCC_BAR.admin());
   assert.equal(await page.locator('[data-appnav="home"]').getAttribute('href'),'https://matthew.mccluster.org/index.html');
   await page.evaluate(()=>document.documentElement.dataset.theme='light');
   assert.equal(await page.locator('[data-appnav="home"] img').getAttribute('src'),assetBase+'/assets/img/m-mark.png');
   await page.close();
  }
 }
 console.log('Established center: guest/member/artist/owner, owner-to-normal restore, profile overrides, both hosts, handoff and 390/1280px layouts passed.');
}finally{await browser.close();}
