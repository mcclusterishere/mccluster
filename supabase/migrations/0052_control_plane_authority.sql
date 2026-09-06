-- Canonical McCluster control-plane authority boundary.
--
-- This migration turns authentication into explicit authorization. Edge functions and
-- other privileged adapters must ask control_authorize_service() before using the
-- service role for an organisation-scoped action. High-risk capabilities additionally
-- require a server-validated approval receipt whose request hash matches the action.

create table if not exists public.control_capabilities (
  capability text primary key,
  description text not null,
  risk text not null default 'low' check (risk in ('low','medium','high')),
  created_at timestamptz not null default now()
);

create table if not exists public.control_role_capabilities (
  role text not null,
  capability text not null references public.control_capabilities(capability) on delete cascade,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (role, capability)
);

create table if not exists public.control_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  capability text not null references public.control_capabilities(capability),
  resource_type text not null,
  resource_id text not null,
  request_hash text not null,
  reason text,
  state text not null default 'pending' check (state in ('pending','approved','denied','expired')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 minutes')
);

create index if not exists control_approvals_lookup_idx
  on public.control_approvals(org_id, capability, resource_type, resource_id, state, expires_at);

create table if not exists public.control_commands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'human' check (actor_kind in ('human','agent','automation','cron','ci','system')),
  capability text not null references public.control_capabilities(capability),
  resource_type text not null,
  resource_id text not null,
  action text not null,
  request_hash text,
  idempotency_key text,
  approval_id uuid references public.control_approvals(id) on delete set null,
  status text not null default 'authorized' check (status in ('authorized','running','succeeded','failed','denied')),
  result jsonb,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create unique index if not exists control_commands_idempotency_idx
  on public.control_commands(org_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists control_commands_resource_idx
  on public.control_commands(org_id, resource_type, resource_id, created_at desc);

create table if not exists public.control_leases (
  org_id uuid not null references public.orgs(id) on delete cascade,
  resource_key text not null,
  lease_id uuid not null default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'system',
  purpose text,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (org_id, resource_key)
);

create table if not exists public.control_audit (
  id bigint generated always as identity primary key,
  org_id uuid references public.orgs(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'system',
  event text not null,
  capability text,
  resource_type text,
  resource_id text,
  command_id uuid references public.control_commands(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index if not exists control_audit_org_at_idx on public.control_audit(org_id, at desc);

alter table public.control_capabilities enable row level security;
alter table public.control_role_capabilities enable row level security;
alter table public.control_approvals enable row level security;
alter table public.control_commands enable row level security;
alter table public.control_leases enable row level security;
alter table public.control_audit enable row level security;

-- Capability catalogue. 'high' always requires an approval receipt in the service gate.
insert into public.control_capabilities(capability, description, risk) values
  ('control.read',       'Read control-plane state for an organisation', 'low'),
  ('control.approve',    'Approve a high-risk control-plane command', 'high'),
  ('ops.use',            'Use the organisation operations agent', 'medium'),
  ('campaign.read',      'Read campaign state and delivery statistics', 'low'),
  ('campaign.prepare',   'Build or modify a campaign without sending it', 'medium'),
  ('campaign.pause',     'Pause a campaign', 'medium'),
  ('campaign.send',      'Send an outbound campaign', 'high'),
  ('social.read',        'Read social-channel state and statistics', 'low'),
  ('social.queue',       'Queue social content without publishing it', 'medium'),
  ('social.publish',     'Publish queued social content externally', 'high'),
  ('media.generate',     'Create a media-generation job', 'medium'),
  ('media.spend',        'Execute a media action that spends provider funds', 'high'),
  ('payments.read',      'Read payment and connected-account state', 'low'),
  ('payments.execute',   'Create, capture, transfer, refund, or otherwise move money', 'high'),
  ('deployment.read',    'Read deployment and drift state', 'low'),
  ('deployment.promote', 'Promote code or schema changes into production', 'high')
on conflict (capability) do update set description=excluded.description, risk=excluded.risk;

-- Owners/admins can do everything. Staff can operate reversible/read paths but cannot
-- perform irreversible outward or money-moving actions.
insert into public.control_role_capabilities(role, capability, allowed)
select r.role, c.capability, true
from (values ('owner'),('admin')) as r(role)
cross join public.control_capabilities c
on conflict (role, capability) do update set allowed=true;

insert into public.control_role_capabilities(role, capability, allowed) values
  ('staff','control.read',true),
  ('staff','ops.use',true),
  ('staff','campaign.read',true),
  ('staff','campaign.prepare',true),
  ('staff','campaign.pause',true),
  ('staff','social.read',true),
  ('staff','social.queue',true),
  ('staff','media.generate',true),
  ('staff','payments.read',true),
  ('staff','deployment.read',true),
  ('member','control.read',true),
  ('member','campaign.read',true),
  ('member','social.read',true),
  ('member','payments.read',true),
  ('member','deployment.read',true)
on conflict (role, capability) do update set allowed=excluded.allowed;

-- Make the active McCluster account an owner of the McCluster organisation if that
-- organisation and account already exist. No generated ID is baked into this migration.
insert into public.org_members(org_id, profile_id, role)
select o.id, u.id, 'owner'
from public.orgs o
join auth.users u on lower(u.email)=lower('matthew@mccluster.org')
where o.slug='mccluster'
  and not exists (
    select 1 from public.org_members om where om.org_id=o.id and om.profile_id=u.id
  );

-- Read policies. Service role bypasses RLS for command/audit writes; clients only get
-- organisation-scoped visibility and narrowly constrained approval mutations.
drop policy if exists control_capabilities_read on public.control_capabilities;
create policy control_capabilities_read on public.control_capabilities
  for select to authenticated using (true);

drop policy if exists control_role_capabilities_read on public.control_role_capabilities;
create policy control_role_capabilities_read on public.control_role_capabilities
  for select to authenticated using (true);

drop policy if exists control_approvals_read on public.control_approvals;
create policy control_approvals_read on public.control_approvals
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists control_approvals_request on public.control_approvals;
create policy control_approvals_request on public.control_approvals
  for insert to authenticated
  with check (requested_by = auth.uid() and private.is_org_member(org_id) and state='pending' and decided_by is null);

drop policy if exists control_approvals_decide on public.control_approvals;
create policy control_approvals_decide on public.control_approvals
  for update to authenticated
  using (private.is_org_owner(org_id))
  with check (private.is_org_owner(org_id) and decided_by=auth.uid() and state in ('approved','denied'));

drop policy if exists control_commands_read on public.control_commands;
create policy control_commands_read on public.control_commands
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists control_leases_read on public.control_leases;
create policy control_leases_read on public.control_leases
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists control_audit_read on public.control_audit;
create policy control_audit_read on public.control_audit
  for select to authenticated using (private.is_org_member(org_id));

-- Deliberately do not expose direct client writes to commands, leases, or audit.
revoke all on public.control_commands from anon, authenticated;
revoke insert, update, delete on public.control_leases from anon, authenticated;
revoke insert, update, delete on public.control_audit from anon, authenticated;
grant select on public.control_commands, public.control_leases, public.control_audit to authenticated;
grant select on public.control_capabilities, public.control_role_capabilities, public.control_approvals to authenticated;
grant insert, update on public.control_approvals to authenticated;

-- Client helper: enumerate the capabilities the current user has in one org.
create or replace function public.control_my_capabilities(p_org uuid)
returns table(capability text, risk text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.capability, c.risk
  from public.org_members om
  join public.control_role_capabilities rc on rc.role=om.role and rc.allowed
  join public.control_capabilities c on c.capability=rc.capability
  where om.org_id=p_org and om.profile_id=auth.uid()
  order by c.capability;
$$;
revoke all on function public.control_my_capabilities(uuid) from public, anon;
grant execute on function public.control_my_capabilities(uuid) to authenticated;

-- Client helper: request an approval for an exact command hash.
create or replace function public.control_request_approval(
  p_org uuid,
  p_capability text,
  p_resource_type text,
  p_resource_id text,
  p_request_hash text,
  p_reason text default null,
  p_ttl_seconds integer default 1800
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_risk text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not private.is_org_member(p_org) then raise exception 'not a member of this organisation'; end if;
  select risk into v_risk from public.control_capabilities where capability=p_capability;
  if v_risk is null then raise exception 'unknown capability'; end if;
  if p_request_hash is null or length(trim(p_request_hash)) < 16 then raise exception 'request hash required'; end if;

  insert into public.control_approvals(
    org_id, capability, resource_type, resource_id, request_hash, reason,
    requested_by, expires_at
  ) values (
    p_org, p_capability, p_resource_type, p_resource_id, p_request_hash, p_reason,
    auth.uid(), now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds,1800),3600)))
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.control_request_approval(uuid,text,text,text,text,text,integer) from public, anon;
grant execute on function public.control_request_approval(uuid,text,text,text,text,text,integer) to authenticated;

-- Client helper: only an org owner can approve/deny. The approver identity is derived
-- from auth.uid(); the caller cannot submit an approved_by value.
create or replace function public.control_decide_approval(p_approval_id uuid, p_state text)
returns public.control_approvals
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.control_approvals;
begin
  if p_state not in ('approved','denied') then raise exception 'state must be approved or denied'; end if;
  select * into v_row from public.control_approvals where id=p_approval_id for update;
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
end;
$$;
revoke all on function public.control_decide_approval(uuid,text) from public, anon;
grant execute on function public.control_decide_approval(uuid,text) to authenticated;

-- Service-only authority gate. Privileged adapters must call this before switching to
-- the service role. High-risk capabilities require an exact, approved, unexpired receipt.
create or replace function public.control_authorize_service(
  p_actor uuid,
  p_org uuid,
  p_capability text,
  p_resource_type text default null,
  p_resource_id text default null,
  p_request_hash text default null,
  p_approval_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_risk text;
  v_allowed boolean := false;
  v_approver uuid;
begin
  select om.role into v_role
  from public.org_members om
  where om.org_id=p_org and om.profile_id=p_actor
  limit 1;

  if v_role is null then
    return jsonb_build_object('allowed',false,'reason','not_org_member');
  end if;

  select c.risk, coalesce(rc.allowed,false)
    into v_risk, v_allowed
  from public.control_capabilities c
  left join public.control_role_capabilities rc
    on rc.capability=c.capability and rc.role=v_role
  where c.capability=p_capability;

  if not coalesce(v_allowed,false) then
    return jsonb_build_object('allowed',false,'reason','capability_denied','role',v_role,'capability',p_capability);
  end if;

  if v_risk='high' then
    if p_approval_id is null or p_request_hash is null or p_resource_type is null or p_resource_id is null then
      return jsonb_build_object('allowed',false,'reason','approval_required','role',v_role,'risk',v_risk);
    end if;
    select a.decided_by into v_approver
    from public.control_approvals a
    where a.id=p_approval_id
      and a.org_id=p_org
      and a.capability=p_capability
      and a.resource_type=p_resource_type
      and a.resource_id=p_resource_id
      and a.request_hash=p_request_hash
      and a.state='approved'
      and a.expires_at>now()
    limit 1;
    if v_approver is null then
      return jsonb_build_object('allowed',false,'reason','approval_invalid','role',v_role,'risk',v_risk);
    end if;
  end if;

  return jsonb_build_object(
    'allowed',true,'role',v_role,'risk',v_risk,'capability',p_capability,
    'approved_by',v_approver
  );
end;
$$;
revoke all on function public.control_authorize_service(uuid,uuid,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.control_authorize_service(uuid,uuid,text,text,text,text,uuid) to service_role;

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
  p_status text default 'authorized',
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  insert into public.control_commands(
    org_id, actor_user_id, actor_kind, capability, resource_type, resource_id,
    action, request_hash, idempotency_key, approval_id, status, metadata
  ) values (
    p_org, p_actor, coalesce(p_actor_kind,'system'), p_capability, p_resource_type, p_resource_id,
    p_action, p_request_hash, p_idempotency_key, p_approval_id, p_status, coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict (org_id,idempotency_key) where idempotency_key is not null
  do update set metadata=public.control_commands.metadata || excluded.metadata
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.control_record_command_service(uuid,uuid,text,text,text,text,text,text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.control_record_command_service(uuid,uuid,text,text,text,text,text,text,text,uuid,text,jsonb) to service_role;

create or replace function public.control_finish_command_service(
  p_command uuid,
  p_status text,
  p_result jsonb default null,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('succeeded','failed','denied') then raise exception 'invalid terminal status'; end if;
  update public.control_commands
     set status=p_status, result=p_result, error=p_error, finished_at=now()
   where id=p_command;
end;
$$;
revoke all on function public.control_finish_command_service(uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.control_finish_command_service(uuid,text,jsonb,text) to service_role;

-- Concurrency lease. A resource can have one active writer; expired leases can be replaced.
create or replace function public.control_acquire_lease_service(
  p_org uuid,
  p_resource_key text,
  p_actor uuid,
  p_actor_kind text,
  p_purpose text,
  p_ttl_seconds integer default 120
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_existing public.control_leases;
begin
  select * into v_existing
  from public.control_leases
  where org_id=p_org and resource_key=p_resource_key
  for update;

  if v_existing.org_id is not null and v_existing.expires_at>now() then
    raise exception 'resource is leased until %', v_existing.expires_at;
  end if;

  insert into public.control_leases(org_id,resource_key,lease_id,actor_user_id,actor_kind,purpose,expires_at)
  values (p_org,p_resource_key,v_id,p_actor,coalesce(p_actor_kind,'system'),p_purpose,
          now()+make_interval(secs=>greatest(15,least(coalesce(p_ttl_seconds,120),900))))
  on conflict (org_id,resource_key) do update set
    lease_id=excluded.lease_id,
    actor_user_id=excluded.actor_user_id,
    actor_kind=excluded.actor_kind,
    purpose=excluded.purpose,
    acquired_at=now(),
    expires_at=excluded.expires_at;
  return v_id;
end;
$$;
revoke all on function public.control_acquire_lease_service(uuid,text,uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.control_acquire_lease_service(uuid,text,uuid,text,text,integer) to service_role;

create or replace function public.control_release_lease_service(p_org uuid,p_resource_key text,p_lease uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.control_leases where org_id=p_org and resource_key=p_resource_key and lease_id=p_lease;
$$;
revoke all on function public.control_release_lease_service(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.control_release_lease_service(uuid,text,uuid) to service_role;
