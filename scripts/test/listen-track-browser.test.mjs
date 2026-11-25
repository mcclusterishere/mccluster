/* Run the real listening-room script with the published catalogue. These are
   DOM-output checks: a track hidden until search is not a browsable track. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const albums = JSON.parse(read('data/albums.json'));
const catalogue = JSON.parse(read('data/catalogue.json'));
const expected = albums.albums.flatMap((a) => a.tracks.map((t) => `${a.slug}|${t.title}`)).sort();
const settle = () => new Promise((resolve) => setImmediate(resolve));
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function room({ failCatalogue = false, delayAlbums = false } = {}) {
  const html = read('listen.html');
  const nodes = new Map();
  function node(id, tag = '') {
    if (!nodes.has(id)) {
      let text = '', inner = '';
      const listeners = new Map(), attrs = new Map();
      nodes.set(id, {
        id, hidden: /\bhidden(?:\s|>|=)/.test(tag), value: '',
        get textContent() { return text; }, set textContent(v) { text = String(v); inner = escape(v); },
        get innerHTML() { return inner; }, set innerHTML(v) { inner = String(v); text = decode(inner.replace(/<[^>]*>/g, '')); },
        addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
        dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); return true; },
        setAttribute(k, v) { attrs.set(k, String(v)); }, getAttribute(k) { return attrs.get(k) ?? null; },
        classList: { toggle() {}, add() {}, remove() {} }, focus() {},
        querySelector() { return null; }
      });
    }
    return nodes.get(id);
  }
  for (const [tag, id] of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) node(id, tag);
  const doc = {
    getElementById: (id) => nodes.get(id) || null,
    createElement: () => node(Symbol('element')),
    querySelectorAll: () => []
  };
  let releaseAlbums;
  const delayed = new Promise((resolve) => { releaseAlbums = resolve; });
  const storage = new Map();
  const window = {
    document: doc, console, Event, Promise, AbortSignal,
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (url) => {
      if (url === 'data/albums.json') {
        if (delayAlbums) await delayed;
        return { ok: !failCatalogue, status: failCatalogue ? 503 : 200, json: async () => albums };
      }
      if (url === 'data/catalogue.json') return { ok: true, json: async () => catalogue };
      // Optional ranking/affinity outages must not remove catalogue tracks.
      throw new Error('optional recommendations unavailable');
    }
  };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(read('js/music-credits.js'), context, { filename: 'js/music-credits.js' });
  vm.runInContext(read('js/listen.js'), context, { filename: 'js/listen.js' });
  return {
    node: (id) => nodes.get(id), releaseAlbums,
    async ready() { await settle(); await settle(); },
    search(value) { node('q').value = value; node('q').dispatchEvent(new Event('input')); },
    clear() { node('qClear').dispatchEvent(new Event('click')); },
    escape() { node('q').dispatchEvent({ type: 'keydown', key: 'Escape' }); },
    tracks() {
      return [...node('all').innerHTML.matchAll(/<button\b[^>]*\bdata-music-play\b[^>]*>/g)].map(([tag]) => {
        const album = /\bdata-album="([^"]*)"/.exec(tag)?.[1];
        const title = /\bdata-track="([^"]*)"/.exec(tag)?.[1];
        return `${decode(album)}|${decode(title)}`;
      }).sort();
    }
  };
}

test('opening Music lists every published album track with its existing playback identity', async () => {
  const r = room();
  await r.ready();
  assert.equal(r.node('allWrap').hidden, false, 'all tracks are visible before any search');
  assert.equal(r.node('allK').textContent, 'All tracks');
  assert.deepEqual(r.tracks(), expected, 'no album or track is silently omitted or duplicated');
  assert.equal(r.node('shelfWrap').hidden, false, 'albums remain browsable alongside the tracks');
  assert.equal(r.node('browseMusic').hidden, false, 'the section shortcuts are visible while browsing');
  assert.equal(r.node('count').hidden, false);
  assert.ok(r.node('count').textContent.includes(String(expected.length)), 'the count agrees with the complete list');
  // Held and gated songs remain listed; their existing player decides access.
  const held = albums.albums.flatMap((a) => a.tracks.filter((t) => t.hold).map((t) => `${a.slug}|${t.title}`));
  for (const id of held) assert.ok(r.tracks().includes(id), `held track stays discoverable: ${id}`);
});

test('title, album, credited artist and accent-insensitive searches filter the full track list', async () => {
  const r = room();
  await r.ready();
  for (const [query, wanted] of [
    ['Studio Trapped', ['audio-engineer|Studio Trapped']],
    ['Audio Engineer', expected.filter((id) => id.startsWith('audio-engineer|'))],
    ['Los Fidel', ['equity-uprise|Please Set Me Free']],
    ['Jiddy', expected.filter((id) => id.includes('Jiddy'))],
    ['VVS Made', ['heal-the-3|Deep End', 'heal-the-3|Heal the 3rd World']]
  ]) {
    r.search(query);
    assert.equal(r.node('allWrap').hidden, false, query);
    assert.equal(r.node('allK').textContent, 'Results', query);
    assert.equal(r.node('shelfWrap').hidden, true, 'search focuses the matches');
    assert.equal(r.node('browseMusic').hidden, true, 'hidden sections have no visible jump links');
    assert.deepEqual(r.tracks(), wanted.slice().sort(), query);
  }
});

test('clearing a search or pressing Escape restores every track; no matches stays visible', async () => {
  const r = room();
  await r.ready();
  r.search('there-is-no-record-with-this-title-6021');
  assert.equal(r.node('allWrap').hidden, false);
  assert.deepEqual(r.tracks(), []);
  assert.match(r.node('all').textContent, /No track|No match/i);
  r.clear();
  assert.equal(r.node('q').value, '');
  assert.equal(r.node('allK').textContent, 'All tracks');
  assert.deepEqual(r.tracks(), expected);
  r.search('Audio Engineer');
  r.escape();
  assert.equal(r.node('q').value, '');
  assert.equal(r.node('allWrap').hidden, false);
  assert.deepEqual(r.tracks(), expected);
});

test('typing before the catalogue answers preserves a visible loading or failure state', async () => {
  const r = room({ delayAlbums: true, failCatalogue: true });
  r.search('Audio Engineer');
  assert.equal(r.node('allWrap').hidden, false, 'the loading list does not disappear');
  assert.match(r.node('all').textContent, /Loading|Opening/i, 'pending data is not reported as no matches');
  r.releaseAlbums();
  await r.ready();
  assert.equal(r.node('allWrap').hidden, false, 'a catalogue failure is visible');
  assert.match(r.node('all').textContent, /refresh|try again|could not|couldn.t|unable/i);
  r.clear();
  assert.equal(r.node('allWrap').hidden, false);
  assert.match(r.node('all').textContent, /refresh|try again|could not|couldn.t|unable/i, 'clearing search does not erase the recovery message');
});
