import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const cursor = createRequire(import.meta.url)('../../js/world-environment-cursor.js');
const first = '2026-11-19T08:00:00.000Z';
const last = '2026-11-19T09:00:00.000Z';
const post = (id, iso, kind = 'recorded') => ({ id, stamp: { kind, iso } });
const posts = [post('first', first), post('last', last), post('unknown', first, 'retrieved')];

test('recorded times set the stops while undated reports and current fire layers stay visible', () => {
  const items = [...posts, { ...post('area', last), kind: 'fire_cell' }, { ...post('perimeter', last), kind: 'perimeter' }];
  assert.deepEqual(cursor.marksOf(items), [Date.parse(first), Date.parse(last)]);
  assert.deepEqual(cursor.filterAt(items, Date.parse(first)).map(p => p.id), ['first', 'unknown', 'area', 'perimeter']);
  assert.equal(cursor.stepAt(cursor.marksOf(items), Date.parse(first), 1), null);
  assert.equal(cursor.timeFromSearch('?t=' + first), Date.parse(first));
  assert.equal(cursor.timeFromSearch('?feed=news&t=' + first), null);
});

test('only the active tab and its current frame can move the cursor or write the address', () => {
  const handlers = new Map(), timers = new Map(), messages = [];
  let scope = 'equity', nextTimer = 0;
  const location = new URL('https://example.test/mnet.html?feed=equity&event=usgs:a');
  const frame = { postMessage: data => messages.push(data) };
  const w = {
    location,
    history: { replaceState: (_state, _title, href) => { location.href = new URL(href, location).href; } },
    document: { getElementById: id => id === 'mnWorldFrame' ? { contentWindow: frame } : null },
    MCC_FEED_SCOPE: { get: () => scope },
    addEventListener: (name, callback) => handlers.set(name, callback),
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: id => timers.delete(id)
  };
  const api = cursor.createCursor(w);
  const state = () => api.state();
  const frameSays = (ack, source = frame) => handlers.get('message')({
    origin: location.origin, source, data: { type: 'hu:environment-time-state', at: null, ack }
  });
  const flush = () => { for (const fn of timers.values()) fn(); timers.clear(); };
  api.listen();
  api.sync(posts);
  api.step(-1);
  assert.deepEqual(state().shown, ['first', 'unknown']);
  assert.deepEqual(messages.at(-1), { type: 'hu:environment-time', at: first, seq: 1, input: true });
  frameSays(0);
  frameSays(1, {});
  assert.equal(state().at, first);
  flush();
  assert.equal(location.searchParams.get('event'), 'usgs:a');
  assert.equal(location.searchParams.get('t'), first);
  frameSays(1);
  assert.equal(state().at, null);
  flush();
  assert.equal(location.searchParams.has('t'), false);

  api.step(-1);
  scope = 'news';
  handlers.get('mcc:feed-scope')();
  assert.equal(messages.at(-1).at, null);
  frameSays(state().seq);
  flush();
  assert.equal(state().at, first);
  assert.equal(location.searchParams.has('t'), false);
  scope = 'equity';
  handlers.get('mcc:feed-scope')();
  assert.equal(messages.at(-1).at, first);
  handlers.get('popstate')();
  assert.equal(state().at, null);
});

test('the World provides a hidden time control before the environment panel and loads its module before the feed', () => {
  const html = readFileSync(new URL('../../mnet.html', import.meta.url), 'utf8');
  const pos = part => { const i = html.indexOf(part); assert.notEqual(i, -1, part); return i; };
  assert.ok(pos('id="mnFeedScope"') < pos('id="mnTimeCursor"'));
  assert.ok(pos('id="mnTimeCursor"') < pos('id="wePanel"'));
  assert.ok(pos('src="js/world-environment-cursor.js?') < pos('src="js/mnet.js?'));
});
