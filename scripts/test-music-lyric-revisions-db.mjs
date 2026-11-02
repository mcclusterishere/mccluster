// Real disposable PostgreSQL permissions, functions, triggers and release guard.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {lyricDatabase,ACTOR,CREATOR,TRACK} from './test/music-lyric-db-fixture.mjs';
import {getLyricRevision,saveLyricRevision,exportApprovedLyricRevision} from '../supabase/functions/music-access/lyrics-revisions.ts';
const f=await lyricDatabase({install:false}),{db,admin}=f;
let checks=0;const ok=(value)=>{assert.ok(value);checks++;};
const get=()=>getLyricRevision(admin,TRACK,ACTOR);
const save=async(text,reviewed,extra={})=>{const before=await get();return saveLyricRevision(admin,TRACK,{lyrics:{timed:{line:[{begin:0,end:2,content:text,...extra}]}},reviewed,expected_revision:before.revision,expected_hash:before.hash,expected_updated_at:before.expected_updated_at},ACTOR);};
async function publish(){await f.service();const v=(await db.query('select * from public.music_prepare_review($1)',[TRACK])).rows[0];await db.query('select public.music_record_asset_sha256($1,$2,$3)',[v.version_id,'a'.repeat(64),v.size_bytes]);const row=await f.track();await f.service();await db.query("select public.music_operator_review($1,'publish','fixture',$2,$3)",[TRACK,row.updated_at,'a'.repeat(64)]);}
try{
 const legacy={timed:{line:[{begin:0,end:2,content:'Legacy current',heard:'LEGACY_PRIVATE_ANNOTATION',words:[{begin:0,end:2,content:'Legacy',_history:['NESTED_PRIVATE']}]}]},reviewed:true,_revision:{number:999,sha256:'forged'},_history:[{revision:999,hash:'forgedhash',lyrics:{reviewed:true,plain:'LEGACY_PRIVATE_HISTORY'}}]};
 await db.query('update public.creator_tracks set lyrics=$1::jsonb where id=$2',[JSON.stringify(legacy),TRACK]);await publish();
 await f.asRole('anon');ok(JSON.stringify((await db.query('select * from public.creator_tracks where id=$1',[TRACK])).rows).includes('LEGACY_PRIVATE_HISTORY'));
 await db.exec('reset role');await f.apply('supabase/pending/music_lyric_revisions_v1.sql');
 const after=await get();ok(after.revision===0&&after.lyrics.reviewed===false&&after.approved_versions.length===0);ok(!JSON.stringify(after).includes('LEGACY_PRIVATE'));
 await db.exec('reset role');const archived=(await db.query('select untrusted_legacy from private.music_lyric_revisions where track_id=$1',[TRACK])).rows;ok(JSON.stringify(archived).includes('LEGACY_PRIVATE_HISTORY'));
 const row0=await f.track();ok(row0.status==='pending_review');ok(!JSON.stringify(row0).includes('LEGACY_PRIVATE'));ok(!JSON.stringify(row0).includes('NESTED_PRIVATE'));const master=row0.master_path;
 const v1=await save('Approved first words',true,{heard:'OWNER_PRIVATE_ANNOTATION'});ok(v1.revision===1&&v1.lyrics.reviewed_by===ACTOR);
 const v2=await save('UNREVIEWED_PRIVATE_DRAFT',false);ok(v2.revision===2&&v2.lyrics.reviewed===false);
 const v3=await save('Current published words',true);ok(v3.revision===3);ok(v3.approved_versions.map(x=>x.revision).join(',')==='3,1');
 const exported=await exportApprovedLyricRevision(admin,TRACK,{revision:1,expected_hash:v1.hash},ACTOR);ok(exported.lyrics._revision.sha256===v1.hash&&exported.lyrics.timed.line[0].content==='Approved first words');
 await assert.rejects(exportApprovedLyricRevision(admin,TRACK,{revision:2,expected_hash:v2.hash},ACTOR),e=>e.status===409);checks++;
 await assert.rejects(exportApprovedLyricRevision(admin,TRACK,{revision:999,expected_hash:'a'.repeat(64)},ACTOR),e=>e.status===404);checks++;
 await assert.rejects(exportApprovedLyricRevision(admin,TRACK,{revision:1,expected_hash:'b'.repeat(64)},ACTOR),e=>e.status===409);checks++;
 await assert.rejects(getLyricRevision(admin,TRACK,CREATOR),e=>e.status===403);checks++;
 await assert.rejects(saveLyricRevision(admin,TRACK,{lyrics:{timed:{line:[{begin:0,content:'Forged creator approval'}]}},reviewed:true,expected_revision:v3.revision,expected_hash:v3.hash,expected_updated_at:v3.expected_updated_at},CREATOR),e=>e.status===403);checks++;ok((await get()).revision===3);
 await publish();await f.asRole('anon');
 const album=await readFile(new URL('../album.html',import.meta.url),'utf8');const columns=album.match(/&select=(id,[a-z_,]+)&limit=1/)[1];ok(!(columns.includes('reviewed_snapshot')||columns.includes('master_path')));ok((await db.query('select '+columns+' from public.creator_tracks where id=$1',[TRACK])).rows.length===1);
 const publicRows=(await db.query('select * from public.creator_tracks where id=$1',[TRACK])).rows;ok(publicRows.length===1);const publicJson=JSON.stringify(publicRows);ok(publicJson.includes('Current published words'));for(const forbidden of ['UNREVIEWED_PRIVATE_DRAFT','OWNER_PRIVATE_ANNOTATION','LEGACY_PRIVATE','_history','_revision','reviewed_by'])ok(!publicJson.includes(forbidden));
 await assert.rejects(db.query('select * from private.music_lyric_revisions'),/permission denied/);checks++;
 for(const role of ['anon','authenticated']){await f.asRole(role,ACTOR);await assert.rejects(db.query('select public.music_lyrics_get($1,$2)',[ACTOR,TRACK]),/permission denied/);checks++;await assert.rejects(db.query('delete from private.music_lyric_revisions'),/permission denied/);checks++;}
 const beforeInject=await get();await f.asRole('authenticated',ACTOR);
 await db.query('update public.creator_tracks set lyrics=$1::jsonb where id=$2',[JSON.stringify({...legacy,timed:{line:[{begin:0,end:2,content:'Current published words'}]},_history:[]}),TRACK]);
 const afterInject=await get();ok(afterInject.revision===3&&afterInject.approved_versions.length===2);ok(!(await f.track()).lyrics._history);ok((await f.track()).status==='published');
 // A genuine creator edit still goes back to release review. It cannot erase
 // or forge owner history, and invalidates a stale owner save.
 await f.asRole('authenticated',ACTOR);await db.query("update public.creator_tracks set lyrics='null'::jsonb where id=$1",[TRACK]);ok((await f.track()).status==='pending_review');
 await assert.rejects(saveLyricRevision(admin,TRACK,{lyrics:{timed:{line:[{begin:0,content:'Stale'}]}},expected_revision:beforeInject.revision,expected_hash:beforeInject.hash,expected_updated_at:beforeInject.expected_updated_at},ACTOR),e=>e.status===409);checks++;
 const erased=await get();ok(erased.revision===3&&erased.approved_versions.length===2);
 const same=await exportApprovedLyricRevision(admin,TRACK,{revision:1,expected_hash:v1.hash},ACTOR);ok(same.lyrics._revision.sha256===v1.hash);
 await db.exec('reset role');await assert.rejects(db.query("update private.music_lyric_revisions set approved_by=null where track_id=$1",[TRACK]),/lyric_revision_immutable/);checks++;await assert.rejects(db.query('delete from private.music_lyric_revisions where track_id=$1',[TRACK]),/lyric_revision_immutable/);checks++;
 await f.service();await assert.rejects(db.query('insert into private.music_lyric_revisions(track_id,revision,lyrics,content_sha256) values($1,999,$2,$3)',[TRACK,'{}','a'.repeat(64)]),/permission denied/);checks++;
 await db.exec('reset role');await db.query('delete from public.lyric_test_operators where id=$1',[ACTOR]);await assert.rejects(exportApprovedLyricRevision(admin,TRACK,{revision:1,expected_hash:v1.hash},ACTOR),e=>e.status===403);checks++;
 await db.exec('reset role');await db.query('insert into public.lyric_test_operators values($1)',[ACTOR]);const beforeReapply=await f.track();await f.apply('supabase/pending/music_lyric_revisions_v1.sql');ok(String((await f.track()).updated_at)===String(beforeReapply.updated_at));ok((await get()).revision===3);ok((await f.track()).master_path===master);
 await db.exec('reset role');await f.apply('supabase/pending/music_lyric_revisions_v1.rollback.sql');await assert.rejects(get(),e=>e.status===403);checks++;await db.exec('reset role');ok((await db.query('select count(*)::int n from private.music_lyric_revisions where track_id=$1',[TRACK])).rows[0].n===4);await f.apply('supabase/pending/music_lyric_revisions_v1.sql');ok((await get()).revision===3);
 console.log(`Private lyric revisions: ${checks} PostgreSQL assertions passed (real roles/RLS/ACL, immutable history, authorization, public SELECT *, legacy quarantine, release guard, stale save, selected export).`);
}finally{await f.close();}
