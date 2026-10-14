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
const SQL = 'supabase/pending/antisocial_get_social_completion_v1.sql';

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
  assert.match(runner, /apply supabase\/migrations\/20261014185154_antisocial_get_social_three_levels_draft\.sql\napply supabase\/pending\/antisocial_get_social_completion_v1\.sql/);
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
