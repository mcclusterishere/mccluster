-- ============================================================
-- CONTROL AUTHORITY V2 — recovered operational RPC layer
--
-- Production migration 20260906181758 (control_plane_authority_v2) is in the
-- live ledger but absent from Git. The Equity Uprise Edge Functions rely on
-- control_authorize_service() and the command/approval/lease RPCs, so schema
-- tables alone are not enough to reproduce the production control plane.
--
-- Function bodies and execute grants below are reconstructed from the live
-- project. Service RPCs are service_role-only; the two human approval/read
-- RPCs remain authenticated + service_role, matching production.
-- ============================================================

create or replace function public.control_authorize(
  p_user uuid,
  p_org uuid,
  p_capability text
)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with membership as (
    select role
    from public.org_members
    where org_id = p_org and profile_id = p_user
    limit 1
  )
  select coalesce((
    select case
      when role = 'owner' then true
      when role = 'staff' then p_capability = any(array[
        'campaign.read','campaign.draft','campaign.build','campaign.pause',
        'social.read','social.queue',
        'prospect.write','suppression.write','inquiry.read'
      ]::text[])
      when role = 'viewer' then p_capability = any(array[
        'campaign.read','social.read','inquiry.read'
      ]::text[])
      else false
    end
    from membership
  ), false);
$function$;

create or replace function public.control_authorize_service(
  p_actor uuid,
  p_org uuid,
  p_capability text,
  p_resource_type text default null,
  p_resource_id text default null,
  p_request_hash text default null,
  p_approval_id uuid default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text;
  v_risk text;
  v_allowed boolean := false;
  v_approver uuid;
begin
  select om.role into v_role
  from public.org_members om
  where om.org_id = p_org and om.profile_id = p_actor
  limit 1;

  if v_role is null then
    return jsonb_build_object('allowed',false,'reason','not_org_member');
  end if;

  select c.risk, coalesce(rc.allowed,false)
    into v_risk, v_allowed
  from public.control_capabilities c
  left join public.control_role_capabilities rc
    on rc.capability = c.capability and rc.role = v_role
  where c.capability = p_capability;

  if not coalesce(v_allowed,false) then
    return jsonb_build_object(
      'allowed',false,'reason','capability_denied',
      'role',v_role,'capability',p_capability
    );
  end if;

  if v_risk = 'high' then
    if p_approval_id is null or p_request_hash is null
       or p_resource_type is null or p_resource_id is null then
      return jsonb_build_object(
        'allowed',false,'reason','approval_required',
        'role',v_role,'risk',v_risk
      );
    end if;

    select a.decided_by into v_approver
    from public.control_approvals a
    where a.id = p_approval_id
      and a.org_id = p_org
      and a.capability = p_capability
      and a.resource_type = p_resource_type
      and a.resource_id = p_resource_id
      and a.request_hash = p_request_hash
      and a.state = 'approved'
      and a.expires_at > now()
    limit 1;

    if v_approver is null then
      return jsonb_build_object(
        'allowed',false,'reason','approval_invalid',
        'role',v_role,'risk',v_risk
      );
    end if;
  end if;

  return jsonb_build_object(
    'allowed',true,'role',v_role,'risk',v_risk,
    'capability',p_capability,'approved_by',v_approver
  );
end
$function$;

create or replace function public.control_record_command_service(
  p_org uuid,
  p_actor uuid,
  p_actor_kind text,
  p_capability text,
  p_resource_type text,
  p_resource_id text,
  p_action text,
  p_request_hash text default null,
  p_idempotency_key text default null,
  p_approval_id uuid default null,
  p_status text default 'allowed',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  insert into public.control_commands(
    org_id,actor_user_id,actor_kind,capability,resource_type,resource_id,
    action,request_hash,idempotency_key,approval_id,status,metadata
  ) values (
    p_org,p_actor,coalesce(p_actor_kind,'system'),p_capability,
    p_resource_type,p_resource_id,p_action,p_request_hash,p_idempotency_key,
    p_approval_id,p_status,coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict(org_id,idempotency_key)
    where idempotency_key is not null
  do update set metadata = public.control_commands.metadata || excluded.metadata
  returning id into v_id;
  return v_id;
end
$function$;

create or replace function public.control_finish_command_service(
  p_command uuid,
  p_status text,
  p_result jsonb default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_status not in ('executed','failed','denied') then
    raise exception 'invalid terminal status';
  end if;
  update public.control_commands
     set status=p_status, result=p_result, error=p_error, finished_at=now()
   where id=p_command;
end
$function$;

create or replace function public.control_acquire_lease_service(
  p_org uuid,
  p_resource_key text,
  p_actor uuid,
  p_actor_kind text,
  p_purpose text,
  p_ttl_seconds integer default 120
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid := gen_random_uuid();
  v_existing public.control_leases;
begin
  select * into v_existing
  from public.control_leases
  where org_id=p_org and resource_key=p_resource_key
  for update;

  if v_existing.org_id is not null and v_existing.expires_at > now() then
    raise exception 'resource is leased until %', v_existing.expires_at;
  end if;

  insert into public.control_leases(
    org_id,resource_key,lease_id,actor_user_id,actor_kind,purpose,expires_at
  ) values (
    p_org,p_resource_key,v_id,p_actor,coalesce(p_actor_kind,'system'),p_purpose,
    now()+make_interval(secs=>greatest(15,least(coalesce(p_ttl_seconds,120),900)))
  )
  on conflict(org_id,resource_key) do update set
    lease_id=excluded.lease_id,
    actor_user_id=excluded.actor_user_id,
    actor_kind=excluded.actor_kind,
    purpose=excluded.purpose,
    acquired_at=now(),
    expires_at=excluded.expires_at;

  return v_id;
end
$function$;

create or replace function public.control_release_lease_service(
  p_org uuid,
  p_resource_key text,
  p_lease uuid
)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  delete from public.control_leases
  where org_id=p_org and resource_key=p_resource_key and lease_id=p_lease
$function$;

create or replace function public.control_request_approval(
  p_org uuid,
  p_capability text,
  p_resource_type text,
  p_resource_id text,
  p_request_hash text,
  p_reason text default null,
  p_ttl_seconds integer default 1800
)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_risk text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not private.is_org_member(p_org) then raise exception 'not a member of this organisation'; end if;

  select risk into v_risk
  from public.control_capabilities
  where capability=p_capability;
  if v_risk is null then raise exception 'unknown capability'; end if;
  if p_request_hash is null or length(trim(p_request_hash)) < 16 then
    raise exception 'request hash required';
  end if;

  insert into public.control_approvals(
    org_id,capability,resource_type,resource_id,request_hash,reason,
    requested_by,expires_at
  ) values (
    p_org,p_capability,p_resource_type,p_resource_id,p_request_hash,p_reason,
    auth.uid(),
    now()+make_interval(secs=>greatest(60,least(coalesce(p_ttl_seconds,1800),3600)))
  ) returning id into v_id;
  return v_id;
end
$function$;

create or replace function public.control_decide_approval(
  p_approval_id uuid,
  p_state text
)
returns public.control_approvals
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare v_row public.control_approvals;
begin
  if p_state not in ('approved','denied') then
    raise exception 'state must be approved or denied';
  end if;

  select * into v_row
  from public.control_approvals
  where id=p_approval_id
  for update;
  if v_row.id is null then raise exception 'approval not found'; end if;
  if not private.is_org_owner(v_row.org_id) then raise exception 'owner permission required'; end if;
  if v_row.state <> 'pending' then raise exception 'approval is not pending'; end if;
  if v_row.expires_at <= now() then
    update public.control_approvals set state='expired' where id=p_approval_id;
    raise exception 'approval expired';
  end if;

  update public.control_approvals
     set state=p_state, decided_by=auth.uid(), decided_at=now()
   where id=p_approval_id
  returning * into v_row;
  return v_row;
end
$function$;

create or replace function public.control_my_capabilities(p_org uuid)
returns table(capability text, risk text)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select c.capability,c.risk
  from public.org_members om
  join public.control_role_capabilities rc on rc.role=om.role and rc.allowed
  join public.control_capabilities c on c.capability=rc.capability
  where om.org_id=p_org and om.profile_id=auth.uid()
  order by c.capability
$function$;

create or replace function public.control_log(
  p_user uuid,
  p_org uuid,
  p_capability text,
  p_resource_type text default null,
  p_resource_id text default null,
  p_status text default 'executed',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  insert into public.control_commands(
    org_id,actor_user_id,capability,resource_type,resource_id,status,metadata
  ) values (
    p_org,p_user,p_capability,p_resource_type,p_resource_id,p_status,
    coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end
$function$;

-- Service-only surface.
revoke execute on function public.control_authorize(uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.control_authorize_service(uuid,uuid,text,text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.control_record_command_service(uuid,uuid,text,text,text,text,text,text,text,uuid,text,jsonb) from public, anon, authenticated;
revoke execute on function public.control_finish_command_service(uuid,text,jsonb,text) from public, anon, authenticated;
revoke execute on function public.control_acquire_lease_service(uuid,text,uuid,text,text,integer) from public, anon, authenticated;
revoke execute on function public.control_release_lease_service(uuid,text,uuid) from public, anon, authenticated;
revoke execute on function public.control_log(uuid,uuid,text,text,text,text,jsonb) from public, anon, authenticated;

grant execute on function public.control_authorize(uuid,uuid,text) to service_role;
grant execute on function public.control_authorize_service(uuid,uuid,text,text,text,text,uuid) to service_role;
grant execute on function public.control_record_command_service(uuid,uuid,text,text,text,text,text,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.control_finish_command_service(uuid,text,jsonb,text) to service_role;
grant execute on function public.control_acquire_lease_service(uuid,text,uuid,text,text,integer) to service_role;
grant execute on function public.control_release_lease_service(uuid,text,uuid) to service_role;
grant execute on function public.control_log(uuid,uuid,text,text,text,text,jsonb) to service_role;

-- Human approval/read surface.
revoke execute on function public.control_request_approval(uuid,text,text,text,text,text,integer) from public, anon;
revoke execute on function public.control_decide_approval(uuid,text) from public, anon;
revoke execute on function public.control_my_capabilities(uuid) from public, anon;
grant execute on function public.control_request_approval(uuid,text,text,text,text,text,integer) to authenticated, service_role;
grant execute on function public.control_decide_approval(uuid,text) to authenticated, service_role;
grant execute on function public.control_my_capabilities(uuid) to authenticated, service_role;

-- Required by EU service authorization.
do $$
begin
  if to_regprocedure('public.control_authorize_service(uuid,uuid,text,text,text,text,uuid)') is null then
    raise exception 'control authority v2 recovery incomplete';
  end if;
end $$;
