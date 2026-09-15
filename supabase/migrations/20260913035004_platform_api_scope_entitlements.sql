create table if not exists public.api_scopes (
  scope_key text primary key,
  description text not null,
  risk_level text not null default 'standard' check (risk_level in ('standard','sensitive','privileged','internal')),
  developer_mintable boolean not null default true,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.api_plan_scopes (
  plan_code text not null references public.api_plans(plan_code) on delete cascade,
  scope_key text not null references public.api_scopes(scope_key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(plan_code, scope_key)
);

alter table public.api_scopes enable row level security;
alter table public.api_plan_scopes enable row level security;

grant select on public.api_scopes to anon, authenticated;
grant select on public.api_plan_scopes to anon, authenticated;

insert into public.api_scopes(scope_key,description,risk_level,developer_mintable) values
 ('mnet:read','Read public Mnet data exposed by the developer API','standard',true),
 ('mnet:write','Write Mnet data through explicitly enabled service endpoints','sensitive',false),
 ('compute:read','Inspect compute catalog, balances, estimates, and request status','standard',true),
 ('compute:write','Execute metered compute workloads','sensitive',true),
 ('platform:catalog','Read public platform/API catalogs','standard',true),
 ('platform:apps','Read enabled platform application metadata','standard',true),
 ('platform:identity','Use explicitly exposed identity lookup/link APIs','sensitive',false),
 ('platform:fees','Use fee/quote APIs','standard',true),
 ('ai:invoke','Invoke approved AI gateway operations','sensitive',true),
 ('media:generate','Invoke approved media generation operations','sensitive',true),
 ('social:publish','Publish to connected external social channels','privileged',false),
 ('seekfirst:read','Read explicitly exposed Seek First data APIs','standard',true),
 ('whip:read','Read explicitly exposed Whip platform APIs','standard',true),
 ('whip:write','Mutate explicitly exposed Whip platform APIs','privileged',false),
 ('admin:*','Administrative platform authority; never developer-mintable','internal',false),
 ('compute:*','Wildcard compute authority; never developer-mintable','internal',false),
 ('mnet:*','Wildcard Mnet authority; never developer-mintable','internal',false),
 ('*','Global wildcard authority; never developer-mintable','internal',false)
on conflict(scope_key) do update set description=excluded.description,risk_level=excluded.risk_level,developer_mintable=excluded.developer_mintable,enabled=true,updated_at=now();

insert into public.api_plan_scopes(plan_code,scope_key)
select p.plan_code,s.scope_key
from public.api_plans p
join public.api_scopes s on s.scope_key = any(array['mnet:read','compute:read','compute:write','platform:catalog','platform:apps','platform:fees','ai:invoke','media:generate','seekfirst:read','whip:read']::text[])
where p.plan_code in ('developer','builder','growth','scale') and s.developer_mintable=true
on conflict do nothing;

create or replace function public.api_enforce_key_scopes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan text;
  v_scope text;
begin
  if new.scopes is null or cardinality(new.scopes)=0 then
    raise exception 'at least one API scope is required';
  end if;

  select plan_code into v_plan from public.api_consumers where id=new.consumer_id;
  if v_plan is null then raise exception 'API consumer plan unavailable'; end if;

  foreach v_scope in array new.scopes loop
    if v_scope is null or btrim(v_scope)='' then raise exception 'invalid API scope'; end if;
    if v_scope in ('*','compute:*','mnet:*','admin:*') then raise exception 'wildcard or administrative scopes cannot be developer-minted'; end if;
    if not exists(
      select 1 from public.api_scopes s
      join public.api_plan_scopes ps on ps.scope_key=s.scope_key
      where ps.plan_code=v_plan and s.scope_key=v_scope and s.enabled=true and s.developer_mintable=true
    ) then
      raise exception 'scope % is not permitted for plan %', v_scope, v_plan;
    end if;
  end loop;
  return new;
end;
$function$;

revoke execute on function public.api_enforce_key_scopes() from public, anon, authenticated;

drop trigger if exists api_keys_scope_entitlement_guard on public.api_keys;
create trigger api_keys_scope_entitlement_guard
before insert or update of scopes,consumer_id on public.api_keys
for each row execute function public.api_enforce_key_scopes();
