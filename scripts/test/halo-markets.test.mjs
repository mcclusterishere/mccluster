/* Halo Markets (owner globe only): the client reads only the owner-gated Worker routes, the card is mobile first, and the
   exchange reference set the pins come from is placed and honest about its hours. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('the markets client reads only the canonical Worker, with the owner session, and shows no invented price', () => {
  const js = read('js/halo/markets.js');
  assert.doesNotMatch(js, /fetch\((?!G\.api)/, 'fetches only G.api');
  assert.doesNotMatch(js, /https:\/\/(?!news)/, 'names no provider host');
  for (const route of ['/v1/intel/markets/exchanges', '/v1/intel/markets/country/', '/v1/intel/markets/company/']) assert.ok(js.includes(route), route);
  assert.match(js, /authorization: 'Bearer ' \+ t/);
  assert.match(js, /Price needs paid feed/);
  assert.match(js, /never live/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/, 'nothing is stored');
  /* Codex review of #689: the pin refresh, the card and each listings request keep their own generation */
  assert.match(js, /const my = \+\+pinSeq;/);
  assert.match(js, /const my = \+\+cardSeq; listSeq\+\+;/);
  assert.match(js, /if \(cardGen !== cardSeq \|\| my !== listSeq\) return;/);
  assert.match(js, /const cont = !!\(more && listing && listing\.key === key\);/);
  assert.doesNotMatch(js, /\bseq\b/, 'no shared generation counter is left');
});

test('Halo wires the Markets group, its picks and its lifecycle; the globe announces country taps', () => {
  const halo = read('js/halo/halo.js'), globe = read('js/action-globe.js');
  assert.match(halo, /\{ id: 'markets', name: 'Markets', icon: 'chart', items: \[\{ id: 'markets'/);
  assert.match(halo, /if \(id && id\.marketPick && markets\) return markets\.pick\(id\);/);
  assert.match(halo, /markets = V && window\.HaloMarkets \? HaloMarkets\.create\(G/);
  assert.match(halo, /if \(markets\) markets\.destroy\(\);/);
  assert.match(globe, /window\.dispatchEvent\(new CustomEvent\('hu:country',\{detail:c\}\)\)/);
  assert.ok(globe.indexOf("'js/halo/markets.js'") < globe.indexOf("'js/halo/halo.js'"), 'markets loads before the view mounts');
});

test('the card is mobile first: min-width queries only, no bare 1fr, 16px inputs, 44px targets', () => {
  const css = read('css/halo-markets.css');
  assert.doesNotMatch(css, /@media[^{]*max-width/);
  assert.doesNotMatch(css, /(?<!minmax\(0,\s*)\b1fr/, 'every 1fr is minmax(0,1fr)');
  assert.match(css, /\.hm__find input\{[^}]*font:400 max\(16px,1rem\)/);
  for (const sel of ['.hm__close{', '.hm__more{', '.hm__link{']) assert.match(css, new RegExp(sel.replace(/[.{]/g, '\\$&') + '[^}]*(height:44px|min-height:44px)'), sel);
  assert.match(css, /\.hm__ex button,\.hm__rows button\{[^}]*min-height:44px/);
});

test('the exchange reference set is placed, keyed by MIC and honest about its hours', () => {
  const d = JSON.parse(read('data/markets/exchanges.json'));
  assert.equal(d.schema, 'world-markets-exchanges/v1');
  assert.match(d.hours, /holidays/); assert.match(d.coordinates, /not where its listed companies operate/);
  const mics = new Set();
  for (const x of d.exchanges) {
    assert.match(x.mic, /^[A-Z0-9]{4}$/); assert.ok(!mics.has(x.mic), x.mic); mics.add(x.mic);
    assert.ok(Number.isFinite(x.lat) && Number.isFinite(x.lon) && Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180, x.mic);
    assert.match(x.country, /^[A-Z]{2}$/);
    assert.ok(x.sessions.every((s) => /^\d\d:\d\d$/.test(s[0]) && /^\d\d:\d\d$/.test(s[1]) && s[0] < s[1]), x.mic);
    new Intl.DateTimeFormat('en-US', { timeZone: x.timezone });
  }
  for (const m of ['XNYS', 'XNAS', 'XLON', 'XTKS', 'XSHG', 'XHKG', 'XNSE', 'XETR', 'XPAR', 'XTSE', 'XASX', 'BVMF', 'XJSE']) assert.ok(mics.has(m), m);
});
