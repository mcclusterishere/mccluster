\set ON_ERROR_STOP on
begin;

do $test$
declare
  v_person uuid;
  v_consumer uuid;
  v_key uuid;
  v_allowed boolean;
  v_limit integer;
  v_consumer_count bigint;
  v_key_count bigint;
  v_remaining integer;
  v_reset_at timestamptz;
begin
  insert into public.m_people default values returning id into v_person;

  insert into public.api_consumers(owner_m_uid,name,slug,plan_code,monthly_credit_limit,settings)
  values(v_person,'Rate Limit Regression','rate-limit-'||substr(gen_random_uuid()::text,1,8),'developer',1000,'{}'::jsonb)
  returning id into v_consumer;

  insert into public.api_keys(consumer_id,key_prefix,secret_hash,name,scopes)
  values(v_consumer,'mcc_test_rate_ci','hash-rate-'||gen_random_uuid()::text,'rate-limit-regression',array['mnet:read'])
  returning id into v_key;

  update public.api_plans set rate_limit_per_minute=2 where plan_code='developer';

  select allowed,limit_per_minute,consumer_count,key_count,remaining,reset_at
    into v_allowed,v_limit,v_consumer_count,v_key_count,v_remaining,v_reset_at
  from public.api_enforce_rate_limit(v_consumer,v_key,'GET /v1/mnet/feed');
  if not v_allowed or v_limit <> 2 or v_consumer_count <> 1 or v_key_count <> 1 or v_remaining <> 1 then
    raise exception 'first rate-limit attempt mismatch';
  end if;

  select allowed,limit_per_minute,consumer_count,key_count,remaining,reset_at
    into v_allowed,v_limit,v_consumer_count,v_key_count,v_remaining,v_reset_at
  from public.api_enforce_rate_limit(v_consumer,v_key,'GET /v1/mnet/feed');
  if not v_allowed or v_consumer_count <> 2 or v_key_count <> 2 or v_remaining <> 0 then
    raise exception 'second rate-limit attempt mismatch';
  end if;

  select allowed,limit_per_minute,consumer_count,key_count,remaining,reset_at
    into v_allowed,v_limit,v_consumer_count,v_key_count,v_remaining,v_reset_at
  from public.api_enforce_rate_limit(v_consumer,v_key,'GET /v1/mnet/feed');
  if v_allowed or v_consumer_count <> 3 or v_key_count <> 3 or v_remaining <> 0 then
    raise exception 'third rate-limit attempt should be rejected';
  end if;

  if has_function_privilege('anon','public.api_enforce_rate_limit(uuid,uuid,text)','EXECUTE') then
    raise exception 'anon unexpectedly has rate-limit RPC execution';
  end if;
  if has_function_privilege('authenticated','public.api_enforce_rate_limit(uuid,uuid,text)','EXECUTE') then
    raise exception 'authenticated unexpectedly has rate-limit RPC execution';
  end if;
  if not has_function_privilege('service_role','public.api_enforce_rate_limit(uuid,uuid,text)','EXECUTE') then
    raise exception 'service_role is missing rate-limit RPC execution';
  end if;

  raise notice 'api_rate_limit_regression: PASS';
end;
$test$;

rollback;
