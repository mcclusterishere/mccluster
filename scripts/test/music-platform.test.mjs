import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(p)=>readFile(p,'utf8');
const json=async(p)=>JSON.parse(await read(p));

test('gated single is one logical track with signed-out preview and signed-in full asset', async()=>{
  const albums=await json('data/albums.json');
  const album=albums.albums.find(a=>a.slug==='cia-mind-control');
  const track=album.tracks.find(t=>t.title==='Niggy Nigg Niggr');
  assert.ok(track,'gated track must remain in the canonical album catalog');
  assert.equal(track.gated.bucket,'mcc-gated-audio');
  assert.equal(track.gated.object,'niggy-nigg/niggy-nigg.mp3');
  assert.equal(track.gated.access_mode,'account');
  assert.equal(track.gated.preview_visibility,'signed_out_only');
  assert.equal(track.gated.full_visibility,'signed_in');
  assert.deepEqual(track.gated.formats.map(f=>f.ext),['mp3','m4r']);
  assert.equal(track.gated.formats.find(f=>f.ext==='m4r').object,'niggy-nigg/niggy-nigg.m4r');
});

test('signed-in album gate never arms the public preview while the master resolves', async()=>{
  const album=await read('album.html');
  assert.match(album,/function hasStoredSession\(\)/);
  assert.match(album,/function paintGateOpening\(row\)/);
  assert.match(album,/row\.setAttribute\("data-src", ""\)/);
  assert.match(album,/if \(signed\) paintGateOpening\(row\);\s*\n\s*else paintGate\(row, \{ state: "preview" \}\);/);
});

test('discovery has one persistent transport and inline play controls', async()=>{
  const html=await read('listen.html');
  const listen=await read('js/listen.js');
  const engine=await read('js/music-engine.js');
  assert.match(html,/js\/music-engine\.js/);
  assert.match(html,/js\/music-community\.js/);
  assert.match(html,/js\/gated-audio\.js/);
  assert.match(listen,/data-music-play/);
  assert.match(listen,/music-inline-play/);
  assert.match(engine,/var audio = new Audio\(\)/);
  assert.match(engine,/id = "musicMini"/);
  assert.match(engine,/MCC_GATED\.resolve/);
  assert.match(engine,/music_preview_play/);
  assert.match(engine,/music_full_play/);
});

test('creator system reuses M identity and keeps masters private', async()=>{
  const migration=await read('supabase/migrations/20260920041011_music_creator_platform_v1.sql');
  const studio=await read('js/music-creator-studio.js');
  assert.match(migration,/music_creator_profiles/);
  assert.match(migration,/m_uid uuid primary key references public\.m_people/);
  assert.match(migration,/creator-masters','creator-masters',false/);
  assert.match(migration,/creator-previews','creator-previews',true/);
  assert.match(migration,/access_mode in \('public','account','purchase'\)/);
  assert.match(migration,/status in \('draft','pending_review','approved','published','rejected','archived'\)/);
  assert.match(studio,/window\.MCC\.mUid\(\)/);
  assert.match(studio,/creator-upload-url/);
  assert.match(studio,/music_rights_attestations/);
  assert.match(studio,/status: "pending_review"/);
});

test('derivative and parody releases cannot self-clear commercial rights', async()=>{
  const studio=await read('js/music-creator-studio.js');
  const access=await read('supabase/functions/music-access/index.ts');
  const terms=await read('music-creator-terms.html');
  assert.match(studio,/parody_or_derivative/);
  assert.match(studio,/derivativePermissions/);
  assert.match(access,/operator-review/);
  assert.match(access,/patch\.rights_status = "cleared"/);
  assert.match(access,/operator permission required/);
  assert.match(terms,/does not automatically clear it for commercial licensing/i);
});

test('music licensing creates native orders and entitlements and refunds revoke them', async()=>{
  const commerce=await read('supabase/migrations/20260920041250_music_commerce_v1.sql');
  const checkout=await read('supabase/functions/music-checkout/index.ts');
  const webhook=await read('supabase/functions/stripe-webhook/index.ts');
  assert.match(commerce,/create table if not exists public\.music_orders/);
  assert.match(commerce,/create table if not exists public\.music_entitlements/);
  assert.match(commerce,/platform_fee_bps/);
  assert.match(checkout,/music_license_sale/);
  assert.match(checkout,/track\.rights_status !== "cleared"/);
  assert.match(webhook,/grantMusicOrder/);
  assert.match(webhook,/music_entitlements/);
  assert.match(webhook,/charge\.refunded/);
  assert.match(webhook,/revoked_at/);
});

test('public creator profiles play in-place and can enter first-party checkout', async()=>{
  const page=await read('music-creator.html');
  const profile=await read('js/music-creator-profile.js');
  assert.match(page,/js\/music-engine\.js/);
  assert.match(profile,/registerCreatorTrack/);
  assert.match(profile,/data-music-play/);
  assert.match(profile,/music-checkout/);
  assert.match(profile,/offer_id/);
});

test('operator review desk is gated by existing ops authority', async()=>{
  const page=await read('music-admin.html');
  const js=await read('js/music-admin.js');
  const access=await read('supabase/functions/music-access/index.ts');
  assert.match(page,/Operator only/);
  assert.match(js,/operator-status/);
  assert.match(js,/operator-review/);
  assert.match(js,/operator-license/);
  assert.match(access,/houseOps\(who\.user\.id\)/);
  assert.match(access,/ops\.use/);
});
