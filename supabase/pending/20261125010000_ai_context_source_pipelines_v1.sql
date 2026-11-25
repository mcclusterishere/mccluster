-- AI CONTEXT SOURCE PIPELINES v1 (migration name ai_context_source_pipelines_v1): owner-only, metadata-only
-- projections of Gmail, Google Calendar and Stripe into the house organization, written through the existing
-- universal ingestion contract (public.ops_ingest_connectors / ops_ingest_runs / ops_ingest_records).
-- PENDING ONLY. Never applied to production. Owner approval required before any apply.
-- Contract: docs/control-plane/SOURCE-PIPELINES.md. Rollback: 20261125010000_ai_context_source_pipelines_v1.rollback.sql.
-- Needs, already in production: ai_context.workstream_require_house (ai_context_workstreams_v1), public.orgs,
-- public.org_members, public.ops_ingest_connectors, public.ops_ingest_runs, public.ops_ingest_records
-- (universal_ingestion_entity_resolution_v1).
--
-- What it creates, all additive:
--   three ops_ingest_connectors rows for the house org   google.gmail (email), google.calendar (calendar), stripe.api (api)
--   ai_context.source_messages        one row per Gmail message: ids, time, labels, direction, keyed hashes of the
--                                     counterparties, their domains, an optional redacted subject. Never a body,
--                                     snippet, attachment or raw address.
--   ai_context.source_calendar_events one row per event: ids, time window, status, redacted title, attendee count and
--                                     keyed attendee hashes. Never a description, location text or raw address.
--   ai_context.source_payments        one row per Stripe charge, refund, invoice or customer: ids, amounts, currency,
--                                     status, keyed email hash, allow-listed metadata. Never card data, names or
--                                     addresses.
--   public.ops_ai_source_ingest / _cursor / _query / _prune
--                                     SECURITY DEFINER, search_path pinned, EXECUTE for service_role only. The only way in.
-- RLS on, no policy and no grants on all three tables. It changes no existing object.
--
-- What the database decides for itself, whatever the caller says:
--   * the organization is the house and the actor is an owner member of it;
--   * a record carrying a forbidden field (body, snippet, html, raw address, card, ...) is rejected, not stored;
--   * the same record twice is a no-op (unique per org + account + external id, compared by content hash);
--   * every batch is one ops_ingest_runs row (actor, account, counts, cursor before/after) and every accepted record
--     is one content-addressed ops_ingest_records row: the audit trail;
--   * the per-account cursor advances only when the batch is recorded.
-- One transaction, safe to run twice.
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if to_regnamespace('ai_context') is null
     or to_regprocedure('ai_context.workstream_require_house(uuid)') is null
     or to_regclass('public.orgs') is null or to_regclass('public.org_members') is null
     or to_regclass('public.ops_ingest_connectors') is null or to_regclass('public.ops_ingest_runs') is null
     or to_regclass('public.ops_ingest_records') is null then
    raise exception 'ai_context_source_pipelines_v1 needs ai_context.workstream_require_house, public.orgs, public.org_members and the ops_ingest_* tables; nothing changed' using errcode = '55000';
  end if;
end $guard$;

-- Connectors for the house organization only. Secrets never live here.
insert into public.ops_ingest_connectors (org_id, connector_key, kind, display_name, description, config, retention_policy, license_policy)
select o.id, c.k, c.kind, c.name, c.descr, c.cfg::jsonb, c.ret::jsonb, '{"basis":"owner-private","share":"never"}'::jsonb
  from public.orgs o
 cross join (values
   ('google.gmail', 'email', 'Gmail (metadata only)', 'Owner Gmail message metadata. No bodies, snippets or raw addresses.',
    '{"projection":"ai_context.source_messages","scope":"https://www.googleapis.com/auth/gmail.metadata"}', '{"days":400}'),
   ('google.calendar', 'calendar', 'Google Calendar', 'Owner calendar events. No descriptions, locations or raw addresses.',
    '{"projection":"ai_context.source_calendar_events","scope":"https://www.googleapis.com/auth/calendar.events.readonly"}', '{"days":730}'),
   ('stripe.api', 'api', 'Stripe (read only)', 'Charges, refunds, invoices and customers. No card data, names or addresses.',
    '{"projection":"ai_context.source_payments","key":"restricted read-only"}', '{"days":2555}')
 ) as c(k, kind, name, descr, cfg, ret)
 where o.slug = 'mccluster' and o.enabled
on conflict (org_id, connector_key) do nothing;

create table if not exists ai_context.source_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_key text not null check (account_key ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  external_id text not null check (external_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  thread_id text check (thread_id is null or thread_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  occurred_at timestamptz not null,
  direction text not null check (direction in ('in', 'out', 'self')),
  labels text[] not null default '{}' check (cardinality(labels) <= 40),
  counterparty_hashes text[] not null default '{}' check (cardinality(counterparty_hashes) <= 50),
  counterparty_domains text[] not null default '{}' check (cardinality(counterparty_domains) <= 50),
  subject_redacted text check (subject_redacted is null or char_length(subject_redacted) <= 160),
  attachment_count integer not null default 0 check (attachment_count between 0 and 500),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source_record_id uuid,
  run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_messages_key unique (org_id, account_key, external_id)
);
create index if not exists source_messages_time_idx on ai_context.source_messages (org_id, occurred_at desc);
create index if not exists source_messages_party_idx on ai_context.source_messages using gin (counterparty_hashes);

create table if not exists ai_context.source_calendar_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_key text not null check (account_key ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  external_id text not null check (char_length(external_id) between 1 and 256),
  calendar_hash text not null check (calendar_hash ~ '^[0-9a-f]{64}$'),
  recurring_event_id text check (recurring_event_id is null or char_length(recurring_event_id) <= 256),
  status text not null check (status in ('confirmed', 'tentative', 'cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean not null default false,
  title_redacted text check (title_redacted is null or char_length(title_redacted) <= 160),
  organizer_self boolean not null default false,
  attendee_count integer not null default 0 check (attendee_count between 0 and 1000),
  attendee_hashes text[] not null default '{}' check (cardinality(attendee_hashes) <= 100),
  has_conference boolean not null default false,
  has_location boolean not null default false,
  source_updated_at timestamptz,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source_record_id uuid,
  run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_calendar_events_key unique (org_id, account_key, external_id),
  constraint source_calendar_events_window check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index if not exists source_calendar_events_time_idx on ai_context.source_calendar_events (org_id, starts_at desc);
create index if not exists source_calendar_events_party_idx on ai_context.source_calendar_events using gin (attendee_hashes);

create table if not exists ai_context.source_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_key text not null check (account_key ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  external_id text not null check (external_id ~ '^(ch|py|re|pyr|in|cus)_[A-Za-z0-9]{1,250}$'),
  object_type text not null check (object_type in ('charge', 'refund', 'invoice', 'customer')),
  occurred_at timestamptz not null,
  status text check (status is null or char_length(status) <= 40),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  amount_refunded_minor bigint check (amount_refunded_minor is null or amount_refunded_minor >= 0),
  currency text check (currency is null or currency ~ '^[a-z]{3}$'),
  livemode boolean not null default false,
  customer_id text check (customer_id is null or customer_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  related_id text check (related_id is null or related_id ~ '^(ch|py|pi|in|sub)_[A-Za-z0-9]{1,250}$'),
  email_hash text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source_record_id uuid,
  run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_payments_key unique (org_id, account_key, external_id)
);
create index if not exists source_payments_time_idx on ai_context.source_payments (org_id, occurred_at desc);
create index if not exists source_payments_customer_idx on ai_context.source_payments (org_id, customer_id) where customer_id is not null;
create index if not exists source_payments_email_idx on ai_context.source_payments (org_id, email_hash) where email_hash is not null;

alter table ai_context.source_messages enable row level security;
alter table ai_context.source_calendar_events enable row level security;
alter table ai_context.source_payments enable row level security;
revoke all on ai_context.source_messages, ai_context.source_calendar_events, ai_context.source_payments
  from public, anon, authenticated, service_role;

create or replace function ai_context.source_require_owner(p_org uuid, p_actor uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  perform ai_context.workstream_require_house(p_org);
  if p_actor is null or not exists (
       select 1 from public.org_members m where m.org_id = p_org and m.role = 'owner' and m.profile_id = p_actor) then
    raise exception 'source pipelines need an owner of this organization' using errcode = '42501';
  end if;
end;
$$;

-- The keys a record may carry, per source. Anything else rejects the record. This is the PII floor: a caller
-- bug that forwards a body, snippet, raw address or card field cannot land it in the database.
create or replace function ai_context.source_allowed_keys(p_connector text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_connector
    when 'google.gmail' then array['external_id','thread_id','occurred_at','direction','labels','counterparty_hashes',
                                   'counterparty_domains','subject_redacted','attachment_count']
    when 'google.calendar' then array['external_id','calendar_hash','recurring_event_id','status','starts_at','ends_at','all_day',
                                      'title_redacted','organizer_self','attendee_count','attendee_hashes','has_conference',
                                      'has_location','source_updated_at']
    when 'stripe.api' then array['external_id','object_type','occurred_at','status','amount_minor','amount_refunded_minor',
                                 'currency','livemode','customer_id','related_id','email_hash','metadata']
  end;
$$;

create or replace function ai_context.source_text_array(p jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)), '{}');
$$;

-- Ingest one batch for one connector and account. Returns counts and the run id.
create or replace function public.ops_ai_source_ingest(p_org uuid, p_actor uuid, p_connector text, p_account text,
                                                       p_records jsonb, p_cursor_after jsonb default null,
                                                       p_mode text default 'incremental')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_conn public.ops_ingest_connectors;
  v_run uuid;
  v_trace uuid := gen_random_uuid();
  v_allowed text[];
  r jsonb;
  v_hash text;
  v_rec uuid;
  v_ext text;
  v_seen integer := 0; v_inserted integer := 0; v_updated integer := 0; v_unchanged integer := 0; v_rejected integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_prev text;
  v_cursor_before jsonb;
begin
  perform ai_context.source_require_owner(p_org, p_actor);
  if p_connector not in ('google.gmail', 'google.calendar', 'stripe.api') then
    raise exception 'unknown source connector' using errcode = '22023';
  end if;
  if p_account is null or p_account !~ '^[a-z][a-z0-9_.:-]{1,63}$' then
    raise exception 'account_key must be a short lowercase key, never an address' using errcode = '22023';
  end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) > 500 then
    raise exception 'records must be an array of at most 500' using errcode = '22023';
  end if;
  if p_cursor_after is not null and (jsonb_typeof(p_cursor_after) <> 'object' or octet_length(p_cursor_after::text) > 4000) then
    raise exception 'cursor must be a small object' using errcode = '22023';
  end if;
  -- one writer per connector at a time, so cursors cannot interleave
  perform pg_advisory_xact_lock(hashtextextended('ai_context.source_ingest:' || p_org::text || ':' || p_connector, 0));

  select * into v_conn from public.ops_ingest_connectors c
   where c.org_id = p_org and c.connector_key = p_connector and c.enabled;
  if v_conn.id is null then
    raise exception 'source connector is not registered or is disabled' using errcode = 'P0002';
  end if;
  v_allowed := ai_context.source_allowed_keys(p_connector);
  v_cursor_before := coalesce(v_conn.cursor -> 'accounts' -> p_account, '{}'::jsonb);

  insert into public.ops_ingest_runs (org_id, connector_id, trace_id, mode, status, cursor_before, metadata)
  values (p_org, v_conn.id, v_trace,
          case when p_mode in ('initial', 'incremental', 'replay', 'manual') then p_mode else 'incremental' end,
          'running', v_cursor_before,
          jsonb_build_object('pipeline', 'ai_context_source_pipelines_v1', 'actor', p_actor, 'account_key', p_account))
  returning id into v_run;

  for r in select value from jsonb_array_elements(p_records) loop
    v_seen := v_seen + 1;
    v_ext := r ->> 'external_id';
    begin
      if jsonb_typeof(r) <> 'object' or v_ext is null then
        raise exception 'record must be an object with external_id' using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_object_keys(r) k where k <> all (v_allowed)) then
        raise exception 'record carries a field outside the % allow-list', p_connector using errcode = '22023';
      end if;
      v_hash := encode(sha256(convert_to(r::text, 'UTF8')), 'hex');

      if p_connector = 'google.gmail' then
        select content_hash into v_prev from ai_context.source_messages
         where org_id = p_org and account_key = p_account and external_id = v_ext;
      elsif p_connector = 'google.calendar' then
        select content_hash into v_prev from ai_context.source_calendar_events
         where org_id = p_org and account_key = p_account and external_id = v_ext;
      else
        select content_hash into v_prev from ai_context.source_payments
         where org_id = p_org and account_key = p_account and external_id = v_ext;
      end if;
      if found and v_prev = v_hash then
        v_unchanged := v_unchanged + 1;
        continue;
      end if;

      insert into public.ops_ingest_records (org_id, connector_id, run_id, trace_id, external_id, record_kind, source_ref,
                                             observed_at, content_hash, idempotency_key, payload, retention_policy, license_policy)
      values (p_org, v_conn.id, v_run, v_trace, p_account || ':' || v_ext,
              case p_connector when 'google.gmail' then 'message' when 'google.calendar' then 'calendar_event'
                               else coalesce(r ->> 'object_type', 'payment') end,
              jsonb_build_object('projection', v_conn.config ->> 'projection', 'account_key', p_account, 'external_id', v_ext),
              coalesce((r ->> 'occurred_at')::timestamptz, (r ->> 'source_updated_at')::timestamptz, (r ->> 'starts_at')::timestamptz, now()),
              v_hash, p_account || ':' || v_ext || ':' || v_hash, r, v_conn.retention_policy, v_conn.license_policy)
      on conflict (org_id, connector_id, idempotency_key) do update set run_id = excluded.run_id, ingested_at = now()
      returning id into v_rec;

      if p_connector = 'google.gmail' then
        insert into ai_context.source_messages (org_id, account_key, external_id, thread_id, occurred_at, direction, labels,
               counterparty_hashes, counterparty_domains, subject_redacted, attachment_count, content_hash, source_record_id, run_id)
        values (p_org, p_account, v_ext, r ->> 'thread_id', (r ->> 'occurred_at')::timestamptz, r ->> 'direction',
                ai_context.source_text_array(r -> 'labels'), ai_context.source_text_array(r -> 'counterparty_hashes'),
                ai_context.source_text_array(r -> 'counterparty_domains'), r ->> 'subject_redacted',
                coalesce((r ->> 'attachment_count')::integer, 0), v_hash, v_rec, v_run)
        on conflict (org_id, account_key, external_id) do update set
          thread_id = excluded.thread_id, occurred_at = excluded.occurred_at, direction = excluded.direction, labels = excluded.labels,
          counterparty_hashes = excluded.counterparty_hashes, counterparty_domains = excluded.counterparty_domains,
          subject_redacted = excluded.subject_redacted, attachment_count = excluded.attachment_count,
          content_hash = excluded.content_hash, source_record_id = excluded.source_record_id, run_id = excluded.run_id, updated_at = now();
      elsif p_connector = 'google.calendar' then
        insert into ai_context.source_calendar_events (org_id, account_key, external_id, calendar_hash, recurring_event_id, status,
               starts_at, ends_at, all_day, title_redacted, organizer_self, attendee_count, attendee_hashes, has_conference,
               has_location, source_updated_at, content_hash, source_record_id, run_id)
        values (p_org, p_account, v_ext, r ->> 'calendar_hash', r ->> 'recurring_event_id', coalesce(r ->> 'status', 'confirmed'),
                (r ->> 'starts_at')::timestamptz, (r ->> 'ends_at')::timestamptz, coalesce((r ->> 'all_day')::boolean, false),
                r ->> 'title_redacted', coalesce((r ->> 'organizer_self')::boolean, false),
                coalesce((r ->> 'attendee_count')::integer, 0), ai_context.source_text_array(r -> 'attendee_hashes'),
                coalesce((r ->> 'has_conference')::boolean, false), coalesce((r ->> 'has_location')::boolean, false),
                (r ->> 'source_updated_at')::timestamptz, v_hash, v_rec, v_run)
        on conflict (org_id, account_key, external_id) do update set
          calendar_hash = excluded.calendar_hash, recurring_event_id = excluded.recurring_event_id, status = excluded.status,
          starts_at = excluded.starts_at, ends_at = excluded.ends_at, all_day = excluded.all_day, title_redacted = excluded.title_redacted,
          organizer_self = excluded.organizer_self, attendee_count = excluded.attendee_count, attendee_hashes = excluded.attendee_hashes,
          has_conference = excluded.has_conference, has_location = excluded.has_location, source_updated_at = excluded.source_updated_at,
          content_hash = excluded.content_hash, source_record_id = excluded.source_record_id, run_id = excluded.run_id, updated_at = now();
      else
        insert into ai_context.source_payments (org_id, account_key, external_id, object_type, occurred_at, status, amount_minor,
               amount_refunded_minor, currency, livemode, customer_id, related_id, email_hash, metadata, content_hash, source_record_id, run_id)
        values (p_org, p_account, v_ext, r ->> 'object_type', (r ->> 'occurred_at')::timestamptz, r ->> 'status',
                (r ->> 'amount_minor')::bigint, (r ->> 'amount_refunded_minor')::bigint, r ->> 'currency',
                coalesce((r ->> 'livemode')::boolean, false), r ->> 'customer_id', r ->> 'related_id', r ->> 'email_hash',
                coalesce(r -> 'metadata', '{}'::jsonb), v_hash, v_rec, v_run)
        on conflict (org_id, account_key, external_id) do update set
          object_type = excluded.object_type, occurred_at = excluded.occurred_at, status = excluded.status,
          amount_minor = excluded.amount_minor, amount_refunded_minor = excluded.amount_refunded_minor, currency = excluded.currency,
          livemode = excluded.livemode, customer_id = excluded.customer_id, related_id = excluded.related_id,
          email_hash = excluded.email_hash, metadata = excluded.metadata,
          content_hash = excluded.content_hash, source_record_id = excluded.source_record_id, run_id = excluded.run_id, updated_at = now();
      end if;

      if v_prev is null then v_inserted := v_inserted + 1; else v_updated := v_updated + 1; end if;
      v_prev := null;
    exception when others then
      -- one bad record never sinks the batch; it is counted and named (by id only) in the run
      v_rejected := v_rejected + 1;
      v_prev := null;
      if jsonb_array_length(v_errors) < 20 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('external_id', left(coalesce(v_ext, '?'), 128), 'error', left(sqlerrm, 200)));
      end if;
    end;
  end loop;

  update public.ops_ingest_runs
     set status = case when v_rejected = 0 then 'succeeded' when v_rejected < v_seen then 'partial' else 'failed' end,
         records_seen = v_seen, records_written = v_inserted + v_updated, records_rejected = v_rejected,
         cursor_after = coalesce(p_cursor_after, v_cursor_before),
         error = case when v_rejected > 0 then left(v_errors::text, 4000) end,
         metadata = metadata || jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged),
         finished_at = now()
   where id = v_run;

  -- the cursor advances unless every record was rejected
  update public.ops_ingest_connectors c
     set cursor = case when p_cursor_after is not null and (v_rejected = 0 or v_rejected < v_seen)
                       then jsonb_set(coalesce(c.cursor, '{}'::jsonb) || jsonb_build_object('accounts', coalesce(c.cursor -> 'accounts', '{}'::jsonb)),
                                      array['accounts', p_account], p_cursor_after, true)
                       else c.cursor end,
         last_sync_at = now(),
         last_ok_at = case when v_rejected = 0 then now() else c.last_ok_at end,
         last_error = case when v_rejected > 0 then left(v_errors::text, 1000) end,
         last_error_at = case when v_rejected > 0 then now() end,
         updated_at = now()
   where c.id = v_conn.id;

  return jsonb_build_object('run_id', v_run, 'trace_id', v_trace, 'connector', p_connector, 'account_key', p_account,
                            'seen', v_seen, 'inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged,
                            'rejected', v_rejected, 'errors', v_errors);
end;
$$;

-- Read the stored cursor for one account so a pull resumes where the last recorded batch ended.
create or replace function public.ops_ai_source_cursor(p_org uuid, p_actor uuid, p_connector text, p_account text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_enabled boolean;
begin
  perform ai_context.source_require_owner(p_org, p_actor);
  select c.cursor -> 'accounts' -> p_account, c.enabled into v, v_enabled
    from public.ops_ingest_connectors c where c.org_id = p_org and c.connector_key = p_connector;
  if v_enabled is null then raise exception 'source connector is not registered' using errcode = 'P0002'; end if;
  return jsonb_build_object('connector', p_connector, 'account_key', p_account, 'enabled', v_enabled, 'cursor', coalesce(v, '{}'::jsonb));
end;
$$;

-- Owner read of recent projected rows, newest first.
create or replace function public.ops_ai_source_query(p_org uuid, p_actor uuid, p_connector text, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500)); v jsonb;
begin
  perform ai_context.source_require_owner(p_org, p_actor);
  if p_connector = 'google.gmail' then
    select coalesce(jsonb_agg(to_jsonb(x) - 'org_id'), '[]') into v from (
      select * from ai_context.source_messages where org_id = p_org order by occurred_at desc limit v_limit) x;
  elsif p_connector = 'google.calendar' then
    select coalesce(jsonb_agg(to_jsonb(x) - 'org_id'), '[]') into v from (
      select * from ai_context.source_calendar_events where org_id = p_org order by starts_at desc nulls last limit v_limit) x;
  elsif p_connector = 'stripe.api' then
    select coalesce(jsonb_agg(to_jsonb(x) - 'org_id'), '[]') into v from (
      select * from ai_context.source_payments where org_id = p_org order by occurred_at desc limit v_limit) x;
  else
    raise exception 'unknown source connector' using errcode = '22023';
  end if;
  return jsonb_build_object('connector', p_connector, 'rows', v);
end;
$$;

-- Delete projected rows older than the connector's retention_policy.days. Provenance rows in ops_ingest_records
-- follow the existing ingestion retention process and are not touched here.
create or replace function public.ops_ai_source_prune(p_org uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d_mail integer; d_cal integer; d_pay integer; n_mail integer; n_cal integer; n_pay integer;
begin
  perform ai_context.source_require_owner(p_org, p_actor);
  select (retention_policy ->> 'days')::integer into d_mail from public.ops_ingest_connectors where org_id = p_org and connector_key = 'google.gmail';
  select (retention_policy ->> 'days')::integer into d_cal from public.ops_ingest_connectors where org_id = p_org and connector_key = 'google.calendar';
  select (retention_policy ->> 'days')::integer into d_pay from public.ops_ingest_connectors where org_id = p_org and connector_key = 'stripe.api';
  delete from ai_context.source_messages where org_id = p_org and d_mail is not null and occurred_at < now() - make_interval(days => d_mail);
  get diagnostics n_mail = row_count;
  delete from ai_context.source_calendar_events where org_id = p_org and d_cal is not null and coalesce(ends_at, starts_at) < now() - make_interval(days => d_cal);
  get diagnostics n_cal = row_count;
  delete from ai_context.source_payments where org_id = p_org and d_pay is not null and occurred_at < now() - make_interval(days => d_pay);
  get diagnostics n_pay = row_count;
  return jsonb_build_object('messages', n_mail, 'calendar_events', n_cal, 'payments', n_pay);
end;
$$;

revoke all on function ai_context.source_require_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function ai_context.source_allowed_keys(text) from public, anon, authenticated;
revoke all on function ai_context.source_text_array(jsonb) from public, anon, authenticated;
revoke all on function public.ops_ai_source_ingest(uuid, uuid, text, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.ops_ai_source_cursor(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.ops_ai_source_query(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.ops_ai_source_prune(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ops_ai_source_ingest(uuid, uuid, text, text, jsonb, jsonb, text) to service_role;
grant execute on function public.ops_ai_source_cursor(uuid, uuid, text, text) to service_role;
grant execute on function public.ops_ai_source_query(uuid, uuid, text, integer) to service_role;
grant execute on function public.ops_ai_source_prune(uuid, uuid) to service_role;

commit;
