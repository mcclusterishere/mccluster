// Real browser, local HTTP only. Owner API is a fixture; no production session or writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '/opt/node-tools/node_modules','package.json'))('playwright');
const root = resolve('.');
const server = createServer(async (req,res) => {
  const path = resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!path.startsWith(root+'/')) {res.writeHead(403).end(); return;}
  try { const data=await readFile(path); res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(path)] || 'application/octet-stream');res.end(data); }
  catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
const errors=[];
try {
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await context.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.origin===base) {
      // Shared navigation has its own tests; keep this test independent of its auth refresh/services.
      if(u.pathname==='/js/tabbar.js') return route.fulfill({contentType:'text/javascript',body:''});
      return route.continue();
    }
    if(u.href==='https://api.mccluster.org/v1/status') return route.fulfill({json:{ok:true},headers:{'access-control-allow-origin':'*'}});
    return route.abort();
  });
  await context.addInitScript(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'local-test-fixture'})));
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  const url=base+'/game-hub.html#m=chem108&play=molecule-rush';
  await page.goto(url);
  await page.locator('[data-example]').click();
  await page.locator('[data-answer-title]').waitFor();
  await page.locator('[data-highlight=parent]').click();
  assert.match(await page.locator('[data-anchor-feedback]').innerText(),/3 carbons/);
  // Native disclosure is keyboard-operable; depths are buttons with announced selection.
  await page.locator('.mr-worked [data-depth="2"]').click();
  const summary=page.locator('.mr-worked summary').first(); await summary.focus(); await page.keyboard.press('Enter');
  assert.equal(await summary.evaluate(el=>el.parentElement.open),true);
  await page.locator('[data-lesson-choice="1"]').click();
  assert.match(await page.locator('[data-lesson-feedback]').innerText(),/Try again/);
  await page.locator('[data-lesson-choice="0"]').click();
  assert.match(await page.locator('[data-lesson-feedback]').innerText(),/^Yes/);
  await page.locator('.mr-author > summary').click();
  await page.locator('textarea[name=summary]').fill('Draft preview <script>not executed</script>');
  await page.locator('textarea[name=reviewNote]').fill('Check locant explanation against source.');
  await page.getByRole('button',{name:'Preview new draft version',exact:true}).click();
  await page.locator('[data-draft-preview] [data-highlight=feature]').click();
  assert.match(await page.locator('[data-draft-preview]').innerText(),/Draft preview <script>/);
  await page.locator('[data-review]').click();
  assert.match(await page.locator('[data-author-status]').innerText(),/Marked for review locally/);
  const original=require('../../js/game-hub/chem108/data/data.js').molecules.find(m=>m.id==='m27').svg;
  const geometry=await page.locator('.mr-answer-diagram svg').first().evaluate(el=>Array.from(el.querySelectorAll('path')).map(p=>p.getAttribute('d')));
  const expected=await page.evaluate(svg=>{const t=document.createElement('template');t.innerHTML=svg;return Array.from(t.content.querySelectorAll('path')).map(p=>p.getAttribute('d'));},original);
  assert.deepEqual(geometry,expected,'annotated answer preserves every original atom/bond path');
  for(const width of [390,320,1024]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),`no overflow at ${width}`);
  }
  await page.setViewportSize({width:390,height:844});
  if(process.env.AXE_PATH) {
    await page.addScriptTag({path:process.env.AXE_PATH});
    const results=await page.evaluate(()=>axe.run('#ghPlay',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
    if(results.violations.length) console.log(JSON.stringify(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({html:n.html,summary:n.failureSummary}))})),null,2));
    assert.deepEqual(results.violations.map(v=>({id:v.id,nodes:v.nodes.length})),[]);
    console.log(`axe: ${results.passes.length} passing checks; zero WCAG A/AA violations in game panel`);
  }
  await mkdir('/tmp/chem108-evidence',{recursive:true});
  await page.locator('.mr-author > summary').click();
  await page.screenshot({path:'/tmp/chem108-evidence/answer-390.png',fullPage:true});
  // Every authored lesson: browser-resolved anchors, immutable paths, disclosure and draft version.
  const allMolecules=require('../../js/game-hub/chem108/data/data.js').molecules;
  let atomCount=0;
  for(const molecule of allMolecules) {
    await page.locator('[data-study-structure]').selectOption(molecule.id);
    await page.locator('[data-answer-title]').waitFor();
    const facts=await page.evaluate(async id=>{
      const {lessonFor}=await import('/js/game-hub/chem108/worked-example.mjs');
      return lessonFor(id);
    },molecule.id);
    const answer=page.locator('.mr-answer').first();
    await answer.locator('.mr-atoms summary').click();
    for(const atom of facts.graph.atoms) {
      await answer.locator(`[data-atom="${atom.id}"]`).click();
      const anchor=await answer.locator('[data-annotation-overlay]').evaluate(el=>({id:+el.dataset.atomId,x:+el.dataset.anchorX,y:+el.dataset.anchorY}));
      assert.equal(anchor.id,atom.id);assert.ok(Number.isFinite(anchor.x)&&Number.isFinite(anchor.y));
      assert.ok(anchor.x>=0&&anchor.x<=500&&anchor.y>=0&&anchor.y<=230,`${molecule.id}/${atom.id} anchor inside original canvas`);
      assert.match(await answer.locator('[data-atom-feedback]').innerText(),new RegExp(`valence ${atom.hydrogens+atom.lewisBondOrderSum}`));
      atomCount++;
    }
    const paths=await answer.locator('svg').evaluate(el=>Array.from(el.querySelectorAll('path')).map(p=>p.getAttribute('d')));
    const originalPaths=await page.evaluate(svg=>{const t=document.createElement('template');t.innerHTML=svg;return Array.from(t.content.querySelectorAll('path')).map(p=>p.getAttribute('d'));},molecule.svg);
    assert.deepEqual(paths,originalPaths,molecule.id+' unchanged drawing');
    await answer.locator('[data-depth="3"]').click();
    await answer.locator('.mr-worked details:not([hidden])').evaluateAll(els=>els.forEach(el=>el.open=true));
    const correctCheck=facts.check.options.findIndex(o=>o.correct),wrongCheck=facts.check.options.findIndex(o=>!o.correct);
    await answer.locator(`[data-lesson-choice="${wrongCheck}"]`).click();assert.match(await answer.locator('[data-lesson-feedback]').innerText(),/Try again/);
    await answer.locator(`[data-lesson-choice="${correctCheck}"]`).click();assert.match(await answer.locator('[data-lesson-feedback]').innerText(),/^Yes/);
    for(const width of [320,390,1024]) {
      await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),`${molecule.id} at ${width}`);
    }
    await page.setViewportSize({width:390,height:844});
    if(process.env.AXE_PATH) {
      const violations=await page.evaluate(async()=> (await axe.run('#ghPlay',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id));
      assert.deepEqual(violations,[],molecule.id+' WCAG scan');
    }
    await page.locator('.mr-author > summary').click();
    await page.locator('textarea[name=reviewNote]').fill('Local review of '+molecule.id+' atom anchors and naming.');
    await page.getByRole('button',{name:'Preview new draft version',exact:true}).click();
    assert.match(await page.locator('[data-draft-preview]').innerText(),new RegExp(molecule.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    await page.locator('[data-review]').click();assert.match(await page.locator('[data-author-status]').innerText(),/Marked for review locally/);
  }
  console.log(`All 49 author previews, ${atomCount} atom anchors, original paths, checks, depths and widths passed.`);
  // Bias normal scheduling to each structure without changing its identity or scoring.
  for(const molecule of allMolecules) for(const correct of [true,false]) {
    await page.evaluate(id=>{const records={};for(let i=1;i<=49;i++)records['m'+i]={seen:1,correct:1,streak:1,due:Date.now()+999999};records[id].due=0;localStorage.setItem('mcc.gamehub.chem108.v1',JSON.stringify({v:1,best:{},topics:{},records}));},molecule.id);
    await page.reload(); await page.locator('[data-topic]').selectOption(molecule.deck);await page.locator('[data-start]').click();
    const options=page.locator('[data-i]');
    const labels=await options.locator('span').allTextContents();
    const idx=labels.findIndex(t=>[molecule.name,...molecule.aliases].includes(t)); assert.ok(idx>=0);
    await options.nth(correct?idx:(idx+1)%4).click();
    await page.locator('[data-answer-title]').waitFor();
    assert.match(await page.locator('[data-answer-title]').innerText(),correct?/Correct/:/work it through/);
    if(molecule.id==='m27') {const secs=await page.locator('[data-secs]').innerText();await page.waitForTimeout(1100);assert.equal(await page.locator('[data-secs]').innerText(),secs);}
    await page.locator('[data-continue]').click(); assert.equal(await page.locator('.mr-answer').count(),0);
    await page.locator('[data-quit]').click();
    const save=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcc.gamehub.chem108.v1')));
    assert.equal(save.topics[molecule.deck].seen,1);assert.equal(save.topics[molecule.deck].correct,correct?1:0);
    assert.equal(save.records[molecule.id].seen,2);
  }
  console.log('All 98 correct/wrong structure game flows scored exactly once.');
  assert.deepEqual(errors,[]);
  await context.close();
  const guest=await browser.newPage();let loaded=false;
  guest.on('request',r=>{if(r.url().includes('/chem108/'))loaded=true;});
  await guest.goto(url); await guest.locator('[data-owner-msg]').waitFor();assert.equal(await guest.locator('[data-example]').count(),0);assert.equal(loaded,false);
  console.log('PASS: paired correct/wrong answers, unchanged geometry, paused timer, scoring once, owner drafts, keyboard, 320/390/1024 overflow and guest gate.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
