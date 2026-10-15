/* ANTI-SOCIAL — GET SOCIAL, COMPLETED.

   Owner, 2026-10-14: "Level 3: find another Action Network member, connect
   through the platform, and create something together … Connect →
   Collaborate → Publish." The draft migration on the branch required an
   accepted network_connections row for level 3 while nothing could write
   one (docs/action-network/ANTI-SOCIAL-GET-SOCIAL-AUDIT.md). These pin the
   completion: the writers exist and are the only writers, the person view
   has Connect, a request is answered from the bell, and the level-3 partner
   list is the server's. The behaviour is proven on a scratch Postgres by
   scripts/test-antisocial-db.sh. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');
const SQL = 'supabase/migrations/20261015000455_antisocial_get_social_completion_v1.sql';

test('connect through the platform: the server writes network_connections, members only call', async () => {
  const sql = await read(SQL);
  for (const fn of ['request_connection(uuid)', 'answer_connection(uuid, boolean)', 'withdraw_connection(uuid)', 'connection_with(uuid)', 'my_connections()']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, '\\$&')} from public, anon;`), `${fn} is not for guests`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, '\\$&')} to authenticated, service_role;`), `${fn} is for members`);
  }
  assert.match(sql, /revoke all on function public\.connection_notify\(uuid, uuid, text, uuid\) from public, anon, authenticated;/, 'the notifier is internal');
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.match(sql, /public\.mnet_is_blocked_pair\(v_me, p_target_m_uid\)/, 'a block reads as not found');
  assert.match(sql, /raise exception 'member not found'/);
  assert.match(sql, /they asked first: asking back is accepting/);
  assert.match(sql, /if v_open >= 30 then raise exception/, 'a member keeps at most thirty requests out');
  assert.match(sql, /'connection_request'/);
  assert.match(sql, /'connection_accepted'/);
  assert.doesNotMatch(sql, /grant (insert|update|delete) on public\.network_connections to authenticated/, 'no direct table writes for members');
  /* the chain is proven on a real database */
  const runner = await read('scripts/test-antisocial-db.sh');
  assert.match(runner, /apply supabase\/migrations\/20261014185154_antisocial_get_social_three_levels_draft\.sql\napply supabase\/migrations\/20261015000455_antisocial_get_social_completion_v1\.sql/);
  assert.match(runner, /antisocial_connections\.behaviour\.sql/);
  await access(join(ROOT, 'supabase/tests/antisocial_connections.behaviour.sql'));
  await access(join(ROOT, 'supabase/tests/mnet_network_tables.stub.sql'));
  assert.match(await read('supabase/pending/README.md'), /antisocial_get_social_completion_v1\.sql/);
});

test('the person view has Connect, and the Worker tells it the pair\'s state', async () => {
  const js = await read('js/mnet.js');
  assert.match(js, /function connectButtonHtml\(c\)/);
  assert.match(js, /data-connect="ask">Connect</);
  assert.match(js, /data-connect="withdraw"[^>]*>Requested…</);
  assert.match(js, /data-connect="accept">Accept connection<\/button><button type="button" id="mnPersonDecline" data-connect="decline">Decline</);
  assert.match(js, /data-connect="end"[^>]*>Connected ✓</);
  assert.match(js, /sbRpc\("request_connection",\{p_target_m_uid:targetMuid\}\)/);
  assert.match(js, /sbRpc\("answer_connection",\{p_connection_id:c\.id,p_accept:true\}\)/);
  assert.match(js, /sbRpc\("withdraw_connection",\{p_connection_id:c\.id\}\)/);
  assert.match(js, /if\(state\.guest\)\{askToSignIn\("connect"\);return;\}/);
  assert.match(js, /connect:"Sign in to connect with members\."/);
  assert.match(js, /connectButtonHtml\(data\.connection\)/, 'the button reads the Worker\'s answer');
  const worker = await read('workers/mccluster/src/platform-api.js');
  assert.match(worker, /let connection=\{status:'none'\};/);
  assert.match(worker, /network_connections\?or=\(and\(requester_m_uid\.eq\.\$\{me\},addressee_m_uid\.eq\.\$\{resolved\.m_uid\}\),and\(requester_m_uid\.eq\.\$\{resolved\.m_uid\},addressee_m_uid\.eq\.\$\{me\}\)\)&status=neq\.declined/);
  assert.match(worker, /following,blocked,muted,connection,counts:/);
});

test('a request is answered from the bell; the level-3 partner list is the server\'s', async () => {
  const js = await read('js/mnet.js');
  assert.match(js, /n\.type==="connection_request"/);
  assert.match(js, /data-connection-answer="'\+esc\(meta\.connection_id\)\+'" data-accept="1">Accept</);
  assert.match(js, /data-accept="0">Decline</);
  assert.match(js, /n\.type==="connection_accepted"&&meta\.handle/);
  assert.match(js, /sbRpc\("answer_connection",\{p_connection_id:id,p_accept:accept\}\)/);
  assert.match(js, /sbRpc\("my_connections",\{\}\)/, 'the partner picker reads my_connections');
  assert.doesNotMatch(js, /sbRest\("network_connections\?/, 'the page never reads the table itself');
  assert.match(js, /No connections yet\. Find a member and tap Connect\./);
  const html = await read('mnet.html');
  assert.match(html, /<a href="mnet\.html\?view=discover">Find a member<\/a> and tap <b>Connect<\/b> on their profile/);
  const css = await read('css/mnet.css');
  assert.match(css, /\.mn__notification-actions \{ display: flex; flex-wrap: wrap; gap: 8px; \}/);
});

test('publish together, in the platform: one post credited to both, vouched, and one review settles the pair', async () => {
  const sql = await read(SQL);
  assert.match(sql, /create table if not exists public\.action_collaboration_posts \(/);
  assert.match(sql, /revoke all on public\.action_collaboration_posts from public, anon, authenticated;/, 'the vouch table is the server\'s');
  assert.match(sql, /create or replace function public\.publish_antisocial_collaboration\(\n  p_assignment_id uuid, p_partner_m_uid uuid, p_title text, p_kind text,\n  p_link text default null, p_media_asset_id uuid default null, p_statement text default ''\n\)/);
  assert.match(sql, /raise exception 'finish levels 1 and 2 first'/);
  assert.match(sql, /raise exception 'connect with your collaborator on Action Network first'/);
  assert.match(sql, /'credits', jsonb_build_array\(/, 'both credits ride on the post');
  assert.match(sql, /perform public\.submit_antisocial_level\(v_a\.id, 3::smallint/, 'publishing is the initiator\'s level 3, through the draft\'s own rule');
  assert.match(sql, /'collaboration_published'/, 'the partner is told');
  assert.match(sql, /create or replace function public\.antisocial_collaborations_for_me\(\)/);
  assert.match(sql, /create or replace function public\.action_collaboration_cards\(p_post_ids uuid\[\]\)/);
  assert.match(sql, /grant execute on function public\.action_collaboration_cards\(uuid\[\]\) to anon, authenticated, service_role;/, 'the card is public, like the action card');
  /* D: one verification settles both, with the collaboration award */
  assert.match(sql, /perform public\.antisocial_settle_level3\(v_a\.id, v_l\.post_id\);\n    perform public\.antisocial_settle_level3\(v_other, v_l\.post_id\);/);
  assert.match(sql, /'collaboration', 100, 'Anti-Social: made something together'/);
  assert.match(sql, /revoke all on function public\.antisocial_settle_level3\(uuid, uuid\) from public, anon, authenticated;/);
  /* C: the record carries levels; F: the mission opens */
  assert.match(sql, /'levels', coalesce\(\(select jsonb_agg\(jsonb_build_object\('level', lv\.level, 'status', lv\.status/);
  assert.match(sql, /'level_count', case when m\.id = 'a17050c1-a551-4c5c-80c1-5a1750c1a001'::uuid then 3 end/);
  assert.match(sql, /update public\.action_missions set status = 'open', updated_at = now\(\)\n where id = 'a17050c1-a551-4c5c-80c1-5a1750c1a001'::uuid and status = 'draft';/);
  const runner = await read('scripts/test-antisocial-db.sh');
  assert.match(runner, /antisocial_levels\.behaviour\.sql/);
  await access(join(ROOT, 'supabase/tests/antisocial_levels.behaviour.sql'));
});

test('the page publishes together from Level 3, confirms a project published with me, and reads n / 3', async () => {
  const js = await read('js/mnet.js'), html = await read('mnet.html');
  assert.match(js, /sbRpc\("publish_antisocial_collaboration",\{p_assignment_id:a\.id,p_partner_m_uid:partner,p_title:title,p_kind:kind,p_link:url,p_media_asset_id:asset,p_statement:statement\}\)/);
  assert.doesNotMatch(js, /mnAntisocialPost\b/, 'no pasted post id');
  assert.doesNotMatch(html, /Post ID or shared post link/);
  assert.match(html, /id="mnAntisocialTitle" maxlength="120"/);
  assert.match(html, /id="mnAntisocialKind"><option value="song">Song<\/option><option value="video">Video<\/option><option value="photo">Photo project<\/option><option value="writing">Writing<\/option><option value="other">Other original work<\/option>/);
  assert.match(js, /sbRpc\("antisocial_collaborations_for_me",\{\}\)/);
  assert.match(js, /data-confirm-collab="'\+esc\(r\.post_id\)\+'" data-with="'\+esc\(r\.initiator_m_uid\)\+'"/);
  assert.match(js, /p_post_id:b\.getAttribute\("data-confirm-collab"\),p_collaborator_m_uid:b\.getAttribute\("data-with"\)/, 'confirming is my level 3 with the same post and reciprocal credit');
  assert.match(js, /"Publish together and submit Level 3"/);
  /* the card, only for vouched posts */
  assert.match(js, /function collaborationCardHtml\(postId\)/);
  assert.match(js, /sbRpc\("action_collaboration_cards", \{ p_post_ids: ids\.slice\(0, 100\) \}\)/);
  assert.match(js, /p && p\.metadata && p\.metadata\.collaboration \? p\.id : null/);
  assert.match(js, /collaborationCardHtml\(id\) \+/);
  assert.match(js, /loadCollaborationCards\(incoming\)\]\)/);
  assert.match(js, /c\.verified \? "Verified collaboration" : "Made together · in review"/);
  /* progress outside the dialog */
  assert.match(js, /var label=total\?\(m\.status==="verified"\?total\+" \/ "\+total\+" · Verified":done\+" \/ "\+total/);
  assert.match(js, /if\(m\.id===ANTISOCIAL_ID\)activity="One mission, three levels"\+\(mine\?" · you: "\+mine\.done\+" \/ "\+mine\.total:""\)/);
  assert.match(js, /n\.type==="collaboration_published"/);
  /* the partner's page lists the projects they are credited on */
  const worker = await read('workers/mccluster/src/platform-api.js');
  assert.match(worker, /action_collaboration_posts\?partner_m_uid=eq\.\$\{resolved\.m_uid\}&select=post_id/);
});
