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
