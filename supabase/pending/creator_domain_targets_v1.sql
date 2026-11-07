-- PENDING ONLY. Apply after managed_projects_v1 and creator_domains_v1.
-- UUID survives content updates, never slug reuse or a new installation.
begin;
-- Free sites may already have acquired immutable identity independently.
alter table public.managed_projects add column if not exists id uuid not null default gen_random_uuid();
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.managed_projects'::regclass and conname='managed_projects_id_key') then
  alter table public.managed_projects add constraint managed_projects_id_key unique(id);
 end if;
end $$;
alter table public.creator_domains add column target_type text not null default 'member_front'
 check(target_type in ('member_front','managed_project'));
alter table public.creator_domains add column target_id uuid;
update public.creator_domains set target_id=auth_user_id;
alter table public.creator_domains alter column target_id set not null;
create function public.guard_domain_target_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='managed_projects' then
  if (new.id,new.slug,new.owner_user_id,new.m_uid) is distinct from (old.id,old.slug,old.owner_user_id,old.m_uid) then
   raise exception 'Project identity is immutable; provision a separate target';
  end if;
 else
  if (new.id,new.auth_user_id,new.hostname,new.target_type,new.target_id,new.handle,new.verification_token)
   is distinct from (old.id,old.auth_user_id,old.hostname,old.target_type,old.target_id,old.handle,old.verification_token) then
   raise exception 'Domain target is immutable; disconnect and create a new claim';
  end if;
 end if;
 return new;
end; $$;
revoke all on function public.guard_domain_target_identity() from public, anon, authenticated;
create trigger managed_project_identity before update on public.managed_projects
 for each row execute function public.guard_domain_target_identity();
create trigger creator_domain_target_identity before update on public.creator_domains
 for each row execute function public.guard_domain_target_identity();
-- No new browser grants. Both existing tables retain forced RLS/service-only access.
commit;
