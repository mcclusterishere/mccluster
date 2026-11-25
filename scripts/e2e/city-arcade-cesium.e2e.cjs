// Actual pinned Cesium renderer; offline imagery and owner responses are fixtures. No live ion entitlement is claimed.
const {chromium}=require('playwright');const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const base=process.env.ARCADE_BASE||'http://127.0.0.1:8765',build=process.env.CESIUM_BUILD||'/tmp/arcade-cesium/node_modules/cesium/Build/Cesium';
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const context=await browser.newContext({viewport:{width:1000,height:900},ignoreHTTPSErrors:true});
await context.addInitScript(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'local-test-owner'})));
const failures=[];await context.route('**/*',async r=>{const u=new URL(r.request().url());
if(u.hostname==='cesium.com'){const suffix=u.pathname.split('/Build/Cesium/')[1];if(suffix&&!suffix.includes('..')){try{return r.fulfill({body:await fs.readFile(build+'/'+suffix),contentType:suffix.endsWith('.js')?'text/javascript':suffix.endsWith('.css')?'text/css':'application/octet-stream'});}catch{}}return r.abort();}
if(['gibs.earthdata.nasa.gov','tile.openstreetmap.org'].includes(u.hostname))return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
if(u.origin==='https://api.mccluster.org'||u.hostname.endsWith('supabase.co'))return r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(u.pathname==='/v1/status'?{ok:true}:u.pathname==='/v1/world/ion'?{available:false}:u.pathname==='/v1/world/access'?{release:{version:'globe-admin-preview/v1',admin_preview:false},unlocked_layers:[],locked_layers:[]}:[])});
if(['/js/mcc-auth.js','/js/tabbar.js'].includes(u.pathname))return r.fulfill({contentType:'text/javascript',body:''});return r.continue();});
const page=await context.newPage();page.on('requestfailed',r=>failures.push({url:r.url().split('?')[0],error:r.failure().errorText}));
await page.goto(base+'/city-arcade.html');
let frame;
try{await page.waitForFunction(()=>document.querySelector('#arcade-map-status')?.textContent.includes('Bridgeport ·'),{},{timeout:30000});}catch{}
frame=page.frames().find(f=>f.url().includes('action-globe'));
assert.match(await page.locator('#arcade-load-status').textContent(),/Markers only/);console.log('Before zoom: markers only');await page.locator('#arcade-bridgeport').click();
try{await page.waitForFunction(()=>document.querySelector('#arcade-load-status').textContent.includes('loaded:'),{},{timeout:15000});}catch{}
assert.match(await page.locator('#arcade-load-status').textContent(),/loaded:.*\(zoom\)/);console.log('Real Cesium camera triggered the regional geometry load.');
await page.screenshot({path:'/tmp/arcade-real-cesium.png'});
await page.locator('#arcade-pick-location').click();const mapBox=await frame.locator('#globe').boundingBox();await page.mouse.click(mapBox.x+mapBox.width/2,mapBox.y+mapBox.height/2);
await page.locator('[data-location-id][aria-pressed="true"]').waitFor();await page.locator('[data-game="gauranfucking-tea-tea-rush"]').click();await page.locator('.tea-scene').waitFor();console.log('Real Cesium pick selected a sourced entrance and launched Tea Rush.');

console.log(JSON.stringify({status:await page.locator('#arcade-map-status').textContent(),frame:frame?await frame.evaluate(()=>({cesium:!!window.Cesium,canvas:!!document.querySelector('canvas'),journey:window.__huJourney?.(),navigation:window.__huNavigation?.()})):null,failures:failures.slice(0,8)}));
await page.evaluate(()=>document.querySelector('#arcade-globe').contentWindow.postMessage({type:'hu:clear-selection'},location.origin));await page.waitForFunction(()=>document.querySelector('#arcade-load-status').textContent.includes('unloaded'),{},{timeout:15000});console.log('Real Cesium zoom-out unloaded regional geometry.');await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
