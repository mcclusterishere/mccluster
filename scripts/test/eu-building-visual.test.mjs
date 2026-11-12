import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext, Script } from 'node:vm';
import { candidatePaths, instrumentViewer, startVisualServer, VIEWER_PATH, PRODUCTION, OBSERVER } from '../e2e/fixtures/eu-building-visual.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const source=path=>readFile(resolve(ROOT,path),'utf8');

test('read-only visual workflow is artifact-only, pinned, and cannot publish or use secrets',async()=>{
  const yml=await source('.github/workflows/equity-uprise-visual.yml');
  assert.match(yml,/permissions:\s*contents: read/);
  assert.match(yml,/persist-credentials: false/);
  assert.match(yml,/pull_request:/);assert.match(yml,/workflow_dispatch:/);
  assert.doesNotMatch(yml,/pull_request_target|\bwrite\b|secrets\.|id-token|git push|deploy-pages|wrangler|gh api/);
  assert.match(yml,/width: \[390, 1440\]/);
  assert.match(yml,/playwright@1\.57\.0 three@0\.180\.0/);
  assert.match(yml,/for n in 01 02 03 04 05 06/);
  assert.match(yml,/EU_VISUAL_REQUIRE_GENERATED: '1'/);assert.match(yml,/eu-view-framing\.test\.mjs/);
  assert.match(yml,/if: always\(\)/);assert.match(yml,/actions\/upload-artifact@[a-f0-9]{40}/);
  for(const line of yml.split('\n').filter(l=>/uses:/.test(l)))assert.match(line,/@[a-f0-9]{40}\s*$/);
});

test('fixture resolves canonical files only and keeps unfinished viewer promotion out of publishing',async()=>{
  assert.deepEqual(candidatePaths(ROOT,VIEWER_PATH),[resolve(ROOT,'_unfinished/equity-uprise'+VIEWER_PATH)]);
  for(const path of ['/../AGENTS.md','/%2e%2e/AGENTS.md','/.git/config','/foo\\bar','/equity-uprise-preview/../AGENTS.md'])
    assert.deepEqual(candidatePaths(ROOT,path),[],path);
  for(const path of ['/equity-uprise-preview/equity-uprise-workstations-v1.glb',
    '/equity-uprise-preview/lab-runtime/equity-uprise-electronics-sandbox.mjs',
    '/equity-uprise-preview/brand/brand-manifest.json']){
    assert.ok(candidatePaths(ROOT,path).every(p=>p.startsWith(resolve(ROOT,PRODUCTION))));
  }
  const deploy=await source('.github/workflows/deploy-pages.yml');
  assert.doesNotMatch(deploy,/eu-building-visual|cp\s+_unfinished\/equity-uprise/);
});

test('observer is test-only, syntactically valid, and appends without replacing the canonical viewer module',async()=>{
  const html=await source('_unfinished/equity-uprise'+VIEWER_PATH);
  const instrumented=instrumentViewer(html);
  assert.ok(instrumented.startsWith(html.slice(0,html.lastIndexOf('</script>'))));
  assert.equal((instrumented.match(/globalThis.__euVisualFixture/g)||[]).length,1);
  assert.doesNotMatch(html,/__euVisualFixture/);
  assert.throws(()=>instrumentViewer('<html>substitute</html>'),/boundary changed/);
  assert.doesNotThrow(()=>new Script(OBSERVER));
  assert.doesNotMatch(OBSERVER,/new THREE\.(?:Mesh|BoxGeometry)|\.visible\s*=|\.material\s*=|injectFault|guardPage|mccdb_session/);
  assert.match(OBSERVER,/readPixels/);assert.match(OBSERVER,/effectivelyVisible/);
});

test('loopback fixture serves real generated assets, refuses writes, and logs missing assets',async()=>{
  const server=await startVisualServer(ROOT);
  try{
    assert.match(server.base,/^http:\/\/127\.0\.0\.1:\d+$/);
    const html=await fetch(server.base+VIEWER_PATH);
    assert.equal(html.status,200);assert.match(await html.text(),/globalThis.__euVisualFixture/);
    const asset='/equity-uprise-preview/equity-uprise-workstations-v1.glb';
    const glb=await fetch(server.base+asset);assert.equal(glb.status,200);
    const expected=await readFile(resolve(ROOT,PRODUCTION,'electronics/generated/equity-uprise-workstations-v1.glb'));
    assert.deepEqual(Buffer.from(await glb.arrayBuffer()),expected);
    const brand=await fetch(server.base+'/equity-uprise-preview/brand/brand-manifest.json');assert.equal(brand.status,200);
    assert.equal((await fetch(server.base+asset,{method:'POST',body:'no writes'})).status,405);
    assert.equal((await fetch(server.base+'/.git/config')).status,404);
    assert.equal((await fetch(server.base+'/equity-uprise-preview/missing.glb')).status,404);
    assert.ok(server.requests.some(r=>r.status===405));assert.ok(server.requests.some(r=>r.status===404));
  }finally{await server.close()}
});

test('late detail loading respects current floor/room/facade isolation while stack preserves visibility and native FFE',async()=>{
  const html=await source('_unfinished/equity-uprise'+VIEWER_PATH);
  const start=html.indexOf('function ensureDetailedFloor(level){'),end=html.indexOf('function ensureB1F1Continuity',start);
  assert.ok(start>0&&end>start);
  for(const {level,initial,selected,visible} of [
    {level:1,initial:'0',selected:'0',visible:false}, // prefetched F1 cannot show through B1
    {level:0,initial:'1',selected:'1',visible:false}, // prefetched B1 cannot show through F1 room
    {level:2,initial:'2',selected:'3',visible:false}, // a newer floor wins over an older request
    {level:6,initial:'6',selected:'facade',visible:false},
    {level:0,initial:'1',selected:'stack',visible:true},
    {level:1,initial:'0',selected:'1',visible:true},
    {level:6,initial:'6',selected:'6',visible:true},
  ]){
    let finish;const deferred=new Promise(resolve=>finish=resolve),roots=new Map();
    const root={visible:true,rotation:{x:0},position:{y:0},updateMatrixWorld(){}};
    const noOp=()=>{};
    const ctx={Promise,Number,String,Error,Map,currentFocus:initial,status:{},floorLoadPromises:new Map(),floorLoadErrors:new Map(),
      loadedFloorRoot:i=>roots.get(i),loadGltfWithRetry:()=>deferred,
      FLOOR_LOAD_CONFIG:{[level]:{url:'fixture.glb',y:(level-1)*13.5,assign:r=>roots.set(level,r)}},
      ft:v=>v*.3048,scene:{add:noOp},makeReliable:noOp,hideDetailedCoreDuplicates:noOp,enhanceFloor1Interior:noOp,
      buildRoomLightRig:noOp,markLabVisualRootReady:noOp,refreshArchitectureGhostAfterLoad:noOp,
      detailedPerimeterMeshes:null,b1StackDupMeshes:null,f7StackDupMeshes:null,stackFrameCache:null};
    runInNewContext(html.slice(start,end),ctx);
    const loading=ctx.ensureDetailedFloor(level);ctx.currentFocus=selected;finish({scene:root});await loading;
    assert.equal(root.visible,visible,JSON.stringify({level,initial,selected}));
    assert.equal(root.rotation.x,-Math.PI/2);assert.equal(root.position.y,(level-1)*13.5*.3048);
    assert.equal(roots.get(level),root,'authored root is retained, never a replacement');
  }
});

test('visual runner requires every B1–L7 capture and preserves evidence instead of claiming acceptance',async()=>{
  const runner=await source('scripts/e2e/eu-building-visual.e2e.mjs');
  assert.match(runner,/for\(let level=0;level<=7;level\+\+\)/);
  for(const field of ['pageErrors','console','httpFailures','requestFailures','blockedExternal','assetHashes','pixelSample'])assert.ok(runner.includes(field),field);
  for(const view of ['whole-building-stack','F1-physical-plant','F1-room-from-plant','F1-normal-restored','missing-workstation-asset'])assert.ok(runner.includes(view),view);
  assert.match(runner,/return route\.abort\('blockedbyclient'\)/);
  assert.doesNotMatch(runner,/access_token|refresh_token|mccdb_session|https:\/\/api\.mccluster\.org|--no-sandbox/);
  assert.match(runner,/Human visual approval pending/);assert.match(runner,/process\.exitCode=1/);
});

test('late facade loading cannot re-cover an isolated floor or room, but stack and facade keep it',async()=>{
  const html=await source('_unfinished/equity-uprise'+VIEWER_PATH);
  const start=html.indexOf('function ensureFacadeRoot(){'),end=html.indexOf('function ensureServicesLayer',start);
  assert.ok(start>0&&end>start);
  for(const selected of ['0','1','6','stack','facade']){
    let finish;const deferred=new Promise(resolve=>finish=resolve),noOp=()=>{};
    const root={visible:true,rotation:{x:0},updateMatrixWorld(){}};
    const ctx={Promise,facade:null,facadeLoadPromise:null,currentFocus:'stack',loadGltfWithRetry:()=>deferred,
      scene:{add:noOp},makeFacadeReliable:noOp,applyFacadeBrandSlots:noOp,stackFrameCache:{},refreshArchitectureGhostAfterLoad:noOp};
    runInNewContext(html.slice(start,end),ctx);
    const loading=ctx.ensureFacadeRoot();ctx.currentFocus=selected;finish({scene:root});await loading;
    assert.equal(root.visible,selected==='stack'||selected==='facade',selected);
    assert.equal(root.rotation.x,-Math.PI/2);assert.equal(ctx.facade,root);
  }
});
