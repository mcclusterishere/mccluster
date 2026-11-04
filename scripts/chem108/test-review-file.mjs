import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const {chromium}=createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/package.json')('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];
try {
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));await page.route('**/*',r=>r.abort());
  await page.setContent(readFileSync(process.argv[2]||'/tmp/chem108-evidence/molecule-rush-49-structure-review.html','utf8'));
  assert.deepEqual(errors,[]);assert.equal(await page.locator('[data-select] option').count(),49);
  const ids=await page.locator('[data-select] option').evaluateAll(els=>els.map(e=>e.value));
  for(const id of ids) {
    await page.locator('[data-select]').selectOption(id);await page.locator('[data-highlight=feature]').click();
    await page.locator('[data-depth="3"]').click();
    const facts=await page.evaluate(id=>lessonFor(id),id);
    assert.equal(await page.locator('[data-preview] > details [data-annotation-overlay]').count(),0,'question drawing stays unannotated');
    assert.equal(await page.locator('.mr-answer [data-annotation-overlay]').count(),1,'answer owns annotations');
    for(let i=0;i<facts.check.options.length;i++) {
      await page.locator(`[data-lesson-choice="${i}"]`).click();
      assert.equal(await page.locator('[data-lesson-feedback]').innerText(),facts.check.options[i].feedback);
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
    const pick=await page.locator('[data-pick] option').evaluateAll(els=>els.map(e=>e.value));
    await page.locator('[data-pick]').selectOption(pick.find(x=>x!==facts.name));
    assert.match(await page.locator('[data-answer-title]').innerText(),/work it through/);
  }
  await page.locator('[data-select]').selectOption('m34');await page.locator('[data-highlight=feature]').click();
  await page.screenshot({path:'/tmp/chem108-evidence/offline-review-390.png',fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log('PASS: self-contained review HTML, all 49 structures, right/wrong comparisons and every quick-check response; zero network requests and zero browser errors.');
} finally {await browser.close();}
