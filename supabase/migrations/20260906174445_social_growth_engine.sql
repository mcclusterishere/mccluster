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

create unique index if not exists social_publish_jobs_dedupe_idx on public.social_publish_jobs(dedupe_key) where dedupe_key is not null;

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  campaign_id uuid references public.social_campaigns(id) on delete set null,
  variant_id uuid references public.social_variants(id) on delete set null,
  publish_job_id uuid references public.social_publish_jobs(id) on delete set null,
  external_media_id text not null,
  permalink text,
  publish_mode text not null default 'trial',
  caption text,
  published_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, external_media_id)
);

create table if not exists public.social_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  post_id uuid not null references public.social_posts(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  views bigint not null default 0,
  reach bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  saves bigint not null default 0,
  follows bigint not null default 0,
  profile_visits bigint not null default 0,
  dms bigint not null default 0,
  leads bigint not null default 0,
  watch_time_seconds numeric not null default 0,
  avg_watch_time_seconds numeric not null default 0,
  retention_3s numeric,
  score numeric,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists public.social_automation_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  campaign_id uuid references public.social_campaigns(id) on delete cascade,
  name text not null,
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  action_type text not null,
  action_config jsonb not null default '{}'::jsonb,
  approval_mode text not null default 'manual',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_webhook_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade,
  account_id uuid references public.social_accounts(id) on delete set null,
  platform text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'received',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  unique (platform, event_id)
);

create table if not exists public.social_lead_attribution (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  campaign_id uuid references public.social_campaigns(id) on delete set null,
  post_id uuid references public.social_posts(id) on delete set null,
  contact_id uuid references public.inbox_contacts(id) on delete set null,
  conversation_id uuid references public.inbox_conversations(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  conversion_type text not null default 'dm',
  value_cents integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists social_accounts_org_idx on public.social_accounts(org_id, platform);
create index if not exists social_campaigns_org_status_idx on public.social_campaigns(org_id, status);
create index if not exists social_variants_campaign_score_idx on public.social_variants(campaign_id, score desc nulls last);
create index if not exists social_publish_jobs_due_idx on public.social_publish_jobs(state, scheduled_at);
create index if not exists social_posts_campaign_idx on public.social_posts(campaign_id, published_at desc);
create index if not exists social_metric_snapshots_post_idx on public.social_metric_snapshots(post_id, recorded_at desc);
create index if not exists social_automation_rules_account_idx on public.social_automation_rules(account_id, enabled);
create index if not exists social_webhook_events_state_idx on public.social_webhook_events(state, received_at);
create index if not exists social_lead_attribution_campaign_idx on public.social_lead_attribution(campaign_id, created_at desc);

alter table public.social_accounts enable row level security;
alter table public.social_campaigns enable row level security;
alter table public.social_variants enable row level security;
alter table public.social_publish_jobs enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_metric_snapshots enable row level security;
alter table public.social_automation_rules enable row level security;
alter table public.social_webhook_events enable row level security;
alter table public.social_lead_attribution enable row level security;

do $$
declare t text;
begin
  foreach t in array array['social_accounts','social_campaigns','social_variants','social_publish_jobs','social_posts','social_metric_snapshots','social_automation_rules','social_webhook_events','social_lead_attribution'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (private.is_org_member(org_id))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all using (private.is_org_owner(org_id)) with check (private.is_org_owner(org_id))', t || '_write', t);
  end loop;
end $$;

comment on table public.social_accounts is 'McCluster-owned social account registry. credential_ref is a pointer; never store provider access tokens here.';
comment on table public.social_publish_jobs is 'Provider-neutral social publishing queue, including Instagram Trial Reel jobs.';
comment on table public.social_metric_snapshots is 'Append-only social performance telemetry used by the scoring and experimentation loop.';
