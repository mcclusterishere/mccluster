// Audio rooms SQL in an isolated PGlite instance, never production:
// opaque seats, the visitor region lock and half-room cap, the stage cap,
// kicked members staying out, and no browser role reaching any of it.
// PGLITE_DIR=<dir with @electric-sql/pglite> node scripts/test/audio-rooms-db.mjs
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(join(process.env.PGLITE_DIR||'/tmp/hu-qa/node_modules','package.json'));
const { PGlite }=require('@electric-sql/pglite');
const db = new PGlite();
for (const path of ['supabase/tests/supabase_api_roles.stub.sql','supabase/pending/20261019235000_network_sfu_audio_rooms.sql']) {
  const sql = await readFile(new URL('../../'+path, import.meta.url), 'utf8');
  await db.exec(sql.replace(/create extension if not exists pgcrypto;/gi,'').replace(/notify pgrst, 'reload schema';/,''));
}
const q = async (s, p=[]) => (await db.query(s, p)).rows;
const one = async (s,p) => Object.values((await q(s,p))[0])[0];
async function err(s, p, code){ let e=null; try { await db.query(s,p); } catch(x){ e=x; } assert.ok(e, 'expected '+code+' from '+s); assert.equal(e.code, code, e.message); return e.message; }
const HOST='22222222-2222-4222-8222-222222222222', A='33333333-3333-4333-8333-333333333333', B='44444444-4444-4444-8444-444444444444', C='55555555-5555-4555-8555-555555555555';
const r = await one(`insert into network_audio_rooms(host_m_uid,title,category_key,country_code,max_listeners,max_speakers) values ($1,'t','community','US',5,2) returning id`,[HOST]);
const host = await one(`select network_audio_join_room($1,$2)`,[r,HOST]);
const a = await one(`select network_audio_join_room($1,$2)`,[r,A]);
assert.equal(await one(`select network_audio_join_room($1,$2)`,[r,A]), a, 'rejoin keeps the seat');
assert.equal(await one(`select role from network_audio_members where participant_id=$1`,[host]), 'host');
// visitors: region lock, unknown country, half-room cap
await err(`select network_audio_join_visitor($1,'FR')`,[r],'AU403');
await err(`select network_audio_join_visitor($1,null)`,[r],'AU403');
const v1 = await one(`select network_audio_join_visitor($1,'US')`,[r]);
const v2 = await one(`select network_audio_join_visitor($1,'US')`,[r]);
await err(`select network_audio_join_visitor($1,'US')`,[r],'AU409'); // 5/2 = 2 visitor seats
assert.deepEqual(await q(`select m_uid,expires_at is not null as exp from network_audio_members where participant_id=$1`,[v1]), [{m_uid:null,exp:true}]);
// a lapsed visitor frees its seat and is swept on the next visitor join
await q(`update network_audio_members set last_seen_at=now()-interval '3 minutes' where participant_id=$1`,[v1]);
const v3 = await one(`select network_audio_join_visitor($1,'US')`,[r]);
assert.equal(await one(`select count(*)::int from network_audio_members where participant_id=$1`,[v1]), 0, 'lapsed visitor swept');
// counts: host on stage, A listener, v2 v3 visitors
assert.deepEqual(await q(`select speakers::int,listeners::int,visitors::int from network_audio_seat_counts($1)`,[r]), [{speakers:1,listeners:3,visitors:2}]);
// room full for members now (1+3 = 4 < 5 ok for B, then C full)
const b = await one(`select network_audio_join_room($1,$2)`,[r,B]);
await err(`select network_audio_join_room($1,$2)`,[r,C],'AU409');
// visitors cannot be promoted, a visitor row cannot hold a mic or a hand
await err(`select network_audio_assign_speaker($1,$2,$3,true)`,[r,HOST,v2],'AU403');
await err(`update network_audio_members set hand_raised_at=now() where participant_id=$1`,[v2],'23514');
await err(`update network_audio_members set role='speaker' where participant_id=$1`,[v2],'23514');
// non-host cannot assign; host cannot demote self
await err(`select network_audio_assign_speaker($1,$2,$3,true)`,[r,A,b],'AU403');
await err(`select network_audio_assign_speaker($1,$2,$3,false)`,[r,HOST,host],'AU403');
// hand raise then promotion clears the hand and leaves the mic muted; stage cap 2
await q(`update network_audio_members set hand_raised_at=now() where participant_id=$1`,[a]);
assert.equal(await one(`select network_audio_assign_speaker($1,$2,$3,true)`,[r,HOST,a]), 'speaker');
assert.deepEqual(await q(`select role,muted,hand_raised_at from network_audio_members where participant_id=$1`,[a]), [{role:'speaker',muted:true,hand_raised_at:null}]);
await err(`update network_audio_members set hand_raised_at=now() where participant_id=$1`,[a],'23514');
await err(`select network_audio_assign_speaker($1,$2,$3,true)`,[r,HOST,b],'AU409');
// kicked member cannot rejoin
await q(`update network_audio_members set status='kicked' where participant_id=$1`,[b]);
await err(`select network_audio_join_room($1,$2)`,[r,B],'AU403');
// a member who left rejoins into the same seat, muted, hand down
await q(`update network_audio_members set status='left' where participant_id=$1`,[a]);
assert.equal(await one(`select network_audio_join_room($1,$2)`,[r,A]), a);
// subscriptions between participants; deleting a visitor cascades its subscriptions
await q(`insert into network_audio_subscriptions(room_id,listener_participant_id,publisher_participant_id,sfu_session_id) values ($1,$2,$3,'sess-one')`,[r,v2,host]);
await err(`insert into network_audio_subscriptions(room_id,listener_participant_id,publisher_participant_id,sfu_session_id) values ($1,$2,$3,'sess-two')`,[r,v2,host],'23505');
await q(`delete from network_audio_members where participant_id=$1`,[v2]);
assert.equal(await one(`select count(*)::int from network_audio_subscriptions`), 0);
// directory: counts, country filter, ended rooms hidden
const dir = await q(`select id,speakers::int,listeners::int,host_m_uid from network_audio_directory('US',null)`);
assert.equal(dir.length,1); assert.equal(dir[0].speakers,1);
assert.equal((await q(`select * from network_audio_directory('FR',null)`)).length,0);
// a room with no country is closed to visitors; visitors_may_listen=false too
const g = await one(`insert into network_audio_rooms(host_m_uid,title,category_key) values ($1,'g','community') returning id`,[HOST]);
await err(`select network_audio_join_visitor($1,'US')`,[g],'AU403');
const nv = await one(`insert into network_audio_rooms(host_m_uid,title,category_key,country_code,visitors_may_listen) values ($1,'n','community','US',false) returning id`,[HOST]);
await err(`select network_audio_join_visitor($1,'US')`,[nv],'AU403');
await q(`update network_audio_rooms set status='ended' where id=$1`,[r]);
assert.equal((await q(`select * from network_audio_directory('US',null)`)).length,1);
await err(`select network_audio_join_visitor($1,'US')`,[r],'AU404');
// grants: anon/authenticated have nothing
for (const role of ['anon','authenticated']) for (const fn of ['network_audio_join_visitor(uuid,text)','network_audio_directory(text,uuid)','network_audio_join_room(uuid,uuid)'])
  assert.equal(await one(`select has_function_privilege($1,$2,'execute')`,[role,fn]), false, role+' '+fn);
assert.equal(await one(`select has_table_privilege('anon','network_audio_members','select')`), false);
// the API roles are refused even though Supabase grants new functions to them by default
for (const role of ['anon','authenticated']) {
  await db.exec('set role '+role);
  await err(`select * from network_audio_directory(null,null)`,[],'42501');
  await err(`select network_audio_join_visitor($1,'US')`,[g],'42501');
  await err(`select * from network_audio_members`,[],'42501');
  await db.exec('reset role');
}
await db.close();
console.log('PASS: audio seats, visitor region lock and cap, stage cap, kicked members stay out, browser roles refused');
