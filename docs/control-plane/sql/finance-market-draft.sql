-- REVIEW ONLY: do not apply to production. Independent from synthetic-v1 records.
begin;
create table public.finance_market_accounts (
 org_id uuid not null references public.orgs(id), owner_id uuid not null,
 revision integer not null default 0 check(revision>=0),
 events jsonb not null default '[]'::jsonb check(jsonb_typeof(events)='array' and jsonb_array_length(events)<=500),
 updated_at timestamptz not null default now(), primary key(org_id,owner_id)
);
alter table public.finance_market_accounts enable row level security;
revoke all on public.finance_market_accounts from public,anon,authenticated;
grant select,insert,update on public.finance_market_accounts to service_role;
create function public.finance_account_read(p_owner uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare house uuid; result jsonb;
begin
 select o.id into house from public.orgs o join public.org_members m on m.org_id=o.id
 where o.slug='mccluster' and o.enabled and m.profile_id=p_owner and m.role='owner' limit 1;
 if house is null then raise exception 'Owner required' using errcode='42501'; end if;
 select jsonb_build_object('revision',revision,'events',events) into result from public.finance_market_accounts where org_id=house and owner_id=p_owner;
 return coalesce(result,jsonb_build_object('revision',0,'events','[]'::jsonb));
end $$;
create function public.finance_account_append(p_owner uuid,p_expected integer,p_event jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare house uuid; row public.finance_market_accounts;
begin
 select o.id into house from public.orgs o join public.org_members m on m.org_id=o.id
 where o.slug='mccluster' and o.enabled and m.profile_id=p_owner and m.role='owner' limit 1;
 if house is null then raise exception 'Owner required' using errcode='42501'; end if;
 if p_expected is null or p_expected<0 or p_event is null or jsonb_typeof(p_event)<>'object' or
 jsonb_typeof(p_event->'action') is distinct from 'object' or length(p_event::text)>16384 or
 coalesce(p_event->'action'->>'id','') !~ '^[A-Za-z0-9-]{1,64}$' then raise exception 'Invalid event' using errcode='23514'; end if;
 insert into public.finance_market_accounts(org_id,owner_id) values(house,p_owner) on conflict do nothing;
 select * into row from public.finance_market_accounts where org_id=house and owner_id=p_owner for update;
 if row.revision<>p_expected then raise exception 'Reload account' using errcode='23505'; end if;
 if jsonb_array_length(row.events)>=500 or exists(select 1 from jsonb_array_elements(row.events) e where e->'action'->>'id'=p_event->'action'->>'id') then raise exception 'Capacity or duplicate event' using errcode='23514'; end if;
 update public.finance_market_accounts set events=events||jsonb_build_array(p_event),revision=revision+1,updated_at=now() where org_id=house and owner_id=p_owner;
 return jsonb_build_object('revision',row.revision+1,'events',row.events||jsonb_build_array(p_event));
end $$;
revoke all on function public.finance_account_read(uuid) from public,anon,authenticated;
revoke all on function public.finance_account_append(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.finance_account_read(uuid) to service_role;
grant execute on function public.finance_account_append(uuid,integer,jsonb) to service_role;
-- One bounded counter per credential fingerprint. No credentials stored here.
create table public.finance_provider_budget(account text primary key check(account ~ '^[a-f0-9]{64}$'),bucket timestamptz not null,used integer not null check(used between 0 and 180));
alter table public.finance_provider_budget enable row level security;
revoke all on public.finance_provider_budget from public,anon,authenticated;
grant select,insert,update on public.finance_provider_budget to service_role;
create function public.finance_quote_budget(p_account text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare minute timestamptz:=date_trunc('minute',clock_timestamp()); value integer;
begin
 insert into public.finance_provider_budget(account,bucket,used) values(p_account,minute,1)
 on conflict(account) do update set bucket=excluded.bucket,
 used=case when finance_provider_budget.bucket<excluded.bucket then 1 else finance_provider_budget.used+1 end
 where finance_provider_budget.bucket<excluded.bucket or finance_provider_budget.used<180
 returning used into value;
 return value is not null;
end $$;
revoke all on function public.finance_quote_budget(text) from public,anon,authenticated;
grant execute on function public.finance_quote_budget(text) to service_role;
commit;
