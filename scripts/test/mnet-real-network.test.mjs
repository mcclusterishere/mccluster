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

test('Action Network retires conventional reactions/comments and enforces group membership', async()=>{
  const api=await read('workers/mccluster/src/platform-api.js');
  assert.match(api,/Comments are retired on the Action Network/);
  assert.match(api,/Reactions are retired on the Action Network/);
  assert.match(api,/if\(post\.group_id\)/);
  assert.match(api,/network_group_members\?group_id=eq\.\$\{post\.group_id\}.*state=eq\.joined/);
  assert.match(api,/const posts=joined/);
  assert.match(api,/visibility='network'/);
  assert.match(api,/if\(!\(await canReadNetworkProfile\(env,me,resolved\)\)\)return fail\(req,env,'Person not found',404\)/);
  assert.match(api,/network_media_assets\?id=in\./);
  assert.match(api,/owner_m_uid=eq\.\$\{muid\}/);
  assert.match(api,/media_asset_ids/);
});

test('Action Network social hardening locks group RLS and retires the dead outbox', async()=>{
  const migration=await read('supabase/migrations/20261004023000_action_network_social_hardening_v1.sql');
  assert.match(migration,/a member joins open groups for themselves/);
  assert.match(migration,/g\.visibility = 'open'/);
  assert.match(migration,/reply_to_id is null/);
  assert.match(migration,/network_group_members gm/);
  assert.match(migration,/drop policy if exists network_reactions_self_write/);
  assert.match(migration,/revoke select, insert, update, delete on public\.network_reactions/);
  assert.match(migration,/drop trigger if exists mnet_post_outbox_trg/);
  assert.match(migration,/drop trigger if exists mnet_reaction_outbox_trg/);
  assert.match(migration,/drop trigger if exists mnet_follow_outbox_trg/);
  assert.match(migration,/set status = 'dead'/);
  assert.match(migration,/drop function if exists public\.mnet_claim_outbox/);
  assert.match(migration,/drop function if exists public\.mnet_enqueue_outbox/);
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


test('Edit Profile exposes secure M Account password changes without creating a profile password field', async()=>{
  const html=await read('mnet.html');
  const js=await read('js/mnet.js');
  const auth=await read('js/mcc-auth.js');
  assert.match(html,/id="mnProfileSecurity"[^>]*hidden/);
  assert.match(html,/id="mnNewPassword"[^>]*autocomplete="new-password"/);
  assert.match(html,/id="mnNewPassword2"[^>]*autocomplete="new-password"/);
  assert.match(html,/id="mnPasswordChange"/);
  assert.match(js,/\$\("mnProfileSecurity"\)\.hidden = !editing/);
  assert.match(js,/MCC\.updatePassword\(password\)/);
  assert.match(js,/e\.preventDefault\(\); changePassword\(\)/);
  assert.match(auth,/body: \{ password: password \}/);
  assert.doesNotMatch(html,/name="password"/);
});

/* THE ACTION NETWORK'S DESIGN CONTRACT. The owner asked for intentional
   design with motion, no em dashes in the copy, and the house bar left
   alone; these keep that true. */
test('the Action Network moves with intent and keeps the copy clean', async()=>{
  const [html, js, css] = await Promise.all([read('mnet.html'), read('js/mnet.js'), read('css/mnet.css')]);
  const visible = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(visible, /—/, 'no em dashes in the page copy');
  const strings = js.replace(/\/\*[\s\S]*?\*\//g, '').match(/"[^"\n]*"|'[^'\n]*'/g) || [];
  assert.ok(!strings.some((s) => s.includes('—')), 'no em dashes in strings the script shows');
  assert.match(css, /@keyframes mn-rise/);
  assert.match(css, /@keyframes mn-pop/);
  assert.match(css, /@keyframes mn-dialog-in/);
  assert.match(css, /@keyframes mn-media-reveal/);
  assert.match(css, /\.mn__composer:focus-within/);
  assert.match(css, /\.mn__post-card\.is-just-posted/);
  assert.match(js, /first\.classList\.add\("is-just-posted"\)/);
  assert.match(css, /\.mn__tabs-thumb \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /@media[^{]*max-width/, 'breakpoints only add room');
  assert.doesNotMatch(css, /\.appbar/, 'the house bar is styled by the house, not here');
  /* Mission/proof is the response primitive. Ordinary social feedback stays retired. */
  assert.doesNotMatch(js, /function toggleLike\(/);
  assert.doesNotMatch(js, /data-action="like"/);
  assert.doesNotMatch(js, /data-action="comments"/);
  assert.doesNotMatch(html, /id="mnThread"/);
  assert.doesNotMatch(html, /Write a comment/);
  assert.match(js, /data-take-mission/);
  assert.match(js, /Verified action/);
  assert.match(html, /id="mnRail"/);
});

test("Action Network profile treats the member website as the identity front page", async()=>{
 const html=await read("mnet.html"), js=await read("js/mnet.js"), css=await read("css/mnet.css");
 assert.match(html,/id="mnFrontPage"/); assert.match(html,/id="mnFrontPageFrame"/);
 assert.match(js,/function paintFrontPage\(p, id, name\)/); assert.match(js,/p\.front_page_url \|\| p\.website_url/);
 assert.match(js,/paintFrontPage\(p, id, name\)/); assert.match(css,/\.mn__frontpage-stage/);
});


test("unified identity presentation carries public front page through people profiles",async()=>{const js=await read("js/mnet.js");assert.match(js,/presentation=data\.presentation\|\|\{\}/);assert.match(js,/presentation\.front_page_url\|\|p\.website_url/);assert.match(js,/mnet\.html\?profile=/);});


test("Action Network product language is doer-first and legacy Mnet branding is absent from the primary surface",async()=>{const html=await read("mnet.html"),listen=await read("listen.html");assert.match(html,/The place for doers/);assert.match(html,/Put it into action/);assert.match(html,/What are you putting into action/);assert.doesNotMatch(html,/\bMnet\b|M Network/);assert.match(listen,/Put your music into action/);assert.match(listen,/Every creator is part of the Action Network/);});
