-- ROLLBACK for ai_context_entity_resolution_v1 (20261125001000_ai_context_entity_resolution_v1.sql). Owner approval required.
-- Drops only what the forward file created. Kept as audit history: ai_context.decisions rows it wrote (metadata ingress
-- 'entity_resolution'), ops_entity_resolution_events rows (namespace 'ontology.same_as') and control_approvals rows
-- (resource_type 'entity_match'). Pending approvals for matches are expired so Control stops offering them. The
-- 'entity.resolve' capability predates this file and stays. No ontology object, alias or source record is touched.
begin;
set local lock_timeout = '5s';
update public.control_approvals a set state = 'expired'
 where a.resource_type = 'entity_match' and a.state = 'pending';
drop function if exists public.ops_entity_match_cluster(uuid, uuid);
drop function if exists public.ops_entity_match_list(uuid, text, integer);
drop function if exists public.ops_entity_match_unlink(uuid, uuid, uuid, text);
drop function if exists public.ops_entity_match_settle(uuid, uuid, uuid);
drop function if exists public.ops_entity_match_record(uuid, uuid, jsonb);
drop function if exists public.ops_entity_match_objects(uuid, text[], uuid, integer);
drop function if exists ai_context.entity_match_transition(ai_context.entity_matches, text, uuid, text, text, text);
drop function if exists ai_context.entity_match_json(ai_context.entity_matches);
drop function if exists ai_context.entity_match_require_owner(uuid, uuid);
drop table if exists ai_context.entity_match_events;
drop table if exists ai_context.entity_matches;
drop table if exists ai_context.entity_match_runs;
commit;
