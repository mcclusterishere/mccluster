import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../../'+path,import.meta.url),'utf8');
test('public globe exposes regional rather than city-level member data',()=>{
 const globe=read('js/action-globe.js');
 assert.match(globe,/action_globe_public_regions/);
 assert.match(globe,/action_globe_public_region_missions/);
 assert.doesNotMatch(globe,/action_globe_public_cities|action_globe_public_missions/);
 const migration=read('supabase/migrations/20261013233000_action_globe_regions.sql');
 assert.match(migration,/having count\(m\.m_uid\)>=5/);
 assert.match(migration,/verified_at is not null/);
 assert.match(migration,/dense_rank\(\) over \(partition by s\.country_code/);
 assert.match(migration,/revoke all on public\.action_globe_regions/);
});
test('globe location is opt-in and not uploaded',()=>{
 const globe=read('js/action-globe.js');
 assert.match(globe,/nearMe'\)\.onclick/);
 assert.match(globe,/getCurrentPosition/);
 assert.doesNotMatch(globe,/watchPosition|sendBeacon/);
 assert.match(globe,/OpenStreetMapImageryProvider/);
});
test('player links to song-specific approved mission portfolio',()=>{
 const player=read('js/music-engine.js');
 assert.match(player,/See this song's impact/);
 assert.match(player,/action-globe\.html\?song=/);
 const globe=read('js/action-globe.js');
 assert.match(globe,/requestedSong/);
 assert.match(globe,/No approved regional missions are linked/);
});

test('regional mission joining is enforced by canonical database RPC, not the UI',()=>{
 const join=read('supabase/migrations/20261014120000_action_globe_join_authorization.sql');
 assert.match(join,/create or replace function public\.join_action_mission\(p_mission_id uuid\)/i);
 assert.match(join,/public\.current_m_uid\(\)/);
 assert.match(join,/public\.action_globe_can_join_mission\(v_m_uid, p_mission_id\)/);
 assert.match(join,/raise exception 'regional mission not eligible for this member'/);
 assert.match(join,/for update/);
 assert.match(join,/v_mission\.capacity/);
 const activation=read('supabase/migrations/20261014040000_action_globe_region_activation.sql');
 assert.match(activation,/revoke all on function public\.action_globe_can_join_mission\(uuid,uuid\) from public,anon,authenticated/i);
 assert.match(activation,/grant execute on function public\.action_globe_can_join_mission\(uuid,uuid\) to service_role/i);
});
