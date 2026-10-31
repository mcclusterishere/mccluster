-- PENDING ONLY. Existing M Account + managed_projects ownership; no membership changes.
-- Apply after managed_projects_v1. Rollback disables the Worker feature first;
-- preserve preferences and listings rather than dropping customer data.
begin;
create table if not exists public.customer_site_modules (
 owner_user_id uuid not null references auth.users(id),
 source_kind text not null check(source_kind in ('front','project')),
 source_key text not null,
 module_key text not null check(module_key in ('world','world_discovery')),
 enabled boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key(owner_user_id,source_kind,source_key,module_key),
 check((source_kind='front' and source_key='me') or (source_kind='project' and source_key~'^[a-z0-9][a-z0-9-]{2,39}$'))
);
alter table public.customer_site_modules enable row level security;
alter table public.customer_site_modules force row level security;
revoke all on public.customer_site_modules from public,anon,authenticated;
grant select,insert,update on public.customer_site_modules to service_role;
create or replace function public.customer_site_module_set_v1(p_user uuid,p_actor uuid,p_kind text,p_key text,p_module text,p_enabled boolean)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.m_auth_user_links where auth_user_id=p_user and m_uid=p_actor and is_primary)
 or not exists(select 1 from public.m_people where id=p_actor and status='active') then raise exception 'account unavailable' using errcode='42501';end if;
 if p_kind='project' and not exists(select 1 from public.managed_projects where slug=p_key and owner_user_id=p_user and m_uid=p_actor and removed_at is null) then raise exception 'website unavailable' using errcode='42501';end if;
 insert into public.customer_site_modules(owner_user_id,source_kind,source_key,module_key,enabled)
 values(p_user,p_kind,p_key,p_module,p_enabled)
 on conflict(owner_user_id,source_kind,source_key,module_key) do update set enabled=excluded.enabled,updated_at=now();
end $$;
revoke all on function public.customer_site_module_set_v1(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.customer_site_module_set_v1(uuid,uuid,text,text,text,boolean) to service_role;
commit;
