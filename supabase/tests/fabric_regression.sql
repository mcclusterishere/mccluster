\set ON_ERROR_STOP on
begin;

do $test$
declare
  v_cloud_event uuid := gen_random_uuid();
  v_supabase_event uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_trace uuid := gen_random_uuid();
  v_count integer;
  v_error text;
begin
  -- Cloudflare-origin event: Supabase and origin ACK immediately, OVH queues.
  insert into public.fabric_events(event_id,org_id,trace_id,kind,origin_node,occurred_at,content_hash,payload)
  values(
    v_cloud_event,v_org,v_trace,'conversation.ingested','cloudflare',now(),repeat('a',64),
    jsonb_build_object(
      'provider','chatgpt',
      'conversation_id',v_trace::text,
      'receipt_id',v_cloud_event::text,
      'message_count',3,
      'payload_hash',repeat('b',64)
    )
  );

  select count(*) into v_count
  from public.fabric_receipts
  where event_id=v_cloud_event and state='acked' and node in ('supabase','cloudflare');
  if v_count <> 2 then raise exception 'cloudflare event did not seed canonical/origin ACKs'; end if;

  select count(*) into v_count
  from public.fabric_receipts
  where event_id=v_cloud_event and state='pending' and node='ovh';
  if v_count <> 1 then raise exception 'cloudflare event did not seed OVH pending receipt'; end if;

  select count(*) into v_count
  from public.fabric_outbox
  where event_id=v_cloud_event and target_node='ovh' and status='pending';
  if v_count <> 1 then raise exception 'cloudflare event did not seed OVH outbox'; end if;

  select count(*) into v_count
  from public.fabric_outbox
  where event_id=v_cloud_event and target_node='cloudflare';
  if v_count <> 0 then raise exception 'origin node unexpectedly received self-delivery outbox row'; end if;

  -- Supabase-origin event: both peers queue independently.
  insert into public.fabric_events(event_id,org_id,trace_id,kind,origin_node,occurred_at,content_hash,payload)
  values(v_supabase_event,v_org,gen_random_uuid(),'fabric.test','supabase',now(),repeat('c',64),'{}'::jsonb);

  select count(*) into v_count
  from public.fabric_outbox
  where event_id=v_supabase_event and target_node in ('cloudflare','ovh') and status='pending';
  if v_count <> 2 then raise exception 'supabase event did not seed both peer deliveries'; end if;

  -- DB boundary itself rejects transcript-like aliases, not only payload.messages.
  begin
    insert into public.fabric_events(event_id,org_id,trace_id,kind,origin_node,occurred_at,content_hash,payload)
    values(
      gen_random_uuid(),v_org,gen_random_uuid(),'conversation.ingested','cloudflare',now(),repeat('d',64),
      jsonb_build_object(
        'conversation_id',gen_random_uuid()::text,
        'receipt_id',gen_random_uuid()::text,
        'message_count',1,
        'payload_hash',repeat('e',64),
        'transcript','private raw text'
      )
    );
    raise exception 'conversation transcript alias unexpectedly accepted';
  exception when check_violation then
    null;
  end;

  -- Canonical events are append-only even to privileged DB actors.
  begin
    update public.fabric_events set kind='tampered' where event_id=v_cloud_event;
    raise exception 'fabric event update unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if position('append-only' in lower(v_error)) = 0 then
      raise exception 'unexpected fabric update error: %', v_error;
    end if;
  end;

  begin
    delete from public.fabric_events where event_id=v_cloud_event;
    raise exception 'fabric event delete unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if position('append-only' in lower(v_error)) = 0 then
      raise exception 'unexpected fabric delete error: %', v_error;
    end if;
  end;

  -- Browser roles receive no table privileges; service role is intentionally narrow.
  if has_table_privilege('anon','public.fabric_events','SELECT')
     or has_table_privilege('authenticated','public.fabric_events','SELECT') then
    raise exception 'browser role unexpectedly has Fabric event read privilege';
  end if;

  if not has_table_privilege('service_role','public.fabric_events','SELECT')
     or not has_table_privilege('service_role','public.fabric_events','INSERT') then
    raise exception 'service role missing Fabric event read/insert privilege';
  end if;

  if has_table_privilege('service_role','public.fabric_events','UPDATE')
     or has_table_privilege('service_role','public.fabric_events','DELETE') then
    raise exception 'service role unexpectedly has Fabric event mutation privilege';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.fabric_events'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.fabric_receipts'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.fabric_outbox'::regclass) then
    raise exception 'Fabric RLS is not enabled on every table';
  end if;

  raise notice 'fabric_regression: PASS';
end;
$test$;

rollback;
