/* Local-file browser fixtures only. No real auth, news requests or publication. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'));
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require('playwright-core'));}
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),BASE='https://matthew.mccluster.org';
const out=process.argv[2]||'/tmp/prim3-generated-proof';await mkdir(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
async function context(width,owner=true,quota=false){
  const ctx=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
  await ctx.addInitScript(({quota})=>{
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'synthetic-owner',expires_at:Math.floor(Date.now()/1000)+3600}));
    if(quota){const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('prim3.generated.recipe.'))throw new Error('fixture quota');return set.call(this,k,v);};}
  },{quota});
  const requests=[];
  await ctx.route('**/*',async route=>{
    const u=new URL(route.request().url());requests.push(u.pathname);
    if(u.hostname==='api.mccluster.org')return route.fulfill({status:owner?200:403,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(u.pathname==='/v1/status'?{ok:owner}:{comments:[]})});
    if(u.origin!==BASE)return route.abort();
    if(['/js/tabbar.js','/js/shell-boot.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:'/* unrelated shared shell excluded */'});
    const file=resolve(ROOT,decodeURIComponent(u.pathname.slice(1)));if(!file.startsWith(resolve(ROOT)+sep))return route.abort();
    try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  return {ctx,requests};
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
  for(const width of [390,1280]){
    const {ctx}=await context(width),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    try{
      await prepare(page);
      const link=page.locator('.pw-generated [data-result] a');await link.waitFor();const first=await link.getAttribute('href');
      await page.locator('.pw-generated button[type=submit]').click();assert.equal(await link.getAttribute('href'),first,'repeated Generate reproduces identity');
      await page.locator('[name=seed]').fill('2');assert.equal(await link.count(),0);assert.equal(await page.locator('[name=reviewed]').isChecked(),false);
      await page.locator('[name=seed]').fill('1');await page.locator('[name=reviewed]').check();await page.locator('.pw-generated button[type=submit]').click();assert.equal(await link.getAttribute('href'),first);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'no horizontal overflow');
      await page.screenshot({path:join(out,`review-${width}.png`),fullPage:true});
      await link.click();await page.waitForFunction(()=>!!window.__tx);await page.locator('[data-sheet=brief-go]').click();
      assert.deepEqual(await page.evaluate(()=>window.__tx.state.nodes.map(n=>n.at.roles)),[['E'],['E']]);
      assert.match(await page.locator('#txObj').innerText(),/Recover|Supply/i);
      await page.evaluate(()=>window.__tx.onAct('hunker'));
      const saved=await page.evaluate(()=>JSON.stringify(window.__tx.state));
      await page.reload();await page.waitForFunction(()=>!!window.__tx);assert.equal(await page.evaluate(()=>JSON.stringify(window.__tx.state)),saved);
      await page.goto(BASE+'/prim3-world.html?m=us-road-kit');await page.locator('.pw-generated summary').click();
      assert.equal(await page.locator('[name=reviewed]').isChecked(),false);await page.locator('[name=reviewed]').check();await page.locator('.pw-generated button[type=submit]').click();
      assert.equal(await page.locator('.pw-generated [data-result] a').innerText(),'Resume saved mission');
      assert.ok(!(await page.locator('.pw-generated [data-result] a').getAttribute('href')).includes('new=1'));
      await page.locator('.pw-generated [data-result] a').click();await page.waitForFunction(()=>!!window.__tx);
      assert.equal(await page.evaluate(()=>JSON.stringify(window.__tx.state)),saved);
      await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+86400001;window.__tx.restart();Date.now=original;});
      assert.equal(await page.evaluate(()=>JSON.stringify(window.__tx.state)),saved);assert.match(await page.locator('#txSaveNotice').innerText(),/expired/);
      await page.screenshot({path:join(out,`mission-${width}.png`),fullPage:true});
      assert.deepEqual(errors,[]);console.log(`PASS generated review, repeated actions, save/resume, expiry at ${width}px`);
    }finally{await ctx.close();}
  }
  const denied=await context(390,false);try{const page=await denied.ctx.newPage();await page.goto(BASE+'/prim3-world.html');await page.waitForFunction(()=>document.querySelector('[data-owner-msg]')?.textContent.includes('house owner'));assert.ok(!denied.requests.includes('/js/prim3-world/mission-generator.mjs'));assert.equal(await page.locator('.pw-generated').count(),0);console.log('PASS denied owner');}finally{await denied.ctx.close();}
  const quota=await context(390,true,true);try{const page=await quota.ctx.newPage();await prepare(page);assert.match(await page.locator('.pw-generated [role=status]').innerText(),/quota/);assert.equal(await page.locator('.pw-generated [data-result] a').count(),0);console.log('PASS recipe save failure');}finally{await quota.ctx.close();}
}finally{await browser.close();}
