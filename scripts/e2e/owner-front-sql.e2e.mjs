// Actual browser -> loopback HTTP -> isolated PostgreSQL; no mocked RPC responses.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {startOwnerFrontPreview} from '../dev/owner-front-preview.mjs';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/tmp/mccluster-owner-tools/node_modules','entry.cjs'))('playwright');
const app=await startOwnerFrontPreview({port:0});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const state=()=>page.evaluate(()=>({ready:CR.frontPage.state.publicationReady,draft:CR.frontPage.state.draft,stored:CR.frontPage.state.storedDraft,revision:CR.frontPage.state.revision,message:CR.frontPage.state.message}));
const act=async name=>page.locator('[data-cfp="'+name+'"]').click();
const settled=async()=>page.waitForFunction(()=>!CR.frontPage.state.saving&&CR.frontPage.state.draft);
const publicRows=async()=>fetch(app.origin+'/rest/v1/site_content').then(r=>r.json());
try{
 await page.goto(app.origin+'/control.html');
 await page.waitForFunction(()=>CR.frontPage.state.publicationReady&&CR.frontPage.state.draft);
 await page.selectOption('select[name="song"]','here');await act('save-draft');
 await page.waitForFunction(()=>CR.frontPage.state.storedDraft?.config?.song==='here');
 assert.equal((await publicRows()).length,0,'private draft never publishes');
 await page.reload();await page.waitForFunction(()=>CR.frontPage.state.storedDraft&&CR.frontPage.state.draft);
 await act('resume');await page.waitForFunction(()=>CR.frontPage.state.draft.song==='here');
 await act('save');await page.waitForFunction(()=>!CR.frontPage.state.saving&&CR.frontPage.state.history.length===1);
 assert.equal(JSON.parse((await publicRows())[0].value).song,'here');
 assert.equal((await state()).stored,null,'matching published draft removed');
 await page.selectOption('select[name="song"]','vaunt');await act('save');
 await page.waitForFunction(()=>!CR.frontPage.state.saving&&CR.frontPage.state.history.length===2);
 await page.locator('[data-cfp-history] summary').click();
 await page.locator('[data-cfp="history"]').last().click();await settled();
 assert.equal(JSON.parse((await publicRows())[0].value).song,'vaunt','history preview stays private');
 await act('save');await page.waitForFunction(()=>!CR.frontPage.state.saving&&CR.frontPage.state.history.length===3);
 assert.equal(JSON.parse((await publicRows())[0].value).song,'here','restore appends publication');
 await page.selectOption('select[name="song"]','runway');await act('save-draft');
 await page.waitForFunction(()=>CR.frontPage.state.storedDraft?.config?.song==='runway');
 // A second tab publishes through the same UI; the first tab's saved draft remains old.
 const second=await browser.newPage();await second.goto(app.origin+'/control.html');
 await second.waitForFunction(()=>CR.frontPage.state.publicationReady&&CR.frontPage.state.draft);
 await second.selectOption('select[name="song"]','vaunt');await second.locator('[data-cfp="save"]').click();
 await second.waitForFunction(()=>!CR.frontPage.state.saving&&CR.frontPage.state.history.length===4);await second.close();
 await act('save');await page.waitForFunction(()=>!CR.frontPage.state.saving&&!CR.frontPage.state.publicationReady);
 assert.equal((await state()).draft.song,'runway');assert.equal(JSON.parse((await publicRows())[0].value).song,'vaunt');
 await act('reload');await page.waitForFunction(()=>CR.frontPage.state.publicationReady&&CR.frontPage.state.draft);
 await act('resume');await page.waitForFunction(()=>CR.frontPage.state.draft.song==='runway');
 await act('rebase');await act('save');await page.waitForFunction(()=>!CR.frontPage.state.saving&&CR.frontPage.state.history.length===5);
 assert.equal(JSON.parse((await publicRows())[0].value).song,'runway');
 await page.selectOption('select[name="song"]','here');await act('save-draft');await page.waitForFunction(()=>CR.frontPage.state.storedDraft?.config?.song==='here');
 await act('clear-draft');await page.waitForFunction(()=>!CR.frontPage.state.saving&&!CR.frontPage.state.storedDraft);
 assert.equal(JSON.parse((await publicRows())[0].value).song,'runway');
 for(const token of ['fixture-member-local-only','']){
  const r=await fetch(app.origin+'/rest/v1/rpc/owner_front_snapshot_v1',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'});assert.equal(r.status,403);
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: SQL-backed owner UI: save private draft, reload/resume, publish, history preview, restore, discard, two-tab conflict and explicit reconciliation; private/public separation, denied identities, phone overflow and JS errors.');
}finally{await browser.close();await app.close();}
