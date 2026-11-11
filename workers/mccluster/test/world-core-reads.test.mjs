/* McCluster Core reads a few owner-only World layers with its signature, and
   nothing else (src/world-core-reads.js), plus the owner-only pairs route
   (src/world-news-pairs.js). Driven through the real Worker entry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { signCoreRequest, signEdgeRequest } from '../../../core/src/broker-edge-auth.mjs';
import { __resetCoreNonces } from '../src/media/core-signature.js';
import { CORE_READ_LAYERS } from '../src/world-core-reads.js';
import { NEWS_PAIR_LAYERS, parsePairsQuery } from '../src/world-news-pairs.js';
import { PAIR_LAYERS } from '../../../core/src/world/news-pairing.mjs';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.html$/.test(url)) {
      const text = readFileSync(new URL(url), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    return next(url, context);
  }
});
const { default: entry } = await import('../src/entry.js');

const SECRET = 'shared-core-edge-key';
const env = { CORE_EDGE_SIGNING_KEY: SECRET, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const ctx = { waitUntil() {} };
const OWNER = '11111111-1111-4111-8111-111111111111';
const ARTICLE = '22222222-2222-4222-8222-222222222222';

const QUAKES = {
  type: 'FeatureCollection', metadata: { generated: Date.now() },
  features: [{ id: 'us7000abcd', properties: { mag: 6.1, place: '40 km E of Hachinohe, Japan', time: Date.now() - 3_600_000, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd' }, geometry: { coordinates: [141.9, 40.5, 30] } }]
};

/* Supabase (house org, its one owner, pairs, articles) and USGS; anything else is a test failure. */
function withFetch(fn, { owners = [{ profile_id: OWNER }], bearerUser = null, isOwner = true } = {}) {
  const original = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (input, init) => {
    const href = String(input?.url || input);
    asked.push(href);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (href.includes('/auth/v1/user')) return bearerUser ? json(bearerUser) : json({}, 401);
    /* The shared replay store (C5) answers the media POST's atomic nonce claim. */
    if (href.endsWith('/rest/v1/core_signed_nonces')) return new Response(null, { status: 201 });
    if (href.includes('/rest/v1/orgs?')) return json([{ id: 'house-org' }]);
    if (href.includes('/rest/v1/org_members?') && href.includes('profile_id=eq.')) return json(isOwner ? [{ role: 'owner' }] : []);
    if (href.includes('/rest/v1/org_members?')) return json(owners);
    if (href.includes('/rest/v1/world_news_pairs?')) return json([{ article_id: ARTICLE, layer: 'quakes', entity_key: 'us7000abcd', entity_name: 'M6.1 40 km E of Hachinohe, Japan', entity_lat: 40.5, entity_lon: 141.9, entity_time: '2026-11-03T10:00:00.000Z', score: 0.9, method: 'name', reason: 'headline names "hachinohe"', created_at: '2026-11-03T11:00:00Z' }]);
    if (href.includes('/rest/v1/media_news_articles?')) return json([{ id: ARTICLE, title: 'Strong quake shakes Hachinohe', canonical_url: 'https://news.example/q', published_at: '2026-11-03T10:30:00Z', headline_location_label: 'Hachinohe, Japan' }]);
    if (href.startsWith('https://earthquake.usgs.gov/')) return json(QUAKES);
    throw new Error(`Unexpected fetch: ${href}`);
  };
  return Promise.resolve().then(() => fn(asked)).finally(() => { globalThis.fetch = original; });
}

function signed(path, { method = 'GET', secret = SECRET, signer = signCoreRequest, signedPath = path.split('?')[0], body } = {}) {
  const bytes = body ? Buffer.from(body) : Buffer.alloc(0);
  const headers = signer({ secret, method, path: signedPath, bodyBytes: bytes });
  return new Request(`https://api.mccluster.org${path}`, { method, headers, ...(body ? { body } : {}) });
}

test('a Core-signed GET of an allowed layer answers as the house owner, privately', async () => {
  __resetCoreNonces();
  await withFetch(async (asked) => {
    const res = await entry.fetch(signed('/v1/world/layers/quakes'), env, ctx);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const body = await res.json();
    assert.equal(body.layer, 'quakes');
    assert.equal(body.quakes[0].id, 'us7000abcd');
    assert.ok(asked.some((u) => u.includes('/rest/v1/org_members?')), 'the single house owner is required');
    assert.ok(!asked.some((u) => u.includes('/auth/v1/user')), 'no user session is consulted');
  });
});

test('a Core signature is refused on every route outside the allowlist', async () => {
  for (const path of ['/v1/world/layers/military', '/v1/world/layers/flights', '/v1/world/layers/tides', '/v1/world/halo/people', '/v1/world/news-pairs', '/v1/world/geocode', '/v1/social/accounts', '/v1/core/mcp']) {
    __resetCoreNonces();
    await withFetch(async (asked) => {
      const res = await entry.fetch(signed(path), env, ctx);
      assert.equal(res.status, 403, path);
      assert.equal((await res.json()).code, 'core_route_not_allowed', path);
      assert.deepEqual(asked, [], `${path}: refused before any lookup`);
    });
  }
});

test('a Core-signed POST to a layer is refused', async () => {
  __resetCoreNonces();
  await withFetch(async (asked) => {
    const res = await entry.fetch(signed('/v1/world/layers/quakes', { method: 'POST', body: '{}' }), env, ctx);
    assert.equal(res.status, 405);
    assert.deepEqual(asked, []);
  });
});

test('a bad, replayed, cross-direction or query-carrying signature is refused', async () => {
  __resetCoreNonces();
  await withFetch(async (asked) => {
    let res = await entry.fetch(signed('/v1/world/layers/quakes', { secret: 'another-key' }), env, ctx);
    assert.equal(res.status, 401);
    res = await entry.fetch(signed('/v1/world/layers/quakes', { signedPath: '/v1/world/layers/cyclones' }), env, ctx);
    assert.equal(res.status, 401, 'a signature for another layer');
    res = await entry.fetch(signed('/v1/world/layers/quakes?bbox=1,2,3,4'), env, ctx);
    assert.equal(res.status, 400, 'the query string is not signed');
    const edge = signed('/v1/world/layers/quakes', { signer: signEdgeRequest });
    edge.headers.set('x-mccluster-edge-protocol', 'mccluster-core/v1');
    res = await entry.fetch(edge, env, ctx);
    assert.equal(res.status, 401, 'a Worker -> Core signature never passes as Core');
    assert.ok(!asked.some((u) => u.startsWith('https://earthquake.usgs.gov/')), 'nothing was read for a refused call');
  });
  __resetCoreNonces();
  await withFetch(async () => {
    const once = signed('/v1/world/layers/quakes');
    const again = new Request(once.url, { headers: once.headers });
    assert.equal((await entry.fetch(once, env, ctx)).status, 200);
    assert.equal((await entry.fetch(again, env, ctx)).status, 409, 'a nonce is single use');
  });
});

test('fails closed without the key, without exactly one owner, or for a withdrawn layer', async () => {
  __resetCoreNonces();
  await withFetch(async () => {
    assert.equal((await entry.fetch(signed('/v1/world/layers/quakes'), { ...env, CORE_EDGE_SIGNING_KEY: '' }, ctx)).status, 503);
  });
  __resetCoreNonces();
  await withFetch(async () => {
    assert.equal((await entry.fetch(signed('/v1/world/layers/quakes'), env, ctx)).status, 503);
  }, { owners: [{ profile_id: 'a' }, { profile_id: 'b' }] });
  __resetCoreNonces();
  await withFetch(async () => {
    const res = await entry.fetch(signed('/v1/world/layers/quakes'), { ...env, WORLD_GLOBE_WITHDRAWN: 'quakes' }, ctx);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'feature_withdrawn');
  });
});

test('an unsigned request to a layer still meets the owner guard, and media keeps its own Core path', async () => {
  __resetCoreNonces();
  await withFetch(async () => {
    const res = await entry.fetch(new Request('https://api.mccluster.org/v1/world/layers/quakes'), env, ctx);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'admin_preview');
    // A Core-signed media call is not taken by the layer gate: it reaches media's own verifier.
    const media = await entry.fetch(signed('/v1/media/mcp', { method: 'POST', body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', secret: 'another-key' }), env, ctx);
    assert.equal(media.status, 401);
    assert.match((await media.json()).error, /Core signature is not valid/);
  });
});

test('the allowlist, the pairs route and Core agree on the layers', () => {
  assert.deepEqual([...CORE_READ_LAYERS].sort(), [...PAIR_LAYERS].sort());
  assert.deepEqual([...NEWS_PAIR_LAYERS].sort(), [...PAIR_LAYERS].sort());
  assert.ok(!CORE_READ_LAYERS.includes('military') && !CORE_READ_LAYERS.includes('flights'));
});

/* ---------- GET /v1/world/news-pairs ---------- */
const pairsGet = (q, bearer = 'Bearer owner-token') => entry.fetch(new Request(`https://api.mccluster.org/v1/world/news-pairs${q}`, { headers: bearer ? { authorization: bearer } : {} }), env, ctx);

test('news pairs are for the house owner only', async () => {
  await withFetch(async (asked) => {
    const res = await pairsGet('?layer=quakes&entity_key=us7000abcd', null);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.ok(!asked.some((u) => u.includes('world_news_pairs')));
  });
  await withFetch(async (asked) => {
    const res = await pairsGet('?layer=quakes&entity_key=us7000abcd');
    assert.equal(res.status, 403);
    assert.ok(!asked.some((u) => u.includes('world_news_pairs')));
  }, { bearerUser: { id: OWNER }, isOwner: false });
});

test('the owner gets the headlines for a map item, with title and link', async () => {
  await withFetch(async (asked) => {
    const res = await pairsGet('?layer=quakes&entity_key=us7000abcd');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const body = await res.json();
    assert.equal(body.count, 1);
    assert.equal(body.pairs[0].article.title, 'Strong quake shakes Hachinohe');
    assert.equal(body.pairs[0].article.url, 'https://news.example/q');
    assert.equal(body.pairs[0].method, 'name');
    assert.ok(asked.some((u) => /world_news_pairs\?layer=eq\.quakes&entity_key=eq\.us7000abcd/.test(u)));
  }, { bearerUser: { id: OWNER } });
  await withFetch(async (asked) => {
    const res = await pairsGet(`?article_id=${ARTICLE}`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).pairs[0].entity_key, 'us7000abcd');
    assert.ok(asked.some((u) => u.includes(`world_news_pairs?article_id=eq.${ARTICLE}`)));
  }, { bearerUser: { id: OWNER } });
});

test('a malformed pairs query is refused before any read', async () => {
  for (const q of ['', '?layer=military&entity_key=x', '?layer=quakes&entity_key=a%20b', '?article_id=nope', `?article_id=${ARTICLE}&layer=quakes`, '?layer=quakes&entity_key=x)%26select%3D*']) {
    assert.ok(parsePairsQuery(new URL(`https://x${'/v1/world/news-pairs'}${q}`)).error, q);
  }
  await withFetch(async (asked) => {
    const res = await pairsGet('?layer=quakes&entity_key=a,b');
    assert.equal(res.status, 400);
    assert.ok(!asked.some((u) => u.includes('world_news_pairs')));
  }, { bearerUser: { id: OWNER } });
});

test('the shipped platform entry gates a Core signature before every other API handler', () => {
  const src = readFileSync(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  const at = src.indexOf('await coreSignedGate(request, env)');
  assert.ok(at > 0, 'the platform entry calls the gate');
  assert.ok(at > src.indexOf('humanUpriseResponse(request, env)'), 'the World hosts answer their own hosts first');
  for (const handler of ['preflightResponse(request, env)', 'handleTravelRouting(request, env)', 'handleNewsBriefs(request, env)', 'enforceApiRateLimit(request, env)', 'handlePlatformApi(request, env)', 'existing.fetch(request, env, ctx)']) {
    assert.ok(at < src.indexOf(handler), `before ${handler}`);
  }
  const old = readFileSync(new URL('../src/entry.js', import.meta.url), 'utf8');
  assert.ok(old.indexOf('await coreSignedGate(request, env)') < old.indexOf("path === '/v1/media/mcp'"), 'and first in the old entry too');
});

/* ---------- security review, 2026-11-03 ---------- */
test('a Core signature reaches no route by case, encoding, double slash, suffix or HEAD', async () => {
  for (const path of ['/v1/world/layers/Quakes', '/V1/world/layers/quakes', '/v1/world/layers/%71uakes', '/v1/world/layers/quakes%2F', '//v1/world/layers/quakes', '/v1/world//layers/quakes', '/v1/world/layers/quakes.json', '/v1/world/layers/quakesx', '/v1/world/layers/quakes/x', '/v1/world/layers/military%2Fquakes', '/v1/world/layers/../layers/military']) {
    __resetCoreNonces();
    await withFetch(async (asked) => {
      const res = await entry.fetch(signed(path), env, ctx);
      assert.equal(res.status, 403, path);
      assert.equal((await res.json()).code, 'core_route_not_allowed', path);
      assert.deepEqual(asked, [], `${path}: refused before any lookup`);
    });
  }
  __resetCoreNonces();
  await withFetch(async (asked) => {
    const res = await entry.fetch(signed('/v1/world/layers/quakes', { method: 'HEAD' }), env, ctx);
    assert.equal(res.status, 405);
    assert.deepEqual(asked, []);
  });
});

test('a protocol value that is not exactly Core is an ordinary request, never an owner', async () => {
  __resetCoreNonces();
  await withFetch(async (asked) => {
    const req = signed('/v1/world/layers/quakes');
    req.headers.set('x-mccluster-edge-protocol', 'MCCLUSTER-CORE/V1');
    const res = await entry.fetch(req, env, ctx);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'admin_preview', 'the ordinary owner guard answers');
    assert.ok(!asked.some((u) => u.startsWith('https://earthquake.usgs.gov/')));
  });
});

test('ordinary requests are untouched by the Core gate', async () => {
  await withFetch(async () => {
    const res = await entry.fetch(new Request('https://api.mccluster.org/healthz'), env, ctx);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).service, 'mccluster');
  });
});

test('a correctly signed media call still reaches media and keeps its nonce', async () => {
  __resetCoreNonces();
  await withFetch(async (asked) => {
    const body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
    const res = await entry.fetch(signed('/v1/media/mcp', { method: 'POST', body }), { ...env, CORE_REPLAY_STORE: 'supabase' }, ctx);
    assert.ok(asked.some((u) => u.endsWith('/rest/v1/core_signed_nonces')), 'the mutating call claimed its nonce in the shared store');
    assert.notEqual(res.status, 401, 'the gate did not consume or refuse the signature');
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 409);
    assert.ok(asked.some((u) => u.includes('/rest/v1/org_members?')), 'media resolved the house owner itself');
  });
});

test('a withdrawn layer stays withdrawn on the pairs route', async () => {
  const withdrawnEnv = { ...env, WORLD_GLOBE_WITHDRAWN: 'quakes' };
  await withFetch(async (asked) => {
    const res = await entry.fetch(new Request('https://api.mccluster.org/v1/world/news-pairs?layer=quakes&entity_key=us7000abcd', { headers: { authorization: 'Bearer owner-token' } }), withdrawnEnv, ctx);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'feature_withdrawn');
    assert.ok(!asked.some((u) => u.includes('world_news_pairs')));
  }, { bearerUser: { id: OWNER } });
  await withFetch(async () => {
    const res = await entry.fetch(new Request(`https://api.mccluster.org/v1/world/news-pairs?article_id=${ARTICLE}`, { headers: { authorization: 'Bearer owner-token' } }), withdrawnEnv, ctx);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).count, 0, 'the withdrawn layer pair is left out');
  }, { bearerUser: { id: OWNER } });
});
