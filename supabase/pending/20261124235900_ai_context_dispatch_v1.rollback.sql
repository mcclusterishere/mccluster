-- ROLLBACK for ai_context_dispatch_v1 (20261124235900_ai_context_dispatch_v1.sql). Owner approval required.
-- Drops only what the forward file created. ai_context.decisions rows it wrote (metadata ingress 'dispatch') and
-- control_approvals rows (capability 'dispatch.execute') are kept as audit history; the capability row is removed
-- only when no approval references it.
begin;
set local lock_timeout = '5s';
drop function if exists public.ops_ai_dispatch_get(uuid, uuid);
drop function if exists public.ops_ai_dispatch_claim(uuid, uuid, uuid);
drop function if exists public.ops_ai_dispatch_attach(uuid, uuid, jsonb);
drop function if exists public.ops_ai_dispatch_record(uuid, uuid, jsonb);
drop function if exists ai_context.dispatch_turn_json(ai_context.dispatch_turns);
drop function if exists ai_context.dispatch_require_owner(uuid, uuid);
drop table if exists ai_context.dispatch_turns;
delete from public.control_capabilities c
 where c.capability = 'dispatch.execute'
   and not exists (select 1 from public.control_approvals a where a.capability = 'dispatch.execute');
commit;
