-- REVIEW DRAFT, not an applied production migration. Synthetic portfolios only.
begin;
create table public.finance_paper_portfolios (
  org_id uuid not null references public.orgs(id),
  owner_id uuid not null,
  revision integer not null default 0 check (revision >= 0),
  commands jsonb not null default '[]'::jsonb check (jsonb_typeof(commands) = 'array' and jsonb_array_length(commands) <= 100),
  mode text not null default 'synthetic-v1' check (mode = 'synthetic-v1'),
  updated_at timestamptz not null default now(),
  primary key(org_id, owner_id)
);
alter table public.finance_paper_portfolios enable row level security;
revoke all on public.finance_paper_portfolios from public, anon, authenticated;
grant select, insert, update on public.finance_paper_portfolios to service_role;

create function public.finance_paper_read(p_owner uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare house uuid; result jsonb;
begin
  select o.id into house from public.orgs o join public.org_members m on m.org_id=o.id
    where o.slug='mccluster' and o.enabled and m.profile_id=p_owner and m.role='owner' limit 1;
  if house is null then raise exception 'Owner required' using errcode='42501'; end if;
  select jsonb_build_object('revision',revision,'commands',commands) into result
    from public.finance_paper_portfolios where org_id=house and owner_id=p_owner;
  return coalesce(result,jsonb_build_object('revision',0,'commands','[]'::jsonb));
end $$;

create function public.finance_paper_append(p_owner uuid, p_expected integer, p_commands jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare house uuid; current_row public.finance_paper_portfolios; n integer;
begin
  select o.id into house from public.orgs o join public.org_members m on m.org_id=o.id
    where o.slug='mccluster' and o.enabled and m.profile_id=p_owner and m.role='owner' limit 1;
  if house is null then raise exception 'Owner required' using errcode='42501'; end if;
  if p_expected is null or p_expected < 0 or p_commands is null or jsonb_typeof(p_commands) <> 'array'
    then raise exception 'Invalid commands' using errcode='23514'; end if;
  n := jsonb_array_length(p_commands);
  if n < 1 or n > 100 then raise exception 'Invalid count' using errcode='23514'; end if;
  insert into public.finance_paper_portfolios(org_id,owner_id) values(house,p_owner) on conflict do nothing;
  select * into current_row from public.finance_paper_portfolios where org_id=house and owner_id=p_owner for update;
  if current_row.revision <> p_expected then raise exception 'Portfolio changed; reload' using errcode='23505'; end if;
  if n <> jsonb_array_length(current_row.commands)+1 then raise exception 'Append only' using errcode='23514'; end if;
  if exists (select 1 from jsonb_array_elements(current_row.commands) with ordinality t(value,i)
    where value is distinct from p_commands->((i-1)::integer)) then raise exception 'History changed' using errcode='23514'; end if;
  update public.finance_paper_portfolios set commands=p_commands,revision=revision+1,updated_at=now()
    where org_id=house and owner_id=p_owner;
  return jsonb_build_object('revision',p_expected+1,'commands',p_commands);
end $$;
revoke all on function public.finance_paper_read(uuid) from public, anon, authenticated;
revoke all on function public.finance_paper_append(uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.finance_paper_read(uuid) to service_role;
grant execute on function public.finance_paper_append(uuid,integer,jsonb) to service_role;
commit;
