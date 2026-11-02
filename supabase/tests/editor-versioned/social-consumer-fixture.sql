-- Scratch-only social dependencies. Accounts/jobs DDL exact from 20260906174445; unrelated referenced tables and Vault are synthetic.
create table social_campaigns(id uuid primary key);create table social_variants(id uuid primary key);
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
create unique index social_publish_jobs_dedupe_idx on social_publish_jobs(dedupe_key) where dedupe_key is not null;
alter table social_publish_jobs add column lease_expires_at timestamptz;
create table inbox_channels(key text primary key);insert into inbox_channels values('instagram');
create table if not exists public.org_channels (
  org_id        uuid not null references public.orgs(id) on delete cascade,
  channel       text not null references public.inbox_channels(key) on delete cascade,
  enabled       boolean not null default false,

  -- ONE of these two, never a token. token_env is an environment variable
  -- and therefore can only ever hold one customer's token — it is the
  -- house's own path and nobody else's. secret_id points into the Vault,
  -- which has rows, and is how every other tenant's token is held.
  token_env     text,
  secret_id     uuid,

  -- the non-secret half: a WhatsApp phone_number_id, a Bluesky PDS host,
  -- a Page id. Some sends cannot be built without it.
  account_id    text,
  account_label text,
  -- ids that are US on that platform, so our own posts are never answered
  self_ids      text[] not null default '{}',

  -- Names the env var holding the secret that authenticates INBOUND
  -- webhooks for this tenant: Telegram's setWebhook secret_token, Slack's
  -- signing secret. Different from token_env, which is what we send OUT
  -- with. Null falls back to the platform-wide secret, which is right for
  -- the house and wrong the moment there are two customers on one app.
  webhook_secret_env text,

  follow_greeting text,
  auto_greet    boolean not null default false,

  connected_at  timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  last_error_at timestamptz,
  updated_at    timestamptz not null default now(),

  primary key (org_id, channel),
  constraint org_channels_one_credential
    check (token_env is null or secret_id is null)
);
create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text);
create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(text,text,text) returns uuid language sql as $$insert into vault.secrets(secret) values($1) returning id$$;
