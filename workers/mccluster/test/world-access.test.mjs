/* The World's access map (owner, 2026-10-15): one free layer for a guest,
   every other layer listed locked with a reason and a next step; levels only
   from what can be verified today; ladder rules are hooks that grant nothing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleWorldAccess, LAYER_RULES, LEVELS, WHIP_DRIVER_SIGNUP_URL } from '../src/world-access.js';

const UID = '11111111-1111-4111-8111-111111111111', MUID = '99999999-9999-4999-8999-999999999999';
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'k', ALLOWED_ORIGINS: 'https://mccluster.org' };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const req = (token) => new Request('https://api.mccluster.org/v1/world/access', { headers: { origin: 'https://mccluster.org', ...(token ? { authorization: 'Bearer ' + token } : {}) } });
function db({ creator = false, owner = false, privacy = false, mission = false } = {}) {
  return async (url, init = {}) => {
    const u = String(url), h = new Headers(init.headers || {});
    if (u === 'https://sb.test/auth/v1/user') return h.get('authorization') === 'Bearer t' ? json({ id: UID, user_metadata: privacy ? { privacy_policy_version: '2026-10-19', privacy_acknowledged_at: '2026-10-01T00:00:00Z' } : {} }) : json({}, 401);
    if (u.includes('/m_auth_user_links')) return json([{ m_uid: MUID }]);
    if (u.includes('/music_creator_profiles')) return json(creator ? [{ handle: 'x' }] : []);
    if (u.includes('/orgs?')) return json([{ id: 'house' }]);
    if (u.includes('/org_members')) return json(owner ? [{ role: 'owner' }] : []);
    if (u.includes('/world_location_consents')) throw new Error('no location-consent table any more');
    if (u.includes('/action_mission_assignments')) { assert.match(u, /status=eq\.verified/); assert.match(u, /action_missions!inner\(kind\)&action_missions\.or=\(kind\.is\.null,kind\.neq\.clip\)/); return json(mission ? [{ id: '22222222-2222-4222-8222-222222222222' }] : []); }
    throw new Error('unexpected ' + u);
  };
}
const ids = (b) => b.locked_layers.map((l) => l.id);

test('guest, member and creator/business have no optional globe layers', async () => {
  for (const [token, options] of [[null, {}], ['t', {}], ['t', { creator:true, privacy:true, mission:true }]]) {
    const r=await handleWorldAccess(req(token), ENV, {fetchImpl:db(options)});
    assert.equal(r.headers.get('cache-control'),'private, no-store');
    const b=await r.json();assert.deepEqual(b.unlocked_layers,[]);
    assert.deepEqual(ids(b).sort(),Object.keys(LAYER_RULES).sort());
    assert.ok(b.locked_layers.every(x=>x.reason==='admin_preview'&&x.next_step===null));
    assert.equal(b.release.admin_preview,false);
  }
});
test('owner preview preserves independent CCTV prerequisites and withdrawal', async () => {
  let b=await (await handleWorldAccess(req('t'),ENV,{fetchImpl:db({owner:true})})).json();
  assert.ok(b.unlocked_layers.includes('flights'));assert.ok(!b.unlocked_layers.includes('cctv'));
  b=await (await handleWorldAccess(req('t'),{...ENV,WORLD_GLOBE_WITHDRAWN:'flights,cctv'},{fetchImpl:db({owner:true,privacy:true,mission:true})})).json();
  assert.ok(!b.unlocked_layers.includes('flights'));assert.ok(!b.unlocked_layers.includes('cctv'));
  assert.equal(b.locked_layers.find(x=>x.id==='flights').reason,'feature_withdrawn');
  assert.equal(b.layers.transport.operator,'Whip Equipped LLC');
  assert.equal(b.layers.transport.driver_signup_url,WHIP_DRIVER_SIGNUP_URL);
});

test('the access map carries the IP-derived approximate location, never 0,0', async () => {
  const r = new Request('https://api.mccluster.org/v1/world/access', { headers: { origin: 'https://mccluster.org' } });
  Object.defineProperty(r, 'cf', { value: { country: 'US', region: 'Connecticut', city: 'New Haven', latitude: '41.3083', longitude: '-72.9279' } });
  const b = await (await handleWorldAccess(r, ENV, { fetchImpl: db() })).json();
  assert.deepEqual(b.approximate_location, { source: 'ip_approximate', country: 'US', region: 'Connecticut', city: 'New Haven', lat: 41.3, lon: -72.9 });
  const z = new Request('https://api.mccluster.org/v1/world/access');
  Object.defineProperty(z, 'cf', { value: { country: 'US', latitude: '0', longitude: '0' } });
  const zb = await (await handleWorldAccess(z, ENV, { fetchImpl: db() })).json();
  assert.equal(zb.approximate_location.lat, undefined);
});

test('creator and owner come from records; E=Up and fellow are never granted yet', async () => {
  assert.equal((await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db({ creator: true }) })).json()).level, 'creator_business');
  const o = await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db({ owner: true }) })).json();
  assert.equal(o.level, 'owner');
  assert.ok(o.unlocked_layers.includes('transport'));
  assert.deepEqual(LEVELS, ['public', 'fan', 'creator_business', 'eup', 'fellow', 'owner']);
  const src = await readFile(new URL('../src/world-access.js', import.meta.url), 'utf8');
  assert.match(src, /eup: async \(\) => false/); assert.match(src, /fellow: async \(\) => false/); assert.doesNotMatch(src, /fellowTransport/);
  assert.equal(LAYER_RULES.transport.operator, 'Whip Equipped LLC');
});

test('routed in index.js', async () => {
  const src = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /path === '\/v1\/world\/access'/);
});

test('Halo feeds, place search, Halo operations and water levels are listed with their labels: locked for everyone but the owner, withdrawable', async () => {
  const HALO = { military: 'Military flights', quakes: 'Earthquakes', fires: 'Active fires', perimeters: 'Wildfire perimeters', cyclones: 'Tropical cyclones', vessels: 'Ships (AIS)', search: 'Place search', 'halo-ops': 'Missions and people', tides: 'Coastal water levels' };
  for (const [id, label] of Object.entries(HALO)) assert.deepEqual(LAYER_RULES[id], { min: 'fan', label }, id);
  for (const [token, options] of [[null, {}], ['t', {}], ['t', { creator: true }]]) {
    const b = await (await handleWorldAccess(req(token), ENV, { fetchImpl: db(options) })).json();
    for (const id of Object.keys(HALO)) assert.deepEqual(b.locked_layers.find((l) => l.id === id), { id, reason: 'admin_preview', next_step: null });
  }
  const owner = await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db({ owner: true }) })).json();
  for (const id of Object.keys(HALO)) assert.ok(owner.unlocked_layers.includes(id), id);
  const withdrawn = await (await handleWorldAccess(req('t'), { ...ENV, WORLD_GLOBE_WITHDRAWN: 'fires,search' }, { fetchImpl: db({ owner: true }) })).json();
  assert.equal(withdrawn.locked_layers.find((l) => l.id === 'fires').reason, 'feature_withdrawn');
  assert.equal(withdrawn.locked_layers.find((l) => l.id === 'search').reason, 'feature_withdrawn');
  assert.ok(withdrawn.unlocked_layers.includes('military'));
});
