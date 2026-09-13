create extension if not exists pgcrypto;

create table if not exists public.api_consumers (
  id uuid primary key default gen_random_uuid(), owner_m_uid uuid references public.m_people(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete cascade, name text not null, slug text not null unique,
  status text not null default 'active' check (status in ('active','suspended','closed')),
  plan_code text not null default 'developer', monthly_credit_limit bigint not null default 10000,
  hard_spend_limit_cents bigint, settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (owner_m_uid is not null or org_id is not null)
);
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(), consumer_id uuid not null references public.api_consumers(id) on delete cascade,
  key_prefix text not null, secret_hash text not null unique, name text not null default 'default',
  scopes text[] not null default array['mnet:read']::text[], status text not null default 'active',
  last_used_at timestamptz, expires_at timestamptz, created_at timestamptz not null default now(), revoked_at timestamptz
);
create index if not exists api_keys_prefix_idx on public.api_keys(key_prefix);
create table if not exists public.api_products (
  product_key text primary key, name text not null, description text not null default '', unit_name text not null default 'credit',
  default_unit_cost bigint not null default 1, enabled boolean not null default true, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.api_usage_events (
  id uuid primary key default gen_random_uuid(), consumer_id uuid not null references public.api_consumers(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null, product_key text not null references public.api_products(product_key),
  endpoint text not null, method text not null, units bigint not null default 1 check (units > 0), request_id text,
  status_code integer, latency_ms integer, source_app_id uuid references public.platform_apps(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default now()
);
create index if not exists api_usage_consumer_time_idx on public.api_usage_events(consumer_id, occurred_at desc);
create table if not exists public.api_credit_ledger (
  id uuid primary key default gen_random_uuid(), consumer_id uuid not null references public.api_consumers(id) on delete cascade,
  delta bigint not null, reason text not null, reference_type text, reference_id text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists api_credit_ledger_consumer_idx on public.api_credit_ledger(consumer_id, created_at desc);
create table if not exists public.network_notifications (
  id uuid primary key default gen_random_uuid(), recipient_m_uid uuid not null references public.m_people(id) on delete cascade,
  actor_m_uid uuid references public.m_people(id) on delete set null, type text not null, object_type text, object_id text,
  source_app_id uuid references public.platform_apps(id) on delete set null, body text not null default '', metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists network_notifications_recipient_idx on public.network_notifications(recipient_m_uid, created_at desc);
insert into public.api_products(product_key,name,description,unit_name,default_unit_cost,metadata) values
 ('mnet.read','Mnet Read API','Profiles, feed, posts, graph and public network reads','credit',1,'{"category":"mnet"}'::jsonb),
 ('mnet.write','Mnet Write API','Posts, replies, follows, reactions and profile mutations','credit',2,'{"category":"mnet"}'::jsonb),
 ('mnet.events','Mnet Events API','Cross-application activity and telemetry ingestion','event',1,'{"category":"mnet"}'::jsonb),
 ('platform.catalog','Platform Catalog API','McCluster application, product and capability catalog','credit',1,'{"category":"platform"}'::jsonb),
 ('platform.identity','Platform Identity API','McCluster identity/profile resolution for authorized integrations','credit',2,'{"category":"platform"}'::jsonb)
on conflict (product_key) do update set name=excluded.name,description=excluded.description,unit_name=excluded.unit_name,default_unit_cost=excluded.default_unit_cost,metadata=excluded.metadata,updated_at=now();
alter table public.api_consumers enable row level security; alter table public.api_keys enable row level security;
alter table public.api_products enable row level security; alter table public.api_usage_events enable row level security;
alter table public.api_credit_ledger enable row level security; alter table public.network_notifications enable row level security;
revoke all on public.api_consumers,public.api_keys,public.api_usage_events,public.api_credit_ledger from anon,authenticated;
grant select on public.api_products to anon,authenticated;
revoke all on public.network_notifications from anon; grant select,update on public.network_notifications to authenticated;
drop policy if exists api_products_public_read on public.api_products; create policy api_products_public_read on public.api_products for select using (enabled=true);
drop policy if exists network_notifications_self_read on public.network_notifications; create policy network_notifications_self_read on public.network_notifications for select to authenticated using (recipient_m_uid=public.current_m_uid());
drop policy if exists network_notifications_self_update on public.network_notifications; create policy network_notifications_self_update on public.network_notifications for update to authenticated using (recipient_m_uid=public.current_m_uid()) with check (recipient_m_uid=public.current_m_uid());
create or replace function public.api_credit_balance(p_consumer uuid) returns bigint language sql stable security definer set search_path=public as $$ select coalesce(sum(delta),0)::bigint from public.api_credit_ledger where consumer_id=p_consumer $$;
revoke all on function public.api_credit_balance(uuid) from public,anon,authenticated;
