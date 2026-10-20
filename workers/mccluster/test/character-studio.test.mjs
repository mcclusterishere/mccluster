import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileCharacterBlueprint, CHARACTER_STUDIO_VERSION } from '../src/character-studio.js';
import { handleHouseAgents } from '../src/house-agents.js';

const env = { SUPABASE_URL: 'https://supabase.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' };
const brief = {
  display_name: 'Juno Ember',
  handle: 'juno-ember',
  story_world: 'Original science fiction',
  story_country: 'US',
  editorial_mission: 'Explore scientific curiosity through character-driven science fiction.',
  voice: 'Observant, warm and sharply skeptical',
  desire: 'Understand the alien signal without losing her friends',
  fear: 'Becoming an instrument of the system she investigates',
  contradiction: 'The truth seeker keeps secrets from her allies',
  appearance_direction: 'Blue work jacket, silver glasses; no licensed likeness',
  content_pillars: ['Lab journals', 'The signal', 'Friendship and trust']
};
const url = route => 'https://api.mccluster.org/v1/house-agents/owner/characters' + route;
const owner = async () => ({ id: '11111111-1111-4111-8111-111111111111' });
const request = (route, method = 'POST', body = brief) => new Request(url(route), {
  method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body)
});

test('compile is repeatable and never treats a character as a real member', () => {
  const a = compileCharacterBlueprint(brief);
  assert.deepEqual(a, compileCharacterBlueprint(brief));
  assert.equal(a.schema_version, CHARACTER_STUDIO_VERSION);
  assert.equal(a.approvals.status, 'draft');
  assert.equal(a.approvals.published, false);
  assert.equal(a.agent_contract.execution_enabled, false);
  assert.equal(a.agent_contract.max_autospend_cents, 0);
  assert.equal(a.agent_contract.tools_allowed.length, 0);
  assert.equal(a.personality.real_person_likeness, 'not_authorized');
  assert.equal(a.story_country, 'US');
  assert.equal(a.distribution_basis, 'owner_selected_story_distribution_only_not_residence');
  assert.deepEqual(a.canon_refs, []);
  assert.match(a.disclosure, /Fictional/i);
  assert.match(a.preview.social_bio, /Juno Ember/);
  assert.equal('verified_human' in a, false);
  assert.equal('region_key' in a, false);
});
test('rejects spoofed privileges, human portrayal and weak briefs', () => {
  for (const key of ['rights_verified', 'external_publish_enabled', 'm_uid', 'account_status', 'agent_contract', 'region_key']) {
    assert.throws(() => compileCharacterBlueprint({ ...brief, [key]: true }), /privileges/i, key);
  }
  assert.throws(() => compileCharacterBlueprint({ ...brief, identity_kind: 'fictional_portrayal_of_real_creator' }), /Only original fictional/);
  assert.throws(() => compileCharacterBlueprint({ ...brief, story_country: 'US-CT' }), /two-letter|characters/);
  assert.throws(() => compileCharacterBlueprint({ ...brief, editorial_mission: 'story' }), /Editorial mission/);
  assert.throws(() => compileCharacterBlueprint({ ...brief, handle: 'admin' }), /reserved/);
  assert.throws(() => compileCharacterBlueprint({ ...brief, content_pillars: ['Same', 'Same'] }), /distinct/);
  assert.throws(() => compileCharacterBlueprint({ ...brief, content_pillars: ['ok', 'yes'] }), /Content pillar/);
});
test('long creative input remains bounded, and story fields do not grant rights', () => {
  assert.throws(() => compileCharacterBlueprint({ ...brief, appearance_direction: 'a'.repeat(501) }), /Appearance direction/);
  assert.throws(() => compileCharacterBlueprint({ ...brief, voice: 'a'.repeat(281) }), /Character voice/);
  const a = compileCharacterBlueprint({ ...brief, source_ip: 'Third-party fictional universe (unverified)' });
  assert.equal(a.personality.source_ip_claim, 'Third-party fictional universe (unverified)');
  assert.equal(a.approvals.rights_verified, false);
  assert.equal(a.personality.voice_clone, 'not_authorized');
});
test('owner preview authenticates before reaching database, and performs no insert', async () => {
  const original = globalThis.fetch, methods = [];
  try {
    globalThis.fetch = async (u, opts = {}) => {
      methods.push(opts.method || 'GET');
      assert.match(String(u), /\/orgs\?/);
      return new Response(JSON.stringify([{ id: 'house-org' }]), { status: 200 });
    };
    const res = await handleHouseAgents(request('/preview'), env, { requireHouseOwner: owner });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.saved, false);
    assert.equal(data.published, false);
    assert.equal(data.model_called, false);
    assert.equal(data.blueprint.character_id, 'juno-ember');
    assert.deepEqual(methods, ['GET']);
  } finally { globalThis.fetch = original; }
});
test('owner save invokes one transactional RPC with private draft safeguards', async () => {
  const original = globalThis.fetch, requests = [];
  try {
    globalThis.fetch = async (u, opts = {}) => {
      requests.push({ url: String(u), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      if (String(u).includes('/orgs?')) return new Response(JSON.stringify([{ id: 'house-org' }]), { status: 200 });
      assert.match(String(u), /rpc\/house_character_create_draft_v1/);
      return new Response(JSON.stringify({ account_id: 'account', status: 'draft', revision: 1, published: false }), { status: 200 });
    };
    const res = await handleHouseAgents(request(''), env, { requireHouseOwner: owner });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.saved, true);
    assert.equal(data.published, false);
    assert.equal(data.agent_running, false);
    assert.equal(requests.filter(x => x.method === 'POST').length, 1);
    const posted = requests.find(x => x.method === 'POST').body;
    assert.equal(posted.p_author_id, (await owner()).id);
    assert.equal(posted.p_org_id, 'house-org');
    assert.equal(posted.p_blueprint.approvals.published, false);
    assert.equal(posted.p_blueprint.agent_contract.execution_enabled, false);
    assert.ok(requests.every(x => !/network_posts|social_publish|media_jobs|auth\/v1\/admin/.test(x.url)));
  } finally { globalThis.fetch = original; }
});
test('unauthorized user cannot preview, create or read private versions', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw Error('unauthorized database call'); };
    for (const r of [request('/preview'), request(''), request('/11111111-1111-4111-8111-111111111111/revisions', 'GET')]) {
      await assert.rejects(handleHouseAgents(r, env, { requireHouseOwner: async () => { throw Object.assign(new Error('Owner only'), { status: 403 }); } }), /Owner only/);
    }
  } finally { globalThis.fetch = original; }
});
test('version history is tenant-filtered and private', async () => {
  const original = globalThis.fetch, urls = [];
  try {
    globalThis.fetch = async u => {
      urls.push(String(u));
      return new Response(JSON.stringify(String(u).includes('/orgs?') ? [{ id: 'house-org' }] : []), { status: 200 });
    };
    const res = await handleHouseAgents(request('/11111111-1111-4111-8111-111111111111/revisions', 'GET'), env, { requireHouseOwner: owner });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.match(urls[1], /org_id=eq.house-org/);
    assert.match(urls[1], /house_character_revisions/);
  } finally { globalThis.fetch = original; }
});
test('SQL uses versioned RLS drafts and a single restricted transactional RPC', () => {
  const sql = readFileSync(new URL('../../../supabase/pending/20261019211500_character_studio_v1.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.house_character_revisions/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.house_character_revisions from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.house_character_create_draft_v1/);
  assert.match(sql, /p_org_id.*p_author_id.*p_blueprint/);
  assert.match(sql, /o\.slug = 'mccluster'/);
  assert.match(sql, /'draft', false, false, false, false, false, 0, 0, null/);
  assert.doesNotMatch(sql, /insert into public\.(?:m_people|network_posts|social_publish_jobs)/i);
});
