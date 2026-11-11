// Owner setup and actual UI actions only. State observations read the saved run; no game-state injection.
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire((process.env.PLAYWRIGHT_DIR||'/opt/codex/cua_node/lib/node_modules')+'/fixture.cjs')('playwright');
const root=fileURLToPath(new URL('../../',import.meta.url)),base='https://matthew.mccluster.org',out=process.argv[2]||'/tmp/prim3-city-proof';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
const results=[];const types={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css'};
try{for(const width of [390,1280])for(const topology of ['hex','square']){
 const ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390,serviceWorkers:'block'});
 // The fixture session has the shape every signed-in session has (a future expiry and a refresh token): the canonical auth helper, when it loads before the owner gate, treats an expiry-less session with nothing to refresh it as signed out.
 await ctx.addInitScript(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'fixture-owner',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600})));
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='api.mccluster.org')return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:'{}'});if(u.origin!==base)return route.abort();try{const f=resolve(root,'.'+u.pathname);return route.fulfill({body:await readFile(f),contentType:types[extname(f)]||'text/plain'});}catch{return route.fulfill({status:404,body:''});}});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('here.prim3.city-tactics.v1')));
 await page.goto(base+'/prim3-city-tactics.html');await page.locator('summary').click();await page.locator('#topology').selectOption(topology);await page.locator('#start').click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('ACTIVE'));
 let run=await saved();assert.equal(run.topology,topology);
 const initial=JSON.stringify(run);await page.reload();await page.locator('summary').click();await page.locator('#resume').click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('ACTIVE'));assert.equal(JSON.stringify(await saved()),initial);
 for(let i=0;i<8;i++){run=await saved();if(run.state.units[1].dead)break;await page.locator(run.state.units[0].ap?'#fire':'#end').click();}
 run=await saved();assert.equal(run.state.units[1].dead,true);
 for(let i=0;i<10;i++){
   run=await saved();if(run.state.units[0].x===run.state.battlefield.extractionZone.x)break;
   if(!run.state.units[0].ap){await page.locator('#end').click();continue;}
   // Read canonical path solely to choose a UI destination; the UI owns preview and execution.
   const target=await page.evaluate(async()=>{const R=await import('/js/prim3-tactics/tactical-resolver.mjs');const s=JSON.parse(localStorage.getItem('here.prim3.city-tactics.v1')).state;const path=R.findPath(s,'R1',s.battlefield.extractionZone);const available=new Set([...document.querySelector('#destination').options].map(o=>o.value));return path.filter(c=>available.has(String(c.x))).at(-1)?.x;});
   assert.notEqual(target,undefined);const before=JSON.stringify(await saved());await page.locator('#destination').selectOption(String(target));assert.equal(JSON.stringify(await saved()),before,'preview must not move');await page.locator('#confirm').click();assert.notEqual(JSON.stringify(await saved()),before);
 }
 await page.locator('#extract').click();assert.match(await page.locator('#status').textContent(),/COMPLETE/);
 const complete=JSON.stringify(await saved());await page.reload();await page.locator('summary').click();await page.locator('#resume').click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('COMPLETE'));assert.equal(JSON.stringify(await saved()),complete);
 assert.equal(await page.locator('#end').isDisabled(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);assert.deepEqual(errors,[]);
 await page.screenshot({path:`${out}/${width}-${topology}.png`,fullPage:true});results.push({width,topology,complete:true,reload:true,errors});console.log('PASS',width,topology,'owner setup → shots → turns → preview/confirm → extraction → reload');await ctx.close();
 }
 const denied=await browser.newContext();let fetched=false;
 await denied.route('**/*',async route=>{const u=new URL(route.request().url());if(u.pathname.includes('city-simulation')||u.pathname.includes('bridgeport-downtown'))fetched=true;try{const f=resolve(root,'.'+u.pathname);return route.fulfill({body:await readFile(f),contentType:types[extname(f)]||'text/plain'});}catch{return route.fulfill({status:404,body:''});}});
 const p=await denied.newPage();await p.goto(base+'/prim3-city-tactics.html');await p.waitForFunction(()=>document.querySelector('[data-owner-msg]')?.textContent.includes('Sign in'));assert.equal(fetched,false);assert.equal(await p.locator('#start').count(),0);results.push({deniedRole:true,engineNotFetched:true});await denied.close();
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
}finally{await browser.close();}
