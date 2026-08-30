BEGIN;

CREATE TABLE IF NOT EXISTS platform_content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES platform_sites(id) ON DELETE CASCADE,
  type text NOT NULL,
  slug text NOT NULL,
  title text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id,type,slug)
);

CREATE TABLE IF NOT EXISTS platform_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES platform_sites(id) ON DELETE CASCADE,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','closed','spam')),
  name text,
  email text,
  phone text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
  site_id uuid REFERENCES platform_sites(id) ON DELETE SET NULL,
  slug text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'property',
  address text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','planning','renovation','archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,slug)
);

CREATE TABLE IF NOT EXISTS platform_spatial_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES platform_spaces(id) ON DELETE CASCADE,
  capture_type text NOT NULL DEFAULT 'reality-capture' CHECK (capture_type IN ('reality-capture','gaussian-splat','photogrammetry','floorplan','reference-video','reference-photos')),
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','queued','processing','ready','failed','archived')),
  source_asset_ids uuid[] NOT NULL DEFAULT '{}',
  output_asset_id uuid REFERENCES platform_assets(id) ON DELETE SET NULL,
  provider text,
  provider_job_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_content_site_type_idx ON platform_content_items(site_id,type,status,sort_order);
CREATE INDEX IF NOT EXISTS platform_submissions_site_type_idx ON platform_submissions(site_id,type,status,created_at DESC);
CREATE INDEX IF NOT EXISTS platform_spaces_tenant_idx ON platform_spaces(tenant_id,status);
CREATE INDEX IF NOT EXISTS platform_spatial_space_idx ON platform_spatial_captures(space_id,status);

INSERT INTO platform_tenants(slug,legal_name,display_name,kind,status,owner_name,owner_email,owner_phone,metadata)
VALUES (
  'first-baptist-east-point',
  'First Baptist Church East Point',
  'First Baptist Church East Point',
  'church',
  'lead',
  'Rev. Kamau Welcher',
  'office@fbcepga.org',
  '404-762-9451',
  '{"address":"2813 East Point Street, East Point, GA 30344","existingSite":"https://firstbaptistchurcheastpoint.org/","seedSource":"public-web-2026-08-10"}'::jsonb
) ON CONFLICT(slug) DO UPDATE SET
  legal_name=excluded.legal_name,
  display_name=excluded.display_name,
  owner_name=excluded.owner_name,
  owner_email=excluded.owner_email,
  owner_phone=excluded.owner_phone,
  metadata=platform_tenants.metadata || excluded.metadata,
  updated_at=now();

INSERT INTO platform_tenants(slug,legal_name,display_name,kind,status,owner_phone,metadata)
VALUES (
  'shiloh-baptist-bridgeport',
  'Shiloh Baptist Church',
  'Shiloh Baptist Church',
  'church',
  'active',
  '203-579-1504',
  '{"address":"477 Broad Street, Bridgeport, CT 06604","seedSource":"public-directory-2026-08-10","hasExistingApp":true}'::jsonb
) ON CONFLICT(slug) DO UPDATE SET
  legal_name=excluded.legal_name,
  display_name=excluded.display_name,
  owner_phone=excluded.owner_phone,
  metadata=platform_tenants.metadata || excluded.metadata,
  updated_at=now();

INSERT INTO platform_sites(tenant_id,slug,name,status,primary_domain,settings)
SELECT id,'first-baptist-east-point','First Baptist Church East Point','draft','firstbaptistchurcheastpoint.org',
  '{"appMode":"pwa","clientOwnsExistingDomain":true,"launchTarget":"2026-08-11"}'::jsonb
FROM platform_tenants WHERE slug='first-baptist-east-point'
ON CONFLICT(tenant_id,slug) DO UPDATE SET settings=platform_sites.settings || excluded.settings, updated_at=now();

INSERT INTO platform_sites(tenant_id,slug,name,status,settings)
SELECT id,'shiloh-baptist-bridgeport','Shiloh Baptist Church','preview',
  '{"appMode":"pwa","existingApp":true,"spatialExperiencePlanned":true}'::jsonb
FROM platform_tenants WHERE slug='shiloh-baptist-bridgeport'
ON CONFLICT(tenant_id,slug) DO UPDATE SET settings=platform_sites.settings || excluded.settings, updated_at=now();

INSERT INTO platform_spaces(tenant_id,site_id,slug,name,kind,address,status,metadata)
SELECT t.id,s.id,'main-campus','Main Campus','church-campus','477 Broad Street, Bridgeport, CT 06604','active',
  '{"purpose":["member preview","architectural reference","future renovation planning","3D campus tour"]}'::jsonb
FROM platform_tenants t JOIN platform_sites s ON s.tenant_id=t.id
WHERE t.slug='shiloh-baptist-bridgeport' AND s.slug='shiloh-baptist-bridgeport'
ON CONFLICT(tenant_id,slug) DO UPDATE SET metadata=platform_spaces.metadata || excluded.metadata,updated_at=now();

COMMIT;
