/* Browser + real directory handler, intercepted synthetic auth/PostgREST. No external requests. */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {directoryFixture} from '../../workers/mccluster/test/support/world-directory-fixture.mjs';
import {handleWorldDirectory} from '../../workers/mccluster/src/world-directory.js';
const ROOT=process.env.ROOT||resolve(import.meta.dirname,'../..');
const {chromium}=createRequire(resolve(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','fixture.cjs'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
const f=directoryFixture(),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 const req=route.request(),u=new URL(req.url());
 if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
 if(u.hostname==='api.mccluster.org'){
  const r=await handleWorldDirectory(new Request(req.url(),{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postData()}),f.env,{fetchImpl:f.fetchImpl});
  return route.fulfill({status:r.status,headers:{...Object.fromEntries(r.headers),'access-control-allow-origin':'*'},body:await r.text()});
 }
 if(u.pathname==='/js/mcc-auth.js')return route.fulfill({contentType:'text/javascript',body:"window.fixtureSession={access_token:'alice'};window.MCC={session:()=>window.fixtureSession,refreshIfNeeded:async()=>window.fixtureSession};"});
 if(['/js/shell-boot.js','/js/tabbar.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
 if(u.hostname!=='fixture.test')return route.abort();
 const file=resolve(ROOT,'.'+u.pathname);if(!file.startsWith(ROOT+'/'))return route.abort();
 try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
});
try{
 await page.goto('https://fixture.test/world-discover.html');await page.getByText('No public listings match. Try another search.').waitFor();
 await page.click('#manageDirectory');await page.locator('#ownerDirectory:not([hidden])').waitFor();
 await page.selectOption('#listingForm [name=source]','project:alpha');await page.fill('#listingForm [name=title]','Audio mastering');await page.fill('#listingForm [name=description]','Music services');await page.selectOption('#listingForm [name=category]','music');
 await page.uncheck('#listingForm [name=online_only]');await page.fill('#listingForm [name=location_label]','Chicago');await page.fill('#listingForm [name=service_area]','Illinois');await page.check('#listingForm [name=is_listed]');await page.check('#listingForm [name=location_consent]');
 await page.click('#listingForm [type=submit]');await page.getByText('Listing saved and visible in directory.').waitFor();
 await page.locator('#directoryResults h2').waitFor();assert.equal(await page.locator('#directoryResults h2').innerText(),'Audio mastering');assert.equal(await page.getByRole('link',{name:'Open page'}).getAttribute('href'),'front.html?project=alpha');
 await page.fill('#directorySearch [name=q]','missing');await page.click('#directorySearch button');await page.getByText('No public listings match. Try another search.').waitFor();
 await page.fill('#directorySearch [name=q]','audio');await page.fill('#directorySearch [name=location]','Illinois');await page.click('#directorySearch button');await page.locator('#directoryResults h2').waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
 await mkdir('/tmp/world-directory-proof',{recursive:true});await page.screenshot({path:'/tmp/world-directory-proof/phone.png',fullPage:true});
 f.tables.network_profiles[0].visibility='private';await page.click('#directorySearch button');await page.getByText('No public listings match. Try another search.').waitFor();
 await page.click('#manageDirectory');await page.getByText('Listing saved · page or profile is not public').waitFor();
 await page.evaluate(()=>{window.fixtureSession={access_token:'bob'};window.dispatchEvent(new Event('mcc:auth-changed'));});assert.equal(await page.locator('#ownerDirectory').isHidden(),true);assert.equal(await page.locator('#listingForm [name=title]').inputValue(),'');
 await page.click('#manageDirectory');await page.locator('#ownerDirectory:not([hidden])').waitFor();assert.equal(await page.locator('#ownerListings h3').count(),0);assert.equal(await page.locator('#listingForm [name=source]').inputValue(),'project:beta');
 delete f.tables.world_directory_listings;await page.click('#directorySearch button');await page.getByText(/Directory unavailable/).first().waitFor();assert.equal(await page.locator('#directoryResults h2').count(),0);
 await page.setViewportSize({width:1440,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);assert.deepEqual(errors,[]);
 console.log('PASS directory browser: owner creates real listing; search/locality; canonical page link; private source exclusion; two-owner UI clearing; unavailable recovery; 390/1440 overflow; no JS errors');
}finally{await browser.close();}
