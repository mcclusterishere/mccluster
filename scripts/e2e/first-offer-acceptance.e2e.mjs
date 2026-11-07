// Browser fixture only: no accounts, reservations, charges or provider requests.
import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';import assert from 'node:assert/strict';
const {chromium}=createRequire(resolve(process.env.PLAYWRIGHT_DIR||'/tmp/first-offer-tools/node_modules','x'))('playwright');const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844}}),root=resolve(import.meta.dirname,'../..');
let signed=false,profileReady=false,world=false,checkoutCalls=[],modulesOwner=[];
try{
 await page.route('**/*',async route=>{const u=new URL(route.request().url()),req=route.request();const json=(b,s=200)=>route.fulfill({status:s,contentType:'application/json',body:JSON.stringify(b)});
 if(u.hostname==='api.mccluster.org'){
  if(u.pathname==='/v1/fronts/me')return json(profileReady?{ok:true,handle:'benji-fixture',draft:{},publicly_available:false}:{error:'profile required'},profileReady?200:409);
  if(u.pathname==='/v1/customer-site/modules'){modulesOwner.push(req.headers().authorization);if(req.method()==='POST')world=JSON.parse(req.postData()).enabled;return json({ok:true,modules:[{key:'world',name:'World feed',description:'Website World tab',configurable:true,enabled:world}]});}
  if(u.pathname==='/v1/customer-site/storage')return json({ok:true,quota_bytes:500000000,used_bytes:500000000,reserved_bytes:0});
  if(u.pathname==='/v1/customer-site/address')return json({ok:true,address:null});
  if(u.pathname.endsWith('/entitlement'))return json({paid:false,workspaces:[]});
  if(u.pathname.endsWith('/status'))return json({paid:false,subscriptions:[]});
  if(u.pathname.endsWith('/plans'))return json({mode:'test',plans:[{plan:'fixture',period:'monthly',amount:100,currency:'usd'}]});
  if(u.pathname.endsWith('/checkout')){checkoutCalls.push(JSON.parse(req.postData()));await new Promise(r=>setTimeout(r,150));return json({error:'Fixture interrupted checkout; retry safely'},503);}
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
 await page.getByRole('button',{name:'Continue to checkout'}).evaluate(b=>{b.click();b.click();});await page.getByText('Fixture interrupted checkout; retry safely').waitFor();assert.equal(checkoutCalls.length,1);
 await page.getByRole('button',{name:'Continue to checkout'}).click();await page.getByText('Fixture interrupted checkout; retry safely').waitFor();assert.equal(checkoutCalls.length,2);assert.equal(checkoutCalls[0].request_id,checkoutCalls[1].request_id);
 await page.reload();await page.getByRole('button',{name:'Continue to checkout'}).click();await page.getByText('Fixture interrupted checkout; retry safely').waitFor();assert.equal(checkoutCalls[2].request_id,checkoutCalls[0].request_id);
 console.log('PASS: landing→existing sign-in return, interrupted profile setup→saved draft, quota display, persistent module toggle, account switching/no-admin, repeated/reloaded checkout keeps one request identity and never assumes paid');
}finally{await browser.close();}
