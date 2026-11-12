/* Actual canonical B1–L7 WebGL renders, not geometry proxies or a deployed preview.
   Run after the six detailed floor builders, with PLAYWRIGHT_DIR and THREE_DIR pointing
   to the pinned local packages used by CI. Everything served is loopback-only; all remote
   requests are intercepted. No credentials, live telemetry, auth changes or production writes.
   PNGs require human visual review; a successful smoke is not aesthetic acceptance. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { startVisualServer, VIEWER_PATH, PRODUCTION } from './fixtures/eu-building-visual.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=resolve(process.argv[2]||'/tmp/eu-building-proof');
const WIDTH=Number(process.env.EU_VISUAL_WIDTH||390),HEIGHT=WIDTH<600?844:1000;
assert.ok([390,1440].includes(WIDTH),'Use one of the reviewed phone/desktop widths');
await mkdir(OUT,{recursive:true});
const report={scope:'Test-only canonical building renders. Simulation indicators, no live hosts. Human visual approval pending.',
  commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
  tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:ROOT,encoding:'utf8'}).trim(),
  viewport:{width:WIDTH,height:HEIGHT},quality:'LOW',renderer:'Chromium software WebGL / SwiftShader',
  workflowRun:process.env.GITHUB_RUN_ID||null,checks:[],captures:[],console:[],pageErrors:[],httpFailures:[],requestFailures:[],blockedExternal:[],assetHashes:{}};
const check=(name,pass,details)=>{report.checks.push({name,pass:!!pass,details});console.log(`${pass?'PASS':'FAIL'} ${name}`)};
let browser,fixture,context,page;
const catalog=JSON.parse(await readFile(join(ROOT,PRODUCTION,'electronics/generated/equity-uprise-device-components-v1.json'),'utf8'));
const records=catalog.devices.filter(d=>['workstation','monitor'].includes(d.archetype));
const floorName=level=>level===0?'B1':level===7?'L7':'F'+level;
const expectedFor=level=>records.filter(d=>d.asset_id.startsWith(floorName(level)+'-'));
const assetNames=['equity-uprise-building-core-v2.glb','equity-uprise-basement-b1-core-v2.glb',
  ...Array.from({length:7},(_,i)=>`equity-uprise-floor-0${i+1}-core-v2.glb`),'equity-uprise-facade-core-v2.glb'];

async function capture(name,extra={}) {
  await page.waitForTimeout(450); // settle normal OrbitControls damping, not invented state
  const state=await page.evaluate(()=>globalThis.__euVisualFixture.snapshot(true));
  const screenshot=`${WIDTH}-${name}.png`;
  await page.screenshot({path:join(OUT,screenshot),animations:'disabled'});
  report.captures.push({name,screenshot,...extra,state});
  const pixels=state.pixelSample;
  check(name+': actual nonblank WebGL',state.rendered.triangles>0&&state.rendered.calls>0&&
    pixels&&!pixels.contextLost&&pixels.colors>12&&pixels.lit>100,{rendered:state.rendered,pixels});
  check(name+': phone/desktop width has no horizontal overflow',state.overflow.scrollWidth===state.overflow.clientWidth,state.overflow);
  return state;
}
async function selectFloor(level) {
  await page.locator(`[data-f="${level}"]`).click();
  await page.waitForFunction(level=>{const f=globalThis.__euVisualFixture?.snapshot();
    return f?.focus===String(level)&&f.floors[level].loaded&&f.floors[level].visible},level,{timeout:90000});
}
function verifyFloor(state,level) {
  const expected=expectedFor(level),actual=state.devices;
  assert.deepEqual(state.floors.filter(f=>f.visible).map(f=>f.level),[level],'hidden floor/parent never reappears');
  assert.deepEqual(actual.map(d=>d.id).sort(),expected.map(d=>d.asset_id).sort(),'exact authored devices for selected floor');
  const names=actual.flatMap(d=>d.components);
  assert.deepEqual([...names].sort(),expected.flatMap(d=>d.components.map(c=>c.mesh_name)).sort(),'every exact component, once');
  assert.equal(new Set(names).size,names.length,'no duplicate component rendering');
  assert.equal(state.fullElectronicsVisible,false,'normal view does not expose full fabric');
  assert.equal(state.servicesVisible,false,'normal view does not expose services');
  assert.deepEqual(state.rootTransform.position,[0,0,0]);
  for(const scale of state.rootTransform.scale)assert.ok(Math.abs(scale-.3048)<1e-9);
  assert.ok(Math.abs(state.rootTransform.rotation[0]+Math.PI/2)<1e-9,'one Z-up conversion');
  const ffe=(level-1)*13.5*.3048;
  for(const d of actual){assert.ok(d.box.min[1]>=ffe-.05,`${d.id} must not be below its own FFE`);
    assert.ok(d.box.max[1]<ffe+4.2,`${d.id} must not have a second FFE applied`);}
  return {floor:floorName(level),devices:actual.length,workstations:actual.filter(d=>d.archetype==='workstation').length,
    monitors:actual.filter(d=>d.archetype==='monitor').length,components:names.length};
}

try {
  for(const name of assetNames){const data=await readFile(join(ROOT,PRODUCTION,'generated',name));
    report.assetHashes[name]={bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};}
  for(const name of ['equity-uprise-workstations-v1.glb','equity-uprise-electronics-fabric-v1.glb']){
    const data=await readFile(join(ROOT,PRODUCTION,'electronics/generated',name));
    report.assetHashes[name]={bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};}
  assert.equal(records.length,98,'canonical 36 hosts + 62 monitors, including no invented L7 workstation');
  const three=resolve(process.env.THREE_DIR||'');
  assert.ok(process.env.THREE_DIR,'THREE_DIR must be the pinned local three@0.180.0 package');
  assert.equal(JSON.parse(await readFile(join(three,'package.json'),'utf8')).version,'0.180.0');
  const require=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'));
  const {chromium}=require('playwright');
  assert.equal(require('playwright/package.json').version,'1.57.0');
  fixture=await startVisualServer(ROOT);
  // Existing repo CI uses Playwright's isolated default sandbox setting and SwiftShader.
  // No OS, network, browser security policy or production permission is modified here.
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,
    args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  context=await browser.newContext({viewport:{width:WIDTH,height:HEIGHT},isMobile:WIDTH<600,hasTouch:WIDTH<600,
    reducedMotion:'reduce',deviceScaleFactor:1,serviceWorkers:'block'});
  await context.addInitScript(()=>{
    // Non-auth fixture only. Mark the ordinary privacy notice seen, not agreed; no account session exists.
    localStorage.setItem('mcc_privacy_seen',JSON.stringify({version:'2026-10-19',seen_at:'2026-11-12T12:00:00Z'}));
  });
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin===fixture.base)return route.continue();
    if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/three@0.180.0/')){
      const file=resolve(three,u.pathname.slice('/npm/three@0.180.0/'.length));
      try{assert.ok(file.startsWith(three+sep));return await route.fulfill({status:200,body:await readFile(file),
        contentType:extname(file)==='.js'?'text/javascript':'application/octet-stream',headers:{'access-control-allow-origin':'*'}})}
      catch(error){report.httpFailures.push({url:u.href,status:404,error:error.message});return route.fulfill({status:404,body:'Missing pinned Three fixture'})}
    }
    // The shared content script normally reads optional site-content overrides. Give it an
    // explicit empty fixture, never a production request or fake signed-in identity.
    if(u.hostname==='zmnhbrjyhxzhkxmhkexs.supabase.co'&&u.pathname==='/rest/v1/site_content'&&route.request().method()==='GET'){
      return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'[]'});
    }
    report.blockedExternal.push({origin:u.origin,path:u.pathname,method:route.request().method()});
    return route.abort('blockedbyclient');
  });
  page=await context.newPage();page.setDefaultTimeout(90000);
  page.on('console',m=>report.console.push({type:m.type(),text:m.text(),location:m.location()}));
  page.on('pageerror',e=>report.pageErrors.push(String(e)));
  page.on('response',r=>{if(r.status()>=400)report.httpFailures.push({url:r.url(),status:r.status()})});
  page.on('requestfailed',r=>report.requestFailures.push({url:r.url(),error:r.failure()?.errorText}));
  await page.goto(fixture.base+VIEWER_PATH+'?floor=0&quality=LOW',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__euVisualFixture?.snapshot().workstationStatus==='ready',null,{timeout:90000});
  await page.locator('#sunmode').click(); // canonical Day override keeps visual evidence reproducible
  // Wait for real B1/F1 continuity streaming so a late neighbor cannot defeat isolation.
  await page.waitForFunction(()=>{const s=__euVisualFixture.snapshot();return s.floors[0].loaded&&s.floors[1].loaded},null,{timeout:90000});
  const initial=await capture('B1-initial-stream');
  check('initial B1 stream keeps its prefetched F1 neighbor hidden',
    initial.floors.filter(f=>f.visible).map(f=>f.level).join(',')==='0',initial.floors);
  for(let level=0;level<=7;level++){
    try{
      await selectFloor(level);
      const state=await capture(`${floorName(level)}-overview`);
      check(floorName(level)+': authored floor/device contract',true,verifyFloor(state,level));
      const host=expectedFor(level).find(d=>d.archetype==='workstation');
      if(host){const framing=await page.evaluate(id=>__euVisualFixture.frameStation(id),host.asset_id);
        await capture(`${floorName(level)}-station`,{framing,manufacturer:host.manufacturer_model,
          note:'Source-backed proposed exterior; sponsor unconfirmed, no live host. Camera-only detail view.'});}
    }catch(error){check(floorName(level)+': capture/contract',false,String(error.stack||error));
      await page.screenshot({path:join(OUT,`${WIDTH}-${floorName(level)}-failure.png`)}).catch(()=>{});}
  }
  await page.locator('[data-f="stack"]').click();
  await page.waitForFunction(()=>__euVisualFixture.snapshot().focus==='stack');
  const stack=await capture('whole-building-stack');
  check('whole stack retains all eight loaded detailed floors',stack.floors.every(f=>f.loaded&&f.visible),stack.floors);
  check('whole stack renders exactly 98 authored hosts/monitors',stack.devices.length===records.length,stack.devices.length);
  await page.locator('[data-f="facade"]').click();
  await page.waitForFunction(()=>__euVisualFixture.snapshot().focus==='facade');
  const facade=await capture('facade');
  check('facade hides all detailed floors and workstation descendants',facade.devices.length===0&&facade.floors.every(f=>!f.visible));
  await selectFloor(1);
  await page.locator('#plant').click();
  await page.waitForFunction(()=>__euVisualFixture.snapshot().fullElectronicsVisible,null,{timeout:90000});
  const plant=await capture('F1-physical-plant');
  check('plant owns the assemblies without duplicate dedicated meshes',plant.plant&&plant.devices.length===0&&
    !plant.workstationRootVisible&&expectedFor(1).every(d=>plant.fullDeviceIds.includes(d.asset_id)),plant.fullDeviceIds.length);
  await page.locator('#roommode').click();
  await page.waitForFunction(()=>__euVisualFixture.snapshot().room);
  const room=await capture('F1-room-from-plant');
  check('room restores authored workstations and hides full electronics',room.devices.length===expectedFor(1).length&&
    !room.fullElectronicsVisible&&!room.servicesVisible,room.devices.length);
  await page.locator('#roomExit').click();
  await page.waitForFunction(()=>!__euVisualFixture.snapshot().room);
  await page.locator('#plant').click();
  await page.waitForFunction(()=>!__euVisualFixture.snapshot().plant);
  const restored=await capture('F1-normal-restored');
  check('return to normal restores exact F1 components',true,verifyFloor(restored,1));
  // Failure is an explicit second local fixture, not a network error hidden by fallback meshes.
  await context.route('**/equity-uprise-workstations-v1.glb*',r=>r.fulfill({status:404,body:'Intentional missing-asset fixture'}));
  const expectedFailureStart=report.httpFailures.length;
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>__euVisualFixture?.snapshot().workstationStatus==='unavailable',null,{timeout:90000});
  await page.waitForFunction(()=>__euVisualFixture.snapshot().floors[0].loaded);
  const unavailable=await capture('missing-workstation-asset');
  check('missing asset fails closed with unavailable text and zero substitutes',unavailable.devices.length===0&&
    /unavailable.*no substitute screens/i.test(await page.locator('#workstationStatus').textContent()));
  report.expectedMissingAssetResponses=report.httpFailures.slice(expectedFailureStart)
    .filter(r=>r.status===404&&new URL(r.url).pathname.endsWith('/equity-uprise-workstations-v1.glb'));
  report.httpFailures=report.httpFailures.filter(r=>!report.expectedMissingAssetResponses.includes(r));
  check('no unhandled page errors',report.pageErrors.length===0,report.pageErrors);
  const unexpectedHTTP=report.httpFailures.filter(r=>!new URL(r.url).pathname.endsWith('/favicon.ico'));
  check('no unexpected asset HTTP failures',unexpectedHTTP.length===0,unexpectedHTTP);
  check('no unexpected external requests',report.blockedExternal.length===0,report.blockedExternal);
}catch(error){check('visual smoke completed',false,String(error.stack||error));
  if(page)await page.screenshot({path:join(OUT,`${WIDTH}-fatal.png`)}).catch(()=>{});
}finally{
  if(context)await context.close().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  if(fixture){report.localRequests=fixture.requests;await fixture.close();}
  report.pass=report.checks.length>0&&report.checks.every(c=>c.pass);
  await writeFile(join(OUT,'results.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(OUT,'README.txt'),`Equity Uprise canonical building visual evidence\nCommit: ${report.commit}\nTree: ${report.tree}\nViewport: ${WIDTH}x${HEIGHT}\nQuality: LOW, software WebGL, canonical Day override\nSmoke: ${report.pass?'PASS':'FAIL'}\n\nPNG files are actual WebGL page captures, not geometry approval. Review B1–L7 overviews, authored-station close-ups, the whole stack, room/plant switching and missing-asset failure.\nThe observer is appended only by the loopback test server. No viewer is promoted and no production/auth request leaves the browser.\nresults.json contains per-floor device/component counts, world bounds, asset SHA-256, pixel/render evidence, console/page/HTTP failures and the intentional missing-asset responses.\n`);
}
if(!report.pass)process.exitCode=1;
