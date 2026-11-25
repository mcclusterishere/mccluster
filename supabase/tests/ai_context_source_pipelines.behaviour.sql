-- Behaviour of supabase/pending/20261125010000_ai_context_source_pipelines_v1.sql after ai_context_source_pipelines.stub.sql.
-- Disposable database only. Synthetic data only. Every check raises on failure.
do $t$
declare
  org constant uuid := '00000000-0000-4000-8000-000000000001';
  tenant constant uuid := '00000000-0000-4000-8000-000000000002';
  owner constant uuid := '00000000-0000-4000-8000-0000000000aa';
  member constant uuid := '00000000-0000-4000-8000-0000000000bb';
  h1 constant text := repeat('1', 64);
  h2 constant text := repeat('2', 64);
  mail jsonb := jsonb_build_array(
    jsonb_build_object('external_id', 'm0001', 'thread_id', 't0001', 'occurred_at', '2026-11-20T15:00:00Z', 'direction', 'in',
      'labels', jsonb_build_array('INBOX', 'CATEGORY_PERSONAL'), 'counterparty_hashes', jsonb_build_array(h1),
      'counterparty_domains', jsonb_build_array('example.org'), 'subject_redacted', 'Event photos for [date]', 'attachment_count', 0),
    jsonb_build_object('external_id', 'm0002', 'thread_id', 't0001', 'occurred_at', '2026-11-20T16:00:00Z', 'direction', 'out',
      'labels', jsonb_build_array('SENT'), 'counterparty_hashes', jsonb_build_array(h1), 'counterparty_domains', jsonb_build_array('example.org')));
  r jsonb; n integer; ok boolean;
begin
  assert (select count(*) from public.ops_ingest_connectors where org_id = org) = 3, 'three connectors for the house';
  assert (select count(*) from public.ops_ingest_connectors where org_id = tenant) = 0, 'no connectors for a tenant';

  r := public.ops_ai_source_ingest(org, owner, 'google.gmail', 'gmail.primary', mail, '{"after_ms":1763654400000}', 'initial');
  assert (r->>'inserted')::int = 2 and (r->>'rejected')::int = 0, 'two messages inserted: ' || r::text;
  assert (select count(*) from ai_context.source_messages) = 2;
  assert (select count(*) from public.ops_ingest_records) = 2, 'provenance row per record';
  assert (select status from public.ops_ingest_runs where id = (r->>'run_id')::uuid) = 'succeeded';
  assert (select metadata->>'actor' from public.ops_ingest_runs where id = (r->>'run_id')::uuid) = owner::text, 'actor audited';
  assert (public.ops_ai_source_cursor(org, owner, 'google.gmail', 'gmail.primary')->'cursor'->>'after_ms') = '1763654400000', 'cursor stored';

  -- replay: same batch writes nothing new
  r := public.ops_ai_source_ingest(org, owner, 'google.gmail', 'gmail.primary', mail, '{"after_ms":1763654400000}');
  assert (r->>'unchanged')::int = 2 and (r->>'inserted')::int = 0 and (r->>'updated')::int = 0, 'replay is a no-op: ' || r::text;
  assert (select count(*) from public.ops_ingest_records) = 2, 'replay adds no provenance';

  -- a change (label moved) updates in place, one new provenance row
  r := public.ops_ai_source_ingest(org, owner, 'google.gmail', 'gmail.primary',
        jsonb_build_array(jsonb_set(mail->0, '{labels}', '["INBOX","STARRED"]')), null);
  assert (r->>'updated')::int = 1, 'label change updates';
  assert (select labels from ai_context.source_messages where external_id = 'm0001') = array['INBOX','STARRED'];
  assert (select count(*) from public.ops_ingest_records) = 3;
  assert (public.ops_ai_source_cursor(org, owner, 'google.gmail', 'gmail.primary')->'cursor'->>'after_ms') = '1763654400000', 'null cursor keeps the old one';

  -- PII floor: a body or snippet rejects the record, the rest of the batch lands
  r := public.ops_ai_source_ingest(org, owner, 'google.gmail', 'gmail.primary', jsonb_build_array(
        jsonb_build_object('external_id', 'm0003', 'occurred_at', '2026-11-21T10:00:00Z', 'direction', 'in', 'snippet', 'synthetic text'),
        jsonb_build_object('external_id', 'm0004', 'occurred_at', '2026-11-21T11:00:00Z', 'direction', 'in', 'from', 'someone@example.org'),
        jsonb_build_object('external_id', 'm0005', 'occurred_at', '2026-11-21T12:00:00Z', 'direction', 'self')), '{"after_ms":1763726400000}');
  assert (r->>'rejected')::int = 2 and (r->>'inserted')::int = 1, 'forbidden fields rejected: ' || r::text;
  assert not exists (select 1 from ai_context.source_messages where external_id in ('m0003', 'm0004'));
  assert not exists (select 1 from public.ops_ingest_records where payload ? 'snippet' or payload ? 'from'), 'nothing forbidden stored';
  assert (select status from public.ops_ingest_runs where id = (r->>'run_id')::uuid) = 'partial';
  assert (public.ops_ai_source_cursor(org, owner, 'google.gmail', 'gmail.primary')->'cursor'->>'after_ms') = '1763726400000', 'partial advances cursor';

  -- a fully rejected batch does not advance the cursor
  r := public.ops_ai_source_ingest(org, owner, 'google.gmail', 'gmail.primary',
        '[{"external_id":"m0006","occurred_at":"2026-11-22T10:00:00Z","direction":"in","body":"x"}]', '{"after_ms":9999999999999}');
  assert (r->>'rejected')::int = 1 and (public.ops_ai_source_cursor(org, owner, 'google.gmail', 'gmail.primary')->'cursor'->>'after_ms') = '1763726400000', 'failed batch keeps cursor';

  -- calendar and stripe projections
  r := public.ops_ai_source_ingest(org, owner, 'google.calendar', 'calendar.primary', jsonb_build_array(jsonb_build_object(
        'external_id', 'evt001', 'calendar_hash', h2, 'status', 'confirmed', 'starts_at', '2026-12-05T18:00:00Z', 'ends_at', '2026-12-05T20:00:00Z',
        'title_redacted', 'Photo coverage', 'attendee_count', 2, 'attendee_hashes', jsonb_build_array(h1), 'has_location', true)), '{"sync_token":"synthetic"}');
  assert (r->>'inserted')::int = 1, 'calendar inserted: ' || r::text;
  r := public.ops_ai_source_ingest(org, owner, 'google.calendar', 'calendar.primary',
        '[{"external_id":"evt002","calendar_hash":"2222222222222222222222222222222222222222222222222222222222222222","status":"confirmed","location":"1 Main St"}]', null);
  assert (r->>'rejected')::int = 1, 'raw location rejected';

  r := public.ops_ai_source_ingest(org, owner, 'stripe.api', 'stripe.live', jsonb_build_array(
        jsonb_build_object('external_id', 'ch_synthetic1', 'object_type', 'charge', 'occurred_at', '2026-11-19T12:00:00Z', 'status', 'succeeded',
          'amount_minor', 20000, 'amount_refunded_minor', 0, 'currency', 'usd', 'livemode', false, 'customer_id', 'cus_synthetic1',
          'related_id', 'pi_synthetic1', 'email_hash', h1, 'metadata', '{"offer":"starter"}'::jsonb),
        jsonb_build_object('external_id', 'cus_synthetic1', 'object_type', 'customer', 'occurred_at', '2026-11-19T11:59:00Z', 'email_hash', h1),
        jsonb_build_object('external_id', 'ch_synthetic2', 'object_type', 'charge', 'occurred_at', '2026-11-19T12:00:00Z', 'payment_method_details', '{}'::jsonb)),
        '{"charge":1763553600}');
  assert (r->>'inserted')::int = 2 and (r->>'rejected')::int = 1, 'stripe rows, card details rejected: ' || r::text;
  assert (select count(*) from ai_context.source_payments where email_hash = h1) = 2, 'charge and customer share the keyed email hash';

  -- query returns rows without the org id
  r := public.ops_ai_source_query(org, owner, 'stripe.api', 10);
  assert jsonb_array_length(r->'rows') = 2 and not (r->'rows'->0 ? 'org_id');

  -- owner only, house only, account key is never an address
  ok := false;
  begin perform public.ops_ai_source_ingest(org, member, 'google.gmail', 'gmail.primary', '[]'); exception when insufficient_privilege then ok := true; end;
  assert ok, 'member refused';
  ok := false;
  begin perform public.ops_ai_source_query(org, member, 'google.gmail', 5); exception when insufficient_privilege then ok := true; end;
  assert ok, 'member refused for reads';
  ok := false;
  begin perform public.ops_ai_source_ingest(tenant, owner, 'google.gmail', 'gmail.primary', '[]'); exception when insufficient_privilege then ok := true; end;
  assert ok, 'tenant refused';
  ok := false;
  begin perform public.ops_ai_source_ingest(org, owner, 'google.gmail', 'someone@example.org', '[]'); exception when invalid_parameter_value then ok := true; end;
  assert ok, 'address as account key refused';
  ok := false;
  begin perform public.ops_ai_source_ingest(org, owner, 'dropbox.files', 'x.y', '[]'); exception when invalid_parameter_value then ok := true; end;
  assert ok, 'unknown connector refused';

  -- no client role can touch the tables or the functions
  assert not has_table_privilege('service_role', 'ai_context.source_messages', 'select'), 'service_role has no direct table read';
  assert not has_table_privilege('authenticated', 'ai_context.source_payments', 'select');
  assert not has_function_privilege('authenticated', 'public.ops_ai_source_ingest(uuid, uuid, text, text, jsonb, jsonb, text)', 'execute');
  assert not has_function_privilege('anon', 'public.ops_ai_source_query(uuid, uuid, text, integer)', 'execute');
  assert has_function_privilege('service_role', 'public.ops_ai_source_ingest(uuid, uuid, text, text, jsonb, jsonb, text)', 'execute');

  -- retention prune
  update public.ops_ingest_connectors set retention_policy = '{"days":1}' where org_id = org and connector_key = 'google.gmail';
  r := public.ops_ai_source_prune(org, owner);
  assert (r->>'messages')::int = 3, 'old messages pruned: ' || r::text;
  assert (select count(*) from public.ops_ingest_records) > 0, 'provenance kept';
  raise notice 'ai_context_source_pipelines behaviour: all checks passed';
end $t$;
