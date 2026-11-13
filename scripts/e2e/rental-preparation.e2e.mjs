/* Real Control module, synthetic account-fenced request adapter. No live data. */
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(join(process.env.PLAYWRIGHT_DIR||'/tmp/whip-demo-test-tools/node_modules','x'));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const out=process.argv[2]||'/tmp/rental-preparation-proof';await mkdir(out,{recursive:true});
let assertions=0;const check=v=>{assert.ok(v);assertions++;};
try {for(const width of [390,1280]){
 const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'}),page=await context.newPage();
 const errors=[],unexpected=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!=='http://rental.test'){unexpected.push(u.href);return route.abort();}
  try{let body=await readFile(join(ROOT,u.pathname));
   if(u.pathname==='/control.html')body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
   await route.fulfill({contentType:({'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png'})[extname(u.pathname)]||'text/plain',body});
  }catch{await route.fulfill({status:404,body:''});}
 });
 await page.goto('http://rental.test/control.html');
 await page.addScriptTag({url:'http://rental.test/js/control-room/rentals.js'});
 await page.evaluate(()=>{
  document.body.innerHTML='<main id="testRoot" style="max-width:100%;padding:16px"></main>';
  window.rows=[];window.calls=[];window.failLoad=false;window.conflict=false;
  const request=async(path,opts={})=>{
   window.calls.push({path,...opts});
   if(path==='/api/operators/mine')return {tenants:[{id:'fixture',name:'Synthetic operator',role:'owner'},{id:'other',name:'Other operator',role:'admin'}]};
   if(path.includes('/rentals')){if(window.failLoad||path.includes('/other/'))throw Error('Not authorized or database unavailable');return {source:'stored_records',vehicles:window.rows,bookings:[],next_offset:null};}
   if(opts.method==='POST'){const vehicle={id:'fixture-car',...opts.body,available:false,updated_at:'2026-11-13T00:00:00Z'};window.rows.push(vehicle);return {vehicle};}
   if(opts.method==='PATCH'){if(window.conflict)throw Error('Vehicle changed. Reload before editing.');window.rows[0]={...window.rows[0],...opts.body,available:false};return {vehicle:window.rows[0]};}
   throw Error('Unexpected route');
  };
  window.mount=()=>{const root=document.querySelector('#testRoot');root.innerHTML=window.CR.rentals.render();window.CR.rentals.bind(root,{request});};window.mount();
 });
 check((await page.locator('body').innerText()).includes('No private data has been loaded'));
 check(await page.evaluate(()=>window.calls.length===0));
 await page.getByRole('button',{name:'Load my operators'}).click();await page.getByLabel('Rental operator').selectOption('fixture');
 await page.getByText('No stored vehicles on this page.',{exact:false}).waitFor();
 check((await page.locator('body').innerText()).includes('No stored booking records'));
 await page.getByLabel('Vehicle label',{exact:true}).fill('<img src=x onerror=alert(1)>');
 await page.getByLabel('Category',{exact:true}).fill('Synthetic sedan');
 await page.getByLabel('General pickup area',{exact:true}).fill('Synthetic town');
 await page.getByLabel('Planning daily rate (USD cents)').fill('5000');
 await page.getByRole('button',{name:'Save unpublished record'}).click();
 await page.getByText('Saved unpublished record to the backend.',{exact:false}).waitFor();
 check(await page.locator('[data-rental-content] img').count()===0);
 check(await page.evaluate(()=>window.rows.length===1&&window.calls.filter(c=>c.method==='POST').length===1));
 check((await page.locator('[data-rental-content]').innerText()).includes('$350.00/week'));
 check(await page.getByRole('button',{name:'Previous page'}).isDisabled());
 check(await page.getByRole('button',{name:'Next page'}).isDisabled());
 await page.getByRole('button',{name:'Edit preparation record'}).click();await page.getByLabel('Vehicle label',{exact:true}).fill('Revised synthetic vehicle');
 await page.getByRole('button',{name:'Save unpublished record'}).click();await page.getByText('Saved unpublished record to the backend.',{exact:false}).waitFor();
 check(await page.evaluate(()=>window.calls.find(c=>c.method==='PATCH').body.expected_updated_at==='2026-11-13T00:00:00Z'));
 check(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 await page.screenshot({path:join(out,`admin-${width}.png`),fullPage:true});
 await page.evaluate(()=>{window.conflict=true;});await page.getByRole('button',{name:'Edit preparation record'}).click();await page.getByRole('button',{name:'Save unpublished record'}).click();
 await page.getByText('Vehicle changed. Reload before editing.',{exact:false}).waitFor();
 check(await page.getByRole('button',{name:'Save unpublished record'}).isEnabled());
 await page.getByLabel('Rental operator').selectOption('other');await page.getByText('No sample data is substituted.',{exact:false}).waitFor();
 check(!(await page.locator('body').innerText()).includes('Revised synthetic vehicle'));
 await page.goto('http://rental.test/whip/rentals/index.html');await page.getByRole('heading',{name:'Self-drive rentals are in preparation'}).waitFor();
 check(await page.locator('.vehicle-card').count()===0);check(await page.locator('#bookButton').count()===0);
 check(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 await page.screenshot({path:join(out,`public-${width}.png`),fullPage:true});
 check(errors.length===0);check(unexpected.length===0);await context.close();
}console.log(`${assertions} rental browser assertions passed; ${out}`);}finally{await browser.close();}
