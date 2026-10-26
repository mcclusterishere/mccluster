const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}});
await page.route('**/*',async r=>{
const url=new URL(r.request().url());
if(url.pathname==='/js/backend.js'){return r.fulfill({contentType:'text/javascript',body:'window.MCC_SUPA={token:async()=>"fixture"}'});}
if(url.pathname==='/v1/creator-domain-orders')return r.fulfill({json:{capabilities:{purchase:true,reason:'Ready to quote',terms_url:'https://mccluster.org/terms',terms_version:'test'},orders:[],contacts:[]}});
if(url.pathname.startsWith('/js/tabbar')||url.pathname.startsWith('/css/'))return r.fulfill({body:''});
try{return r.fulfill({body:fs.readFileSync(new URL('../..'+url.pathname,import.meta.url)),contentType:url.pathname.endsWith('.js')?'text/javascript':'text/html'});}catch{return r.abort();}
});
await page.goto('https://matthew.mccluster.org/customer-domain-purchases.html');await page.locator('#contactForm legend').waitFor();
const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));if(size.scroll!==size.width)throw Error(JSON.stringify(size));
console.log('390px fixture UI rendered without horizontal overflow',size);
await page.evaluate(() => {
  window.MCC_SUPA.token = async () => 'A';
  window.fetch = () => new Promise(resolve => { window.releaseA = () => resolve({ok:true,json:async()=>({capabilities:{connect:true,reason:'A'},orders:[{id:'secret-a',status:'fulfilled'}],contacts:[]})}); });
  window.dispatchEvent(new Event('mcc:auth-changed'));
});
await page.waitForFunction(() => !!window.releaseA);
await page.evaluate(() => { window.MCC_SUPA.token=async()=>null; window.dispatchEvent(new Event('mcc:auth-changed')); window.releaseA(); });
await page.getByText('Sign in to manage domain purchases.').waitFor();
if(await page.locator('#domainOrders').textContent())throw Error('Stale tenant data after signout');
await page.evaluate(() => { window.MCC_SUPA.token=async()=>'B'; window.fetch=async()=>({ok:true,json:async()=>({capabilities:{connect:true,reason:'B'},orders:[],contacts:[]})}); window.dispatchEvent(new Event('mcc:auth-changed')); });
await page.waitForFunction(() => document.getElementById('purchaseStatus').textContent==='B');
console.log('Auth handoff/signout clears data; delayed tenant A response cannot repaint');
await browser.close();
