-- Additive social queue on the EXISTING McCluster Supabase project
-- (zmnhbrjyhxzhkxmhkexs). This does not create a second project.
-- Tenancy already exists (0026_tenancy.sql). These tables are the
-- client social backend every satellite is supposed to call.

create table if not exists mc_social_accounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_slug   text not null,
  channel       text not null check (channel in ('x','instagram','facebook','linkedin','tiktok')),
  handle        text not null,
  connected     boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists mc_social_campaigns (
  id            uuid primary key default gen_random_uuid(),
  tenant_slug   text not null,
  name          text not null,
  objective     text not null default '',
  status        text not null default 'active',
  created_at    timestamptz not null default now()
);

create table if not exists mc_social_posts (
  id            uuid primary key default gen_random_uuid(),
  tenant_slug   text not null,
  campaign_id   uuid references mc_social_campaigns(id) on delete set null,
  channel       text not null,
  body          text not null,
  status        text not null default 'draft' check (status in ('draft','queued','published','failed')),
  scheduled_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists mc_social_posts_tenant_idx on mc_social_posts (tenant_slug, created_at desc);

alter table mc_social_accounts enable row level security;
alter table mc_social_campaigns enable row level security;
alter table mc_social_posts enable row level security;

-- Public read of published posts for satellite sites. Writes stay service-role / staff.
drop policy if exists mc_social_posts_public_read on mc_social_posts;
create policy mc_social_posts_public_read on mc_social_posts
  for select using (status = 'published');
