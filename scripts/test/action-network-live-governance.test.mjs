import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (p) => fs.readFile(new URL('../../' + p, import.meta.url), 'utf8');
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);

test('Live governance keeps room, grant and stage vocabulary intentionally small', async () => {
  const sql = await read('supabase/migrations/20261003233747_action_network_live_governance_v1.sql');
  assert.match(sql, /basis text not null check\(basis in\('cohort','client_project','staff'\)\)/i);
  assert.match(sql, /room_kind text not null check\(room_kind in\('home','mission'\)\)/i);
  assert.match(sql, /stage_role text not null check\(stage_role in\('cohost','guest'\)\)/i);
  assert.doesNotMatch(sql, /stage_role[^\n]*(moderator|artist|expert|fan|challenger|participant)/i);
  for (const key of ['music','build','learn','field','forum']) {
    assert.match(sql, new RegExp("\\('" + key + "'"));
  }
  assert.match(sql, /support_allowed boolean not null default false/i);
  assert.match(sql, /support_enabled boolean not null default false/i);
});

test('Accepted fellowship is not itself a live-broadcast entitlement', async () => {
  const sql = await read('supabase/migrations/20261003233747_action_network_live_governance_v1.sql');
  const start = sql.indexOf('create or replace function public.live_host_context()');
  const end = sql.indexOf('create or replace function public.live_can_host()', start);
  const fn = sql.slice(start, end);
  assert.match(fn, /network_live_host_grants/);
  assert.match(fn, /action_cohort_members/);
  assert.match(fn, /org_members/);
  assert.doesNotMatch(fn, /action_fellowship_applications/);
  assert.match(fn, /eu_is_admin/);
});

test('Live discovery score is evidence-based, sample-aware and money-free', async () => {
  const sql = await read('supabase/migrations/20261003233747_action_network_live_governance_v1.sql');
  assert.match(sql, /private\.live_wilson_lower_bound/);
  const start = sql.indexOf('create or replace function public.network_live_session_metrics');
  const end = sql.indexOf('revoke all on function public.network_live_session_metrics', start);
  const fn = sql.slice(start, end);
  assert.match(fn, /c\.verified/);
  assert.match(fn, /v\.unique_viewers/);
  assert.match(fn, /v\.engaged_viewers/);
  assert.match(fn, /verified_actions_per_viewer/);
  assert.match(fn, /engaged_viewers_60s/);
  assert.doesNotMatch(fn, /support|credit|payment|tip|gift/i);
});

test('A live Mission join preserves live first-touch through verified completion', async () => {
  const sql = await read('supabase/migrations/20261003233747_action_network_live_governance_v1.sql');
  assert.match(sql, /add column source_live_session_id uuid references public\.network_live_sessions/);
  assert.match(sql, /create or replace function public\.join_action_mission_live/);
  assert.match(sql, /source_live_session_id=p_live_session_id/);
  assert.match(sql, /v_prior_status is null or\(v_prior_status='withdrawn' and v_prior_source is null\)/);
  assert.match(sql, /'source_live_session_id',new\.source_live_session_id/);
  assert.match(sql, /grant execute on function public\.join_action_mission_live\(uuid,uuid\) to authenticated,service_role/i);
});

test('Every current catalogue song is a first-class live discovery object', async () => {
  const [sql, raw] = await Promise.all([
    read('supabase/migrations/20261003233747_action_network_live_governance_v1.sql'),
    read('data/albums.json')
  ]);
  const albums = JSON.parse(raw).albums || [];
  let count = 0;
  for (const album of albums) {
    for (const track of album.tracks || []) {
      count += 1;
      const key = album.slug + ':' + slug(track.title);
      assert.ok(sql.includes("'" + key.replaceAll("'", "''") + "'"), 'missing music catalog object ' + key);
    }
  }
  assert.equal(count, 20);
  assert.match(sql, /music_object_id uuid references public\.music_catalog_objects/);
  assert.match(sql, /canonical_url text not null check\(canonical_url~'\^https:\/\/'\)/i);
});

test('Action Network is live-first without pretending multi-seat video is active', async () => {
  const [html, js, live, worker] = await Promise.all([
    read('mnet.html'), read('js/mnet.js'), read('js/mnet-live.js'), read('workers/mccluster/src/platform-api.js')
  ]);
  assert.match(js, /currentView:\s*"live"/);
  assert.match(html, /class="is-active" data-mn-view="live">Live</);
  assert.match(html, /id="mnFeedView" hidden/);
  assert.match(html, /data-live-kind="mission"/);
  assert.match(html, /data-live-kind="home"/);
  for (const key of ['music','build','learn','field','forum']) assert.match(html, new RegExp('data-live-category="' + key + '"'));
  assert.match(live, /\/v1\/mnet\/live\/directory/);
  assert.match(live, /\/v1\/mnet\/live\/options/);
  assert.match(live, /\/watch/);
  assert.doesNotMatch(live, /network_live_sessions\?select=/);
  assert.match(worker, /multi_seat_ready:false/);
  assert.match(html, /Multi-seat video is not switched on yet/i);
});

test('Control grants and revokes scoped live capability from the fellowship desk', async () => {
  const control = await read('js/control-room/action-network.js');
  assert.match(control, /\/v1\/mnet\/live\/admin\/grants/);
  assert.match(control, /basis:"cohort"/);
  assert.match(control, /data-live-category/);
  assert.match(control, /Revoke live access/);
  assert.match(control, /support remains off/i);
});

test('The live client carries a live-session source into canonical mission joining', async () => {
  const js = await read('js/mnet.js');
  assert.match(js, /join_action_mission_live/);
  assert.match(js, /p_live_session_id:missions\.liveSession/);
  assert.match(js, /openMissionFromLive/);
  assert.match(js, /live_session:missions\.liveSession\|\|null/);
});
