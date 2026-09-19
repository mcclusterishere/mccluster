-- ============================================================
-- SOCIAL GROWTH CORE — historical replay compatibility
--
-- Production received the timestamped social growth migration before the
-- later numbered hardening migration 0060 was authored. A clean Supabase
-- reset sorts migration files by filename, so 0060 otherwise runs before
-- 20260906174445_social_growth_engine.sql and fails because the social core
-- tables do not yet exist.
--
-- Recreate only the four tables 0060 depends on, using the exact canonical
-- column definitions from the timestamped migration. The later timestamped
-- migration is intentionally idempotent (`create table if not exists`) and
-- will create the remaining social tables, indexes, RLS policies, and
-- comments. On production, where these tables already exist, this migration
-- is a no-op apart from ensuring the expected indexes exist.
-- ============================================================

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  platform text not null,
  external_account_id text not null,
  handle text,
  display_name text,
  credential_ref text,
  status text not null default 'disconnected',
  capabilities jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, platform, external_account_id)
);

create table if not exists public.social_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  name text not null,
  objective text not null default 'growth',
  status text not null default 'draft',
  source_asset_id uuid references public.media_assets(id) on delete set null,
  created_by uuid,
  settings jsonb not null default '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_variants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  campaign_id uuid not null references public.social_campaigns(id) on delete cascade,
  source_asset_id uuid references public.media_assets(id) on delete set null,
  output_asset_id uuid references public.media_assets(id) on delete set null,
  media_job_id uuid references public.media_jobs(id) on delete set null,
  variant_key text not null,
  hypothesis text,
  hook text,
  caption text,
  hashtags jsonb not null default '[]'::jsonb,
  status text not null default 'planned',
  score numeric,
  score_components jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, variant_key)
);

create table if not exists public.social_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  campaign_id uuid references public.social_campaigns(id) on delete set null,
  variant_id uuid references public.social_variants(id) on delete set null,
  publish_mode text not null default 'trial',
  scheduled_at timestamptz not null default now(),
  state text not null default 'queued',
  external_creation_id text,
  external_media_id text,
  attempts integer not null default 0,
  last_error text,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists social_publish_jobs_dedupe_idx
  on public.social_publish_jobs(dedupe_key)
  where dedupe_key is not null;

create index if not exists social_accounts_org_idx
  on public.social_accounts(org_id, platform);
create index if not exists social_campaigns_org_status_idx
  on public.social_campaigns(org_id, status);
create index if not exists social_variants_campaign_score_idx
  on public.social_variants(campaign_id, score desc nulls last);
create index if not exists social_publish_jobs_due_idx
  on public.social_publish_jobs(state, scheduled_at);

-- Guard against accidental drift between this replay bridge and the
-- canonical social migration. If any of the required columns disappear,
-- fail here rather than letting 0060 fail with a misleading error later.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'social_publish_jobs'
      and column_name = 'scheduled_at'
  ) then
    raise exception 'social replay bridge did not create social_publish_jobs.scheduled_at';
  end if;
end $$;
