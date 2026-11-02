-- Exact platform_apps DDL extracted from replay 0034; fixture only.
create table if not exists public.platform_apps (
  id uuid primary key default gen_random_uuid(),
  app_key text not null unique,
  name text not null,
  product_family text not null,
  kind text not null default 'web'
    check (kind in ('web','ios','android','desktop','service','game')),
  bundle_id text,
  public_url text,
  oauth_client_id text,
  oauth_redirect_uris jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
