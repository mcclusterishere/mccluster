// Browser fixture only: no accounts, reservations, charges or provider requests.
import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';import assert from 'node:assert/strict';
const {chromium}=createRequire(resolve(process.env.PLAYWRIGHT_DIR||'/tmp/first-offer-tools/node_modules','x'))('playwright');const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844}}),root=resolve(import.meta.dirname,'../..');
let signed=false,profileReady=false,world=false,checkoutCalls=[],resumeCalls=[],providerAttempts=[],checkoutAttempt=null,modulesOwner=[];
try{
 await page.route('**/*',async route=>{const u=new URL(route.request().url()),req=route.request();const json=(b,s=200)=>route.fulfill({status:s,contentType:'application/json',body:JSON.stringify(b)});
 if(u.hostname==='api.mccluster.org'){
  if(u.pathname==='/v1/fronts/me')return json(profileReady?{ok:true,handle:'benji-fixture',draft:{},publicly_available:false}:{error:'profile required'},profileReady?200:409);
  if(u.pathname==='/v1/customer-site/modules'){modulesOwner.push(req.headers().authorization);if(req.method()==='POST')world=JSON.parse(req.postData()).enabled;return json({ok:true,modules:[{key:'world',name:'World feed',description:'Website World tab',configurable:true,enabled:world}]});}
  if(u.pathname==='/v1/customer-site/storage')return json({ok:true,quota_bytes:500000000,used_bytes:500000000,reserved_bytes:0});
  if(u.pathname==='/v1/customer-site/address')return json({ok:true,address:null});
  if(u.pathname.endsWith('/entitlement'))return json({paid:false,workspaces:[]});
  if(u.pathname.endsWith('/status'))return json({paid:false,subscriptions:[],checkout:checkoutAttempt,can_reconcile:false});
  if(u.pathname.endsWith('/plans'))return json({mode:'test',plans:[{plan:'fixture',period:'monthly',amount:100,currency:'usd'}]});
  if(u.pathname.endsWith('/checkout')){
   const attempt=JSON.parse(req.postData());checkoutCalls.push(attempt);
   // The server keeps the original attempt even when the response is lost.
   // An unknown outcome cannot unlock a competing checkout on this device.
   if(checkoutAttempt)return json({error:'Another checkout is pending.',state:'pending',request_id:checkoutAttempt.request_id,checkout:checkoutAttempt},409);
   checkoutAttempt={...attempt,state:'pending',recoverable:true};providerAttempts.push(attempt.request_id);
   await new Promise(r=>setTimeout(r,150));return json({error:'Fixture provider outcome is unknown.',state:'pending',request_id:attempt.request_id},503);
  }
  if(u.pathname.endsWith('/resume')){
   resumeCalls.push(JSON.parse(req.postData()));assert.ok(checkoutAttempt,'resume uses persisted server state');providerAttempts.push(checkoutAttempt.request_id);
   await new Promise(r=>setTimeout(r,150));return json({error:'Fixture provider outcome is still unknown.',state:'pending',request_id:checkoutAttempt.request_id},503);
  }
  return json({error:'Unavailable'},503);
 }
 if(u.hostname!=='fixture.invalid')return route.abort();
 if(u.pathname==='/js/mcc-auth.js')return route.fulfill({contentType:'text/javascript',body:`window.fixtureSession=${signed?JSON.stringify({access_token:'alice',user:{id:'alice'}}):'null'};window.MCC={session:()=>window.fixtureSession,refreshIfNeeded:async()=>window.fixtureSession};`});
 if(['/js/tabbar.js','/js/shell-boot.js','/js/customer-seller.js','/js/customer-store.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
 try{const p=resolve(root,'.'+u.pathname);if(!p.startsWith(root+'/'))throw Error();return route.fulfill({body:await readFile(p),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(p)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://fixture.invalid/platform-home.html');await page.locator('.hero-actions').getByRole('link',{name:'Build your website',exact:true}).click();await page.getByRole('link',{name:'Sign in or create account'}).waitFor();assert.match(await page.getByRole('link',{name:'Sign in or create account'}).getAttribute('href'),/next=customer-site/);
 signed=true;await page.reload();await page.getByRole('link',{name:'Complete profile',exact:true}).waitFor();profileReady=true;await page.reload();await page.getByText('Draft saved · not published',{exact:true}).waitFor();assert.match(await page.locator('#siteStatus').innerText(),/500.0 MB used/);
 const toggle=page.getByRole('checkbox',{name:'World feed'});await toggle.check();await page.getByText('World tab is on for this website.',{exact:true}).waitFor();await page.reload();assert.equal(await toggle.isChecked(),true);await toggle.uncheck();await page.getByText('World tab is off for this website.',{exact:true}).waitFor();
 await page.evaluate(()=>{window.fixtureSession={access_token:'bob',user:{id:'bob'}};window.dispatchEvent(new Event('mcc:auth-changed'));});await page.locator('#siteStatus[aria-busy="false"]').waitFor();assert.equal(modulesOwner.at(-1),'Bearer bob');assert.equal(await page.getByRole('link',{name:/Control|Admin/}).count(),0);
 await page.goto('https://fixture.invalid/customer-commerce.html?checkout=returned');await page.getByRole('button',{name:'Continue to checkout'}).waitFor();assert.match(await page.locator('#notice').innerText(),/confirmation is processed/);
 const pending=async()=>{await page.locator('#notice[data-state="pending"][aria-busy="false"]').waitFor();assert.match(await page.locator('#notice').innerText(),/Payment confirmation is pending/);assert.equal(await page.getByRole('button',{name:'Continue to checkout'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Resume or recover checkout'}).isDisabled(),false);assert.doesNotMatch(await page.locator('#notice').innerText(),/paid workspace is active/);};
 await page.getByRole('button',{name:'Continue to checkout'}).evaluate(b=>{b.click();b.click();});await pending();assert.equal(checkoutCalls.length,1);assert.equal(providerAttempts.length,1);
 await page.getByRole('button',{name:'Resume or recover checkout'}).evaluate(b=>{b.click();b.click();});await pending();assert.equal(checkoutCalls.length,1);assert.equal(resumeCalls.length,1);assert.deepEqual(resumeCalls[0],{});assert.equal(providerAttempts.length,2);assert.equal(providerAttempts[0],providerAttempts[1]);
 await page.reload();await pending();assert.equal(checkoutCalls.length,1);assert.match(await page.locator('#checkout-detail').innerText(),new RegExp(checkoutAttempt.request_id));
 await page.getByRole('button',{name:'Resume or recover checkout'}).click();await pending();assert.equal(checkoutCalls.length,1);assert.equal(resumeCalls.length,2);assert.deepEqual(resumeCalls[1],{});assert.equal(providerAttempts.length,3);assert.equal(providerAttempts[2],providerAttempts[0]);
 const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.equal(size.client,390);assert.equal(size.scroll,size.client);
 console.log('PASS: landing→existing sign-in return, interrupted profile setup→saved draft, quota display, persistent module toggle, account switching/no-admin, uncertain checkout stays locked and repeated/reloaded resume keeps one server-held request identity without assuming paid; 390px has no overflow');
}finally{await browser.close();}
