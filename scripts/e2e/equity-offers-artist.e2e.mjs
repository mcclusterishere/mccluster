/* Actual local player, supplied artwork and shared navigation. All HTTP is intercepted;
   no production authentication, publication, listening ledger or provider requests. */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import assert from 'node:assert/strict';
const ROOT=process.cwd(),BASE='https://matthew.mccluster.org',OUT=process.argv[2]||'/tmp/equity-offers-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/tmp/selfservice-tools/node_modules','x'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp3':'audio/mpeg','.m4a':'audio/mp4','.mp4':'video/mp4','.woff2':'font/woff2'};
await mkdir(OUT,{recursive:true});
try{for(const width of [390,1440]){
 const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];
 await ctx.addInitScript(()=>localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()})));
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!==BASE)return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{}'});
  const path=resolve(ROOT,'.'+u.pathname);if(!path.startsWith(ROOT+'/'))return route.abort();
  try{return route.fulfill({body:await readFile(path),contentType:types[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(BASE+'/album.html?album=equity-uprise',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#albArtist a');assert.equal(await page.locator('#albArtist a').textContent(),'Equity Uprise');
 assert.equal(await page.locator('#albArtist a').getAttribute('href'),'platform-home.html');
 await page.click('#playAll');await page.waitForFunction(()=>{const a=document.getElementById('deck');return !a.paused&&a.currentTime>0;});
 assert.equal(await page.locator('#nowBy').textContent(),'Equity Uprise');
 await page.click('#albArtist a');await page.waitForURL('**/platform-home.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.MCC_BAR?.pageProfile()?.name==='Equity Uprise');
 assert.match(await page.locator('#template-state').innerText(),/Template preview/);
 assert.equal(await page.locator('.journey li').count(),9);
 assert.match(await page.locator('[data-appnav="home"] img').getAttribute('src'),/equity-uprise-mark-white.png$/);
 assert.equal(await page.locator('.hero-actions a').first().getAttribute('href'),'customer-site.html');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
 await page.screenshot({path:join(OUT,'equity-home-'+width+'.png'),fullPage:true});
 await page.goBack({waitUntil:'domcontentloaded'});await page.waitForSelector('#albArtist a');
 assert.equal(new URL(page.url()).searchParams.get('album'),'equity-uprise');
 assert.equal(await page.locator('#albArtist a').textContent(),'Equity Uprise');
 // Playback can resume from the same record after history return; no synthetic play override.
 await page.evaluate(()=>document.getElementById('deck').pause());await page.click('#playAll');
 await page.waitForFunction(()=>!document.getElementById('deck').paused&&document.getElementById('deck').currentTime>0);
 await page.goto(BASE+'/album.html?album=here',{waitUntil:'domcontentloaded'});await page.waitForSelector('#albArtist a');
 assert.equal(await page.locator('#albArtist a').getAttribute('href'),'matthew-mccluster.html');
 await page.waitForFunction(()=>window.MCC_BAR?.pageProfile()?.name==='Matthew McCluster');
 assert.match(await page.locator('[data-appnav="home"] img').getAttribute('src'),/m-mark.png$/);
 assert.deepEqual(errors,[]);await ctx.close();console.log('PASS '+width+': stable artist destinations, real audio start/resume, Back, contextual supplied marks, nine experiences, no overflow');
}}finally{await browser.close();}
