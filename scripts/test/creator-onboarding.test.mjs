/* Creator onboarding, one click: the show-condition, the browser-built
   fallback answer, and the contract between Creator Studio and the server
   functions in supabase/pending/music_creator_one_click_v1.sql.
   Behaviour of the SQL itself: scripts/test-music-creator-db.sh. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const OB = require('../../js/creator-onboarding.js');

test('the onboarding shows only to a signed-in member the server says is not a creator', () => {
  const creator = { ok: true, creator: true, profile: { handle: 'hitman-benji' } };
  const notYet = { ok: true, creator: false, missing: [] };
  assert.equal(OB.view({ signedIn: false, state: null }), 'signin');
  assert.equal(OB.view({ signedIn: true, state: { ok: false, error: 'not_signed_in', creator: false } }), 'signin');
  assert.equal(OB.view({ signedIn: true, state: notYet }), 'onboard');
  assert.equal(OB.view({ signedIn: true, state: creator }), 'studio', 'a creator never sees the onboarding');
  assert.equal(OB.view({ signedIn: true, state: { ...creator, profile: { status: 'paused' } } }), 'studio', 'any status counts');
  assert.equal(OB.view({ signedIn: true, state: creator, editing: true }), 'edit', 'only an explicit edit opens the profile form');
  assert.equal(OB.view({ signedIn: true, state: notYet, editing: true }), 'onboard', 'edit does not skip onboarding');
  assert.equal(OB.wantsEdit('?edit=profile'), true);
  assert.equal(OB.wantsEdit('?edit=1'), false);
  assert.equal(OB.wantsEdit(''), false);
});

test('only the missing fields are asked for, in a fixed order', () => {
  assert.deepEqual(OB.askFor({ missing: [] }), []);
  assert.deepEqual(OB.askFor({ missing: ['handle', 'artist_name', 'bio'] }), ['artist_name', 'handle']);
  assert.equal(OB.ready({ creator: false, missing: [] }), true);
  assert.equal(OB.ready({ creator: false, missing: ['handle'] }), false);
  assert.equal(OB.ready({ creator: false, missing: [], problems: { handle: 'taken' } }), false);
  assert.equal(OB.ready({ creator: true, missing: [] }), false);
});

test('handles: normalised, validated and offered from a name', () => {
  assert.equal(OB.normalizeHandle('  @Hitman-Benji '), 'hitman-benji');
  assert.equal(OB.validHandle('@Hitman-Benji'), true);
  assert.equal(OB.validHandle('ab'), false);
  assert.equal(OB.validHandle('-abc'), false);
  assert.equal(OB.validHandle('a'.repeat(41)), false);
  assert.equal(OB.suggestHandle('Hitman Benji'), 'hitman-benji');
  assert.equal(OB.suggestHandle('Beyoncé!'), 'beyonce');
  assert.equal(OB.suggestHandle('  '), '');
  assert.match(OB.handleHelp({ problems: { handle: 'taken' }, prefill: { handle_suggestion: 'zed-lane' } }), /taken\. @zed-lane is free/);
});

test('fallback answer: a complete profile becomes a creator in one click', () => {
  const s = OB.fallbackState({
    network: { display_name: 'Benji Chase', bio: 'Bio', website_url: 'https://benji.example' },
    platform: { mccluster_id: 'HitmanBenji', display_name: 'Benji' }
  });
  assert.equal(s.creator, false);
  assert.deepEqual(s.missing, []);
  assert.equal(OB.view({ signedIn: true, state: s }), 'onboard');
  assert.equal(OB.ready(s), true);
  assert.deepEqual(s.insert, { handle: 'hitmanbenji', artist_name: 'Benji Chase', bio: 'Bio', website_url: 'https://benji.example', avatar_url: '', terms_version: 'music-creator-v1' });
});

test('fallback answer: the member\'s picture comes along, https only (owner, 2026-10-20)', () => {
  const s = OB.fallbackState({
    network: { display_name: 'Benji Chase', avatar_url: 'https://cdn.example/benji.jpg' },
    platform: { mccluster_id: 'benji' }
  });
  assert.equal(s.insert.avatar_url, 'https://cdn.example/benji.jpg');
  assert.equal(s.prefill.avatar_url, 'https://cdn.example/benji.jpg', 'the card shows it before the tap');
  const insecure = OB.fallbackState({ network: { display_name: 'Dev', avatar_url: 'http://insecure.example/d.jpg' }, platform: { mccluster_id: 'dev-beats' } });
  assert.equal(insecure.insert.avatar_url, '');
  assert.equal(insecure.prefill.avatar_url, null);
});

test('fallback answer: an incomplete profile asks only for what is missing', () => {
  const none = OB.fallbackState({ network: { display_name: '', website_url: 'http://insecure.example' }, platform: {} });
  assert.deepEqual(none.missing, ['artist_name', 'handle']);
  assert.equal(none.insert, null);
  const nameOnly = OB.fallbackState({ network: { display_name: 'Dev Beats' }, platform: { mccluster_id: null } });
  assert.deepEqual(nameOnly.missing, ['handle']);
  assert.equal(nameOnly.prefill.handle_suggestion, 'dev-beats');
  const typed = OB.fallbackState({ network: {}, platform: {}, input: { artist_name: 'Dev Beats', handle: '@Dev-Beats' } });
  assert.deepEqual(typed.missing, []);
  assert.equal(typed.insert.website_url, '');
  const bad = OB.fallbackState({ network: { display_name: 'Dev' }, platform: {}, input: { handle: 'Bad Handle!' } });
  assert.deepEqual(bad.problems, { handle: 'invalid' });
  const taken = OB.fallbackState({ network: { display_name: 'Zed' }, platform: { mccluster_id: 'zed' }, takenHandle: 'zed' });
  assert.deepEqual(taken.problems, { handle: 'taken' });
  assert.deepEqual(taken.missing, ['handle']);
});

test('fallback answer: an existing creator row is a creator, whatever else is missing', () => {
  const s = OB.fallbackState({ creator: { handle: 'hitman-benji', artist_name: 'Hitman Benji', status: 'active' }, network: null, platform: null, linked: false });
  assert.equal(s.creator, true);
  assert.equal(s.linked, false);
  assert.equal(OB.view({ signedIn: true, state: s }), 'studio');
});

test('Creator Studio decides from the server and calls the one-click function', () => {
  const js = read('js/music-creator-studio.js');
  const shared = read('js/creator-onboarding.js');
  const html = read('creator.html');
  /* the two calls are shared with every "Become a creator" door on the site (owner, 2026-10-20) */
  assert.match(shared, /rpc\("music_creator_state"\)/);
  assert.match(shared, /rpc\("music_become_creator", \{[\s\S]*?p_accept_terms: true/);
  assert.match(js, /return ONBOARD\.client\(\{ token: session\.access_token, mUid, userId: session\?\.user\?\.id \|\| "" \}\);/);
  assert.match(js, /ONBOARD\.view\(\{ signedIn: ok, state, editing: ONBOARD\.wantsEdit\(location\.search\) \}\)/);
  /* a profile that is not done goes through the three pages and comes back for the one tap */
  assert.match(js, /const done = await ONBOARD\.profileDone\(\{ token: session\.access_token \}\);\n\s*if \(done === false\) \{ location\.replace\(ONBOARD\.FINISH_URL\); return; \}/);
  assert.equal(OB.FINISH_URL, 'mnet.html?finish=1&next=creator.html');
  assert.match(html, /<a class="creator-btn primary" id="creatorJoin" href="mnet\.html\?join=1&amp;next=creator\.html">Create account<\/a>/, 'the gate\'s sign-up is the one sign-up, and comes back');
  assert.match(html, /<a class="creator-btn quiet" id="creatorSignIn" href="account\.html\?next=creator\.html">Sign in<\/a>/, 'signing in comes back too');
  const code = (read('js/creator-onboarding.js') + js.slice(js.indexOf('/* ---------- onboarding'))).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /localStorage|sessionStorage/, 'the show-condition is server truth');
  assert.match(html, /<section class="creator-card" id="creatorIdentity" hidden>/, 'the profile form is the edit screen, hidden by default');
  assert.match(html, /<section class="cob" id="creatorOnboard" hidden/);
  assert.match(html, /id="cmeEdit" href="creator\.html\?edit=profile"/);
  assert.match(html, /By continuing you accept the <a href="music-creator-terms\.html"/, 'the click accepts the terms in plain view');
  assert.ok(html.indexOf('js/creator-onboarding.js') < html.indexOf('js/music-creator-studio.js'));
  assert.equal(OB.EDIT_URL, 'creator.html?edit=profile');
});

test('the server functions: definer, signed-in only, idempotent insert, same rules as the browser', () => {
  const sql = read('supabase/pending/music_creator_one_click_v1.sql');
  assert.match(sql, /create or replace function public\.music_creator_state\(\) returns jsonb\s+language sql security definer/);
  assert.match(sql, /create or replace function public\.music_become_creator\(\s*p_handle text default null, p_artist_name text default null, p_accept_terms boolean default false/);
  assert.match(sql, /on conflict \(m_uid\) do nothing/);
  assert.match(sql, /exception when unique_violation/);
  assert.match(sql, /revoke all on function public\.music_creator_onboarding_core\(uuid, text, text, boolean, boolean\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.music_become_creator\(text, text, boolean\) from public, anon;/);
  assert.doesNotMatch(sql, /grant execute on function public\.music_(become_creator|creator_state)[^;]*\banon\b/);
  assert.match(sql, /music_enabled = true/, 'the presentation is linked in the same transaction');
  assert.ok(sql.includes("'" + OB.HANDLE.source + "'"), 'the handle rule is the same in SQL and JS');
  assert.ok(sql.includes("'" + OB.TERMS_VERSION + "'"));
  assert.match(sql, /-- Rollback/);
  const table = read('supabase/migrations/20260920041011_music_creator_platform_v1.sql');
  assert.ok(table.includes("check (handle ~ '" + OB.HANDLE.source + "')"), 'the same rule the table enforces');
});

test('the onboarding styles are phone first', () => {
  const css = read('css/creator-onboarding.css');
  assert.doesNotMatch(css, /@media[^{]*max-width/, 'breakpoints only add');
  assert.doesNotMatch(css.replace(/minmax\(0,1fr\)/g, ''), /\b1fr\b/);
  for (const rule of css.match(/\.cob__field input\{[^}]*\}/g)) assert.match(rule, /max\(16px/);
  assert.match(css, /\.cob__go\{[^}]*max\(16px/);
});
