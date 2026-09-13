-- McCluster Compute Gateway: canonical metering, provider registry, reservations, and cost ledger.
-- Applied to canonical Supabase project zmnhbrjyhxzhkxmhkexs.

create table if not exists public.compute_providers (
  provider_key text primary key,
  name text not null,
  provider_type text not null check (provider_type in ('frontier_api','open_model_api','media_api','3d_api','gpu_cloud','mccluster_native','byok')),
  status text not null default 'available' check (status in ('available','degraded','disabled','contract_required')),
  base_url text,
  supports_byok boolean not null default false,
  reseller_status text not null default 'unverified' check (reseller_status in ('unverified','allowed','byok_only','prohibited','contract_required')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.compute_models (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null references public.compute_providers(provider_key) on update cascade,
  model_key text not null,
  display_name text not null,
  capability text not null check (capability in ('text','reasoning','embedding','image','video','audio','speech','transcription','music','3d','rerank','moderation','gpu','workflow')),
  billing_unit text not null,
  upstream_input_microusd_per_unit numeric(20,8) not null default 0,
  upstream_output_microusd_per_unit numeric(20,8) not null default 0,
  upstream_flat_microusd numeric(20,8) not null default 0,
  upstream_currency text not null default 'USD',
  target_margin_bps integer not null default 2500 check (target_margin_bps between 0 and 9500),
  minimum_charge_credits bigint not null default 1,
  enabled boolean not null default false,
  quality_tier integer not null default 50 check (quality_tier between 0 and 100),
  latency_tier integer not null default 50 check (latency_tier between 0 and 100),
  max_context_units bigint,
  metadata jsonb not null default '{}'::jsonb,
  price_effective_at timestamptz not null default now(),
  price_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_key, model_key)
);
create index if not exists compute_models_capability_idx on public.compute_models(capability, enabled);

create table if not exists public.compute_routes (
  route_key text primary key,
  capability text not null,
  model_id uuid not null references public.compute_models(id) on delete cascade,
  priority integer not null default 100,
  max_cost_microusd bigint,
  max_latency_ms integer,
  minimum_quality_tier integer not null default 0,
  data_policy text not null default 'provider_default',
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists compute_routes_selection_idx on public.compute_routes(capability, enabled, priority);

create table if not exists public.compute_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  consumer_id uuid references public.api_consumers(id) on delete set null,
  api_key_id uuid references public.api_keys(id) on delete set null,
  m_uid uuid references public.m_people(id) on delete set null,
  source_app_id uuid references public.platform_apps(id) on delete set null,
  task text not null,
  capability text not null,
  route_key text,
  provider_key text references public.compute_providers(provider_key) on update cascade,
  model_id uuid references public.compute_models(id) on delete set null,
  status text not null default 'received' check (status in ('received','reserved','queued','running','succeeded','failed','cancelled','rejected')),
  input_units numeric(20,6) not null default 0,
  output_units numeric(20,6) not null default 0,
  estimated_upstream_cost_microusd bigint not null default 0,
  actual_upstream_cost_microusd bigint not null default 0,
  retail_cost_microusd bigint not null default 0,
  credits_reserved bigint not null default 0,
  credits_charged bigint not null default 0,
  retry_count integer not null default 0,
  latency_ms integer,
  cached boolean not null default false,
  error_code text,
  error_detail jsonb,
  request_metadata jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists compute_requests_consumer_idx on public.compute_requests(consumer_id, created_at desc);
create index if not exists compute_requests_provider_idx on public.compute_requests(provider_key, model_id, created_at desc);
create index if not exists compute_requests_status_idx on public.compute_requests(status, created_at);

create table if not exists public.compute_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.compute_requests(request_id) on delete cascade,
  consumer_id uuid references public.api_consumers(id) on delete set null,
  provider_key text references public.compute_providers(provider_key) on update cascade,
  model_id uuid references public.compute_models(id) on delete set null,
  event_type text not null check (event_type in ('estimate','reserve','upstream_cost','retail_charge','refund','retry_cost','platform_cost','adjustment')),
  amount_microusd bigint not null default 0,
  credits bigint not null default 0,
  quantity numeric(20,6),
  unit text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists compute_cost_ledger_request_idx on public.compute_cost_ledger(request_id, occurred_at);
create index if not exists compute_cost_ledger_consumer_idx on public.compute_cost_ledger(consumer_id, occurred_at desc);

create table if not exists public.compute_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique references public.compute_requests(request_id) on delete cascade,
  consumer_id uuid not null references public.api_consumers(id) on delete cascade,
  reserved_credits bigint not null check (reserved_credits >= 0),
  settled_credits bigint,
  status text not null default 'reserved' check (status in ('reserved','settled','released','expired')),
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create table if not exists public.compute_provider_health (
  provider_key text not null references public.compute_providers(provider_key) on delete cascade,
  model_id uuid references public.compute_models(id) on delete cascade,
  window_start timestamptz not null,
  request_count bigint not null default 0,
  success_count bigint not null default 0,
  error_count bigint not null default 0,
  p50_latency_ms integer,
  p95_latency_ms integer,
  p99_latency_ms integer,
  estimated_availability numeric(8,6),
  metadata jsonb not null default '{}'::jsonb,
  primary key(provider_key, model_id, window_start)
);

create table if not exists public.compute_price_guards (
  capability text primary key,
  minimum_margin_bps integer not null default 1000 check (minimum_margin_bps between 0 and 9500),
  maximum_subsidy_microusd_per_request bigint not null default 0,
  require_verified_price boolean not null default true,
  stale_after interval not null default interval '7 days',
  updated_at timestamptz not null default now()
);

insert into public.compute_price_guards(capability, minimum_margin_bps, maximum_subsidy_microusd_per_request, require_verified_price)
values
 ('text',1500,0,true),('reasoning',1500,0,true),('embedding',2000,0,true),('image',2000,0,true),('video',2000,0,true),('audio',2000,0,true),('speech',2000,0,true),('transcription',2000,0,true),('music',2500,0,true),('3d',2000,0,true),('rerank',2000,0,true),('moderation',1000,0,true),('gpu',1500,0,true),('workflow',3000,0,true)
on conflict (capability) do nothing;

insert into public.compute_providers(provider_key,name,provider_type,reseller_status,supports_byok)
values
 ('mccluster-native','McCluster Native','mccluster_native','allowed',false),
 ('openai','OpenAI','frontier_api','contract_required',true),
 ('anthropic','Anthropic','frontier_api','contract_required',true),
 ('cloudflare-workers-ai','Cloudflare Workers AI','open_model_api','contract_required',true),
 ('fireworks','Fireworks AI','open_model_api','contract_required',true),
 ('together','Together AI','open_model_api','contract_required',true),
 ('fal','fal.ai','media_api','contract_required',true),
 ('replicate','Replicate','media_api','contract_required',true),
 ('tripo','Tripo AI','3d_api','contract_required',true),
 ('runpod','Runpod','gpu_cloud','contract_required',true),
 ('ovh','OVHcloud','gpu_cloud','contract_required',true)
on conflict (provider_key) do update set name=excluded.name, provider_type=excluded.provider_type, supports_byok=excluded.supports_byok;

create or replace function public.api_credit_balance(p_consumer uuid)
returns bigint language sql stable security definer set search_path=public as $$
  select coalesce(sum(delta),0)::bigint from public.api_credit_ledger where consumer_id=p_consumer;
$$;

create or replace function public.compute_credits_for_microusd(p_retail_microusd bigint)
returns bigint language sql immutable as $$
  select greatest(0, ceil(p_retail_microusd::numeric / 1000.0)::bigint);
$$;

create or replace function public.compute_retail_microusd(p_upstream_microusd bigint, p_margin_bps integer)
returns bigint language plpgsql immutable as $$
declare denom numeric;
begin
  if p_upstream_microusd <= 0 then return 0; end if;
  if p_margin_bps < 0 or p_margin_bps >= 10000 then raise exception 'invalid margin'; end if;
  denom := 1 - (p_margin_bps::numeric/10000.0);
  return ceil(p_upstream_microusd::numeric / denom)::bigint;
end;
$$;

create or replace function public.compute_reserve_credits(
  p_request_id text,p_consumer_id uuid,p_api_key_id uuid,p_task text,p_capability text,
  p_estimated_upstream_cost_microusd bigint,p_target_margin_bps integer default 2500,
  p_source_app_id uuid default null,p_m_uid uuid default null,p_metadata jsonb default '{}'::jsonb
) returns table(request_uuid uuid,reserved_credits bigint,balance_after_reservation bigint)
language plpgsql security definer set search_path=public as $$
declare v_retail bigint; v_credits bigint; v_balance bigint; v_id uuid;
begin
  if p_request_id is null or length(p_request_id)<8 then raise exception 'invalid request id'; end if;
  if p_estimated_upstream_cost_microusd<0 then raise exception 'invalid estimated cost'; end if;
  select public.compute_retail_microusd(p_estimated_upstream_cost_microusd,p_target_margin_bps) into v_retail;
  select greatest(1,public.compute_credits_for_microusd(v_retail)) into v_credits;
  perform pg_advisory_xact_lock(hashtextextended(p_consumer_id::text,0));
  select public.api_credit_balance(p_consumer_id) into v_balance;
  if v_balance<v_credits then raise exception 'insufficient credits'; end if;
  insert into public.compute_requests(request_id,consumer_id,api_key_id,m_uid,source_app_id,task,capability,status,estimated_upstream_cost_microusd,retail_cost_microusd,credits_reserved,request_metadata)
  values(p_request_id,p_consumer_id,p_api_key_id,p_m_uid,p_source_app_id,p_task,p_capability,'reserved',p_estimated_upstream_cost_microusd,v_retail,v_credits,coalesce(p_metadata,'{}'::jsonb))
  on conflict(request_id) do update set request_id=excluded.request_id returning id into v_id;
  if not exists(select 1 from public.compute_credit_reservations where request_id=p_request_id) then
    insert into public.api_credit_ledger(consumer_id,delta,reason,reference_type,reference_id,metadata)
    values(p_consumer_id,-v_credits,'compute_reservation','compute_request',p_request_id,jsonb_build_object('state','reserved'));
    insert into public.compute_credit_reservations(request_id,consumer_id,reserved_credits) values(p_request_id,p_consumer_id,v_credits);
    insert into public.compute_cost_ledger(request_id,consumer_id,event_type,amount_microusd,credits,metadata)
    values(p_request_id,p_consumer_id,'reserve',v_retail,v_credits,jsonb_build_object('estimated_upstream_microusd',p_estimated_upstream_cost_microusd));
  end if;
  select public.api_credit_balance(p_consumer_id) into v_balance;
  return query select v_id,v_credits,v_balance;
end;
$$;

create or replace function public.compute_settle_request(
  p_request_id text,p_status text,p_provider_key text default null,p_model_id uuid default null,
  p_input_units numeric default 0,p_output_units numeric default 0,p_actual_upstream_cost_microusd bigint default 0,
  p_target_margin_bps integer default 2500,p_latency_ms integer default null,p_cached boolean default false,
  p_retry_count integer default 0,p_response_metadata jsonb default '{}'::jsonb,p_error_code text default null,p_error_detail jsonb default null
) returns table(charged_credits bigint,released_credits bigint,gross_margin_bps integer)
language plpgsql security definer set search_path=public as $$
declare v_req public.compute_requests%rowtype; v_res public.compute_credit_reservations%rowtype; v_retail bigint; v_charge bigint; v_release bigint; v_margin integer;
begin
  if p_status not in ('succeeded','failed','cancelled','rejected') then raise exception 'invalid settlement status'; end if;
  select * into v_req from public.compute_requests where request_id=p_request_id for update; if not found then raise exception 'request not found'; end if;
  select * into v_res from public.compute_credit_reservations where request_id=p_request_id for update; if not found then raise exception 'reservation not found'; end if;
  if v_res.status='settled' then
    return query select coalesce(v_res.settled_credits,0),0,case when v_req.retail_cost_microusd>0 then round(((v_req.retail_cost_microusd-v_req.actual_upstream_cost_microusd)::numeric/v_req.retail_cost_microusd)*10000)::int else 0 end; return;
  end if;
  if p_status='succeeded' then
    v_retail:=public.compute_retail_microusd(greatest(0,p_actual_upstream_cost_microusd),p_target_margin_bps);
    v_charge:=greatest(1,public.compute_credits_for_microusd(v_retail));
  else v_retail:=0; v_charge:=0; end if;
  v_release:=greatest(0,v_res.reserved_credits-v_charge);
  if v_charge>v_res.reserved_credits then
    perform pg_advisory_xact_lock(hashtextextended(v_req.consumer_id::text,0));
    if public.api_credit_balance(v_req.consumer_id)<(v_charge-v_res.reserved_credits) then raise exception 'insufficient credits to settle'; end if;
    insert into public.api_credit_ledger(consumer_id,delta,reason,reference_type,reference_id,metadata)
    values(v_req.consumer_id,-(v_charge-v_res.reserved_credits),'compute_settlement_overage','compute_request',p_request_id,'{}'::jsonb);
  elsif v_release>0 then
    insert into public.api_credit_ledger(consumer_id,delta,reason,reference_type,reference_id,metadata)
    values(v_req.consumer_id,v_release,'compute_reservation_release','compute_request',p_request_id,'{}'::jsonb);
  end if;
  update public.compute_credit_reservations set settled_credits=v_charge,status='settled',settled_at=now() where request_id=p_request_id;
  update public.compute_requests set status=p_status,provider_key=p_provider_key,model_id=p_model_id,input_units=coalesce(p_input_units,0),output_units=coalesce(p_output_units,0),actual_upstream_cost_microusd=greatest(0,p_actual_upstream_cost_microusd),retail_cost_microusd=v_retail,credits_charged=v_charge,latency_ms=p_latency_ms,cached=coalesce(p_cached,false),retry_count=greatest(0,coalesce(p_retry_count,0)),response_metadata=coalesce(p_response_metadata,'{}'::jsonb),error_code=p_error_code,error_detail=p_error_detail,completed_at=now() where request_id=p_request_id;
  insert into public.compute_cost_ledger(request_id,consumer_id,provider_key,model_id,event_type,amount_microusd,credits,quantity,unit,metadata)
  values(p_request_id,v_req.consumer_id,p_provider_key,p_model_id,'upstream_cost',greatest(0,p_actual_upstream_cost_microusd),0,coalesce(p_input_units,0)+coalesce(p_output_units,0),'provider_units',jsonb_build_object('status',p_status));
  insert into public.compute_cost_ledger(request_id,consumer_id,provider_key,model_id,event_type,amount_microusd,credits,metadata)
  values(p_request_id,v_req.consumer_id,p_provider_key,p_model_id,'retail_charge',v_retail,v_charge,jsonb_build_object('status',p_status));
  if v_retail>0 then v_margin:=round(((v_retail-greatest(0,p_actual_upstream_cost_microusd))::numeric/v_retail)*10000)::int; else v_margin:=0; end if;
  return query select v_charge,v_release,v_margin;
end;
$$;

revoke all on function public.api_credit_balance(uuid) from public,anon,authenticated;
revoke all on function public.compute_reserve_credits(text,uuid,uuid,text,text,bigint,integer,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.compute_settle_request(text,text,text,uuid,numeric,numeric,bigint,integer,integer,boolean,integer,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.api_credit_balance(uuid) to service_role;
grant execute on function public.compute_reserve_credits(text,uuid,uuid,text,text,bigint,integer,uuid,uuid,jsonb) to service_role;
grant execute on function public.compute_settle_request(text,text,text,uuid,numeric,numeric,bigint,integer,integer,boolean,integer,jsonb,text,jsonb) to service_role;

alter table public.compute_providers enable row level security;
alter table public.compute_models enable row level security;
alter table public.compute_routes enable row level security;
alter table public.compute_requests enable row level security;
alter table public.compute_cost_ledger enable row level security;
alter table public.compute_credit_reservations enable row level security;
alter table public.compute_provider_health enable row level security;
alter table public.compute_price_guards enable row level security;
revoke all on public.compute_requests,public.compute_cost_ledger,public.compute_credit_reservations,public.compute_provider_health from anon,authenticated;
grant select on public.compute_providers, public.compute_models to authenticated;
