import test from 'node:test';
import assert from 'node:assert/strict';
import {lyricSnapshot,validateLyrics,saveLyricRevision} from '../../supabase/functions/music-access/lyrics-revisions.ts';
const original=()=>({timed:{line:[{begin:0,end:2,content:'Owner words',words:[{begin:0,end:1,content:'Owner'},{begin:1,end:2,content:'words'}]}]},reviewed:false});
function database(){let track={id:'fixture',lyrics:original(),updated_at:'v1',master_path:'untouched.wav'},race=false,writes=[];
 return {get track(){return track},writes,race(){race=true},from(table){assert.equal(table,'creator_tracks');let change=null;return {select(){if(change){if(race)return Promise.resolve({data:[]});track={...track,...change,updated_at:'v'+(writes.length+1)};return Promise.resolve({data:[structuredClone(track)]});}return this},eq(){return this},maybeSingle(){return Promise.resolve({data:structuredClone(track)})},update(value){change=value;writes.push(value);return this}}}};}
test('lyric correction reloads same revision/hash; approved export snapshot matches; master untouched',async()=>{
 const db=database(),before=await lyricSnapshot(db.track.lyrics),doc=original();doc.timed.line[0].content='Corrected words';doc.timed.line[0].words[0].content='Corrected';
 const saved=await saveLyricRevision(db,'fixture',{lyrics:doc,reviewed:true,expected_updated_at:'v1',expected_revision:before.revision,expected_hash:before.hash},'owner');
 const reloaded=await lyricSnapshot(db.track.lyrics);assert.deepEqual(reloaded.lyrics,saved.lyrics);assert.equal(reloaded.hash,saved.hash);assert.equal(reloaded.revision,1);assert.equal(saved.lyrics.reviewed_by,'owner');assert.equal(saved.history[0].lyrics.timed.line[0].content,'Owner words');assert.equal(db.track.master_path,'untouched.wav');assert.deepEqual(Object.keys(db.writes[0]),['lyrics']);
 await assert.rejects(saveLyricRevision(db,'fixture',{lyrics:doc,expected_updated_at:'v1',expected_revision:0,expected_hash:before.hash},'owner'),e=>e.status===409);
});
test('concurrent release writes refuse lyric overwrite',async()=>{const db=database(),before=await lyricSnapshot(db.track.lyrics);db.race();await assert.rejects(saveLyricRevision(db,'fixture',{lyrics:original(),expected_updated_at:'v1',expected_revision:before.revision,expected_hash:before.hash},'owner'),e=>e.status===409);assert.equal(db.track.updated_at,'v1');});
test('invalid start/end/word timings are refused; reserved history cannot be client-injected',()=>{
 for(const mutate of [d=>d.timed.line[0].begin=-1,d=>d.timed.line[0].end=-1,d=>d.timed.line[0].words[0].end=Infinity,d=>d.timed.line[0].words[0].begin=3]){const doc=original();mutate(doc);assert.throws(()=>validateLyrics(doc));}
 const doc=original();doc._revision={number:999};doc._history=['fake'];const clean=validateLyrics(doc);assert.equal(clean._history,undefined);assert.equal(clean._revision,undefined);
});
