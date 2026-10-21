-- Test-only dependency shape for action_archive_cohort_v1.sql.
-- Apply after supabase_api_roles.stub.sql in an isolated database. Never production.
alter table public.m_people add column status text not null default 'active'
  check (status in ('active','merged','disabled'));
create table public.m_auth_user_links (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  link_method text not null default 'bootstrap',
  is_primary boolean not null default true
);
create unique index m_auth_user_links_one_primary_idx
  on public.m_auth_user_links(m_uid) where is_primary;
alter table public.m_people enable row level security;
alter table public.m_auth_user_links enable row level security;
revoke all on public.m_people, public.m_auth_user_links from public, anon, authenticated;
grant all on public.m_people, public.m_auth_user_links to service_role;

