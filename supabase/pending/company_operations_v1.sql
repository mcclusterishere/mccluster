-- REVIEW CANDIDATE ONLY. Do not apply to production or add to the ledger.
-- Canonical Supabase storage for portable company-operation RECORDS. No money,
-- ownership-transfer, payment, public publication or external execution API.
-- Only the trusted validated Worker writes commands; this RPC is not a legal or
-- accounting validator. No client or service-role direct table mutation allowed.
begin;
create table public.company_operation_events (
  org_id uuid not null references public.orgs(id),
  company_id uuid not null,
  revision integer not null check (revision between 1 and 2000),
  command_id text not null check(command_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$'),
  actor_id uuid not null,
  event jsonb not null check(jsonb_typeof(event) = 'object' and octet_length(event::text) <= 131072),
  recorded_at timestamptz not null default now(),
  primary key(org_id,company_id,revision),
  unique(org_id,company_id,command_id)
);
alter table public.company_operation_events enable row level security;
alter table public.company_operation_events force row level security;
revoke all on public.company_operation_events from public, anon, authenticated, service_role;
create function public.company_operations_immutable_v1() returns trigger
language plpgsql set search_path='' as $$ begin
  raise exception 'Company operation records are immutable' using errcode='55000';
end $$;
create trigger company_operations_immutable before update or delete on public.company_operation_events
for each row execute function public.company_operations_immutable_v1();

create function public.company_operations_owner_v1(p_org uuid,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
  -- Locks membership and enabled org through commit: revocation cannot race a
  -- successful authorized write. No broad admin or client-provided role grants.
  perform 1 from public.org_members m join public.orgs o on o.id=m.org_id
  where m.org_id=p_org and m.profile_id=p_actor and m.role='owner' and o.enabled
  for share of m,o;
  if not found then raise exception 'Owner required' using errcode='42501'; end if;
end $$;
create function public.company_operations_read_v1(p_org uuid,p_actor uuid,p_company uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare result jsonb; begin
  perform public.company_operations_owner_v1(p_org,p_actor);
  if p_company is null then raise exception 'Company required' using errcode='23514'; end if;
  select coalesce(jsonb_agg(event order by revision),'[]'::jsonb) into result
    from public.company_operation_events where org_id=p_org and company_id=p_company;
  return result;
end $$;
create function public.company_operations_append_v1(p_org uuid,p_actor uuid,p_company uuid,p_expected integer,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.company_operation_events; old public.company_operation_events; current_revision integer;
begin
  perform public.company_operations_owner_v1(p_org,p_actor);
  if p_company is null or p_expected is null or p_expected < 0 or p_expected >= 2000 or p_event is null
     or jsonb_typeof(p_event) <> 'object' then raise exception 'Invalid envelope' using errcode='23514'; end if;
  if p_event->>'orgId' is distinct from p_org::text or p_event->>'companyId' is distinct from p_company::text
     or p_event->>'actorId' is distinct from p_actor::text or (p_event->>'revision')::integer is distinct from p_expected+1
     or coalesce(p_event->>'hash','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_event->'command'->>'id','') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$'
     or jsonb_typeof(p_event->'human') is distinct from 'boolean'
     or jsonb_typeof(p_event->'command') is distinct from 'object'
     or octet_length(p_event::text)>131072 then raise exception 'Invalid envelope' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_company::text,0));
  select * into old from public.company_operation_events
    where org_id=p_org and company_id=p_company and command_id=p_event->'command'->>'id';
  if found then
    if old.actor_id <> p_actor or old.event->'command' is distinct from p_event->'command'
      then raise exception 'Idempotency conflict' using errcode='23505'; end if;
    return old.event;
  end if;
  select * into previous from public.company_operation_events
    where org_id=p_org and company_id=p_company order by revision desc limit 1;
  current_revision:=coalesce(previous.revision,0);
  if current_revision <> p_expected then raise exception 'Revision conflict' using errcode='23505'; end if;
  if p_event->>'previousHash' is distinct from previous.event->>'hash'
    then raise exception 'History chain mismatch' using errcode='23514'; end if;
  insert into public.company_operation_events(org_id,company_id,revision,command_id,actor_id,event)
    values(p_org,p_company,p_expected+1,p_event->'command'->>'id',p_actor,p_event);
  return p_event;
end $$;
revoke all on function public.company_operations_immutable_v1() from public,anon,authenticated,service_role;
revoke all on function public.company_operations_owner_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.company_operations_read_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.company_operations_append_v1(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.company_operations_read_v1(uuid,uuid,uuid) to service_role;
grant execute on function public.company_operations_append_v1(uuid,uuid,uuid,integer,jsonb) to service_role;
commit;
