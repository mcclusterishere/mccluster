import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync('js/analytics.js','utf8');
const start=script.indexOf('/* EVENT_OUTBOX_FACTORY_BEGIN */');
const stop=script.indexOf('/* EVENT_OUTBOX_FACTORY_END */',start);
assert.ok(start>=0 && stop>start,'outbox factory present in every first-party analytics loader');
const scope={};vm.createContext(scope);vm.runInContext(script.slice(start,stop),scope);
const make=scope.mccCreateEventOutbox;
class FakeStorage {
  #map=new Map();
  get length(){return this.#map.size;}
  key(i){return [...this.#map.keys()][i]??null;}
  getItem(key){return this.#map.get(key)??null;}
  setItem(key,value){this.#map.set(key,String(value));}
  removeItem(key){this.#map.delete(key);}
  keys(){return [...this.#map.keys()];}
}
let seq=0;const event=()=>({id:'123e4567-e89b-42d3-a456-'+String(++seq).padStart(12,'0'),name:'music_play',path:'music.html',props:{token:'SENSITIVE',track:'Private diary',email:'person@example.org'},referrer:'https://example.org/?token=SENSITIVE'});
function unit(storage,time,allowed){return make(storage,()=>time.value,()=>allowed.value);}

test('persists minimal event identity before network, never secrets, query URL or arbitrary props',()=>{
  const storage=new FakeStorage(),time={value:100000},consent={value:true},box=unit(storage,time,consent),e=event();
  assert.equal(box.put(e),true);
  const json=storage.getItem(storage.keys()[0]);
  assert.doesNotMatch(json,/SENSITIVE|Private diary|person@example|token=|referrer:"https/);
  assert.equal(box.pending(12)[0].id,e.id);
  assert.equal(box.pending(12)[0].referrer,null);
  assert.equal(Object.keys(box.pending(12)[0].props).length,0);
  assert.equal(box.pending(12)[0].path,'music.html');
});
test('independent tabs cannot overwrite a shared JSON array and repeated ACKs are idempotent',()=>{
  const storage=new FakeStorage(),time={value:100000},consent={value:true};
  const a=unit(storage,time,consent),b=unit(storage,time,consent),e1=event(),e2=event();
  assert.equal(a.put(e1),true);assert.equal(b.put(e2),true);
  assert.deepEqual([...a.pending(12)].map(e=>e.id).sort(),[e1.id,e2.id].sort());
  b.acknowledged([e1]);
  a.acknowledged([e1]);
  assert.deepEqual([...a.pending(12)].map(e=>e.id),[e2.id]);
  a.acknowledged([e2]);assert.equal(a.pending(12).length,0);
});
test('recovery waits for the originating tab before replaying a minimal copy',()=>{
  const storage=new FakeStorage(),time={value:100000},consent={value:true};
  const a=unit(storage,time,consent),b=unit(storage,time,consent),e=event();
  assert.equal(a.put(e),true);
  assert.equal(b.pending(12,15000).length,0);
  time.value+=16000;
  assert.deepEqual([...b.pending(12,15000)].map(x=>x.id),[e.id]);
});
test('replay requests never reuse a newer member bearer token',()=>{
  assert.match(script,/var auth = replay \? null : bearer\(\);/);
  assert.match(script,/var pending = eventOutbox\.pending\(BATCH,15000\);/);
});
test('revoked consent clears all persisted events and blocks future storage',()=>{
  const storage=new FakeStorage(),time={value:100000},consent={value:true},box=unit(storage,time,consent);
  assert.equal(box.put(event()),true);
  consent.value=false;
  assert.equal(box.pending(12).length,0);
  assert.equal(storage.length,0);
  assert.equal(box.put(event()),false);
  assert.equal(storage.length,0);
});
test('expired, future, malformed and injected keys are removed during a read',()=>{
  const storage=new FakeStorage(),time={value:100000},consent={value:true},box=unit(storage,time,consent);
  box.put(event());time.value += 6*3600000+1;
  storage.setItem('mcc_event_outbox_v1:malformed','{a');
  assert.equal(box.pending(12).length,0);assert.equal(storage.length,0);
});
test('bounded cap explicitly rejects new persisted entries; no unbounded growth',()=>{
  const storage=new FakeStorage(),time={value:100000},consent={value:true},box=unit(storage,time,consent);
  for(let i=0;i<72;i++)assert.equal(box.put(event()),true);
  assert.equal(box.put(event()),false);
  assert.equal(storage.length,72);
  assert.equal(box.status().dropped_due_to_capacity,1);
  assert.equal(box.pending(100).length,12);
});
test('GPC/DNT and consent gates are wired before put, retry and initial no-consent purge',()=>{
  assert.match(script,/function\(\)\{return mccPrivacyAcknowledged\(\) && !mccControlPreview\(\) && !privacySignal\(\);\}/);
  assert.match(script,/eventOutbox\.put\(event\)/);
  assert.match(script,/window\.addEventListener\("online",function\(\)\{retryOutbox\(\);/);
  assert.match(script,/window\.addEventListener\("storage",function\(ev\)/);
  assert.match(script,/eventOutbox\.acknowledged\(batch\)/);
  assert.match(script,/mccCreateEventOutbox\(localStorage,function\(\)\{return Date\.now\(\);\},function\(\)\{return false;\}\)\.purge\(\)/);
  assert.match(script,/session_id: replay \? null : sessionId\(\)/);
});
