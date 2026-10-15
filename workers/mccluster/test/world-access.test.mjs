/* The World's access map (owner, 2026-10-15): one free layer for a guest,
   every other layer listed locked with a reason and a next step; levels only
   from what can be verified today; ladder rules are hooks that grant nothing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleWorldAccess, LAYER_RULES, LEVELS } from '../src/world-access.js';

const UID = '11111111-1111-4111-8111-111111111111', MUID = '99999999-9999-4999-8999-999999999999';
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'k', ALLOWED_ORIGINS: 'https://mccluster.org' };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const req = (token) => new Request('https://api.mccluster.org/v1/world/access', { headers: { origin: 'https://mccluster.org', ...(token ? { authorization: 'Bearer ' + token } : {}) } });
function db({ creator = false, owner = false, consent = false, mission = false } = {}) {
  return async (url, init = {}) => {
    const u = String(url), h = new Headers(init.headers || {});
    if (u === 'https://sb.test/auth/v1/user') return h.get('authorization') === 'Bearer t' ? json({ id: UID }) : json({}, 401);
    if (u.includes('/m_auth_user_links')) return json([{ m_uid: MUID }]);
    if (u.includes('/music_creator_profiles')) return json(creator ? [{ handle: 'x' }] : []);
    if (u.includes('/orgs?')) return json([{ id: 'house' }]);
    if (u.includes('/org_members')) return json(owner ? [{ role: 'owner' }] : []);
    if (u.includes('/world_location_consents')) return json(consent ? [{ granted_at: '2026-10-01', revoked_at: null }] : []);
    if (u.includes('/action_mission_assignments')) { assert.match(u, /status=eq\.verified/); return json(mission ? [{ id: '22222222-2222-4222-8222-222222222222' }] : []); }
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

test('a fan: satellites, launches, music; CCTV locked until consent and a mission; audience needs a creator; transport stays off', async () => {
  let b = await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db() })).json();
  assert.equal(b.level, 'fan');
  assert.deepEqual(b.unlocked_layers, ['flights', 'satellites', 'launches', 'intel', 'music']);
  assert.deepEqual(b.locked_layers.find((l) => l.id === 'cctv'), { id: 'cctv', reason: 'location_consent_required', next_step: 'share_location' });
  assert.equal(b.locked_layers.find((l) => l.id === 'audience').reason, 'creator_business_required');
  assert.equal(b.locked_layers.find((l) => l.id === 'transport').reason, 'pending_counsel');
  b = await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db({ consent: true }) })).json();
  assert.equal(b.locked_layers.find((l) => l.id === 'cctv').reason, 'mission_required');
  b = await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db({ consent: true, mission: true }) })).json();
  assert.ok(b.unlocked_layers.includes('cctv'));
});

test('creator and owner come from records; E=Up, fellow and transport are never granted yet', async () => {
  assert.equal((await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db({ creator: true }) })).json()).level, 'creator_business');
  const o = await (await handleWorldAccess(req('t'), ENV, { fetchImpl: db({ owner: true }) })).json();
  assert.equal(o.level, 'owner');
  assert.equal(o.locked_layers.find((l) => l.id === 'transport').reason, 'pending_counsel', 'not even the owner: the rule ships disabled');
  assert.deepEqual(LEVELS, ['public', 'fan', 'creator_business', 'eup', 'fellow', 'fellow_transport', 'owner']);
  const src = await readFile(new URL('../src/world-access.js', import.meta.url), 'utf8');
  assert.match(src, /eup: async \(\) => false/); assert.match(src, /fellow: async \(\) => false/); assert.match(src, /fellowTransport: async \(\) => false/);
  assert.equal(LAYER_RULES.transport.operator, 'Whip Equipped LLC');
});

test('routed in index.js', async () => {
  const src = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /path === '\/v1\/world\/access'/);
});
