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
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://local').pathname;let body=await readFile(join(root,p));if(p==='/js/action-globe.js')body=Buffer.from(body.toString().replace('styleScene();wireControls();','window.__testViewer=viewer;styleScene();wireControls();'));res.writeHead(200,{'content-type':types[extname(p)]||'application/octet-stream'});res.end(body)}catch{res.writeHead(404);res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try { browser=await chromium.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}); } catch (error) { server.close(); throw error; }
try{
 for(const width of [390,820,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'fixture-session'})));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='127.0.0.1')return route.continue();
   if(url.hostname==='cesium.com'){
    const relative=url.pathname.split('/Build/Cesium/')[1];
    if(relative&&process.env.CESIUM_DIR){try{return route.fulfill({body:await readFile(join(process.env.CESIUM_DIR,relative)),contentType:types[extname(relative)]||'application/octet-stream'})}catch{}}
   }
   if(url.hostname==='api.mccluster.org'){
    let data={};
    if(url.pathname==='/v1/world/access')data={locked_layers:[],unlocked_layers:['flights','transport'],layers:{}};
    if(url.pathname==='/v1/world/layers/flights')data={aircraft:[['abc123','TEST123',0,15,10000,200,90],['bad','INVALID',null,15,0,0,0]],credit:'Fixture flight data'};
    if(url.pathname==='/v1/world/ion')data={available:false};
    return route.fulfill({json:data});
   }
   if(url.hostname.endsWith('supabase.co'))return route.fulfill({json:[]});
   return route.abort();
  });
  await page.goto(base+'/action-globe.html?explore=1');
  await page.waitForFunction(()=>window.__testViewer);
  await page.locator('#ctlTransport').click();
  await page.getByLabel('Destination',{exact:true}).fill('477 Broad Street, Bridgeport, CT');
  await page.getByRole('button',{name:'Transit',exact:true}).click();
  const href=await page.getByRole('link',{name:'Open directions'}).getAttribute('href');
  assert.equal(new URL(href).searchParams.get('travelmode'),'transit');
  assert.equal(new URL(href).searchParams.get('destination'),'477 Broad Street, Bridgeport, CT');
  assert.equal(await page.locator('#cctvBody').getByText('Whip Equipped rides aren’t live yet.',{exact:false}).count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  assert.equal(await page.locator('#cctvSheet').evaluate(e=>e.scrollWidth===e.clientWidth),true);
  await mkdir('/tmp/globe-transport-qa',{recursive:true});await page.screenshot({path:'/tmp/globe-transport-qa/transport-'+width+'.png'});
  await page.locator('#cctvClose').click();await page.locator('#ctlFlights').click();
  await page.waitForFunction(()=>window.__huLayerCounts().flights===1);
  const point=await page.evaluate(()=>{const v=window.__testViewer;const p=Cesium.SceneTransforms.worldToWindowCoordinates(v.scene,Cesium.Cartesian3.fromDegrees(0,15,10000));return{x:p.x,y:p.y}});
  await page.mouse.click(point.x,point.y);
  await page.getByRole('heading',{name:'TEST123'}).waitFor();
  assert.match(await page.locator('.flight-facts').innerText(),/32,808/);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({width,transport:true,flightPick:true,overflow:false,pageErrors:errors.length}));await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r))}
