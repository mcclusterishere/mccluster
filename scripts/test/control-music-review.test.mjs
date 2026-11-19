/* The real native Control music module, synthetic DOM and music-access replies.
   No service is contacted. MUSIC_REVIEW_SOURCE can point at the recovered
   module to run the same user actions before the repair. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(process.env.MUSIC_REVIEW_SOURCE || new URL('../../js/control-room/music-ops.js', import.meta.url), 'utf8');
const ID = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const BEFORE = '2026-11-19T12:00:00.000Z', PINNED = '2026-11-19T12:00:30.000Z';
const SB = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
const SHA = 'a'.repeat(64);
const track = () => ({ id: ID, title: 'Fixture release', artist: 'Fixture artist', status: 'pending_review', rights_status: 'attested', access_mode: 'account', updated_at: BEFORE });
const verified = (extra = {}) => ({ ok: true, track_id: ID, version_id: VERSION, expected_updated_at: BEFORE, sha256: SHA, sha256_short: SHA.slice(0, 12), size_bytes: 2048,
  listen_url: SB + '/storage/v1/object/sign/creator-masters/owner/review.wav?token=fixture-only', expires_in: 900, ...extra });
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const decode = s => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

class Element {
  constructor(tag = 'div', attrs = {}) { this.tagName = tag.toUpperCase(); this.attrs = attrs; this.disabled = Object.hasOwn(attrs, 'disabled'); this.nodes = []; this.pauses = 0; this.loads = 0; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  pause() { this.pauses++; }
  load() { this.loads++; }
  set innerHTML(html) {
    this.html = html; this.nodes = [];
    for (const m of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
      const attrs = {};
      for (const a of m[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
      this.nodes.push(new Element(m[1], attrs));
    }
  }
  get innerHTML() { return this.html || ''; }
  querySelectorAll(selector) {
    const tag = selector.match(/^[a-z]+/i)?.[0]?.toUpperCase();
    const attrs = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    return this.nodes.filter(n => (!tag || n.tagName === tag) && attrs.every(a => Object.hasOwn(n.attrs, a[1]) && (a[2] === undefined || n.attrs[a[1]] === a[2])));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

async function open() {
  const root = new Element(), listeners = new Map(), calls = [];
  const state = { account: 'account-a', token: 'fixture-a', tracks: [track()], prepare: null, decide: null, dashboard: null, renew: null };
  const window = { CR: {}, addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); } };
  const document = { querySelectorAll: selector => root.querySelectorAll(selector) };
  window.MCC_SUPA = { url: SB, key: 'fixture-publishable', uid: () => state.account, token: () => state.renew ? state.renew() : Promise.resolve(state.token) };
  const context = vm.createContext({ window, document, MCC_SUPA: window.MCC_SUPA, URL, console, prompt: () => 'Fixture review note', alert() {},
    fetch: async (url, init) => {
      assert.equal(url, SB + '/functions/v1/music-access');
      const body = JSON.parse(init.body); calls.push({ body, authorization: init.headers.authorization });
      if (body.action === 'operator-dashboard') return state.dashboard ? state.dashboard(body) : reply({ ok: true, tracks: state.tracks, creators: [], offers: [] });
      if (body.action === 'operator-review-prepare') return state.prepare ? state.prepare(body) : reply(verified({ expected_updated_at: state.tracks[0].updated_at }));
      if (body.action === 'operator-review') {
        if (state.decide) return state.decide(body);
        assert.equal(body.expected_updated_at, state.tracks[0].updated_at, 'the server expects the reviewed release version');
        assert.equal(body.expected_master_sha256, SHA, 'the server expects the verified bytes');
        state.tracks = [{ ...state.tracks[0], status: 'published', rights_status: 'cleared', updated_at: '2026-11-19T12:01:00.000Z' }];
        return reply({ ok: true, track: state.tracks[0] });
      }
      throw new Error('Unexpected music action: ' + body.action);
    }
  });
  vm.runInContext(source, context, { filename: 'js/control-room/music-ops.js' });
  const ops = window.CR.musicOps;
  const render = () => { root.innerHTML = ops.render(); ops.bind(root); };
  ops.init({ supa: async () => [], render });
  await ops.load();
  const q = selector => root.querySelector(selector);
  const click = selector => { const el = q(selector); assert.ok(el, 'rendered control exists: ' + selector); return el.onclick(); };
  const emit = (type, detail = {}) => { for (const fn of listeners.get(type) || []) fn({ type, ...detail }); };
  return { root, q, click, state, calls, ops, render, emit,
    prepare: () => click('[data-crom-prepare="' + ID + '"]'),
    publish: () => click('[data-crom-review="publish"][data-id="' + ID + '"]'),
    refresh: () => click('[data-crom-refresh]'),
    decisions: () => calls.filter(c => c.body.action === 'operator-review'),
    publishButton: () => q('[data-crom-review="publish"][data-id="' + ID + '"]') };
}

test('native Control requires verified audio and publishes the backend returned version and exact hash', async () => {
  const p = await open();
  assert.equal(p.publishButton().disabled, true);
  await p.publish();
  assert.equal(p.decisions().length, 0);
  await p.prepare();
  assert.equal(p.publishButton().disabled, false);
  assert.equal(p.q('[data-crom-audio]').getAttribute('src'), verified().listen_url);
  assert.match(p.root.innerHTML, /publishing approves exactly these bytes/);
  await p.publish();
  assert.equal(p.decisions().length, 1);
  assert.equal(p.decisions()[0].body.expected_updated_at, BEFORE, 'the returned version must match what the desk showed');
  assert.equal(p.decisions()[0].body.expected_master_sha256, SHA);
  assert.match(p.root.innerHTML, /Published\.<\/p>/);
  assert.match(p.root.innerHTML, /rights cleared/);
  assert.equal(p.publishButton().disabled, true, 'readback does not retain approval evidence for a second write');
});

test('repeated verification and publish taps retain one in-flight call', async () => {
  const p = await open(), prep = deferred();
  p.state.prepare = () => prep.promise;
  const first = p.prepare(); await flush();
  await p.prepare();
  assert.equal(p.calls.filter(c => c.body.action === 'operator-review-prepare').length, 1);
  prep.resolve(reply(verified())); await first;
  const save = deferred(); p.state.decide = () => save.promise;
  const write = p.publish(); await flush();
  await p.publish();
  assert.equal(p.decisions().length, 1);
  save.resolve(reply({ ok: true, track: { ...track(), status: 'published', rights_status: 'cleared' } })); await write;
});

test('failed verification removes earlier evidence and cannot leave Publish enabled', async () => {
  const p = await open(); await p.prepare();
  p.state.prepare = () => reply({ error: 'The master could not be read completely.' }, 502);
  await p.prepare();
  assert.equal(p.publishButton().disabled, true);
  assert.equal(p.q('[data-crom-audio]'), null);
  assert.match(p.root.innerHTML, /could not be read completely/);
  await p.publish(); assert.equal(p.decisions().length, 0);
});

test('a malformed preparation, wrong release or noncanonical audio never enables publication', async () => {
  for (const extra of [{ track_id: VERSION }, { sha256: 'bad' }, { version_id: {} }, { expected_updated_at: 'yesterday' },
    { listen_url: 'https://attacker.invalid/master.wav' }, { listen_url: SB + '/storage/v1/object/public/creator-previews/a.wav' },
    { listen_url: SB + '/storage/v1/object/sign/creator-masters/a.wav' }]) {
    const p = await open(); p.state.prepare = () => reply(verified(extra)); await p.prepare();
    assert.equal(p.publishButton().disabled, true, JSON.stringify(extra));
    assert.equal(p.q('[data-crom-audio]'), null); await p.publish(); assert.equal(p.decisions().length, 0);
  }
});

test('a loaded release changing while verification is pending cannot inherit the older preparation', async () => {
  const p = await open(), wait = deferred(); p.state.prepare = () => wait.promise;
  const pending = p.prepare(); await flush();
  p.ops.state.review.tracks[0].updated_at = '2026-11-19T12:01:00.000Z';
  wait.resolve(reply(verified())); await pending;
  assert.equal(p.publishButton().disabled, true);
  assert.match(p.root.innerHTML, /changed while its audio was verified/);
  await p.publish(); assert.equal(p.decisions().length, 0);
});

test('newer backend metadata cannot be published while the desk still shows the older release', async () => {
  const p = await open();
  p.state.tracks[0] = { ...track(), title: 'Revised release', updated_at: PINNED };
  await p.prepare();
  assert.equal(p.publishButton().disabled, true);
  assert.match(p.root.innerHTML, /changed while its audio was verified/);
  assert.doesNotMatch(p.root.innerHTML, /Revised release/);
  await p.publish(); assert.equal(p.decisions().length, 0);
  await p.refresh(); assert.match(p.root.innerHTML, /Revised release/);
  await p.prepare(); await p.publish();
  assert.equal(p.decisions().length, 1);
  assert.equal(p.decisions()[0].body.expected_updated_at, PINNED);
});

test('refreshing the queue discards cached preparation even when the displayed release version is unchanged', async () => {
  const p = await open(); await p.prepare(); await p.refresh();
  assert.equal(p.publishButton().disabled, true); assert.equal(p.q('[data-crom-audio]'), null);
  await p.publish(); assert.equal(p.decisions().length, 0);
});

test('a stale publication is not retried and requires fresh queue data and verification', async () => {
  const p = await open(); await p.prepare();
  p.state.decide = () => reply({ error: 'The release changed since you reviewed it.' }, 409);
  await p.publish();
  assert.equal(p.decisions().length, 1); assert.equal(p.publishButton().disabled, true);
  assert.equal(p.q('[data-crom-prepare]').disabled, true);
  await p.publish(); await p.prepare(); assert.equal(p.decisions().length, 1);
  p.state.tracks[0].updated_at = PINNED; await p.refresh();
  assert.equal(p.publishButton().disabled, true);
  assert.equal(p.q('[data-crom-prepare]').disabled, false);
  await p.prepare(); assert.equal(p.publishButton().disabled, false);
});

test('a committed publication with a lost response is read back without resending', async () => {
  const p = await open(); await p.prepare();
  p.state.decide = () => { p.state.tracks[0].status = 'published'; p.state.tracks[0].rights_status = 'cleared'; throw new Error('Connection lost after commit'); };
  await p.publish();
  assert.equal(p.decisions().length, 1); assert.equal(p.publishButton().disabled, true);
  assert.match(p.root.innerHTML, /outcome could not be confirmed/);
  await p.publish(); await p.prepare(); assert.equal(p.decisions().length, 1);
  await p.refresh();
  assert.match(p.root.innerHTML, /rights cleared/); assert.equal(p.decisions().length, 1);
  assert.equal(p.publishButton().disabled, true);
});

test('an accepted publication remains acknowledged when only its queue readback fails', async () => {
  const p = await open(); await p.prepare();
  p.state.decide = () => { p.state.dashboard = () => reply({ error: 'Readback temporarily unavailable.' }, 503); return reply({ ok: true, track: { ...track(), status: 'published', rights_status: 'cleared' } }); };
  await p.publish();
  assert.equal(p.decisions().length, 1);
  assert.match(p.root.innerHTML, /Published\.<\/p>/);
  assert.match(p.root.innerHTML, /Readback temporarily unavailable/);
  assert.equal(p.q('[data-crom-review="publish"]'), null);
});

test('changing account during token renewal prevents the old review from being sent', async () => {
  const p = await open(), renewed = deferred(); p.state.renew = () => renewed.promise;
  const pending = p.prepare(); await flush(); p.state.account = 'account-b'; p.state.token = 'fixture-b';
  p.emit('storage', { key: 'mccdb_session' }); renewed.resolve('fixture-b'); await pending;
  assert.equal(p.calls.filter(c => c.body.action === 'operator-review-prepare').length, 0);
  assert.equal(p.q('[data-crom-prepare]'), null);
});

test('a late verification cannot restore private audio after sign-out', async () => {
  const p = await open(), wait = deferred(); p.state.prepare = () => wait.promise;
  const pending = p.prepare(); await flush(); p.state.account = null; p.state.token = null;
  p.emit('mcc:auth-changed', { detail: { signed_in: false } }); wait.resolve(reply(verified())); await pending;
  assert.equal(p.q('[data-crom-audio]'), null); assert.equal(p.q('[data-crom-review="publish"]'), null);
  assert.equal(Object.keys(p.ops.state.review.prepared).length, 0);
  assert.doesNotMatch(p.root.innerHTML, /fixture-only/);
});

test('an account change stops and removes the prepared private player; a same-account refresh preserves it', async () => {
  const p = await open(); await p.prepare();
  p.state.token = 'fixture-a-refreshed'; p.emit('storage', { key: 'mccdb_session' });
  assert.equal(p.publishButton().disabled, false);
  const audio = p.q('[data-crom-audio]'); p.state.account = 'account-b'; p.state.token = 'fixture-b'; p.emit('storage', { key: 'mccdb_session' });
  assert.equal(audio.pauses, 1); assert.equal(audio.getAttribute('src'), null);
  assert.equal(p.q('[data-crom-audio]'), null); assert.equal(p.decisions().length, 0);
});

test('a music-operator denial removes the review rows and verification evidence', async () => {
  const p = await open(); await p.prepare();
  p.state.prepare = () => reply({ error: 'operator permission required' }, 403); await p.prepare();
  assert.equal(p.q('[data-crom-audio]'), null); assert.equal(p.q('[data-crom-review="publish"]'), null);
  assert.match(p.root.innerHTML, /operator permission required/); assert.equal(p.decisions().length, 0);
});

test('a malformed success response never claims publication or permits an immediate retry', async () => {
  const p = await open(); await p.prepare();
  p.state.decide = () => reply({ ok: true, track: { id: ID } }); await p.publish();
  assert.match(p.root.innerHTML, /outcome could not be confirmed/);
  assert.doesNotMatch(p.root.innerHTML, /Published\.<\/p>/);
  await p.publish(); assert.equal(p.decisions().length, 1);
});

test('a publication response for the previous account cannot restore its receipt or queue', async () => {
  const p = await open(); await p.prepare();
  const wait = deferred(); p.state.decide = () => wait.promise;
  const pending = p.publish(); await flush();
  p.state.account = 'account-b'; p.state.token = 'fixture-b'; p.emit('storage', { key: 'mccdb_session' });
  wait.resolve(reply({ ok: true, track: { ...track(), status: 'published', rights_status: 'cleared' } })); await pending;
  assert.equal(p.decisions().length, 1);
  assert.equal(p.q('[data-crom-review="publish"]'), null);
  assert.doesNotMatch(p.root.innerHTML, /Published\.<\/p>|Fixture release|fixture-only/);
  assert.equal(p.calls.filter(c => c.body.action === 'operator-dashboard').length, 1, 'the old response starts no read for the new account');
});

test('a failed queue read cannot release a publication still in flight', async () => {
  const p = await open(); await p.prepare();
  const pending = deferred(); p.state.decide = () => pending.promise;
  const save = p.publish(); await flush();
  /* Another existing Music action can request a reload while this write is
     pending. A failed read removes stale rows, but must keep its write lock. */
  p.state.dashboard = () => reply({ error: 'Queue read failed' }, 503); await p.ops.load();
  assert.equal(p.q('[data-crom-review="publish"]'), null);
  assert.equal(p.q('[data-crom-refresh]').disabled, true);
  p.state.dashboard = null; await p.ops.load();
  assert.equal(p.publishButton().disabled, true); assert.equal(p.q('[data-crom-prepare]').disabled, true);
  await p.prepare(); await p.publish(); assert.equal(p.decisions().length, 1);
  pending.resolve(reply({ ok: true, track: { ...track(), status: 'published', rights_status: 'cleared' } })); await save;
  assert.equal(p.q('[data-crom-refresh]').disabled, false);
});
