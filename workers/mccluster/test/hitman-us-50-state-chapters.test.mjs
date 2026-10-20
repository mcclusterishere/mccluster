import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chapters = JSON.parse(readFileSync(new URL('../../../data/prim3/hitman-us-50-state-chapters.v0.1.json', import.meta.url), 'utf8'));
const core = JSON.parse(readFileSync(new URL('../../../data/prim3/house-agent-us-cohort.v1.json', import.meta.url), 'utf8'));
const expectedStates = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const blue = new Set('CA CO CT DE HI IL ME MD MA MN NH NJ NM NY OR RI VT VA WA'.split(' '));
const immediate = new Set(core.accounts.map(x => x.display_name.toLowerCase()));

test('all fifty states exist exactly once, with no D.C. captain and no duplicate identities', () => {
  assert.equal(chapters.chapters.length, 50);
  assert.deepEqual(chapters.chapters.map(c => c.state_code), expectedStates);
  assert.equal(new Set(chapters.chapters.map(c => c.character_id)).size, 50);
  assert.equal(new Set(chapters.chapters.map(c => c.leader.name)).size, 50);
  assert.equal(new Set(chapters.chapters.map(c => c.system_account.handle)).size, 50);
  assert.equal(new Set(chapters.chapters.map(c => c.crew.name)).size, 50);
  assert.equal(chapters.national_hierarchy.federal_district.includes('no 51st'), true);
});

test('2024 statewide presidential results produce exactly 31 fictional red and 19 fictional blue chapters', () => {
  assert.equal(chapters.political_reference.red_state_count, 31);
  assert.equal(chapters.political_reference.blue_state_count, 19);
  for (const c of chapters.chapters) {
    const isBlue = blue.has(c.state_code);
    assert.equal(c.electoral_reference.color, isBlue ? 'blue' : 'red', c.state_code);
    assert.equal(c.electoral_reference.winner_party, isBlue ? 'Democratic' : 'Republican', c.state_code);
    assert.equal(c.fictional_political_structure.form,
      isBlue ? 'emerging_street_coalition' : 'established_legacy_syndicate', c.state_code);
    assert.equal(c.fictional_political_structure.development,
      isBlue ? 'emerging_fragmented' : 'entrenched_developed', c.state_code);
  }
  assert.equal(chapters.chapters.find(c => c.state_code === 'ME').electoral_reference.color, 'blue');
  assert.equal(chapters.chapters.find(c => c.state_code === 'NE').electoral_reference.color, 'red');
  assert.match(chapters.political_reference.disclaimer, /NOT a factual statement/i);
});

test('every captain is a separate, region-tagged fictional character leading a bounded small crew', () => {
  for (const c of chapters.chapters) {
    assert.match(c.character_id, /^hitman-[a-z]{2}-[a-z-]+$/);
    assert.equal(immediate.has(c.leader.name.toLowerCase()), false, c.leader.name + ' is already immediate cast');
    assert.equal(c.leader.function, 'leader_of_state_hitman_chapter');
    assert.ok(c.leader.personality.length >= 12, c.state_code);
    assert.ok(c.leader.story_mission.length >= 20, c.state_code);
    assert.ok(c.leader.editorial_mission.length >= 20, c.state_code);
    assert.ok(c.leader.inner_conflict.length >= 12, c.state_code);
    assert.ok(c.leader.series.length >= 8, c.state_code);
    assert.ok(c.crew.proposed_total_people >= 4 && c.crew.proposed_total_people <= 7, c.state_code);
    assert.equal(c.crew.slots.length, c.crew.proposed_total_people, c.state_code);
    assert.equal(c.story_geography.region_key, 'US-' + c.state_code);
    assert.equal(c.story_geography.classification, 'fictional_chapter_jurisdiction_not_residence');
    assert.equal(c.story_geography.locality, null);
    assert.equal(c.story_geography.city, null);
    assert.equal(c.story_geography.real_world_presence, false);
    assert.equal(c.story_geography.public_pin_approved, false);
  }
});

test('rivalries are fictional, symmetric and point only to real chapter codes', () => {
  const byState = new Map(chapters.chapters.map(c => [c.state_code, c]));
  let edges = 0;
  for (const c of chapters.chapters) {
    assert.equal(new Set(c.rival_state_codes).size, c.rival_state_codes.length);
    for (const opponent of c.rival_state_codes) {
      assert.notEqual(opponent, c.state_code, c.state_code);
      assert.ok(byState.has(opponent), c.state_code + '-' + opponent);
      assert.ok(byState.get(opponent).rival_state_codes.includes(c.state_code), c.state_code + '-' + opponent);
      edges++;
    }
  }
  assert.equal(edges / 2, 30);
});

test('no state actor becomes a real human, activated Core agent, or public profile merely by being mapped', () => {
  for (const c of chapters.chapters) {
    const a = c.system_account;
    assert.equal(a.identity_kind, 'fictional_character');
    assert.equal(a.status, 'proposed_not_provisioned');
    assert.equal(a.agent_status, 'specified_not_running');
    assert.equal(a.published, false);
    assert.equal(a.verified_human, false);
    assert.equal(a.autonomous_spend_cents, 0);
    assert.equal(a.scheduled_publishing, false);
    assert.equal(a.auto_reply, false);
    assert.equal(a.requires_owner_review, true);
    assert.match(a.disclosure, /Fictional PRIM3/);
    assert.match(a.agent_id, new RegExp('hitman-us-' + c.state_code.toLowerCase() + '$'));
  }
  assert.match(chapters.scope, /not live user accounts/i);
  assert.ok(chapters.global_prohibitions.some(s => /No GPS/.test(s)));
  assert.equal(chapters.national_hierarchy.new_captains_status, 'satellite_development_cast_not_39_immediate_recurring_cast');
});

test('new fifty state captains do not overwrite the thirteen existing house specifications', () => {
  assert.equal(core.accounts.length, 13);
  assert.equal(core.cohort_size, 13);
  assert.ok(core.accounts.find(x => x.character_id === 'royce'));
  assert.ok(core.accounts.find(x => x.character_id === 'mccluster'));
  assert.equal(chapters.national_hierarchy.existing_hitman_immediate_cast_count, 12);
  assert.equal(chapters.national_hierarchy.sovereign, 'Royce');
});


test('pending SQL prepares all fifty chapters as private drafts, not a public feed or fake human roster', () => {
  const sql = readFileSync(new URL('../../../supabase/pending/20261019213000_hitman_us_50_state_chapters_v1.sql', import.meta.url), 'utf8');
  assert.equal((sql.match(/"character_id":/g) || []).length, 50);
  assert.match(sql, /public\.house_system_accounts/);
  assert.match(sql, /from public\.action_globe_regions r where r\.region_key = s\.story_region_key/);
  assert.match(sql, /'draft', false, false, false, false, false, 0, 0, null/);
  assert.match(sql, /on conflict \(org_id, character_id\) do nothing/);
  assert.match(sql, /'execution_enabled', false/);
  assert.match(sql, /'max_autospend_cents', 0/);
  assert.doesNotMatch(sql, /\binsert into public\.(m_people|network_posts|social_publish_jobs|action_missions)/i);
  assert.doesNotMatch(sql, /\b(account_status\s*=\s*'published'|external_publish_enabled\s*=\s*true)\b/i);
});
