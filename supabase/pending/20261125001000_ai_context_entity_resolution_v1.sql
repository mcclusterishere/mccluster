-- AI CONTEXT ENTITY RESOLUTION v1 (migration name ai_context_entity_resolution_v1): automated duplicate-record
-- matching for ontology objects, built on the manual resolution layer (ops_entity_aliases,
-- ops_entity_resolution_events, ops_entity_resolve_service from universal_ingestion_entity_resolution_v1).
-- PENDING ONLY. Never applied to production. Owner approval required before any apply.
-- Contract: docs/control-plane/ENTITY-RESOLUTION.md. Rollback: 20261125001000_ai_context_entity_resolution_v1.rollback.sql.
-- Needs, already in production: ai_context.decisions, ai_context.workstream_require_house (ai_context_workstreams_v1),
-- public.orgs, public.org_members, public.ops_ontology_objects, public.ops_entity_resolution_events,
-- public.control_approvals, public.control_capabilities (and its 'entity.resolve' row).
--
-- What it creates, all additive:
--   ai_context.entity_match_runs     one row per scan: who ran it, the matcher version and the counts.
--   ai_context.entity_matches        one row per candidate pair (unique per org + ordered object pair): score, band,
--                                    hashed evidence, state. A row in state 'linked' IS the "same as" link.
--   ai_context.entity_match_events   every state change of every match, with actor and reason. Append only.
--   public.ops_entity_match_objects / _record / _settle / _unlink / _list / _cluster
--                                    SECURITY DEFINER, search_path pinned, EXECUTE for service_role only.
-- It changes no existing object and never updates or deletes an ontology object, an alias or a source record.
--
-- What the database decides for itself, whatever the caller says:
--   * the organization is the house and the actor is an owner member of it (scans run in an owner's name);
--   * both objects exist in the organization and are different; the pair is stored in one canonical order;
--   * a match is linked automatically only when its score is at least 0.950 AND its evidence holds a strong exact
--     key (email, phone or domain). A caller cannot lower that floor. Scores from 0.750 go to the owner as a pending
--     control_approvals row (capability 'entity.resolve'); anything lower is not recorded;
--   * a pair the owner rejected or unlinked is never proposed again by a scan; a linked or pending pair is not
--     re-recorded; an expired review is re-opened only by a later scan;
--   * a held match is linked only when its approval is approved and carries the same request hash;
--   * every state change writes one ai_context.decisions row, one ops_entity_resolution_events row and one
--     entity_match_events row in the same transaction. Unlinking is the reverse of linking and keeps all history.
-- One transaction, safe to run twice.
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if to_regnamespace('ai_context') is null or to_regclass('ai_context.decisions') is null
     or to_regprocedure('ai_context.workstream_require_house(uuid)') is null
     or to_regclass('public.orgs') is null or to_regclass('public.org_members') is null
     or to_regclass('public.ops_ontology_objects') is null or to_regclass('public.ops_entity_resolution_events') is null
     or to_regclass('public.control_approvals') is null or to_regclass('public.control_capabilities') is null then
    raise exception 'ai_context_entity_resolution_v1 needs ai_context.decisions, ai_context.workstream_require_house, public.orgs, public.org_members, public.ops_ontology_objects, public.ops_entity_resolution_events, public.control_approvals and public.control_capabilities; nothing changed' using errcode = '55000';
  end if;
end $guard$;

-- Already present in production (universal_ingestion_entity_resolution_v1); kept idempotent for clean databases.
insert into public.control_capabilities (capability, description, risk)
values ('entity.resolve', 'Resolve an external alias to a governed ontology object', 'medium')
on conflict (capability) do nothing;

create table if not exists ai_context.entity_match_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor_user_id uuid not null,
  trigger text not null default 'tool' check (trigger in ('tool', 'job', 'routine')),
  matcher_version text not null check (matcher_version ~ '^entity-match:v[0-9]+$'),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and octet_length(params::text) <= 8000),
  objects_scanned integer not null default 0 check (objects_scanned >= 0),
  pairs_compared integer not null default 0 check (pairs_compared >= 0),
  auto_linked integer not null default 0 check (auto_linked >= 0),
  queued_for_review integer not null default 0 check (queued_for_review >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  created_at timestamptz not null default now()
);
create index if not exists entity_match_runs_org_created_idx on ai_context.entity_match_runs (org_id, created_at desc);

create table if not exists ai_context.entity_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  left_object_id uuid not null,
  right_object_id uuid not null,
  left_type text not null,
  right_type text not null,
  family text not null check (family in ('person', 'company')),
  score numeric(4,3) not null check (score between 0 and 1),
  band text not null check (band in ('auto', 'review')),
  strong_key boolean not null default false,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 8000),
  matcher_version text not null check (matcher_version ~ '^entity-match:v[0-9]+$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('linked', 'pending_review', 'rejected', 'unlinked', 'expired')),
  link_method text check (link_method is null or link_method in ('rule', 'manual')),
  approval_id uuid references public.control_approvals(id) on delete set null,
  decision_id uuid references ai_context.decisions(id) on delete set null,
  run_id uuid references ai_context.entity_match_runs(id) on delete set null,
  linked_at timestamptz,
  linked_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_reason text check (close_reason is null or char_length(close_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entity_matches_pair unique (org_id, left_object_id, right_object_id),
  constraint entity_matches_ordered check (left_object_id < right_object_id),
  constraint entity_matches_left_fk foreign key (left_object_id, org_id) references public.ops_ontology_objects(id, org_id) on delete cascade,
  constraint entity_matches_right_fk foreign key (right_object_id, org_id) references public.ops_ontology_objects(id, org_id) on delete cascade,
  constraint entity_matches_auto_floor check (band <> 'auto' or (score >= 0.950 and strong_key)),
  constraint entity_matches_review_floor check (score >= 0.750),
  constraint entity_matches_linked_shape check (status <> 'linked' or (linked_at is not null and link_method is not null))
);
create index if not exists entity_matches_org_status_idx on ai_context.entity_matches (org_id, status, updated_at desc);
create index if not exists entity_matches_left_idx on ai_context.entity_matches (org_id, left_object_id) where status = 'linked';
create index if not exists entity_matches_right_idx on ai_context.entity_matches (org_id, right_object_id) where status = 'linked';
create index if not exists entity_matches_approval_idx on ai_context.entity_matches (approval_id) where approval_id is not null;

create table if not exists ai_context.entity_match_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  match_id uuid not null references ai_context.entity_matches(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('owner', 'system')),
  reason text check (reason is null or char_length(reason) <= 1000),
  decision_id uuid references ai_context.decisions(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists entity_match_events_match_idx on ai_context.entity_match_events (match_id, at);

alter table ai_context.entity_match_runs enable row level security;
alter table ai_context.entity_matches enable row level security;
alter table ai_context.entity_match_events enable row level security;
revoke all on ai_context.entity_match_runs from public, anon, authenticated, service_role;
revoke all on ai_context.entity_matches from public, anon, authenticated, service_role;
revoke all on ai_context.entity_match_events from public, anon, authenticated, service_role;

create or replace function ai_context.entity_match_require_owner(p_org uuid, p_actor uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  perform ai_context.workstream_require_house(p_org);
  if p_actor is null or not exists (
       select 1 from public.org_members m where m.org_id = p_org and m.role = 'owner' and m.profile_id = p_actor) then
    raise exception 'entity resolution needs an owner of this organization' using errcode = '42501';
  end if;
end;
$$;

create or replace function ai_context.entity_match_json(p_row ai_context.entity_matches)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_row.id, 'left_object_id', p_row.left_object_id, 'right_object_id', p_row.right_object_id,
    'left_type', p_row.left_type, 'right_type', p_row.right_type, 'family', p_row.family, 'score', p_row.score,
    'band', p_row.band, 'strong_key', p_row.strong_key, 'evidence', p_row.evidence, 'matcher_version', p_row.matcher_version,
    'request_hash', p_row.request_hash, 'status', p_row.status, 'link_method', p_row.link_method,
    'approval_id', p_row.approval_id, 'decision_id', p_row.decision_id, 'run_id', p_row.run_id,
    'linked_at', p_row.linked_at, 'linked_by', p_row.linked_by, 'closed_at', p_row.closed_at, 'closed_by', p_row.closed_by,
    'close_reason', p_row.close_reason, 'created_at', p_row.created_at, 'updated_at', p_row.updated_at);
$$;

-- One audited state change: the decision, the legacy resolution event and the match event, together.
create or replace function ai_context.entity_match_transition(
  p_row ai_context.entity_matches, p_to text, p_actor uuid, p_actor_kind text, p_reason text, p_decision_status text)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_decision uuid;
begin
  insert into ai_context.decisions (org_id, title, decision, rationale_summary, risk_class, status, proposed_by, approved_by, approved_at, metadata)
  values (p_row.org_id,
          left('Entity match: ' || p_row.left_type || ' ~ ' || p_row.right_type || ' -> ' || p_to, 200),
          left(case p_to when 'linked' then 'Link as the same ' || p_row.family
                         when 'pending_review' then 'Ask the owner whether these are the same ' || p_row.family
                         when 'unlinked' then 'Remove the same-' || p_row.family || ' link'
                         when 'rejected' then 'Not the same ' || p_row.family
                         else 'Review expired' end
               || ' (' || p_row.left_object_id || ', ' || p_row.right_object_id || ')', 500),
          left(coalesce(p_reason, '') || ' score ' || p_row.score::text || '; keys '
               || coalesce((select string_agg(k->>'kind', ',' order by k->>'kind') from jsonb_array_elements(coalesce(p_row.evidence->'keys', '[]'::jsonb)) k), ''), 1000),
          case when p_to = 'linked' then 'medium' else 'low' end,
          p_decision_status,
          case when p_actor_kind = 'owner' then 'owner:' else 'entity_match:' end || coalesce(p_actor::text, 'system'),
          case when p_decision_status = 'approved' then p_actor end,
          case when p_decision_status = 'approved' then now() end,
          jsonb_build_object('ingress', 'entity_resolution', 'match_id', p_row.id, 'from_status', p_row.status, 'to_status', p_to,
                             'score', p_row.score, 'band', p_row.band, 'matcher_version', p_row.matcher_version,
                             'request_hash', p_row.request_hash, 'left_object_id', p_row.left_object_id,
                             'right_object_id', p_row.right_object_id, 'reversible', true))
  returning id into v_decision;

  insert into public.ops_entity_resolution_events (org_id, namespace, alias_key, candidate_object_id, selected_object_id,
                                                   decision, method, confidence, rationale, actor_user_id, actor_kind)
  values (p_row.org_id, 'ontology.same_as', p_row.right_object_id::text, p_row.right_object_id, p_row.left_object_id,
          case p_to when 'linked' then 'resolve' when 'pending_review' then 'candidate' else 'reject' end,
          case when p_row.link_method = 'manual' or p_actor_kind = 'owner' then 'manual' else 'rule' end,
          p_row.score, left(coalesce(p_reason, p_to), 1000), p_actor,
          case when p_actor_kind = 'owner' then 'owner' else 'system' end);

  insert into ai_context.entity_match_events (org_id, match_id, from_status, to_status, actor_user_id, actor_kind, reason, decision_id)
  values (p_row.org_id, p_row.id, nullif(p_row.status, p_to), p_to, p_actor, p_actor_kind, left(p_reason, 1000), v_decision);
  return v_decision;
end;
$$;

-- Read the objects a scan compares, in stable pages.
create or replace function public.ops_entity_match_objects(
  p_org uuid, p_type_keys text[], p_after_id uuid default null, p_limit integer default 1000)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  perform ai_context.workstream_require_house(p_org);
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'type_key', o.type_key, 'object_key', o.object_key,
                                               'display_name', o.display_name, 'properties', o.properties) order by o.id), '[]'::jsonb)
    into v_rows
    from (select * from public.ops_ontology_objects x
           where x.org_id = p_org and x.type_key = any (coalesce(p_type_keys, '{}'::text[]))
             and (p_after_id is null or x.id > p_after_id)
           order by x.id
           limit greatest(1, least(coalesce(p_limit, 1000), 2000))) o;
  return jsonb_build_object('objects', v_rows,
                            'next_after_id', case when jsonb_array_length(v_rows) > 0 then v_rows->(jsonb_array_length(v_rows) - 1)->>'id' end);
end;
$$;

-- Record one scan: the run, and each candidate as an automatic link or an owner review, in one transaction.
create or replace function public.ops_entity_match_record(p_org uuid, p_actor uuid, p_run jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := coalesce(p_run, '{}'::jsonb);
  c jsonb;
  v_run uuid;
  v_left uuid;
  v_right uuid;
  v_score numeric;
  v_strong boolean;
  v_band text;
  v_existing ai_context.entity_matches;
  v_row ai_context.entity_matches;
  v_left_type text;
  v_right_type text;
  v_approval uuid;
  v_decision uuid;
  v_auto integer := 0;
  v_review integer := 0;
  v_skipped integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  perform ai_context.entity_match_require_owner(p_org, p_actor);
  if jsonb_typeof(coalesce(r->'candidates', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(r->'candidates', '[]'::jsonb)) > 500 then
    raise exception 'candidates must be an array of at most 500 pairs; nothing was recorded' using errcode = '22023';
  end if;

  insert into ai_context.entity_match_runs (org_id, actor_user_id, trigger, matcher_version, params, objects_scanned, pairs_compared)
  values (p_org, p_actor, coalesce(nullif(r->>'trigger', ''), 'tool'), r->>'matcher_version', coalesce(r->'params', '{}'::jsonb),
          greatest(0, coalesce((r->>'objects_scanned')::integer, 0)), greatest(0, coalesce((r->>'pairs_compared')::integer, 0)))
  returning id into v_run;

  for c in select value from jsonb_array_elements(coalesce(r->'candidates', '[]'::jsonb)) loop
    v_left := least((c->>'left_object_id')::uuid, (c->>'right_object_id')::uuid);
    v_right := greatest((c->>'left_object_id')::uuid, (c->>'right_object_id')::uuid);
    v_score := round((c->>'score')::numeric, 3);
    v_strong := coalesce((select bool_or(k->>'kind' in ('email', 'phone', 'domain'))
                            from jsonb_array_elements(coalesce(c->'evidence'->'keys', '[]'::jsonb)) k), false);
    -- The database, not the caller, picks the band.
    v_band := case when v_score >= 0.950 and v_strong then 'auto' when v_score >= 0.750 then 'review' else null end;
    select o.type_key into v_left_type from public.ops_ontology_objects o where o.org_id = p_org and o.id = v_left;
    select o.type_key into v_right_type from public.ops_ontology_objects o where o.org_id = p_org and o.id = v_right;
    if v_band is null or v_left = v_right or v_left_type is null or v_right_type is null
       or coalesce(c->>'request_hash', '') !~ '^[0-9a-f]{64}$' or coalesce(c->>'family', '') not in ('person', 'company')
       or jsonb_typeof(coalesce(c->'evidence', '{}'::jsonb)) <> 'object' then
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object('left_object_id', v_left, 'right_object_id', v_right, 'outcome', 'invalid');
      continue;
    end if;

    select * into v_existing from ai_context.entity_matches m
     where m.org_id = p_org and m.left_object_id = v_left and m.right_object_id = v_right for update;
    if found and v_existing.status <> 'expired' then
      -- linked or pending: already handled; rejected or unlinked: the owner said no, a scan never asks again.
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object('match_id', v_existing.id, 'outcome', 'unchanged', 'status', v_existing.status);
      continue;
    end if;

    if found then
      update ai_context.entity_matches m
         set score = v_score, band = v_band, strong_key = v_strong, evidence = coalesce(c->'evidence', '{}'::jsonb),
             matcher_version = r->>'matcher_version', request_hash = c->>'request_hash', run_id = v_run,
             left_type = v_left_type, right_type = v_right_type, approval_id = null, closed_at = null, closed_by = null,
             close_reason = null, updated_at = now()
       where m.id = v_existing.id
      returning * into v_row;
    else
      insert into ai_context.entity_matches (org_id, left_object_id, right_object_id, left_type, right_type, family, score, band,
                                             strong_key, evidence, matcher_version, request_hash, status, link_method,
                                             linked_at, linked_by, run_id)
      values (p_org, v_left, v_right, v_left_type, v_right_type, c->>'family', v_score, v_band, v_strong,
              coalesce(c->'evidence', '{}'::jsonb), r->>'matcher_version', c->>'request_hash',
              case when v_band = 'auto' then 'linked' else 'pending_review' end,
              case when v_band = 'auto' then 'rule' end, case when v_band = 'auto' then now() end,
              case when v_band = 'auto' then p_actor end, v_run)
      returning * into v_row;
      -- A new row has no earlier state: the transition below records where it starts.
      v_row.status := null;
    end if;

    if v_band = 'auto' then
      v_row.link_method := 'rule';
      v_decision := ai_context.entity_match_transition(v_row, 'linked', p_actor, 'system',
                      'High-confidence automatic link (strong exact key)', 'executed');
      update ai_context.entity_matches m
         set status = 'linked', link_method = 'rule', linked_at = now(), linked_by = p_actor, decision_id = v_decision, updated_at = now()
       where m.id = v_row.id returning * into v_row;
      v_auto := v_auto + 1;
    else
      insert into public.control_approvals (org_id, capability, resource_type, resource_id, request_hash, reason, state, requested_by, expires_at)
      values (p_org, 'entity.resolve', 'entity_match', v_row.id::text, v_row.request_hash,
              left('Possible duplicate ' || v_row.family || ': ' || v_left_type || ' ' || v_left || ' and ' || v_right_type || ' ' || v_right
                   || ' (score ' || v_score::text || '). Approve to link them as the same ' || v_row.family
                   || '. Nothing is merged or deleted; the link can be removed later.', 1000),
              'pending', p_actor, now() + interval '14 days')
      returning id into v_approval;
      v_decision := ai_context.entity_match_transition(v_row, 'pending_review', p_actor, 'system',
                      'Mid-confidence match held for owner review', 'proposed');
      update ai_context.entity_matches m
         set status = 'pending_review', approval_id = v_approval, decision_id = v_decision, linked_at = null, link_method = null, updated_at = now()
       where m.id = v_row.id returning * into v_row;
      v_review := v_review + 1;
    end if;
    v_results := v_results || jsonb_build_object('match_id', v_row.id, 'outcome', v_row.status, 'score', v_row.score, 'approval_id', v_row.approval_id);
  end loop;

  update ai_context.entity_match_runs x set auto_linked = v_auto, queued_for_review = v_review, skipped = v_skipped where x.id = v_run;
  return jsonb_build_object('run_id', v_run, 'auto_linked', v_auto, 'queued_for_review', v_review, 'skipped', v_skipped, 'results', v_results);
end;
$$;

-- Apply owner decisions taken in Control: approved and same hash -> linked; denied -> rejected; expired -> expired.
-- p_match null settles every pending match of the organization.
create or replace function public.ops_entity_match_settle(p_org uuid, p_actor uuid, p_match uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row ai_context.entity_matches;
  v_approval public.control_approvals;
  v_decision uuid;
  v_out jsonb := '[]'::jsonb;
begin
  perform ai_context.entity_match_require_owner(p_org, p_actor);
  for v_row in select * from ai_context.entity_matches m
                where m.org_id = p_org and m.status = 'pending_review' and (p_match is null or m.id = p_match)
                order by m.created_at for update loop
    select * into v_approval from public.control_approvals a where a.id = v_row.approval_id and a.org_id = p_org;
    if not found or v_approval.state = 'expired' or (v_approval.state = 'pending' and v_approval.expires_at <= now()) then
      v_decision := ai_context.entity_match_transition(v_row, 'expired', p_actor, 'system', 'Owner review expired without a decision', 'rejected');
      update ai_context.entity_matches m set status = 'expired', closed_at = now(), close_reason = 'review expired', updated_at = now()
       where m.id = v_row.id returning * into v_row;
      update ai_context.decisions x set status = 'rejected', updated_at = now()
       where x.org_id = p_org and x.status = 'proposed' and x.metadata->>'match_id' = v_row.id::text;
    elsif v_approval.state = 'denied' then
      v_decision := ai_context.entity_match_transition(v_row, 'rejected', v_approval.decided_by, 'owner', 'Owner denied the link in Control', 'rejected');
      update ai_context.entity_matches m set status = 'rejected', closed_at = now(), closed_by = v_approval.decided_by,
             close_reason = 'denied in Control', decision_id = v_decision, updated_at = now()
       where m.id = v_row.id returning * into v_row;
      update ai_context.decisions x set status = 'rejected', updated_at = now()
       where x.org_id = p_org and x.status = 'proposed' and x.metadata->>'match_id' = v_row.id::text;
    elsif v_approval.state = 'approved' then
      if v_approval.request_hash is distinct from v_row.request_hash or v_approval.resource_id <> v_row.id::text
         or v_approval.resource_type <> 'entity_match' or v_approval.capability <> 'entity.resolve' then
        raise exception 'the approval does not cover this exact match; nothing was linked' using errcode = '42501';
      end if;
      v_row.link_method := 'manual';
      update ai_context.decisions x set status = 'approved', approved_by = v_approval.decided_by,
             approved_at = coalesce(v_approval.decided_at, now()), updated_at = now()
       where x.org_id = p_org and x.status = 'proposed' and x.metadata->>'match_id' = v_row.id::text;
      v_decision := ai_context.entity_match_transition(v_row, 'linked', v_approval.decided_by, 'owner', 'Owner approved the link in Control', 'approved');
      update ai_context.entity_matches m set status = 'linked', link_method = 'manual', linked_at = now(),
             linked_by = v_approval.decided_by, decision_id = v_decision, updated_at = now()
       where m.id = v_row.id returning * into v_row;
    else
      continue; -- still pending and in date
    end if;
    v_out := v_out || jsonb_build_object('match_id', v_row.id, 'status', v_row.status);
  end loop;
  return jsonb_build_object('settled', v_out);
end;
$$;

-- The owner's reverse switch: a linked match becomes unlinked; a pending one becomes rejected (its approval denied).
create or replace function public.ops_entity_match_unlink(p_org uuid, p_actor uuid, p_match uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row ai_context.entity_matches;
  v_to text;
  v_decision uuid;
begin
  perform ai_context.entity_match_require_owner(p_org, p_actor);
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'say why the link is wrong (reason is required)' using errcode = '22023';
  end if;
  select * into v_row from ai_context.entity_matches m where m.org_id = p_org and m.id = p_match for update;
  if not found then
    raise exception 'entity match not found' using errcode = 'P0002';
  end if;
  if v_row.status not in ('linked', 'pending_review') then
    return jsonb_build_object('changed', false, 'match', ai_context.entity_match_json(v_row));
  end if;
  v_to := case when v_row.status = 'linked' then 'unlinked' else 'rejected' end;
  v_decision := ai_context.entity_match_transition(v_row, v_to, p_actor, 'owner', btrim(p_reason), 'approved');
  if v_row.status = 'pending_review' and v_row.approval_id is not null then
    update public.control_approvals a set state = 'denied', decided_by = p_actor, decided_at = now()
     where a.id = v_row.approval_id and a.org_id = p_org and a.state = 'pending';
    update ai_context.decisions x set status = 'rejected', updated_at = now()
     where x.org_id = p_org and x.status = 'proposed' and x.metadata->>'match_id' = v_row.id::text;
  end if;
  update ai_context.entity_matches m set status = v_to, closed_at = now(), closed_by = p_actor, close_reason = left(btrim(p_reason), 1000),
         decision_id = v_decision, updated_at = now()
   where m.id = v_row.id returning * into v_row;
  return jsonb_build_object('changed', true, 'match', ai_context.entity_match_json(v_row));
end;
$$;

create or replace function public.ops_entity_match_list(p_org uuid, p_status text default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  perform ai_context.workstream_require_house(p_org);
  select coalesce(jsonb_agg(ai_context.entity_match_json(m) order by m.updated_at desc, m.id), '[]'::jsonb) into v_rows
    from (select * from ai_context.entity_matches x
           where x.org_id = p_org and (p_status is null or x.status = p_status)
           order by x.updated_at desc, x.id limit greatest(1, least(coalesce(p_limit, 100), 500))) m;
  return jsonb_build_object('matches', v_rows);
end;
$$;

-- Everything currently linked to one object, transitively: the "same as" cluster. Read-only.
create or replace function public.ops_entity_match_cluster(p_org uuid, p_object uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_members jsonb;
begin
  perform ai_context.workstream_require_house(p_org);
  with recursive edges as (
    select m.left_object_id a, m.right_object_id b from ai_context.entity_matches m where m.org_id = p_org and m.status = 'linked'
    union all
    select m.right_object_id, m.left_object_id from ai_context.entity_matches m where m.org_id = p_org and m.status = 'linked'
  ), walk(id) as (
    select p_object
    union
    select e.b from walk w join edges e on e.a = w.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'type_key', o.type_key, 'object_key', o.object_key, 'display_name', o.display_name)
                            order by o.id), '[]'::jsonb)
    into v_members
    from walk w join public.ops_ontology_objects o on o.id = w.id and o.org_id = p_org;
  return jsonb_build_object('object_id', p_object, 'members', v_members);
end;
$$;

revoke all on function ai_context.entity_match_require_owner(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function ai_context.entity_match_json(ai_context.entity_matches) from public, anon, authenticated, service_role;
revoke all on function ai_context.entity_match_transition(ai_context.entity_matches, text, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.ops_entity_match_objects(uuid, text[], uuid, integer) from public, anon, authenticated;
revoke all on function public.ops_entity_match_record(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ops_entity_match_settle(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.ops_entity_match_unlink(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ops_entity_match_list(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.ops_entity_match_cluster(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ops_entity_match_objects(uuid, text[], uuid, integer) to service_role;
grant execute on function public.ops_entity_match_record(uuid, uuid, jsonb) to service_role;
grant execute on function public.ops_entity_match_settle(uuid, uuid, uuid) to service_role;
grant execute on function public.ops_entity_match_unlink(uuid, uuid, uuid, text) to service_role;
grant execute on function public.ops_entity_match_list(uuid, text, integer) to service_role;
grant execute on function public.ops_entity_match_cluster(uuid, uuid) to service_role;

comment on table ai_context.entity_matches is 'Private. Candidate duplicate pairs of ontology objects. status linked is a reversible same-as link; nothing is ever merged or deleted. Written only through public.ops_entity_match_* by service_role. docs/control-plane/ENTITY-RESOLUTION.md';
comment on table ai_context.entity_match_events is 'Private, append only. Every entity match state change with actor and reason.';
comment on table ai_context.entity_match_runs is 'Private. One row per entity resolution scan.';

commit;
