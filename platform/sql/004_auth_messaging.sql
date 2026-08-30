BEGIN;

CREATE TABLE IF NOT EXISTS platform_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  display_name text,
  avatar_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google')),
  provider_subject text NOT NULL,
  provider_email text,
  claims jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_subject)
);

CREATE TABLE IF NOT EXISTS platform_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','editor','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,tenant_id)
);

CREATE TABLE IF NOT EXISTS platform_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  ip_hash text,
  user_agent text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_sessions_user_idx ON platform_sessions(user_id,expires_at);

CREATE TABLE IF NOT EXISTS messaging_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'twilio',
  provider_account_id text,
  provider_messaging_service_id text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','onboarding','pending','active','suspended','closed')),
  brand_type text,
  brand_id text,
  brand_status text,
  campaign_id text,
  campaign_status text,
  use_case text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,provider)
);

CREATE TABLE IF NOT EXISTS messaging_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
  messaging_account_id uuid REFERENCES messaging_accounts(id) ON DELETE SET NULL,
  e164 text UNIQUE NOT NULL,
  provider_number_id text,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'inventory' CHECK (status IN ('inventory','pending','active','suspended','released')),
  monthly_cost_cents integer,
  retail_monthly_cents integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messaging_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  name text,
  email text,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','deleted')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,phone_e164)
);

CREATE TABLE IF NOT EXISTS messaging_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES messaging_contacts(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  purpose text NOT NULL DEFAULT 'general',
  status text NOT NULL CHECK (status IN ('opted_in','opted_out')),
  source text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messaging_consents_phone_idx ON messaging_consents(tenant_id,phone_e164,occurred_at DESC);

CREATE TABLE IF NOT EXISTS messaging_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES messaging_contacts(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('outbound','inbound')),
  from_e164 text NOT NULL,
  to_e164 text NOT NULL,
  body text,
  media jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text NOT NULL DEFAULT 'twilio',
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued',
  error_code text,
  error_message text,
  cost_cents integer,
  retail_cents integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messaging_messages_tenant_idx ON messaging_messages(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS messaging_messages_provider_idx ON messaging_messages(provider,provider_message_id);

CREATE TABLE IF NOT EXISTS messaging_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_event_id)
);

COMMIT;
