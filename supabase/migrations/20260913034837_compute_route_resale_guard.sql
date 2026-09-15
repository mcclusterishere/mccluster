-- McCluster Compute Gateway: do not route BYOK-only or contract-required providers
-- through McCluster-owned provider credentials.
--
-- BYOK must be a separate execution path backed by a customer-owned credential
-- reference. Until that exists, only reseller_status='allowed' providers may be
-- selected for commercial execution.

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
)
returns table(
  model_id uuid,
  provider_key text,
  model_key text,
  estimated_upstream_microusd bigint,
  estimated_retail_microusd bigint,
  estimated_credits bigint,
  target_margin_bps integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record;
  est record;
  candidates integer := 0;
begin
  for rec in
    select
      m.*,
      r.route_key,
      r.priority,
      r.max_cost_microusd route_max_cost,
      r.max_latency_ms route_max_latency,
      r.data_policy route_data_policy
    from public.compute_routes r
    join public.compute_models m on m.id = r.model_id
    join public.compute_providers p on p.provider_key = m.provider_key
    where r.enabled = true
      and m.enabled = true
      and p.status = 'available'
      and p.reseller_status = 'allowed'
      and m.capability = p_capability
      and m.quality_tier >= coalesce(p_min_quality, 0)
      and (
        p_max_latency_ms is null
        or r.max_latency_ms is null
        or r.max_latency_ms <= p_max_latency_ms
      )
      and (
        p_data_policy is null
        or r.data_policy = p_data_policy
        or r.data_policy = 'provider_default'
      )
    order by r.priority asc, m.quality_tier desc, m.latency_tier desc
  loop
    candidates := candidates + 1;

    begin
      select * into est
      from public.compute_estimate_model_cost(
        rec.id,
        p_input_units,
        p_output_units,
        p_quantity
      );
    exception when others then
      continue;
    end;

    if p_max_cost_microusd is not null
       and est.retail_microusd > p_max_cost_microusd then
      continue;
    end if;

    if rec.route_max_cost is not null
       and est.retail_microusd > rec.route_max_cost then
      continue;
    end if;

    insert into public.compute_route_decisions(
      request_id,
      consumer_id,
      capability,
      requested_policy,
      selected_model_id,
      selected_provider_key,
      candidate_count,
      estimated_upstream_cost_microusd,
      estimated_retail_microusd,
      estimated_credits,
      reason
    ) values (
      p_request_id,
      p_consumer_id,
      p_capability,
      jsonb_build_object(
        'max_cost_microusd', p_max_cost_microusd,
        'max_latency_ms', p_max_latency_ms,
        'min_quality', p_min_quality,
        'data_policy', p_data_policy
      ),
      rec.id,
      rec.provider_key,
      candidates,
      est.upstream_microusd,
      est.retail_microusd,
      est.credits,
      jsonb_build_object(
        'route_key', rec.route_key,
        'priority', rec.priority,
        'commercial_execution', 'reseller_allowed_only'
      )
    );

    return query
      select
        rec.id,
        rec.provider_key,
        rec.model_key,
        est.upstream_microusd,
        est.retail_microusd,
        est.credits,
        est.target_margin_bps;
    return;
  end loop;

  raise exception 'no commercially eligible route';
end;
$function$;

revoke execute on function public.compute_select_route(
  text, uuid, text, numeric, numeric, numeric, bigint, integer, integer, text
) from public, anon, authenticated;
