// Run against the integrated City contract in this checkout. Real Cesium/gameplay;
// identity, ion availability and imagery are fixtures. No production requests allowed.
const {chromium}=require('playwright'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const base=process.env.ARCADE_BASE||'http://127.0.0.1:8768',build=process.env.CESIUM_BUILD||'/tmp/arcade-cesium/node_modules/cesium/Build/Cesium';
(async()=>{const {createArcadeDatabase}=await import('../test/support/arcade-database.mjs');const database=await createArcadeDatabase();const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{for(const width of (process.env.ARCADE_WIDTHS||'390,1280').split(',').map(Number)){
 const entrance=width===390?'bridgeport-main-golden-hill':'bridgeport-main-elm',destination=width===390?'bridgeport-main-elm':'bridgeport-main-golden-hill';
 const context=await browser.newContext({viewport:{width,height:1000}});let owner=true,loads=0;const errors=[];
 await context.addInitScript(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'local-fixture-owner'})));
 await context.route('**/*',async r=>{const u=new URL(r.request().url()),suffix=u.pathname.split('/Build/Cesium/')[1];
  if(u.hostname==='cesium.com'&&suffix&&!suffix.includes('..')){try{return r.fulfill({body:await fs.readFile(build+'/'+suffix),contentType:suffix.endsWith('.js')?'text/javascript':suffix.endsWith('.css')?'text/css':'application/octet-stream'});}catch{return r.abort();}}
  if(u.origin==='https://api.mccluster.org'&&u.pathname.startsWith('/v1/arcade/')){const req=r.request();const response=await database.handle(new Request(req.url(),{method:req.method(),headers:{...req.headers(),authorization:owner?'Bearer local-owner':'Bearer member'},...(req.postData()?{body:req.postData()}:{})}));return r.fulfill({status:response.status,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:await response.text()});}
  if(u.origin==='https://api.mccluster.org'||u.hostname.endsWith('supabase.co'))return r.fulfill({status:u.pathname==='/v1/status'&&!owner?403:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(u.pathname==='/v1/status'?{ok:owner}:u.pathname==='/v1/world/access'?{release:{version:'globe-admin-preview/v1',admin_preview:owner},unlocked_layers:[],locked_layers:[]}:u.pathname==='/v1/world/ion'?{available:false}:[])});
  if(u.origin===base){if(u.pathname.endsWith('/data/spatial/bridgeport-downtown.v2.json'))loads++;if(['/js/mcc-auth.js','/js/tabbar.js','/js/shell-boot.js'].includes(u.pathname))return r.fulfill({contentType:'text/javascript',body:''});return r.continue();}
  if(['gibs.earthdata.nasa.gov','tile.openstreetmap.org'].includes(u.hostname))return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});return r.abort();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const key='here.city-arcade.sole-street.session.v1:'+entrance;
 const snapshot=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
 await page.goto(base+'/city-arcade.html?game=designer-kicks-sole-run&location='+entrance);
 await page.locator('[data-sole-load]').waitFor({state:'attached'});await page.locator('#arcade-play .tea-tuning summary').click();
 await page.locator('[data-sole-load]').click();await page.waitForFunction(()=>/No saved mission|Loaded private/.test(document.querySelector('[data-sole-cloud-status]').textContent));
 if(width===1280){const c=JSON.parse(await page.locator('[data-sole-config]').inputValue());c.route.reverse();await page.locator('[data-sole-config]').fill(JSON.stringify(c));}
 await page.locator('[data-sole-save]').click();await page.waitForFunction(()=>document.querySelector('[data-sole-cloud-status]').textContent.includes('saved.'));
 await page.locator('[data-sole-cloud-play]').click();await page.waitForFunction(()=>document.querySelector('[data-sole-cloud-status]').textContent.includes('Playing private'));
 await page.locator('[data-sole-pause]').click();
 let frame;
 async function enter(){
  await page.locator('#arcade-globe').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('#arcade-globe')?.contentWindow?.location.href.includes('action-globe'));
  frame=page.frames().find(f=>f.url().includes('action-globe'));await frame.waitForFunction(()=>!!window.HuGlobe?.viewer()&&window.HuGlobe.owner());
  // Fixture clock acceleration only: route math, movement, clearance and arrival are real.
  await frame.evaluate(()=>{if(!window.__clock){window.__clock=true;const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>raf(t=>fn(t*12));}window.__viewer=HuGlobe.viewer();});
  await page.locator('[data-spatial-enter]').click();await page.waitForFunction(()=>document.querySelector('[data-spatial-status]').textContent.startsWith('Shared downtown ready'));
 }
 await enter();const initial=await snapshot();
 await page.evaluate(()=>window.addEventListener('message',e=>{if(e.source===document.querySelector('#arcade-globe').contentWindow&&e.data?.event==='arrived')window.__arrival=e.data;}));
 for(let i=initial.index;i<=4;i++){
  const before=await snapshot(),target=i<4?'bridgeport-'+before.config.route[i]:entrance;
  await page.locator('[data-spatial-target]').selectOption(target);await page.locator('[data-spatial-preview]').click();await frame.locator('[data-confirm]').click();
  await page.waitForFunction(({key,i})=>{const s=JSON.parse(localStorage.getItem(key));return i<4?s?.index===i+1:s?.status==='won';},{key,i},{timeout:120000}).catch(async error=>{console.error(JSON.stringify({width,i,state:await snapshot(),city:await frame.evaluate(()=>BridgeportSlice.snapshot()),cityStatus:await frame.locator('#bridgeportWalk [data-status]').textContent(),arcadeStatus:await page.locator('[data-spatial-status]').textContent()}));throw error;});
  console.log('Checkpoint',width,i,'confirmed');
  const after=await snapshot();assert.equal(after.remaining,initial.remaining);assert.equal(after.score,Math.min(i+1,4)*initial.config.reward);
  const arrival=await page.evaluate(()=>window.__arrival);await frame.evaluate(d=>parent.postMessage(d,location.origin),arrival);await page.waitForTimeout(50);assert.deepEqual(await snapshot(),after,'duplicate cannot advance twice');
  assert.equal(await frame.evaluate(()=>HuGlobe.viewer()===window.__viewer),true);
  if(i===1){
   await page.locator('[data-spatial-return]').click();await page.waitForFunction(()=>document.querySelector('[data-spatial-status]').textContent.startsWith('Returned to Sole Run'));
   await page.reload();await page.locator('[data-spatial-enter]').waitFor();assert.deepEqual(await snapshot(),after,'two collected pairs survive reload');await enter();
   await page.evaluate(()=>window.addEventListener('message',e=>{if(e.source===document.querySelector('#arcade-globe').contentWindow&&e.data?.event==='arrived')window.__arrival=e.data;}));
  }
 }
 assert.equal(await page.locator('[data-sole-start]').isDisabled(),true,'completed run stays locked until acknowledged return');
 await page.locator('[data-spatial-return]').click();await page.waitForFunction(()=>document.querySelector('[data-sole-cloud-status]').textContent.includes('Practice result saved'));
 assert.equal(await snapshot(),null,'successful cloud finish clears pending session');
 const result=await database.db.query("select status,served,score from arcade_runs where mission_id=$1 and status='won'",['sole-'+entrance]);
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].served,4);assert.equal(Number(result.rows[0].score),4*initial.config.reward);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({width,actualCesium:true,clockAccelerated:true,fourPairs:true,returnCompletes:true,duplicateIgnored:true,reloadResumes:true,cloudResult:true}));await context.close();
 }}finally{await browser.close();await database.close();}})().catch(e=>{console.error(e);process.exitCode=1});
