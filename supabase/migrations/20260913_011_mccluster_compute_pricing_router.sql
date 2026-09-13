-- Cost-aware routing and pricing history for McCluster Compute.

create table if not exists public.compute_model_price_history (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.compute_models(id) on delete cascade,
  upstream_input_microusd_per_unit numeric(20,8) not null default 0,
  upstream_output_microusd_per_unit numeric(20,8) not null default 0,
  upstream_flat_microusd numeric(20,8) not null default 0,
  billing_unit text not null,
  source_url text,
  source_type text not null default 'official' check (source_type in ('official','contract','manual','estimate')),
  verified_at timestamptz,
  effective_at timestamptz not null default now(),
  retired_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists compute_model_price_history_model_idx on public.compute_model_price_history(model_id,effective_at desc);

create table if not exists public.compute_route_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  consumer_id uuid references public.api_consumers(id) on delete set null,
  capability text not null,
  requested_policy jsonb not null default '{}'::jsonb,
  selected_model_id uuid references public.compute_models(id) on delete set null,
  selected_provider_key text references public.compute_providers(provider_key) on update cascade,
  candidate_count integer not null default 0,
  estimated_upstream_cost_microusd bigint not null default 0,
  estimated_retail_microusd bigint not null default 0,
  estimated_credits bigint not null default 0,
  reason jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists compute_route_decisions_request_idx on public.compute_route_decisions(request_id);

create or replace function public.compute_estimate_model_cost(
 p_model_id uuid,
 p_input_units numeric default 0,
 p_output_units numeric default 0,
 p_quantity numeric default 1
) returns table(upstream_microusd bigint,retail_microusd bigint,credits bigint,target_margin_bps integer,price_verified_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare m public.compute_models%rowtype; g public.compute_price_guards%rowtype; u numeric; r bigint; c bigint;
begin
 select * into m from public.compute_models where id=p_model_id; if not found then raise exception 'model not found'; end if;
 select * into g from public.compute_price_guards where capability=m.capability;
 if coalesce(g.require_verified_price,false) and (m.price_verified_at is null or m.price_verified_at < now()-coalesce(g.stale_after,interval '7 days')) then raise exception 'provider price is stale or unverified'; end if;
 u := greatest(0,coalesce(p_input_units,0))*m.upstream_input_microusd_per_unit + greatest(0,coalesce(p_output_units,0))*m.upstream_output_microusd_per_unit + greatest(0,coalesce(p_quantity,1))*m.upstream_flat_microusd;
 r := public.compute_retail_microusd(ceil(u)::bigint,greatest(m.target_margin_bps,coalesce(g.minimum_margin_bps,0)));
 c := greatest(m.minimum_charge_credits,public.compute_credits_for_microusd(r));
 return query select ceil(u)::bigint,r,c,greatest(m.target_margin_bps,coalesce(g.minimum_margin_bps,0)),m.price_verified_at;
end;
$$;

create or replace function public.compute_select_route(
 p_request_id text,
 p_consumer_id uuid,
 p_capability text,
 p_input_units numeric default 0,
 p_output_units numeric default 0,
 p_quantity numeric default 1,
 p_max_cost_microusd bigint default null,
 p_max_latency_ms integer default null,
 p_min_quality integer default 0,
 p_data_policy text default null
) returns table(model_id uuid,provider_key text,model_key text,estimated_upstream_microusd bigint,estimated_retail_microusd bigint,estimated_credits bigint,target_margin_bps integer)
language plpgsql security definer set search_path=public as $$
declare rec record; est record; candidates integer:=0;
begin
 for rec in
  select m.*,r.route_key,r.priority,r.max_cost_microusd route_max_cost,r.max_latency_ms route_max_latency,r.data_policy route_data_policy
  from public.compute_routes r
  join public.compute_models m on m.id=r.model_id
  join public.compute_providers p on p.provider_key=m.provider_key
  where r.enabled=true and m.enabled=true and p.status='available' and m.capability=p_capability
    and m.quality_tier>=coalesce(p_min_quality,0)
    and (p_max_latency_ms is null or r.max_latency_ms is null or r.max_latency_ms<=p_max_latency_ms)
    and (p_data_policy is null or r.data_policy=p_data_policy or r.data_policy='provider_default')
  order by r.priority asc,m.quality_tier desc,m.latency_tier desc
 loop
  candidates:=candidates+1;
  begin
   select * into est from public.compute_estimate_model_cost(rec.id,p_input_units,p_output_units,p_quantity);
  exception when others then continue; end;
  if p_max_cost_microusd is not null and est.retail_microusd>p_max_cost_microusd then continue; end if;
  if rec.route_max_cost is not null and est.retail_microusd>rec.route_max_cost then continue; end if;
  insert into public.compute_route_decisions(request_id,consumer_id,capability,requested_policy,selected_model_id,selected_provider_key,candidate_count,estimated_upstream_cost_microusd,estimated_retail_microusd,estimated_credits,reason)
  values(p_request_id,p_consumer_id,p_capability,jsonb_build_object('max_cost_microusd',p_max_cost_microusd,'max_latency_ms',p_max_latency_ms,'min_quality',p_min_quality,'data_policy',p_data_policy),rec.id,rec.provider_key,candidates,est.upstream_microusd,est.retail_microusd,est.credits,jsonb_build_object('route_key',rec.route_key,'priority',rec.priority));
  return query select rec.id,rec.provider_key,rec.model_key,est.upstream_microusd,est.retail_microusd,est.credits,est.target_margin_bps;
  return;
 end loop;
 raise exception 'no eligible route';
end;
$$;

revoke all on function public.compute_estimate_model_cost(uuid,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.compute_select_route(text,uuid,text,numeric,numeric,numeric,bigint,integer,integer,text) from public,anon,authenticated;
grant execute on function public.compute_estimate_model_cost(uuid,numeric,numeric,numeric) to service_role;
grant execute on function public.compute_select_route(text,uuid,text,numeric,numeric,numeric,bigint,integer,integer,text) to service_role;

alter table public.compute_model_price_history enable row level security;
alter table public.compute_route_decisions enable row level security;
revoke all on public.compute_model_price_history,public.compute_route_decisions from anon,authenticated;
