-- Reconstruct the Level 3 storefront schema/RPC surface that already exists in production.
-- Replay-only source history repair: no production mutation is performed by this file.

create table if not exists public.l3_owner_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  purpose text not null default 'level3_owner_claim',
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.l3_store_settings (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  plan_code text not null default 'none' check (plan_code in ('none','standard_33','share_1650_50')),
  billing_status text not null default 'inactive' check (billing_status in ('inactive','active','trialing','past_due','unpaid','canceled')),
  platform_stripe_customer_id text,
  platform_stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  connected_account_id text,
  storefront_enabled boolean not null default false,
  support_email text,
  store_name text not null default 'Level 3 Media',
  store_description text not null default '',
  terms_url text,
  refund_policy text not null default 'Digital products are delivered electronically. Refunds are handled by Level 3 Media subject to applicable law.',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.l3_products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  slug text not null,
  title text not null,
  description text not null default '',
  short_description text not null default '',
  price_cents integer not null check (price_cents >= 50),
  currency text not null default 'usd',
  status text not null default 'draft' check (status in ('draft','published','archived')),
  cover_path text,
  asset_path text,
  file_name text,
  file_size_bytes bigint,
  version text not null default '1.0',
  license_text text not null default 'Single purchaser license. Redistribution or resale of the source files is prohibited unless Level 3 Media states otherwise.',
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug),
  check (status <> 'published' or asset_path is not null)
);

create table if not exists public.l3_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  product_id uuid not null references public.l3_products(id),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  connected_account_id text,
  customer_email text,
  customer_name text,
  amount_cents integer not null,
  application_fee_cents integer not null default 0,
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded','partially_refunded','disputed')),
  plan_code text not null default 'none',
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists l3_orders_org_created_idx on public.l3_orders(org_id, created_at desc);
create index if not exists l3_orders_customer_email_idx on public.l3_orders(org_id, lower(customer_email));

create table if not exists public.l3_entitlements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.l3_orders(id) on delete cascade,
  product_id uuid not null references public.l3_products(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  customer_email text,
  download_count integer not null default 0,
  last_download_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.l3_download_events (
  id bigint generated always as identity primary key,
  entitlement_id uuid not null references public.l3_entitlements(id) on delete cascade,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.l3_activity (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  subject_type text not null,
  subject_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.l3_auth_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  mccluster_id text,
  success boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists l3_auth_attempts_ip_time_idx on public.l3_auth_attempts(ip_hash, created_at desc);

alter table public.l3_owner_invites enable row level security;
alter table public.l3_store_settings enable row level security;
alter table public.l3_products enable row level security;
alter table public.l3_orders enable row level security;
alter table public.l3_entitlements enable row level security;
alter table public.l3_download_events enable row level security;
alter table public.l3_activity enable row level security;
alter table public.l3_auth_attempts enable row level security;

create or replace function public.l3_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select id from public.orgs where slug='level-3-media' limit 1 $$;

create or replace function public.l3_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists(select 1 from public.org_members m where m.org_id=public.l3_org_id() and m.profile_id=auth.uid() and m.role='owner') $$;

create or replace function public.l3_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists(select 1 from public.org_members m where m.org_id=public.l3_org_id() and m.profile_id=auth.uid() and m.role in ('owner','staff')) $$;

create or replace function public.l3_public_products()
returns table(id uuid, title text, slug text, short_description text, description text, price_cents integer, currency text, cover_path text, version text, sort_order integer, published_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,p.title,p.slug,p.short_description,p.description,p.price_cents,p.currency,p.cover_path,p.version,p.sort_order,p.published_at
  from public.l3_products p
  join public.l3_store_settings s on s.org_id=p.org_id
  where p.org_id=public.l3_org_id()
    and p.status='published'
    and s.billing_status in ('active','trialing')
    and s.storefront_enabled=true
  order by p.sort_order asc,p.created_at desc
$$;

create or replace function public.l3_public_storefront()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.billing_status in ('active','trialing') and s.storefront_enabled then jsonb_build_object(
      'store_name', s.store_name,
      'store_description', s.store_description,
      'support_email', s.support_email,
      'refund_policy', s.refund_policy,
      'terms_url', s.terms_url,
      'enabled', true
    )
    else jsonb_build_object('store_name','Level 3 Media','store_description','Digital products by Level 3 Media.','enabled',false)
  end
  from public.l3_store_settings s
  where s.org_id=public.l3_org_id()
  limit 1
$$;

create or replace function public.l3_dashboard_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
select case when public.l3_is_staff() then jsonb_build_object(
  'products',(select count(*) from public.l3_products where org_id=public.l3_org_id()),
  'published_products',(select count(*) from public.l3_products where org_id=public.l3_org_id() and status='published'),
  'orders',(select count(*) from public.l3_orders where org_id=public.l3_org_id()),
  'paid_orders',(select count(*) from public.l3_orders where org_id=public.l3_org_id() and status='paid'),
  'gross_cents',coalesce((select sum(amount_cents) from public.l3_orders where org_id=public.l3_org_id() and status='paid'),0),
  'platform_fees_cents',coalesce((select sum(application_fee_cents) from public.l3_orders where org_id=public.l3_org_id() and status='paid'),0),
  'downloads',coalesce((select sum(e.download_count) from public.l3_entitlements e join public.l3_orders o on o.id=e.order_id where o.org_id=public.l3_org_id()),0),
  'billing',(select to_jsonb(s) from public.l3_store_settings s where s.org_id=public.l3_org_id())
) else null end
$$;

create or replace function public.l3_update_store_profile(
  p_store_name text default null,
  p_store_description text default null,
  p_support_email text default null,
  p_refund_policy text default null,
  p_terms_url text default null,
  p_storefront_enabled boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid:=public.l3_org_id();
  v_status text;
  v_row public.l3_store_settings%rowtype;
begin
  if not public.l3_is_owner() then raise exception 'owner_required'; end if;
  select billing_status into v_status from public.l3_store_settings where org_id=v_org;
  if p_storefront_enabled is true and v_status not in ('active','trialing') then raise exception 'active_subscription_required'; end if;
  update public.l3_store_settings set
    store_name=coalesce(nullif(trim(p_store_name),''),store_name),
    store_description=coalesce(p_store_description,store_description),
    support_email=coalesce(nullif(trim(p_support_email),''),support_email),
    refund_policy=coalesce(nullif(trim(p_refund_policy),''),refund_policy),
    terms_url=coalesce(p_terms_url,terms_url),
    storefront_enabled=coalesce(p_storefront_enabled,storefront_enabled),
    updated_at=now()
  where org_id=v_org returning * into v_row;
  insert into public.l3_activity(org_id,actor_user_id,action,subject_type,subject_id)
    values(v_org,auth.uid(),'store_settings_updated','store',v_org::text);
  return to_jsonb(v_row);
end
$$;

create or replace function public.claim_level3_owner(p_token text, p_mccluster_id text, p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_invite public.l3_owner_invites%rowtype;
  v_org uuid;
  v_app uuid;
  v_id text := public.normalize_mccluster_id(p_mccluster_id);
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  if v_id !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then raise exception 'invalid_mccluster_id'; end if;
  if exists(select 1 from public.platform_profiles where lower(mccluster_id)=v_id and user_id<>v_uid) then
    raise exception 'mccluster_id_taken';
  end if;
  v_hash := encode(digest(p_token, 'sha256'),'hex');
  select * into v_invite from public.l3_owner_invites
    where token_hash=v_hash and used_at is null and expires_at > now()
    for update;
  if not found then raise exception 'invalid_or_expired_invite'; end if;
  v_org := public.l3_org_id();
  select id into v_app from public.platform_apps where app_key='level-3-media-web' limit 1;
  if v_org is null or v_app is null then raise exception 'level3_not_registered'; end if;

  update public.platform_profiles
    set mccluster_id=v_id,
        display_name=case when trim(coalesce(p_display_name,''))<>'' then trim(p_display_name) else display_name end,
        updated_at=now()
    where user_id=v_uid;
  if not found then
    insert into public.platform_profiles(user_id, display_name, primary_email, phone, avatar_url, locale, timezone, settings, mccluster_id)
      select u.id, coalesce(nullif(trim(p_display_name),''), coalesce(u.raw_user_meta_data->>'name','')), lower(coalesce(u.email,'')), coalesce(u.phone,''), '', 'en-US', 'America/New_York', '{}'::jsonb, v_id
      from auth.users u where u.id=v_uid;
  end if;

  insert into public.org_members(org_id, profile_id, role)
    values(v_org, v_uid, 'owner')
    on conflict (org_id, profile_id) do update set role='owner';
  insert into public.platform_user_apps(user_id, app_id, org_id, role, settings)
    values(v_uid, v_app, v_org, 'owner', jsonb_build_object('level3',true))
    on conflict (user_id, app_id, org_id) do update set role='owner', last_seen_at=now();
  update public.l3_owner_invites set used_at=now(), used_by=v_uid where id=v_invite.id;
  insert into public.l3_activity(org_id, actor_user_id, action, subject_type, subject_id)
    values(v_org, v_uid, 'owner_claimed', 'user', v_uid::text);
  return jsonb_build_object('ok',true,'org_id',v_org,'app_id',v_app,'mccluster_id',v_id);
end;
$$;

-- Match the production RLS surface. Tables without a policy remain service-only through RLS.
drop policy if exists l3_activity_staff_read on public.l3_activity;
create policy l3_activity_staff_read on public.l3_activity for select to authenticated
using (public.l3_is_staff() and org_id=public.l3_org_id());

drop policy if exists l3_entitlements_staff_read on public.l3_entitlements;
create policy l3_entitlements_staff_read on public.l3_entitlements for select to authenticated
using (public.l3_is_staff() and exists(select 1 from public.l3_orders o where o.id=l3_entitlements.order_id and o.org_id=public.l3_org_id()));

drop policy if exists l3_orders_staff_read on public.l3_orders;
create policy l3_orders_staff_read on public.l3_orders for select to authenticated
using (public.l3_is_staff() and org_id=public.l3_org_id());

drop policy if exists l3_products_staff_all on public.l3_products;
create policy l3_products_staff_all on public.l3_products for all to authenticated
using (public.l3_is_staff() and org_id=public.l3_org_id())
with check (public.l3_is_staff() and org_id=public.l3_org_id());

drop policy if exists l3_settings_staff_read on public.l3_store_settings;
create policy l3_settings_staff_read on public.l3_store_settings for select to authenticated
using (public.l3_is_staff() and org_id=public.l3_org_id());

revoke all on table public.l3_owner_invites from anon, authenticated;
grant all on table public.l3_owner_invites to service_role;
grant all on table public.l3_activity, public.l3_auth_attempts, public.l3_download_events,
  public.l3_entitlements, public.l3_orders, public.l3_products, public.l3_store_settings
  to anon, authenticated, service_role;

revoke all on function public.claim_level3_owner(text,text,text) from public, anon;
revoke all on function public.l3_dashboard_summary() from public, anon;
revoke all on function public.l3_is_owner() from public, anon;
revoke all on function public.l3_is_staff() from public, anon;
revoke all on function public.l3_org_id() from public, anon;
revoke all on function public.l3_update_store_profile(text,text,text,text,text,boolean) from public, anon;
grant execute on function public.claim_level3_owner(text,text,text) to authenticated, service_role;
grant execute on function public.l3_dashboard_summary() to authenticated, service_role;
grant execute on function public.l3_is_owner() to authenticated, service_role;
grant execute on function public.l3_is_staff() to authenticated, service_role;
grant execute on function public.l3_org_id() to authenticated, service_role;
grant execute on function public.l3_update_store_profile(text,text,text,text,text,boolean) to authenticated, service_role;
grant execute on function public.l3_public_products() to anon, authenticated, service_role;
grant execute on function public.l3_public_storefront() to anon, authenticated, service_role;
