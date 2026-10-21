import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../../js/action-globe.js',import.meta.url),'utf8');
const layer=source.slice(source.indexOf('/* Completed cohort events'),source.indexOf('/* the network band'));
const mode=source.slice(source.indexOf('function setTravelMode('),source.indexOf('function drawJourney('));
const listener=source.slice(source.indexOf("window.addEventListener('message'"),source.indexOf(';let missions=[]'));
const event={id:'docket-516r-2025-capstone',title:'Equity Rise Graduation & Showcase',latitude:41.169913500774,longitude:-73.187838263174,date:'2025-10-05',url:'https://matthew.mccluster.org/docket-516r-cohort.html#capstone'};

// Execute the real message boundary and layer against a small Cesium entity sink.
// This tests public coordinates, lifecycle and selection without external map services.
function harness({analytics=false}={}){
 const origin='https://matthew.mccluster.org',parent={},messages=[],entities=[];
 let receive;
 const window={addEventListener:(type,fn)=>{if(type==='message')receive=fn;}};
 const document={documentElement:{classList:{toggle(){}}},querySelector(){return null;}};
 const Cesium={Color:{fromCssColorString:c=>c,BLACK:'#000'},Cartesian3:{fromDegrees:(...p)=>p},Cartesian2:class {constructor(x,y){this.x=x;this.y=y;}},DistanceDisplayCondition:class {constructor(near,far){this.near=near;this.far=far;}},LabelStyle:{FILL_AND_OUTLINE:'outline'}};
 const viewer={camera:{cancelFlight(){}},entities:{add:e=>{entities.push(e);return e;},remove:e=>{const i=entities.indexOf(e);if(i>=0)entities.splice(i,1);}}};
 const api=new Function('window','document','location','parentFrame','ANALYTICS','EDITORIAL','Cesium','tell',`
  let viewer,travelMode=false,journeyEntities=[],showMissions=true,showCities=true,readyMessage=null;
  let currentLocation=null,routeFlyPending=false,locationFlyPending=false,locationAnimatePending=false,journeyFlyPending=false;
  const $=()=>null,travelStyle=()=>{},draw=()=>{},travelVisibility=()=>{},scheduleTravelControls=()=>{},scheduleTravelCamera=()=>{};
  function clear(arr){arr.forEach(e=>viewer.entities.remove(e));arr.length=0;}
  ${mode}
  ${layer}
  ${listener};
  return {mount:v=>{viewer=v;setTravelMode(travelMode);},select:selectCompletedEvent,sanitize:sanitizeCompletedEvents};
 `)(window,document,{origin},parent,analytics,!analytics,Cesium,m=>messages.push(m));
 return {...api,entities,messages,mount:()=>api.mount(viewer),state:()=>window.__huCompletedMissions(),send:(data,overrides={})=>receive({data,origin,source:parent,...overrides})};
}

test('completed events keep only bounded public fields and genuine coordinates',()=>{
 const h=harness();
 const rows=h.sanitize([event,{...event,title:'Duplicate'},...[
  {id:'missing-lat',latitude:null},
  {id:'string-lon',longitude:'-73.18'},
  {id:'bad-lat',latitude:91},
  {id:'bad-lon',longitude:181},
  {id:'empty-place',latitude:0,longitude:0},
  {id:'infinite',latitude:Infinity},
  {id:'bad/id'},
  {id:'empty-title',title:'   '},
 ].map(x=>({...event,...x}))]);
 assert.deepEqual(rows,[{id:event.id,title:event.title,latitude:event.latitude,longitude:event.longitude,date:event.date}]);
 assert.equal(h.sanitize([{...event,date:'2025-02-31'}])[0].date,'');
 assert.equal(h.sanitize(Array.from({length:80},(_,i)=>({...event,id:'event-'+i}))).length,50);
});

test('only the same-origin parent can supply the archive; pre-viewer events draw on mount',()=>{
 const h=harness();
 const payload={type:'hu:completed-missions',events:[event],on:true};
 h.send(payload,{origin:'https://other.example'});
 h.send(payload,{source:{}});
 assert.deepEqual(h.state(),{on:false,events:0,pins:0});
 h.send(payload);
 assert.deepEqual(h.state(),{on:true,events:1,pins:0});
 h.mount();
 assert.equal(h.entities.length,1);
 assert.deepEqual(h.entities[0].position,[event.longitude,event.latitude,3000]);
 assert.match(h.entities[0].label.text,/^Completed · /);
 assert.deepEqual(h.entities[0].properties,{completedEventId:event.id});
 assert.equal(h.select(event.id),true);
 assert.deepEqual(h.messages,[{type:'hu:completed-selected',eventId:event.id}]);
 assert.equal(h.select('not-in-archive'),false);
});

test('Travel and other modes clear the completed layer, and stale selections do nothing',()=>{
 const h=harness();h.mount();
 h.send({type:'hu:completed-missions',events:[event],on:true});
 h.send({type:'hu:travel-mode',on:true});
 assert.deepEqual(h.state(),{on:false,events:1,pins:0});
 assert.equal(h.select(event.id),false);
 h.send({type:'hu:completed-missions',events:[event],on:true});
 assert.equal(h.entities.length,0,'archive messages cannot show pins in Travel');
 h.send({type:'hu:travel-mode',on:false});
 assert.equal(h.entities.length,1);
 h.send({type:'hu:completed-missions',events:[],on:false});
 assert.deepEqual(h.state(),{on:false,events:0,pins:0});
 assert.equal(h.select(event.id),false);
 assert.equal(h.messages.length,0);
});

test('Analytics never accepts the public archive layer',()=>{
 const h=harness({analytics:true});h.mount();
 h.send({type:'hu:completed-missions',events:[event],on:true});
 assert.deepEqual(h.state(),{on:false,events:0,pins:0});
 assert.equal(h.select(event.id),false);
});
