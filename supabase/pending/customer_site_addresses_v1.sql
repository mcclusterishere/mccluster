-- PENDING. One immutable free address per owned source; no real names are seeded.
begin;
create table if not exists public.customer_site_addresses (
 slug text primary key check(slug~'^[a-z0-9][a-z0-9-]{2,39}$'),
 owner_user_id uuid not null references auth.users(id),
 source_kind text not null check(source_kind in ('front','project')),
 source_key text not null,
 created_at timestamptz not null default now(),
 unique(owner_user_id,source_kind,source_key),
 check((source_kind='front' and source_key='me') or (source_kind='project' and source_key~'^[a-z0-9][a-z0-9-]{2,39}$'))
);
alter table public.customer_site_addresses enable row level security;
alter table public.customer_site_addresses force row level security;
revoke all on public.customer_site_addresses from public,anon,authenticated;
grant select,insert on public.customer_site_addresses to service_role;
create or replace function public.customer_site_address_assign_v1(p_user uuid,p_actor uuid,p_kind text,p_key text,p_slug text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.m_auth_user_links where auth_user_id=p_user and m_uid=p_actor and is_primary) or not exists(select 1 from public.m_people where id=p_actor and status='active') then raise exception 'account unavailable' using errcode='42501';end if;
 if p_kind='project' and not exists(select 1 from public.managed_projects where slug=p_key and owner_user_id=p_user and m_uid=p_actor and removed_at is null) then raise exception 'website unavailable' using errcode='42501';end if;
 if p_slug=any(array['admin','api','assets','auth','account','company','control','css','data','docs','healthz','index','js','llms','main','mnet','music','news','platform','robots','scripts','sitemap','supabase','v1','workers','world','www','vaunt']) then raise exception 'reserved address' using errcode='42501';end if;
 if exists(select 1 from public.customer_site_addresses where slug=p_slug and owner_user_id=p_user and source_kind=p_kind and source_key=p_key) then return;end if;
 if exists(select 1 from public.customer_site_addresses where slug=p_slug or (owner_user_id=p_user and source_kind=p_kind and source_key=p_key)) then raise exception 'address already assigned' using errcode='40001';end if;
 insert into public.customer_site_addresses(slug,owner_user_id,source_kind,source_key) values(p_slug,p_user,p_kind,p_key);
exception when unique_violation then raise exception 'address already assigned' using errcode='40001';
end $$;
revoke all on function public.customer_site_address_assign_v1(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.customer_site_address_assign_v1(uuid,uuid,text,text,text) to service_role;
commit;
