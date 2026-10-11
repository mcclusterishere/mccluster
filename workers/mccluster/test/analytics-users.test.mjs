import test from 'node:test';
import assert from 'node:assert/strict';
import { engagementScore, validateUserPage, groupUserEvents } from '../src/analytics/users-utils.js';
const NOW=Date.parse('2026-10-11T12:00:00Z');
test('score counts only recent meaningful events and recent sessions',()=>{
 const x=engagementScore([
  {at:'2026-10-10T12:00:00Z',name:'music_play',session_id:'s1'},
  {at:'2026-10-10T12:01:00Z',name:'page_view',session_id:'s1'},
  {at:'2026-08-10T12:00:00Z',name:'purchase',session_id:'old'},
  {at:'2026-10-10T12:02:00Z',name:'heartbeat',session_id:'s2'}
 ],NOW);
 assert.deepEqual(x,{value:10,events:3,sessions:2,meaningful:1});
});
test('score caps at 100 and ignores future events',()=>{
 const events=Array.from({length:50},(_,i)=>({at:'2026-10-10T12:00:00Z',name:'music_play',session_id:'s'+i}));
 events.push({at:'2026-12-01T00:00:00Z',name:'purchase',session_id:'future'});
 assert.equal(engagementScore(events,NOW).value,100);
 assert.equal(engagementScore(events,NOW).events,50);
});
test('pagination rejects fractional, negative and excessive values',()=>{
 const parse=s=>validateUserPage(new URL('https://example.org/?'+s));
 assert.deepEqual(parse('page=2&limit=25'),{page:2,limit:25});
 for(const q of ['page=0','page=1.5','limit=101','limit=-1','page=10001','limit=NaN'])
   assert.equal(parse(q),null,q);
});
test('event grouping isolates account IDs and caps returned rows',()=>{
 const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
 const rows=[{uid:b,name:'purchase'},...Array.from({length:120},()=>({uid:a,name:'play'})),{uid:'unknown',name:'secret'}];
 const grouped=groupUserEvents(rows,new Set([a,b]));
 assert.equal(grouped.get(a).length,100);
 assert.equal(grouped.get(b).length,1);
 assert.equal(grouped.has('unknown'),false);
});
