import test from 'node:test';
import assert from 'node:assert/strict';
import {eventKind,eventGeometry,normalizeAlert,normalizeNatural,fetchWeather,fetchNatural,boundedEventJson} from '../src/world-events.js';
import {handleHaloLayers} from '../src/world-halo-layers.js';
const NOW=Date.parse('2026-10-24T10:00Z');
const alert=(p={},geometry=null)=>({id:'https://api.weather.gov/alerts/one',properties:{status:'Actual',messageType:'Alert',event:'Tornado Warning',expires:'2026-10-24T11:00Z',sent:'2026-10-24T09:55Z',...p},geometry});
test('different event families keep distinct visual identities',()=>{
  for(const [label,kind] of [['Tornado Warning','tornado'],['Tropical Storm Warning','cyclone'],['Earthquakes','quake'],['Wildfires','fire'],['Flash Flood Warning','flood'],['Volcanoes','volcano'],['Snow','snow'],['Sea and Lake Ice','ice'],['Dust and Haze','dust'],['Landslides','landslide'],['Severe Storms','storm'],['Drought','heat'],['High Wind Warning','wind'],['High Surf Advisory','wave']])assert.equal(eventKind(label),kind,label);
  assert.equal(eventKind('Unrecognized report'),'alert');
});
test('only actual unexpired alerts are retained, including the earliest expiry',()=>{
  assert.equal(normalizeAlert(alert(),NOW).provenance,'warning');
  for(const p of [{status:'Test'},{messageType:'Cancel'},{expires:'2026-10-23T00:00Z'},{expires:null},{ends:'2026-10-24T09:00Z'},{expires:'2026-10-23T00:00Z',ends:'2026-10-25T00:00Z'}])assert.equal(normalizeAlert(alert(p),NOW),null);
});
test('unlocated warnings never fabricate a coordinate; polygon anchors are labelled',()=>{
  const missing=normalizeAlert(alert(),NOW);assert.equal(missing.lon,null);assert.equal(missing.lat,null);assert.equal(missing.location_kind,'unmapped');
  const polygon={type:'Polygon',coordinates:[[[-73,41],[-72,41],[-72,42],[-73,41]],[[-72.8,41.1],[-72.5,41.1],[-72.5,41.3],[-72.8,41.1]]]};
  const area=eventGeometry(polygon);assert.equal(area.location_kind,'area_label');assert.equal(area.polygons[0].length,2);assert.equal(area.lon,-73);
  assert.equal(eventGeometry({...polygon,coordinates:[[],polygon.coordinates[1]]}).location_kind,'unmapped');
  assert.equal(eventGeometry({type:'Point',coordinates:[0,0]}).location_kind,'reported_point');
  assert.equal(eventGeometry({type:'Point',coordinates:[null,0]}).lon,null);
  assert.equal(eventGeometry({type:'Point',coordinates:[999,45]}).lon,null);
});
test('NASA uses the latest dated geometry and never describes a closed report as active',()=>{
  const e={id:'EONET_1',closed:null,title:'Volcano report',categories:[{title:'Volcanoes'}],geometry:[{type:'Point',coordinates:[1,2],date:'2026-10-22'},{type:'Point',coordinates:[3,4],date:'2026-10-23'}]};
  const n=normalizeNatural(e);assert.equal(n.lon,3);assert.equal(n.provenance,'reported');assert.equal(n.kind,'volcano');assert.equal(normalizeNatural({...e,closed:'2026-10-23'}),null);
});
test('provider payloads are bounded and malformed JSON is a typed unavailable error',async()=>{
  await assert.rejects(()=>boundedEventJson(new Response('x'.repeat(101)),100),/budget/);
  await assert.rejects(()=>boundedEventJson(new Response('not json')),/Invalid/);
  assert.deepEqual(await boundedEventJson(new Response('{"events":[]}')),{events:[]});
});
test('adapters use fixed official hosts and preserve unmapped list records',async()=>{
  const future=new Date(Date.now()+3600000).toISOString(),seen=[];
  const fetchImpl=async(url,init)=>{seen.push(String(url));assert.equal(init.redirect,'manual');return new Response(JSON.stringify(String(url).includes('weather.gov')?{features:[alert({expires:future})]}:{events:[]}));};
  const nws=await fetchWeather({},fetchImpl);assert.equal(nws.count,1);assert.equal(nws.mapped,0);
  assert.equal((await fetchNatural({},fetchImpl)).count,0);assert.ok(seen.every(u=>/^https:\/\/(api.weather.gov|eonet.gsfc.nasa.gov)\//.test(u)));
});
test('new routes return private unavailable answers on provider failure, never fake observations',async()=>{
  for(const layer of ['weather','natural']){
    const req=new Request('https://api.mccluster.org/v1/world/layers/'+layer);
    const res=await handleHaloLayers(req,{}, {fetchImpl:async()=>new Response('down',{status:503})});
    const b=await res.json();assert.equal(res.headers.get('cache-control'),'private, no-store');assert.equal(b.unavailable,true);assert.deepEqual(b.events,[]);
  }
});
