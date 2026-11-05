// Local UI integration with explicit owner/non-owner and globe protocol fixtures.
// This does not prove production auth, actual ion entitlement or WebGL rendering.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import {createArcadeDatabase} from '../test/support/arcade-database.mjs';
const database=process.env.PGLITE_MODULE?await createArcadeDatabase():null;
const { chromium } = createRequire(import.meta.url)('playwright');
const base=process.env.ARCADE_BASE||'http://127.0.0.1:8765';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
let checks=0;
async function setup(width, owner=true) {
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.addInitScript(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'local-test-owner'})));
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(database&&u.pathname.startsWith('/v1/arcade/')){
      const req=route.request(), headers={...req.headers(),authorization:owner?'Bearer local-owner':'Bearer member'};
      const response=await database.handle(new Request(req.url(),{method:req.method(),headers,...(req.postData()?{body:req.postData()}:{})}));
      return route.fulfill({status:response.status,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},contentType:'application/json',body:await response.text()});
    }
    if(u.origin!==base)return route.fulfill({status:u.pathname==='/v1/status'&&!owner?403:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:'{"ok":true}'});
    if(['/js/mcc-auth.js','/js/tabbar.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
    if(u.pathname==='/action-globe.html')return route.fulfill({contentType:'text/html',body:`<body style="background:#163040;color:white">Globe protocol fixture<script>window.addEventListener('message',e=>{if(e.data.type==='hu:hello')parent.postMessage({type:'hu:globe-ready'},location.origin);if(e.data.type==='hu:journey')document.body.dataset.journey=JSON.stringify(e.data)});parent.postMessage({type:'hu:globe-ready'},location.origin)</script>`});
    return route.continue();
  });
  return context;
}
try {
  for(const width of [390,1280]){
    const context=await setup(width), page=await context.newPage(), errors=[],requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/city-arcade.html?game=gauranfucking-tea-tea-rush');
    await page.locator('[data-location-id="bridgeport-main-elm"]').waitFor();
    assert.ok(!requests.some(p=>/tea-action|tea-view|sole-street|fictional-city\/district/.test(p)));checks++;
    await page.locator('[data-location-id="bridgeport-main-elm"]').click();
    await page.locator('.tea-scene').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);checks++;
    await page.waitForFunction(()=>/Bridgeport ·|selected\. Choose/.test(document.querySelector('#arcade-map-status').textContent));checks++;
    const globe=page.frames().find(f=>f.url().includes('action-globe'));
    assert.equal(await globe.locator('body').getAttribute('data-journey').then(JSON.parse).then(x=>x.points[0].label),'Main Street & Elm Street');checks++;
    await page.locator('#arcade-play .tea-tuning summary').click();
    await page.locator('[data-route]').fill('Lemon');
    await page.locator('[data-setting="spawnX"]').fill('75');
    await page.locator('[data-setting="spawnY"]').fill('130');
    await page.locator('[data-again]').click();
    if(database){await page.locator('[data-cloud-load]').click();await page.waitForFunction(()=>document.querySelector('[data-cloud-status]').textContent.includes('No saved mission')||document.querySelector('[data-cloud-status]').textContent.includes('Loaded private'));await page.locator('[data-route]').fill('Lemon');await page.locator('[data-setting="spawnX"]').fill('75');await page.locator('[data-setting="spawnY"]').fill('130');await page.locator('[data-cloud-save]').click();await page.waitForFunction(()=>document.querySelector('[data-cloud-status]').textContent.includes('saved.'));await page.locator('[data-cloud-play]').click();await page.waitForFunction(()=>document.querySelector('[data-cloud-status]').textContent.includes('Playing saved'));checks+=3;}else await page.locator('[data-start]').click();
    async function hold(key, direction, duration){
      if(width===390){
        const button=page.locator(`[data-hold="${direction}"]`);await button.scrollIntoViewIfNeeded();await page.waitForTimeout(350);const b=await button.boundingBox();const client=await context.newCDPSession(page);
        await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});await page.waitForTimeout(duration);
        await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await client.detach();
      }else{await page.locator('canvas').focus();await page.keyboard.down(key);await page.waitForTimeout(duration);await page.keyboard.up(key);}
    }
    await hold(' ','act',1450);
    assert.match(await page.locator('[data-tea-status]').textContent(),/Lemon ready/);checks++;
    await hold('ArrowRight','right',1120);await hold('ArrowDown','down',850);await hold(' ','act',100);
    await page.waitForFunction(()=>document.querySelector('[data-served]').textContent==='1/1');checks++;
    assert.equal(await page.locator('[data-score]').textContent(),'100');checks++;
    assert.equal(await page.evaluate(()=>localStorage.getItem('here.city-arcade.tea-action.best.v1')),'100');checks++;
    if(database){await page.waitForFunction(()=>document.querySelector('[data-cloud-status]').textContent.includes('result saved'));checks++;}
    await page.locator('button[data-return]').click();assert.match(await page.locator('#arcade-location [data-return]').textContent(),/Completed/);checks++;
    await page.locator('[data-game="gauranfucking-tea-tea-rush"]').click();await page.locator('.tea-scene').waitFor();
    await page.locator('#arcade-play .tea-tuning summary').click();await page.locator('[data-again]').click();await page.locator('[data-start]').click();await page.locator('[data-pause]').click();
    const time=await page.locator('[data-time]').textContent();await page.waitForTimeout(1100);assert.equal(await page.locator('[data-time]').textContent(),time);checks++;
    await page.locator('[data-setting="duration"]').fill('0');await page.locator('[data-again]').click();
    await page.waitForFunction(()=>document.querySelector('[data-tea-status]').textContent==='Invalid duration');checks++;
    await page.locator('[data-setting="duration"]').fill('75');await page.locator('[data-again]').click();
    await page.locator('#arcade-play .tea-tuning summary').click();
    await page.locator('.tea-scene').screenshot({path:`/tmp/tea-rush-${width}.png`});
    await page.locator('[data-game="designer-kicks-sole-run"]').click();await page.waitForFunction(()=>document.querySelector('.gps-objective')?.textContent.includes('Robbery 1s'));assert.match(await page.locator('.gps-objective').textContent(),/Robbery 1s/);checks++;
    assert.equal(await page.locator('.sole-minimap').count(),1);checks++;
    await page.locator('#arcade-play .tea-tuning summary').click();
    if(database){await page.locator('[data-sole-load]').click();await page.waitForFunction(()=>/No saved mission|Loaded private/.test(document.querySelector('[data-sole-cloud-status]').textContent));}
    const soleConfig=JSON.parse(await page.locator('[data-sole-config]').inputValue());soleConfig.encounters[0].stopId='main-elm';
    await page.locator('[data-sole-config]').fill(JSON.stringify(soleConfig));
    if(database){await page.locator('[data-sole-save]').click();await page.waitForFunction(()=>document.querySelector('[data-sole-cloud-status]').textContent.includes('saved.'));await page.locator('[data-sole-cloud-play]').click();await page.waitForFunction(()=>document.querySelector('[data-sole-cloud-status]').textContent.includes('Playing private'));}
    else{await page.locator('[data-sole-apply]').click();await page.locator('[data-sole-start]').click();}
    await page.getByRole('button',{name:'Inspect the shoes',exact:true}).click();
    await page.getByRole('button',{name:'Both shoes are labelled LEFT.',exact:true}).click();
    await page.getByRole('button',{name:'Confiscate stage-prop shoes',exact:true}).click();
    await page.getByRole('button',{name:'Perform on-camera roast',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-score]').textContent==='175');checks++;
    await page.locator('[data-sole-return]').click();await page.locator('[data-game="designer-kicks-sole-run"]').click();await page.locator('.sole-minimap').waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-score]')?.textContent==='175');assert.equal(await page.locator('[data-score]').textContent(),'175');checks++;
    await page.locator('[data-sole-start]').click();await page.locator('.tea-scene').screenshot({path:`/tmp/sole-run-${width}.png`});
    const frameStats=await page.evaluate(()=>new Promise(resolve=>{const values=[];let last=performance.now();function tick(now){values.push(now-last);last=now;if(values.length===30)resolve({mean:values.reduce((a,b)=>a+b,0)/values.length,max:Math.max(...values)});else requestAnimationFrame(tick);}requestAnimationFrame(tick);}));
    console.log('Local software browser frame intervals',width,frameStats);

    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);checks++;
    await page.locator('[data-game="gauranfucking-tea-tea-rush"]').click();await page.locator('.tea-scene').waitFor();
    await page.reload();await page.locator('.tea-scene').waitFor();assert.match(await page.locator('#arcade-location [data-return]').textContent(),/Completed/);checks++;
    if(database){await page.locator('[data-history]').click();await page.waitForFunction(()=>document.querySelector('#arcade-location [data-return]').textContent.includes('cloud saved'));checks++;}
    assert.deepEqual(errors,[]);checks++;
    await context.close();
  }
  {
    const context=await setup(390),page=await context.newPage(),requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
    await page.goto(base+'/city-arcade.html');await page.locator('[data-location-id="bridgeport-main-elm"]').waitFor();
    const frame=page.frames().find(f=>f.url().includes('action-globe'));
    await frame.evaluate(()=>parent.postMessage({type:'arcade:view',lon:-73.19,lat:41.18,height:900},location.origin));
    await page.waitForFunction(()=>document.querySelector('#arcade-load-status').textContent.includes('loaded:'));assert.ok(requests.some(p=>p.endsWith('/district.v1.json')));checks++;
    assert.ok(!requests.some(p=>/tea-view|sole-street-view/.test(p)));checks++;
    await frame.evaluate(()=>parent.postMessage({type:'arcade:view',lon:0,lat:0,height:1e7},location.origin));
    await page.waitForFunction(()=>document.querySelector('#arcade-load-status').textContent.includes('unloaded'));checks++;
    await page.locator('[data-location-id="bridgeport-main-elm"]').click();await page.locator('[data-game="gauranfucking-tea-tea-rush"]').click();await page.locator('.tea-scene').waitFor();await page.locator('[data-start]').click();
    await frame.evaluate(()=>parent.postMessage({type:'arcade:view',lon:0,lat:0,height:1e7},location.origin));
    // Explicit entry can precede the globe's initial flight. An initial distant report
    // must not cancel it; disposal starts after the viewer has reached the region.
    await page.waitForTimeout(100);assert.equal(await page.locator('.tea-scene').count(),1);checks++;
    await frame.evaluate(()=>parent.postMessage({type:'arcade:view',lon:-73.19,lat:41.18,height:900},location.origin));
    await frame.evaluate(()=>parent.postMessage({type:'arcade:view',lon:0,lat:0,height:1e7},location.origin));
    await page.waitForFunction(()=>!document.querySelector('.tea-scene'));assert.ok(await page.evaluate(()=>localStorage.getItem('here.city-arcade.tea-action.session.v1:bridgeport-main-elm')));checks++;
    const measurements=await page.evaluate(()=>performance.getEntriesByType('resource').filter(x=>/locations.v1.json|district.v1.json/.test(x.name)).map(x=>({file:x.name.split('/').at(-1),encodedBodySize:x.encodedBodySize,transferSize:x.transferSize})));console.log('Measured local resources',measurements);
    await context.close();
  }
  const context=await setup(390,false),page=await context.newPage();await page.goto(base+'/city-arcade.html');await page.waitForTimeout(500);
  assert.equal(await page.locator('canvas, #arcade-globe').count(),0);checks++;
  await context.close();console.log(`${checks} browser assertions passed (desktop keyboard, 390px real touch events, protocol/auth fixtures).`);
} finally { await browser.close(); await database?.close(); }
