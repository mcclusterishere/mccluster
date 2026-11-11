// Local browser → actual learning handler → existing-table PostgREST double.
// No real tokens, production API/DB calls, deployment or paid services.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { handleLearning } from '../../workers/mccluster/src/prim3/learning.js';
import { evidenceDb } from '../../workers/mccluster/test/support/adaptive-evidence-db.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const user='00000000-0000-4000-8000-0000000000a1';
const env={SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'test-only',PRIM3_ADAPTIVE_ENABLED:'true',PRIM3_ADAPTIVE_SIGNING_KEY:'browser-local-test-key-000000000000000000000000',ALLOWED_ORIGINS:'http://127.0.0.1:8765'};
const options={requireHouseOwner:async req=>{if(req.headers.get('authorization')!=='Bearer local-test-owner')throw Object.assign(new Error('owner required'),{status:403});return{id:user};}};
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const originalFetch=globalThis.fetch;
try {
  for(const width of [390,1280]) {
    const db=evidenceDb();globalThis.fetch=db.fetchImpl;
    const context=await browser.newContext({viewport:{width,height:844}});
    await context.addInitScript(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'local-test-owner'})));
    await context.route('**/js/tabbar.js*',r=>r.fulfill({contentType:'text/javascript',body:'/* unrelated shell omitted in focused integration test */'}));
    let loseAnswerAck=true;
    await context.route('https://**/*',async r=>{
      const req=r.request(),u=new URL(req.url());
      if(u.origin!=='https://api.mccluster.org')return r.abort();
      if(u.pathname==='/v1/status')return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
      if(!u.pathname.startsWith('/v1/prim3/learning/adaptive'))return r.abort();
      const response=await handleLearning(new Request(req.url(),{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postData()}),env,options);
      const body=await response.text();
      if(loseAnswerAck && req.method()==='POST' && JSON.parse(req.postData()||'{}').type==='answer'){loseAnswerAck=false;return r.abort();}
      return r.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8765/prim3-mission.html');
    await page.waitForFunction(()=>document.getElementById('pmRelease')?.disabled===false);
    await page.check('#pmFiction');await page.check('#pmGeography');await page.click('#pmRelease');await page.click('#pmBegin');await page.click('#pmHandoff');
    const popupPromise=page.waitForEvent('popup');await page.click('#pmTacticalLink');const popup=await popupPromise;
    await popup.waitForURL('**/prim3-transit.html');assert.match(popup.url(),/\/prim3-transit\.html$/);await popup.close();
    await page.click('#pmReturn');
    async function answer(){const n=(await page.locator('#pmQuestion').textContent()).match(/-?\d+/g).map(Number);await page.fill('#pmAnswer',String(Math.abs(n[2]-n[0])));await page.locator('#pmForm button').first().click();}
    await answer();await page.locator('#pmRetry').waitFor({state:'visible'});
    assert.equal(db.tables.learning_evidence_events.length,4,'answer committed before lost response');
    await page.reload();await page.locator('#pmRetry').waitFor({state:'visible'});await page.click('#pmRetry');await page.locator('#pmRetry').waitFor({state:'hidden'});
    assert.equal(db.tables.learning_evidence_events.length,4,'reload/retry did not duplicate evidence');
    await page.click('#pmReturn');await page.click('#pmHint');await page.waitForFunction(()=>document.getElementById('pmFeedback').textContent.includes('subtract'));
    await answer();await page.waitForFunction(()=>document.getElementById('pmFeedback').textContent.includes('scaffolding'));
    // Reach the bounded session limit through the real handler, then reload at the final slot.
    for(let i=0;i<26;i++){await answer();await page.waitForFunction(()=>!document.getElementById('pmFinish').disabled);}
    assert.equal(db.tables.learning_evidence_events.length,32,'31 accepted events plus release; final slot remains free');
    assert.equal(await page.locator('#pmForm button').first().isDisabled(),true);
    assert.equal(await page.locator('#pmHint').isDisabled(),true);
    assert.equal(await page.locator('#pmFinish').isEnabled(),true);
    await page.reload();await page.click('#pmReturn');
    assert.equal(await page.locator('#pmForm button').first().isDisabled(),true);
    assert.equal(await page.locator('#pmHint').isDisabled(),true);
    assert.equal(await page.locator('#pmRetry').isVisible(),false,'no rejected action is queued');
    await page.click('#pmFinish');await page.locator('#pmDebrief').waitFor({state:'visible'});
    assert.match(await page.locator('#pmSummary').textContent(),/28 of 28 answers correct; 27 without hints/);
    assert.equal(db.tables.learning_evidence_events.length,33);assert.equal(db.tables.learning_lab_sessions[0].outcome,'abandoned');
    await page.click('#pmNew');await page.locator('#pmOwner').waitFor({state:'visible'});
    assert.equal(await page.isChecked('#pmFiction'),false);
    await page.waitForFunction(()=>document.getElementById('pmProgress').textContent.includes('1 verified recent'));
    await page.check('#pmFiction');await page.check('#pmGeography');await page.click('#pmRelease');
    await page.locator('#pmBrief').waitFor({state:'visible'});
    assert.equal(db.tables.learning_lab_sessions.length,2,'new reviewed session preserves prior evidence');

    assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
    console.log(`PASS ${width}px review → brief → Transit handoff → lost-ACK/reload/retry → validated answers → durable debrief (DB double), no errors/overflow`);
    await context.close();
  }
} finally {globalThis.fetch=originalFetch;await browser.close();}
