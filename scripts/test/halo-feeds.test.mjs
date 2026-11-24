/* Halo's extended feeds without a map, and what each kind of answer does to what the owner is shown
   (js/halo/layers.js, read by js/halo/halo.js).

   The answers are the nine SYNTHETIC fixtures in scripts/e2e/fixtures/halo-feeds/ (the Worker's documented envelope with
   invented rows) and a few built here. Fixture counts are not live counts: nothing in this file reads a provider, the
   Worker or production. It replays the owner's Halo-Owner-Feed-Review case (extended feeds were never fetched when
   Cesium / WebGL failed) and holds the rules that case asked for:
     - the list loads without the map, for all nine feeds, with the same items the map would draw;
     - returned, usable and not-usable rows are three numbers, and the reason for the difference is said;
     - loading, fresh, stale, empty, unavailable and failed are six different conditions;
     - a transient failure keeps the last good answer and labels it stale; a refusal (401 / 403) removes it;
     - provider time, newest record time, Worker fetch time and this page's clock are never substituted for each other. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const SOURCE = read('js/halo/layers.js');
const FIX_DIR = 'scripts/e2e/fixtures/halo-feeds/';
const FIX = Object.fromEntries(readdirSync(new URL(FIX_DIR, ROOT)).filter((f) => f.endsWith('.json')).map((f) => [f.replace('.json', ''), JSON.parse(read(FIX_DIR + f))]));
const IDS = ['weather', 'natural', 'military', 'vessels', 'quakes', 'fires', 'perimeters', 'cyclones', 'tides'];
const clone = (v) => JSON.parse(JSON.stringify(v));
const good = (id, change = {}) => [200, { ...clone(FIX[id].answer), ...change }];

/* one page: layers.js in its own context, a queue of answers, and optionally a viewer */
function page({ viewer = null, cesium = undefined, token = 'fixture-not-a-token' } = {}) {
  const queue = [], asked = [];
  const ctx = {
    window: { Cesium: cesium }, document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    setInterval() { return 1; }, clearInterval() {}, Date, Math, JSON, Number, Promise, String, Array, Object, Set, Error,
    fetch: async (url, init) => {
      asked.push({ url, auth: init && init.headers && init.headers.authorization });
      const x = queue.shift();
      if (x === undefined) throw new Error('no answer queued');
      if (x instanceof Error) throw x;
      return { status: x[0], ok: x[0] === 200, json: async () => { if (x[1] === 'NOT JSON') throw new SyntaxError('bad json'); return x[1]; } };
    }
  };
  vm.createContext(ctx); vm.runInContext(SOURCE, ctx);
  const api = ctx.window.HaloLayers.create({ viewer: () => viewer, token: () => token, api: 'https://fixture.invalid' });
  const on = async (id, answer) => { queue.push(answer); await api.set(id, true); return api.status(id); };
  const again = async (id, answer) => { queue.push(answer); await api.refresh(id); return api.status(id); };
  return { api, on, again, asked, ctx };
}

test('the nine fixtures are labelled synthetic and match the nine declared extended feeds', () => {
  assert.deepEqual(Object.keys(FIX).sort(), [...IDS].sort());
  const p = page();
  assert.deepEqual([...p.api.ids].sort(), [...IDS].sort());
  for (const id of IDS) {
    const f = FIX[id].fixture;
    assert.equal(f.synthetic, true, id); assert.equal(f.schema, 'halo-feed-fixture/v1', id); assert.match(f.warning, /^SYNTHETIC FIXTURE\./, id);
    assert.match(f.warning, /not live counts/, id);
    assert.equal(FIX[id].answer.layer, id); assert.ok(Array.isArray(FIX[id].answer[f.rows]), id + ' carries its rows under ' + f.rows);
    assert.equal(FIX[id].answer[f.rows].length, f.returned, id + ': the note says how many rows it returns');
  }
});

test('no WebGL: every extended feed is fetched, counted and listed with no viewer and no Cesium', async () => {
  const p = page({ viewer: null, cesium: undefined });
  for (const id of IDS) {
    const s = await p.on(id, good(id)), f = FIX[id].fixture;
    assert.equal(s.state, 'on', id); assert.equal(s.condition, 'fresh', id);
    assert.equal(s.returned, f.returned, id + ' returned'); assert.equal(s.count, f.usable, id + ' usable'); assert.equal(s.dropped, f.returned - f.usable, id + ' not usable');
    assert.equal(p.api.items(id).length, f.usable, id + ' listed');
    assert.equal(s.dropWhy === '', f.returned === f.usable, id + ': a difference always carries its reason, and only then');
    assert.equal(s.renderIssue, '', id + ': not drawing is not an error when there is no map');
    assert.equal(s.credit, FIX[id].answer.credit, id);
    /* the item is the same one the map would draw, so the sheet reads it the same way */
    const d = p.api.describe({ haloPick: true, layer: id, item: p.api.items(id)[0] });
    assert.ok(d && typeof d.title === 'string' && d.title.length > 0 && Array.isArray(d.rows), id + ' describes without a map');
  }
  assert.equal(p.asked.length, 9); assert.ok(p.asked.every((a) => /\/v1\/world\/layers\/[a-z]+$/.test(a.url) && a.auth === 'Bearer fixture-not-a-token'));
  assert.equal(p.api.visuals, null, 'no event visuals are created without a viewer');
  assert.equal(p.api.status('weather').mapped, 1, 'an alert with no coordinates is listed and not counted as mapped');
});

test('provider time is not fetch time: four clocks, and a missing one is 0, never "now"', async () => {
  const p = page();
  const t = (iso) => Date.parse(iso);
  let s = await p.on('quakes', good('quakes'));
  assert.equal(s.fetched, t('2026-11-23T12:00:00.000Z'), 'the Worker\'s fetch time');
  assert.equal(s.provider, t('2026-11-23T11:58:00.000Z'), 'the feed\'s own generated time');
  assert.equal(s.newest, t('2026-11-23T10:15:00.000Z'), 'the newest usable record, not the unusable one');
  assert.ok(s.checked >= s.fetched && s.checked !== s.fetched, 'this page\'s clock is its own number');
  s = await p.on('vessels', good('vessels'));
  assert.equal(s.provider, t('2026-11-23T11:59:15.000Z'), 'the stream\'s last message'); assert.equal(s.newest, 0);
  s = await p.on('cyclones', good('cyclones'));
  assert.equal(s.provider, 0, 'NHC supplies no time in this envelope'); assert.equal(s.newest, 0); assert.equal(s.fetched, t('2026-11-23T12:00:00.000Z'));
  s = await p.on('fires', good('fires'));
  assert.equal(s.provider, 0); assert.equal(s.newest, t('2026-11-23T09:42:00Z'), 'the latest detection');
  /* times that say nothing are refused, not repaired */
  for (const [bad, why] of [['2026-11-23', 'a bare date'], ['2026-11-23T12:00:00', 'no zone'], ['2099-01-01T00:00:00Z', 'the future'], ['yesterday', 'words'], [1795435200000, 'a number'], [null, 'null'], ['', 'empty']]) {
    const q = page();
    const r = await q.on('quakes', good('quakes', { fetched_at: bad, observed_at: bad }));
    assert.equal(r.fetched, 0, why); assert.equal(r.provider, 0, why); assert.equal(r.condition, 'fresh', why + ': the rows are still good');
  }
});

test('filtered-out rows: the difference is counted and explained; no usable row at all is a failed answer', async () => {
  const p = page();
  let s = await p.on('quakes', good('quakes'));
  assert.deepEqual([s.returned, s.count, s.dropped, s.dropWhy], [4, 3, 1, 'no valid position']);
  assert.deepEqual(Array.from(p.api.items('quakes'), (q) => q.id), ['fixture-quake-1', 'fixture-quake-2', 'fixture-quake-3']);
  const none = { quakes: [{ id: 'x', lon: 999, lat: 999 }, { id: 'y', lon: null, lat: 3 }, 'text', null, 7] };
  /* with a good answer already shown: it stays, stale, and the reason says what came back */
  s = await p.again('quakes', good('quakes', none));
  assert.equal(s.state, 'error'); assert.equal(s.condition, 'stale'); assert.equal(s.staleBy, 'page'); assert.equal(s.count, 3);
  assert.equal(s.reason, '5 returned, none usable (no valid position)');
  /* with nothing shown yet: failed, and nothing is listed */
  const q = page(); s = await q.on('quakes', good('quakes', none));
  assert.equal(s.condition, 'failed'); assert.equal(s.count, 0); assert.equal(s.lastGood, false); assert.equal(q.api.items('quakes').length, 0);
  for (const id of IDS) {
    const r = page(); const key = FIX[id].fixture.rows;
    const st = await r.on(id, good(id, { [key]: [{ bogus: true }, [], null] }));
    assert.equal(st.condition, 'failed', id); assert.match(st.reason, /^3 returned, none usable \(/, id);
  }
});

test('a real empty result is "empty": it replaces what was shown and is not unavailable, failed or stale', async () => {
  for (const id of IDS) {
    const p = page(); const key = FIX[id].fixture.rows;
    await p.on(id, good(id));
    const s = await p.again(id, good(id, { [key]: [], count: 0 }));
    assert.equal(s.state, 'on', id); assert.equal(s.condition, 'empty', id);
    assert.deepEqual([s.returned, s.count, s.dropped, s.stale, s.lastGood], [0, 0, 0, false, true], id);
    assert.equal(p.api.items(id).length, 0, id + ': the earlier rows are not kept behind an empty answer');
    assert.equal(s.fetched, Date.parse('2026-11-23T12:00:00.000Z'), id + ': an empty answer still has its retrieval time');
  }
});

test('transient failures keep the last good answer and label it stale; recovery clears the label', async () => {
  const failures = [
    [[503, {}], 'the Worker answered 503'], [[500, {}], 'the Worker answered 500'], [[429, {}], 'the Worker answered 429'],
    [new Error('offline'), 'could not reach the Worker'],
    [[200, 'NOT JSON'], 'the answer was not readable'], [[200, []], 'the answer was not readable'], [[200, null], 'the answer was not readable'],
    [[200, { ok: true, layer: 'quakes', fetched_at: 'yesterday', rows: 'not the documented envelope' }], 'the answer did not carry its rows'],
    [[200, { ok: true, quakes: { 0: 'not a list' } }], 'the answer did not carry its rows'],
    [[200, { ok: true, unavailable: true, upstream_error: 'upstream_timeout', quakes: [] }], 'provider unavailable']
  ];
  for (const [bad, reason] of failures) {
    const p = page(); const first = await p.on('quakes', good('quakes'));
    const s = await p.again('quakes', bad);
    assert.equal(s.condition, 'stale', reason); assert.equal(s.stale, true, reason); assert.equal(s.staleBy, 'page', reason); assert.equal(s.reason, reason);
    assert.equal(s.count, 3, reason + ': rows kept'); assert.equal(p.api.items('quakes').length, 3, reason);
    assert.equal(s.fetched, first.fetched, reason + ': the kept answer keeps ITS retrieval time'); assert.equal(s.provider, first.provider, reason);
    assert.ok(s.checked >= first.checked, reason + ': only this page\'s clock moves');
    const back = await p.again('quakes', good('quakes', { fetched_at: '2026-11-23T12:05:00.000Z' }));
    assert.deepEqual([back.condition, back.stale, back.staleBy, back.reason], ['fresh', false, '', ''], reason + ': recovered');
    assert.equal(back.fetched, Date.parse('2026-11-23T12:05:00.000Z'));
    /* the same failure with nothing shown yet is not "stale": there is nothing to be stale */
    const q = page(); const cold = await q.on('quakes', bad);
    assert.equal(cold.condition, reason === 'provider unavailable' ? 'unavailable' : 'failed', reason + ' cold'); assert.equal(cold.stale, false); assert.equal(cold.count, 0);
  }
});

test('the Worker\'s own stale flag is shown as stale by the Worker, with the kept answer\'s time', async () => {
  const p = page();
  const s = await p.on('quakes', good('quakes', { stale: true, upstream_error: 'upstream_timeout', fetched_at: '2026-11-23T09:00:00.000Z' }));
  assert.deepEqual([s.state, s.condition, s.stale, s.staleBy, s.count], ['on', 'stale', true, 'worker', 3]);
  assert.equal(s.fetched, Date.parse('2026-11-23T09:00:00.000Z')); assert.match(s.reason, /the Worker is serving its kept answer/);
});

test('denied access shows no cached private data: 401 and 403 remove everything that was read', async () => {
  for (const code of [401, 403]) {
    for (const id of IDS) {
      const p = page(); await p.on(id, good(id));
      assert.ok(p.api.items(id).length > 0);
      const s = await p.again(id, [code, { ok: false, error: 'Owner only' }]);
      assert.equal(s.state, 'locked', id); assert.equal(s.condition, 'locked', id);
      assert.deepEqual([s.count, s.returned, s.dropped, s.mapped, s.fetched, s.provider, s.newest, s.credit, s.stale, s.lastGood], [0, 0, 0, 0, 0, 0, 0, '', false, false], `${code} ${id}`);
      assert.equal(p.api.items(id).length, 0, `${code} ${id}: nothing listed`);
      /* and a later outage does not bring the old rows back as "stale" */
      const after = await p.again(id, [503, {}]);
      assert.equal(after.condition, 'failed', id); assert.equal(p.api.items(id).length, 0, id);
    }
  }
});

test('unavailable is its own condition: a missing key and a provider outage are said, and neither is "empty"', async () => {
  const p = page();
  let s = await p.on('fires', [200, { ok: true, layer: 'fires', fetched_at: null, unavailable: true, upstream_error: 'not_configured', requires: ['FIRMS_MAP_KEY'], count: 0, fires: [], stale: false }]);
  assert.deepEqual([s.state, s.condition, s.reason, s.count, s.fetched], ['unavailable', 'unavailable', 'needs a key', 0, 0]);
  s = await p.on('cyclones', [200, { ok: true, layer: 'cyclones', fetched_at: null, unavailable: true, upstream_error: 'upstream_http_502', count: 0, cyclones: [], stale: false }]);
  assert.deepEqual([s.condition, s.reason], ['unavailable', 'provider unavailable']);
});

test('loading is said only while there is nothing to show; turning a feed off forgets it', async () => {
  const p = page(); const seen = [];
  p.api.onChange((id, s) => seen.push(s.condition));
  await p.on('quakes', good('quakes'));
  assert.deepEqual(seen, ['loading', 'fresh']);
  seen.length = 0; await p.again('quakes', good('quakes'));
  assert.deepEqual(seen, ['fresh', 'fresh'], 'a refresh keeps showing the answer it has');
  await p.api.set('quakes', false);
  const s = p.api.status('quakes');
  assert.deepEqual([s.on, s.state, s.condition, s.count, s.lastGood, s.fetched], [false, 'off', 'off', 0, false, 0]);
  assert.equal(p.api.items('quakes').length, 0);
  assert.equal((await p.api.refresh('quakes')), undefined, 'refreshing a feed that is off asks nothing');
  assert.equal(p.asked.length, 2);
});

test('with a map that cannot draw, the list still loads and the map problem is said separately', async () => {
  const added = [];
  const viewer = { scene: { primitives: { add(x) { added.push(x); }, contains() { return false; }, remove() {} }, requestRender() {} }, entities: { remove() {} } };
  const p = page({ viewer, cesium: {} });   /* a Cesium object with no primitive classes: every paint throws */
  for (const id of IDS.filter((x) => x !== 'weather' && x !== 'natural')) {
    const s = await p.on(id, good(id));
    assert.equal(s.condition, 'fresh', id); assert.equal(s.count, FIX[id].fixture.usable, id); assert.equal(s.renderIssue, 'could not draw on the map', id);
    assert.equal(p.api.items(id).length, FIX[id].fixture.usable, id);
  }
  assert.equal(added.length, 0);
});

test('the Halo view lists feeds without the map and words each condition differently (js/halo/halo.js)', () => {
  const halo = read('js/halo/halo.js');
  assert.match(halo, /function needsMap\(it\) \{ return !!\(it\.core \|\| it\.globe \|\| it\.mkt\); \}/);
  assert.match(halo, /layers = window\.HaloLayers \? HaloLayers\.create\(G\) : null;/, 'the feeds are created whether or not the viewer exists');
  assert.doesNotMatch(halo, /layers = V && window\.HaloLayers/, 'the bug: feeds were created only with a viewer');
  assert.match(halo, /if \(!V && needsMap\(it\)\) return;\n?\r?\n?\s*if \(it\.planned \|\| isOn\(it\) === !!on\) return;/, 'a feed can be switched on without the map');
  assert.match(halo, /\$\('input', row\)\.disabled = st\.state === 'locked' \|\| \(!V && needsMap\(it\)\);/);
  assert.match(halo, /if \(!V\) \$\$\('\[data-fly\],\[data-follow\]',ui\.right\)\.forEach\(b => b\.disabled = true\);/, 'only the camera actions need the map');
  for (const word of ["failed: 'Failed'", "empty: 'No records'", "loading: 'Loading…'", "locked: 'Owner only'"]) assert.ok(halo.includes(word), word);
  assert.match(halo, /'Provider supplies no time · '/, 'a feed without a provider time says so');
  assert.doesNotMatch(halo, /text: 'Live' \}/, 'nothing is called Live because it was fetched');
  assert.doesNotMatch(halo, /'Updated ' \+ ago\(s\.fetched\)/, 'the fetch time is not presented as the data\'s age');
  assert.match(halo, /t: \(layers\.status\('cyclones'\) \|\| \{\}\)\.provider \|\| null/, 'a feed entry is dated by the provider, or not at all');
  assert.match(halo, /\['Returned by the Worker', n\(st\.returned\)\], \['Usable here', n\(st\.count\)\]/);
});
