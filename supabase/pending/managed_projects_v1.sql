-- PENDING REVIEW ONLY. No production activation or Vaunt seed is authorized.
-- Multiple separately published pages owned by an existing M Account.
-- Never use upsert by slug: uniqueness plus insert-only creation prevents takeover.
create table if not exists public.managed_projects (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  owner_user_id uuid not null references auth.users(id),
  m_uid uuid not null,
  name text not null check (length(name) between 1 and 100),
  draft jsonb not null default '{"schema":"mccluster-front/v1"}'::jsonb,
  published jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  -- Reserved repository presentation, assignable only by reviewed operator provisioning.
  registry_key text check (registry_key is null or (registry_key = 'vaunt' and slug = 'vaunt')),
  check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 65536),
  check (published is null or (jsonb_typeof(published) = 'object' and pg_column_size(published) <= 65536)),
  check ((published is null) = (published_at is null)),
  check (removed_at is null or published is null)
);
create index if not exists managed_projects_owner_idx on public.managed_projects(owner_user_id,m_uid);
alter table public.managed_projects enable row level security;
alter table public.managed_projects force row level security;
revoke all on public.managed_projects from public, anon, authenticated;
grant select,insert,update on public.managed_projects to service_role;
comment on table public.managed_projects is 'Service-only named project pages; Worker validates session plus owner_user_id and m_uid for private access. Public API returns published config only. Removal retains slug against takeover.';
-- No policies for anon/authenticated; no new storage bucket, auth identity, membership, or grant.
-- Reuse existing front-media/<owner auth uid>/ policies with a narrower projects/<slug>/ prefix for each project. Registry assets stay in reviewed code.
-- Rollback only after preserving customer data: drop table public.managed_projects;
