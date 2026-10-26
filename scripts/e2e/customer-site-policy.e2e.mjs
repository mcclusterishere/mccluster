import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';import assert from 'node:assert/strict';
const {chromium}=createRequire(resolve(process.env.PLAYWRIGHT_DIR||'/tmp/first-offer-tools/node_modules','x'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844}});const root=resolve(import.meta.dirname,'../..');let enabled=true;
try{
 await page.route('**/*',async route=>{const u=new URL(route.request().url());
 if(u.hostname==='api.mccluster.org')return route.fulfill({status:u.pathname==='/v1/customer-site/world'?(enabled?200:403):503,contentType:'application/json',body:JSON.stringify(enabled?{ok:true,name:'Benji Chase fixture',home:'front.html?project=benji-chase-fixture',site_modules:{world:true,world_href:'customer-world.html?project=benji-chase-fixture'},posts:[{id:'fixture',body:'Public fixture update',href:'mnet.html?view=feed&post=fixture'}]}:{error:'World is switched off for this website'})});
 if(u.hostname!=='matthew.mccluster.org')return route.abort();
 if(u.pathname==='/js/mcc-auth.js')return route.fulfill({contentType:'text/javascript',body:'window.MCC={session:()=>null,refreshIfNeeded:async()=>null,user:async()=>null};'});
 try{const p=resolve(root,'.'+u.pathname);if(!p.startsWith(root+'/'))throw Error();return route.fulfill({body:await readFile(p),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(p)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://matthew.mccluster.org/customer-world.html?project=benji-chase-fixture');await page.getByText('Public fixture update').waitFor();await page.waitForFunction(()=>window.MCC_BAR?.sitePolicy);
 const tab=page.locator('[data-appnav="world"]');assert.equal(await tab.isVisible(),true);assert.match(await tab.getAttribute('href'),/customer-world/);
 await page.evaluate(()=>window.MCC_BAR.sitePolicy({world:false}));assert.equal(await tab.isVisible(),false);
 await page.evaluate(()=>window.MCC_BAR.sitePolicy(null));assert.equal(await tab.isVisible(),true);assert.match(await tab.getAttribute('href'),/mccluster.org\//);
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);}
 enabled=false;await page.reload();await page.getByText('World is switched off for this website').waitFor();assert.equal(await tab.isVisible(),false);assert.equal(await page.getByText('Public fixture update').count(),0);
 console.log('PASS: tenant World projection, actual shared bottom-tab removal/restoration, disabled direct read, account-independent global navigation, 390/1440 layout');
}finally{await browser.close();}
