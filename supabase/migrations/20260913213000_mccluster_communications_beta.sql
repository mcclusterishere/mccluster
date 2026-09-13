-- McCluster Communications Beta 1
-- Private service-side messaging state for self-hosted Android/SIM relays.

create table if not exists public.comms_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  channel text not null default 'sms' check (channel in ('sms')),
  address text not null,
  display_name text,
  assistant_allowed boolean not null default true,
  blocked boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, channel, address)
);

create table if not exists public.comms_relay_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  label text not null,
  phone_number text not null,
  token_hash text not null unique,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  capabilities jsonb not null default '{"sms":true}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comms_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  contact_id uuid not null references public.comms_contacts(id) on delete cascade,
  relay_device_id uuid references public.comms_relay_devices(id) on delete set null,
  channel text not null default 'sms' check (channel in ('sms')),
  relay_address text not null,
  mode text not null default 'assistant' check (mode in ('assistant','human','paused','blocked')),
  assistant_enabled boolean not null default true,
  disclosure_sent_at timestamptz,
  takeover_at timestamptz,
  released_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_agent_reply_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, contact_id, channel, relay_address)
);

create table if not exists public.comms_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  thread_id uuid not null references public.comms_threads(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound','internal')),
  sender_type text not null check (sender_type in ('contact','assistant','owner','relay','system')),
  body text not null check (char_length(body) between 1 and 12000),
  status text not null default 'received' check (status in ('received','queued','claimed','sent','delivered','failed','suppressed')),
  external_id text,
  idempotency_key text not null,
  reply_to_message_id uuid references public.comms_messages(id) on delete set null,
  agent_job_id uuid references public.ops_agent_jobs(id) on delete set null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comms_messages_idempotency_uq unique (org_id, idempotency_key)
);
create index if not exists comms_messages_thread_time_idx on public.comms_messages(thread_id, occurred_at desc);

create table if not exists public.comms_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  thread_id uuid not null references public.comms_threads(id) on delete cascade,
  message_id uuid not null references public.comms_messages(id) on delete cascade,
  relay_device_id uuid references public.comms_relay_devices(id) on delete set null,
  destination text not null,
  body text not null check (char_length(body) between 1 and 12000),
  status text not null default 'queued' check (status in ('queued','claimed','sent','delivered','failed','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  last_error text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);
create index if not exists comms_outbox_claim_idx on public.comms_outbox(status, available_at, created_at);

create table if not exists public.comms_delivery_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  outbox_id uuid references public.comms_outbox(id) on delete set null,
  message_id uuid references public.comms_messages(id) on delete set null,
  relay_device_id uuid references public.comms_relay_devices(id) on delete set null,
  event text not null,
  status text,
  provider_message_id text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists comms_delivery_events_message_idx on public.comms_delivery_events(message_id, occurred_at desc);

create table if not exists public.comms_audit (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  thread_id uuid references public.comms_threads(id) on delete set null,
  actor_type text not null check (actor_type in ('relay','assistant','owner','system')),
  actor_id text,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists comms_audit_thread_idx on public.comms_audit(thread_id, created_at desc);

-- These are private control-plane tables. All external access goes through
-- authenticated Cloudflare/Core surfaces; browser/mobile clients never get
-- direct Data API grants.
alter table public.comms_contacts enable row level security;
alter table public.comms_relay_devices enable row level security;
alter table public.comms_threads enable row level security;
alter table public.comms_messages enable row level security;
alter table public.comms_outbox enable row level security;
alter table public.comms_delivery_events enable row level security;
alter table public.comms_audit enable row level security;

revoke all on table public.comms_contacts from anon, authenticated;
revoke all on table public.comms_relay_devices from anon, authenticated;
revoke all on table public.comms_threads from anon, authenticated;
revoke all on table public.comms_messages from anon, authenticated;
revoke all on table public.comms_outbox from anon, authenticated;
revoke all on table public.comms_delivery_events from anon, authenticated;
revoke all on table public.comms_audit from anon, authenticated;

-- Keep server-side service access explicit even on projects with non-default grants.
grant select, insert, update, delete on table public.comms_contacts to service_role;
grant select, insert, update, delete on table public.comms_relay_devices to service_role;
grant select, insert, update, delete on table public.comms_threads to service_role;
grant select, insert, update, delete on table public.comms_messages to service_role;
grant select, insert, update, delete on table public.comms_outbox to service_role;
grant select, insert, update, delete on table public.comms_delivery_events to service_role;
grant select, insert, update, delete on table public.comms_audit to service_role;
grant usage, select on sequence public.comms_audit_id_seq to service_role;
