import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handlePlatformApi } from '../../workers/mccluster/src/platform-api.js';

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

test('Action Network database hardening makes group boundaries restrictive and retires the dead outbox', async()=>{
  const migration=await read('supabase/migrations/20261004023007_action_network_hardening_v1.sql');
  assert.match(migration,/action_network_group_read_boundary/);
  assert.match(migration,/action_network_post_insert_boundary/);
  assert.match(migration,/reply_to_id is null/);
  assert.match(migration,/action_network_open_group_join_boundary/);
  assert.match(migration,/g\.visibility = 'open'/);
  assert.match(migration,/action_network_reactions_insert_retired/);
  assert.match(migration,/with check \(false\)/);
  assert.match(migration,/disable trigger mnet_post_outbox_trg/);
  assert.match(migration,/disable trigger mnet_reaction_outbox_trg/);
  assert.match(migration,/disable trigger mnet_follow_outbox_trg/);
  assert.match(migration,/set status = 'dead'/);
});

test('Action Network cleanup canonicalizes policies and removes dead outbox producers', async()=>{
  const migration=await read('supabase/migrations/20261004024500_action_network_hardening_cleanup_v1.sql');
  assert.match(migration,/action_network_open_group_self_join/);
  assert.match(migration,/action_network_own_group_membership_read/);
  assert.match(migration,/action_network_posts_read/);
  assert.match(migration,/reply_to_id is null/);
  assert.match(migration,/visibility = 'network'/);
  assert.match(migration,/revoke select, insert, update, delete on public\.network_reactions/);
  assert.match(migration,/drop trigger if exists mnet_post_outbox_trg/);
  assert.match(migration,/drop trigger if exists mnet_reaction_outbox_trg/);
  assert.match(migration,/drop trigger if exists mnet_follow_outbox_trg/);
  assert.match(migration,/create or replace function public\.mnet_complete_surface_profile/);
  assert.doesNotMatch(migration,/insert into public\.network_outbox/);
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


test('Action Network runtime keeps invite rooms private and makes mission/proof the response path', async()=>{
  const realFetch=globalThis.fetch;
  const MUID='11111111-1111-4111-8111-111111111111';
  const GROUP='22222222-2222-4222-8222-222222222222';
  const INVITE='33333333-3333-4333-8333-333333333333';
  const POST='44444444-4444-4444-8444-444444444444';
  const ENV={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'svc'};
  let joined=false;
  const calls=[];
  const ok=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
  globalThis.fetch=async(url,init={})=>{
    const u=String(url),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;
    calls.push({u,method,body});
    if(u.endsWith('/auth/v1/user'))return ok({id:'user-1'});
    if(u.includes('/m_auth_user_links?auth_user_id='))return ok([{m_uid:MUID}]);
    if(u.includes('/m_auth_user_links?m_uid=in.'))return ok([{m_uid:MUID,auth_user_id:'user-1'}]);
    if(u.includes('/platform_profiles?user_id=in.'))return ok([{user_id:'user-1',mccluster_id:'doer'}]);
    if(u.includes('/platform_apps?app_key='))return ok([{id:'55555555-5555-4555-8555-555555555555'}]);
    if(u.includes('/network_groups?select='))return ok([
      {id:GROUP,slug:'open-room',name:'Open room',purpose:'Act together',visibility:'open',member_count:1,organization_id:null,group_type:'community',front_page_url:null},
      {id:INVITE,slug:'invite-room',name:'Invite room',purpose:'Private work',visibility:'invite',member_count:1,organization_id:null,group_type:'community',front_page_url:null}
    ]);
    if(u.includes('/network_groups?slug=eq.open-room'))return ok([{id:GROUP,slug:'open-room',name:'Open room',purpose:'Act together',visibility:'open',member_count:1,organization_id:null,group_type:'community',front_page_url:null}]);
    if(u.includes('/network_groups?slug=eq.invite-room'))return ok([{id:INVITE,slug:'invite-room',name:'Invite room',purpose:'Private work',visibility:'invite',member_count:1,organization_id:null,group_type:'community',front_page_url:null}]);
    if(u.includes('/network_group_members?')){
      return ok(joined?[{group_id:u.includes(INVITE)?INVITE:GROUP}]:[]);
    }
    if(u.includes('/network_posts?group_id=eq.')&&method==='GET')return ok([{
      id:POST,author_m_uid:MUID,body:'Proof-oriented room update',post_type:'post',visibility:'network',
      media:[],metadata:{},content_id:null,reply_to_id:null,group_id:GROUP,created_at:new Date().toISOString(),
      updated_at:new Date().toISOString(),source_app_id:null,source_org_id:null
    }]);
    if(u.includes('/network_profiles?m_uid=in.'))return ok([{m_uid:MUID,display_name:'Doer',avatar_url:'',verification_state:'unverified'}]);
    if(u.includes('/network_bookmarks?'))return ok([]);
    if(u.endsWith('/network_posts')&&method==='POST')return ok([{id:POST,author_m_uid:MUID,...body}],201);
    return ok([]);
  };
  const req=(path,init={})=>handlePlatformApi(new Request('https://api.test'+path,{
    method:init.method||'GET',
    headers:{authorization:'Bearer user-token','content-type':'application/json'},
    body:init.body===undefined?undefined:JSON.stringify(init.body)
  }),ENV);
  try{
    let res=await req('/v1/mnet/groups');
    assert.equal(res.status,200);
    let data=await res.json();
    assert.deepEqual(data.groups.map(x=>x.slug),['open-room'],'invite-only rooms are not discoverable to nonmembers');

    res=await req('/v1/mnet/groups/invite-room');
    assert.equal(res.status,404,'knowing an invite slug does not reveal the room');

    const before=calls.length;
    res=await req('/v1/mnet/groups/open-room');
    assert.equal(res.status,200);
    data=await res.json();
    assert.equal(data.group.joined,false);
    assert.deepEqual(data.items,[]);
    assert.equal(calls.slice(before).some(x=>x.u.includes('/network_posts?group_id=')),false,'nonmember read never fetches room posts');

    res=await req('/v1/mnet/posts?app_key=mnet-web',{method:'POST',body:{body:'try room',group_id:GROUP,visibility:'public'}});
    assert.equal(res.status,403,'nonmembers cannot post into a room');

    joined=true;
    res=await req('/v1/mnet/groups/open-room');
    assert.equal(res.status,200);
    data=await res.json();
    assert.equal(data.group.joined,true);
    assert.equal(data.items.length,1);

    res=await req('/v1/mnet/posts?app_key=mnet-web',{method:'POST',body:{body:'room action',group_id:GROUP,visibility:'public'}});
    assert.equal(res.status,201);
    const inserted=[...calls].reverse().find(x=>x.u.endsWith('/network_posts')&&x.method==='POST');
    assert.equal(inserted.body.group_id,GROUP);
    assert.equal(inserted.body.visibility,'network','group posts cannot be promoted into the public feed');

    res=await req('/v1/mnet/posts?app_key=mnet-web',{method:'POST',body:{body:'old comment',reply_to_id:POST}});
    assert.equal(res.status,410);
    res=await req('/v1/mnet/posts/'+POST+'/replies');
    assert.equal(res.status,410);
    res=await req('/v1/mnet/posts/'+POST+'/reactions',{method:'POST',body:{reaction:'like'}});
    assert.equal(res.status,410);
  } finally {
    globalThis.fetch=realFetch;
  }
});
