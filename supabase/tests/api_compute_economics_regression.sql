\set ON_ERROR_STOP on
begin;

-- This suite is destructive by design but always rolls back. It is safe to run
-- against an isolated local Supabase database and can also be used for a manual
-- production smoke test because no rows survive the transaction.

do $test$
declare
  v_person_a uuid;
  v_person_b uuid;
  v_consumer_a uuid;
  v_consumer_b uuid;
  v_consumer_low uuid;
  v_consumer_monthly uuid;
  v_consumer_spend uuid;
  v_key_a uuid;
  v_key_b uuid;
  v_req_a uuid;
  v_req_retry uuid;
  v_reserved bigint;
  v_balance bigint;
  v_before bigint;
  v_after bigint;
  v_charged bigint;
  v_released bigint;
  v_margin integer;
  v_error text;
begin
  insert into public.m_people default values returning id into v_person_a;
  insert into public.m_people default values returning id into v_person_b;

  insert into public.api_consumers(owner_m_uid,name,slug,plan_code,monthly_credit_limit,settings)
  values(v_person_a,'Regression A','regression-a-'||substr(gen_random_uuid()::text,1,8),'developer',100000,'{}')
  returning id into v_consumer_a;

  insert into public.api_consumers(owner_m_uid,name,slug,plan_code,monthly_credit_limit,settings)
  values(v_person_b,'Regression B','regression-b-'||substr(gen_random_uuid()::text,1,8),'developer',100000,'{}')
  returning id into v_consumer_b;

  insert into public.api_keys(consumer_id,key_prefix,secret_hash,name,scopes)
  values(v_consumer_a,'mcc_test_reg_a','hash-a-'||gen_random_uuid()::text,'regression-a',array['compute:read','compute:write'])
  returning id into v_key_a;

  insert into public.api_keys(consumer_id,key_prefix,secret_hash,name,scopes)
  values(v_consumer_b,'mcc_test_reg_b','hash-b-'||gen_random_uuid()::text,'regression-b',array['compute:read','compute:write'])
  returning id into v_key_b;

  insert into public.api_credit_ledger(consumer_id,delta,reason,reference_type,reference_id)
  values(v_consumer_a,1000,'regression_grant','test','suite'),
        (v_consumer_b,1000,'regression_grant','test','suite');

  -- 1. Reservation + same-principal idempotent retry.
  select request_uuid,reserved_credits,balance_after_reservation
    into v_req_a,v_reserved,v_balance
  from public.compute_reserve_credits(
    'regression-idempotent',v_consumer_a,v_key_a,'chat','reasoning',7000,2000,null,null,'{}'::jsonb
  );

  if v_reserved <> 9 then
    raise exception 'expected 9 reserved credits, got %', v_reserved;
  end if;
  if v_balance <> 991 then
    raise exception 'expected balance 991 after reservation, got %', v_balance;
  end if;

  select request_uuid,reserved_credits,balance_after_reservation
    into v_req_retry,v_reserved,v_after
  from public.compute_reserve_credits(
    'regression-idempotent',v_consumer_a,v_key_a,'chat','reasoning',7000,2000,null,null,'{}'::jsonb
  );

  if v_req_retry <> v_req_a then
    raise exception 'idempotent retry created a different request';
  end if;
  if v_after <> 991 then
    raise exception 'idempotent retry double-charged credits: balance %', v_after;
  end if;

  -- 2. Cross-tenant collision must fail closed.
  begin
    perform * from public.compute_reserve_credits(
      'regression-idempotent',v_consumer_b,v_key_b,'chat','reasoning',7000,2000,null,null,'{}'::jsonb
    );
    raise exception 'cross-tenant idempotency collision unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if position('idempotency key conflict' in lower(v_error)) = 0 then
      raise exception 'unexpected cross-tenant error: %', v_error;
    end if;
  end;

  -- 3. Settlement must charge actual use and refund the unused reservation.
  select charged_credits,released_credits,gross_margin_bps
    into v_charged,v_released,v_margin
  from public.compute_settle_request(
    'regression-idempotent','succeeded',null,null,0,0,1000,2000,null,false,0,'{}'::jsonb,null,null
  );

  if v_charged <> 2 or v_released <> 7 then
    raise exception 'expected settlement charge/refund 2/7, got %/%', v_charged,v_released;
  end if;
  select public.api_credit_balance(v_consumer_a) into v_after;
  if v_after <> 998 then
    raise exception 'expected post-settlement balance 998, got %', v_after;
  end if;

  -- 4. Failed zero-cost work must release the complete reservation.
  select public.api_credit_balance(v_consumer_a) into v_before;
  perform * from public.compute_reserve_credits(
    'regression-failed',v_consumer_a,v_key_a,'chat','reasoning',7000,2000,null,null,'{}'::jsonb
  );
  select charged_credits,released_credits,gross_margin_bps
    into v_charged,v_released,v_margin
  from public.compute_settle_request(
    'regression-failed','failed',null,null,0,0,0,2000,null,false,0,'{}'::jsonb,'upstream_failed',jsonb_build_object('test',true)
  );
  select public.api_credit_balance(v_consumer_a) into v_after;
  if v_charged <> 0 or v_released <> 9 or v_after <> v_before then
    raise exception 'failed-work billing incorrect charged=% released=% before=% after=%',v_charged,v_released,v_before,v_after;
  end if;

  -- 5. Insufficient credits must reject before work can execute.
  insert into public.api_consumers(owner_m_uid,name,slug,plan_code,monthly_credit_limit,settings)
  values(v_person_a,'Regression Low','regression-low-'||substr(gen_random_uuid()::text,1,8),'developer',100000,'{}')
  returning id into v_consumer_low;
  insert into public.api_credit_ledger(consumer_id,delta,reason,reference_type,reference_id)
  values(v_consumer_low,1,'regression_grant','test','suite');
  begin
    perform * from public.api_reserve_usage('regression-insufficient',v_consumer_low,null,'mnet.read','/v1/mnet/feed','GET',2,'{}'::jsonb);
    raise exception 'insufficient-credit reservation unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if position('insufficient' in lower(v_error)) = 0 then
      raise exception 'unexpected insufficient-credit error: %',v_error;
    end if;
  end;

  -- 6. Self-service scope escalation must be impossible at the DB boundary.
  begin
    insert into public.api_keys(consumer_id,key_prefix,secret_hash,name,scopes)
    values(v_consumer_a,'mcc_test_bad','hash-bad-'||gen_random_uuid()::text,'bad-scope',array['*']);
    raise exception 'wildcard API key scope unexpectedly accepted';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if position('scope' in lower(v_error)) = 0 then
      raise exception 'unexpected scope rejection error: %',v_error;
    end if;
  end;

  -- 7. Monthly allowance must reject additional reservations when overage is off.
  insert into public.api_consumers(owner_m_uid,name,slug,plan_code,monthly_credit_limit,settings)
  values(v_person_a,'Regression Monthly','regression-monthly-'||substr(gen_random_uuid()::text,1,8),'developer',1,'{}')
  returning id into v_consumer_monthly;
  insert into public.api_credit_ledger(consumer_id,delta,reason,reference_type,reference_id)
  values(v_consumer_monthly,100,'regression_grant','test','suite');
  perform * from public.api_reserve_usage('regression-monthly-1',v_consumer_monthly,null,'mnet.read','/v1/mnet/feed','GET',1,'{}'::jsonb);
  begin
    perform * from public.api_reserve_usage('regression-monthly-2',v_consumer_monthly,null,'mnet.read','/v1/mnet/feed','GET',1,'{}'::jsonb);
    raise exception 'monthly allowance overflow unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if position('monthly credit allowance exceeded' in lower(v_error)) = 0 then
      raise exception 'unexpected monthly allowance error: %',v_error;
    end if;
  end;

  -- 8. Hard spend ceiling must reject overage even if overage is enabled.
  update public.api_plans
     set overage_price_per_1000_credits_cents=100
   where plan_code='developer';

  insert into public.api_consumers(owner_m_uid,name,slug,plan_code,monthly_credit_limit,hard_spend_limit_cents,settings)
  values(v_person_a,'Regression Spend','regression-spend-'||substr(gen_random_uuid()::text,1,8),'developer',1,0,'{"allow_overage":true}'::jsonb)
  returning id into v_consumer_spend;
  insert into public.api_credit_ledger(consumer_id,delta,reason,reference_type,reference_id)
  values(v_consumer_spend,100,'regression_grant','test','suite');
  perform * from public.api_reserve_usage('regression-spend-1',v_consumer_spend,null,'mnet.read','/v1/mnet/feed','GET',1,'{}'::jsonb);
  begin
    perform * from public.api_reserve_usage('regression-spend-2',v_consumer_spend,null,'mnet.read','/v1/mnet/feed','GET',1,'{}'::jsonb);
    raise exception 'hard spend ceiling unexpectedly allowed overage';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if position('hard spend limit exceeded' in lower(v_error)) = 0 then
      raise exception 'unexpected hard-spend error: %',v_error;
    end if;
  end;

  raise notice 'api_compute_economics_regression: PASS';
end;
$test$;

rollback;
