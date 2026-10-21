-- REVIEWED MANUAL ROLLBACK ONLY. Never run automatically.
-- Stop Intel mutations / disable collector before application. Roll back Worker
-- and context-decision as a coordinated release; do not restore v1 mutation
-- traffic while claiming v2 integrity. Keep all decisions, basis, reviews and
-- audit receipts. This reverses enforcement, not history or review status.
begin;
drop trigger if exists intel_decision_approval_v2 on ai_context.decisions;
drop trigger if exists intel_mission_basis_v2 on public.intel_mission_decisions;
drop trigger if exists intel_source_revision_v2 on public.intel_evidence;
drop trigger if exists intel_evidence_content_review_v2 on public.intel_evidence;
drop trigger if exists intel_claim_content_review_v2 on public.intel_claims;
drop trigger if exists intel_evidence_correction_v2 on public.intel_evidence;
drop trigger if exists intel_claim_correction_v2 on public.intel_claims;
drop trigger if exists intel_claim_link_review_v2 on public.intel_claim_evidence;
drop trigger if exists intel_briefing_link_review_v2 on public.intel_briefing_citations;
drop trigger if exists intel_action_open_v2 on public.action_missions;
drop trigger if exists intel_action_start_v2 on public.action_mission_assignments;

create or replace function public.intel_record_decision_basis(
  p_org uuid, p_actor uuid, p_decision uuid, p_briefing uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  if not exists (select 1 from ai_context.decisions d where d.id = p_decision and d.org_id = p_org) then
    raise exception 'decision not found in this org' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.intel_briefings b where b.id = p_briefing and b.org_id = p_org and b.status = 'final') then
    raise exception 'briefing is not final in this org';
  end if;
  insert into public.intel_decision_basis (org_id, decision_id, briefing_id, recorded_by)
  values (p_org, p_decision, p_briefing, p_actor)
  on conflict do nothing;
  insert into public.intel_decision_basis (org_id, decision_id, claim_id, recorded_by)
  select distinct p_org, p_decision, bc.claim_id, p_actor
  from public.intel_briefing_citations bc where bc.briefing_id = p_briefing and bc.claim_id is not null
  on conflict do nothing;
  insert into public.intel_decision_basis (org_id, decision_id, evidence_id, recorded_by)
  select distinct p_org, p_decision, bc.evidence_id, p_actor
  from public.intel_briefing_citations bc where bc.briefing_id = p_briefing and bc.evidence_id is not null
  on conflict do nothing;
  select count(*) into v_rows from public.intel_decision_basis where decision_id = p_decision;
  return jsonb_build_object('decision_id', p_decision, 'basis_items', v_rows);
end
$$;

create or replace function public.intel_create_mission_from_decision(
  p_org uuid, p_actor uuid, p_decision uuid, p_idempotency_key text, p_mission jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text; v_existing public.intel_mission_decisions%rowtype; v_mission uuid;
begin
  select * into v_existing from public.intel_mission_decisions where org_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.decision_id <> p_decision then raise exception 'idempotency key reused for a different decision'; end if;
    return jsonb_build_object('mission_id', v_existing.mission_id, 'decision_id', p_decision, 'created', false);
  end if;

  select d.status into v_status from ai_context.decisions d where d.id = p_decision and d.org_id = p_org for share;
  if v_status is null then raise exception 'decision not found in this org' using errcode = 'P0002'; end if;
  if v_status <> 'approved' then raise exception 'decision is %, not approved', v_status using errcode = '42501'; end if;

  insert into public.action_missions (title, description, domain, status, proof_required, verification_mode)
  values (
    left(p_mission->>'title', 160), coalesce(p_mission->>'description', ''),
    coalesce(p_mission->>'domain', 'community'), 'draft', true, 'review'
  )
  returning id into v_mission;

  insert into public.intel_mission_decisions (mission_id, org_id, decision_id, objectives, scope, region_label, target_measures, idempotency_key, linked_by)
  values (
    v_mission, p_org, p_decision,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_mission->'objectives', '[]'::jsonb))), '{}'),
    p_mission->>'scope', p_mission->>'region_label', coalesce(p_mission->'target_measures', '{}'::jsonb),
    p_idempotency_key, p_actor
  );
  return jsonb_build_object('mission_id', v_mission, 'decision_id', p_decision, 'created', true, 'mission_status', 'draft');
end
$$;

create or replace function public.intel_health(p_org uuid, p_connector_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select * from public.ops_ingest_connectors where org_id = p_org and connector_key = p_connector_key
  ), latest as (
    select r.* from public.ops_ingest_runs r join c on c.id = r.connector_id order by r.started_at desc limit 1
  ), last_ok as (
    select r.* from public.ops_ingest_runs r join c on c.id = r.connector_id
    where r.status in ('succeeded', 'partial') order by r.started_at desc limit 1
  )
  select jsonb_build_object(
    'connector', (select jsonb_build_object('id', id, 'key', connector_key, 'enabled', enabled, 'cursor', cursor,
                   'last_sync_at', last_sync_at, 'last_ok_at', last_ok_at, 'last_error', last_error, 'last_error_at', last_error_at) from c),
    'stored', jsonb_build_object(
      'source_records', (select count(*) from public.ops_ingest_records r join c on c.id = r.connector_id),
      'evidence_total', (select count(*) from public.intel_evidence where org_id = p_org),
      'evidence_by_review', coalesce((select jsonb_object_agg(review_status, n) from (
          select review_status, count(*) n from public.intel_evidence where org_id = p_org group by 1) s), '{}'::jsonb),
      'claims', (select count(*) from public.intel_claims where org_id = p_org),
      'briefings', (select count(*) from public.intel_briefings where org_id = p_org),
      'decisions_with_basis', (select count(distinct decision_id) from public.intel_decision_basis where org_id = p_org),
      'missions_from_decisions', (select count(*) from public.intel_mission_decisions where org_id = p_org),
      'outcomes', (select count(*) from public.intel_outcomes where org_id = p_org)
    ),
    'latest_run', (select jsonb_build_object('id', id, 'status', status, 'started_at', started_at, 'finished_at', finished_at,
                   'records_seen', records_seen, 'records_written', records_written, 'records_rejected', records_rejected,
                   'error', error) from latest),
    'last_successful_run', (select jsonb_build_object('id', id, 'status', status, 'started_at', started_at,
                   'records_written', records_written) from last_ok),
    'failures', jsonb_build_object(
      'last_7d', (select count(*) from public.ops_ingest_runs r join c on c.id = r.connector_id
                  where r.status = 'failed' and r.started_at > now() - interval '7 days'),
      'runs_last_7d', (select count(*) from public.ops_ingest_runs r join c on c.id = r.connector_id
                  where r.started_at > now() - interval '7 days')
    )
  )
$$;
drop function if exists public.intel_action_readiness_guard();
drop function if exists public.intel_link_review_guard();
drop function if exists public.intel_mission_basis_guard();
drop function if exists public.intel_decision_approval_guard();
drop function if exists public.intel_source_revision_guard();
drop function if exists public.intel_review_correction_guard();
drop function if exists public.intel_content_review_guard();
drop function if exists public.intel_decision_readiness(uuid,uuid);
drop function if exists public.intel_basis_snapshot(uuid,uuid);
drop function if exists public.intel_revision_time(text);
alter table public.intel_decision_basis drop constraint if exists intel_basis_decision_org_v2;
alter table public.intel_mission_decisions drop constraint if exists intel_mission_decision_org_v2;
alter table public.intel_outcomes drop constraint if exists intel_outcome_decision_org_v2;
drop index if exists ai_context.decisions_id_org_integrity_v2;
drop index if exists ai_context.decisions_actor_idempotency_v2;
commit;
