-- Step 0 of wave 3: bring the production-only schema into Git.
--
-- REPLAY ONLY. This file lives in supabase/replay_migrations/ and is applied by the CI
-- reset (scripts/supabase-local-reset-with-replay.sh) after every other migration, so the
-- database Git rebuilds holds the objects production already has but no SQL in the repo
-- created. It is never applied to production and has nothing to do there: every block
-- below first checks whether its object exists and does nothing when it does, so run
-- against production (or twice against a rebuild) it changes nothing.
--
-- Source: docs/control-plane/PRODUCTION-SCHEMA-RECONCILIATION-2026-10-28.md, "What
-- production has that the repo cannot rebuild". Every definition was read from the
-- production catalogs of project zmnhbrjyhxzhkxmhkexs on 2026-10-29 with read-only
-- queries (pg_get_functiondef, pg_get_triggerdef, pg_get_constraintdef,
-- pg_get_indexdef, pg_policies, pg_class.relacl, storage.buckets), not reconstructed
-- from intent. Function bodies are byte-identical to production's prosrc (their md5
-- prefixes equal the 2026-10-28 evidence), including public.is_org_member's CRLF line
-- ends, which are rebuilt with chr(13).
--
-- What it brings in:
--   tables   private.rate_limit_counters, private.rate_limit_salt,
--            public._analytics_baseline_tmp (a leftover scratch table; kept because
--            production has it, see the reconciliation page), public.feed,
--            public.music_direct_offers, music_direct_orders, music_direct_entitlements,
--            public.music_isrc_registrants, music_isrc_allocations,
--            public.network_attribution, network_operator_access_log,
--            network_post_edges, network_sessions, network_telemetry_events,
--            network_user_features, public.ops_recommendations,
--            public.private_song_asset_chunks
--   functions private.rate_limit_client_key(), private.enforce_anon_insert_rate_limit(),
--            public.is_org_member(uuid), public.is_org_owner(uuid),
--            public.kb_search(text, vector, integer, integer),
--            public.mnet_feed_item_from_activity(), mnet_refresh_user_features(uuid),
--            mnet_seed_surface_config(), music_assign_isrc(uuid),
--            network_profile_after_auth_link()
--   triggers events_anon_rate_limit, leads_anon_rate_limit,
--            network_profile_after_auth_link_trg, network_activity_feed_item_trg,
--            network_posts_feed_item_trg, platform_apps_mnet_surface_trg
--   policies the 30 production-only public policies and the seven storage.objects
--            l3_* staff policies
--   buckets  l3-product-files (private, 512 MiB), l3-public (public, 50 MiB)
--
-- Grants are set to production's ACL exactly (TRUNCATE, REFERENCES and TRIGGER are not
-- granted to the API roles on these tables; MAINTAIN comes from "grant all").
--
-- Not covered here, and still different between a rebuild and production (listed in the
-- reconciliation page): changed function bodies, policy expressions that call the
-- unqualified public.is_org_member, grant sets on existing tables, and the replay-only
-- objects production lacked (those have their own migration, applied 2026-10-29:
-- supabase/migrations/20261029011534_eu_runtime_and_media_rollup_v1.sql).

-- ---------------------------------------------------------------- anon insert rate limit
do $blk$
begin
  if to_regclass('private.rate_limit_counters') is null then
    create table private.rate_limit_counters (
      bucket_key text not null,
      window_start timestamp with time zone not null,
      hits integer not null default 0,
      constraint rate_limit_counters_pkey primary key (bucket_key, window_start)
    );
    create index rate_limit_counters_window_idx on private.rate_limit_counters using btree (window_start);
    revoke all on table private.rate_limit_counters from public, anon, authenticated, service_role;
  end if;

  if to_regclass('private.rate_limit_salt') is null then
    create table private.rate_limit_salt (
      only_row boolean not null default true,
      salt text not null default encode(extensions.gen_random_bytes(32), 'hex'::text),
      constraint rate_limit_salt_pkey primary key (only_row),
      constraint rate_limit_salt_only_row_check check (only_row)
    );
    revoke all on table private.rate_limit_salt from public, anon, authenticated, service_role;
    insert into private.rate_limit_salt default values on conflict do nothing;
  end if;

  if to_regprocedure('private.rate_limit_client_key()') is null then
    create function private.rate_limit_client_key()
     returns text
     language plpgsql
     stable security definer
     set search_path to 'pg_catalog', 'public', 'private', 'extensions'
    as $function$
declare
  h  jsonb;
  ip text;
begin
  h := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  ip := nullif(btrim(h ->> 'cf-connecting-ip'), '');
  if ip is null then
    ip := nullif(btrim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), '');
  end if;
  if ip is null then
    return null;
  end if;
  return encode(
    extensions.digest(ip || (select salt from private.rate_limit_salt limit 1), 'sha256'),
    'hex'
  );
exception when others then
  return null;
end;
$function$;
    revoke all on function private.rate_limit_client_key() from public, anon, authenticated, service_role;
  end if;

  if to_regprocedure('private.enforce_anon_insert_rate_limit()') is null then
    create function private.enforce_anon_insert_rate_limit()
     returns trigger
     language plpgsql
     security definer
     set search_path to 'pg_catalog', 'public', 'private', 'extensions'
    as $function$
declare
  v_scope   text := tg_argv[0];
  v_role    text;
  v_key     text;
  v_window  timestamptz;
  v_hits    integer;
begin
  v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if v_role is distinct from 'anon' then
    return new;
  end if;

  v_window := date_trunc('hour', now());
  v_key    := private.rate_limit_client_key();

  if v_key is not null then
    insert into private.rate_limit_counters (bucket_key, window_start, hits)
    values (v_scope || ':ip:' || v_key, v_window, 1)
    on conflict (bucket_key, window_start)
      do update set hits = private.rate_limit_counters.hits + 1
    returning hits into v_hits;

    if v_hits > tg_argv[1]::integer then
      raise exception 'Too many submissions from this address. Please try again later.'
        using errcode = 'PT429';
    end if;
  end if;

  insert into private.rate_limit_counters (bucket_key, window_start, hits)
  values (v_scope || ':all', v_window, 1)
  on conflict (bucket_key, window_start)
    do update set hits = private.rate_limit_counters.hits + 1
  returning hits into v_hits;

  if v_hits > tg_argv[2]::integer then
    raise exception 'Too many submissions. Please try again later.'
      using errcode = 'PT429';
  end if;

  if random() < 0.002 then
    delete from private.rate_limit_counters where window_start < now() - interval '2 days';
  end if;

  return new;
end;
$function$;
    revoke all on function private.enforce_anon_insert_rate_limit() from public, anon, authenticated, service_role;
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.events'::regclass and tgname = 'events_anon_rate_limit') then
    create trigger events_anon_rate_limit before insert on public.events
      for each row execute function private.enforce_anon_insert_rate_limit('events', '1000', '5000');
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.leads'::regclass and tgname = 'leads_anon_rate_limit') then
    create trigger leads_anon_rate_limit before insert on public.leads
      for each row execute function private.enforce_anon_insert_rate_limit('leads', '20', '300');
  end if;
end
$blk$;

-- ---------------------------------------------------------------- org helpers (public)
-- Production's eu_*_read, leads_org_read, org_stripe_accounts_member_read and platform_*
-- policies call these unqualified; the replayed history moved its own policies to
-- private.is_org_member (20260909030000), which production never ran.
do $blk$
begin
  if to_regprocedure('public.is_org_member(uuid)') is null then
    -- production's body has CRLF line ends; rebuilt byte for byte.
    execute replace($ddl$create function public.is_org_member(p_org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$<CR>
  select exists (<CR>
    select 1<CR>
    from public.org_members m<CR>
    where m.org_id = p_org<CR>
      and m.profile_id = auth.uid()<CR>
  );<CR>
$function$$ddl$, '<CR>', chr(13));
    revoke all on function public.is_org_member(uuid) from public, anon;
    grant execute on function public.is_org_member(uuid) to authenticated, service_role;
  end if;

  if to_regprocedure('public.is_org_owner(uuid)') is null then
    create function public.is_org_owner(p_org uuid)
     returns boolean
     language sql
     stable security definer
     set search_path to 'public', 'pg_temp'
    as $function$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org
      and m.profile_id = auth.uid()
      and m.role = 'owner'
  );
$function$;
    revoke all on function public.is_org_owner(uuid) from public, anon;
    grant execute on function public.is_org_owner(uuid) to authenticated, service_role;
  end if;
end
$blk$;

-- ---------------------------------------------------------------- kb_search, org-less overload
do $blk$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'kb_search'
       and pg_get_function_identity_arguments(p.oid) = 'q text, q_embedding vector, match_count integer, rrf_k integer'
  ) then
    create function public.kb_search(q text, q_embedding vector default null::vector, match_count integer default 8, rrf_k integer default 60)
     returns table(chunk_id uuid, document_id uuid, title text, url text, kind text, body text, fts_rank integer, vec_rank integer, score double precision)
     language sql
     stable security definer
     set search_path to 'public'
    as $function$
  -- The query terms, ORed.
  --
  -- websearch_to_tsquery ANDs every term, which sounds right and is useless:
  -- "are you taking on new clients for a site" becomes
  -- 'take' & 'new' & 'client' & 'site', and a page that never says "client"
  -- scores zero however relevant it is. Real keyword retrieval ranks by how
  -- many terms match, it does not require all of them. So the query text is
  -- pushed through to_tsvector to get stemmed, stopword-free lexemes, and
  -- those are ORed. Going through to_tsvector also means no user text is ever
  -- concatenated into a tsquery, which is the injection-safe way to do this.
  with terms as (
    select nullif(array_to_string(tsvector_to_array(to_tsvector('english', q)), ' | '), '')::tsquery as tq
  ),
  kw as (
    select c.id, row_number() over (
             order by ts_rank_cd(c.fts, t.tq) desc
           ) as rank
    from public.kb_chunks c
    join public.kb_documents d on d.id = c.document_id
    cross join terms t
    where d.enabled and t.tq is not null and c.fts @@ t.tq
    limit greatest(match_count * 4, 40)
  ),
  vec as (
    select c.id, row_number() over (order by c.embedding <=> q_embedding) as rank
    from public.kb_chunks c
    join public.kb_documents d on d.id = c.document_id
    where q_embedding is not null and c.embedding is not null and d.enabled
    limit greatest(match_count * 4, 40)
  ),
  fused as (
    select coalesce(kw.id, vec.id) as id,
           kw.rank as fts_rank, vec.rank as vec_rank,
           coalesce(1.0 / (rrf_k + kw.rank), 0.0)
         + coalesce(1.0 / (rrf_k + vec.rank), 0.0) as score
    from kw full outer join vec on kw.id = vec.id
  )
  select c.id, c.document_id, d.title, d.url, d.kind, c.body,
         f.fts_rank::int, f.vec_rank::int, f.score
  from fused f
  join public.kb_chunks c on c.id = f.id
  join public.kb_documents d on d.id = c.document_id
  order by f.score desc
  limit match_count;
$function$;
    revoke all on function public.kb_search(text, vector, integer, integer) from public, anon, authenticated;
    grant execute on function public.kb_search(text, vector, integer, integer) to service_role;
  end if;
end
$blk$;

-- ---------------------------------------------------------------- the Equity Uprise feed
do $blk$
begin
  if to_regclass('public.feed') is null then
    create table public.feed (
      id uuid not null default gen_random_uuid(),
      created_at timestamp with time zone not null default now(),
      claim text not null,
      context text not null,
      sources jsonb not null default '[]'::jsonb,
      tag text not null default ''::text,
      uid uuid default auth.uid(),
      constraint feed_pkey primary key (id)
    );
    alter table public.feed enable row level security;
    revoke all on table public.feed from public, anon, authenticated, service_role;
    grant all on table public.feed to anon, authenticated, service_role;
    revoke truncate, references, trigger on table public.feed from anon, authenticated;
    create policy feed_file on public.feed for insert to authenticated with check (public.eu_is_admin());
    create policy feed_pull on public.feed for delete to authenticated using (public.eu_is_admin());
    create policy feed_read on public.feed for select to anon, authenticated using (true);
  end if;
end
$blk$;

-- ---------------------------------------------------------------- music direct sales
do $blk$
begin
  if to_regclass('public.music_direct_offers') is null then
    create table public.music_direct_offers (
      offer_key text not null,
      catalog_key text not null,
      title text not null,
      price_cents integer not null,
      currency text not null default 'usd'::text,
      asset_bucket text not null,
      asset_path text not null,
      download_name text not null,
      campaign_key text,
      purpose_statement text,
      active boolean not null default true,
      created_at timestamp with time zone not null default now(),
      updated_at timestamp with time zone not null default now(),
      constraint music_direct_offers_pkey primary key (offer_key),
      constraint music_direct_offers_catalog_key_key unique (catalog_key),
      constraint music_direct_offers_currency_check check ((currency ~ '^[a-z]{3}$'::text)),
      constraint music_direct_offers_offer_key_check check ((offer_key ~ '^[a-z0-9][a-z0-9-]{2,79}$'::text)),
      constraint music_direct_offers_price_cents_check check ((price_cents >= 50))
    );
    alter table public.music_direct_offers enable row level security;
    revoke all on table public.music_direct_offers from public, anon, authenticated;
    grant all on table public.music_direct_offers to service_role;
  end if;

  if to_regclass('public.music_direct_orders') is null then
    create table public.music_direct_orders (
      id uuid not null default gen_random_uuid(),
      offer_key text not null,
      stripe_checkout_session_id text,
      stripe_payment_intent_id text,
      customer_email text,
      amount_cents integer not null,
      currency text not null default 'usd'::text,
      status text not null default 'pending'::text,
      metadata jsonb not null default '{}'::jsonb,
      paid_at timestamp with time zone,
      refunded_at timestamp with time zone,
      created_at timestamp with time zone not null default now(),
      updated_at timestamp with time zone not null default now(),
      constraint music_direct_orders_pkey primary key (id),
      constraint music_direct_orders_stripe_checkout_session_id_key unique (stripe_checkout_session_id),
      constraint music_direct_orders_offer_key_fkey foreign key (offer_key) references public.music_direct_offers(offer_key) on delete restrict,
      constraint music_direct_orders_amount_cents_check check ((amount_cents >= 50)),
      constraint music_direct_orders_currency_check check ((currency ~ '^[a-z]{3}$'::text)),
      constraint music_direct_orders_status_check check ((status = any (array['pending'::text, 'paid'::text, 'refunded'::text, 'failed'::text, 'canceled'::text])))
    );
    create index music_direct_orders_payment_idx on public.music_direct_orders using btree (stripe_payment_intent_id) where (stripe_payment_intent_id is not null);
    create index music_direct_orders_email_idx on public.music_direct_orders using btree (lower(customer_email), created_at desc) where (customer_email is not null);
    alter table public.music_direct_orders enable row level security;
    revoke all on table public.music_direct_orders from public, anon, authenticated;
    grant all on table public.music_direct_orders to service_role;
  end if;

  if to_regclass('public.music_direct_entitlements') is null then
    create table public.music_direct_entitlements (
      id uuid not null default gen_random_uuid(),
      order_id uuid not null,
      offer_key text not null,
      customer_email text,
      token uuid not null default gen_random_uuid(),
      download_count integer not null default 0,
      last_download_at timestamp with time zone,
      revoked_at timestamp with time zone,
      created_at timestamp with time zone not null default now(),
      constraint music_direct_entitlements_pkey primary key (id),
      constraint music_direct_entitlements_order_id_key unique (order_id),
      constraint music_direct_entitlements_token_key unique (token),
      constraint music_direct_entitlements_offer_key_fkey foreign key (offer_key) references public.music_direct_offers(offer_key) on delete restrict,
      constraint music_direct_entitlements_order_id_fkey foreign key (order_id) references public.music_direct_orders(id) on delete cascade
    );
    create index music_direct_entitlements_offer_idx on public.music_direct_entitlements using btree (offer_key, created_at desc) where (revoked_at is null);
    alter table public.music_direct_entitlements enable row level security;
    revoke all on table public.music_direct_entitlements from public, anon, authenticated;
    grant all on table public.music_direct_entitlements to service_role;
  end if;
end
$blk$;

-- ---------------------------------------------------------------- the ISRC registry
do $blk$
begin
  if to_regclass('public.music_isrc_registrants') is null then
    create table public.music_isrc_registrants (
      org_id uuid not null,
      prefix_code text not null default ''::text,
      registrant_type text not null default 'rights_owner'::text,
      active boolean not null default false,
      agency text not null default 'US ISRC Agency'::text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamp with time zone not null default now(),
      updated_at timestamp with time zone not null default now(),
      constraint music_isrc_registrants_pkey primary key (org_id),
      constraint music_isrc_registrants_org_id_fkey foreign key (org_id) references public.orgs(id) on delete cascade,
      constraint music_isrc_prefix_format check (((prefix_code = ''::text) or (prefix_code ~ '^[A-Z]{2}[A-Z0-9]{3}$'::text))),
      constraint music_isrc_registrants_registrant_type_check check ((registrant_type = any (array['rights_owner'::text, 'isrc_manager'::text])))
    );
    alter table public.music_isrc_registrants enable row level security;
    revoke all on table public.music_isrc_registrants from public, anon, authenticated;
    grant all on table public.music_isrc_registrants to service_role;
  end if;

  if to_regclass('public.music_isrc_allocations') is null then
    create table public.music_isrc_allocations (
      id uuid not null default gen_random_uuid(),
      org_id uuid not null,
      recording_id uuid not null,
      isrc text not null,
      year_of_reference smallint not null,
      designation_code integer not null,
      assigned_at timestamp with time zone not null default now(),
      metadata jsonb not null default '{}'::jsonb,
      constraint music_isrc_allocations_pkey primary key (id),
      constraint music_isrc_allocations_isrc_key unique (isrc),
      constraint music_isrc_allocations_org_id_year_of_reference_designation_key unique (org_id, year_of_reference, designation_code),
      constraint music_isrc_allocations_recording_id_key unique (recording_id),
      constraint music_isrc_allocations_org_id_fkey foreign key (org_id) references public.orgs(id) on delete cascade,
      constraint music_isrc_allocations_recording_id_fkey foreign key (recording_id) references public.eu_recordings(id) on delete cascade,
      constraint music_isrc_allocations_designation_code_check check (((designation_code >= 1) and (designation_code <= 99999)))
    );
    alter table public.music_isrc_allocations enable row level security;
    revoke all on table public.music_isrc_allocations from public, anon, authenticated;
    grant all on table public.music_isrc_allocations to service_role;
  end if;

  if to_regprocedure('public.music_assign_isrc(uuid)') is null then
    create function public.music_assign_isrc(p_recording_id uuid)
     returns text
     language plpgsql
     set search_path to 'public'
    as $function$
declare
  v_org uuid;
  v_existing text;
  v_prefix text;
  v_year integer := extract(year from current_date)::integer;
  v_code integer;
  v_isrc text;
begin
  select org_id, nullif(isrc,'') into v_org, v_existing
  from public.eu_recordings where id = p_recording_id for update;
  if v_org is null then raise exception 'recording_not_found'; end if;
  if v_existing is not null then return v_existing; end if;

  select prefix_code into v_prefix
  from public.music_isrc_registrants
  where org_id = v_org and active = true
  for update;
  if v_prefix is null or v_prefix = '' then raise exception 'isrc_prefix_not_configured'; end if;

  select coalesce(max(designation_code),0)+1 into v_code
  from public.music_isrc_allocations
  where org_id = v_org and year_of_reference = v_year;
  if v_code > 99999 then raise exception 'isrc_annual_capacity_exhausted'; end if;

  v_isrc := v_prefix || right(v_year::text,2) || lpad(v_code::text,5,'0');

  insert into public.music_isrc_allocations(org_id, recording_id, isrc, year_of_reference, designation_code)
  values(v_org,p_recording_id,v_isrc,v_year,v_code);

  update public.eu_recordings
  set isrc = v_isrc,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('isrc_assigned_at',now(),'isrc_source','mccluster_registry'),
      updated_at = now()
  where id = p_recording_id;

  return v_isrc;
end;
$function$;
    revoke all on function public.music_assign_isrc(uuid) from public, anon, authenticated;
    grant execute on function public.music_assign_isrc(uuid) to service_role;
  end if;
end
$blk$;

-- ---------------------------------------------------------------- private song chunks
do $blk$
begin
  if to_regclass('public.private_song_asset_chunks') is null then
    create table public.private_song_asset_chunks (
      asset_slug text not null,
      variant text not null,
      chunk_index integer not null,
      data_b64 text not null,
      created_at timestamp with time zone not null default now(),
      constraint private_song_asset_chunks_pkey primary key (asset_slug, variant, chunk_index),
      constraint private_song_asset_chunks_chunk_index_check check ((chunk_index >= 0)),
      constraint private_song_asset_chunks_variant_check check ((variant = any (array['preview'::text, 'full'::text])))
    );
    alter table public.private_song_asset_chunks enable row level security;
    revoke all on table public.private_song_asset_chunks from public, anon, authenticated;
    grant all on table public.private_song_asset_chunks to service_role;
  end if;
end
$blk$;

-- ---------------------------------------------------------------- operations recommendations
do $blk$
begin
  if to_regclass('public.ops_recommendations') is null then
    create table public.ops_recommendations (
      id uuid not null default gen_random_uuid(),
      org_id uuid not null,
      company_id uuid,
      contact_id uuid,
      campaign_id uuid,
      objective_id uuid,
      recommendation_type text not null,
      title text not null,
      rationale text not null,
      proposed_action jsonb not null default '{}'::jsonb,
      confidence numeric(5,4) not null default 0.5000,
      expected_value numeric(12,2),
      status text not null default 'proposed'::text,
      created_at timestamp with time zone not null default now(),
      decided_at timestamp with time zone,
      constraint ops_recommendations_pkey primary key (id),
      constraint ops_recommendations_campaign_id_fkey foreign key (campaign_id) references public.out_campaigns(id) on delete cascade,
      constraint ops_recommendations_company_id_fkey foreign key (company_id) references public.out_companies(id) on delete cascade,
      constraint ops_recommendations_contact_id_fkey foreign key (contact_id) references public.out_contacts(id) on delete cascade,
      constraint ops_recommendations_objective_id_fkey foreign key (objective_id) references public.ops_objectives(id) on delete set null
    );
    create index ops_recommendations_status_idx on public.ops_recommendations using btree (status, created_at desc);
    alter table public.ops_recommendations enable row level security;
    revoke all on table public.ops_recommendations from public, anon, authenticated;
    grant all on table public.ops_recommendations to service_role;
  end if;
end
$blk$;

-- ---------------------------------------------------------------- analytics scratch table
do $blk$
begin
  if to_regclass('public._analytics_baseline_tmp') is null then
    create table public._analytics_baseline_tmp (
      taken_at timestamp with time zone,
      since timestamp with time zone,
      until timestamp with time zone,
      totals text,
      top_pages text,
      top_sources text
    );
    alter table public._analytics_baseline_tmp enable row level security;
    revoke all on table public._analytics_baseline_tmp from public, anon, authenticated;
    grant all on table public._analytics_baseline_tmp to service_role;
  end if;
end
$blk$;

-- ---------------------------------------------------------------- M Network telemetry and graph
do $blk$
begin
  if to_regclass('public.network_sessions') is null then
    create table public.network_sessions (
      id uuid not null default gen_random_uuid(),
      m_uid uuid,
      anonymous_id text,
      source_app_id uuid,
      source_org_id uuid,
      started_at timestamp with time zone not null default now(),
      last_seen_at timestamp with time zone not null default now(),
      campaign jsonb not null default '{}'::jsonb,
      client jsonb not null default '{}'::jsonb,
      constraint network_sessions_pkey primary key (id),
      constraint network_sessions_m_uid_fkey foreign key (m_uid) references public.m_people(id) on delete set null,
      constraint network_sessions_source_app_id_fkey foreign key (source_app_id) references public.platform_apps(id) on delete set null,
      constraint network_sessions_source_org_id_fkey foreign key (source_org_id) references public.orgs(id) on delete set null,
      constraint network_sessions_identity_ck check (((m_uid is not null) or (anonymous_id is not null)))
    );
    create index network_sessions_m_uid_idx on public.network_sessions using btree (m_uid, last_seen_at desc);
    create index network_sessions_anon_idx on public.network_sessions using btree (anonymous_id, last_seen_at desc);
    alter table public.network_sessions enable row level security;
    revoke all on table public.network_sessions from public, anon, authenticated, service_role;
    grant all on table public.network_sessions to anon, authenticated, service_role;
    revoke truncate, references, trigger on table public.network_sessions from anon, authenticated;
    create policy network_sessions_self_insert on public.network_sessions for insert to authenticated
      with check ((m_uid = public.current_m_uid()));
    create policy network_sessions_self_read on public.network_sessions for select to authenticated
      using ((m_uid = public.current_m_uid()));
  end if;

  if to_regclass('public.network_telemetry_events') is null then
    create table public.network_telemetry_events (
      event_id uuid not null default gen_random_uuid(),
      m_uid uuid,
      anonymous_id text,
      session_id uuid,
      source_app_id uuid,
      source_org_id uuid,
      event_name text not null,
      event_version integer not null default 1,
      purpose text not null default 'product'::text,
      object_type text,
      object_id text,
      properties jsonb not null default '{}'::jsonb,
      attribution jsonb not null default '{}'::jsonb,
      occurred_at timestamp with time zone not null default now(),
      ingested_at timestamp with time zone not null default now(),
      constraint network_telemetry_events_pkey primary key (event_id),
      constraint network_telemetry_events_m_uid_fkey foreign key (m_uid) references public.m_people(id) on delete set null,
      constraint network_telemetry_events_session_id_fkey foreign key (session_id) references public.network_sessions(id) on delete set null,
      constraint network_telemetry_events_source_app_id_fkey foreign key (source_app_id) references public.platform_apps(id) on delete set null,
      constraint network_telemetry_events_source_org_id_fkey foreign key (source_org_id) references public.orgs(id) on delete set null,
      constraint network_telemetry_events_purpose_check check ((purpose = any (array['product'::text, 'recommendation'::text, 'measurement'::text, 'security'::text, 'service'::text]))),
      constraint network_telemetry_identity_ck check (((m_uid is not null) or (anonymous_id is not null)))
    );
    create index network_telemetry_m_uid_time_idx on public.network_telemetry_events using btree (m_uid, occurred_at desc);
    create index network_telemetry_app_time_idx on public.network_telemetry_events using btree (source_app_id, occurred_at desc);
    create index network_telemetry_event_name_time_idx on public.network_telemetry_events using btree (event_name, occurred_at desc);
    alter table public.network_telemetry_events enable row level security;
    revoke all on table public.network_telemetry_events from public, anon, authenticated, service_role;
    grant all on table public.network_telemetry_events to anon, authenticated, service_role;
    revoke truncate, references, trigger on table public.network_telemetry_events from anon, authenticated;
    create policy network_telemetry_self_insert on public.network_telemetry_events for insert to authenticated
      with check ((m_uid = public.current_m_uid()));
  end if;

  if to_regclass('public.network_attribution') is null then
    create table public.network_attribution (
      id uuid not null default gen_random_uuid(),
      m_uid uuid,
      anonymous_id text,
      source_app_id uuid,
      source_org_id uuid,
      channel text,
      source text,
      medium text,
      campaign text,
      term text,
      content text,
      referrer text,
      landing_path text,
      first_touch boolean not null default false,
      occurred_at timestamp with time zone not null default now(),
      metadata jsonb not null default '{}'::jsonb,
      constraint network_attribution_pkey primary key (id),
      constraint network_attribution_m_uid_fkey foreign key (m_uid) references public.m_people(id) on delete cascade,
      constraint network_attribution_source_app_id_fkey foreign key (source_app_id) references public.platform_apps(id) on delete set null,
      constraint network_attribution_source_org_id_fkey foreign key (source_org_id) references public.orgs(id) on delete set null,
      constraint network_attribution_identity_ck check (((m_uid is not null) or (anonymous_id is not null)))
    );
    create index network_attribution_m_uid_idx on public.network_attribution using btree (m_uid, occurred_at desc);
    alter table public.network_attribution enable row level security;
    revoke all on table public.network_attribution from public, anon, authenticated, service_role;
    grant all on table public.network_attribution to anon, authenticated, service_role;
    revoke truncate, references, trigger on table public.network_attribution from anon, authenticated;
    create policy network_attribution_self_insert on public.network_attribution for insert to authenticated
      with check ((m_uid = public.current_m_uid()));
  end if;

  if to_regclass('public.network_post_edges') is null then
    create table public.network_post_edges (
      source_post_id uuid not null,
      target_post_id uuid not null,
      edge_type text not null,
      actor_m_uid uuid not null,
      created_at timestamp with time zone not null default now(),
      constraint network_post_edges_pkey primary key (source_post_id, target_post_id, edge_type),
      constraint network_post_edges_actor_m_uid_fkey foreign key (actor_m_uid) references public.m_people(id) on delete cascade,
      constraint network_post_edges_source_post_id_fkey foreign key (source_post_id) references public.network_posts(id) on delete cascade,
      constraint network_post_edges_target_post_id_fkey foreign key (target_post_id) references public.network_posts(id) on delete cascade,
      constraint network_post_edges_edge_type_check check ((edge_type = any (array['reply'::text, 'quote'::text, 'repost'::text])))
    );
    alter table public.network_post_edges enable row level security;
    revoke all on table public.network_post_edges from public, anon, authenticated, service_role;
    grant all on table public.network_post_edges to anon, authenticated, service_role;
    revoke truncate, references, trigger on table public.network_post_edges from anon, authenticated;
    create policy network_post_edges_self_write on public.network_post_edges for insert to authenticated
      with check ((actor_m_uid = public.current_m_uid()));
    create policy network_post_edges_visible on public.network_post_edges for select
      using ((exists ( select 1
   from public.network_posts p
  where (p.id = network_post_edges.target_post_id))));
  end if;

  if to_regclass('public.network_user_features') is null then
    create table public.network_user_features (
      m_uid uuid not null,
      app_usage jsonb not null default '{}'::jsonb,
      topic_affinity jsonb not null default '{}'::jsonb,
      creator_affinity jsonb not null default '{}'::jsonb,
      purchase_categories jsonb not null default '{}'::jsonb,
      engagement jsonb not null default '{}'::jsonb,
      acquisition jsonb not null default '{}'::jsonb,
      conversion jsonb not null default '{}'::jsonb,
      lifecycle jsonb not null default '{}'::jsonb,
      retention jsonb not null default '{}'::jsonb,
      recommendation_features jsonb not null default '{}'::jsonb,
      risk_flags jsonb not null default '{}'::jsonb,
      value_metrics jsonb not null default '{}'::jsonb,
      feature_version integer not null default 1,
      computed_at timestamp with time zone not null default now(),
      updated_at timestamp with time zone not null default now(),
      constraint network_user_features_pkey primary key (m_uid),
      constraint network_user_features_m_uid_fkey foreign key (m_uid) references public.m_people(id) on delete cascade
    );
    alter table public.network_user_features enable row level security;
    revoke all on table public.network_user_features from public, anon, authenticated;
    grant all on table public.network_user_features to service_role;
  end if;

  if to_regclass('public.network_operator_access_log') is null then
    create table public.network_operator_access_log (
      id uuid not null default gen_random_uuid(),
      operator_user_id uuid,
      subject_m_uid uuid,
      action text not null,
      purpose text not null,
      source text not null default 'mnet-operator'::text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamp with time zone not null default now(),
      constraint network_operator_access_log_pkey primary key (id),
      constraint network_operator_access_log_operator_user_id_fkey foreign key (operator_user_id) references auth.users(id) on delete set null,
      constraint network_operator_access_log_subject_m_uid_fkey foreign key (subject_m_uid) references public.m_people(id) on delete set null
    );
    create index network_operator_access_subject_idx on public.network_operator_access_log using btree (subject_m_uid, created_at desc);
    alter table public.network_operator_access_log enable row level security;
    revoke all on table public.network_operator_access_log from public, anon, authenticated;
    grant all on table public.network_operator_access_log to service_role;
  end if;
end
$blk$;

-- ---------------------------------------------------------------- M Network functions and triggers
do $blk$
begin
  if to_regprocedure('public.mnet_feed_item_from_activity()') is null then
    create function public.mnet_feed_item_from_activity()
     returns trigger
     language plpgsql
     security definer
     set search_path to 'public'
    as $function$
begin
  insert into public.network_feed_items(actor_m_uid,source_app_id,source_org_id,item_type,activity_id,visibility,occurred_at,payload)
  values(new.actor_m_uid,new.source_app_id,new.source_org_id,'activity',new.id,new.visibility,new.occurred_at,jsonb_build_object('verb',new.verb,'object_type',new.object_type,'object_id',new.object_id,'summary',new.summary))
  on conflict (activity_id) do update set source_app_id=excluded.source_app_id,source_org_id=excluded.source_org_id,visibility=excluded.visibility,occurred_at=excluded.occurred_at,payload=excluded.payload;
  return new;
end;
$function$;
    revoke all on function public.mnet_feed_item_from_activity() from public, anon, authenticated;
    grant execute on function public.mnet_feed_item_from_activity() to service_role;
  end if;

  if to_regprocedure('public.network_profile_after_auth_link()') is null then
    create function public.network_profile_after_auth_link()
     returns trigger
     language plpgsql
     security definer
     set search_path to 'public'
    as $function$
declare
  v_display text := '';
  v_avatar text := '';
begin
  select coalesce(p.display_name,''), coalesce(p.avatar_url,'')
    into v_display, v_avatar
  from public.platform_profiles p
  where p.user_id = new.auth_user_id;

  insert into public.network_profiles(m_uid, display_name, avatar_url)
  values(new.m_uid, coalesce(v_display,''), coalesce(v_avatar,''))
  on conflict (m_uid) do nothing;
  return new;
end;
$function$;
    revoke all on function public.network_profile_after_auth_link() from public, anon, authenticated;
    grant execute on function public.network_profile_after_auth_link() to service_role;
  end if;

  if to_regprocedure('public.mnet_seed_surface_config()') is null then
    create function public.mnet_seed_surface_config()
     returns trigger
     language plpgsql
     security definer
     set search_path to 'public'
    as $function$
begin
  insert into public.mnet_surface_config(app_id, network_enabled, entry_mode, default_feed_scope, feed_label)
  values(new.id, true, 'profile_then_feed', 'app', coalesce(nullif(new.name,''),'Network'))
  on conflict (app_id) do nothing;
  return new;
end;
$function$;
    revoke all on function public.mnet_seed_surface_config() from public, anon, authenticated;
    grant execute on function public.mnet_seed_surface_config() to service_role;
  end if;

  if to_regprocedure('public.mnet_refresh_user_features(uuid)') is null then
    create function public.mnet_refresh_user_features(p_m_uid uuid)
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public'
    as $function$
declare
  v_events bigint := 0;
  v_days bigint := 0;
  v_last timestamptz;
  v_posts bigint := 0;
  v_reactions bigint := 0;
  v_following bigint := 0;
  v_followers bigint := 0;
  v_first jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  select count(*), count(distinct date(occurred_at)), max(occurred_at)
    into v_events,v_days,v_last from public.network_telemetry_events where m_uid=p_m_uid;
  select count(*) into v_posts from public.network_posts where author_m_uid=p_m_uid and deleted_at is null;
  select count(*) into v_reactions from public.network_reactions where actor_m_uid=p_m_uid;
  select count(*) into v_following from public.network_follows where follower_m_uid=p_m_uid and status='following';
  select count(*) into v_followers from public.network_follows where followed_m_uid=p_m_uid and status='following';
  select coalesce(jsonb_build_object('source',source,'medium',medium,'campaign',campaign,'channel',channel,'occurred_at',occurred_at),'{}'::jsonb)
    into v_first from public.network_attribution where m_uid=p_m_uid order by occurred_at asc limit 1;
  if v_first is null then v_first := '{}'::jsonb; end if;

  insert into public.network_user_features(m_uid,app_usage,engagement,acquisition,lifecycle,computed_at,updated_at)
  values(
    p_m_uid,
    jsonb_build_object('telemetry_events',v_events,'active_days',v_days,'last_event_at',v_last),
    jsonb_build_object('posts',v_posts,'reactions',v_reactions,'following',v_following,'followers',v_followers),
    v_first,
    jsonb_build_object('state',case when v_last is null then 'new' when v_last > now()-interval '7 days' then 'active' when v_last > now()-interval '30 days' then 'cooling' else 'dormant' end),
    now(),now()
  ) on conflict(m_uid) do update set
    app_usage=excluded.app_usage,
    engagement=excluded.engagement,
    acquisition=excluded.acquisition,
    lifecycle=excluded.lifecycle,
    computed_at=now(),updated_at=now();

  select to_jsonb(f) into v_result from public.network_user_features f where f.m_uid=p_m_uid;
  return v_result;
end;
$function$;
    revoke all on function public.mnet_refresh_user_features(uuid) from public, anon, authenticated;
    grant execute on function public.mnet_refresh_user_features(uuid) to service_role;
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.m_auth_user_links'::regclass and tgname = 'network_profile_after_auth_link_trg') then
    create trigger network_profile_after_auth_link_trg after insert on public.m_auth_user_links
      for each row execute function public.network_profile_after_auth_link();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.network_activity'::regclass and tgname = 'network_activity_feed_item_trg') then
    create trigger network_activity_feed_item_trg after insert or update of visibility, source_app_id, source_org_id on public.network_activity
      for each row execute function public.mnet_feed_item_from_activity();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.network_posts'::regclass and tgname = 'network_posts_feed_item_trg') then
    create trigger network_posts_feed_item_trg after insert or update of visibility, source_app_id, source_org_id on public.network_posts
      for each row when ((new.deleted_at is null)) execute function public.mnet_feed_item_from_post();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.platform_apps'::regclass and tgname = 'platform_apps_mnet_surface_trg') then
    create trigger platform_apps_mnet_surface_trg after insert on public.platform_apps
      for each row execute function public.mnet_seed_surface_config();
  end if;
end
$blk$;

-- ---------------------------------------------------------------- policies on tables Git already builds
do $blk$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'control_approvals' and policyname = 'control_approvals_decide') then
    create policy control_approvals_decide on public.control_approvals for update to authenticated
      using (private.is_org_owner(org_id))
      with check ((private.is_org_owner(org_id) and (decided_by = auth.uid()) and (state = any (array['approved'::text, 'denied'::text]))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'control_approvals' and policyname = 'control_approvals_read') then
    create policy control_approvals_read on public.control_approvals for select to authenticated
      using (private.is_org_member(org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'control_approvals' and policyname = 'control_approvals_request') then
    create policy control_approvals_request on public.control_approvals for insert to authenticated
      with check (((requested_by = auth.uid()) and private.is_org_member(org_id) and (state = 'pending'::text) and (decided_by is null)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'control_audit' and policyname = 'control_audit_read') then
    create policy control_audit_read on public.control_audit for select to authenticated
      using (private.is_org_member(org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'control_capabilities' and policyname = 'control_capabilities_read') then
    create policy control_capabilities_read on public.control_capabilities for select to authenticated
      using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'control_commands' and policyname = 'control_commands_read') then
    create policy control_commands_read on public.control_commands for select to authenticated
      using (private.is_org_member(org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'control_leases' and policyname = 'control_leases_read') then
    create policy control_leases_read on public.control_leases for select to authenticated
      using (private.is_org_member(org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'control_role_capabilities' and policyname = 'control_role_capabilities_read') then
    create policy control_role_capabilities_read on public.control_role_capabilities for select to authenticated
      using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mnet_onboarding_state' and policyname = 'mnet_onboarding_self') then
    create policy mnet_onboarding_self on public.mnet_onboarding_state for all to authenticated
      using ((m_uid = public.current_m_uid()))
      with check ((m_uid = public.current_m_uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mnet_surface_config' and policyname = 'mnet_surface_config_auth_read') then
    create policy mnet_surface_config_auth_read on public.mnet_surface_config for select to authenticated
      using ((network_enabled = true));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'network_activity' and policyname = 'network_activity_read') then
    create policy network_activity_read on public.network_activity for select to authenticated
      using (((visibility = 'public'::text) or (actor_m_uid = public.current_m_uid()) or ((visibility = 'network'::text) and (exists ( select 1
   from public.network_follows f
  where ((f.follower_m_uid = public.current_m_uid()) and (f.followed_m_uid = network_activity.actor_m_uid) and (f.status = 'following'::text))))) or ((visibility = 'org'::text) and (source_org_id is not null) and (exists ( select 1
   from public.org_members om
  where ((om.org_id = network_activity.source_org_id) and (om.profile_id = auth.uid())))))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'network_activity' and policyname = 'network_activity_self_insert') then
    create policy network_activity_self_insert on public.network_activity for insert to authenticated
      with check ((actor_m_uid = public.current_m_uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'network_blocks' and policyname = 'network_blocks_self') then
    create policy network_blocks_self on public.network_blocks for all to authenticated
      using ((blocker_m_uid = public.current_m_uid()))
      with check ((blocker_m_uid = public.current_m_uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'network_bookmarks' and policyname = 'network_bookmarks_self') then
    create policy network_bookmarks_self on public.network_bookmarks for all to authenticated
      using ((m_uid = public.current_m_uid()))
      with check ((m_uid = public.current_m_uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'network_connections' and policyname = 'network_connections_self_update') then
    create policy network_connections_self_update on public.network_connections for update to authenticated
      using (((requester_m_uid = public.current_m_uid()) or (addressee_m_uid = public.current_m_uid())))
      with check (((requester_m_uid = public.current_m_uid()) or (addressee_m_uid = public.current_m_uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'network_connections' and policyname = 'network_connections_self_write') then
    create policy network_connections_self_write on public.network_connections for insert to authenticated
      with check ((requester_m_uid = public.current_m_uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'network_feed_items' and policyname = 'network_feed_items_auth_read') then
    create policy network_feed_items_auth_read on public.network_feed_items for select to authenticated
      using (((visibility = 'public'::text) or (actor_m_uid = public.current_m_uid()) or ((visibility = any (array['network'::text, 'followers'::text])) and (exists ( select 1
   from public.network_follows nf
  where ((nf.follower_m_uid = public.current_m_uid()) and (nf.followed_m_uid = network_feed_items.actor_m_uid) and (nf.status = 'following'::text))))) or ((visibility = 'org'::text) and (source_org_id is not null) and (exists ( select 1
   from public.org_members om
  where ((om.org_id = network_feed_items.source_org_id) and (om.profile_id = auth.uid())))))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'network_follows' and policyname = 'network_follows_self_read') then
    create policy network_follows_self_read on public.network_follows for select to authenticated
      using (((follower_m_uid = public.current_m_uid()) or (followed_m_uid = public.current_m_uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'network_follows' and policyname = 'network_follows_self_write') then
    create policy network_follows_self_write on public.network_follows for all to authenticated
      using ((follower_m_uid = public.current_m_uid()))
      with check ((follower_m_uid = public.current_m_uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'network_mutes' and policyname = 'network_mutes_self') then
    create policy network_mutes_self on public.network_mutes for all to authenticated
      using ((muter_m_uid = public.current_m_uid()))
      with check ((muter_m_uid = public.current_m_uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'network_profiles' and policyname = 'network_profiles_self') then
    create policy network_profiles_self on public.network_profiles for all to authenticated
      using ((m_uid = public.current_m_uid()))
      with check ((m_uid = public.current_m_uid()));
  end if;
end
$blk$;

-- ---------------------------------------------------------------- Level 3 storefront storage
do $blk$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('l3-product-files', 'l3-product-files', false, 536870912, null),
         ('l3-public', 'l3-public', true, 52428800, null)
  on conflict (id) do nothing;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'l3_private_staff_select') then
    create policy l3_private_staff_select on storage.objects for select to authenticated
      using (((bucket_id = 'l3-product-files'::text) and public.l3_is_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'l3_private_staff_insert') then
    create policy l3_private_staff_insert on storage.objects for insert to authenticated
      with check (((bucket_id = 'l3-product-files'::text) and public.l3_is_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'l3_private_staff_update') then
    create policy l3_private_staff_update on storage.objects for update to authenticated
      using (((bucket_id = 'l3-product-files'::text) and public.l3_is_staff()))
      with check (((bucket_id = 'l3-product-files'::text) and public.l3_is_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'l3_private_staff_delete') then
    create policy l3_private_staff_delete on storage.objects for delete to authenticated
      using (((bucket_id = 'l3-product-files'::text) and public.l3_is_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'l3_public_staff_insert') then
    create policy l3_public_staff_insert on storage.objects for insert to authenticated
      with check (((bucket_id = 'l3-public'::text) and public.l3_is_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'l3_public_staff_update') then
    create policy l3_public_staff_update on storage.objects for update to authenticated
      using (((bucket_id = 'l3-public'::text) and public.l3_is_staff()))
      with check (((bucket_id = 'l3-public'::text) and public.l3_is_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'l3_public_staff_delete') then
    create policy l3_public_staff_delete on storage.objects for delete to authenticated
      using (((bucket_id = 'l3-public'::text) and public.l3_is_staff()));
  end if;
end
$blk$;
