BEGIN;

CREATE TABLE IF NOT EXISTS isp_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform_tenants(id) ON DELETE SET NULL,
  legal_name text NOT NULL,
  brand_name text,
  frn text,
  arin_org_id text,
  asn bigint,
  provider_type text NOT NULL DEFAULT 'wisp' CHECK (provider_type IN ('wisp','fiber','reseller','iot','hybrid')),
  bdc_filer boolean NOT NULL DEFAULT false,
  facilities_based boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','lab','pilot','active','paused','retired')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS isp_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES isp_organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  site_type text NOT NULL DEFAULT 'pop' CHECK (site_type IN ('core','pop','tower','rooftop','customer','iot-gateway','datacenter','lab')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','surveyed','installing','active','degraded','offline','retired')),
  latitude numeric(9,6),
  longitude numeric(9,6),
  address text,
  elevation_m numeric(9,2),
  power_source text,
  backhaul_type text,
  upstream_capacity_mbps integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS isp_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES isp_organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES isp_sites(id) ON DELETE SET NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('router','switch','access-point','backhaul','cpe','server','lorawan-gateway','monitor','other')),
  vendor text,
  model text,
  serial_number text,
  management_ip inet,
  mac_address macaddr,
  firmware text,
  status text NOT NULL DEFAULT 'inventory' CHECK (status IN ('inventory','staging','active','degraded','offline','retired')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  telemetry jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS isp_upstreams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES isp_organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  provider text NOT NULL,
  circuit_id text,
  handoff text,
  capacity_mbps integer,
  monthly_cents integer,
  bgp_enabled boolean NOT NULL DEFAULT false,
  remote_asn bigint,
  local_asn bigint,
  status text NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted','ordered','installing','active','degraded','cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS isp_prefixes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES isp_organizations(id) ON DELETE CASCADE,
  prefix cidr NOT NULL,
  family smallint NOT NULL CHECK (family IN (4,6)),
  source text NOT NULL DEFAULT 'upstream' CHECK (source IN ('arin','upstream','transfer','private','ula')),
  purpose text NOT NULL DEFAULT 'customer' CHECK (purpose IN ('infrastructure','customer','management','nat-pool','loopback','lab')),
  announced boolean NOT NULL DEFAULT false,
  upstream_id uuid REFERENCES isp_upstreams(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,prefix)
);

CREATE TABLE IF NOT EXISTS isp_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES isp_organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  technology text NOT NULL DEFAULT 'fixed-wireless',
  down_mbps integer NOT NULL,
  up_mbps integer NOT NULL,
  monthly_cents integer NOT NULL,
  install_cents integer NOT NULL DEFAULT 0,
  data_cap_gb integer,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS isp_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES isp_organizations(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES platform_tenants(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES isp_plans(id) ON DELETE SET NULL,
  site_id uuid REFERENCES isp_sites(id) ON DELETE SET NULL,
  account_number text,
  name text NOT NULL,
  email text,
  phone text,
  service_address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  status text NOT NULL DEFAULT 'lead' CHECK (status IN ('lead','survey','scheduled','active','suspended','cancelled')),
  cpe_device_id uuid REFERENCES isp_devices(id) ON DELETE SET NULL,
  assigned_ipv4 inet,
  delegated_ipv6 cidr,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,account_number)
);

CREATE TABLE IF NOT EXISTS isp_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES isp_organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES isp_sites(id) ON DELETE SET NULL,
  title text NOT NULL,
  severity text NOT NULL DEFAULT 'minor' CHECK (severity IN ('info','minor','major','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','monitoring','resolved')),
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS isp_regulatory_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES isp_organizations(id) ON DELETE CASCADE,
  filing_type text NOT NULL,
  period_start date,
  period_end date,
  due_at date,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','draft','ready','filed','not_required')),
  external_id text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  filed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS isp_sites_org_idx ON isp_sites(organization_id,status);
CREATE INDEX IF NOT EXISTS isp_devices_site_idx ON isp_devices(site_id,status);
CREATE INDEX IF NOT EXISTS isp_subscribers_org_idx ON isp_subscribers(organization_id,status);
CREATE INDEX IF NOT EXISTS isp_incidents_org_idx ON isp_incidents(organization_id,status);

COMMIT;
