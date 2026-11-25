// Isolated browser fixtures: no production API, auth or schema access.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
const {chromium}=createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/tmp/release-qa/node_modules','package.json'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const root=process.cwd(),base='https://arcade.fixture.invalid';
try{for(const game of ['tea','sole'])for(const mode of ['disabled','unavailable','missing-schema']){
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage(),calls=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async r=>{const u=new URL(r.request().url());
  if(u.origin!==base){assert.equal(u.origin,'https://api.mccluster.org');calls.push(u.pathname);const capability=u.pathname.endsWith('/capabilities');return r.fulfill({status:mode==='unavailable'||!capability?503:200,json:capability?{ok:true,value:{cloudEnabled:mode==='missing-schema'}}:{ok:false,error:'Unavailable'}});}
  if(u.pathname==='/test')return r.fulfill({contentType:'text/html',body:'<main id="game"></main>'});
  const p=resolve(root,'.'+u.pathname);assert.ok(p.startsWith(root+'/'));return r.fulfill({body:await readFile(p),contentType:extname(p)==='.json'?'application/json':'text/javascript'});
 });
 await page.goto(base+'/test');
 await page.evaluate(async game=>{localStorage.setItem('mccdb_session',JSON.stringify({access_token:'fixture'}));const root=document.getElementById('game');
  if(game==='tea'){const {mountTea}=await import('/js/city-arcade/tea-view.mjs');window.dispose=mountTea(root,()=>{},{locationId:'bridgeport-main-elm'});}
  else{const d=await fetch('/data/fictional-city/district.v1.json').then(r=>r.json());const {mountSoleStreet}=await import('/js/city-arcade/sole-street-view.mjs');window.dispose=mountSoleStreet(root,()=>{},{locationId:'bridgeport-main-elm',point:[51.1422,-253.0175],neighborhood:d.neighborhoods.find(n=>n.id==='bridgeport-robbery-1s'),onReturn(){}});}
 },game);
 const prefix=game==='tea'?'cloud':'sole',status=game==='tea'?'cloud-status':'sole-cloud-status';
 if(mode==='missing-schema'){await page.locator(`[data-${prefix}-load]`).waitFor({state:'attached'});await page.waitForFunction(prefix=>!document.querySelector(`[data-${prefix}-load]`).disabled,prefix);await page.locator('details summary').click();await page.locator(`[data-${prefix}-load]`).click();}
 await page.waitForFunction(status=>document.querySelector(`[data-${status}]`).textContent.includes('Local play and device saves remain available.'),status);
 // Wait for capability settlement, not the initial checking message.
 await page.waitForFunction(status=>!document.querySelector(`[data-${status}]`).textContent.startsWith('Checking'),status);
 for(const attr of [prefix+'-load',prefix+'-save',game==='tea'?'cloud-play':'sole-cloud-play',prefix+'-retry'])assert.equal(await page.locator(`[data-${attr}]`).isDisabled(),true);
 const start=page.locator(game==='tea'?'[data-start]':'[data-sole-start]');assert.equal(await start.isEnabled(),true);await start.click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 assert.ok(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.includes('.session.v1:'))),'local game still saves');
 assert.equal(calls.filter(p=>!p.endsWith('/capabilities')).length,mode==='missing-schema'?1:0);assert.deepEqual(errors,[]);
 await page.evaluate(()=>window.dispose());await context.close();console.log('PASS',game,mode,'cloud disabled, local play/save preserved');
}}finally{await browser.close();}
