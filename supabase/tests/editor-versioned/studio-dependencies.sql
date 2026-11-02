-- Synthetic external media/billing catalog, copied in shape from #681's
-- project-tiles-fixture.mjs. No provider, processing or financial behavior is simulated as verified.
create table creator_billing_subscriptions(owner_user_id uuid,org_id uuid,status text,stripe_subscription_id text,stripe_price_id text,current_period_end timestamptz);
create table media_models(id uuid default gen_random_uuid(),provider text,provider_model_id text,capability text,enabled boolean);
create table media_assets(id uuid primary key,asset_type text,role text,storage_path text,metadata jsonb);
create table media_jobs(id uuid primary key,status text,result jsonb,error jsonb,completed_at timestamptz,updated_at timestamptz);
