import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(p)=>readFile(p,'utf8');

test('Mnet has production primitives for media, moderation, direct messages, and realtime', async()=>{
  const migration=await read('supabase/migrations/20260920071811_mnet_real_network_v1.sql');
  for(const table of [
    'network_media_assets','network_reports','network_conversations',
    'network_conversation_members','network_messages','network_blocks',
    'network_mutes','network_bookmarks','network_connections'
  ]) assert.match(migration,new RegExp('create table if not exists public\\.'+table));
  assert.match(migration,/mnet-media','mnet-media',false/);
  assert.match(migration,/create or replace function public\.mnet_discover/);
  assert.match(migration,/create or replace function public\.mnet_open_direct/);
  assert.match(migration,/create or replace function public\.mnet_send_message/);
  assert.match(migration,/alter publication supabase_realtime add table public\.network_posts/);
  assert.match(migration,/alter publication supabase_realtime add table public\.network_messages/);
});

test('message-request recipients cannot bypass acceptance and conversation RLS is non-recursive', async()=>{
  const rls=await read('supabase/migrations/20260920071931_mnet_conversation_rls_fix.sql');
  const privacy=await read('supabase/migrations/20260920072949_mnet_privacy_and_request_guards.sql');
  assert.match(rls,/mnet_is_conversation_member/);
  assert.match(rls,/security definer/);
  assert.match(rls,/network_conversation_members_member_read/);
  assert.match(privacy,/if v_state='requested' then raise exception 'accept_required'/);
  assert.match(privacy,/visibility='network'/);
  assert.match(privacy,/follower_m_uid=public\.current_m_uid\(\)/);
});

test('Mnet media is private and only exposed through authenticated authorization', async()=>{
  const media=await read('supabase/functions/mnet-media/index.ts');
  const migration=await read('supabase/migrations/20260920071811_mnet_real_network_v1.sql');
  assert.match(migration,/'mnet-media','mnet-media',false/);
  assert.match(media,/admin\.auth\.getUser\(token\)/);
  assert.match(media,/network_media_assets/);
  assert.match(media,/createSignedUploadUrl/);
  assert.match(media,/createSignedUrl/);
  assert.match(media,/canReadPost/);
  assert.match(media,/blocked\(viewer,post\.author_m_uid\)/);
});

test('Mnet Worker exposes a real social graph and safety API', async()=>{
  const api=await read('workers/mccluster/src/platform-api.js');
  const routes=[
    '/v1/mnet/discover',
    '/v1/mnet/bookmarks',
    '/v1/mnet/blocks',
    '/v1/mnet/reports',
    '/v1/mnet/conversations',
    '/v1/mnet/media/upload-url',
    '/v1/mnet/media/finalize'
  ];
  for(const route of routes) assert.match(api,new RegExp(route.replaceAll('/','\\/')));
  assert.match(api,/people\\\/\(\[\^\/\]\+\)\\\/\(block\|mute\)/);
  assert.match(api,/posts\\\/\(\[0-9a-f-\]\{36\}\)\\\/bookmark/);
  assert.match(api,/canReadNetworkProfile/);
  assert.match(api,/networkBlocked/);
  assert.match(api,/bookmarked_by_me/);
});

test('reaction, post, profile, and media access fail closed through visibility checks', async()=>{
  const api=await read('workers/mccluster/src/platform-api.js');
  assert.match(api,/if\(!post\|\|!\(await canReadNetworkPost\(env,muid,post\)\)\)return fail\(req,env,'Post not found',404\)/);
  assert.match(api,/if\(!\(await canReadNetworkProfile\(env,me,resolved\)\)\)return fail\(req,env,'Person not found',404\)/);
  assert.match(api,/network_media_assets\?id=in\./);
  assert.match(api,/owner_m_uid=eq\.\$\{muid\}/);
  assert.match(api,/media_asset_ids/);
});

test('feed semantics exclude blocked and muted actors', async()=>{
  const migration=await read('supabase/migrations/20260920071811_mnet_real_network_v1.sql');
  assert.match(migration,/not public\.mnet_is_blocked_pair\(me\.m_uid,f\.actor_m_uid\)/);
  assert.match(migration,/network_mutes nm/);
  assert.match(migration,/nm\.muter_m_uid=me\.m_uid/);
  assert.match(migration,/nm\.expires_at is null or nm\.expires_at>now\(\)/);
});

test('Mnet client exposes discovery, messaging, media, bookmarks, follow, and safety controls', async()=>{
  const html=await read('mnet.html');
  const js=await read('js/mnet.js');
  const css=await read('css/mnet.css');
  assert.match(html,/data-mn-view="discover"/);
  assert.match(html,/data-mn-view="messages"/);
  assert.match(html,/id="mnMediaInput"/);
  assert.match(html,/id="mnPersonDialog"/);
  assert.match(html,/id="mnConversationDialog"/);
  assert.match(js,/function loadDiscover\(\)/);
  assert.match(js,/function loadBlocked\(\)/);
  assert.match(html,/id="mnShowBlocked"/);
  assert.match(js,/function loadConversations\(\)/);
  assert.match(js,/function uploadMediaFiles\(files\)/);
  assert.match(js,/function toggleBookmark\(/);
  assert.match(js,/\/follow"/);
  assert.match(js,/\/block"/);
  assert.match(js,/\/mute"/);
  assert.match(js,/\/v1\/mnet\/reports/);
  assert.match(css,/\.mn__post-media/);
  assert.match(css,/\.mn__message\.is-mine/);
});

test('Mnet keeps one canonical M Account identity instead of creating a second auth system', async()=>{
  const html=await read('mnet.html');
  const js=await read('js/mnet.js');
  const migration=await read('supabase/migrations/20260920071811_mnet_real_network_v1.sql');
  assert.match(html,/Manage your M Account/);
  assert.match(js,/MCC\.signInWithPassword/);
  assert.match(js,/MCC\.signUpWithPassword/);
  assert.match(migration,/references public\.m_people\(id\)/);
  assert.doesNotMatch(migration,/create table if not exists public\.mnet_users/);
});
