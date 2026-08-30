BEGIN;

CREATE TABLE IF NOT EXISTS platform_buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform_tenants(id) ON DELETE SET NULL,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York',
  status text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning','active','degraded','offline','retired')),
  mode text NOT NULL DEFAULT 'local_first' CHECK (mode IN ('local_first')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_server_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid REFERENCES platform_buildings(id) ON DELETE CASCADE,
  node_code text UNIQUE NOT NULL,
  role text NOT NULL CHECK (role IN ('building_primary','building_replica','control_plane','central_database','observability','staging','cold_spare')),
  ordinal integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning','healthy','degraded','offline','maintenance','retired')),
  active boolean NOT NULL DEFAULT false,
  last_heartbeat_at timestamptz,
  software_version text,
  private_address text,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role IN ('building_primary','building_replica') AND building_id IS NOT NULL) OR
         (role NOT IN ('building_primary','building_replica') AND building_id IS NULL))
);

CREATE TABLE IF NOT EXISTS platform_node_credentials (
  node_id uuid PRIMARY KEY REFERENCES platform_server_nodes(id) ON DELETE CASCADE,
  key_id text UNIQUE NOT NULL,
  secret_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_building_events (
  id uuid PRIMARY KEY,
  building_id uuid NOT NULL REFERENCES platform_buildings(id) ON DELETE CASCADE,
  source_node_id uuid REFERENCES platform_server_nodes(id) ON DELETE SET NULL,
  stream text NOT NULL,
  sequence bigint NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(building_id,stream,sequence)
);

CREATE TABLE IF NOT EXISTS platform_building_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES platform_buildings(id) ON DELETE CASCADE,
  target_node_id uuid REFERENCES platform_server_nodes(id) ON DELETE SET NULL,
  command_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','acknowledged','failed','expired','cancelled')),
  safety_class text NOT NULL DEFAULT 'normal' CHECK (safety_class IN ('normal','confirmation_required','local_only')),
  idempotency_key text UNIQUE NOT NULL,
  not_before timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  leased_until timestamptz,
  acknowledged_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (safety_class <> 'local_only')
);

CREATE INDEX IF NOT EXISTS platform_nodes_building_role_idx ON platform_server_nodes(building_id,role,status);
CREATE INDEX IF NOT EXISTS platform_nodes_heartbeat_idx ON platform_server_nodes(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS platform_building_events_order_idx ON platform_building_events(building_id,stream,sequence);
CREATE INDEX IF NOT EXISTS platform_commands_poll_idx ON platform_building_commands(building_id,status,not_before);

COMMIT;
