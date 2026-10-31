import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {create}=createRequire(import.meta.url)('../../js/composition-draft.js');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
function fixture(){const items=new Map();return {items,store:{getItem:k=>items.get(k)||null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)}};}
test('composition recovery is owner and surface scoped; unowned legacy drafts are never adopted',()=>{
 const {items,store}=fixture(),world=create(store,'world'),advanced=create(store,'advanced');
 items.set('mnet_create_draft_v1',JSON.stringify({body:'legacy private text'}));
 assert.equal(advanced.read(a),null);assert.equal(world.write(a,{body:'A private'}),true);
 assert.equal(world.read(b),null);assert.equal(advanced.read(a),null);
 world.write(b,{body:'B private'});assert.equal(world.read(a).body,'A private');
 world.clear(b);assert.equal(world.read(b),null);assert.equal(world.read(a).body,'A private');
});
test('corrupt timestamps/data, oversized records and unavailable storage fail without a false save acknowledgement',()=>{
 const {items,store}=fixture(),draft=create(store,'world'),key='mcc_composition_v2:world:'+a;
 for(const saved_at of [null,'yesterday',Date.now()-8*86400000,Date.now()+86400000]){
  items.set(key,JSON.stringify({owner:a,saved_at,data:{body:'private'}}));assert.equal(draft.read(a),null);
 }
 items.set(key,JSON.stringify({owner:a,saved_at:Date.now(),data:[]}));assert.equal(draft.read(a),null);
 assert.equal(draft.write(a,{body:'a'.repeat(65000)}),false);assert.equal(draft.write('',{body:'guest'}),false);
 assert.equal(create({setItem(){throw Error('Quota exceeded');}},'world').write(a,{body:'kept in memory'}),false);
 assert.throws(()=>create(store,'../bad'));assert.throws(()=>create(store,'x'.repeat(50)));
});
test('unresolved post identity survives draft TTL until confirmed, including native uncertainty',()=>{
 const {items,store}=fixture(),draft=create(store,'world'),key='mcc_composition_v2:world:'+a;
 for(const request of [{body:'native'},{body:'combined',delivery:{operation_key:'stable'}}]){
  items.set(key,JSON.stringify({owner:a,saved_at:Date.now()-30*86400000,data:{body:'private',pending:{kind:'world-post',request}}}));
  assert.deepEqual(draft.read(a).pending.request,request);assert.equal(draft.read(b),null);
 }
 draft.clear(a);assert.equal(draft.read(a),null);
});
