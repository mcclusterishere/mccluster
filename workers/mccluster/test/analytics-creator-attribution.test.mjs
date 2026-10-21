import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { handleAnalyticsRequest } from '../src/analytics/router.js';

const source = readFileSync(new URL('../../../js/analytics.js', import.meta.url), 'utf8');
function tracker(search, pathname = '/music-creator.html') {
  const factoryStart = source.indexOf('/* EVENT_OUTBOX_FACTORY_BEGIN */');
  const factoryEnd = source.indexOf('/* EVENT_OUTBOX_FACTORY_END */',factoryStart);
  assert.ok(factoryStart>=0 && factoryEnd>factoryStart);
  const start = source.indexOf('window.MCC_TRACK = (function () {');
  const end = source.indexOf('\n})();', start) + 6;
  const listeners = {}, sent = [];
  const storage = { getItem: () => null, setItem() {} };
  const context = {
    location: { pathname, search, hostname: 'matthew.mccluster.org' },
    document: { referrer: '', addEventListener() {} },
    navigator: {}, localStorage: storage, sessionStorage: storage,
    URL, URLSearchParams, setTimeout: () => 1, setInterval: () => 1, clearTimeout() {},
    mccPrivacyAcknowledged: () => true, mccControlPreview: () => false,
    fetch: async (_, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; },
  };
  context.window = { navigator: context.navigator, addEventListener(n, fn) { listeners[n] = fn; } };
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
