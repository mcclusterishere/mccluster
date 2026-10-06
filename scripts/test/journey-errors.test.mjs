/* The errors visitors hit in their journeys (docs/control-plane/JOURNEY-ERRORS.md).
   Each fix is held here: the collector's dead-click and error-origin rules
   are lifted out of js/analytics.js and run, the requests that could only
   fail stay gone, and the pages keep saying what happened instead of
   swallowing it. The database side (anon policy scope, lean music reads,
   listener_state) is proven by supabase/tests/journey_errors_regression.sql. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';

const read = (p) => readFile(p, 'utf8');
function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `could not find ${from} … ${to}`);
  return src.slice(a, b);
}
async function collector() {
  const src = await read('js/analytics.js');
  const code = 'function safe(fn) { try { return fn(); } catch (e) { return null; } }\n' +
    slice(src, 'function deadEligible(el, d)', 'doc.addEventListener("click"') +
    slice(src, 'var INJECTED =', 'function stackTop(err)');
  const context = { URL, location: new URL('https://matthew.mccluster.org/album.html?album=here') };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}
const node = (attrs = {}, extra = {}) => ({
  getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs, target: attrs.target || '', isContentEditable: false, ...extra
});

test('dead clicks: fields, labels and links that leave are never dead; controls that must answer are', async () => {
  const C = await collector();
  for (const tag of ['input', 'textarea', 'select', 'label']) assert.equal(C.deadEligible(node(), { tag }), false, `${tag} takes focus before the click`);
  assert.equal(C.deadEligible(node({}, { isContentEditable: true }), { tag: 'div', cta: 'x' }), false);
  assert.equal(C.deadEligible(node({ href: '/listen.html' }), { tag: 'a' }), false, 'a link to another page is already navigating');
  assert.equal(C.deadEligible(node({ href: 'https://instagram.com/x', target: '_blank' }), { tag: 'a' }), false);
  assert.equal(C.deadEligible(node({ href: 'mailto:x@example.com' }), { tag: 'a' }), false);
  assert.equal(C.deadEligible(node({ href: '/x.pdf', download: '' }), { tag: 'a' }), false);
  assert.equal(C.deadEligible(node({ href: '#tracks' }), { tag: 'a' }), true, 'an in-page link must visibly answer');
  assert.equal(C.deadEligible(node({ href: '?album=here' }), { tag: 'a' }), true, 'a link back to this exact page must answer');
  assert.equal(C.deadEligible(node(), { tag: 'button' }), true);
  assert.equal(C.deadEligible(node({ role: 'button' }), { tag: 'div' }), true);
  assert.equal(C.deadEligible(node(), { tag: 'div' }), false);
});

test('errors say whose they are: injected, opaque, third-party or the site’s own', async () => {
  const C = await collector();
  assert.equal(C.errorOrigin('https://matthew.mccluster.org/album.html', "TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers')"), 'injected');
  assert.equal(C.errorOrigin('', 'Error: Java object is gone'), 'injected');
  assert.equal(C.errorOrigin('', "ReferenceError: Can't find variable: _AutofillCallbackHandler"), 'injected');
  assert.equal(C.errorOrigin('iabjs://navigation_performance_logger_android', 'x'), 'injected');
  assert.equal(C.errorOrigin('', 'Script error.'), 'opaque');
  assert.equal(C.errorOrigin('https://cdn.example.net/lib.js', 'boom'), 'third_party');
  assert.equal(C.errorOrigin('https://matthew.mccluster.org/js/filament.js', 'boom'), 'site');
  const src = await read('js/analytics.js');
  assert.match(src, /T\("js_error", \{[^}]*origin: errorOrigin\(e\.filename, e\.message\),[^}]*iab: IAB,[^}]*stack: stackTop\(e\.error\)/s);
  assert.match(src, /T\("js_rejection", \{[^}]*origin:[^}]*iab: IAB/s);
  const sdk = await read('js/mc-analytics.js');
  assert.match(sdk, /js_error[\s\S]{0,200}msg/, 'the tenant SDK sends the message too');
});

test('requests that could only fail are gone', async () => {
  const signals = await read('js/signals.js');
  assert.doesNotMatch(signals, /rest\/v1\/crm_signals|fetch\(/, 'signals no longer post to a table that does not exist');
  assert.match(signals, /window\.MCC_TRACK\("desk_signal"/);
  const backend = await read('js/backend.js');
  assert.doesNotMatch(backend, /rpc\/my_imprint/, 'no RPC that no migration defines');
  const pip = await read('js/pip.js');
  assert.match(pip, /if \(!signedIn\(\) \|\| parked\(\)\) return Promise\.resolve\(null\)/);
  assert.match(pip, /if \(r\.status === 404\) \{ park\(\); return null; \}/, 'a missing table parks the sync instead of retrying every song');
  const worker = await read('workers/mccluster/src/index.js');
  assert.doesNotMatch(worker, /rpc\/ai_harness_status/);
  const router = await read('workers/mccluster/src/analytics/router.js');
  assert.doesNotMatch(router, /sbCountFiltered\(env, 'events', /, 'business counts read the lean copy');
  const filament = await read('js/filament.js');
  assert.match(filament, /var p = actx\.decodeAudioData\(buf, res, rej\);\s*if \(p && typeof p\.catch === "function"\) p\.catch\(rej\);/);
  const tools = await read('js/control-room/work-tools.js');
  assert.match(tools, /PGRST205/, 'outreach says it is staged when its desk tables are absent');
});

test('the album says what happened: failed plays, gated previews, no dead tip door', async () => {
  const album = await read('album.html');
  assert.match(album, /function playFailed\(err, row\)[\s\S]{0,200}if \(name === "AbortError"\) return;/);
  assert.match(album, /window\.MCC_TRACK\("play_failed"/);
  assert.match(album, /function primeDeck\(\)/);
  assert.match(album, /if \(wasPreview\) \{ previewNotice\(rows\[cur\], true\); return; \}/, 'a preview ending waits instead of jumping to another song');
  assert.match(album, /artistLink\.href = "matthew-mccluster\.html"/, 'the house artist name opens his page');
  assert.match(album, /window\.MCC_TRACK\("gated_preview_end"/);
  assert.doesNotMatch(album, /Tip the artist/);
  assert.match(album, /replace\(\/\[-_\]\+\/g, " "\)/, 'play counts match the normalized track key');
});

test('sign-up refusals take the visitor to the field and count the reason only', async () => {
  const account = await read('account.html');
  const fail = slice(account, 'function createFail(msg, fieldId, reason)', '["acCreateFirst"');
  assert.match(fail, /setAttribute\("role", "alert"\)/);
  assert.match(fail, /setAttribute\("aria-invalid", "true"\)/);
  assert.match(fail, /\.focus\(/);
  assert.match(fail, /MCC_TRACK\("signup_blocked", \{ reason: reason \}\)/, 'never what was typed');
});

test('locked pages do not offer a theme they cannot change', async () => {
  const theme = await read('js/theme.js');
  assert.match(theme, /dual: !LOCK/);
});

test('database fixes wait in supabase/pending for the owner, bounded by a lock timeout', async () => {
  const pending = await readdir('supabase/pending');
  const migrations = await readdir('supabase/migrations');
  for (const f of ['anon_policy_scope_v1.sql', 'public_music_reads_lean_v1.sql', 'listener_state_v1.sql']) {
    assert.ok(pending.includes(f), f);
    assert.ok(!migrations.some((m) => m.endsWith(f.replace(/\.sql$/, '') + '.sql')), `${f} is not recorded as applied`);
    assert.match(await read('supabase/pending/' + f), /set local lock_timeout = '5s';/);
  }
  const listener = await read('supabase/pending/listener_state_v1.sql');
  assert.match(listener, /force row level security/);
  assert.match(listener, /using \(profile_id = \(select auth\.uid\(\)\)\)/);
  assert.doesNotMatch(listener, /to anon/);
});
