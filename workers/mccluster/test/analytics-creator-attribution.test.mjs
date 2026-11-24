import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { handleAnalyticsRequest } from '../src/analytics/router.js';

const source = readFileSync(new URL('../../../js/analytics.js', import.meta.url), 'utf8');
function tracker(search, pathname = '/music-creator.html', { view = null, referrer = '' } = {}) {
  /* the page identity the tracker files every event under, fixed when the page loads (js/analytics.js, music M5) */
  const identityStart = source.indexOf('var MCC_PAGE_IDENTITY = (function () {');
  const identityEnd = source.indexOf('\n})();', identityStart) + 6;
  assert.ok(identityStart>=0 && identityEnd>identityStart);
  const factoryStart = source.indexOf('/* EVENT_OUTBOX_FACTORY_BEGIN */');
  const factoryEnd = source.indexOf('/* EVENT_OUTBOX_FACTORY_END */',factoryStart);
  assert.ok(factoryStart>=0 && factoryEnd>factoryStart);
  const start = source.indexOf('window.MCC_TRACK = (function () {');
  const end = source.indexOf('\n})();', start) + 6;
  const listeners = {}, sent = [];
  const storage = { getItem: () => null, setItem() {} };
  const context = {
    location: { pathname, search, hostname: 'matthew.mccluster.org' },
    document: { referrer, addEventListener() {} },
    navigator: {}, localStorage: storage, sessionStorage: storage,
    URL, URLSearchParams, setTimeout: () => 1, setInterval: () => 1, clearTimeout() {},
    mccPrivacyAcknowledged: () => true, mccControlPreview: () => false,
    fetch: async (_, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; },
  };
  /* in a music view js/shell-boot.js hands the page its view API (js/music-shell.js) before any other script runs */
  context.window = { navigator: context.navigator, addEventListener(n, fn) { listeners[n] = fn; }, ...(view ? { MCC_MUSIC_VIEW: view } : {}) };
  vm.runInNewContext(source.slice(identityStart, identityEnd), context);
  vm.runInNewContext(source.slice(factoryStart, factoryEnd), context);
  vm.runInNewContext(source.slice(start, end), context);
  return { async emit() { context.window.MCC_TRACK('page_view', {}); listeners.pagehide(); await Promise.resolve(); return sent[0].events[0]; } };
}

test('real tracker retains only a validated public creator handle beside the path', async () => {
  const event = await tracker('?handle=own-artist&token=private').emit();
  assert.equal(event.path, 'music-creator.html');
  assert.equal(event.props.creator_handle, 'own-artist');
  assert.ok(!JSON.stringify(event).includes('private'));
  assert.equal((await tracker('?handle=bad%2Chandle').emit()).props.creator_handle, undefined);
  assert.equal((await tracker('?handle=own-artist', '/listen.html').emit()).props.creator_handle, undefined);
});

/* A MUSIC VIEW (music slice M5; SPEC-ENGINE section 9). A view is a music page shown over the retained one in a frame of
   its own, its own copy of the tracker filing its own events: under the view's own path, with the page it was opened from
   as the referrer (also when Back or Forward rebuilt the view at its own address, which a frame's document.referrer would
   name instead), and with a creator handle only on music-creator.html with a valid handle. */
test('from a music view the event keeps the view\'s own path and the page it was opened from, and a creator handle only on music-creator.html with a valid handle', async () => {
  const house = 'https://matthew.mccluster.org';
  /* an artist page shown over Listen, rebuilt by Back or Forward: its frame's own referrer is its own address */
  const artist = await tracker('?handle=own-artist&token=private', '/music-creator.html',
    { view: { kind: 'artist', referrer: house + '/listen.html' }, referrer: house + '/music-creator.html?handle=own-artist' }).emit();
  assert.equal(artist.path, 'music-creator.html', 'the view\'s own path');
  assert.equal(artist.referrer, house + '/listen.html', 'the page the view was opened from, not the frame\'s own address');
  assert.equal(artist.props.creator_handle, 'own-artist', 'the artist view\'s valid handle');
  assert.ok(!JSON.stringify(artist).includes('private'), 'no other query value rides along');
  /* Listen shown over an artist page: its own path, opened from the artist page, and no creator handle */
  const listen = await tracker('?handle=own-artist', '/listen.html',
    { view: { kind: 'listen', referrer: house + '/music-creator.html?handle=own-artist' } }).emit();
  assert.equal(listen.path, 'listen.html');
  assert.equal(listen.referrer, house + '/music-creator.html?handle=own-artist');
  assert.equal(listen.props.creator_handle, undefined, 'a creator handle only on music-creator.html');
  /* an artist view whose handle is not a valid one: no creator handle */
  const bad = await tracker('?handle=bad%2Chandle', '/music-creator.html', { view: { kind: 'artist', referrer: house + '/listen.html' } }).emit();
  assert.equal(bad.path, 'music-creator.html');
  assert.equal(bad.props.creator_handle, undefined, 'never an invalid handle');
  assert.equal(bad.referrer, house + '/listen.html');
  /* a view the shell gives no referrer (none known): the frame's own referrer stands */
  const plain = await tracker('', '/account.html', { view: { kind: 'account', referrer: '' }, referrer: house + '/listen.html' }).emit();
  assert.equal(plain.path, 'account.html');
  assert.equal(plain.referrer, house + '/listen.html');
  assert.equal(plain.props.creator_handle, undefined);
});

test('creator analytics counts current and historical tracker shapes, scoped before sampling', async () => {
  const original = globalThis.fetch, calls = [];
  const track = '00000000-0000-0000-0000-000000000004';
  globalThis.fetch = async input => {
    const url = new URL(input); calls.push(url);
    if (url.pathname.endsWith('/m_auth_user_links')) return Response.json([{ m_uid: 'member' }]);
    if (url.pathname.endsWith('/creator_tracks')) return Response.json([{ id: track, title: 'Own song' }]);
    if (url.pathname.endsWith('/music_creator_profiles')) return Response.json([{ handle: 'own-artist' }]);
    if (url.searchParams.get('select')?.startsWith('at,path')) return Response.json([
      { path: 'music-creator.html', props: { creator_handle: 'own-artist' } },
      { path: 'music-creator.html', props: { url: '/music-creator.html?utm_source=share&handle=own-artist' } },
      { path: 'music-creator.html?handle=own-artist', props: {} },
      { path: 'music-creator.html', props: { url: '/music-creator.html?handle=own-artist-other' } },
      { path: 'listen.html', props: { creator_handle: 'own-artist' } },
    ]);
    return Response.json([{ name: 'music_play', props: { creator_track_id: track } }, { name: 'music_play', props: { creator_track_id: 'other' } }]);
  };
  try {
    const env = { SUPABASE_URL: 'https://mock.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture' };
    const data = await (await handleAnalyticsRequest(new Request('https://api.test/v1/analytics/my-creator?handle=other'), env, { id: 'owner' })).json();
    assert.equal(data.page_traffic.views, 3);
    assert.equal(data.tracks[0].plays, 1);
    const page = calls.find(u => u.searchParams.get('or'));
    assert.ok(page.searchParams.get('or').includes('props->>creator_handle.eq.own-artist'));
    assert.ok(page.searchParams.get('or').includes('props->>url.like.'));
    const music = calls.find(u => u.searchParams.has('props->>creator_track_id'));
    assert.equal(music.searchParams.get('props->>creator_track_id'), `in.(${track})`);
    assert.equal(music.searchParams.get('limit'), '1000');
  } finally { globalThis.fetch = original; }
});
