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
    if (u === 'https://sb.test/auth/v1/user') return h.get('authorization') === 'Bearer t' ? json({ id: UID, user_metadata: privacy ? { privacy_policy_version: '2026-09-26', privacy_acknowledged_at: '2026-10-01T00:00:00Z' } : {} }) : json({}, 401);
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

test('a guest: exactly one free layer (Flights); every other layer listed, locked, with a sign-in next step', async () => {
  const r = await handleWorldAccess(req(null), ENV, { fetchImpl: db() });
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  const b = await r.json();
  assert.equal(b.level, 'public');
  assert.deepEqual(b.unlocked_layers, ['flights']);
  assert.deepEqual(ids(b).sort(), Object.keys(LAYER_RULES).filter((k) => k !== 'flights').sort());
  for (const l of b.locked_layers.filter((x) => LAYER_RULES[x.id].min === 'fan')) { assert.equal(l.reason, 'sign_in_required'); assert.equal(l.next_step, 'sign_in'); }
});

test('a fan: satellites, launches, music, Whip transport; CCTV locked until the privacy acknowledgement and a mission; audience needs a creator', async () => {
  let b = await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db() })).json();
  assert.equal(b.level, 'fan');
  assert.deepEqual(b.unlocked_layers, ['flights', 'satellites', 'launches', 'intel', 'music', 'transport']);
  assert.deepEqual(b.locked_layers.find((l) => l.id === 'cctv'), { id: 'cctv', reason: 'privacy_acknowledgement_required', next_step: 'acknowledge_privacy' });
  assert.equal(b.locked_layers.find((l) => l.id === 'audience').reason, 'creator_business_required');
  b = await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db({ privacy: true }) })).json();
  assert.equal(b.locked_layers.find((l) => l.id === 'cctv').reason, 'mission_required');
  b = await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db({ privacy: true, mission: true }) })).json();
  assert.ok(b.unlocked_layers.includes('cctv'));
});

test('Whip Equipped transport: open to any signed-in member, rides not live, a driver sign-up link, Whip Equipped LLC only', async () => {
  const guest = await (await handleWorldAccess(req(null), ENV, { fetchImpl: db() })).json();
  assert.deepEqual(guest.locked_layers.find((l) => l.id === 'transport'), { id: 'transport', reason: 'sign_in_required', next_step: 'sign_in' });
  const fan = await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db() })).json();
  assert.ok(fan.unlocked_layers.includes('transport'), 'no fellowship, mission or voter gate');
  const t = fan.layers.transport;
  assert.equal(t.operator, 'Whip Equipped LLC');
  assert.equal(t.service_live, false);
  assert.equal(t.driver_signup_url, WHIP_DRIVER_SIGNUP_URL);
  assert.equal(WHIP_DRIVER_SIGNUP_URL, 'https://matthew.mccluster.org/whip/driver/');
  assert.equal(t.disabled, undefined);
  /* the Driver app is hosted on Matthew's property (DOMAINS-AND-ENTITIES.md: Whip Equipped LLC at whip.html); no McCluster name in its copy */
  assert.doesNotMatch(JSON.stringify({ ...t, driver_signup_url: undefined }), /McCluster/i, 'no McCluster branding on the Whip layer');
  const src = await readFile(new URL('../src/world-access.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /voter|registration|fellow_transport|pending_counsel/i);
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
