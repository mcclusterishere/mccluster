/* Wave 1 source integration guard: preserve the public feed, member identity,
   and default-disabled news discussion while source branches are reconciled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = async path => readFile(new URL('../../'+path,import.meta.url),'utf8');

test('unified World retains one news+post feed and real authenticated reply routes',async()=>{
  const mnet=await source('js/mnet.js');
  assert.match(mnet,/discussionHtml\('news', n\.id\)/);
  assert.match(mnet,/discussionHtml\('post', id\)/);
  assert.match(mnet,/bindDiscussions\(host\)/);
  assert.match(mnet,/\/v1\/world\/news\//);
  assert.match(mnet,/\/v1\/mnet\/posts\//);
  assert.match(mnet,/mcc:perspective/);
  assert.match(mnet,/publicHandle/);
  assert.match(mnet,/perspectiveLink/);
});
test('news discussion backend remains off without explicit server approval',async()=>{
  const api=await source('workers/mccluster/src/platform-api.js');
  assert.match(api,/WORLD_NEWS_COMMENTS_ENABLED/);
  assert.match(api,/!==\s*'true'/);
  assert.match(api,/media_news_comments/);
  const sql=await source('supabase/migrations/20261021011443_royce_platform_actor.sql');
  assert.match(sql,/row level security|enable row level security/i);
});
test('member self-view stays bound to account, never a news or editor role',async()=>{
  const bar=await source('js/tabbar.js');
  assert.match(bar,/PERSPECTIVE_SUB_KEY/);
  assert.match(bar,/resolveOwnPerspective/);
  assert.match(bar,/member-front\.html/);
  assert.match(bar,/AUTH_STATE\.signed_in/);
  const page=await source('js/member-front.js');
  assert.match(page,/\/v1\/mnet\/people\//);
  assert.match(page,/\/v1\/mnet\/profile/);
  assert.match(page,/mfCustomize/);
});
