import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {validateLyrics,getLyricRevision,saveLyricRevision,exportApprovedLyricRevision} from '../../supabase/functions/music-access/lyrics-revisions.ts';
const original=()=>({timed:{line:[{begin:0,end:2,content:'Owner words',words:[{begin:0,end:1,content:'Owner'},{begin:1,end:2,content:'words'}]}]},reviewed:false});
test('RPC actor comes from verified caller, not body; reserved authority is excluded at every payload level',async()=>{
 const calls=[],admin={rpc:async(name,args)=>{calls.push({name,args});return{data:{revision:1}};}};
 const doc=original();doc._history=[{revision:999,lyrics:{reviewed:true}}];doc._revision={number:999};doc.reviewed_by='forged';doc.timed._history=['private'];doc.timed.line[0]._history=['private'];doc.timed.line[0].words[0].reviewed=true;
 await saveLyricRevision(admin,'track',{actor:'attacker',p_actor:'attacker',lyrics:doc,reviewed:true,expected_updated_at:'v1',expected_revision:0,expected_hash:'a'.repeat(64)},'verified-operator');
 assert.equal(calls[0].name,'music_lyrics_save');assert.equal(calls[0].args.p_actor,'verified-operator');assert.equal(calls[0].args.p_reviewed,true);assert.equal(/_history|_revision|reviewed/.test(JSON.stringify(calls[0].args.p_lyrics)),false);
 await getLyricRevision(admin,'track','verified-operator');await exportApprovedLyricRevision(admin,'track',{revision:1,expected_hash:'a'.repeat(64),actor:'attacker'},'verified-operator');assert.equal(calls[2].name,'music_lyrics_export');assert.equal(calls[2].args.p_actor,'verified-operator');
});
test('invalid timings refused and private editor notes retained only in validated authoring payload',()=>{
 for(const mutate of [d=>d.timed.line[0].begin=-1,d=>d.timed.line[0].end=-1,d=>d.timed.line[0].words[0].end=Infinity,d=>d.timed.line[0].words[0].begin=3]){const doc=original();mutate(doc);assert.throws(()=>validateLyrics(doc));}
 const d=original();d.timed.line[0].heard='Private alternate words';assert.equal(validateLyrics(d).timed.line[0].heard,'Private alternate words');
});
test('missing private RPCs fail closed without falling back to creator JSON',async()=>{
 let reads=0;const admin={from(){reads++;throw new Error('Unsafe fallback');},rpc:async()=>({error:{code:'PGRST202',message:'function missing'}})};
 await assert.rejects(getLyricRevision(admin,'track','owner'),e=>e.status===503);assert.equal(reads,0);
});
test('stale writes, denied actors and unapproved or mismatched exports are explicit refusals',async()=>{
 for(const [message,status] of [['lyric_revision_conflict',409],['lyric_operator_required',403],['lyric_revision_not_approved',409],['lyric_revision_hash_mismatch',409],['lyric_revision_not_found',404]]){
  const admin={rpc:async()=>({error:{message}})};await assert.rejects(exportApprovedLyricRevision(admin,'track',{revision:1,expected_hash:'a'.repeat(64)},'owner'),e=>e.status===status);
 }
});
test('exact editor ignores injected legacy history and payload reviewed flags',()=>{
 const ctx={window:{CR:{}}};vm.runInNewContext(readFileSync(new URL('../../js/control-room/lyrics-review.js',import.meta.url),'utf8'),ctx);
 const mod=ctx.window.CR.lyricsReview;mod.state.saved={reviewed:true};mod.state.identity={revision:999,hash:'forgedhash',history:[{revision:999,hash:'forgedhash',lyrics:{reviewed:true}}]};assert.equal(mod._test.approvedVersions().length,0);
 mod.state.identity.approved_versions=[{revision:2,hash:'a'.repeat(64)}];assert.equal(mod._test.approvedVersions()[0].revision,2);
});
