import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/selfservice-tools/node_modules/playwright/index.mjs');
test('commerce screens clear on auth switch and ignore delayed private responses at 390px',async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:390,height:844}});let release;const gate=new Promise(resolve=>release=resolve);let seenResolve;const seen=new Promise(resolve=>seenResolve=resolve);
 await page.route('https://api.mccluster.org/**',async route=>{const auth=route.request().headers().authorization;let data={};const path=new URL(route.request().url()).pathname;
 if(auth==='Bearer A'&&path.endsWith('/status')){seenResolve();await gate;data={paid:true,subscriptions:[{status:'private-A',stripe_subscription_id:'sub_A'}]}}
 else if(path.endsWith('/status'))data={paid:false,subscriptions:[]};
 else if(path.endsWith('/plans'))data={plans:[],mode:'test'};
 else if(path.endsWith('/workspaces'))data={workspaces:[]};
 await route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify(data)});
 });
 const html=(await readFile(new URL('../../customer-commerce.html',import.meta.url),'utf8')).replace(/<script[\s\S]*?<\/script>/g,'');await page.setContent(html);
 await page.evaluate(()=>{window.current={access_token:'A',user:{id:'A'}};window.MCC={session:()=>window.current,refreshIfNeeded:async()=>window.current}});
 for(const script of ['customer-commerce.js','customer-seller.js','customer-store.js'])await page.addScriptTag({content:await readFile(new URL('../../js/'+script,import.meta.url),'utf8')});
 await seen;await page.evaluate(()=>{window.current={access_token:'B',user:{id:'B'}};window.dispatchEvent(new Event('mcc:auth-changed'))});release();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('No active'));
 assert.equal(await page.locator('body').innerText().then(text=>text.includes('private-A')),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.evaluate(()=>{window.current=null;window.dispatchEvent(new Event('mcc:auth-changed'))});await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Sign in'));
 assert.equal(await page.locator('#subscriptions').innerText(),'');assert.equal(await page.locator('#seller').innerText(),'Sign in to manage your seller account.');
 }finally{await browser.close()}
});
test('buyer capability stays out of storefront and order API request URLs',async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage();const token='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';const seen=[];
 const html=(await readFile(new URL('../../customer-checkout.html',import.meta.url),'utf8')).replace(/<script[\s\S]*?<\/script>/g,'');
 await page.route('https://matthew.mccluster.org/customer-checkout.html**',route=>route.fulfill({contentType:'text/html',body:html}));
 await page.route('https://api.mccluster.org/**',async route=>{if(route.request().method()==='OPTIONS'){await route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization'},body:''});return}seen.push({url:route.request().url(),authorization:route.request().headers().authorization});await route.fulfill({headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({order:{title:'Private order',status:'paid'}})})});
 await page.goto('https://matthew.mccluster.org/customer-checkout.html?order='+id+'#token='+token);
 await page.addScriptTag({content:await readFile(new URL('../../js/customer-checkout.js',import.meta.url),'utf8')});
 await page.waitForFunction(()=>document.getElementById('title').textContent==='Private order');
 assert.equal(seen.length,1);assert.equal(seen[0].url.includes(token),false);assert.equal(seen[0].authorization,'Bearer '+token);assert.equal(new URL(page.url()).search.includes(token),false);
 }finally{await browser.close()}
});
