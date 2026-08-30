BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS platform_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  legal_name text,
  display_name text NOT NULL,
  kind text NOT NULL DEFAULT 'business' CHECK (kind IN ('business','church','nonprofit','artist','individual','other')),
  status text NOT NULL DEFAULT 'lead' CHECK (status IN ('lead','onboarding','active','paused','closed')),
  owner_name text,
  owner_email text,
  owner_phone text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','preview','live','paused','archived')),
  primary_domain text,
  deployment_provider text,
  deployment_id text,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS platform_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES platform_sites(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug)
);

CREATE TABLE IF NOT EXISTS platform_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
  site_id uuid REFERENCES platform_sites(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'file',
  storage_provider text NOT NULL DEFAULT 'r2',
  storage_key text NOT NULL,
  public_url text,
  mime_type text,
  size_bytes bigint,
  checksum text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_provider, storage_key)
);

CREATE TABLE IF NOT EXISTS platform_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
  site_id uuid REFERENCES platform_sites(id) ON DELETE SET NULL,
  domain text UNIQUE NOT NULL,
  registrar text NOT NULL DEFAULT 'namesilo',
  registrar_domain_id text,
  wholesale_cents integer,
  retail_cents integer,
  expires_at timestamptz,
  auto_renew boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted','pending','registered','transferring','expired','cancelled','failed')),
  registrant_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe',
  provider_account_id text,
  onboarding_status text NOT NULL DEFAULT 'not_started',
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  deal_mode text NOT NULL DEFAULT 'paid' CHECK (deal_mode IN ('paid','equity_uprise')),
  revenue_share_percent numeric(6,3),
  revenue_share_term_months integer,
  revenue_share_cap_cents bigint,
  revenue_share_paid_cents bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

CREATE TABLE IF NOT EXISTS platform_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform_tenants(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'web',
  raw_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  structured_brief jsonb,
  model text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','ready','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform_tenants(id) ON DELETE CASCADE,
  site_id uuid REFERENCES platform_sites(id) ON DELETE SET NULL,
  type text NOT NULL,
  provider text NOT NULL DEFAULT 'runpod',
  provider_job_id text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS platform_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid REFERENCES platform_tenants(id) ON DELETE SET NULL,
  type text NOT NULL,
  actor text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_sites_tenant_idx ON platform_sites(tenant_id);
CREATE INDEX IF NOT EXISTS platform_pages_site_idx ON platform_pages(site_id);
CREATE INDEX IF NOT EXISTS platform_assets_tenant_idx ON platform_assets(tenant_id);
CREATE INDEX IF NOT EXISTS platform_jobs_tenant_status_idx ON platform_jobs(tenant_id, status);
CREATE INDEX IF NOT EXISTS platform_events_tenant_created_idx ON platform_events(tenant_id, created_at DESC);

COMMIT;
