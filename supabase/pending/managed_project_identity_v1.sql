-- PENDING ONLY. Free website identity; no domain/billing/Studio schema required.
-- Apply after managed_projects_v1. Compatible with creator_domain_targets_v1.
begin;
alter table public.managed_projects add column if not exists id uuid not null default gen_random_uuid();
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.managed_projects'::regclass and conname='managed_projects_id_key') then
  alter table public.managed_projects add constraint managed_projects_id_key unique(id);
 end if;
end $$;
create or replace function public.guard_managed_project_identity_v1() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.slug,new.owner_user_id,new.m_uid) is distinct from (old.id,old.slug,old.owner_user_id,old.m_uid) then
  raise exception 'Project identity is immutable; provision a separate target';
 end if;
 return new;
end $$;
revoke all on function public.guard_managed_project_identity_v1() from public,anon,authenticated;
drop trigger if exists managed_project_identity_v1 on public.managed_projects;
create trigger managed_project_identity_v1 before update on public.managed_projects
 for each row execute function public.guard_managed_project_identity_v1();
commit;
