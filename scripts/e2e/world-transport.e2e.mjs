/* Real Cesium, local assets, fixture network. Never contacts production.
   CESIUM_DIR=/path/to/cesium/Build/Cesium PLAYWRIGHT_DIR=/path/to/node_modules
   node scripts/e2e/world-transport.e2e.mjs */
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'package.json'))('playwright');
const root=new URL('../../',import.meta.url).pathname;
const OUT=process.argv[2]||'/tmp/globe-transport-qa';
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://local').pathname;let body=await readFile(join(root,p));if(p==='/js/action-globe.js')body=Buffer.from(body.toString().replace('styleScene();wireControls();','window.__testViewer=viewer;styleScene();wireControls();'));res.writeHead(200,{'content-type':types[extname(p)]||'application/octet-stream'});res.end(body)}catch{res.writeHead(404);res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try { browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}); } catch (error) { server.close(); throw error; }
try{
 for(const width of (process.env.QA_WIDTHS||'390,820,1280').split(',').map(Number)){
  for(const PREVIEW of [false,true]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[];
  page.setDefaultTimeout(90000);/* software GL on a shared runner: a screenshot or a wait can need more than 30 s */
  page.on('pageerror',e=>errors.push(e.message));
  /* a signed-in session shaped like the real one (a JWT-shaped token that has not expired), as world-release.e2e.mjs signs in */
  await page.addInitScript(()=>{localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({sub:'fixture-owner',exp}))+'.y',expires_at:exp,refresh_token:'fixture-only',user:{id:'fixture-owner',email:'fixture@example.invalid'}}))});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='127.0.0.1')return route.continue();
   if(url.hostname==='cesium.com'){
    const relative=url.pathname.split('/Build/Cesium/')[1];
    if(relative&&process.env.CESIUM_DIR){try{return route.fulfill({body:await readFile(join(process.env.CESIUM_DIR,relative)),contentType:types[extname(relative)]||'application/octet-stream'})}catch{}}
   }
   if(url.hostname==='api.mccluster.org'){
    let data={};
    /* optional layers are the owner's admin preview (04cadb18, 2026-10-16): only a globe-admin-preview/v1 release with
       admin_preview:true unlocks them; anyone else gets the release without the preview and sees none of them */
    if(url.pathname==='/v1/world/access')data=PREVIEW?{release:{version:'globe-admin-preview/v1',admin_preview:true},level:'owner',locked_layers:[],unlocked_layers:['flights','satellites','launches','transport'],layers:{}}:{release:{version:'globe-admin-preview/v1',admin_preview:false},level:'public',locked_layers:[],unlocked_layers:[],layers:{}};
    if(url.pathname==='/v1/world/layers/launches')data={launches:[{id:'fixture',name:'Fixture space mission',net:'2026-11-01T12:00:00Z',status:'Go',pad:{lon:30,lat:10,name:'Fixture launch pad'},mission:{name:'Fixture science mission'}},{id:'invalid',pad:{lon:null,lat:null}}]};
    if(url.pathname==='/v1/world/layers/satellites')data={satellites:[{name:'ISS (ZARYA)',tle1:'1 25544U 98067A   26286.82178372  .00006592  00000+0  12831-3 0  9991',tle2:'2 25544  51.6325  76.5471 0003201 125.0532 235.0866 15.49721212537052'}]};
    if(url.pathname==='/v1/world/layers/flights')data={aircraft:[['abc123','TEST123',0,15,10000,200,90],['bad','INVALID',null,15,0,0,0]],credit:'Fixture flight data'};
    if(url.pathname==='/v1/world/ion')data={available:false};
    return route.fulfill({json:data});
   }
   if(url.hostname.endsWith('supabase.co'))return route.fulfill({json:[]});
   return route.abort();
  });
  await page.goto(base+'/action-globe.html?explore=1');
  await page.waitForFunction(()=>window.__testViewer);
  if(!PREVIEW){
   /* outside the admin preview the optional layers never show: Transport, flights, satellites and launches stay hidden */
   await page.waitForFunction(()=>window.__huAccess&&window.__huAccess());
   assert.deepEqual(await page.evaluate(()=>['ctlTransport','ctlFlights','ctlSats','ctlLaunch'].map(id=>document.getElementById(id).hidden)),[true,true,true,true]);
   assert.equal(errors.length,0,errors.join('\n'));
   console.log(JSON.stringify({width,preview:false,optionalLayersHidden:true}));await page.close();continue;
  }
  /* the globe's controls live in the editorial tools tray (a <details> that a click elsewhere closes): open it, then press */
  /* software GL under load: a pick only finds what a finished frame drew, so wait for two rendered frames after moving the camera */
  const drawn=()=>page.evaluate(()=>new Promise(r=>{const sc=window.__testViewer.scene;let n=0;const off=sc.postRender.addEventListener(()=>{if(++n>=2){off();r()}});sc.requestRender()}));
  const tool=async id=>{await page.locator('#'+id).waitFor({state:'attached'});if(!await page.locator('.globe-editorial-tools').evaluate(d=>d.open))await page.locator('.globe-editorial-tools>summary').click();await page.locator('#'+id).click();if(await page.locator('.globe-editorial-tools').evaluate(d=>d.open))await page.keyboard.press('Escape')};
  await tool('ctlTransport');
  await page.getByLabel('Destination',{exact:true}).fill('477 Broad Street, Bridgeport, CT');
  await page.getByRole('button',{name:'Transit',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Transit',exact:true}).getAttribute('aria-pressed'),'true');
  const href=await page.getByRole('link',{name:'Open directions'}).getAttribute('href');
  assert.equal(new URL(href).searchParams.get('travelmode'),'transit');
  assert.equal(new URL(href).searchParams.get('destination'),'477 Broad Street, Bridgeport, CT');
  assert.equal(await page.locator('#cctvBody').getByText('Whip Equipped rides aren’t live yet.',{exact:false}).count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  assert.equal(await page.locator('#cctvSheet').evaluate(e=>e.scrollWidth===e.clientWidth),true);
  await page.waitForTimeout(200);
  await mkdir(OUT,{recursive:true});await page.screenshot({path:OUT+'/transport-'+width+'.png'});
  await page.locator('#cctvClose').click();await tool('ctlFlights');
  await page.waitForFunction(()=>window.__huLayerCounts().flights===1);
  /* hold the camera over the aircraft (as the satellite and launch picks do) so the projected point is still the aircraft when clicked */
  await page.evaluate(()=>{const v=window.__testViewer;v.camera.cancelFlight();v.camera.setView({destination:Cesium.Cartesian3.fromDegrees(0,15,3000000)})});
  await drawn();
  const point=await page.evaluate(()=>{const v=window.__testViewer;const p=Cesium.SceneTransforms.worldToWindowCoordinates(v.scene,Cesium.Cartesian3.fromDegrees(0,15,10000));return{x:p.x,y:p.y}});
  await page.mouse.click(point.x,point.y);
  await page.getByRole('heading',{name:'TEST123'}).waitFor();
  assert.match(await page.locator('.flight-facts').innerText(),/32,808/);
  await page.locator('#cctvClose').click();await tool('ctlSats');
  await page.waitForFunction(()=>window.__huLayerCounts().satellites===1);
  // Project the real propagated position and exercise Cesium's click handler.
  await page.evaluate(()=>{const v=window.__testViewer;let contact;for(let i=0;i<v.scene.primitives.length;i++){const p=v.scene.primitives.get(i);if((p instanceof Cesium.BillboardCollection||p instanceof Cesium.PointPrimitiveCollection)&&p.length&&p.get(0).id?.layer==='satellites')contact=p.get(0)}if(!contact)throw Error('satellite not rendered');v.camera.cancelFlight();v.camera.setView({destination:Cesium.Cartesian3.fromDegrees(Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(contact.position).longitude),Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(contact.position).latitude),5000000)});window.__testSatellite=contact});
  await drawn();
  const sp=await page.evaluate(()=>{const p=Cesium.SceneTransforms.worldToWindowCoordinates(window.__testViewer.scene,window.__testSatellite.position);return{x:p.x,y:p.y}});
  await page.mouse.click(sp.x,sp.y);
  await page.getByRole('heading',{name:'ISS (ZARYA)',exact:true}).waitFor();
  await page.waitForFunction(()=>window.__testViewer.entities.values.some(e=>e.model));
  await page.waitForTimeout(2000);
  await page.screenshot({path:OUT+'/satellite-'+width+'.png'});
  /* the predicted orbit is one polyline primitive in the scene since fa130b52 (2026-10-24), drawn from HuSpace.orbitTimes'
     97 samples (one orbit), and the sheet states its length: the ISS orbits in about 93 minutes */
  const orbitLines=()=>page.evaluate(()=>{const ps=window.__testViewer.scene.primitives;let n=0;for(let i=0;i<ps.length;i++){const p=ps.get(i);if(p instanceof Cesium.Primitive&&p.appearance instanceof Cesium.PolylineColorAppearance)n++}return n});
  assert.equal(await orbitLines(),1);
  assert.equal(await page.evaluate(()=>HuSpace.orbitTimes(satellite.twoline2satrec('1 25544U 98067A   26286.82178372  .00006592  00000+0  12831-3 0  9991','2 25544  51.6325  76.5471 0003201 125.0532 235.0866 15.49721212537052')).length),97);
  assert.match(await page.locator('.flight-facts').innerText(),/Orbit preview\s*9[0-9] minutes/i);
  await page.locator('#cctvClose').click();
  assert.equal(await page.evaluate(()=>window.__testViewer.entities.values.filter(e=>e.model).length),0);
  assert.equal(await orbitLines(),0);
  await tool('ctlLaunch');await page.waitForFunction(()=>window.__huLayerCounts().launches===1);
  await page.evaluate(()=>{const v=window.__testViewer;v.camera.cancelFlight();v.camera.setView({destination:Cesium.Cartesian3.fromDegrees(30,10,3000000)})});
  await drawn();
  const lp=await page.evaluate(()=>{const p=Cesium.SceneTransforms.worldToWindowCoordinates(window.__testViewer.scene,Cesium.Cartesian3.fromDegrees(30,10,4000));return{x:p.x,y:p.y}});
  await page.mouse.click(lp.x,lp.y);await page.getByRole('heading',{name:'Fixture space mission',exact:true}).waitFor();
  await page.waitForTimeout(2000);await page.screenshot({path:OUT+'/launch-'+width+'.png'});
  assert.equal(await page.evaluate(()=>window.__testViewer.entities.values.filter(e=>e.model).length),1);
  await page.locator('#cctvClose').click();assert.equal(await page.evaluate(()=>window.__testViewer.entities.values.filter(e=>e.model).length),0);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({width,transport:true,flightPick:true,satellitePick:true,launchPick:true,orbit:true,cleanup:true,overflow:false,pageErrors:errors.length}));await page.close();
  }
 }
}finally{await browser.close();await new Promise(r=>server.close(r))}
