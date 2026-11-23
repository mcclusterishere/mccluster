/* CREATOR STUDIO PUBLISHES AND IS MEASURED (music slice M6, 2026-11-19).
   ============================================================
   Owner, 2026-11-19: "The Creator Studio isn't really wired up and finished."
   The studio lane (C6) found why: the only live review screen sent a publish
   with no version and no audio hash, so music-access answered 400 and nothing
   a creator submitted could ever go live (ST-1); a creator could not touch a
   release once it was submitted (ST-10); creator.html loaded no analytics, so
   the studio's own events never recorded (G-5); the Control Room's music vault
   read tables that exist nowhere and failed without saying so (L-1); and no
   shared door led a creator to the studio (L-11).

   The review desk runs here as it runs in the Control Room: the real
   js/control-room/music-ops.js in a Node vm, its rendered buttons clicked, its
   requests answered by the REAL music-access handler (supabase/functions/
   music-access/index.ts, the repository's Edge test pattern: the handler is
   lifted out of the file, its TypeScript stripped, and run in a vm with a stub
   database client). So a publish either reaches music_operator_review with the
   version and the hash the reviewer saw, or it does not. The lane probes these
   come from: probes/studio/p2-edge/control-room-click.mjs (the alert
   "expected_updated_at required") and probes/studio/p2-edge/run.ts (400; the
   desk's body must reach music_operator_review).

   The browser half (submit, review, publish, the artist page at 390 px, the
   studio's events with and without consent, the door) is
   scripts/e2e/music-creator-release.e2e.mjs. The database half (what a creator
   may change on a release they submitted) is
   supabase/tests/music_creator_releases.behaviour.sql.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import * as delivery from '../../supabase/functions/music-access/delivery.ts';
import * as reviewAudio from '../../supabase/functions/music-access/review-audio.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const require = createRequire(import.meta.url);

/* Invented fixtures, no real member data. */
const OWNER = 'u-owner';
const CREATOR = 'u-creator';
const TRACK = '11111111-1111-4111-8111-111111111111';
const SHA = 'a'.repeat(52) + '0123456789ab';
const SB = 'https://project.invalid';

/* ---------- the database music-access talks to (the rules of the applied SQL, kept small) ---------- */
function plane() {
  const calls = [];
  const tracks = [{
    id: TRACK, m_uid: 'm-creator', uid: CREATOR, title: 'Pending song', artist: 'Fixture Artist', status: 'pending_review',
    rights_status: 'attested', access_mode: 'account', genre: '', music_video_url: '', lyrics_url: '', experience: {},
    master_path: CREATOR + '/m-master.wav', created_at: '2026-11-19T00:00:00.000000+00:00', updated_at: '2026-11-19T00:00:01.000001+00:00',
    published_at: null, moderation_note: ''
  }];
  let tick = 2;
  const later = () => '2026-11-19T00:00:' + String(tick++).padStart(2, '0') + '.000001+00:00';
  function result(q) {
    calls.push({ table: q.table, op: q.op, filters: q.filters });
    if (q.table === 'm_auth_user_links') return { data: [{ m_uid: q.filters.auth_user_id === OWNER ? 'm-owner' : 'm-creator' }], error: null };
    if (q.table === 'orgs') return { data: { id: 'org-house' }, error: null };
    if (q.table === 'creator_tracks') return { data: tracks.filter((t) => !q.inStatus || q.inStatus.includes(t.status)).map((t) => ({ ...t })), error: null };
    if (q.table === 'music_creator_profiles') return { data: [{ m_uid: 'm-creator', handle: 'fixture-artist', artist_name: 'Fixture Artist', status: 'active', settings: {} }], error: null };
    if (q.table === 'music_license_offers') return { data: [], error: null };
    return { data: [], error: null };
  }
  function chain(table) {
    const q = { table, op: 'select', filters: {}, inStatus: null };
    const api = {
      select() { return api; }, insert() { q.op = 'insert'; return api; }, update() { q.op = 'update'; return api; },
      eq(k, v) { q.filters[k] = v; return api; }, in(k, v) { if (k === 'status') q.inStatus = v; return api; },
      is() { return api; }, order() { return api; }, limit() { return api; },
      maybeSingle() { return Promise.resolve(result(q)); }, single() { return Promise.resolve(result(q)); },
      then(ok, bad) { return Promise.resolve(result(q)).then(ok, bad); }
    };
    return api;
  }
  async function rpc(fn, args) {
    calls.push({ rpc: fn, args });
    if (fn === 'control_authorize_service') return { data: [{ allowed: args.p_actor === OWNER }], error: null };
    const t = tracks.find((x) => x.id === args.p_track);
    if (fn === 'music_prepare_review') {
      if (!t) return { data: null, error: { message: 'track_not_found' } };
      if (!['pending_review', 'rejected', 'approved', 'published'].includes(t.status)) return { data: null, error: { message: 'release_not_in_review' } };
      return { data: [{ track_id: t.id, track_status: t.status, track_updated_at: t.updated_at, version_id: 'v-1', bucket_id: 'creator-masters',
        object_name: t.master_path, size_bytes: 4321, etag: 'e1', content_sha256: SHA, invalidated: false, invalid_reason: null, identity_intact: true }], error: null };
    }
    if (fn === 'music_operator_review') {
      /* public.music_operator_review (20261030001000, applied): publish and approve need the version and the hash */
      if (['publish', 'approve'].includes(args.p_decision)) {
        if (!args.p_expected_updated_at) return { data: null, error: { message: 'review_expected_updated_at_required' } };
        if (!/^[0-9a-f]{64}$/.test(String(args.p_expected_master_sha256 || ''))) return { data: null, error: { message: 'release_master_hash_required' } };
      }
      if (!t || (args.p_expected_updated_at && args.p_expected_updated_at !== t.updated_at)) return { data: null, error: null };
      if (['publish', 'approve'].includes(args.p_decision) && args.p_expected_master_sha256 !== SHA) return { data: null, error: { message: 'release_master_hash_mismatch' } };
      t.status = { publish: 'published', approve: 'approved', reject: 'rejected', review: 'pending_review' }[args.p_decision];
      t.moderation_note = args.p_note || '';
      t.updated_at = later();
      return { data: { id: t.id, title: t.title, status: t.status, updated_at: t.updated_at, master_sha256: SHA }, error: null };
    }
    return { data: null, error: { message: 'stub: rpc ' + fn + ' not answered' } };
  }
  const db = {
    auth: { async getUser(token) {
      if (token === 'owner-token') return { data: { user: { id: OWNER, email: '' } }, error: null };
      if (token === 'creator-token') return { data: { user: { id: CREATOR, email: '' } }, error: null };
      return { data: { user: null }, error: { message: 'bad token' } };
    } },
    from: chain,
    rpc,
    storage: { from: (bucket) => ({
      async createSignedUrl(path, expires) { calls.push({ sign: bucket + '/' + path, expires }); return { data: { signedUrl: SB + '/storage/v1/object/sign/' + bucket + '/' + path + '?token=fixture' }, error: null }; },
      async createSignedUploadUrl(path) { return { data: { path, token: 'tok', signedUrl: SB + '/upload' }, error: null }; }
    }) }
  };
  return { db, calls, tracks, later };
}

/* ---------- music-access, as deployed from this repository: the handler, lifted out and run ---------- */
function musicAccess(db) {
  const src = read('supabase/functions/music-access/index.ts').replace(/^import\s[^\n]*\n/gm, '');
  const code = stripTypeScriptTypes(src, { mode: 'strip' });
  let handler = null;
  const context = {
    Deno: { env: { get: (k) => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-fixture' })[k] }, serve: (h) => { handler = h; } },
    createClient: () => db, ...delivery, ...reviewAudio,
    Response, Request, Headers, URL, crypto: globalThis.crypto, Error, Promise, JSON, Number, String, Array, Object, RegExp, Date, Math,
    fetch: () => Promise.reject(new Error('no network in this test')),
    console: { error() {}, log() {}, warn() {} }
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'music-access/index.ts' });
  assert.equal(typeof handler, 'function', 'music-access registers its handler');
  return handler;
}

/* ---------- the Control Room's music desk, rendered and clicked ---------- */
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function parseSelector(sel) {
  const out = [];
  const re = /\[([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?\]/g;
  let m;
  while ((m = re.exec(sel))) out.push([m[1], m[2] === undefined ? null : m[2]]);
  return out;
}
function dom(html) {
  const els = [];
  const tag = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m;
  while ((m = tag.exec(html))) {
    const attrs = {};
    const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
    let a;
    while ((a = ar.exec(m[2]))) attrs[a[1]] = a[2] === undefined ? '' : decode(a[2]);
    const after = html.slice(tag.lastIndex);
    const el = {
      tagName: m[1].toUpperCase(), attrs, textContent: decode(after.slice(0, after.indexOf('<'))), onclick: null,
      disabled: Object.prototype.hasOwnProperty.call(attrs, 'disabled'),
      getAttribute(n) { return Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null; },
      setAttribute(n, v) { attrs[n] = String(v); },
      hasAttribute(n) { return Object.prototype.hasOwnProperty.call(attrs, n); }
    };
    els.push(el);
  }
  const match = (el, sel) => parseSelector(sel).every(([n, v]) => el.hasAttribute(n) && (v === null || el.getAttribute(n) === v));
  return {
    all: els,
    querySelectorAll(sel) { return els.filter((el) => match(el, sel)); },
    querySelector(sel) { return els.find((el) => match(el, sel)) || null; }
  };
}
async function desk({ vault } = {}) {
  const p = plane();
  const handler = musicAccess(p.db);
  const sent = [];
  const alerts = [];
  let inFlight = 0;
  const window = {
    CR: {},
    MCC_SUPA: { url: SB, key: 'publishable-fixture', token: () => Promise.resolve('owner-token') },
    fetch(url, init) {
      inFlight++;
      let body = null;
      try { body = JSON.parse(init && init.body || 'null'); } catch (_) {}
      sent.push({ url: String(url), body });
      return Promise.resolve(handler(new Request(url, init))).finally(() => { inFlight--; });
    },
    prompt: () => 'Needs a clearer rights note',
    confirm: () => true,
    alert: (m) => alerts.push(String(m)),
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, CSS: { escape: (s) => s }
  };
  window.window = window;
  vm.createContext(window);
  vm.runInContext(read('js/control-room/music-ops.js'), window, { filename: 'music-ops.js' });
  const ops = window.CR.musicOps;
  /* the Control Room's own PostgREST helper (js/control-room-v2.js supa): the status travels with the error */
  const supa = (path) => {
    if (/^vault_/.test(path) && vault) return Promise.reject(Object.assign(new Error(vault.message), { status: vault.status, detail: vault.detail }));
    return Promise.resolve([]);
  };
  ops.init({ supa, render: () => {} });
  let view = null;
  const paint = () => { const html = ops.render(); view = dom(html); view.html = html; ops.bind(view); return view; };
  const settle = async () => { for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 0)); if (!inFlight && i > 5) break; } };
  await ops.load();
  await settle();
  paint();
  return {
    ops, sent, alerts, plane: p, paint, settle,
    get view() { return view; },
    section(name) { const b = view.querySelector('[data-crom-section="' + name + '"]'); assert.ok(b, 'section tab ' + name); b.onclick(); return paint(); },
    async click(el) { assert.ok(el, 'a control to click'); assert.equal(el.disabled, false, 'the control is enabled'); el.onclick({ preventDefault() {} }); await settle(); paint(); }
  };
}
const reviewButton = (v, decision) => v.querySelector('[data-crom-review="' + decision + '"][data-id="' + TRACK + '"]');
const operatorReviews = (calls) => calls.filter((c) => c.rpc === 'music_operator_review');

/* ---------------- ST-1: the live review button publishes through the hash-checked review ---------------- */

test('the live desk never publishes a release nobody listened to: Publish waits for Verify + listen (ST-1, D-12)', async () => {
  const d = await desk();
  const publish = reviewButton(d.view, 'publish');
  assert.ok(publish, 'the queued release has a Publish button');
  assert.equal(publish.disabled, true, 'Publish is disabled until the reviewer verified and heard the audio');
  assert.match(publish.getAttribute('title') || '', /verify/i, 'and says why');
  assert.ok(d.view.querySelector('[data-crom-prepare="' + TRACK + '"]'), 'a Verify + listen button for the queued release');
});

test('Verify + listen plays the pinned master, and Publish reaches music_operator_review with the version and the hash (ST-1; probes p2-edge)', async () => {
  const d = await desk();
  await d.click(d.view.querySelector('[data-crom-prepare="' + TRACK + '"]'));
  const prepare = d.sent.find((s) => s.body && s.body.action === 'operator-review-prepare');
  assert.ok(prepare, 'the desk asked music-access to pin and hash the master under review');
  assert.equal(prepare.body.track_id, TRACK);
  const audio = d.view.all.find((el) => el.tagName === 'AUDIO');
  assert.ok(audio, 'the reviewer gets a player');
  assert.match(audio.getAttribute('src'), /\/storage\/v1\/object\/sign\/creator-masters\/u-creator\/m-master\.wav/, 'for the pinned master, signed by music-access');
  assert.ok(d.view.html.includes(SHA.slice(0, 12)), 'the desk shows the hash of the bytes it plays');
  const publish = reviewButton(d.view, 'publish');
  assert.equal(publish.disabled, false, 'Publish is open once the audio was verified');
  await d.click(publish);
  assert.deepEqual(d.alerts, [], 'no refusal: ' + d.alerts.join(' | '));
  const review = d.sent.find((s) => s.body && s.body.action === 'operator-review');
  assert.equal(review.body.decision, 'publish');
  assert.equal(review.body.expected_updated_at, '2026-11-19T00:00:01.000001+00:00', 'the version the reviewer saw');
  assert.equal(review.body.expected_master_sha256, SHA, 'the hash of the bytes the reviewer heard');
  const rpc = operatorReviews(d.plane.calls);
  assert.equal(rpc.length, 1, 'the request reached music_operator_review');
  assert.equal(rpc[0].args.p_expected_updated_at, '2026-11-19T00:00:01.000001+00:00');
  assert.equal(rpc[0].args.p_expected_master_sha256, SHA);
  assert.equal(d.plane.tracks[0].status, 'published', 'the release is published');
});

test('the owner\'s Publish never comes back as "expected_updated_at required" (probe p2-edge/control-room-click)', async () => {
  const d = await desk();
  /* the probe clicked Publish on the live desk and the owner got that alert, every time, reload or not */
  const verify = d.view.querySelector('[data-crom-prepare="' + TRACK + '"]');
  if (verify) await d.click(verify);
  const publish = reviewButton(d.view, 'publish');
  publish.onclick({ preventDefault() {} });
  await d.settle();
  d.paint();
  assert.deepEqual(d.alerts.filter((a) => /expected_updated_at required|expected_master_sha256 required/.test(a)), [], 'the desk sent what music-access requires');
  assert.equal(operatorReviews(d.plane.calls).length, 1, 'and the decision reached music_operator_review');
});

test('Needs review and Reject carry the version the desk showed (ST-1)', async () => {
  for (const decision of ['review', 'reject']) {
    const d = await desk();
    await d.click(reviewButton(d.view, decision));
    const review = d.sent.find((s) => s.body && s.body.action === 'operator-review');
    assert.equal(review.body.decision, decision);
    assert.equal(review.body.expected_updated_at, '2026-11-19T00:00:01.000001+00:00', decision + ' is about the version on screen');
    assert.equal(review.body.note, 'Needs a clearer rights note');
    assert.equal(operatorReviews(d.plane.calls)[0].args.p_expected_updated_at, '2026-11-19T00:00:01.000001+00:00');
    assert.deepEqual(d.alerts, []);
  }
});

test('a release that changed after it was verified is verified again before it can be published (ST-1)', async () => {
  const d = await desk();
  await d.click(d.view.querySelector('[data-crom-prepare="' + TRACK + '"]'));
  assert.equal(reviewButton(d.view, 'publish').disabled, false);
  /* the creator edits the release while it sits in the queue: updated_at moves on */
  d.plane.tracks[0].title = 'Pending song (edited)';
  d.plane.tracks[0].updated_at = d.plane.later();
  await d.ops.load();
  await d.settle();
  d.paint();
  assert.equal(reviewButton(d.view, 'publish').disabled, true, 'the earlier listen was of another version');
  assert.equal(d.view.all.filter((el) => el.tagName === 'AUDIO').length, 0, 'and its player is gone');
});

test('music-access still refuses a publish without the version and the hash, and never calls the database for it (guard)', async () => {
  const p = plane();
  const handler = musicAccess(p.db);
  const res = await handler(new Request(SB + '/functions/v1/music-access', { method: 'POST', headers: { authorization: 'Bearer owner-token', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'operator-review', track_id: TRACK, decision: 'publish', note: '' }) }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /expected_updated_at required/);
  assert.equal(operatorReviews(p.calls).length, 0);
  const creator = await handler(new Request(SB + '/functions/v1/music-access', { method: 'POST', headers: { authorization: 'Bearer creator-token', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'operator-review', track_id: TRACK, decision: 'publish', note: '', expected_updated_at: 'x', expected_master_sha256: SHA }) }));
  assert.equal(creator.status, 403, 'a creator cannot review, their own release included');
});

/* ---------------- L-1: the vault that is not there says so ---------------- */

const MISSING = { status: 404, message: "Could not find the table 'public.vault_assets' in the schema cache", detail: { code: 'PGRST205', message: "Could not find the table 'public.vault_assets' in the schema cache" } };

test('the music vault says plainly that it is not set up yet, and offers no controls that cannot save (L-1)', async () => {
  const d = await desk({ vault: MISSING });
  for (const section of ['catalog', 'distribution']) {
    const v = d.section(section);
    assert.match(v.html, /not set up yet/i, section + ': the screen says the vault is not set up');
    for (const control of ['data-crom-asset-status', 'data-crom-clear', 'data-crom-savehouse', 'data-crom-savecred', 'data-crom-toggle', 'data-crom-face']) {
      assert.equal(v.querySelectorAll('[' + control + ']').length, 0, section + ': no ' + control + ' control');
    }
    assert.doesNotMatch(v.html, /Some music sources failed/, section + ': not a vague failure');
  }
  const review = d.section('review');
  assert.doesNotMatch(review.html, /Some music sources failed|not set up yet/, 'release review does not depend on the vault');
  assert.ok(reviewButton(review, 'publish'), 'and still lists the queue');
});

test('a vault that answers with another error says it could not be read, on its own tabs only (L-1)', async () => {
  const d = await desk({ vault: { status: 503, message: 'upstream timeout', detail: { message: 'upstream timeout' } } });
  const catalog = d.section('catalog');
  assert.match(catalog.html, /could not be read/i);
  assert.match(catalog.html, /upstream timeout/);
  assert.doesNotMatch(d.section('review').html, /upstream timeout|could not be read/);
});

/* ---------------- G-5, D-17: the studio is measured, under the same consent rule ---------------- */

test('creator.html loads js/analytics.js once, before the shared auth and the studio, as every music page does (G-5, D-17)', () => {
  const html = read('creator.html');
  const tags = html.match(/<script[^>]+src="js\/analytics\.js[^"]*"[^>]*><\/script>/g) || [];
  assert.equal(tags.length, 1, 'one analytics script');
  assert.ok(html.indexOf('js/analytics.js') < html.indexOf('js/mcc-auth.js'), 'before the shared auth, as listen.html loads it');
  assert.ok(html.indexOf('js/analytics.js') < html.indexOf('js/music-creator-studio.js'), 'before the studio module');
  const listen = read('listen.html');
  assert.ok(listen.indexOf('js/analytics.js') < listen.indexOf('js/mcc-auth.js'), 'the same order as listen.html');
  /* the studio's events are the ones the owner reads in Analytics */
  const studio = read('js/music-creator-studio.js');
  for (const name of ['creator_track_submitted', 'creator_profile_saved', 'creator_onboarded']) assert.match(studio, new RegExp('MCC_TRACK\\("' + name + '"'));
});

function storage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); }, key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; }
  };
}
test('without agreement to the privacy notice the studio\'s events are skipped: nothing sent, nothing kept (D-17)', () => {
  const sent = [];
  const local = storage({ mcc_privacy_seen: JSON.stringify({ version: '2026-10-19', at: 1 }), 'mcc_event_outbox_v1:00000000-0000-4000-8000-000000000001': '{}' });
  const window = {
    localStorage: local, sessionStorage: storage(), document: { cookie: '' },
    navigator: { sendBeacon: () => { sent.push('beacon'); return true; } },
    fetch: () => { sent.push('fetch'); return Promise.resolve({}); },
    location: new URL('https://matthew.mccluster.org/creator.html'), Date, JSON, console
  };
  window.window = window;
  window.parent = window;
  vm.createContext(window);
  vm.runInContext(read('js/analytics.js'), window, { filename: 'analytics.js' });
  assert.equal(window.MCC_TRACK('creator_track_submitted', { track_id: TRACK, access_mode: 'account' }), false, 'the call is a no-op');
  assert.equal(window.MCC_TRACK('creator_profile_saved', {}), false);
  assert.deepEqual(sent, [], 'no request leaves the page');
  assert.equal([...local.map.keys()].filter((k) => k.startsWith('mcc_event_outbox_v1:')).length, 0, 'and an outbox left from before is cleared');
});

/* ---------------- ST-10: creators manage their own pending releases ---------------- */

const PAGE = require('../../js/music-creator-page.js');

test('a creator\'s own release offers what the database allows for its state, and nothing else (ST-10)', () => {
  assert.equal(typeof PAGE.releaseActions, 'function', 'MCC_CREATOR_PAGE.releaseActions');
  assert.deepEqual(PAGE.releaseActions({ status: 'pending_review', rights_status: 'attested' }), ['edit', 'withdraw']);
  assert.deepEqual(PAGE.releaseActions({ status: 'draft', rights_status: 'attested' }), ['resubmit', 'delete'], 'a withdrawn release goes back to review or away');
  assert.deepEqual(PAGE.releaseActions({ status: 'draft', rights_status: 'incomplete' }), ['delete'], 'an unattested draft is never sent to review from here');
  assert.deepEqual(PAGE.releaseActions({ status: 'draft', rights_status: 'review' }), ['resubmit', 'delete'], 'a release withdrawn while held for review can go back');
  assert.deepEqual(PAGE.releaseActions({ status: 'rejected', rights_status: 'disputed' }), [], 'a rejection is not erased from here (the owner decides)');
  for (const status of ['approved', 'published', 'archived', '', null]) {
    assert.deepEqual(PAGE.releaseActions({ status, rights_status: 'cleared' }), [], 'nothing on a ' + status + ' release (a change would take it off the air)');
  }
});

test('an edit to a pending release changes its words and links only, bounded (ST-10)', () => {
  assert.equal(typeof PAGE.releaseEdit, 'function', 'MCC_CREATOR_PAGE.releaseEdit');
  const long = 'x'.repeat(5000);
  const edit = PAGE.releaseEdit({
    title: '  New title  ', artist: ' Fixture Artist ', genre: long, description: long, music_video_url: ' https://video.example/v ', lyrics_url: '',
    status: 'published', rights_status: 'cleared', access_mode: 'public', master_path: 'other/x.wav', audio_url: 'https://evil.example/a.mp3', m_uid: 'x'
  });
  assert.deepEqual(Object.keys(edit).sort(), ['artist', 'description', 'genre', 'lyrics_url', 'music_video_url', 'title']);
  assert.equal(edit.title, 'New title');
  assert.equal(edit.artist, 'Fixture Artist');
  assert.equal(edit.genre.length, 80);
  assert.equal(edit.description.length, 2000);
  assert.equal(edit.music_video_url, 'https://video.example/v');
  assert.equal(PAGE.releaseEdit({ title: '   ' }), null, 'a release keeps a title');
});

test('Creator Studio asks the database for exactly those changes, on the version and state on screen (ST-10)', () => {
  const js = read('js/music-creator-studio.js');
  assert.match(js, /creator_tracks\?m_uid=eq\.[\s\S]{0,120}&select=[^"]*\bupdated_at\b/, 'the list knows each release\'s version');
  assert.match(js, /PAGE\.releaseActions\(/, 'the controls come from the shared rule');
  assert.match(js, /status=eq\.pending_review&updated_at=eq\./, 'an edit applies only to the pending version on screen');
  assert.match(js, /JSON\.stringify\(\{ status: "draft" \}\)/, 'withdraw takes the release out of review (status draft)');
  assert.match(js, /status=eq\.draft&rights_status=in\.\(attested,review\)/, 'submit again only for a withdrawn release that was in review');
  assert.match(js, /"creator_tracks\?id=eq\." \+ enc\(t\.id\) \+ "&status=eq\.draft", \{\s*method: "DELETE"/, 'delete only a draft, and only while it is one');
  const html = read('creator.html');
  assert.match(html, /id="creatorTracks"/);
});

/* ---------------- L-11: a Creator Studio door where creators look for it ---------------- */

const ONBOARD = require('../../js/creator-onboarding.js');
function viewer({ signedIn = true, owner = false, answer = { ok: true, creator: true } } = {}) {
  const asked = [];
  return {
    asked,
    document: { body: { hasAttribute: (n) => n === 'data-appbar-admin' && owner }, readyState: 'complete', querySelectorAll: () => [], addEventListener() {} },
    addEventListener() {},
    MCC: {
      session: () => (signedIn ? { access_token: 'creator-token' } : null),
      authFetch: (url) => { asked.push(String(url)); return answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer), text: () => Promise.resolve(JSON.stringify(answer)) }); },
      mUid: () => Promise.resolve('m-creator')
    }
  };
}
test('the studio door is shown to signed-in creators and to the house owner only (L-11)', async () => {
  assert.equal(typeof ONBOARD.studioDoor, 'function', 'MCC_CREATOR_ONBOARD.studioDoor');
  assert.equal(await ONBOARD.studioDoor(viewer()), true, 'a creator, by the server\'s answer');
  const member = viewer({ answer: { ok: true, creator: false } });
  assert.equal(await ONBOARD.studioDoor(member), false, 'a member who is not a creator');
  assert.ok(member.asked.some((u) => /\/rest\/v1\/rpc\/music_creator_state$/.test(u)), 'asked music_creator_state');
  const guest = viewer({ signedIn: false });
  assert.equal(await ONBOARD.studioDoor(guest), false, 'a guest');
  assert.deepEqual(guest.asked, [], 'and a guest costs no request');
  assert.equal(await ONBOARD.studioDoor(viewer({ owner: true, answer: { ok: true, creator: false } })), true, 'the house owner, by the bar\'s own server check');
  assert.equal(await ONBOARD.studioDoor(viewer({ answer: new Error('offline') })), false, 'an unanswered question shows nothing');
});

test('the door lives in the signed-in Profile menu, on Matthew\'s property\'s music pages only, never on the World (L-11)', () => {
  const nav = read('js/site-navigation.js');
  assert.match(nav, /Creator Studio/, 'the Profile menu names Creator Studio');
  assert.match(nav, /new URL\(house, location\.href\)\.origin === location\.origin/, 'only where the house is this origin: never on the World hosts');
  assert.match(nav, /music-creator-terms/, 'only on the music pages');
  assert.match(nav, /studioDoor\(window\)/, 'decided by the music module (creators) or the bar (the owner)');
  assert.doesNotMatch(read('js/tabbar.js'), /Creator Studio/, 'nothing added to the bar\'s tabs or wings');
});
