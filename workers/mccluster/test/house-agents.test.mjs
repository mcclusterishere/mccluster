import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicAgent, fictionalRegionCounts, parseCountry, handleHouseAgents } from '../src/house-agents.js';

const manifest = JSON.parse(readFileSync(new URL('../../../data/prim3/house-agent-us-cohort.v1.json', import.meta.url), 'utf8'));
const migration = readFileSync(new URL('../../../supabase/pending/20261019210000_house_agent_accounts_v1.sql', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
const ownerExport = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const env = { SUPABASE_URL: 'https://supabase.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role' };

test('13 first-party PRIM3 character identities each have a mission and identity disclosure', () => {
  assert.equal(manifest.cohort_size, 13);
  assert.equal(manifest.accounts.length, 13);
  assert.equal(new Set(manifest.accounts.map(a => a.handle)).size, 13);
  assert.deepEqual(new Set(manifest.accounts.map(a => a.narrative_board)), new Set(['equity_uprise','hitman']));
  for (const a of manifest.accounts) {
    assert.equal(a.system_account.lifecycle, 'proposed_not_provisioned');
    assert.equal(a.system_account.outbound_publishing, false);
    assert.equal(a.system_account.auto_reply, false);
    assert.equal(a.system_account.max_auto_spend_cents, 0);
    assert.ok(a.character_mission.length > 30);
    assert.ok(a.personality.voice);
    assert.match(a.audience_disclosure, /fictional/i);
    assert.ok(a.canon_refs.length);
    assert.equal(a.geography.verified_real_world_presence, false);
  }
});
test('location provenance is not guessed from American-sounding cast names', () => {
  assert.equal(manifest.accounts.filter(a => a.geography.public_region_key === 'US-CT').length, 1);
  const mc = manifest.accounts.find(a => a.character_id === 'mccluster');
  assert.match(mc.geography.public_region_basis, /Bridgeport/i);
  assert.equal(manifest.accounts.filter(a => a.geography.public_region_key === null).length, 12);
  assert.equal(manifest.accounts.find(a => a.character_id === 'sora-gymnast-okada').geography.country_basis, 'hitman_us_launch_cohort_proposed_story_distribution_only');
});
test('public account projection never exposes private agent instructions, rights, or member identifiers', () => {
  const row = { id: 'pub', handle: 'prim3-royce', display_name: 'Royce', identity_kind: 'fictional_character',
    narrative_board: 'hitman', country_code: 'US', region_key: null, region_label: null,
    editorial_mission: 'Lore', disclosure: 'Fictional AI performer', published_at: '2026-10-19',
    persona: { secret: 'origin' }, canon_refs: ['HIDDEN'], source_org_id: 'private', owner_email: 'private',
    m_uid: 'never', latitude: null, longitude: null };
  const output = publicAgent(row);
  assert.equal(output.actor_type, 'fictional_system_account');
  assert.equal(output.verified_human, false);
  assert.equal(output.verified_region_resident, false);
  for (const key of ['persona','canon_refs','owner_email','source_org_id','m_uid','published_at'])
    assert.equal(Object.prototype.hasOwnProperty.call(output, key), false, key);
});
test('only located published characters form map region counts, never human counts', () => {
  const p={ actor_type:'fictional_system_account', story_country:'US', latitude:41.6, longitude:-72.7,
    story_region:'US-CT', region_label:'Connecticut' };
  const res=fictionalRegionCounts([p,{...p,story_region:null,latitude:null,longitude:null},{...p,story_region:'US-NY',latitude:null}]);
  assert.deepEqual(res.countries,[{story_country:'US',fictional_system_accounts:3}]);
  assert.equal(res.regions.length,1);
  assert.equal(res.regions[0].fictional_system_accounts,1);
  assert.equal(res.regions[0].human_members,null);
  assert.equal(res.regions[0].verified_actions,null);
});
test('country query validation prevents raw PostgREST filter injection', () => {
  assert.equal(parseCountry('us'), 'US');
  assert.equal(parseCountry(null), null);
  assert.throws(()=>parseCountry('US&account_status=eq.draft'),/Invalid country/);
  assert.throws(()=>parseCountry('U'),/Invalid country/);
});
test('pending migration keeps fictional identities distinct from humans, suppresses all unapproved profiles', () => {
  assert.match(migration, /create table if not exists public\.house_system_accounts/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.house_system_accounts, public\.house_agent_drafts from public, anon, authenticated/);
  assert.match(migration, /account_status = 'published' and a\.published_at is not null/);
  assert.match(migration, /rights_verified/);
  assert.match(migration, /external_publish_enabled = false and auto_reply_enabled = false/);
  assert.doesNotMatch(migration, /insert into public\.m_people|insert into public\.network_posts/i);
});
test('canonical Worker dispatch uses real house-owner gate, not a browser/admin query flag', () => {
  assert.match(ownerExport, /export async function requireHouseOwner/);
  assert.match(entry, /handleHouseAgents\(request, env, \{ requireHouseOwner \}\)/);
  assert.doesNotMatch(entry, /\?admin=1|localStorage\.getItem\('admin'/);
});

test('public route fetches published projection only; owner fields cannot be supplied by a client', async () => {
  const original = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify([{ id:'a', handle:'prim3-royce', display_name:'Royce',
        identity_kind:'fictional_character', narrative_board:'hitman', country_code:'US',
        region_key:null, region_label:null, latitude:null, longitude:null,
        editorial_mission:'Fiction', disclosure:'Fictional performer' }]),
      {status:200,headers:{'content-type':'application/json'}});
    };
    const res = await handleHouseAgents(new Request('https://api.example.test/v1/house-agents/public?country=US'), env);
    assert.equal(res.status,200);
    const out=await res.json();
    assert.equal(out.count,1);
    assert.equal(out.accounts[0].verified_human,false);
    assert.ok(seen.every(x=>!x.includes('house_system_accounts')));
    assert.match(seen[0], /house_agent_published_world_v1/);
    assert.match(seen[0], /country_code=eq.US/);
  } finally { globalThis.fetch=original; }
});

test('unauthorized operator cannot list drafts or call the service-role database', async () => {
  const original=globalThis.fetch;
  let calls=0;
  try {
    globalThis.fetch=async()=>{ calls+=1; throw new Error('must not fetch'); };
    await assert.rejects(
      ()=>handleHouseAgents(new Request('https://api.example.test/v1/house-agents/owner'),env,{
        requireHouseOwner:async()=>{const error=new Error('Access denied');error.status=403;throw error;}
      }),
      /Access denied/
    );
    assert.equal(calls,0);
  } finally { globalThis.fetch=original; }
});

test('owner can stage a reviewed content draft but cannot trigger social or native publishing', async () => {
  const original=globalThis.fetch;
  const calls=[];
  const account='11111111-1111-4111-8111-111111111111';
  try {
    globalThis.fetch=async(url, options={})=>{
      calls.push({ url:String(url), method:options.method||'GET', body: options.body });
      const path=String(url);
      let result=[];
      if(path.includes('/orgs?'))result=[{id:'house-id'}];
      else if(path.includes('/house_system_accounts?'))result=[{id:account}];
      else if(path.endsWith('/house_agent_drafts'))result=[{id:'draft-id',account_id:account,status:'draft'}];
      return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
    };
    const res=await handleHouseAgents(new Request('https://api.example.test/v1/house-agents/owner/drafts',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account_id:account,body:'Scripted fictional character dialogue'})
    }),env,{requireHouseOwner:async()=>({id:'owner-auth-id'})});
    assert.equal(res.status,201);
    const out=await res.json();
    assert.equal(out.published,false);
    assert.equal(calls.filter(c=>c.method==='POST').length,1);
    assert.ok(calls.every(c=>!c.url.includes('/social/')&&!c.url.includes('/network_posts')));
  } finally { globalThis.fetch=original; }
});
