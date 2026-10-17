import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJourney, itinerary, legAction, searchCities } from '../../js/travel/journey-core.mjs';
import { journeyStore } from '../../js/travel/journey-store.mjs';
const draft=()=>normalizeJourney({from:{label:'New Haven',coordinates:[-72.9,41.33]},to:{label:'Lisbon',coordinates:[-9.14,38.72]},departure:'2026-11-04'});

test('journey validation rejects impossible dates, travelers and coordinates, and strips booking claims',()=>{
  for(const change of [{departure:'2026-02-30'},{returning:'2026-10-01'},{travelers:0},{travelers:1.5},{travelers:17},{mode:'teleport'},{to:{label:'Lisbon',coordinates:[null,0]}}])assert.throws(()=>normalizeJourney({...draft(),...change}));
  const d=normalizeJourney({...draft(),confirmed:true,price:1,provider:'uber',owner_id:'someone-else'});
  assert.equal(d.confirmed,undefined);assert.equal(d.owner_id,undefined);assert.equal(d.price,undefined);
  assert.deepEqual(normalizeJourney({...draft(),to:{label:'Unknown address'}}).to,{label:'Unknown address',coordinates:null});
});
test('a whole trip does not invent airports; only explicit endpoints produce a road handoff',()=>{
  let d=draft();assert.equal(itinerary(d).length,4);assert.deepEqual(legAction(d,'departure'),{type:'edit',field:'departureHub'});
  assert.equal(legAction(d,'main').type,'search');assert.match(legAction(d,'main').url,/google.com\/search/);
  d=normalizeJourney({...d,departureHub:'JFK Terminal 4',arrivalHub:'Lisbon airport',stay:'My hotel, Lisbon'});
  const ride=new URL(legAction(d,'departure').url);assert.equal(ride.searchParams.get('origin'),'New Haven');assert.equal(ride.searchParams.get('destination'),'JFK Terminal 4');assert.equal(ride.searchParams.get('travelmode'),'driving');
  assert.equal(new URL(legAction(d,'arrival').url).searchParams.get('destination'),'My hotel, Lisbon');
  assert.equal(legAction({...d,mode:'train'},'main').type,'search');
  assert.equal(new URL(legAction({...d,mode:'walk'},'main').url).searchParams.get('travelmode'),'walking');
});
test('destination search matches accents and ranks exact city names before less specific matches',()=>{
  const rows=[{name:'Sao Paulo suburb',label:'São Paulo suburb, Brazil',population:900},{name:'São Paulo',label:'São Paulo, Brazil',population:500},{name:'Lisbon',label:'Lisbon, Portugal',population:1000}];
  assert.equal(searchCities(rows,'sao paulo')[0].name,'São Paulo');
  assert.equal(searchCities(rows,'São Paulo Brazil').length,2);
  assert.equal(searchCities(rows,'Lisbon')[0].name,'Lisbon');assert.equal(searchCities(rows,'x').length,0);
});
test('private store uses the canonical session and sends only normalized plan fields',async()=>{
  const requests=[],id='11111111-1111-4111-8111-111111111111';
  const store=journeyStore({url:'https://example.supabase.co',key:'public',token:async()=>'member-token'},async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify([{id,plan:draft()}]));});
  await store.save({...draft(),owner_id:'other',confirmed:true});await store.save(draft(),id);await store.list();await store.remove(id);
  assert.equal(requests[0].options.headers.Authorization,'Bearer member-token');
  assert.deepEqual(Object.keys(JSON.parse(requests[0].options.body)),['plan']);assert.equal(JSON.parse(requests[0].options.body).plan.confirmed,undefined);
  assert.equal(requests[1].options.method,'PATCH');assert.match(requests[1].url,/id=eq\.11111111/);assert.equal(requests[3].options.method,'DELETE');
  await assert.rejects(()=>store.save(draft(),'bad&id=other'),/Invalid journey/);
});
test('failed and signed-out saves never report success',async()=>{
  let calls=0;const request=async()=>{calls++;return new Response('[]',{status:403});};
  await assert.rejects(()=>journeyStore({token:async()=>null},request).save(draft()),/Sign in/);assert.equal(calls,0);
  await assert.rejects(()=>journeyStore({token:async()=>'token'},request).save(draft()),/could not/);
  await assert.rejects(()=>journeyStore({token:async()=>'token'},async()=>new Response('[]')).save(draft()),/no longer available/);
});
