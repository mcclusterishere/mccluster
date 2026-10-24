/* Actual globe, isolated API fixtures. No production reads. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
await mkdir(OUT, { recursive: true });

let failed = 0;
function check(scope, name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 500)}`);
  if (!ok) failed++;
}


const FEATURES=['flights','satellites','launches','intel','music','cctv','audience','transport','ion','military','quakes','fires','perimeters','cyclones','vessels','search','halo-ops','tides'];
const BUTTONS=['ctlFlights','ctlSats','ctlLaunch','ctlIntel','ctlMusic','ctlCctv','ctlTransport'];
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
/* HITMAN'S HALO (js/halo/*): the owner's operations view, built to the owner's four screens. Test fixtures only (fictional
   names, "Fixture" places); nothing here ships. */
const NOW=Date.now(),iso=(minAgo)=>new Date(NOW-minAgo*60e3).toISOString(),U=(n)=>'00000000-0000-4000-8000-00000000000'+n;
const HALO_MISSIONS={ok:true,schema:'halo-missions/v1',generated_at:iso(0),total:5,truncated:false,counts:{active:2,planned:1,blocked:1,review:1,completed:1},missions:[
 {id:'a1b2c3d4-0000-4000-8000-000000000001',title:'Harbor water check',description:'Verify waterfront conditions at the harbor.',domain:'environment',kind:'civic',status:'active',review:true,place:{label:'New Haven, Connecticut',country:'US',lat:41.3083,lon:-72.9279},starts_at:iso(600),ends_at:new Date(NOW+3*3600e3).toISOString(),created_at:iso(2000),updated_at:iso(4),capacity:6,counts:{joined:3,in_progress:2,submitted:2,verified:1,rejected:0,pending_proofs:2},team:[{m_uid:U(1),name:'Ada Fixture',avatar_url:null,status:'submitted',since:iso(8)},{m_uid:U(2),name:'Ben Fixture',avatar_url:null,status:'verified',since:iso(50)},{m_uid:U(3),name:'Cy Fixture',avatar_url:null,status:'joined',since:iso(70)}],evidence:[{id:'e0000000-0000-4000-8000-000000000001',type:'photo',status:'pending',created_at:iso(4),reviewed_at:null,by:'Ada Fixture',m_uid:U(1),statement:'Waterfront photo at the pier'},{id:'e0000000-0000-4000-8000-000000000002',type:'text',status:'pending',created_at:iso(11),reviewed_at:null,by:'Ada Fixture',m_uid:U(1),statement:'Field note'},{id:'e0000000-0000-4000-8000-000000000003',type:'link',status:'verified',created_at:iso(40),reviewed_at:iso(30),by:'Ben Fixture',m_uid:U(2),statement:'NOAA observation link'}],path:'mnet.html?mission=a1b2c3d4-0000-4000-8000-000000000001'},
 {id:'a1b2c3d4-0000-4000-8000-000000000002',title:'Coastal survey',description:'Map the coastline access points.',domain:'research',kind:'civic',status:'active',review:false,place:{label:'Lisbon, Portugal',country:'PT',lat:38.7223,lon:-9.1393},starts_at:null,ends_at:new Date(NOW+8*3600e3).toISOString(),created_at:iso(3000),updated_at:iso(20),capacity:null,counts:{joined:2,in_progress:2,submitted:0,verified:0,rejected:0,pending_proofs:0},team:[{m_uid:U(4),name:'Dee Fixture',avatar_url:null,status:'in_progress',since:iso(25)}],evidence:[],path:'mnet.html?mission=a1b2c3d4-0000-4000-8000-000000000002'},
 {id:'a1b2c3d4-0000-4000-8000-000000000003',title:'Network recovery',description:'Restore the community network.',domain:'engineering',kind:'civic',status:'blocked',review:false,place:{label:'Accra, Ghana',country:'GH',lat:5.6037,lon:-0.187},starts_at:null,ends_at:null,created_at:iso(5000),updated_at:iso(300),capacity:4,counts:{joined:1,in_progress:1,submitted:0,verified:0,rejected:0,pending_proofs:0},team:[],evidence:[],path:null},
 {id:'a1b2c3d4-0000-4000-8000-000000000004',title:'Watershed check',description:'Draft: river sampling plan.',domain:'environment',kind:'civic',status:'planned',review:false,place:{label:'Porto, Portugal',country:'PT',lat:41.1579,lon:-8.6291},starts_at:null,ends_at:null,created_at:iso(100),updated_at:iso(100),capacity:null,counts:{joined:0,in_progress:0,submitted:0,verified:0,rejected:0,pending_proofs:0},team:[],evidence:[],path:null},
 {id:'a1b2c3d4-0000-4000-8000-000000000005',title:'Food bank sort',description:'Closed.',domain:'service',kind:'civic',status:'completed',review:false,place:null,starts_at:null,ends_at:iso(9000),created_at:iso(20000),updated_at:iso(9000),capacity:10,counts:{joined:10,in_progress:0,submitted:0,verified:10,rejected:0,pending_proofs:0},team:[],evidence:[],path:null}],sources:{}};
const HALO_PEOPLE={ok:true,schema:'halo-people/v1',generated_at:iso(0),total:4,truncated:false,unresolved:0,counts:{people:4,on_mission:2,available:1,awaiting_review:1},online:null,people:[
 {m_uid:U(1),name:'Ada Fixture',avatar_url:null,headline:'Field coordinator',role:'participant',skills:['Field documentation','Water sampling'],missions:[{id:'a1b2c3d4-0000-4000-8000-000000000001',title:'Harbor water check',status:'submitted'}],state:'awaiting_review',last_activity_at:iso(4),last_activity:'submitted',location_shared:false},
 {m_uid:U(2),name:'Ben Fixture',avatar_url:null,headline:null,role:'admin',skills:['Evidence review'],missions:[{id:'a1b2c3d4-0000-4000-8000-000000000001',title:'Harbor water check',status:'verified'}],state:'on_mission',last_activity_at:iso(30),last_activity:'verified',location_shared:false},
 {m_uid:U(4),name:'Dee Fixture',avatar_url:null,headline:'Survey lead',role:'participant',skills:[],missions:[{id:'a1b2c3d4-0000-4000-8000-000000000002',title:'Coastal survey',status:'in_progress'}],state:'on_mission',last_activity_at:iso(25),last_activity:'started',location_shared:false},
 {m_uid:U(5),name:'Eve Fixture',avatar_url:null,headline:'Analyst',role:'member',skills:[],missions:[],state:'available',last_activity_at:null,last_activity:null,location_shared:false}],sources:{}};
const TIDES=Array.from({length:24},(_,i)=>[new Date(NOW-(23-i)*3600e3).toISOString(),+(0.6+0.25*Math.sin(i/3.8)).toFixed(3),'p']);
const HALO_SAT={name:'ISS (ZARYA)',tle1:'1 25544U 98067A   26286.82178372  .00006592  00000+0  12831-3 0  9991',tle2:'2 25544  51.6325  76.5471 0003201 125.0532 235.0866 15.49721212537052'};
const HALO_FIXTURES={
 '/v1/world/layers/weather':{ok:true,layer:'weather',fetched_at:iso(0),credit:'NOAA NWS',count:2,events:[{id:'warning1',name:'Tornado Warning · test fixture',event:'Tornado Warning',kind:'tornado',provenance:'warning',lon:-97.5,lat:35.4,location_kind:'area_label',polygons:[[[[-97.5,35.4],[-97.1,35.4],[-97.1,35.8],[-97.5,35.4]]]],observed_at:iso(10),expires_at:new Date(NOW+3600000).toISOString(),source:'NOAA NWS',description:'Deterministic fixture, not a live warning.'},{id:'unmapped1',name:'Zone-only flood advisory',event:'Flood Advisory',kind:'flood',provenance:'warning',lon:null,lat:null,location_kind:'unmapped',polygons:[],observed_at:iso(5),expires_at:new Date(NOW+3600000).toISOString(),source:'NOAA NWS'}]},
 '/v1/world/layers/natural':{ok:true,layer:'natural',fetched_at:iso(0),credit:'NASA EONET',count:11,events:['volcano','fire','flood','snow','ice','wind','dust','landslide','heat','storm','rain'].map((kind,i)=>({id:'natural-'+kind,name:kind+' · test fixture',event:kind,kind,provenance:'reported',lon:-120+(i%4)*15,lat:24+Math.floor(i/4)*12,location_kind:'reported_point',polygons:[],observed_at:iso(40),source:'NASA EONET'}))},

 '/v1/world/layers/satellites':{count:1,satellites:[HALO_SAT]},
 '/v1/world/layers/flights':{count:3,aircraft:[['abc001','HALO ONE',-73.9,40.7,9000,200,45],['abc002','HALO TWO',-73.95,40.72,8500,180,90],['abc003','HALO THREE',-74,40.75,9500,220,180]]},
 '/v1/world/layers/quakes':{ok:true,layer:'quakes',fetched_at:iso(0),credit:'Earthquakes: USGS',count:3,quakes:[{id:'us1',mag:5.4,place:'10 km S of Fixture, Chile',time:iso(20),lon:-71.5,lat:-33.4,depth_km:12,url:'https://earthquake.usgs.gov/earthquakes/eventpage/us1',tsunami:false,alert:'green'},{id:'us2',mag:2.1,place:'Fixture, California',time:iso(60),lon:-118.2,lat:34.05,depth_km:8,url:'',tsunami:false,alert:null},{id:'us3',mag:4.6,place:'Fixture, Japan',time:iso(90),lon:142.4,lat:38.3,depth_km:110,url:'',tsunami:false,alert:null}]},
 '/v1/world/layers/military':{ok:true,layer:'military',fetched_at:iso(0),credit:'Military flights: adsb.lol (ODbL)',count:2,aircraft:[['ae1234','RCH123',-77.0,38.9,9000,220,90,'C17','4521',false],['ae5678','DUKE01',-1.5,51.2,7000,180,270,'K35R','7700',true]]},
 '/v1/world/layers/fires':{ok:true,layer:'fires',fetched_at:null,unavailable:true,upstream_error:'not_configured',count:0,fires:[]},
 '/v1/world/layers/cyclones':{ok:true,layer:'cyclones',fetched_at:iso(0),credit:'NOAA NHC',count:0,cyclones:[]},
 '/v1/world/layers/tides':{ok:true,layer:'tides',fetched_at:iso(0),stale:false,credit:'NOAA CO-OPS',stations:[['8465705','New Haven',-72.9083,41.2833,'CT'],['8518750','The Battery',-74.0142,40.7006,'NY']],count:2},
 '/v1/world/tides/8465705':{ok:true,schema:'halo-water-level/v1',station:{id:'8465705',name:'New Haven',lat:41.2833,lon:-72.9083},product:'observed_water_level',datum:'MLLW',units:'m',fetched_at:iso(0),stale:false,latest:{value:TIDES[23][1],observed_at:TIDES[23][0],quality:'preliminary'},observations:TIDES.map(t=>[t[0],t[1],'preliminary']),note:'Observed water level, not a tide prediction.'},
 '/v1/world/halo/missions':HALO_MISSIONS,
 '/v1/world/halo/people':HALO_PEOPLE,
 '/v1/intel/evidence':{ok:true,evidence:[{id:'ev1',kind:'report',title:'Harbor flooding report',summary:'Local report of high water at the harbor.',publisher:'Fixture News',source_url:'https://example.org/fixture',license:'cc-by',observed_at:iso(15),retrieved_at:iso(10),lat:41.29,lon:-72.93,geo_source:'publisher',region_label:'New Haven, Connecticut',review_status:'unreviewed'}],completeness:{possibly_truncated:false}},
 '/v1/intel/health':{schema_ready:true,source_health:{transport:'pull',coverage:'partial',last_success_at:iso(5),age_seconds:300,stale:false}},
 '/v1/mnet/bootstrap':{identity:{m_uid:U(9)},profile:{display_name:'Owner Fixture',avatar_url:null}}
};
async function haloChecks(scope,page,host,width,ctx,loseOwner,calls){
 const state=()=>page.evaluate(()=>window.HaloConsole?HaloConsole.state():null);
 const shot=(name)=>page.screenshot({path:join(OUT,'halo-'+name+'-'+width+'.png')});
 const noOverflow=()=>page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth);
 const smallTargets=()=>page.evaluate(()=>[...document.querySelectorAll('#haloShell button,#haloShell a,#haloShell input,#haloShell select')].filter(e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);if(!r.width||!r.height||cs.visibility==='hidden'||e.closest('[hidden]'))return false;if(e.matches('input[type=checkbox]'))return false;const box=e.closest('.hx-switch,.hx-find,.hx-search')||e;const b=box.getBoundingClientRect();return Math.min(b.height,b.width)<44&&!e.closest('.hx-time__mode')&&!(e.tagName==='A'&&e.closest('.hx-action'))}).map(e=>(e.className&&e.className.baseVal===undefined?e.className:e.tagName)+':'+Math.round(e.getBoundingClientRect().height)));
 await page.waitForFunction(()=>window.HaloConsole&&HaloConsole.state().mounted,null,{timeout:20000}).catch(()=>{});
 await page.waitForTimeout(600);
 let st=await state();
 check(scope,'the owner gets the Halo view on World, with its four tabs, from the link',!!st&&st.mounted&&st.view==='world'&&(await page.locator('.hx-tabs [role=tab]').count())===4&&await page.locator('.hx-top').isVisible(),st&&st.view);
 check(scope,'the supplied HM mark, scaled, never drawn',await page.evaluate(()=>{const i=document.querySelector('.hx-brand img');return !!i&&/assets\/img\/hm-mark-96\.png$/.test(i.getAttribute('src'))&&!document.querySelector('.hx-brand svg')}));
 check(scope,'the page chrome steps aside (the way-back header, the deck, the corner controls)',await page.evaluate(()=>['header','#deck','.globe-controls'].every(q=>{const e=document.querySelector(q);return !e||getComputedStyle(e).display==='none'})));
 await page.waitForFunction(()=>/2/.test(document.querySelector('.hx-stats').textContent),null,{timeout:8000}).catch(()=>{});
 check(scope,'the counts strip reads the owner\'s missions',/2\s*Active missions/.test(await page.textContent('.hx-stats'))&&/1\s*Awaiting review/.test(await page.textContent('.hx-stats')),await page.textContent('.hx-stats'));
 const crowd=await page.evaluate(()=>{const q=['.hx-brand','.hx-operator','.hx-tabs','.hx-stats','.hx-clock','.hx-search','.hx-layers-btn','.hx-ctl','.hx-left','.hx-time'],els=q.map(s=>[s,document.querySelector(s)]).filter(([,e])=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'),hits=[];for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){if(els[i][1].contains(els[j][1])||els[j][1].contains(els[i][1]))continue;const a=els[i][1].getBoundingClientRect(),b=els[j][1].getBoundingClientRect();if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)hits.push(els[i][0]+' × '+els[j][0])}return hits});
 check(scope,'the frame\'s parts never sit on each other',crowd.length===0,crowd);
 check(scope,'no document horizontal overflow',await noOverflow());
 /* A phone must expose a genuine touchable map, not just a strip between fixed panels. */
 if(width<1100){
  const geometry=()=>page.evaluate(()=>{
   const g=document.querySelector('#globe').getBoundingClientRect();
   const s=document.querySelector('.hx-search').getBoundingClientRect();
   const p=document.querySelector('.hx-left').getBoundingClientRect();
   const t=document.querySelector('.hx-time').getBoundingClientRect();
   const clearTop=Math.max(g.top,s.bottom),clearBottom=Math.min(g.bottom,p.top,t.top);
   const probeY=Math.min(g.bottom-32,Math.max(s.bottom+48,g.top+g.height*0.55));
   const hit=document.elementFromPoint(g.left+g.width/2,probeY);
   return {height:g.height,viewport:window.innerHeight,clear:Math.max(0,clearBottom-clearTop),canvasHit:!!(hit&&hit.closest('#globe')),panel:p.height};
  });
  const initial=await geometry();
  check(scope,'mobile opens globe-first with a small drawer and an interactive Cesium surface',
    initial.panel<=90&&initial.height>=initial.viewport*0.5&&initial.clear>=220&&initial.canvasHit,initial);
  await page.locator('.hx-map-focus').click();
  const immersive=await geometry();
  check(scope,'Full globe releases panel and timeline space while preserving map hit testing',
    (await state()).mapFocus&&immersive.height>=initial.height+90&&
    !(await page.locator('.hx-left').isVisible())&&!(await page.locator('.hx-time').isVisible())&&immersive.canvasHit,immersive);
  await page.locator('.hx-map-focus').click();
  const restored=await geometry();
  check(scope,'Show panels restores the compact data drawer and original globe dimensions',
    !(await state()).mapFocus&&await page.locator('.hx-left').isVisible()&&
    Math.abs(restored.height-initial.height)<4&&restored.clear>=220,restored);
 }
 await shot('start');
 let small=await smallTargets();
 check(scope,'every visible Halo control is a full 44px tap target',small.length===0,small);
 /* Object rendering: real glTF asset, bounded density and target-relative camera. */
 await page.evaluate(()=>HuGlobe.layer.toggle('flights'));
 await page.waitForFunction(()=>HuGlobe.objects.stats()?.flights.loaded===3);
 await page.evaluate(()=>HaloConsole.pick({id:{layer:'flights',aircraft:HuTransport.aircraft(['abc001','HALO ONE',-73.9,40.7,9000,200,45])}}));
 await page.waitForTimeout(1800);
 check(scope,'selecting an aircraft creates an inspectable 3D object',await page.evaluate(()=>HuGlobe.objects.stats().flights.models>0)&&/HALO ONE/.test(await page.textContent('#cctvTitle')));
 await shot('aircraft-object');
 await page.getByRole('button',{name:'Orbit object',exact:true}).click();
 check(scope,'orbit follows the selected aircraft',!!(await state()).following&&(await state()).orbit);
 await page.locator('.hx-layers-btn').click();
 await page.locator('[data-density="flights"]').press('Home');
 check(scope,'aircraft density changes the actual displayed fleet',await page.evaluate(()=>HuGlobe.objects.stats().flights.shown===1&&HuGlobe.objects.stats().flights.loaded===3));
 await shot('object-density');
 await page.locator('[data-tool="home"]').click();
 await page.locator('.hx-layers-btn').click();
 await page.evaluate(()=>HuGlobe.layer.toggle('flights'));
 await page.evaluate(()=>HuGlobe.layer.toggle('satellites'));
 await page.waitForFunction(()=>HuGlobe.objects.stats()?.satellites.loaded===1);
 await page.evaluate(s=>HaloConsole.pick({id:{layer:'satellites',sat:{name:s.name,key:'satellites:25544',rec:satellite.twoline2satrec(s.tle1,s.tle2)}}}),HALO_SAT);
 await page.waitForTimeout(1800);
 check(scope,'satellite inspection shows a 3D object and calculated orbit',await page.evaluate(()=>HuGlobe.objects.stats().satellites.models===1)&&/Orbit preview/.test(await page.textContent('#cctvBody')));
 await shot('satellite-object');
 await page.getByRole('button',{name:'Follow',exact:true}).click();
 check(scope,'satellite follow retains the selected 3D object',!!(await state()).following&&await page.evaluate(()=>HuGlobe.objects.stats().satellites.models===1));
 await page.locator('.hx-layers-btn').click();
 await page.locator('[data-tool="home"]').click();
 await page.locator('.hx-layers-btn').click();
 await page.evaluate(()=>HuGlobe.layer.toggle('satellites'));
 /* World data: a group switch turns its layers on; each says what it holds */
 if(width<1100)await page.locator('.hx-grip').click();
 await page.locator('[data-group="earth"] .hx-group__row .hx-switch input').click({force:true});
 await page.waitForFunction(()=>{const l=HaloConsole.state().layers;return l.quakes.state==='on'&&l.fires.state==='unavailable'&&l.tides.state==='on'},null,{timeout:10000}).catch(()=>{});
 st=await state();
 check(scope,'Earth & weather turns on Earthquakes (3), NOAA water levels (2); Thermal says it needs a key',st.layers.quakes.text==='3'&&st.layers.tides.text==='2'&&st.layers.fires.text==='Needs a key'&&!st.layers.networks,{q:st.layers.quakes,t:st.layers.tides,f:st.layers.fires});
 check(scope,'Source health says each source\'s state in words',/Earthquakes[\s\S]*Updated/.test(await page.textContent('.hx-health'))&&/Needs a key/.test(await page.textContent('.hx-health')));
 check(scope,'the World panel counts actual sources without planned placeholders',/\d+ available · 4 context$/.test(await page.textContent('.hx-panel__head p')));
 await shot('world');
 await page.waitForFunction(()=>HaloConsole.state().events?.types.includes('tornado'));
 check(scope,'natural events have distinct visual families and finite detail budgets',await page.evaluate(()=>{const s=HaloConsole.state().events;return s.types.length>=14&&s.models<=8&&s.animated<=48}),await state());
 if(width<1100)await page.locator('.hx-grip').click();
 await page.evaluate(()=>{const v=HuGlobe.viewer();v.camera.setView({destination:Cesium.Cartesian3.fromDegrees(-97.4,34.5,150000),orientation:{heading:0,pitch:Cesium.Math.toRadians(-38),roll:0}});});
 await page.waitForTimeout(1200);
 check(scope,'nearby event builds 3D representation',await page.evaluate(()=>HaloConsole.state().events.models>0));
 await shot('tornado-area');
 await page.evaluate(item=>HaloConsole.pick({id:{haloPick:true,layer:'weather',item}}),HALO_FIXTURES['/v1/world/layers/weather'].events[0]);
 check(scope,'warning is explicitly differentiated from an observed tornado',/Warning/.test(await page.textContent('.hx-detail'))&&/not confirmation/.test(await page.textContent('.hx-detail')));
 await shot('warning-detail');
 if(width===1280){
   for(const kind of ['volcano','fire','flood','snow','ice','wind','dust','landslide','heat','storm','rain']){
     const item=HALO_FIXTURES['/v1/world/layers/natural'].events.find(e=>e.kind===kind);
     await page.evaluate(item=>{HaloConsole.pick({id:{haloPick:true,layer:'natural',item}});HuGlobe.viewer().camera.setView({destination:Cesium.Cartesian3.fromDegrees(item.lon,item.lat-.8,140000),orientation:{heading:0,pitch:Cesium.Math.toRadians(-38),roll:0}});},item);
     await page.waitForTimeout(700);check(scope,kind+' remains individually inspectable',await page.locator('.hx-detail h2').textContent()===item.name);await shot('event-'+kind);
   }
 }

 await page.locator('#hxTab-people').click();
 check(scope,'view switch removes warning panel and overlay immediately',!(await page.textContent('.hx-detail')).includes('Tornado Warning')&&await page.locator('.hx-pop').isHidden()&&await page.locator('.hx-results').isHidden());
 await page.locator('#hxTab-world').click();
 await page.locator('.hx-layers-btn').click();
 await page.locator('[data-event-motion]').uncheck();
 check(scope,'event animation can be paused without removing observations',await page.evaluate(()=>HaloConsole.state().events.animated===0&&HaloConsole.state().events.loaded>0));
 await page.locator('[data-event-motion]').check();
 await page.locator('[data-event-density]').press('Home');
 await page.waitForTimeout(800);
 check(scope,'event detail budget zero removes all animated 3D effects',await page.evaluate(()=>HaloConsole.state().events.models===0&&HaloConsole.state().events.animated===0));
 await page.locator('[data-event-density]').press('End');
 await page.locator('[data-tool="home"]').click();
 await page.locator('.hx-layers-btn').click();

 /* a NOAA station opens its observed water level with a chart */
 await page.evaluate(()=>HaloConsole.pick({id:{haloPick:true,layer:'tides',item:{id:'8465705',name:'New Haven',lon:-72.9083,lat:41.2833,state:'CT'}}}));
 await page.waitForSelector('.hx-detail .hx-chart svg',{timeout:8000}).catch(()=>{});
 check(scope,'a water-level station opens its observed level, its chart and the readings table',await page.locator('.hx-detail .hx-big').isVisible()&&(await page.locator('.hx-detail .hx-chart polyline').count())===1&&(await page.locator('.hx-detail details table').count())===1&&/not a tide prediction/i.test(await page.textContent('.hx-detail')));
 check(scope,'the station names the mission within 300 km',/Harbor water check/.test(await page.textContent('.hx-detail')));
 await shot('station');
 /* Missions */
 await page.locator('#hxTab-missions').click();
 await page.waitForFunction(()=>document.querySelectorAll('.hx-left .hx-card').length>=2,null,{timeout:8000}).catch(()=>{});
 check(scope,'Missions: active missions listed, Review counted, mission places on the Earth',(await page.locator('.hx-left .hx-card').count())===2&&/Review\s*1/.test(await page.textContent('.hx-seg'))&&(await state()).marks===4,{cards:await page.locator('.hx-left .hx-card').count(),marks:(await state()).marks});
 await page.locator('.hx-left .hx-card').first().click();
 await page.waitForFunction(()=>/Harbor water check/.test((document.querySelector('.hx-detail h2')||{}).textContent||''),null,{timeout:8000}).catch(()=>{});
 st=await state();
 check(scope,'a mission opens with its progress, team, next steps and evidence',st.selected&&st.selected.kind==='mission'&&await page.locator('.hx-detail h2').isVisible()&&/Harbor water check/.test(await page.textContent('.hx-detail h2'))&&/1 of 3 verified/.test(await page.textContent('.hx-detail'))&&/Review 2 submitted proofs/.test(await page.textContent('.hx-detail'))&&(await page.locator('.hx-detail .hx-team li').count())===3,{sel:st.selected,text:(await page.textContent('.hx-detail')).slice(0,400),team:await page.locator('.hx-detail .hx-team li').count()});
 check(scope,'Review evidence goes to the Control Room review, Open mission to its page',/^control\.html\?haloTask=reviews&mission=.+#create:action-network$/.test(await page.getAttribute('.hx-detail__foot .hx-cta','href'))&&/mnet\.html\?mission=/.test(await page.getAttribute('.hx-detail__foot a.hx-btn','href')));
 check(scope,'the timeline shows the mission\'s evidence as it arrived (close events share one counted dot)',await page.evaluate(()=>{const l=[...document.querySelectorAll('.hx-axis__ev')].map(b=>b.getAttribute('aria-label')).join(' | ');return /received · Harbor water check/.test(l)&&[...document.querySelectorAll('.hx-axis__ev')].reduce((n,b)=>n+(+(/^(\d+) events/.exec(b.getAttribute('aria-label'))||[0,1])[1]),0)>=5}));
 small=await smallTargets();
 check(scope,'Missions: every visible control is a full tap target',small.length===0,small);
 await shot('missions');
 /* People: no one's location, ever */
 await page.locator('#hxTab-people').click();
 await page.waitForFunction(()=>document.querySelectorAll('.hx-left .hx-person').length>=4,null,{timeout:8000}).catch(()=>{});
 if(width<1100&&await page.locator('.hx-right').getAttribute('data-open')==='true')await page.locator('.hx-detail .hx-close').click();
 check(scope,'People: the team listed with their state',(await page.locator('.hx-left .hx-person').count())===4&&/Awaiting review/.test(await page.textContent('.hx-left')));
 await page.locator('.hx-left .hx-person').first().click();
 await page.waitForFunction(()=>/Not shared/.test(document.querySelector('.hx-detail').textContent),null,{timeout:8000}).catch(()=>{});
 const people=await page.evaluate(()=>({text:document.querySelector('.hx-detail').textContent,marks:HaloConsole.state().marks}));
 check(scope,'a person opens with their mission and skills, and their location says Not shared',/Ada Fixture/.test(people.text)&&/Not shared/.test(people.text)&&/Field documentation/.test(people.text)&&/Recent submissions/.test(people.text),people.text.slice(0,200));
 check(scope,'the Earth shows mission places for People, never a person',people.marks===2,people);
 await shot('people');
 /* Intelligence: observed, calculated, reported, each labelled */
 await page.locator('#hxTab-intel').click();
 await page.waitForFunction(()=>{const t=document.querySelector('.hx-left').textContent;return /M5\.4 earthquake/.test(t)&&/Needs review/.test(t)},null,{timeout:10000}).catch(()=>{});
 check(scope,'Intelligence: the feed holds the USGS quake (observed) and the evidence that needs review',/M5\.4 earthquake/.test(await page.textContent('.hx-left'))&&/Needs review/.test(await page.textContent('.hx-left'))&&/Observed/.test(await page.textContent('.hx-left')));
 await page.locator('.hx-left .hx-card',{hasText:'M5.4'}).first().click();
 await page.waitForFunction(()=>!!document.querySelector('.hx-detail .hx-big'),null,{timeout:8000}).catch(()=>{});
 check(scope,'an observation opens with its magnitude and the official USGS link',/5\.4/.test(await page.textContent('.hx-detail .hx-big'))&&(await page.locator('.hx-detail__foot a[href^="https://earthquake.usgs.gov/"]').count())===1);
 if(width<1100)await page.locator('.hx-detail .hx-close').click();
 await page.locator('.hx-left .hx-seg [data-seg="sources"]').click();
 await page.waitForFunction(()=>/Intelligence connector/.test(document.querySelector('.hx-left').textContent),null,{timeout:8000}).catch(()=>{});
 check(scope,'Sources lists every source with its health',/Intelligence connector/.test(await page.textContent('.hx-left'))&&/Missions and evidence/.test(await page.textContent('.hx-left')));
 await page.locator('.hx-left .hx-seg [data-seg="feed"]').click();
 await shot('intel');
 /* the Layers menu: base map, vision, HUD (on a phone, the list sheet shrinks to show the Earth first) */
 if(width<1100&&await page.locator('.hx-left').getAttribute('data-expanded')==='true')await page.locator('.hx-grip').click();
 await page.locator('.hx-layers-btn').click();
 check(scope,'Layers opens the base map, the visual modes and the tools',await page.locator('.hx-pop').isVisible()&&(await page.locator('.hx-pop [data-style]').count())===7&&(await page.locator('.hx-pop [data-base]').count())===3);
 await page.locator('.hx-pop [data-style="flir"]').click();
 const stagesOn=()=>{const s=HuGlobe.viewer().scene.postProcessStages;let on=0;for(let i=0;i<s.length;i++)if(s.get(i).enabled)on++;return on};
 await page.waitForFunction(stagesOn,null,{timeout:8000}).catch(()=>{});
 check(scope,'Thermal turns on one post-process stage',(await state()).style==='flir'&&(await page.evaluate(stagesOn))>=1);
 await page.locator('.hx-pop [data-tool="hud"]').click();
 await page.waitForTimeout(400);
 await page.keyboard.press('Escape');
 await page.keyboard.press('1');
 await page.waitForTimeout(500);
 st=await state();
 check(scope,'key 1 goes back to Normal; the telemetry HUD shows MGRS and UTC',st.style==='normal'&&st.hud&&!!st.readout&&/^\d{1,2}[C-X] [A-Z]{2} \d+ \d+$/.test(String(st.readout.mgrs||''))&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(st.readout.utc||'')),st.readout);
 /* search: the owner's own things, then places */
 await page.fill('.hx-search input','Harbor');
 await page.locator('.hx-search input').press('Enter');
 await page.waitForSelector('.hx-results button',{timeout:5000}).catch(()=>{});
 check(scope,'search finds the owner\'s mission first',/Harbor water check/.test(await page.textContent('.hx-results'))&&/Mission/.test(await page.textContent('.hx-results')));
 await page.fill('.hx-search input','Paris');
 await page.locator('.hx-search input').press('Enter');
 await page.waitForFunction(()=>/Paris, Île-de-France/.test(document.querySelector('.hx-results').textContent),null,{timeout:5000}).catch(()=>{});
 await page.locator('.hx-results button',{hasText:'Île-de-France'}).click();
 await page.waitForFunction(()=>{const c=HuGlobe.viewer().camera.positionCartographic;return c.height<200000&&Math.abs(c.longitude*180/Math.PI-2.35)<1},null,{timeout:8000}).catch(()=>{});
 check(scope,'picking a place flies the Earth to it',await page.evaluate(()=>{const c=HuGlobe.viewer().camera.positionCartographic;return c.height<200000&&Math.abs(c.longitude*180/Math.PI-2.35)<1}));
 const link=await page.evaluate(()=>HaloConsole._share.link());
 check(scope,'Copy a link makes an owner-only link with the view in its hash',/action-globe\.html\?explore=1&halo=1#halo=[A-Za-z0-9_-]+$/.test(link||''),link);
 check(scope,'no document horizontal overflow at the end',await noOverflow());
 /* the World's frame shows the owner a door to it */
 const frameHost=await ctx.newPage();await frameHost.goto(BASE+'/__world-release_host');
 const frame=await (async()=>{for(let n=0;n<50;n++){const f=frameHost.frames().find(f=>f.url().includes('action-globe.html'));if(f)return f;await frameHost.waitForTimeout(100)}return null})();
 if(frame){await frame.waitForFunction(()=>{const d=document.getElementById('ctlHalo');return d&&!d.hidden},null,{timeout:15000}).catch(()=>{});}
 check(scope,"the World frame shows the owner the Halo door, opening the full-screen globe",!!frame&&await frame.evaluate(()=>{const d=document.getElementById('ctlHalo');return !!d&&!d.hidden&&d.getAttribute('href')==='action-globe.html?explore=1&halo=1'&&d.target==='_top'&&d.getBoundingClientRect().height>=44}));
 await frameHost.close();
 /* role loss takes it away */
 loseOwner();await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await page.waitForFunction(()=>!HaloConsole.state().mounted,null,{timeout:8000}).catch(()=>{});
 check(scope,'losing the owner answer unmounts the view, its marks and its layers',!(await state()).mounted&&!(await page.$('#haloShell'))&&!(await page.evaluate(()=>document.documentElement.classList.contains('halo-on'))));
}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try {
for(const width of [390,820,1280])for(const persona of (process.env.WORLD_QA_PERSONA?[process.env.WORLD_QA_PERSONA]:['guest','member','creator','owner','halo','failed'])){
 const scope=width+' '+persona, ctx=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390});
 let owner=persona==='owner'||persona==='halo', calls=0, slow=false, mapReads=0, haloCode=0;const errors=[];
 await ctx.addInitScript(p=>{localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));if(p!=='guest')localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({sub:'owner-'+p,exp:Math.floor(Date.now()/1000)+3600}))+'.y'}));},persona);
 await ctx.route('**/*',async route=>{
  const url=new URL(route.request().url()), headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
  const json=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
  if(url.origin===BASE){if(/^\/(js\/halo\/|css\/halo)/.test(url.pathname))haloCode++;if(url.pathname==='/__world-release_host')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><iframe style="width:100%;height:100vh;border:0" src="/action-globe.html?embedded=1&surface=network"></iframe></body></html>'});return route.continue();}
  if(url.hostname==='cesium.com'){
   const path=url.pathname.split('/Build/Cesium/')[1];try{return route.fulfill({body:await readFile(join(process.env.CESIUM_DIR,path)),contentType:TYPES[extname(path)]||'application/octet-stream'});}catch{return route.abort();}
  }
  if(url.hostname==='api.mccluster.org'){
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(url.pathname==='/v1/status')return json({ok:owner},owner?200:403);
   if(url.pathname==='/v1/world/access'){mapReads++;return persona==='failed'?json({},503):json({release:{version:'globe-admin-preview/v1',admin_preview:owner},level:owner?'owner':persona,unlocked_layers:owner?['flights','satellites','launches','music','audience','transport']:[],locked_layers:FEATURES.filter(x=>!owner||['ion','cctv','intel'].includes(x)).map(id=>({id,reason:'admin_preview'})),layers:{}});}
   if(persona==='halo'&&HALO_FIXTURES[url.pathname]){calls++;return json(HALO_FIXTURES[url.pathname]);}
   if(persona==='halo'&&url.pathname==='/v1/news-briefs')return json({day:url.searchParams.get('day'),briefs:[{country:'US',country_name:'United States',day:url.searchParams.get('day'),status:'ready',editorial_status:'draft',overview:'Fixture overview of the day.',happened:['Fixture event'],may_mean:[],uncertain:[],sources:[{n:1,title:'Fixture source',url:'https://example.org/a',domain:'example.org'}]}]});
   if(persona==='halo'&&/^\/v1\/mnet\/missions\/proofs\//.test(url.pathname))return json({error:'not_admin'},403);
   if(persona==='halo'&&url.pathname==='/v1/world/geocode')return json({ok:true,query:url.searchParams.get('q'),results:[{name:'Paris, Île-de-France, France',kind:'city',lon:2.3522,lat:48.8566,bbox:[2.22,48.81,2.47,48.90]},{name:'Paris, Texas, United States',kind:'town',lon:-95.5555,lat:33.6609,bbox:null}],attribution:'Photon by Komoot · © OpenStreetMap contributors',license:'ODbL-1.0'});
   if(url.pathname.includes('/v1/world/layers/')){calls++;if(slow)await new Promise(r=>setTimeout(r,250));return json({aircraft:[],count:0});}
   return json({},404);
  }
  if(url.hostname.endsWith('supabase.co'))return json(url.pathname==='/auth/v1/user'?{id:'owner-'+persona,email:'fixture@example.invalid'}:url.pathname.includes('/rpc/')?[]:{});
  if(route.request().resourceType()==='image')return route.fulfill({body:PNG,contentType:'image/png',headers});
  return route.abort();
 });
 const host=await ctx.newPage();host.on('pageerror',e=>errors.push(e.message));
 await host.goto(BASE+(persona==='creator'?'/__world-release_host':persona==='halo'?'/action-globe.html?explore=1&halo=1':'/action-globe.html?explore=1'));const page=persona==='creator'?host.frames().find(f=>f.url().includes('action-globe.html')):host;await page.waitForFunction(()=>typeof window.__huGlobeSettled==='function');
 await page.waitForTimeout(300);
 check(scope,'base globe remains available',await page.locator('#globe canvas').count()>0);
 check(scope,'no document horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 if(!owner){
  await page.waitForTimeout(400);
  check(scope,'no Halo view, and no Halo code fetched, for anyone but the owner',!(await page.$('#haloShell'))&&!(await page.evaluate(()=>!!window.HaloConsole))&&haloCode===0,{haloCode});
  check(scope,'no Halo door in the header for anyone but the owner',await page.evaluate(()=>{const d=document.getElementById('haloEnter');return !d||d.hidden}));
  if(persona==='creator')check(scope,"the World frame's Halo door stays hidden",await page.evaluate(()=>{const d=document.getElementById('ctlHalo');return !!d&&d.hidden}));
  check(scope,'optional controls hidden',await page.evaluate(ids=>ids.every(id=>document.getElementById(id).hidden),BUTTONS));
  await page.evaluate(ids=>ids.forEach(id=>document.getElementById(id).click()),BUTTONS);await page.waitForTimeout(100);
  check(scope,'synthetic clicks cannot fetch a layer',calls===0);
  if(persona==='creator'){await host.evaluate(()=>{const f=document.querySelector('iframe').contentWindow;f.postMessage({type:'hu:creator-mode',on:true},location.origin);f.postMessage({type:'hu:audience-points',points:[{lon:-74,lat:41,views:7,name:'Fixture'}]},location.origin);});await page.waitForTimeout(100);check(scope,'parent messages cannot bypass release policy',await page.evaluate(()=>window.__huAudienceCount()===0));}
 }else if(persona==='halo'){
  await haloChecks(scope,page,host,width,ctx,()=>{owner=false},()=>calls);
  // The authorized data shell must survive missing WebGL/runtime assets.
  owner=true;
  await ctx.route('**/Build/Cesium/Cesium.js',r=>r.abort());
  await page.goto(BASE+'/action-globe.html?explore=1&halo=missions');
  // The shell contains fixed-position panels and has no layout box of its own.
  await page.waitForSelector('html.halo-no-map #haloShell .hx-left',{timeout:20000});
  if(width===1280){
    await page.locator('[data-closed="1"]').click();
    await page.waitForSelector('[data-closed="0"]');
    check(scope,'closed mission filter is represented in the address',new URL(page.url()).searchParams.get('section')==='closed');
    await page.goBack();
    await page.waitForSelector('[data-closed="1"]');
    check(scope,'Back restores active missions',await page.locator('[data-seg="active"]').getAttribute('aria-selected')==='true');
    await page.locator('[data-sort="missions"]').selectOption('newest');
    await page.reload();
    await page.waitForSelector('[data-sort="missions"]');
    check(scope,'reload retains newest mission sorting',await page.locator('[data-sort="missions"]').inputValue()==='newest');
    await page.locator('[data-view="intel"]').click();
    await page.locator('[data-hours]').selectOption('6');
    check(scope,'time window is represented in the address',new URL(page.url()).searchParams.get('hours')==='6');
    await page.goBack();
    await page.waitForFunction(()=>HaloConsole.state().hours===24);
    check(scope,'Back restores both time selectors',await page.locator('[data-hours]').inputValue()==='24'&&await page.locator('.hx-window').inputValue()==='24');
  }
  for(const v of ['world','missions','people','intel']){
    await page.locator('[data-view="'+v+'"]').click();
    await page.waitForTimeout(150);
    check(scope,'mapless '+v+' remains usable',await page.locator('.hx-left').isVisible()&&(await page.locator('[data-view="'+v+'"]').getAttribute('aria-selected'))==='true');
  }
  check(scope,'mapless layout has no overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
  await page.waitForFunction(()=>document.querySelector('.hx-panel__body')?.textContent.includes('Harbor flooding report'));
  check(scope,'mapless Intelligence loads evidence independently of map layers',await page.locator('.hx-left').getByText('Harbor flooding report',{exact:true}).isVisible());
  await page.screenshot({path:join(OUT,'halo-fallback-'+width+'.png')});
  owner=false;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(()=>!document.getElementById('haloShell'));
  check(scope,'mapless owner revocation removes private data',!(await page.locator('#haloShell').count()));

 }else{
  await page.locator('.globe-editorial-tools > summary').click();
  check(scope,'the owner sees the Halo door beside ← World, a full tap target',await page.evaluate(()=>{const d=document.getElementById('haloEnter'),b=d&&d.getBoundingClientRect();return !!d&&!d.hidden&&d.getAttribute('href')==='action-globe.html?explore=1&halo=1'&&b.height>=44&&b.width>=44}));
  check(scope,'verified owner has preview control',await page.locator('#ctlFlights').isVisible());
  await page.locator('#ctlFlights').click();await page.waitForFunction(()=>window.__huLayerOn('flights'));
  check(scope,'owner preview works',calls===1);
  owner=false;const reads=mapReads;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForFunction(()=>document.getElementById('ctlFlights').hidden);
  check(scope,'role loss clears active data',!(await page.evaluate(()=>window.__huLayerOn('flights')))&&mapReads>reads);
  owner=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForFunction(()=>!document.getElementById('ctlFlights').hidden);
  slow=true;await page.locator('#ctlFlights').click();await page.evaluate(()=>{localStorage.removeItem('mccdb_session');window.dispatchEvent(new StorageEvent('storage',{key:'mccdb_session'}));});owner=false;
  await page.waitForTimeout(500);
  check(scope,'late response after sign-out never draws',!(await page.evaluate(()=>window.__huLayerOn('flights'))));
 }
 check(scope,'no JavaScript runtime errors',errors.length===0,errors);
 if(persona==='guest')await page.screenshot({path:join(OUT,'curated-world-'+width+'.png')});
 await ctx.close();
}
}finally{await browser.close();server.close();}
if(failed)process.exitCode=1;
