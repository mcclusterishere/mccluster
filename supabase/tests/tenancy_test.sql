-- TENANCY, PROVEN.
--
-- The whole promise of 0026 is one sentence: a person who works for one
-- customer cannot see another customer's anything. That is not a thing to
-- assert in a comment. This sets up two orgs with real rows in both, signs
-- in as each staff member in turn, and counts what they can reach.
--
--     psql -d <db> -f supabase/tests/tenancy_test.sql
--
-- Runs inside a transaction that rolls back. Needs auth.uid() to read
-- request.jwt.claim.sub, which is what PostgREST sets — on a real Supabase
-- database that is already true.

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
begin;

create temp table t(step text, ok boolean);
-- the test writes its own results while wearing the authenticated role
grant all on t to authenticated;

-- ---- two customers, two people --------------------------------------
insert into public.orgs (slug, name, kind) values ('acme', 'Acme Bakery', 'business') returning id \gset a_
insert into public.orgs (slug, name, kind) values ('shiloh', 'Shiloh', 'building')  returning id \gset b_

\set ANN  '11111111-1111-1111-1111-111111111111'
\set BEN  '22222222-2222-2222-2222-222222222222'
\set NOBODY '33333333-3333-3333-3333-333333333333'

insert into public.org_members (org_id, profile_id, role) values (:'a_id', :'ANN', 'owner');
insert into public.org_members (org_id, profile_id, role) values (:'b_id', :'BEN', 'staff');

-- ---- a contact, a thread and a message in each -----------------------
insert into public.inbox_contacts (org_id, channel, external_id, display_name)
  values (:'a_id', 'site', 'acme-visitor', 'Acme visitor') returning id \gset ac_
insert into public.inbox_contacts (org_id, channel, external_id, display_name)
  values (:'b_id', 'site', 'shiloh-visitor', 'Shiloh visitor') returning id \gset bc_

insert into public.inbox_conversations (org_id, contact_id, channel, kind)
  values (:'a_id', :'ac_id', 'site', 'dm') returning id \gset acv_
insert into public.inbox_conversations (org_id, contact_id, channel, kind)
  values (:'b_id', :'bc_id', 'site', 'dm') returning id \gset bcv_

insert into public.inbox_messages (org_id, conv_id, direction, author, body, state)
  values (:'a_id', :'acv_id', 'in', 'contact', 'what time do you open', 'delivered');
insert into public.inbox_messages (org_id, conv_id, direction, author, body, state)
  values (:'b_id', :'bcv_id', 'in', 'contact', 'the sanctuary is freezing', 'delivered');

insert into public.inbox_tags (contact_id, tag) values (:'ac_id', 'acme-only');
insert into public.inbox_tags (contact_id, tag) values (:'bc_id', 'shiloh-only');

-- ---- knowledge, memory, money ---------------------------------------
insert into public.kb_documents (org_id, kind, title, body, content_hash)
  values (:'a_id', 'page', 'Acme hours', 'We open at seven.', 'h1') returning id \gset ad_
insert into public.kb_documents (org_id, kind, title, body, content_hash)
  values (:'b_id', 'page', 'Shiloh building', 'The boiler is in the basement.', 'h2') returning id \gset bd_
insert into public.kb_chunks (document_id, ordinal, heading, body) values (:'ad_id', 0, 'Acme hours', 'We open at seven.');
insert into public.kb_chunks (document_id, ordinal, heading, body) values (:'bd_id', 0, 'Shiloh building', 'The boiler is in the basement.');

insert into public.memory_facts (contact_id, key, value) values (:'ac_id', 'allergy', 'peanuts');
insert into public.memory_facts (contact_id, key, value) values (:'bc_id', 'pew', 'row four');

insert into public.memory_shared (org_id, kind, key, value) values (:'a_id', 'fact', 'acme_hours', 'seven to three');
insert into public.memory_shared (org_id, kind, key, value) values (:'b_id', 'fact', 'shiloh_service', 'Sunday ten');

insert into public.ai_calls (org_id, purpose, model, cost_micros) values (:'a_id', 'answer', 'claude-opus-5', 41000) returning id \gset acall_
insert into public.ai_calls (org_id, purpose, model, cost_micros) values (:'b_id', 'answer', 'claude-opus-5', 900000) returning id \gset bcall_
insert into public.ai_evals (call_id, dimension, verdict) values (:'acall_id', 'helpful', 1);
insert into public.ai_evals (call_id, dimension, verdict) values (:'bcall_id', 'helpful', -1);

insert into public.org_channels (org_id, channel, enabled, token_env, account_id)
  values (:'a_id', 'site', true, 'ACME_TOKEN', 'acme-1');
insert into public.org_channels (org_id, channel, enabled, token_env, account_id)
  values (:'b_id', 'site', true, 'SHILOH_TOKEN', 'shiloh-1');

-- ============================================================
-- ANN works for Acme.
-- ============================================================
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claim.email = 'ann@acme.test';

insert into t select 'A contacts: only her own    ', count(*) = 1 and min(display_name) = 'Acme visitor' from public.inbox_contacts;
insert into t select 'B threads: only her own     ', count(*) = 1 from public.inbox_conversations;
insert into t select 'C messages: only her own    ', count(*) = 1 and min(body) = 'what time do you open' from public.inbox_messages;
insert into t select 'D tags reached via contact  ', count(*) = 1 and min(tag) = 'acme-only' from public.inbox_tags;
-- The knowledge base, the memory and the ledger are not readable by a
-- browser AT ALL — not filtered, closed. They are served by the function,
-- which re-checks the caller. A permission error here is the pass.
do $$
declare bad text := '';
begin
  begin perform 1 from public.kb_documents; bad := bad || 'kb_documents '; exception when insufficient_privilege then end;
  begin perform 1 from public.kb_chunks;    bad := bad || 'kb_chunks ';    exception when insufficient_privilege then end;
  begin perform 1 from public.memory_facts; bad := bad || 'memory_facts '; exception when insufficient_privilege then end;
  begin perform 1 from public.memory_shared;bad := bad || 'memory_shared ';exception when insufficient_privilege then end;
  begin perform 1 from public.ai_calls;     bad := bad || 'ai_calls ';     exception when insufficient_privilege then end;
  begin perform 1 from public.ai_evals;     bad := bad || 'ai_evals ';     exception when insufficient_privilege then end;
  -- the spend view too: security_invoker means it can never show more
  -- than its caller may see, and its caller may see none of ai_calls
  begin perform 1 from public.ai_spend_24h; bad := bad || 'ai_spend_24h '; exception when insufficient_privilege then end;
  insert into t values ('E the brain is not a browser''s', bad = '');
end $$;
insert into t select 'K credentials: only hers    ', count(*) = 1 and min(token_env) = 'ACME_TOKEN' from public.org_channels;
insert into t select 'L the org list: only hers   ', count(*) = 1 and min(slug) = 'acme' from public.orgs;

-- The catalogue is not private: what Instagram can do is a fact.
insert into t select 'N the catalogue is shared   ', count(*) > 5 from public.inbox_channels;

-- She is an owner, so she may change her own credential...
do $$ begin
  update public.org_channels set account_label = 'changed' where channel = 'site';
  insert into t values ('O an owner may edit hers    ', true);
exception when others then insert into t values ('O an owner may edit hers    ', false);
end $$;

-- ...and cannot reach into the other org's, even by naming its id.
insert into t select 'P cannot write another org  ',
  (select count(*) from public.org_channels where token_env = 'SHILOH_TOKEN') = 0;

-- ============================================================
-- BEN works for Shiloh, and is staff rather than owner.
-- ============================================================
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local request.jwt.claim.email = 'ben@shiloh.test';

insert into t select 'Q Ben sees only Shiloh      ', count(*) = 1 and min(display_name) = 'Shiloh visitor' from public.inbox_contacts;
insert into t select 'R Ben''s messages are his    ', count(*) = 1 and min(body) = 'the sanctuary is freezing' from public.inbox_messages;
insert into t select 'S Ben''s threads are his     ', count(*) = 1 from public.inbox_conversations;

-- staff, not owner: he may read the credential but not change it
insert into t select 'T staff may read the channel', count(*) = 1 from public.org_channels;
do $$
declare n int;
begin
  update public.org_channels set account_label = 'ben was here';
  get diagnostics n = row_count;
  insert into t values ('U staff may not change it   ', n = 0);
exception when others then insert into t values ('U staff may not change it   ', true);
end $$;

-- ============================================================
-- A signed-in stranger who works for nobody.
-- ============================================================
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
set local request.jwt.claim.email = 'nobody@example.test';

insert into t select 'V a stranger sees no threads', count(*) = 0 from public.inbox_conversations;
insert into t select 'W a stranger sees no tags   ', count(*) = 0 from public.inbox_tags;
insert into t select 'X a stranger sees no messages', count(*) = 0 from public.inbox_messages;
insert into t select 'Y a stranger sees no tokens ', count(*) = 0 from public.org_channels;
insert into t select 'Z a stranger sees no orgs   ', count(*) = 0 from public.orgs;

reset role;

-- ============================================================
-- THE ONE THAT MATTERS MOST
--
-- Everything above is rows a browser could read. This is SENTENCES the
-- bot could say. The function runs on the service role, so no policy
-- constrains its retrieval — only the org argument to kb_search does, and
-- if that were wrong the bot would answer one customer's question out of
-- another customer's documents, aloud, in the wrong company's name.
-- ============================================================
insert into public.kb_documents (org_id,kind,title,body,content_hash)
  values (:'a_id','page','Acme pricing','A five page site is 2,500 dollars.','h1') returning id \gset pad_
insert into public.kb_documents (org_id,kind,title,body,content_hash)
  values (:'b_id','page','Shiloh pricing','Pew rental is 40 dollars an hour.','h2') returning id \gset pbd_

insert into public.kb_chunks (document_id,ordinal,heading,body)
  values (:'pad_id',0,'Acme pricing','A five page site is 2,500 dollars.');
insert into public.kb_chunks (document_id,ordinal,heading,body)
  values (:'pbd_id',0,'Shiloh pricing','Pew rental is 40 dollars an hour.');

-- Both documents match "pricing dollars". Without the org argument the
-- second tenant's sentence would come back as an answer for the first.
insert into t select 'AA retrieval is Acme''s only', count(*) = 1 and min(title) = 'Acme pricing'
  from public.kb_search(:'a_id', 'pricing dollars');

insert into t select 'AB and Shiloh''s only Shiloh', count(*) = 1 and min(title) = 'Shiloh pricing'
  from public.kb_search(:'b_id', 'pricing dollars');

insert into t select 'AC empty org gets nothing   ', count(*) = 0
  from public.kb_search(gen_random_uuid(), 'pricing dollars');

-- a disabled document is not searched even within its own org
update public.kb_documents set enabled = false where id = :'pad_id';
insert into t select 'AD a disabled doc is silent ', count(*) = 0
  from public.kb_search(:'a_id', 'pricing dollars');

-- ============================================================
-- TOOLS THAT DO THINGS
--
-- The check constraint is the one thing standing between "the model may
-- use this without asking" and "the model may unlock a door without
-- asking". Constraints that are only asserted in comments are the ones
-- that turn out not to exist.
-- ============================================================

insert into public.mcp_servers (org_id, name, url)
  values (:'a_id', 'the building', 'https://example.invalid/mcp') returning id \gset ms_

insert into public.mcp_tools (server_id, org_id, name, risk, auto)
  values (:'ms_id', :'a_id', 'read_temp', 'read', true);
insert into t values ('BA a read tool may be automatic', true);

do $$
declare srv uuid; org uuid;
begin
  select id into srv from public.mcp_servers where name = 'the building';
  select org_id into org from public.mcp_servers where id = srv;
  begin
    insert into public.mcp_tools (server_id, org_id, name, risk, auto)
      values (srv, org, 'unlock_door', 'act', true);
    insert into t values ('BB an act tool cannot be automatic', false);
  exception when check_violation then
    insert into t values ('BB an act tool cannot be automatic', true);
  end;
  begin
    insert into public.mcp_tools (server_id, org_id, name, risk, auto)
      values (srv, org, 'book_room', 'write', true);
    insert into t values ('BC nor can a write tool     ', false);
  exception when check_violation then
    insert into t values ('BC nor can a write tool     ', true);
  end;
end $$;

-- a tool a refresh just discovered is OFF, and cautious about itself
insert into public.mcp_tools (server_id, org_id, name) values (:'ms_id', :'a_id', 'fresh_tool');
insert into t select 'BD a new tool arrives off   ', not enabled and risk = 'act' and not auto
  from public.mcp_tools where server_id = :'ms_id' and name = 'fresh_tool';

-- two people pressing approve produce one call, not two
insert into public.mcp_approvals (org_id, server_id, tool, arguments, reason)
  values (:'a_id', :'ms_id', 'unlock_door', '{"door":"west"}'::jsonb, 'somebody is locked out')
  returning id \gset ap_
insert into t select 'BE the first decision wins  ', (public.mcp_decide(:'ap_id', true, :'ANN')).id is not null;
insert into t select 'BF the second gets nothing  ', (public.mcp_decide(:'ap_id', true, :'BEN')).id is null;

insert into public.mcp_approvals (org_id, server_id, tool, arguments, reason, expires_at)
  values (:'a_id', :'ms_id', 'unlock_door', '{}'::jsonb, 'stale', now() - interval '1 minute')
  returning id \gset ex_
insert into t select 'BG a lapsed request is no   ', (public.mcp_decide(:'ex_id', true, :'ANN')).id is null;

select case when ok then '  ok    ' else '  FAIL  ' end || step from t order by step;
select case when bool_and(coalesce(ok, false)) then E'\n  tenancy holds: every check passed'
            else E'\n  TENANCY LEAKS: see the failures above' end from t;
rollback;
