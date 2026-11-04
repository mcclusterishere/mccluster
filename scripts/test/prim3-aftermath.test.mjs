import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import * as L from '../../js/prim3-tactics/levels/transit-relay.mjs';
import { missionAftermath } from '../../js/prim3-tactics/aftermath.mjs';
import { parseResume, missionBriefing } from '../../js/prim3-tactics/lifecycle.mjs';
const fresh = () => R.beginPlayerPhase(R.createState(L.engineConfig({seed:89})));
const briefing = (id='a') => ({id,title:'Owner-edited mission',character:{name:'Draft lead'},briefing:'Owner-edited briefing',deployment:'wildcard-call'});
const pack = (state, extra={}) => JSON.stringify({v:1,state,log:[],...extra});

test('debrief derives objective and squad outcomes without mutating or awarding progress', () => {
 const s=fresh();s.round=10;s.mission.clock=4;
 s.nodes.find(n=>n.id==='RELAY').state='VERIFIED';
 const [e,r,t]=s.units.filter(u=>u.faction==='PLAYER');
 e.dead=true;e.hp=0;r.downed=true;r.hp=0;t.hp=t.maxHp-1;t.statuses.push('EXTRACTED');s.mission.extractedUnitIds=[t.id];
 const before=JSON.stringify(s),report=missionAftermath(s,'lose-downed');
 assert.equal(JSON.stringify(s),before);assert.deepEqual(report.counts,{extracted:1,lost:1,downed:1,injured:1});
 assert.equal(report.round,10);assert.equal(report.clock,4);assert.equal(report.goals.find(g=>g.id==='RELAY').complete,true);
 assert.equal(report.squad.find(u=>u.id===t.id).location,'Extracted');assert.match(report.next,/no carry or revive/);
 assert.ok(!Object.hasOwn(report,'rewards'));assert.ok(!Object.hasOwn(report,'campaign'));
});

test('failed objective remains visibly incomplete and clock failure gets an actionable retry', () => {
 const s=fresh();s.mission.clock=0;const report=missionAftermath(s,'lose-clock');
 assert.equal(report.goals.find(g=>g.id==='RELAY').complete,false);assert.match(report.next,/plan the route/);
});

test('saved completed state reproduces identical aftermath after reload', () => {
 const s=fresh();for(const n of s.nodes.filter(n=>n.required))n.state='VERIFIED';for(const o of s.objectives.filter(o=>o.required))o.state='COMPLETE';
 for(const u of s.units.filter(u=>u.faction==='PLAYER')){u.statuses.push('EXTRACTED');s.mission.extractedUnitIds.push(u.id);}
 const stored=pack(s,{levelId:L.LEVEL_ID,missionId:'a',mission:briefing()});
 const resume=parseResume(stored,s,L.W,L.H,{levelId:L.LEVEL_ID,missionId:'a'});
 assert.deepEqual(missionAftermath(resume.state,'win'),missionAftermath(s,'win'));assert.deepEqual(resume.mission,briefing());
});

test('snapshot is minimal, retains deployed content and ignores arbitrary supplied fields', () => {
 assert.deepEqual(missionBriefing({...briefing(),rewards:100000},'a'),briefing());
 assert.equal(missionBriefing(briefing(),'different'),null);
 assert.equal(missionBriefing({...briefing(),character:null},'a'),null);
});

test('saved identity is authoritative on a plain URL; explicit different mission cannot relabel it', () => {
 const s=fresh(),stored=pack(s,{levelId:L.LEVEL_ID,missionId:'a',mission:briefing()});
 const resume=parseResume(stored,s,L.W,L.H,{levelId:L.LEVEL_ID});assert.equal(resume.missionId,'a');assert.equal(resume.mission.title,'Owner-edited mission');
 assert.throws(()=>parseResume(stored,s,L.W,L.H,{levelId:L.LEVEL_ID,missionId:'b'}),e=>e.canResumeSaved===true&&e.savedMissionId==='a');
 assert.throws(()=>parseResume(stored,s,L.W,L.H,{levelId:'wrong-level'}));
});

test('unlabelled legacy run stays usable on a plain URL but cannot acquire a mission label', () => {
 const s=fresh(),stored=pack(s);
 assert.equal(parseResume(stored,s,L.W,L.H).missionId,null);
 assert.throws(()=>parseResume(stored,s,L.W,L.H,{missionId:'a'}),e=>e.canResumeSaved===true&&e.savedMissionId===null);
});

test('invalid stored briefing cannot fall back to a different current draft', () => {
 const s=fresh();assert.throws(()=>parseResume(pack(s,{missionId:'a',mission:briefing('b')}),s,L.W,L.H));
 assert.throws(()=>parseResume(pack(s,{missionId:'a'}),s,L.W,L.H));
});
