/* A PROFILE SAVE CHANGES WHAT IT NAMES (owner, 2026-10-20).
   PATCH /v1/mnet/profile hands every column to mnet_complete_surface_profile,
   which writes '' as readily as a value. The route used to send '' for any
   field the client left out, and the World's profile form has no banner:
   every save there erased the banner set from the member's front page. A
   field the body does not carry now keeps the stored value; a field it
   carries, even '', is the member's own choice. Driven against a fake
   Supabase. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi } from '../src/platform-api.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const USER = '11111111-1111-4111-8111-111111111111';
const MUID = '22222222-2222-4222-8222-222222222222';
const STORED = { display_name: 'Fixture Member', headline: 'Builds things', bio: 'A stored bio.', avatar_url: 'https://cdn.test/a.png', banner_url: 'https://cdn.test/banner.png', website_url: 'https://fixture.test' };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fake() {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ u, m, body });
    const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (u.endsWith('/auth/v1/user')) return ok({ id: USER });
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: MUID }]);
    if (u.includes('/network_profiles?m_uid=eq.')) return ok([STORED]);
    if (u.includes('/rpc/set_mccluster_id')) return ok(null);
    if (u.includes('/rpc/mnet_complete_surface_profile')) return ok({ ok: true, mccluster_id: 'fixture.member' });
    return ok([]);
  };
  return calls;
}
const patch = (body) => handlePlatformApi(new Request('https://api.test/v1/mnet/profile?app_key=mccluster-web', {
  method: 'PATCH', headers: { authorization: 'Bearer user', 'content-type': 'application/json' }, body: JSON.stringify(body)
}), ENV);
const saved = (calls) => calls.find((c) => c.u.includes('/rpc/mnet_complete_surface_profile')).body;

test('a save that leaves the banner out keeps the stored banner (the World form has none)', async () => {
  const calls = fake();
  const res = await patch({ mccluster_id: 'fixture.member', display_name: 'New Name', headline: 'New headline', bio: '', avatar_url: 'https://cdn.test/a.png', website_url: '' });
  assert.equal(res.status, 200);
  const p = saved(calls);
  assert.equal(p.p_banner_url, STORED.banner_url, 'the banner is not wiped');
  assert.equal(p.p_display_name, 'New Name');
  assert.equal(p.p_headline, 'New headline');
  assert.equal(p.p_bio, '', 'a field the member cleared stays cleared');
  assert.equal(p.p_website_url, '', 'an empty string sent is the member\'s choice');
});

test('a save that names only the handle and the name keeps every other stored field', async () => {
  const calls = fake();
  await patch({ mccluster_id: 'fixture.member', display_name: 'Only Name' });
  const p = saved(calls);
  assert.deepEqual(
    [p.p_display_name, p.p_headline, p.p_bio, p.p_avatar_url, p.p_banner_url, p.p_website_url],
    ['Only Name', STORED.headline, STORED.bio, STORED.avatar_url, STORED.banner_url, STORED.website_url]);
});

test('a save that names every field never reads the stored row', async () => {
  const calls = fake();
  await patch({ display_name: 'A', headline: 'B', bio: 'C', avatar_url: '', banner_url: '', website_url: '' });
  assert.equal(calls.filter((c) => c.u.includes('/network_profiles?')).length, 0, 'nothing to keep, nothing read');
  const p = saved(calls);
  assert.equal(p.p_banner_url, '', 'a banner sent as empty is cleared on purpose');
});
