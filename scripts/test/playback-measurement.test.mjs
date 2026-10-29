import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('js/analytics.js','utf8');
const start=source.indexOf('/* PLAYBACK_MEASUREMENT_FACTORY_BEGIN */'),end=source.indexOf('/* PLAYBACK_MEASUREMENT_FACTORY_END */');
const scope={};vm.runInNewContext(source.slice(start,end),scope);
let ids=0;
function fixture(){
 let time=0;const audio={currentTime:0,playbackRate:1,paused:true,seeking:false,readyState:4};
 const make=()=>scope.mccCreatePlaybackMeasurement(audio,()=>String(++ids),()=>time);
 const m=make();
 return {audio,m,make,advance(ms,position){time+=ms;if(position!==undefined)audio.currentTime=position;},
   play(){audio.paused=false;return m.playing();}};
}

test('play intent/rejection is not playback and cannot complete an attempt',()=>{
 const f=fixture();f.advance(4000);assert.equal(f.m.finish(),false);
 assert.equal(f.m.seconds(),0);assert.equal(f.m.report().measurement_status,'browser_progress_not_attention');
});
test('validated progress excludes pauses, frozen media and buffer intervals',()=>{
 const f=fixture();assert.equal(f.play(),true);
 f.advance(1000,1);f.m.sample();f.audio.paused=true;f.m.pause();
 f.advance(60000,1);assert.equal(f.m.seconds(),1);
 assert.equal(f.play(),false);f.advance(1000,2);f.m.sample();
 f.advance(1000,2);f.m.sample();assert.equal(f.m.seconds(),2,'unpaused but frozen media adds nothing');
 f.audio.readyState=2;f.m.waiting();f.advance(1000,3);f.m.sample();
 f.audio.readyState=4;f.m.playing();f.advance(1000,4);f.m.sample();
 assert.equal(f.m.seconds(),3);assert.equal(f.m.report().unmeasured_gap_ms,0,'known pause is not an unexplained observation gap');
});
test('seeks, backward jumps and stale gaps are excluded and disclosed',()=>{
 const f=fixture();f.play();f.advance(1000,1);f.m.sample();
 f.audio.seeking=true;f.audio.currentTime=100;f.m.seeking();f.audio.seeking=false;f.m.resumeAfterSeek();
 f.advance(1000,101);f.m.sample();f.advance(1000,150);f.m.sample();
 f.advance(1000,10);f.m.sample();f.advance(30000,40);f.m.sample();
 assert.equal(f.m.seconds(),2);const r=f.m.report();assert.equal(r.unmeasured_gap_ms,30000);assert.equal(r.progress_discontinuities,3);
 f.advance(1000,41);f.m.sample();assert.equal(f.m.seconds(),3,'fresh progress recovers after a gap');
});
test('background callbacks count valid progress without assuming attention or audibility',()=>{
 const f=fixture();f.audio.muted=true;f.audio.volume=0;f.play();
 for(let i=1;i<=4;i++){f.advance(1000,i);f.m.sample();}
 assert.equal(f.m.seconds(),4);assert.equal(f.m.report().measurement_status,'browser_progress_not_attention');
});
test('speed changes count elapsed playback, not media displacement; short ends and duplicate ends are stable',()=>{
 const f=fixture();f.audio.playbackRate=2;f.play();f.advance(500,1);f.m.sample();
 f.audio.paused=true;f.advance(250,1.5);assert.equal(f.m.finish(),true);assert.equal(f.m.finish(),false);
 assert.equal(f.m.seconds(),.75);f.advance(60000,1.5);assert.equal(f.m.seconds(),.75);
});
test('each replay or reload gets a distinct attempt; reports retain ordered sequence within it',()=>{
 const f=fixture();f.play();f.advance(1000,1);f.m.finish();
 const a=f.m.report(),b=f.m.report();assert.equal(a.playback_attempt_id,b.playback_attempt_id);assert.equal(b.playback_sequence,a.playback_sequence+1);
 f.audio.currentTime=0;const loop=f.make(),reload=f.make();
 assert.notEqual(loop.report().playback_attempt_id,a.playback_attempt_id);
 assert.notEqual(loop.report().playback_attempt_id,reload.report().playback_attempt_id);
 assert.equal(loop.seconds(),0);assert.equal(reload.seconds(),0,'no invented resume credit');
});
test('non-monotonic time and non-finite positions cannot manufacture progress',()=>{
 const f=fixture();f.play();f.advance(-1000,1);f.m.sample();f.advance(1000,NaN);f.m.sample();
 assert.equal(f.m.seconds(),0);
});
test('withdrawal invalidates cumulative progress permanently; re-acceptance starts fresh',()=>{
 let allowed=true,time=0,id=0;const audio={currentTime:0,playbackRate:1,paused:false,seeking:false,readyState:4};
 const make=()=>scope.mccCreatePlaybackMeasurement(audio,()=>String(++id),()=>time,()=>allowed);
 const before=make();before.playing();time=1000;audio.currentTime=1;assert.equal(before.seconds(),1);
 const original=before.report().playback_attempt_id;
 allowed=false;time=2000;audio.currentTime=2;before.sample();allowed=true;
 assert.equal(before.valid(),false);assert.equal(before.seconds(),null);assert.equal(before.finish(),false);
 assert.equal(before.report().playback_attempt_id,undefined);
 assert.equal(before.report().measurement_status,'unavailable_consent_boundary');
 const after=make();after.playing();time=3000;audio.currentTime=3;
 assert.equal(after.seconds(),1);assert.notEqual(after.report().playback_attempt_id,original);
});
