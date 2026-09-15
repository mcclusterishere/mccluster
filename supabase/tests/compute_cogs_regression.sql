\set ON_ERROR_STOP on
begin;

do $test$
declare
  v_model uuid;
  v_cost bigint;
  v_basis text;
  v_cached_cost bigint;
  v_cached_basis text;
begin
  select id into v_model
  from public.compute_models
  where provider_key='openai' and model_key='gpt-5.6-terra'
  limit 1;

  if v_model is null then
    raise exception 'benchmark OpenAI model missing';
  end if;

  select actual_upstream_microusd, cost_basis->>'basis'
    into v_cost, v_basis
  from public.compute_actual_model_cost(v_model,1000,100,1,0);

  if v_cost <> 3200 then
    raise exception 'expected 3200 microusd, got %', v_cost;
  end if;
  if v_basis <> 'provider_usage_exact_configured_rate' then
    raise exception 'unexpected exact cost basis: %', v_basis;
  end if;

  select actual_upstream_microusd, cost_basis->>'basis'
    into v_cached_cost, v_cached_basis
  from public.compute_actual_model_cost(v_model,1000,100,1,500);

  if v_cached_cost <> 3200 then
    raise exception 'cached conservative cost changed unexpectedly: %', v_cached_cost;
  end if;
  if v_cached_basis <> 'provider_usage_conservative_cached_at_full_rate' then
    raise exception 'unexpected cached cost basis: %', v_cached_basis;
  end if;

  if has_function_privilege('anon','public.compute_actual_model_cost(uuid,numeric,numeric,numeric,numeric)','EXECUTE') then
    raise exception 'anon must not execute compute_actual_model_cost';
  end if;
  if has_function_privilege('authenticated','public.compute_actual_model_cost(uuid,numeric,numeric,numeric,numeric)','EXECUTE') then
    raise exception 'authenticated must not execute compute_actual_model_cost';
  end if;
  if not has_function_privilege('service_role','public.compute_actual_model_cost(uuid,numeric,numeric,numeric,numeric)','EXECUTE') then
    raise exception 'service_role must execute compute_actual_model_cost';
  end if;

  raise notice 'compute_cogs_regression: PASS';
end;
$test$;

rollback;
