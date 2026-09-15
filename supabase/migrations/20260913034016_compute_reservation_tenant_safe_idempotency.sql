-- McCluster Compute Gateway: tenant-safe idempotency reservation.
-- A request_id is globally unique and permanently bound to the consumer/API key
-- that first reserved it. Same-principal retries are idempotent; cross-principal
-- collisions fail closed instead of reusing another tenant's request.

create or replace function public.compute_reserve_credits(
  p_request_id text,
  p_consumer_id uuid,
  p_api_key_id uuid,
  p_task text,
  p_capability text,
  p_estimated_upstream_cost_microusd bigint,
  p_target_margin_bps integer default 2500,
  p_source_app_id uuid default null,
  p_m_uid uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(request_uuid uuid, reserved_credits bigint, balance_after_reservation bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_retail bigint;
  v_credits bigint;
  v_balance bigint;
  v_id uuid;
  v_existing public.compute_requests%rowtype;
  v_existing_res public.compute_credit_reservations%rowtype;
begin
  if p_request_id is null or length(p_request_id) < 8 then
    raise exception 'invalid request id';
  end if;
  if p_estimated_upstream_cost_microusd < 0 then
    raise exception 'invalid estimated cost';
  end if;

  -- Serialize every use of the idempotency key globally before reading it.
  perform pg_advisory_xact_lock(hashtextextended('compute-request:' || p_request_id, 0));

  select * into v_existing
  from public.compute_requests
  where request_id = p_request_id
  for update;

  if found then
    -- Never reuse or disclose a request belonging to another tenant/key.
    if v_existing.consumer_id is distinct from p_consumer_id
       or v_existing.api_key_id is distinct from p_api_key_id then
      raise exception 'idempotency key conflict';
    end if;

    -- The same principal may retry, but cannot repurpose the key for another job.
    if v_existing.task is distinct from p_task
       or v_existing.capability is distinct from p_capability
       or v_existing.source_app_id is distinct from p_source_app_id
       or v_existing.m_uid is distinct from p_m_uid then
      raise exception 'idempotency key reused with different request';
    end if;

    select * into v_existing_res
    from public.compute_credit_reservations
    where request_id = p_request_id
    for update;

    if not found then
      raise exception 'idempotency state inconsistent';
    end if;

    select public.api_credit_balance(p_consumer_id) into v_balance;
    return query
      select v_existing.id, v_existing_res.reserved_credits, v_balance;
    return;
  end if;

  select public.compute_retail_microusd(
    p_estimated_upstream_cost_microusd,
    p_target_margin_bps
  ) into v_retail;
  select greatest(1, public.compute_credits_for_microusd(v_retail)) into v_credits;

  -- Serialize balance mutation separately for the owning consumer.
  perform pg_advisory_xact_lock(hashtextextended('compute-consumer:' || p_consumer_id::text, 0));
  select public.api_credit_balance(p_consumer_id) into v_balance;
  if v_balance < v_credits then
    raise exception 'insufficient credits';
  end if;

  insert into public.compute_requests(
    request_id,
    consumer_id,
    api_key_id,
    m_uid,
    source_app_id,
    task,
    capability,
    status,
    estimated_upstream_cost_microusd,
    retail_cost_microusd,
    credits_reserved,
    request_metadata
  ) values (
    p_request_id,
    p_consumer_id,
    p_api_key_id,
    p_m_uid,
    p_source_app_id,
    p_task,
    p_capability,
    'reserved',
    p_estimated_upstream_cost_microusd,
    v_retail,
    v_credits,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;

  insert into public.api_credit_ledger(
    consumer_id, delta, reason, reference_type, reference_id, metadata
  ) values (
    p_consumer_id,
    -v_credits,
    'compute_reservation',
    'compute_request',
    p_request_id,
    jsonb_build_object('state', 'reserved')
  );

  insert into public.compute_credit_reservations(
    request_id, consumer_id, reserved_credits
  ) values (
    p_request_id, p_consumer_id, v_credits
  );

  insert into public.compute_cost_ledger(
    request_id,
    consumer_id,
    event_type,
    amount_microusd,
    credits,
    metadata
  ) values (
    p_request_id,
    p_consumer_id,
    'reserve',
    v_retail,
    v_credits,
    jsonb_build_object('estimated_upstream_microusd', p_estimated_upstream_cost_microusd)
  );

  select public.api_credit_balance(p_consumer_id) into v_balance;
  return query select v_id, v_credits, v_balance;
end;
$function$;

-- This RPC is backend-only. Browser roles never get direct reservation authority.
revoke execute on function public.compute_reserve_credits(
  text, uuid, uuid, text, text, bigint, integer, uuid, uuid, jsonb
) from public, anon, authenticated;
