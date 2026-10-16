/* Control Analytics > the globe's states and provinces (owner, 2026-10-16).
   What matters: house owner only; the country is validated; what reaches the
   database is the country, the window and the site, nothing else; anything
   under 5 page views is folded even if the database returned it; no city,
   postal code, coordinates or IP leave the route; and until the pending read
   is applied the route answers pending, never a fake zero. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAnalyticsRequest } from '../src/analytics/router.js';

const OWNER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'matthew@mccluster.org' };
const ORG = '123e4567-e89b-42d3-a456-426614174000';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

async function run(path, { role = 'owner', rpc = () => reply([]) } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url)), p = u.pathname.replace('/rest/v1/', '');
    calls.push({ p, body: init.body ? JSON.parse(init.body) : null });
    if (p === 'orgs') return reply([{ id: ORG, slug: 'mccluster' }]);
    if (p === 'org_members') return reply(role ? [{ org_id: ORG, profile_id: OWNER.id, role }] : []);
    if (p === 'rpc/analytics_region_totals') return rpc();
    return reply({ message: 'unexpected ' + p }, 500);
  };
  try {
    const res = await handleAnalyticsRequest(new Request('https://api.mccluster.org' + path), env, OWNER).catch((e) => ({ status: e.status || 500, json: async () => ({ error: e.message }) }));
    return { res, body: await res.json(), calls };
  } finally { globalThis.fetch = original; }
}

test('regions: a member who is not the house owner is refused before any read', async () => {
  const { res, calls } = await run('/v1/analytics/regions?country=US', { role: 'member' });
  assert.equal(res.status, 403);
  assert.ok(!calls.some((c) => c.p.startsWith('rpc/')));
});

test('regions: the country must be a two-letter code', async () => {
  for (const c of ['', 'USA', 'u1', '../x']) {
    const { res } = await run('/v1/analytics/regions?country=' + encodeURIComponent(c));
    assert.equal(res.status, 400, c);
  }
});

test('regions: asks for the country and window only, folds under 5, passes no place finer than a region', async () => {
  const { res, body, calls } = await run('/v1/analytics/regions?country=us&since=2026-10-15T00:00:00Z&until=2026-10-16T00:00:00Z', {
    rpc: () => reply([
      { region_code: 'CT', region: 'Connecticut', page_views: 12, visitors: 7, folded: false, city: 'Hartford', latitude: 41.7 },
      { region_code: 'NY', region: 'New York', page_views: 3, visitors: 2, folded: false },
      { region_code: null, region: null, page_views: 4, visitors: null, folded: true },
      { region_code: null, region: null, page_views: 6, visitors: 5, folded: false }
    ])
  });
  assert.equal(res.status, 200);
  const rpc = calls.find((c) => c.p === 'rpc/analytics_region_totals');
  assert.deepEqual(Object.keys(rpc.body).sort(), ['p_country', 'p_since', 'p_site', 'p_until']);
  assert.equal(rpc.body.p_country, 'US');
  assert.deepEqual(body.regions, [{ code: 'CT', name: 'Connecticut', page_views: 12, visitors: 7 }]);
  assert.equal(body.folded, 7);
  assert.equal(body.unknown, 6);
  assert.doesNotMatch(JSON.stringify(body), /Hartford|latitude|"ip"|postal/);
});

test('regions: before the pending read is applied, the route says pending (never a zero)', async () => {
  const { res, body } = await run('/v1/analytics/regions?country=US', { rpc: () => reply({ code: 'PGRST202', message: 'Could not find the function public.analytics_region_totals' }, 404) });
  assert.equal(res.status, 200);
  assert.equal(body.pending, true);
  assert.deepEqual(body.regions, []);
});
