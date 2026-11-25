/* Local owner-fixture browser checks. UI changes display preferences only; game hooks are observations.
   THREE_DIR=/path/to/three PLAYWRIGHT_DIR=/path/to/node_modules node scripts/e2e/prim3-spatial-controls.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=createRequire((process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules')+'/fixture.cjs')('playwright');
const root=fileURLToPath(new URL('../../',import.meta.url)),three=process.env.THREE_DIR||'/tmp/prim3-three/package',base='https://matthew.mccluster.org',out=process.argv[2]||'/tmp/prim3-spatial-controls';
await mkdir(out,{recursive:true});const results=[];
function check(tag,name,pass,detail){results.push({tag,name,pass,detail});console.log(`${pass?'PASS':'FAIL'} [${tag}] ${name}`);}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
try{for(const width of (process.env.WIDTHS||'390,1280').split(',').map(Number)){
 const ctx=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,reducedMotion:'reduce',serviceWorkers:'block'});
 await ctx.addInitScript(()=>{localStorage.setItem('mccdb_session',JSON.stringify({access_token:'e2e-owner',expires_at:Math.floor(Date.now()/1000)+3600}));localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));localStorage.setItem('prim3.tactics.preview.gfx','low');sessionStorage.setItem('mcc_premiere','1');});
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());
 if(u.hostname==='api.mccluster.org'||u.hostname.endsWith('supabase.co'))return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:'{}'});
 let f;if(u.origin===base)f=resolve(root,'.'+decodeURIComponent(u.pathname));else if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/three@0.180.0/'))f=resolve(three,u.pathname.slice('/npm/three@0.180.0/'.length));else return route.abort();
 try{const body=await readFile(f);return route.fulfill({body,contentType:types[extname(f)]||'application/octet-stream',headers:{'access-control-allow-origin':'*'}})}catch{return route.fulfill({status:404,body:''})}
 });
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function ready(){await page.waitForFunction(()=>window.__tx?.r3&&!__tx.busy,null,{timeout:60000});}
 async function settings(){await page.evaluate(()=>scrollTo(0,0));await page.locator('#txSettings').click();}
 const state=()=>page.evaluate(()=>JSON.stringify(__tx.state));
 try{
 for(const level of ['transit-relay','equity-uprise-hq']){
  const tag=`${level}-${width}`,url=base+'/prim3-transit.html?level='+level;
  await page.goto(url,{waitUntil:'domcontentloaded'});await ready();
  const before=await state();
  check(tag,'independent coarse default',await page.evaluate(()=>__tx.r3.gridDetail===1));
  await settings();await page.locator('#setLook [data-look=studio]').click();await settings();
  await page.locator('#txStage').screenshot({path:out+`/coarse-${tag}.png`});
  await settings();await page.locator('[data-grid-detail="2"]').click();
  check(tag,'physical guide spacing', (await page.locator('#gridDetailNote').innerText()).includes(level==='transit-relay'?'1.77 m guides':'1.8288 m guides'));
  check(tag,'selected fine preference',await page.locator('[data-grid-detail="2"]').getAttribute('aria-pressed')==='true'&&await page.evaluate(()=>__tx.r3.gridDetail===2));
  await settings();await page.locator('#txStage').screenshot({path:out+`/fine-${tag}.png`});
  await page.locator('#txGrid').click();check(tag,'whole grid hidden',await page.evaluate(()=>!__tx.r3.gridOn&&__tx.r3.gridDetail===2));
  await page.locator('#txStage').screenshot({path:out+`/off-${tag}.png`});
  await page.locator('#txGrid').click();check(tag,'whole grid restored',await page.evaluate(()=>__tx.r3.gridOn&&__tx.r3.gridDetail===2));
  check(tag,'state and RNG unchanged',before===await state());
  await page.reload({waitUntil:'domcontentloaded'});await ready();
  check(tag,'preference persists reload',await page.evaluate(()=>__tx.r3.gridDetail===2));
  check(tag,'exact state survives reload',before===await state());
  await settings();await page.locator('[data-grid-detail="1"]').click();await settings();
  check(tag,'coarse restored',await page.evaluate(()=>__tx.r3.gridDetail===1));
  if(level==='transit-relay'){await settings();await page.locator('[data-grid-detail="2"]').click();await settings();}
  check(tag,'no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 }
 await page.goto(base+'/prim3-transit.html?level=transit-relay',{waitUntil:'domcontentloaded'});await ready();
 check(width,'HQ coarse does not overwrite Transit fine',await page.evaluate(()=>__tx.r3.gridDetail===2));
 check(width,'no page errors',!errors.length,errors);
 }catch(e){check(width,'flow completes',false,e.stack);console.error(e.stack)}
 await ctx.close();
}}finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);if(results.some(r=>!r.pass))process.exitCode=1;
