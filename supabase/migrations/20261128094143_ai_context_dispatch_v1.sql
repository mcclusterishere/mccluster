-- AI CONTEXT DISPATCH v1 (migration name ai_context_dispatch_v1): storage and audit for the McCluster dispatch
-- layer, the conversational front end that routes one owner message to an existing Core capability.
-- PENDING ONLY. Never applied to production. Owner approval required before any apply.
-- Contract: docs/control-plane/DISPATCH-LAYER.md. Rollback: 20261124235900_ai_context_dispatch_v1.rollback.sql.
-- Needs, already in production: ai_context.decisions, ai_context.workstream_require_house (ai_context_workstreams_v1),
-- public.orgs, public.org_members, public.ops_agent_jobs, public.control_approvals, public.control_capabilities.
--
-- What it creates, all additive:
--   public.control_capabilities 'dispatch.execute'   one row (risk high) so a dispatch approval is an ordinary
--                                                     public.control_approvals row Control already lists and decides.
--   ai_context.dispatch_turns                        one row per owner message (unique per org + operation key):
--                                                     the message, the routed intent and outcome, the exact tool
--                                                     arguments and their hash, and links to the job, approval,
--                                                     resident turn and decision. RLS on, no policy, no grants.
--   public.ops_ai_dispatch_record / _attach / _claim / _get
--                                                     SECURITY DEFINER, search_path pinned, EXECUTE for service_role
--                                                     only. The only way in.
-- It changes no existing object.
--
-- What the database decides for itself, whatever the caller says:
--   * the organization is the house (ai_context.workstream_require_house) and the actor is an owner member of it;
--   * recording a turn writes the turn, one ai_context.decisions row and, for a gated route, one pending
--     control_approvals row in the same transaction: nothing is recorded half way;
--   * a replay of the same operation key returns the first record and writes nothing;
--   * a held turn is claimed for execution once, only when its approval is approved, unexpired and carries the same
--     request hash as the turn; a denied or expired approval closes the turn and its decision.
-- One transaction, safe to run twice.
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if to_regnamespace('ai_context') is null or to_regclass('ai_context.decisions') is null
     or to_regprocedure('ai_context.workstream_require_house(uuid)') is null
     or to_regclass('public.orgs') is null or to_regclass('public.org_members') is null
     or to_regclass('public.ops_agent_jobs') is null or to_regclass('public.control_approvals') is null
     or to_regclass('public.control_capabilities') is null then
    raise exception 'ai_context_dispatch_v1 needs ai_context.decisions, ai_context.workstream_require_house, public.orgs, public.org_members, public.ops_agent_jobs, public.control_approvals and public.control_capabilities; nothing changed' using errcode = '55000';
  end if;
end $guard$;

insert into public.control_capabilities (capability, description, risk)
values ('dispatch.execute', 'Start a capability the McCluster dispatch layer routed from an owner message and held for owner approval', 'high')
on conflict (capability) do nothing;

create table if not exists ai_context.dispatch_turns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  operation_key text not null check (operation_key ~ '^dispatch:[0-9a-f-]{36}$'),
  actor_user_id uuid not null,
  thread_id uuid,
  message text not null check (char_length(message) between 1 and 12000),
  intent text not null check (intent ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  route text not null check (route in ('answer', 'clarify', 'run', 'approval', 'refused')),
  capability text check (capability is null or capability ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  tool text check (tool is null or tool ~ '^[a-z][a-z0-9_.:-]{1,80}$'),
  args jsonb not null default '{}'::jsonb check (jsonb_typeof(args) = 'object' and octet_length(args::text) <= 32000),
  request_hash text check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$'),
  classifier jsonb not null default '{}'::jsonb check (jsonb_typeof(classifier) = 'object' and octet_length(classifier::text) <= 16000),
  reply text check (reply is null or char_length(reply) <= 2000),
  status text not null check (status in ('routed', 'answered', 'refused', 'pending_approval', 'executing', 'queued', 'done', 'failed', 'denied', 'expired')),
  job_id uuid,
  resident_turn_id uuid,
  approval_id uuid references public.control_approvals(id) on delete set null,
  decision_id uuid references ai_context.decisions(id) on delete set null,
  result jsonb check (result is null or octet_length(result::text) <= 16000),
  error text check (error is null or char_length(error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dispatch_turns_operation_key unique (org_id, operation_key),
  constraint dispatch_turns_capability_route check ((route in ('run', 'approval')) = (tool is not null and capability is not null and request_hash is not null))
);
create index if not exists dispatch_turns_org_created_idx on ai_context.dispatch_turns (org_id, created_at desc);
create index if not exists dispatch_turns_job_idx on ai_context.dispatch_turns (job_id) where job_id is not null;
alter table ai_context.dispatch_turns enable row level security;
revoke all on ai_context.dispatch_turns from public, anon, authenticated, service_role;

create or replace function ai_context.dispatch_require_owner(p_org uuid, p_actor uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  perform ai_context.workstream_require_house(p_org);
  if p_actor is null or not exists (
       select 1 from public.org_members m where m.org_id = p_org and m.role = 'owner' and m.profile_id = p_actor) then
    raise exception 'dispatch needs an owner of this organization' using errcode = '42501';
  end if;
end;
$$;

create or replace function ai_context.dispatch_turn_json(p_row ai_context.dispatch_turns)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_row.id, 'operation_key', p_row.operation_key, 'thread_id', p_row.thread_id, 'message', p_row.message,
    'intent', p_row.intent, 'route', p_row.route, 'capability', p_row.capability, 'tool', p_row.tool, 'args', p_row.args,
    'request_hash', p_row.request_hash, 'classifier', p_row.classifier, 'reply', p_row.reply, 'status', p_row.status,
    'job_id', p_row.job_id, 'resident_turn_id', p_row.resident_turn_id, 'approval_id', p_row.approval_id,
    'decision_id', p_row.decision_id, 'result', p_row.result, 'error', p_row.error,
    'created_at', p_row.created_at, 'updated_at', p_row.updated_at);
$$;

-- Record one routed message: the turn, its decision and (gated routes) its pending approval, together.
create or replace function public.ops_ai_dispatch_record(p_org uuid, p_actor uuid, p_turn jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t jsonb := coalesce(p_turn, '{}'::jsonb);
  v_key text := t->>'operation_key';
  v_route text := t->>'route';
  v_existing ai_context.dispatch_turns;
  v_row ai_context.dispatch_turns;
  v_id uuid := gen_random_uuid();
  v_decision uuid;
  v_approval uuid;
  v_status text;
  v_decision_status text;
  v_risk text := coalesce(nullif(t->>'risk_class', ''), 'low');
begin
  perform ai_context.dispatch_require_owner(p_org, p_actor);
  if jsonb_typeof(t) <> 'object' or v_key is null then
    raise exception 'turn must be an object with an operation_key' using errcode = '22023';
  end if;
  if v_risk not in ('low', 'medium', 'high', 'critical') then
    raise exception 'risk_class must be low, medium, high or critical' using errcode = '22023';
  end if;

  select * into v_existing from ai_context.dispatch_turns d where d.org_id = p_org and d.operation_key = v_key;
  if found then
    return jsonb_build_object('replayed', true, 'turn', ai_context.dispatch_turn_json(v_existing));
  end if;

  if (select count(*) from ai_context.dispatch_turns d where d.org_id = p_org and d.created_at > now() - interval '24 hours') >= 2000 then
    raise exception 'this organization has dispatched 2000 messages in the last 24 hours; nothing was recorded' using errcode = '54000';
  end if;

  v_status := case v_route when 'answer' then 'answered' when 'clarify' then 'answered' when 'refused' then 'refused'
                           when 'approval' then 'pending_approval' when 'run' then 'routed' end;
  v_decision_status := case v_route when 'approval' then 'proposed' when 'refused' then 'rejected' else 'executed' end;

  insert into ai_context.decisions (org_id, title, decision, rationale_summary, risk_class, status, proposed_by, metadata)
  values (p_org,
          left('Dispatch: ' || coalesce(t->>'intent', 'unknown') || ' -> ' || coalesce(v_route, 'unknown'), 200),
          left(coalesce(t->>'tool', v_route, 'none') || coalesce(' ' || nullif(t->>'capability', ''), ''), 500),
          left(coalesce(t->'classifier'->>'reason', '') || coalesce('; ' || (t->'classifier'->'gate'->>'reason'), ''), 1000),
          v_risk, v_decision_status, 'dispatch:' || p_actor::text,
          jsonb_build_object('ingress', 'dispatch', 'dispatch_turn_id', v_id, 'operation_key', v_key,
                             'request_hash', t->>'request_hash', 'confidence', t->'classifier'->'confidence'))
  returning id into v_decision;

  if v_route = 'approval' then
    insert into public.control_approvals (org_id, capability, resource_type, resource_id, request_hash, reason, state, requested_by, expires_at)
    values (p_org, 'dispatch.execute', 'dispatch_turn', v_id::text, t->>'request_hash',
            left('McCluster dispatch: ' || coalesce(t->>'tool', '') || ' (' || coalesce(t->>'capability', '') || ') from your message: '
                 || left(coalesce(t->>'message', ''), 300), 1000),
            'pending', p_actor, now() + interval '24 hours')
    returning id into v_approval;
  end if;

  insert into ai_context.dispatch_turns (id, org_id, operation_key, actor_user_id, thread_id, message, intent, route, capability, tool,
                                         args, request_hash, classifier, reply, status, approval_id, decision_id)
  values (v_id, p_org, v_key, p_actor, nullif(t->>'thread_id', '')::uuid, t->>'message', t->>'intent', v_route,
          nullif(t->>'capability', ''), nullif(t->>'tool', ''), coalesce(t->'args', '{}'::jsonb), nullif(t->>'request_hash', ''),
          coalesce(t->'classifier', '{}'::jsonb), nullif(left(t->>'reply', 2000), ''), v_status, v_approval, v_decision)
  returning * into v_row;

  return jsonb_build_object('replayed', false, 'turn', ai_context.dispatch_turn_json(v_row));
end;
$$;

-- Attach what happened after recording: the job, the resident turn, the result or the error.
create or replace function public.ops_ai_dispatch_attach(p_org uuid, p_turn uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row ai_context.dispatch_turns;
  v_status text := p_patch->>'status';
begin
  perform ai_context.workstream_require_house(p_org);
  if v_status not in ('queued', 'done', 'failed') then
    raise exception 'status must be queued, done or failed' using errcode = '22023';
  end if;
  update ai_context.dispatch_turns d
     set status = v_status,
         job_id = coalesce(nullif(p_patch->>'job_id', '')::uuid, d.job_id),
         resident_turn_id = coalesce(nullif(p_patch->>'resident_turn_id', '')::uuid, d.resident_turn_id),
         result = coalesce(p_patch->'result', d.result),
         error = coalesce(left(p_patch->>'error', 2000), d.error),
         updated_at = now()
   where d.org_id = p_org and d.id = p_turn and d.status in ('routed', 'answered', 'executing')
  returning * into v_row;
  if v_row.id is null then
    raise exception 'dispatch turn not found or already settled' using errcode = 'P0002';
  end if;
  return ai_context.dispatch_turn_json(v_row);
end;
$$;

-- Claim a held turn for execution, once, only on an approved, unexpired approval with the same request hash.
create or replace function public.ops_ai_dispatch_claim(p_org uuid, p_actor uuid, p_turn uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row ai_context.dispatch_turns;
  v_approval public.control_approvals;
begin
  perform ai_context.dispatch_require_owner(p_org, p_actor);
  select * into v_row from ai_context.dispatch_turns d where d.org_id = p_org and d.id = p_turn for update;
  if not found then
    raise exception 'dispatch turn not found' using errcode = 'P0002';
  end if;
  if v_row.route <> 'approval' or v_row.status <> 'pending_approval' then
    return jsonb_build_object('claimed', false, 'state', v_row.status, 'turn', ai_context.dispatch_turn_json(v_row));
  end if;
  select * into v_approval from public.control_approvals a where a.id = v_row.approval_id and a.org_id = p_org;
  if not found then
    raise exception 'dispatch approval is missing' using errcode = 'P0002';
  end if;
  if v_approval.state = 'denied' or v_approval.state = 'expired' or (v_approval.state = 'pending' and v_approval.expires_at <= now()) then
    update ai_context.dispatch_turns d
       set status = case when v_approval.state = 'denied' then 'denied' else 'expired' end, updated_at = now()
     where d.id = v_row.id returning * into v_row;
    update ai_context.decisions x set status = 'rejected', updated_at = now()
     where x.id = v_row.decision_id and x.org_id = p_org and x.status = 'proposed';
    return jsonb_build_object('claimed', false, 'state', v_row.status, 'turn', ai_context.dispatch_turn_json(v_row),
                              'approval', jsonb_build_object('id', v_approval.id, 'state', v_approval.state, 'expires_at', v_approval.expires_at));
  end if;
  if v_approval.state <> 'approved' or v_approval.expires_at <= now() then
    return jsonb_build_object('claimed', false, 'state', 'pending_approval', 'turn', ai_context.dispatch_turn_json(v_row),
                              'approval', jsonb_build_object('id', v_approval.id, 'state', v_approval.state, 'expires_at', v_approval.expires_at));
  end if;
  if v_approval.request_hash is distinct from v_row.request_hash or v_approval.resource_id <> v_row.id::text
     or v_approval.capability <> 'dispatch.execute' then
    raise exception 'the approval does not cover this exact request; nothing ran' using errcode = '42501';
  end if;
  update ai_context.dispatch_turns d set status = 'executing', updated_at = now() where d.id = v_row.id returning * into v_row;
  update ai_context.decisions x
     set status = 'approved', approved_by = v_approval.decided_by, approved_at = coalesce(v_approval.decided_at, now()), updated_at = now()
   where x.id = v_row.decision_id and x.org_id = p_org and x.status = 'proposed';
  return jsonb_build_object('claimed', true, 'state', 'executing', 'turn', ai_context.dispatch_turn_json(v_row),
                            'approval', jsonb_build_object('id', v_approval.id, 'state', v_approval.state, 'decided_by', v_approval.decided_by));
end;
$$;

-- Read one turn with its live job and approval: how results flow back to the conversation.
create or replace function public.ops_ai_dispatch_get(p_org uuid, p_turn uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_row ai_context.dispatch_turns;
  v_job jsonb;
  v_approval jsonb;
begin
  perform ai_context.workstream_require_house(p_org);
  select * into v_row from ai_context.dispatch_turns d where d.org_id = p_org and d.id = p_turn;
  if not found then
    return jsonb_build_object('turn', null);
  end if;
  if v_row.job_id is not null then
    select jsonb_build_object('id', j.id, 'job_type', j.job_type, 'status', j.status, 'attempts', j.attempts,
                              'last_error', j.last_error, 'output', j.output, 'updated_at', j.updated_at)
      into v_job from public.ops_agent_jobs j where j.id = v_row.job_id and j.org_id = p_org;
  end if;
  if v_row.approval_id is not null then
    select jsonb_build_object('id', a.id, 'state', a.state, 'expires_at', a.expires_at, 'decided_at', a.decided_at)
      into v_approval from public.control_approvals a where a.id = v_row.approval_id and a.org_id = p_org;
  end if;
  return jsonb_build_object('turn', ai_context.dispatch_turn_json(v_row), 'job', v_job, 'approval', v_approval);
end;
$$;

revoke all on function ai_context.dispatch_require_owner(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function ai_context.dispatch_turn_json(ai_context.dispatch_turns) from public, anon, authenticated, service_role;
revoke all on function public.ops_ai_dispatch_record(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ops_ai_dispatch_attach(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ops_ai_dispatch_claim(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.ops_ai_dispatch_get(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ops_ai_dispatch_record(uuid, uuid, jsonb) to service_role;
grant execute on function public.ops_ai_dispatch_attach(uuid, uuid, jsonb) to service_role;
grant execute on function public.ops_ai_dispatch_claim(uuid, uuid, uuid) to service_role;
grant execute on function public.ops_ai_dispatch_get(uuid, uuid) to service_role;

comment on table ai_context.dispatch_turns is 'Private. One row per owner message routed by the McCluster dispatch layer, recorded before anything runs. Written only through public.ops_ai_dispatch_* by service_role. docs/control-plane/DISPATCH-LAYER.md';

commit;
