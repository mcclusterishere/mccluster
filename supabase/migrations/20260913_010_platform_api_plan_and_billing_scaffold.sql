create table if not exists public.api_plans (
  plan_code text primary key, name text not null, description text not null default '', monthly_price_cents integer,
  monthly_credits bigint not null default 0, overage_price_per_1000_credits_cents integer,
  max_keys integer not null default 2, rate_limit_per_minute integer not null default 60,
  enabled boolean not null default true, public boolean not null default true,
  stripe_product_id text, stripe_price_id text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.api_subscriptions (
  id uuid primary key default gen_random_uuid(), consumer_id uuid not null unique references public.api_consumers(id) on delete cascade,
  plan_code text not null references public.api_plans(plan_code), status text not null default 'inactive' check (status in ('inactive','trialing','active','past_due','canceled')),
  stripe_customer_id text, stripe_subscription_id text, current_period_start timestamptz, current_period_end timestamptz,
  cancel_at_period_end boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.api_plans(plan_code,name,description,monthly_price_cents,monthly_credits,max_keys,rate_limit_per_minute,metadata) values
 ('developer','Developer','Build and test an integration before paid billing.',0,10000,2,60,'{"pricing_state":"live_free"}'::jsonb),
 ('builder','Builder','Paid API plan for production integrations.',null,100000,5,300,'{"pricing_state":"configure_before_sale"}'::jsonb),
 ('growth','Growth','Higher-volume API plan for established integrations.',null,500000,10,1200,'{"pricing_state":"configure_before_sale"}'::jsonb),
 ('scale','Scale','High-volume API plan with larger limits and enterprise upgrade path.',null,2000000,25,5000,'{"pricing_state":"configure_before_sale"}'::jsonb)
on conflict (plan_code) do update set name=excluded.name,description=excluded.description,monthly_credits=excluded.monthly_credits,max_keys=excluded.max_keys,rate_limit_per_minute=excluded.rate_limit_per_minute,metadata=excluded.metadata,updated_at=now();
alter table public.api_plans enable row level security; alter table public.api_subscriptions enable row level security;
grant select on public.api_plans to anon,authenticated; revoke all on public.api_subscriptions from anon,authenticated;
drop policy if exists api_plans_public_read on public.api_plans;
create policy api_plans_public_read on public.api_plans for select using (enabled and public);
