// Real modules and isolated database; synthetic identities, no production requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createArcadeDatabase,OWNER} from '../test/support/arcade-database.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const database=await createArcadeDatabase();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const base='https://arcade.fixture.invalid',root=process.cwd(),locationId='bridgeport-main-elm';
const key='here.city-arcade.sole-street.session.v1:'+locationId;
try {
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  let drop=true,revoked=false,finishes=0;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.origin==='https://api.mccluster.org'){
    assert.ok(u.pathname.startsWith('/v1/arcade/'));
    const response=await database.handle(new Request(req.url(),{method:req.method(),headers:{...req.headers(),authorization:revoked?'Bearer member':'Bearer local-owner'},...(req.postData()?{body:req.postData()}:{})}));
    if(u.pathname.includes('/finish/')){finishes++;if(drop){drop=false;assert.equal(response.status,200);return route.abort('failed');}}
    return route.fulfill({status:response.status,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:await response.text()});
   }
   assert.equal(u.origin,base,'no other host may receive requests');
   if(u.pathname==='/test')return route.fulfill({contentType:'text/html',body:'<main id="game"></main>'});
   const file=resolve(root,'.'+u.pathname);assert.ok(file.startsWith(root+'/'));
   return route.fulfill({body:await readFile(file),contentType:extname(file)==='.json'?'application/json':'text/javascript'});
  });
  await page.goto(base+'/test');
  await page.evaluate(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'fixture'})));
  const mount=()=>page.evaluate(async()=>{
   const data=await fetch('/data/fictional-city/district.v1.json').then(r=>r.json());
   const neighborhood=data.neighborhoods.find(n=>n.id==='bridgeport-robbery-1s');
   const {mountSoleStreet}=await import('/js/city-arcade/sole-street-view.mjs');
   window.dispose=mountSoleStreet(document.getElementById('game'),()=>{},{locationId:'bridgeport-main-elm',point:[51.1422,-253.0175],neighborhood,onReturn(){}});
  });
  await mount();await page.locator('summary').click();
  await page.locator('[data-sole-load]').click();
  await page.waitForFunction(()=>/No saved mission|Loaded private/.test(document.querySelector('[data-sole-cloud-status]').textContent));
  await page.locator('[data-sole-save]').click();
  await page.waitForFunction(()=>document.querySelector('[data-sole-cloud-status]').textContent.includes('saved.'));
  await page.locator('[data-sole-cloud-play]').click();
  await page.waitForFunction(()=>document.querySelector('[data-sole-cloud-status]').textContent.includes('Playing private'));
  await page.locator('[data-sole-pause]').click();
  // Fast-forward only the local timer to exercise the actual completion callback.
  await page.evaluate(key=>{window.dispose();const s=JSON.parse(localStorage.getItem(key));s.remaining=.01;localStorage.setItem(key,JSON.stringify(s));},key);
  await page.reload();await mount();await page.locator('[data-sole-start]').click();
  await page.waitForFunction(()=>document.querySelector('[data-sole-cloud-status]').textContent.includes('Local play and device saves remain available.')&&!document.querySelector('[data-sole-cloud-status]').textContent.startsWith('Checking'));
  const pending=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  assert.equal(pending.status,'failed');assert.equal(pending.pending.id,pending.cloudRun);assert.equal(finishes,1);
  // A revoked session cannot consume or clear the preserved result.
  revoked=true;await page.reload();await mount();
  await page.waitForFunction(()=>document.querySelector('[data-sole-cloud-status]').textContent.startsWith('Cloud missions unavailable'));
  assert.equal(await page.locator('[data-sole-retry]').isDisabled(),true);
  assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).pending,key),pending.pending);
  revoked=false;await page.reload();await mount();await page.locator('summary').click();
  await page.waitForFunction(()=>document.querySelector('[data-sole-cloud-status]').textContent.startsWith('Completed run restored'));
  await page.locator('[data-sole-retry]').click();
  await page.waitForFunction(()=>document.querySelector('[data-sole-cloud-status]').textContent.includes('Practice result saved'));
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null);
  const rows=await database.db.query('select id from arcade_runs where id=$1 and actor=$2',[pending.cloudRun,OWNER]);
  assert.equal(rows.rows.length,1);assert.equal(finishes,2);assert.deepEqual(errors,[]);
  await context.close();console.log('PASS',width,'accepted-response loss, reload, revoked denial and idempotent retry');
 }
}finally{await browser.close();await database.close();}
