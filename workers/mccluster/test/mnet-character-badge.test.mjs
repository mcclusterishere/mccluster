import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlePlatformApi } from '../src/platform-api.js';

/* Owner, 2026-11-03: story characters on MNET carry a small "Character" badge, no other disclaimer.
   The Worker reads persona->>actor_kind on the existing platform actor and passes actor_kind:'character'. */
const character = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const royce = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const post1 = '11111111-1111-4111-8111-111111111111';
const post2 = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'server-only', ALLOWED_ORIGINS: 'https://mccluster.org' };

test('the public feed marks a story character, not Royce, with actor_kind character', async () => {
  const original = globalThis.fetch;
  const lookups = [];
  globalThis.fetch = async url => {
    const p = decodeURIComponent(String(url).split('/rest/v1/')[1]);
    lookups.push(p);
    if (p.startsWith('network_feed_items?')) return Response.json([
      { item_type: 'post', post_id: post1, actor_m_uid: character, visibility: 'public', occurred_at: '2026-11-03T15:00:00Z' },
      { item_type: 'post', post_id: post2, actor_m_uid: royce, visibility: 'public', occurred_at: '2026-11-03T14:00:00Z' },
    ]);
    if (p.startsWith('network_posts?')) return Response.json([
      { id: post1, author_m_uid: character, body: 'Made a new blend today.', post_type: 'update', visibility: 'public', metadata: { actor_kind: 'character', character_id: 'mara-costa' }, created_at: '2026-11-03T15:00:00Z' },
      { id: post2, author_m_uid: royce, body: 'Same DNA, different outcome.', post_type: 'update', visibility: 'public', metadata: {}, created_at: '2026-11-03T14:00:00Z' },
    ]);
    if (p.startsWith('network_profiles?')) {
      if (p.includes('visibility=eq.public')) return Response.json([{ m_uid: character }, { m_uid: royce }]);
      return Response.json([{ m_uid: character, display_name: 'Mara Costa' }, { m_uid: royce, display_name: 'Royce · AI' }]);
    }
    if (p.startsWith('m_auth_user_links?')) return Response.json([]);
    if (p.startsWith('ops_platform_actors?')) {
      assert.match(p, /actor_kind:persona->>actor_kind/, 'reads the profile type from the existing persona column');
      return Response.json([{ m_uid: character, handle: 'chr.mara-costa', actor_kind: 'character' }, { m_uid: royce, handle: 'royce.r01', actor_kind: null }]);
    }
    if (p.startsWith('network_reactions?') || p.startsWith('network_bookmarks?')) return Response.json([]);
    throw new Error('Unexpected lookup ' + p);
  };
  try {
    const response = await handlePlatformApi(new Request('https://api.mccluster.org/v1/mnet/public-feed'), env);
    assert.equal(response.status, 200);
    const data = await response.json();
    const mara = data.items.find(i => i.post_id === post1), other = data.items.find(i => i.post_id === post2);
    assert.equal(mara.actor.actor_kind, 'character');
    assert.equal(mara.actor.mccluster_id, 'chr.mara-costa');
    assert.equal('actor_kind' in other.actor, false, 'Royce stays an AI performer, not a story character');
    assert.equal(JSON.stringify(data).includes('server-only'), false);
    assert.equal(JSON.stringify(data).includes('character_id'), false, 'post metadata is not leaked to the public feed');
  } finally { globalThis.fetch = original; }
});

test('the MNET client renders one small Character badge on posts, comments and the profile sheet', () => {
  const js = readFileSync(new URL('../../../js/mnet.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../../css/mnet.css', import.meta.url), 'utf8');
  assert.match(js, /function isCharacter\(a\) \{ return !!\(a && a\.actor_kind === "character"\); \}/);
  assert.ok(js.includes(`'<div class="mn__author-sub">' + (isCharacter(actor) ? '<span class="mn__character-badge">Character</span> ' : '') + esc(handle)`), 'feed and profile post cards: badge before the handle so it is never ellipsized');
  assert.match(js, /isCharacter\(comment\.actor\)/, 'comments');
  assert.match(js, /@'\+esc\(id\.mccluster_id\|\|""\)\+characterBadge\(id\)/, 'profile sheet');
  assert.equal((js.match(/>Character</g) || []).length, 2, 'the badge text is "Character" and nothing else (author line + characterBadge)');
  assert.equal((js.match(/textContent = 'Character'/g) || []).length, 1);
  const rule = css.match(/\.mn__character-badge \{[^}]*\}/)?.[0] || '';
  assert.ok(rule, 'badge style exists');
  assert.match(rule, /var\(--mn-dim\)/, 'uses existing ink tokens');
  assert.doesNotMatch(rule, /#[0-9a-f]{3,8}|rgb|hsl|purple|violet/i, 'no new colours');
});

test('story characters cannot be invited into member live rooms', async () => {
  const src = readFileSync(new URL('../src/platform-api.js', import.meta.url), 'utf8');
  assert.match(src, /if\(b\.actor_keys\.some\(k=>k\.startsWith\('chr\.'\)\)\)return fail\(req,env,'Story characters cannot join live rooms yet',400\);/);
});
