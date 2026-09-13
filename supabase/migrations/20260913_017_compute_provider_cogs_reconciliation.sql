create or replace function public.compute_actual_model_cost(
  p_model_id uuid,
  p_input_units numeric default 0,
  p_output_units numeric default 0,
  p_quantity numeric default 1,
  p_cached_input_units numeric default 0
)
returns table(
  actual_upstream_microusd bigint,
  billing_unit text,
  price_effective_at timestamptz,
  price_verified_at timestamptz,
  cost_basis jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  m public.compute_models%rowtype;
  v_input numeric := greatest(0, coalesce(p_input_units,0));
  v_output numeric := greatest(0, coalesce(p_output_units,0));
  v_quantity numeric := greatest(0, coalesce(p_quantity,1));
  v_cached numeric := greatest(0, least(coalesce(p_cached_input_units,0), greatest(0, coalesce(p_input_units,0))));
  v_uncached numeric;
  v_cached_rate numeric;
  v_cost numeric;
  v_basis text;
begin
  select * into m from public.compute_models where id = p_model_id;
  if not found then raise exception 'model not found'; end if;

  v_uncached := v_input - v_cached;
  if m.metadata ? 'cached_input_microusd_per_unit' then
    v_cached_rate := greatest(0, (m.metadata->>'cached_input_microusd_per_unit')::numeric);
    v_basis := 'provider_usage_with_cached_rate';
  else
    v_cached_rate := m.upstream_input_microusd_per_unit;
    v_basis := case when v_cached > 0 then 'provider_usage_conservative_cached_at_full_rate' else 'provider_usage_exact_configured_rate' end;
  end if;

  v_cost :=
      v_uncached * m.upstream_input_microusd_per_unit
    + v_cached * v_cached_rate
    + v_output * m.upstream_output_microusd_per_unit
    + v_quantity * m.upstream_flat_microusd;

  return query
  select
    ceil(v_cost)::bigint,
    m.billing_unit,
    m.price_effective_at,
    m.price_verified_at,
    jsonb_build_object(
      'basis', v_basis,
      'provider_key', m.provider_key,
      'model_key', m.model_key,
      'input_units', v_input,
      'cached_input_units', v_cached,
      'output_units', v_output,
      'quantity', v_quantity,
      'input_rate_microusd_per_unit', m.upstream_input_microusd_per_unit,
      'cached_input_rate_microusd_per_unit', v_cached_rate,
      'output_rate_microusd_per_unit', m.upstream_output_microusd_per_unit,
      'flat_rate_microusd', m.upstream_flat_microusd,
      'price_effective_at', m.price_effective_at,
      'price_verified_at', m.price_verified_at
    );
end;
$$;

revoke all on function public.compute_actual_model_cost(uuid,numeric,numeric,numeric,numeric) from public, anon, authenticated;
grant execute on function public.compute_actual_model_cost(uuid,numeric,numeric,numeric,numeric) to service_role;
