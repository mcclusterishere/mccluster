/* Local-file browser fixtures only. No real auth, news requests or publication.
   Three.js is pinned and served locally; all other external origins are blocked.
   Completion uses real button clicks and the board tile-input adapter (semantic
   integration, not a full pointer/touch navigation test). No game-state injection.
   GENERATED_COMPLETION_ONLY=1 reruns layout/completion plus access/quota checks;
   GENERATED_CASE=woodland-survey-1280 selects a single completion case for debugging. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'));
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require('playwright-core'));}
// MCC_SERVE_ROOT points the fixture server at an EMITTED export (the tree after
// deploy-pages.yml's strip) instead of the source checkout, so the run proves the
// published module graph, not the repository's (audit W1, 2026-11-09).
const ROOT=process.env.MCC_SERVE_ROOT?resolve(process.env.MCC_SERVE_ROOT)+sep:fileURLToPath(new URL('../../',import.meta.url)),BASE='https://matthew.mccluster.org';
const THREE=process.env.THREE_DIR||'/tmp/prim3-qa/node_modules/three';
assert.equal(JSON.parse(await readFile(join(THREE,'package.json'),'utf8')).version,'0.180.0','pinned renderer required');
const out=process.argv[2]||'/tmp/prim3-generated-proof';await mkdir(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function context(width,owner=true,quota=false){
  const ctx=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
  ctx.setDefaultTimeout(60000);
  await ctx.addInitScript(({quota})=>{
    localStorage.setItem('prim3.tactics.preview.gfx','low');
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'synthetic-owner',expires_at:Math.floor(Date.now()/1000)+3600}));
    if(quota){const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('prim3.generated.recipe.'))throw new Error('fixture quota');return set.call(this,k,v);};}
  },{quota});
  const requests=[];
  await ctx.route('**/*',async route=>{
    const u=new URL(route.request().url());requests.push(u.pathname);
    if(u.hostname==='api.mccluster.org')return route.fulfill({status:owner?200:403,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(u.pathname==='/v1/status'?{ok:owner}:{comments:[]})});
    if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/three@0.180.0/')){
      const file=resolve(THREE,u.pathname.slice('/npm/three@0.180.0/'.length));assert.ok(file.startsWith(resolve(THREE)+sep));
      return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:await readFile(file)});
    }
    if(u.origin!==BASE)return route.abort();
    if(['/js/tabbar.js','/js/shell-boot.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:'/* unrelated shared shell excluded */'});
    const file=resolve(ROOT,decodeURIComponent(u.pathname.slice(1)));if(!file.startsWith(resolve(ROOT)+sep))return route.abort();
    try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  return {ctx,requests};
}
async function launchGenerated(page,link){
  await link.click({noWaitAfter:true});
  // The app consumes new=1 with replaceState during boot; observe the actual
  // document instead of racing navigation events for the pre-replacement URL.
  await page.waitForFunction(()=>location.pathname==='/prim3-transit.html'&&document.readyState!=='loading',null,{timeout:60000});
  await page.waitForFunction(()=>!!window.__tx?.r3,null,{timeout:60000});
}
async function assertRendered(page){
  await page.waitForFunction(()=>window.__tx?.r3&&!__tx.busy);
  assert.equal(await page.locator('#tx3d canvas').count(),1);
  assert.ok(await page.locator('#tx3d canvas').evaluate(c=>c.width>0&&c.height>0));
  assert.doesNotMatch(await page.locator('body').innerText(),/3D view could not load/);
  assert.equal(await page.locator('[data-sheet=brief-go]').isVisible(),false);
}

// Plan with the canonical pure resolver. Execute through ordinary pointer clicks on UI buttons
// and the board's tile-input adapter; never assign state, HP, AP, opponents or saves.
async function completeGenerated(page,label){
  const initial=await page.evaluate(()=>JSON.parse(JSON.stringify(__tx.state)));
  assert.equal(initial.units.filter(u=>u.faction!=='PLAYER').length,2,'ordinary opponents retained');
  const commands=[];
  for(let step=0;step<180;step++){
    await page.waitForFunction(()=>__tx&&!__tx.busy);
    const terminal=await page.evaluate(()=>__tx.ui.ended);
    if(terminal){assert.equal(terminal,'win',`${label}: normal combat outcome`);break;}
    const cmd=await page.evaluate(async()=>{
      const R=await import('/js/prim3-tactics/tactical-resolver.mjs');
      const {playerProjection}=await import('/js/prim3-tactics/tactical-hints.mjs');
      const {loadLevel}=await import('/js/prim3-tactics/levels/index.mjs');
      const level=await loadLevel('generated'),s=__tx.state,known=playerProjection(s),done=s.nodes.every(n=>n.state==='VERIFIED');
      const squad=s.units.filter(u=>u.faction==='PLAYER'&&!u.dead&&!u.downed&&!u.statuses.includes('EXTRACTED'));
      for(const u of squad){
        if(done){try{R.extractUnit(s,u.id);return{id:u.id,act:'extract'};}catch{}}
        if(u.ap<1)continue;
        const special=level.HOOKS.actions(s,u.id)[0];if(special)return{id:u.id,act:special.id};
        const targets=known.units.filter(e=>e.faction!=='PLAYER'&&!e.dead&&!e.downed).filter(e=>{try{return R.shotPreview(s,u.id,e.id).legal;}catch{return false;}});
        if(targets.length)return{id:u.id,act:'fire',target:targets[0].id};
        if(u.ammo===0&&u.reserveAmmo>0)return{id:u.id,act:'reload'};
        const node=s.nodes.find(n=>n.state!=='VERIFIED'&&n.at.roles.includes(u.role));
        const target=done?s.battlefield.extractionZone:node?.at;if(!target)continue;
        const candidates=done?[{x:target.x,y:target.y,z:0}]:[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({x:target.x+dx,y:target.y+dy,z:0}));
        const paths=candidates.map(p=>R.findPath(s,u.id,p)).filter(Boolean).sort((a,b)=>a.length-b.length);
        const reach=R.computeReach(s,u.id,u.moveRange),path=paths[0];
        const dest=path&&[...path].reverse().find(p=>reach.costAt(p.x,p.y,p.z)!==undefined&&!s.units.some(other=>other.id!==u.id&&!other.dead&&!other.statuses.includes('EXTRACTED')&&other.x===p.x&&other.y===p.y&&other.z===p.z));
        if(dest)return{id:u.id,act:'move',dest};
      }
      return{act:'end'};
    });
    commands.push(cmd);
    console.log(`${label} action ${step+1}: ${cmd.id||"squad"} ${cmd.act}`);
    const before=await page.evaluate(()=>JSON.stringify(__tx.state));
    if(cmd.act==='end')await page.locator('#txEndTurn').click();
    else{
      await page.locator(`[data-unit="${cmd.id}"]`).click();
      const action=page.locator(`[data-act="${cmd.act}"]`);
      assert.equal(await action.isEnabled(),true);assert.equal(await action.isVisible(),true);
      await action.click();
      if(cmd.act==='move'){
        await page.evaluate(dest=>__tx.onTap(dest),cmd.dest);
        await page.locator('[data-sheet="confirm-move"]').click();
      }else if(cmd.act==='fire'){
        const aim=page.locator(`[data-sheet="aim:${cmd.target}"]`);if(await aim.count())await aim.click();
        assert.equal(await page.evaluate(()=>__tx.ui.preview?.target),cmd.target);
        await page.locator('[data-sheet="confirm-fire"]').click();
      }
    }
    await page.waitForFunction(()=>!__tx.busy);
    assert.notEqual(await page.evaluate(()=>JSON.stringify(__tx.state)),before,`${label}: action executes`);
    if(step===8){const mid=await page.evaluate(()=>JSON.stringify(__tx.state));await page.reload();await page.waitForFunction(()=>window.__tx?.r3&&!__tx.busy);assert.equal(await page.evaluate(()=>JSON.stringify(__tx.state)),mid);if(await page.locator('[data-sheet=brief-go]').isVisible())await page.locator('[data-sheet=brief-go]').click();}
  }
  assert.equal(await page.evaluate(()=>__tx.ui.ended),'win',`${label}: completes within bounded action budget`);
  assert.equal(await page.evaluate(()=>__tx.state.nodes.every(n=>n.state==='VERIFIED')&&__tx.state.units.filter(u=>u.faction==='PLAYER').every(u=>!u.dead&&u.statuses.includes('EXTRACTED'))),true);
  assert.equal(await page.locator('#txAftermathSquad [data-result-unit]').count(),3);
  assert.ok(await page.locator('#txAftermathGoals [data-goal]').count()>0);
  assert.match(await page.locator('#txEnd').innerText(),/Exercise debrief/);
  assert.equal(await page.locator('#txEndTurn').isDisabled(),true);
  const earned=await page.evaluate(()=>JSON.stringify(__tx.state));
  await page.screenshot({path:join(out,`${label}-win.png`),fullPage:true});
  await page.reload();await page.waitForFunction(()=>window.__tx?.r3&&!__tx.busy);
  assert.equal(await page.evaluate(()=>JSON.stringify(__tx.state)),earned);
  assert.equal(await page.evaluate(()=>__tx.ui.ended),'win');
  await writeFile(join(out,`${label}-execution.json`),JSON.stringify({initial,commands,final:JSON.parse(earned)},null,2));
  console.log(`PASS ${label} ordinary opponents, objectives, extraction, debrief and reload (${commands.length} actions)`);
}

async function prepare(page){
  await page.goto(BASE+'/prim3-world.html?m=us-road-kit');
  await page.locator('.pw-generated summary').click();
  await page.locator('[name=geoSource]').fill('https://example.org/geography');
  await page.locator('[name=objective]').selectOption('recover');
  await page.locator('[name=source]').fill(JSON.stringify({kind:'reviewed-public-news',eventId:'synthetic-browser-fixture',url:'https://example.org/news',publisher:'Synthetic test publisher',publishedAt:new Date().toISOString(),country:'US',theme:'logistics',reviewId:'fixture-review'}));
  await page.locator('[name=reviewed]').check();
  await page.locator('.pw-generated button[type=submit]').click();
}
try{
  if(!process.env.GENERATED_COMPLETION_ONLY)for(const width of [390,1280]){
    const {ctx}=await context(width),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    try{
      await prepare(page);
      const link=page.locator('.pw-generated [data-result] a');await link.waitFor();const first=await link.getAttribute('href');
      await page.locator('.pw-generated button[type=submit]').click();assert.equal(await link.getAttribute('href'),first,'repeated Generate reproduces identity');
      await page.locator('[name=seed]').fill('2');assert.equal(await link.count(),0);assert.equal(await page.locator('[name=reviewed]').isChecked(),false);
      await page.locator('[name=seed]').fill('1');await page.locator('[name=reviewed]').check();await page.locator('.pw-generated button[type=submit]').click();assert.equal(await link.getAttribute('href'),first);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'no horizontal overflow');
      await page.screenshot({path:join(out,`review-${width}.png`),fullPage:true});
      await launchGenerated(page,link);await page.locator('[data-sheet=brief-go]').click();
      assert.deepEqual(await page.evaluate(()=>window.__tx.state.nodes.map(n=>n.at.roles)),[['E'],['E']]);
      assert.match(await page.locator('#txObj').innerText(),/Recover|Supply/i);
      await page.evaluate(()=>window.__tx.onAct('hunker'));
      const saved=await page.evaluate(()=>JSON.stringify(window.__tx.state));
      await page.reload();await page.waitForFunction(()=>!!window.__tx?.r3);assert.equal(await page.evaluate(()=>JSON.stringify(window.__tx.state)),saved);
      await page.goto(BASE+'/prim3-world.html?m=us-road-kit');await page.locator('.pw-generated summary').click();
      assert.equal(await page.locator('[name=reviewed]').isChecked(),false);await page.locator('[name=reviewed]').check();await page.locator('.pw-generated button[type=submit]').click();
      assert.equal(await page.locator('.pw-generated [data-result] a').innerText(),'Resume saved mission');
      assert.ok(!(await page.locator('.pw-generated [data-result] a').getAttribute('href')).includes('new=1'));
      await launchGenerated(page,page.locator('.pw-generated [data-result] a'));
      assert.equal(await page.evaluate(()=>JSON.stringify(window.__tx.state)),saved);
      await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+86400001;window.__tx.restart();Date.now=original;});
      assert.equal(await page.evaluate(()=>JSON.stringify(window.__tx.state)),saved);assert.match(await page.locator('#txSaveNotice').innerText(),/expired/);
      if(await page.locator('[data-sheet=brief-go]').count())await page.locator('[data-sheet=brief-go]').click();
      await assertRendered(page);
      await page.screenshot({path:join(out,`mission-${width}.png`),fullPage:true});
      assert.deepEqual(errors,[]);console.log(`PASS generated review, repeated actions, save/resume, expiry at ${width}px`);
    }finally{await ctx.close();}
  }

  for(const width of [390,1280])for(const [terrain,objective] of [['urban','restore'],['coastal','recover'],['woodland','survey']]){
    if(process.env.GENERATED_CASE&&process.env.GENERATED_CASE!==`${terrain}-${objective}-${width}`)continue;
    const {ctx}=await context(width),page=await ctx.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));const label=`${terrain}-${objective}-${width}`;
    try{
      await page.clock.setFixedTime(new Date('2026-11-07T12:00:00.007Z'));
      await page.goto(BASE+'/prim3-world.html?m=us-road-kit');
      await page.locator('.pw-generated summary').click();
      await page.locator('[name=geoSource]').fill('https://example.org/geography');
      await page.locator('[name=terrain]').selectOption(terrain);await page.locator('[name=objective]').selectOption(objective);
      await page.locator('[name=reviewed]').check();await page.locator('.pw-generated button[type=submit]').click();
      await launchGenerated(page,page.locator('.pw-generated [data-result] a'));
      await page.waitForFunction(()=>!__tx.busy);
      await page.locator('[data-sheet=brief-go]').click();await assertRendered(page);
      await page.locator('#tx3d').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`${label}-map.png`),fullPage:true});
      await completeGenerated(page,label);assert.deepEqual(errors,[]);
    }catch(error){await page.screenshot({path:join(out,`${label}-failure.png`),fullPage:true}).catch(()=>{});await writeFile(join(out,`${label}-failure.json`),JSON.stringify({error:error.stack,url:page.url(),errors,document:await page.evaluate(()=>({readyState:document.readyState,renderer:!!window.__tx?.r3})).catch(()=>null),state:await page.evaluate(()=>window.__tx?.state).catch(()=>null)},null,2));throw error;}
    finally{await ctx.close();}
  }
  const denied=await context(390,false);try{const page=await denied.ctx.newPage();await page.goto(BASE+'/prim3-world.html');await page.waitForFunction(()=>document.querySelector('[data-owner-msg]')?.textContent.includes('house owner'));assert.ok(!denied.requests.includes('/js/prim3-world/mission-generator.mjs'));assert.equal(await page.locator('.pw-generated').count(),0);console.log('PASS denied owner');}finally{await denied.ctx.close();}
  const quota=await context(390,true,true);try{const page=await quota.ctx.newPage();await prepare(page);assert.match(await page.locator('.pw-generated [role=status]').innerText(),/quota/);assert.equal(await page.locator('.pw-generated [data-result] a').count(),0);console.log('PASS recipe save failure');}finally{await quota.ctx.close();}
}finally{await browser.close();}
