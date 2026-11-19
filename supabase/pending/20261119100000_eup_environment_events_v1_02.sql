-- E=UP ENVIRONMENTAL EVENT STORE, version 1, part 02 of 05 (migration name eup_environment_events_v1_02): the reads.
-- The helpers that read the store, the D6 change rule, the public timeline page and event read (gated by the
-- environment module policy) and the owner's preview of that page.
-- The design, the decisions (D5, D6, D7, D12, defaults adopted pending the owner's confirmation) and the codes are in
-- part 01's header (20261119100000_eup_environment_events_v1_01.sql) and docs/control-plane/EUP-EVENT-TIMELINE.md.
-- PENDING. Not applied to production. Owner approval required. Applied only on the owner's separate approval of the exact
-- text of each part, independent of and after the mission publish (step 9 of docs/control-plane/WORLD-RELEASE-20261118.md),
-- with the Supabase MCP `apply_migration` (it runs as postgres) under the part's migration name, parts 01 to 05 in order,
-- one call per part and a read between parts; then promoted with the steps in supabase/pending/README.md.
-- Order and procedure: supabase/pending/PROMOTION-ORDER.md, section 12. Rollback (every part, however many ran):
-- 20261119100000_eup_environment_events_v1.rollback.sql. Proof before apply: scripts/test/eup-environment-events.integration.mjs
-- (PGlite) and scripts/test/eup-environment-events.native.integration.mjs (disposable PostgreSQL 16 and 17).
-- Applying it changes nothing public: it creates no row, and every public read still refuses until the owner installs
-- and enables the environment module. One transaction, safe to run twice.
begin;
set local lock_timeout = '5s';

do $order$
begin
  if to_regclass('public.eup_environment_coverage') is null or to_regprocedure('public.eup_environment_guard()') is null then
    raise exception 'eup_environment_events_v1_02: apply eup_environment_events_v1_01 first' using errcode = '55000';
  end if;
end $order$;

-- The house organisation when p_actor is one of its owners, else null: the module policy's own owner rule.
create or replace function public.eup_environment_house_owner(p_actor uuid) returns uuid
language sql stable security invoker set search_path = '' as $$
  select o.id from public.org_members mm join public.orgs o on o.id = mm.org_id
   where p_actor is not null and o.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner'
   limit 1
$$;

-- Follow merge redirects to the event that stands (at most 16 hops); null for an unknown id.
create or replace function public.eup_environment_root(p_id text) returns text
language plpgsql stable security invoker set search_path = '' as $$
declare cur text := p_id; nxt text; hops integer := 0;
begin
  loop
    select e.merged_into into nxt from public.eup_environment_events e where e.id = cur;
    if not found then return null; end if;
    if nxt is null then return cur; end if;
    hops := hops + 1;
    if hops > 16 then raise exception 'merge_chain_too_long' using errcode = 'EUE04'; end if;
    cur := nxt;
  end loop;
end $$;

-- The public read is gated by the same persisted policy as every public E=Up route: no house, no row, or a disabled
-- module refuses; draining still answers reads, as the pinned product's own module-policy rules do.
create or replace function public.eup_environment_gate() returns void
language plpgsql stable security invoker set search_path = '' as $$
declare house uuid; st text;
begin
  select o.id into house from public.orgs o where o.slug = 'mccluster' limit 1;
  if house is null then raise exception 'module_policy_unavailable' using errcode = 'EUM00'; end if;
  select p.state into st from public.eup_module_policies p where p.org_id = house and p.module_id = 'environment';
  if st is null then raise exception 'module_not_installed' using errcode = 'EUM01'; end if;
  if st not in ('enabled', 'draining') then raise exception 'module_disabled' using errcode = 'EUM03'; end if;
end $$;

-- Attached coverage only, newest first, ten at most; whitelisted fields.
create or replace function public.eup_environment_public_coverage(p_event text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('title', c.title, 'url', c.url, 'domain', c.domain,
      'seen_at', public.eup_environment_iso_text(c.seen_at), 'basis', c.basis,
      'decided_at', public.eup_environment_iso_text(c.decided_at), 'event_revision', c.event_revision)
      order by c.seen_at desc, c.id), '[]'::jsonb)
    from (select * from public.eup_environment_coverage x where x.event_id = p_event and x.state = 'attached'
           order by x.seen_at desc, x.id limit 10) c
$$;

-- The public shape of one event: the whitelist. A published event carries its correction (the current revision's
-- change, when it is one) and its attached coverage; a tombstone carries no coordinates, depth or coverage. Anything
-- else (never published, held, merged) has no public shape.
create or replace function public.eup_environment_project(p_id text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare e public.eup_environment_events%rowtype; s jsonb; corr jsonb;
begin
  select * into e from public.eup_environment_events where id = p_id;
  if not found or e.first_published_at is null then return null; end if;
  s := e.snapshot;
  if e.state = 'published' then
    select jsonb_build_object('revision', r.revision, 'cause', r.cause, 'changes', r.changes,
             'recorded_at', public.eup_environment_iso_text(r.recorded_at))
      into corr from public.eup_environment_event_revisions r
     where r.event_id = e.id and r.revision = e.revision and r.cause in ('source_revised', 'source_restored', 'owner_rollback');
    return jsonb_build_object('id', e.id, 'revision', e.revision, 'provider', e.provider, 'kind', e.kind, 'state', e.state,
      'title', s -> 'title', 'place', s -> 'place', 'magnitude', s -> 'magnitude', 'magnitude_type', s -> 'magnitude_type',
      'depth_km', s -> 'depth_km', 'lon', s -> 'lon', 'lat', s -> 'lat', 'observed_at', s -> 'observed_at',
      'review_status', s -> 'status', 'tsunami', s -> 'tsunami', 'alert', s -> 'alert',
      'source', jsonb_build_object('id', s -> 'provider_event_id', 'url', s -> 'source_url',
        'updated_at', public.eup_environment_iso_text(e.source_updated_at), 'fetched_at', public.eup_environment_iso_text(e.fetched_at)),
      'first_published_at', public.eup_environment_iso_text(e.first_published_at),
      'revised_at', public.eup_environment_iso_text(e.revised_at),
      'correction', corr,
      'news_coverage', public.eup_environment_public_coverage(e.id));
  end if;
  if e.state in ('withdrawn_by_source', 'retracted') then
    return jsonb_build_object('id', e.id, 'revision', e.revision, 'provider', e.provider, 'kind', e.kind, 'state', e.state,
      'title', s -> 'title', 'place', s -> 'place', 'magnitude', s -> 'magnitude', 'magnitude_type', s -> 'magnitude_type',
      'observed_at', s -> 'observed_at',
      'source', jsonb_build_object('id', s -> 'provider_event_id', 'url', s -> 'source_url'),
      'first_published_at', public.eup_environment_iso_text(e.first_published_at),
      'withdrawn_at', case when e.state = 'withdrawn_by_source' then public.eup_environment_iso_text(e.withdrawn_at) end,
      'retracted_at', case when e.state = 'retracted' then public.eup_environment_iso_text(e.retracted_at) end);
  end if;
  return null;
end $$;

-- One page of the timeline, newest observation first: published events and tombstones of events that were published,
-- from providers that are shown. Keyset cursor '<observed microseconds since 1970>|<id>'.
create or replace function public.eup_environment_page(p_since timestamptz, p_until timestamptz, p_cursor text, p_limit integer)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  since_ts timestamptz := coalesce(p_since, '-infinity'::timestamptz);
  until_ts timestamptz := coalesce(p_until, now() + interval '1 day');
  c_ts timestamptz; c_id text; m text[]; out_rows jsonb := '[]'::jsonb; n integer := 0;
  last_ts timestamptz; last_id text; next_cursor text; r record;
begin
  if since_ts >= until_ts then raise exception 'invalid_window' using errcode = '22023'; end if;
  if p_cursor is not null then
    m := regexp_match(p_cursor, '^(-?[0-9]{1,17})[|]((usgs|nws|nhc|eonet|firms|wfigs|coops):[A-Za-z0-9][A-Za-z0-9_.:-]{0,190})$');
    if m is null then raise exception 'invalid_cursor' using errcode = '22023'; end if;
    c_ts := 'epoch'::timestamptz + m[1]::bigint * interval '1 microsecond';
    c_id := m[2];
  end if;
  for r in
    select e.id, e.observed_at from public.eup_environment_events e
      join public.eup_environment_providers p on p.provider = e.provider and p.publication = 'shown'
     where e.first_published_at is not null and e.state in ('published', 'withdrawn_by_source', 'retracted')
       and e.observed_at >= since_ts and e.observed_at < until_ts
       and (c_ts is null or (e.observed_at, e.id) < (c_ts, c_id))
     order by e.observed_at desc, e.id desc
     limit lim + 1
  loop
    n := n + 1;
    if n > lim then
      next_cursor := (extract(epoch from last_ts) * 1000000)::bigint::text || '|' || last_id;
      exit;
    end if;
    out_rows := out_rows || jsonb_build_array(public.eup_environment_project(r.id));
    last_ts := r.observed_at; last_id := r.id;
  end loop;
  return jsonb_build_object('schema', 'mccluster.environment-events/v1', 'events', out_rows, 'next_cursor', next_cursor);
end $$;

-- What the owner sees of one event (never a public answer).
create or replace function public.eup_environment_owner_summary(p_id text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare e public.eup_environment_events%rowtype; rule jsonb;
begin
  select * into e from public.eup_environment_events where id = p_id;
  if not found then return null; end if;
  select p.rule into rule from public.eup_environment_providers p where p.provider = e.provider;
  return jsonb_build_object('id', e.id, 'state', e.state, 'revision', e.revision, 'provider', e.provider,
    'provider_event_id', e.provider_event_id, 'observed_at', public.eup_environment_iso_text(e.observed_at),
    'magnitude', e.snapshot -> 'magnitude', 'magnitude_type', e.snapshot -> 'magnitude_type', 'place', e.snapshot -> 'place',
    'review_status', e.snapshot -> 'status', 'significance', e.significance,
    'qualifies', public.eup_environment_qualifies(e.provider, rule, e.snapshot, e.significance),
    'first_published_at', public.eup_environment_iso_text(e.first_published_at),
    'revised_at', public.eup_environment_iso_text(e.revised_at), 'held_at', public.eup_environment_iso_text(e.held_at),
    'retracted_at', public.eup_environment_iso_text(e.retracted_at), 'withdrawn_at', public.eup_environment_iso_text(e.withdrawn_at),
    'merged_into', e.merged_into, 'source_updated_at', public.eup_environment_iso_text(e.source_updated_at),
    'fetched_at', public.eup_environment_iso_text(e.fetched_at), 'state_changed_at', public.eup_environment_iso_text(e.state_changed_at));
end $$;

-- What a new revision or a withdrawal does to the event's coverage. p_retract: every live row is retracted (a
-- withdrawal, a merge, an owner retraction; decided_by stays null, so a matcher may bring it back if the event returns).
-- Otherwise (a new content revision): type+place+time matches go stale until a matcher re-proposes them and the owner
-- approves again; official-identifier matches follow the revision (the identifier still names this event).
create or replace function public.eup_environment_coverage_follow(p_event text, p_revision bigint, p_retract boolean, p_decision bigint)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer := 0; m integer := 0;
begin
  if p_retract then
    update public.eup_environment_coverage set state = 'retracted', decided_by = null, decided_at = clock_timestamp(),
           decision_seq = p_decision, updated_at = clock_timestamp()
     where event_id = p_event and state in ('proposed', 'attached', 'stale');
    get diagnostics n = row_count;
    return n;
  end if;
  update public.eup_environment_coverage set state = 'stale', updated_at = clock_timestamp()
   where event_id = p_event and basis = 'type_place_time' and state in ('proposed', 'attached');
  get diagnostics n = row_count;
  update public.eup_environment_coverage set event_revision = p_revision, updated_at = clock_timestamp()
   where event_id = p_event and basis = 'official_identifier' and state = 'attached' and event_revision < p_revision;
  get diagnostics m = row_count;
  return n + m;
end $$;

-- D6: the substantive changes between two USGS snapshots, as {"<field>": {"from": ..., "to": ...}}; {} when none.
create or replace function public.eup_environment_usgs_changes(p_old jsonb, p_new jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare c jsonb := '{}'::jsonb; o_t timestamptz; n_t timestamptz; km double precision; o_d numeric; n_d numeric; f text;
begin
  o_t := (p_old ->> 'observed_at')::timestamptz; n_t := (p_new ->> 'observed_at')::timestamptz;
  if o_t is distinct from n_t then
    if o_t is null or n_t is null or abs(extract(epoch from (n_t - o_t))) >= 1 then
      c := c || jsonb_build_object('observed_at', jsonb_build_object('from', p_old -> 'observed_at', 'to', p_new -> 'observed_at'));
    end if;
  end if;
  if (p_old -> 'lon', p_old -> 'lat') is distinct from (p_new -> 'lon', p_new -> 'lat') then
    km := public.eup_environment_km((p_old ->> 'lon')::numeric, (p_old ->> 'lat')::numeric, (p_new ->> 'lon')::numeric, (p_new ->> 'lat')::numeric);
    if km is null or km >= 1 then
      c := c || jsonb_build_object('location', jsonb_build_object('from', jsonb_build_array(p_old -> 'lon', p_old -> 'lat'),
        'to', jsonb_build_array(p_new -> 'lon', p_new -> 'lat'), 'km', round(coalesce(km, 0)::numeric, 1)));
    end if;
  end if;
  o_d := (p_old ->> 'depth_km')::numeric; n_d := (p_new ->> 'depth_km')::numeric;
  if o_d is distinct from n_d then
    if o_d is null or n_d is null or abs(n_d - o_d) >= 1 then
      c := c || jsonb_build_object('depth_km', jsonb_build_object('from', p_old -> 'depth_km', 'to', p_new -> 'depth_km'));
    end if;
  end if;
  foreach f in array array['magnitude', 'magnitude_type', 'status', 'tsunami', 'alert'] loop
    if (p_old -> f) is distinct from (p_new -> f) then
      c := c || jsonb_build_object(f, jsonb_build_object('from', coalesce(p_old -> f, 'null'::jsonb), 'to', coalesce(p_new -> f, 'null'::jsonb)));
    end if;
  end loop;
  return c;
end $$;

-- The public timeline page. Gated: no house EUM00, the environment module not installed EUM01, disabled EUM03.
create or replace function public.eup_environment_public_events(p_since timestamptz default null, p_until timestamptz default null,
  p_cursor text default null, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.eup_environment_gate();
  return public.eup_environment_page(p_since, p_until, p_cursor, p_limit);
end $$;

-- One event for a deep link, by canonical id or by any alias ('<provider>:<provider id>'), following merge redirects.
-- status: 'published' | 'withdrawn_by_source' | 'retracted' (each with the event and its correction history),
-- 'not_available' (held, or its provider hidden) or 'not_found' (unknown, or never published). Same gate as the page.
create or replace function public.eup_environment_public_event(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cid text; root text; e public.eup_environment_events%rowtype; pub text; hist jsonb;
begin
  perform public.eup_environment_gate();
  if p_id is null or p_id !~ '^(usgs|nws|nhc|eonet|firms|wfigs|coops):[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$' then
    return jsonb_build_object('schema', 'mccluster.environment-event/v1', 'status', 'not_found', 'id', null, 'redirected_from', null, 'event', null);
  end if;
  select x.id into cid from public.eup_environment_events x where x.id = p_id;
  if cid is null then
    select a.event_id into cid from public.eup_environment_event_aliases a
     where a.provider = split_part(p_id, ':', 1) and a.provider_event_id = substr(p_id, length(split_part(p_id, ':', 1)) + 2);
  end if;
  root := public.eup_environment_root(cid);
  if root is not null then select * into e from public.eup_environment_events where id = root; end if;
  if root is null or e.first_published_at is null then
    return jsonb_build_object('schema', 'mccluster.environment-event/v1', 'status', 'not_found', 'id', p_id, 'redirected_from', null, 'event', null);
  end if;
  select p.publication into pub from public.eup_environment_providers p where p.provider = e.provider;
  if pub is distinct from 'shown' or e.state = 'held' then
    return jsonb_build_object('schema', 'mccluster.environment-event/v1', 'status', 'not_available', 'id', e.id,
      'redirected_from', case when p_id <> e.id then p_id end, 'event', null);
  end if;
  if e.state not in ('published', 'withdrawn_by_source', 'retracted') then
    return jsonb_build_object('schema', 'mccluster.environment-event/v1', 'status', 'not_found', 'id', p_id, 'redirected_from', null, 'event', null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('revision', h.revision, 'cause', h.cause, 'changes', h.changes,
           'recorded_at', public.eup_environment_iso_text(h.recorded_at)) order by h.revision desc), '[]'::jsonb)
    into hist
    from (select * from public.eup_environment_event_revisions r
           where r.event_id = e.id and r.cause in ('source_revised', 'source_deleted', 'source_restored', 'owner_rollback')
           order by r.revision desc limit 50) h;
  return jsonb_build_object('schema', 'mccluster.environment-event/v1', 'status', e.state, 'id', e.id,
    'redirected_from', case when p_id <> e.id then p_id end,
    'event', public.eup_environment_project(e.id) || jsonb_build_object('history', hist));
end $$;

-- The owner's preview of the public page: the same projection, whatever the module's state (decision D11; an
-- authorization addition that ships only with the owner's approval of the pull request that calls it).
create or replace function public.eup_environment_owner_preview(p_actor uuid, p_since timestamptz default null,
  p_until timestamptz default null, p_cursor text default null, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.eup_environment_house_owner(p_actor) is null then raise exception 'House owner required' using errcode = '42501'; end if;
  return public.eup_environment_page(p_since, p_until, p_cursor, p_limit);
end $$;

revoke all on function public.eup_environment_house_owner(uuid), public.eup_environment_root(text), public.eup_environment_gate(),
  public.eup_environment_public_coverage(text), public.eup_environment_project(text),
  public.eup_environment_page(timestamptz, timestamptz, text, integer), public.eup_environment_owner_summary(text),
  public.eup_environment_coverage_follow(text, bigint, boolean, bigint), public.eup_environment_usgs_changes(jsonb, jsonb),
  public.eup_environment_public_events(timestamptz, timestamptz, text, integer), public.eup_environment_public_event(text),
  public.eup_environment_owner_preview(uuid, timestamptz, timestamptz, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.eup_environment_public_events(timestamptz, timestamptz, text, integer),
  public.eup_environment_public_event(text), public.eup_environment_owner_preview(uuid, timestamptz, timestamptz, text, integer)
  to service_role;
commit;
