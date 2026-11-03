import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  WILDFIRE_RE, STRONG, WEAK, buildIndex, distanceKm, matchArticle, normalizeLayer, parseConfirmations, CONFIRM_BATCH,
} from '../src/world/news-pairing.mjs';
import { worldNewsPairing, fetchLayer, MODEL_PRIORITY, PAIRING_MODEL } from '../src/executors/world-news-pairing.mjs';
import { buildCompletionEvidence } from '../src/completion-evidence.mjs';
import { EDGE_HEADERS } from '../src/broker-edge-auth.mjs';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const iso = (offsetH) => new Date(NOW + offsetH * 3_600_000).toISOString();
let n = 0;
const article = (title, extra = {}) => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, title, canonical_url: `https://news.example/${n}`, published_at: iso(0), imported_at: iso(0), location_type: 4, ...extra });

const LAYERS = {
  quakes: { quakes: [
    { id: 'us7000abcd', mag: 6.1, place: '40 km E of Hachinohe, Japan', time: iso(-3), lat: 40.5, lon: 141.9 },
    { id: 'ci4000tiny', mag: 1.2, place: '5 km N of Ridgecrest, CA', time: iso(-1), lat: 35.7, lon: -117.7 },
  ] },
  cyclones: { fetched_at: iso(0), cyclones: [{ id: 'al142026', name: 'Melissa', classification: 'HU', lat: 17.5, lon: -77.0 }] },
  natural: { events: [
    { id: 'EONET_101', name: 'Etna Volcano, Italy', kind: 'volcano', lat: 37.75, lon: 14.99, observed_at: iso(-24) },
    { id: 'EONET_102', name: 'Wildfire - Lake Fire, California', kind: 'fire', lat: 34.7, lon: -120.0, observed_at: iso(-12) },
  ] },
  fires: { fires: [[-120.01, 34.71, 30, 'high', iso(-2), 'Suomi NPP', 'D'], [-120.02, 34.72, 25, 'high', iso(-2), 'NOAA-20', 'D'], [-120.0, 34.70, 40, 'nominal', iso(-2), 'Suomi NPP', 'D'], [10, 10, 1, 'low', iso(-2), 'x', 'D']] },
  perimeters: { perimeters: [{ id: '2026-CALPF-000123', name: 'PALISADES', acres: 23000, discovered: iso(-72), rings: [[[-118.55, 34.07], [-118.5, 34.07], [-118.5, 34.1], [-118.55, 34.07]]] }] },
  launches: { launches: [
    { id: 'f0e1d2c3-0000-4000-8000-000000000001', name: 'Falcon 9 Block 5 | Starlink Group 10-12', net: iso(20), provider: 'SpaceX', pad: { lat: 28.56, lon: -80.58, location: 'Cape Canaveral' }, mission: { name: 'Starlink Group 10-12' } },
    { id: 'f0e1d2c3-0000-4000-8000-000000000002', name: 'SLS Block 1 | Artemis II', net: iso(300), provider: 'NASA', pad: { lat: 28.6, lon: -80.6, location: 'Kennedy' }, mission: { name: 'Artemis II' } },
  ] },
  satellites: { satellites: [
    { id: '25544', name: 'ISS (ZARYA)' }, { id: '49044', name: 'ISS (NAUKA)' }, { id: '48274', name: 'CSS (TIANHE)' }, { id: '20580', name: 'HST' }, { id: '28654', name: 'NOAA 18' }, { id: '99999', name: 'SL-16 R/B' },
  ] },
  vessels: { vessels: [['353136000', 'EVER GIVEN', 32.5, 30.0, 10, 0, 0, 0], ['111111111', 'MAERSK', 0, 0, 0, 0, 0, 0], ['222222222', 'STAR', 0, 0, 0, 0, 0, 0]] },
  weather: { events: [{ id: 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc', event: 'Tornado Warning', kind: 'tornado', severity: 'Extreme', lat: 35.4, lon: -97.5, starts_at: iso(-1) }] },
};

function index() {
  const entities = Object.entries(LAYERS).flatMap(([layer, body]) => normalizeLayer(layer, body, { now: NOW }));
  return buildIndex(entities);
}
const IDX = index();
const pairsOf = (a) => matchArticle(a, IDX);
const one = (a, layer) => pairsOf(a).find((p) => p.layer === layer);

test('layer rows normalize into entities, dropping what cannot pair', () => {
  const by = (layer) => normalizeLayer(layer, LAYERS[layer], { now: NOW });
  assert.deepEqual(by('quakes').map((e) => e.key), ['us7000abcd'], 'a M1.2 never pairs');
  assert.equal(by('fires').length, 1, 'three hotspots in one cell are a cluster; a lone weak one is not');
  assert.match(by('fires')[0].key, /^cell:-?\d+:-?\d+:2026-11-03$/);
  assert.deepEqual(by('satellites').map((e) => e.key), ['25544', '48274', '20580', '28654'], 'station modules and rocket bodies never pair by name');
  assert.deepEqual(by('vessels').map((e) => e.key), ['353136000'], 'single-word ship names never pair');
  assert.equal(by('weather')[0].key, 'urn:oid:2.49.0.1.840.0.abc');
  assert.equal(by('perimeters')[0].name, 'PALISADES Fire');
});

test('a satellite headline pairs with the satellite by name', () => {
  const iss = one(article('Astronauts return to the International Space Station after a spacewalk'), 'satellites');
  assert.equal(iss.entity.key, '25544');
  assert.equal(iss.band, 'strong');
  assert.equal(iss.method, 'name');
  assert.equal(one(article('China sends three taikonauts to Tiangong for a six month stay'), 'satellites').entity.key, '48274');
  assert.equal(one(article('Hubble telescope captures a new image of a distant galaxy'), 'satellites').entity.key, '20580');
  assert.equal(one(article('NOAA 18 weather satellite retired after two decades in orbit'), 'satellites').band, 'weak', 'a catalogue name goes to the model');
  assert.equal(one(article('Hubble the dog wins best in show at county fair'), 'satellites'), undefined, 'a bare name needs its context');
});

test('named storms pair only beside a storm word; geo alone stays weak', () => {
  const named = one(article('Hurricane Melissa strengthens as it nears Jamaica', { headline_latitude: 18.1, headline_longitude: -77.3 }), 'cyclones');
  assert.equal(named.band, 'strong');
  assert.ok(named.score >= 0.9, `name and place together: ${named.score}`);
  assert.equal(one(article('Melissa McCarthy stars in a new comedy this weekend'), 'cyclones'), undefined);
  const near = one(article('Tropical storm warnings issued across the Caribbean islands', { headline_latitude: 18.1, headline_longitude: -77.3 }), 'cyclones');
  assert.equal(near.band, 'weak');
  assert.equal(near.method, 'geo_time');
});

test('quakes pair by place and time, within 400 km and 48 h', () => {
  const close = one(article('Magnitude 6 earthquake shakes northern Japan, no tsunami warning', { headline_latitude: 40.82, headline_longitude: 140.74 }), 'quakes');
  assert.equal(close.entity.key, 'us7000abcd');
  assert.ok(close.score >= STRONG, `precise, close and big: ${close.score}`);
  const named = one(article('Quake rattles Hachinohe port overnight'), 'quakes');
  assert.equal(named.band, 'strong', 'the USGS place name');
  const country = one(article('Earthquake felt across Japan', { headline_latitude: 39.5, headline_longitude: 141, location_type: 1 }), 'quakes');
  assert.equal(country.band, 'weak', 'a country centroid is never strong on its own');
  assert.equal(one(article('Earthquake drill held in Lisbon schools', { headline_latitude: 38.7, headline_longitude: -9.1 }), 'quakes'), undefined, 'too far');
  assert.equal(one(article('Magnitude 6 earthquake shakes northern Japan', { headline_latitude: 40.82, headline_longitude: 140.74, published_at: iso(-60) }), 'quakes'), undefined, 'the article is older than the quake window');
  assert.equal(one(article('Japan stocks shake off losses in northern trading', { headline_latitude: 40.82, headline_longitude: 140.74 }), 'quakes'), undefined, 'no quake word');
});

test('fire means wildfire: ceasefire, fired and fire sale never pair', () => {
  for (const title of ['Ceasefire holds in the north for a third day', 'Coach fired after losing streak in California', 'Fire sale: retailer slashes prices', 'Troops open fire near the border', 'Senator under fire over remarks']) {
    assert.equal(WILDFIRE_RE.test(title), false, title);
    const hit = pairsOf(article(title, { headline_latitude: 34.71, headline_longitude: -120.01 })).filter((p) => ['fires', 'perimeters'].includes(p.layer));
    assert.deepEqual(hit, [], title);
  }
  const fire = one(article('Wildfire forces evacuations near Lompoc as crews battle the blaze', { headline_latitude: 34.64, headline_longitude: -120.46 }), 'fires');
  assert.equal(fire.method, 'geo_time');
  assert.ok(fire.score >= WEAK);
  const palisades = one(article('Palisades Fire containment reaches 80 percent'), 'perimeters');
  assert.equal(palisades.band, 'strong');
  assert.equal(palisades.entity.key, '2026-CALPF-000123');
});

test('EONET names pair with their context word; launches by mission, rockets stay weak', () => {
  assert.equal(one(article('Mount Etna erupts again, closing Catania airport'), 'natural').entity.key, 'EONET_101');
  assert.equal(one(article('Etna wine harvest is the best in years'), 'natural'), undefined);
  const artemis = one(article('NASA sets new date for the Artemis II crewed mission'), 'launches');
  assert.equal(artemis.band, 'strong');
  assert.equal(artemis.entity.key, 'f0e1d2c3-0000-4000-8000-000000000002');
  const rocket = one(article('SpaceX Falcon 9 rocket launch scrubbed due to weather'), 'launches');
  assert.equal(rocket.band, 'weak');
  assert.equal(rocket.entity.key, 'f0e1d2c3-0000-4000-8000-000000000001');
});

test('ships need a ship word and the exact multi-word name', () => {
  assert.equal(one(article('Container ship Ever Given runs aground again in the Suez Canal'), 'vessels').band, 'strong');
  assert.equal(one(article('Ever given a chance, the team would win the cup'), 'vessels'), undefined);
  assert.equal(one(article('Maersk tanker seized in the Gulf of Oman'), 'vessels'), undefined);
});

test('weather alerts pair only from a precise place and the same kind', () => {
  const t = one(article('Tornado tears through Oklahoma City suburbs overnight', { headline_latitude: 35.47, headline_longitude: -97.52, location_type: 3 }), 'weather');
  assert.equal(t.band, 'weak');
  assert.equal(one(article('Tornado tears through suburbs', { headline_latitude: 35.47, headline_longitude: -97.52, location_type: 1 }), 'weather'), undefined);
});

test('one best item per layer, at most three per article', () => {
  const many = pairsOf(article('Hurricane Melissa and the Tiangong crew: astronauts watch the storm from the space station', { headline_latitude: 18, headline_longitude: -77 }));
  assert.ok(many.length <= 3);
  assert.equal(new Set(many.map((p) => p.layer)).size, many.length);
  assert.ok(Math.abs(distanceKm(0, 0, 0, 1) - 111.19) < 0.1);
});

test('model answers are parsed strictly', () => {
  const batch = [{}, {}, {}];
  const answers = parseConfirmations(JSON.stringify({ pairs: [{ n: 1, same: true, why: 'same storm <b>x</b> https://evil.example' }, { n: 2, same: 'yes' }, { n: 1, same: false }, { n: 9, same: true }] }), batch);
  assert.deepEqual([...answers.keys()], [1]);
  assert.equal(answers.get(1).same, true);
  assert.doesNotMatch(answers.get(1).why, /https?:|<b>/);
  assert.equal(parseConfirmations('not json', batch).size, 0);
});

/* ---------- the executor ---------- */
const SECRET = 'core-edge-key';
const job = { id: '00000000-0000-4000-8000-0000000000bb', org_id: 'house', job_type: 'world_news_pairing', target_id: 'news-pairs', input: {} };

function fixture({ articles, layers = LAYERS, down = [], previousCursor = iso(-0.25), reply } = {}) {
  const seen = { layerCalls: [], queries: [], inserted: [], inferences: [] };
  return {
    seen,
    deps: {
      resolveOrg: async () => 'house',
      now: new Date(NOW),
      env: { CORE_EDGE_SIGNING_KEY: SECRET, MCCLUSTER_EDGE_URL: 'https://api.example.test' },
      fetchImpl: async (url, init) => {
        const u = new URL(url);
        seen.layerCalls.push({ path: u.pathname, method: init.method, headers: init.headers });
        const layer = u.pathname.split('/').pop();
        if (down.includes(layer)) return new Response('{}', { status: 502 });
        return new Response(JSON.stringify({ ok: true, layer, fetched_at: iso(0), ...(layers[layer] || {}) }), { status: 200 });
      },
      query: async (path, init) => {
        seen.queries.push(path);
        if (path.startsWith('ops_agent_jobs?')) return { body: previousCursor ? [{ output: { cursor: previousCursor } }] : [] };
        if (path.startsWith('media_news_articles?')) {
          const offset = Number(new URL(`https://x/?${path.split('?')[1]}`).searchParams.get('offset'));
          return { body: offset ? [] : articles };
        }
        if (path.startsWith('world_news_pairs?')) {
          const rows = JSON.parse(init.body);
          seen.inserted.push(...rows);
          return { body: rows.map((_, i) => ({ id: String(i) })) };
        }
        throw new Error(path);
      },
      chat: async (input) => {
        seen.inferences.push(input);
        const asked = JSON.parse(input.messages[1].content).pairs;
        return { model: 'local-fast', message: { content: reply ?? JSON.stringify({ pairs: asked.map((p) => ({ n: p.n, same: p.item.layer !== 'cyclones', why: 'same item' })) }) } };
      },
    },
  };
}

test('a job reads the map with signed GETs, pairs, asks the model about weak ones and writes', async () => {
  const articles = [
    article('Astronauts return to the International Space Station after a spacewalk', { imported_at: iso(-0.1) }),
    article('SpaceX Falcon 9 rocket launch scrubbed due to weather', { imported_at: iso(-0.05) }),
    article('Tropical storm warnings issued across the Caribbean islands', { headline_latitude: 18.1, headline_longitude: -77.3 }),
    article('Tropical storm warnings issued across the Caribbean islands', { headline_latitude: 18.1, headline_longitude: -77.3 }),
    article('Bank rates unchanged this quarter, analysts say'),
  ];
  const { deps, seen } = fixture({ articles });
  const out = await worldNewsPairing(job, deps);

  assert.equal(seen.layerCalls.length, 9);
  for (const call of seen.layerCalls) {
    assert.equal(call.method, 'GET');
    assert.equal(call.headers[EDGE_HEADERS.protocol], 'mccluster-core/v1');
    assert.ok(call.headers[EDGE_HEADERS.signature]);
  }
  assert.ok(seen.queries.some((q) => q.startsWith(`media_news_articles?imported_at=gt.${encodeURIComponent(iso(-0.25))}`)), 'reads from the last cursor');
  assert.equal(out.articles_read, 5);
  assert.equal(out.cursor, iso(0));
  assert.equal(out.strong, 1);
  assert.equal(out.weak, 3, 'the rocket and the two syndicated storm copies');
  assert.equal(out.weak_questions, 2, 'syndicated copies share one question');
  assert.equal(seen.inferences.length, 1);
  assert.equal(seen.inferences[0].priority, MODEL_PRIORITY);
  assert.ok(MODEL_PRIORITY < -40, 'below the PRIM3 news desk');
  assert.equal(seen.inferences[0].model, PAIRING_MODEL);
  assert.equal(out.model.confirmed, 1);
  assert.equal(out.model.rejected, 1);
  assert.deepEqual(seen.inserted.map((r) => `${r.layer}:${r.method}`).sort(), ['launches:model', 'satellites:name']);
  const modelRow = seen.inserted.find((r) => r.method === 'model');
  assert.equal(modelRow.model, 'local-fast');
  assert.ok(modelRow.score >= STRONG);
  assert.equal(out.pairs_new, 2);
  const evidence = buildCompletionEvidence(job, out);
  assert.ok(JSON.stringify(evidence).includes('world_news_pairing'));
});

test('weak candidates are asked in batches of at most 12, within the call budget', async () => {
  const articles = Array.from({ length: 40 }, (_, i) => article(`Tropical storm warnings issued across the islands, update ${i}`, { headline_latitude: 18.1, headline_longitude: -77.3 }));
  const { deps, seen } = fixture({ articles });
  deps.env.WORLD_NEWS_PAIRING_MODEL_CALLS = '2';
  const out = await worldNewsPairing(job, deps);
  assert.equal(seen.inferences.length, 2);
  for (const call of seen.inferences) assert.ok(JSON.parse(call.messages[1].content).pairs.length <= CONFIRM_BATCH);
  assert.equal(out.model.asked, 24);
  assert.equal(out.model.unreviewed, 16);
  assert.equal(out.pairs_sent, 0, 'every storm question was answered no');
  assert.doesNotThrow(() => buildCompletionEvidence(job, out));
});

test('a failed model leaves the strong pairs written and says so', async () => {
  const articles = [article('Astronauts return to the International Space Station'), article('SpaceX Falcon 9 rocket launch scrubbed')];
  const { deps, seen } = fixture({ articles });
  deps.chat = async () => { throw new Error('adapter down'); };
  const out = await worldNewsPairing(job, deps);
  assert.equal(out.model.error, 'adapter down');
  assert.equal(out.model.calls, 0);
  assert.equal(seen.inserted.length, 1);
  assert.doesNotThrow(() => buildCompletionEvidence(job, out));
});

test('a down layer is a receipt; no layer at all fails the job and keeps the cursor', async () => {
  const articles = [article('Astronauts return to the International Space Station')];
  const partial = fixture({ articles, down: ['fires', 'vessels'] });
  const out = await worldNewsPairing(job, partial.deps);
  assert.deepEqual(out.layers.filter((l) => l.status === 'error').map((l) => l.layer).sort(), ['fires', 'vessels']);
  const none = fixture({ articles, down: Object.keys(LAYERS) });
  await assert.rejects(worldNewsPairing(job, none.deps), /no Halo layer answered/);
  assert.equal(none.seen.inserted.length, 0);
  const unsigned = fixture({ articles });
  unsigned.deps.env = {};
  await assert.rejects(worldNewsPairing(job, unsigned.deps), /CORE_EDGE_SIGNING_KEY/);
});

test('the job refuses another org, and evidence refuses dishonest counts', async () => {
  const { deps } = fixture({ articles: [] });
  await assert.rejects(worldNewsPairing({ ...job, org_id: 'other' }, deps), /outside Core authority/);
  const out = await worldNewsPairing(job, deps);
  assert.equal(out.articles_read, 0);
  assert.equal(out.cursor, out.cursor_from, 'no news, the cursor stays');
  assert.doesNotThrow(() => buildCompletionEvidence(job, out));
  assert.throws(() => buildCompletionEvidence(job, { ...out, pairs_new: 5 }), /fewer pairs|more than it sent/);
  assert.throws(() => buildCompletionEvidence(job, { ...out, layers: [{ layer: 'quakes', status: 'error' }] }), /Halo layer/);
});

test('fetchLayer signs exactly the GET path with an empty body', async () => {
  let captured;
  await fetchLayer('quakes', { secret: SECRET, base: 'https://api.example.test', fetchImpl: async (url, init) => { captured = { url, init }; return new Response('{"ok":true,"quakes":[]}'); } });
  assert.equal(captured.url, 'https://api.example.test/v1/world/layers/quakes');
  const { canonicalCoreRequest, sha256Body } = await import('../src/broker-edge-auth.mjs');
  const crypto = await import('node:crypto');
  const h = captured.init.headers;
  assert.equal(h[EDGE_HEADERS.digest], sha256Body(Buffer.alloc(0)));
  const expected = crypto.createHmac('sha256', SECRET).update(canonicalCoreRequest({ method: 'GET', path: '/v1/world/layers/quakes', timestamp: h[EDGE_HEADERS.timestamp], nonce: h[EDGE_HEADERS.nonce], digest: h[EDGE_HEADERS.digest] })).digest('base64url');
  assert.equal(h[EDGE_HEADERS.signature], expected);
  assert.equal((await fetchLayer('quakes', { secret: '' })).status, 'not_signed');
});

test('the runner, the seeder, the timer and the deploy agree', async () => {
  const runner = await readFile(new URL('../src/runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /\['world_news_pairing', worldNewsPairing\]/);
  const timer = await readFile(new URL('../systemd/mccluster-core-world-news-pairing.timer', import.meta.url), 'utf8');
  assert.match(timer, /OnUnitActiveSec=15min/);
  const service = await readFile(new URL('../systemd/mccluster-core-world-news-pairing.service', import.meta.url), 'utf8');
  assert.match(service, /seed-world-news-pairing\.mjs/);
  const deploy = await readFile(new URL('../../scripts/deploy-ovh-core.sh', import.meta.url), 'utf8');
  assert.match(deploy, /for timer in [^\n]*mccluster-core-world-news-pairing\.timer/);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const file of ['src/world/news-pairing.mjs', 'src/executors/world-news-pairing.mjs', 'src/seed-world-news-pairing.mjs']) assert.ok(pkg.scripts.check.includes(file), file);
});

test('confirmations cut off by the output budget keep every complete answer', async () => {
  const { parseConfirmations } = await import('../src/world/news-pairing.mjs');
  const batch = [{}, {}, {}];
  const cut = '{\n  "pairs": [\n    {"n": 1, "same": true, "why": "names the \\"same\\" storm"},\n    {"n": 2, "same": false},\n    {"n": 3, "same": tr';
  const answers = parseConfirmations(cut, batch);
  assert.equal(answers.size, 2);
  assert.equal(answers.get(1).same, true);
  assert.equal(answers.get(1).why, 'names the "same" storm');
  assert.equal(answers.get(2).same, false);
  assert.equal(answers.has(3), false);
});
