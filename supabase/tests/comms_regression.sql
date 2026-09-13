\set ON_ERROR_STOP on

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'comms_contacts',
    'comms_relay_devices',
    'comms_threads',
    'comms_messages',
    'comms_outbox',
    'comms_delivery_events',
    'comms_audit'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      RAISE EXCEPTION 'missing communications table: %', table_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', table_name;
    END IF;
    IF has_table_privilege('anon', 'public.' || table_name, 'SELECT')
       OR has_table_privilege('anon', 'public.' || table_name, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || table_name, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || table_name, 'INSERT') THEN
      RAISE EXCEPTION 'browser roles unexpectedly retain communications privileges on public.%', table_name;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='comms_messages_idempotency_uq') THEN
    RAISE EXCEPTION 'missing message idempotency index';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='comms_outbox_claim_idx') THEN
    RAISE EXCEPTION 'missing outbox claim index';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.comms_outbox', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.comms_outbox', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.comms_outbox', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role lacks required outbox privileges';
  END IF;
END $$;

SELECT 'mccluster communications regression: ok' AS result;
