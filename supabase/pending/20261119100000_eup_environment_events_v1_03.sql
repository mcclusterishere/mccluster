-- E=UP ENVIRONMENTAL EVENT STORE, version 1, part 03 of 05 (migration name eup_environment_events_v1_03): the ingest.
-- The USGS input check and the ingest: one call per run, idempotent per run id, one health row per run.
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
  if to_regprocedure('public.eup_environment_public_event(text)') is null then
    raise exception 'eup_environment_events_v1_03: apply eup_environment_events_v1_02 first' using errcode = '55000';
  end if;
end $order$;

-- One USGS event as the Worker's normaliser hands it over, checked field by field. Answers
-- {"ok": false, "reason": "<field>"} or {"ok": true, "deleted": ..., "provider_event_id", "aliases", "source_updated_at",
-- "significance", "snapshot"}. A deletion needs only provider_id and status 'deleted' (USGS answers a deleted id with 409
-- or, with includedeleted, a record whose place is null).
create or replace function public.eup_environment_usgs_input(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  id_re constant text := '^[a-z0-9][a-z0-9_]{1,63}$';
  k text; v jsonb; pid text; st text; aliases jsonb; t_obs timestamptz; t_upd timestamptz;
  lon numeric; lat numeric; depth numeric; mag numeric; mtype text; place text; title text; url text;
  sig integer; alert text; tsu boolean; net text; code text; n numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' then return jsonb_build_object('ok', false, 'reason', 'not_an_object'); end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('provider_id', 'aliases', 'status', 'observed_at', 'source_updated_at', 'lon', 'lat', 'depth_km', 'magnitude',
                 'magnitude_type', 'place', 'title', 'source_url', 'significance', 'alert', 'tsunami', 'net', 'code') then
      return jsonb_build_object('ok', false, 'reason', 'unknown_field');
    end if;
  end loop;
  if jsonb_typeof(p -> 'provider_id') is distinct from 'string' then return jsonb_build_object('ok', false, 'reason', 'provider_id'); end if;
  pid := p ->> 'provider_id';
  if pid !~ id_re then return jsonb_build_object('ok', false, 'reason', 'provider_id'); end if;
  if jsonb_typeof(p -> 'status') is distinct from 'string' then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
  st := p ->> 'status';
  if st not in ('automatic', 'reviewed', 'deleted') then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
  v := p -> 'aliases';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'aliases'); end if;
    if jsonb_array_length(v) > 50 then return jsonb_build_object('ok', false, 'reason', 'aliases'); end if;
    for k in select jsonb_typeof(x) || ':' || coalesce(x #>> '{}', '') from jsonb_array_elements(v) x loop
      if k !~ '^string:[a-z0-9][a-z0-9_]{1,63}$' then return jsonb_build_object('ok', false, 'reason', 'aliases'); end if;
    end loop;
  end if;
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into aliases from (
    select pid as x
    union
    select a from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) a) s;
  v := p -> 'source_updated_at';
  if v is not null and jsonb_typeof(v) <> 'null' then
    t_upd := public.eup_environment_iso(v);
    if t_upd is null then return jsonb_build_object('ok', false, 'reason', 'source_updated_at'); end if;
  end if;
  if st = 'deleted' then
    return jsonb_build_object('ok', true, 'deleted', true, 'provider_event_id', pid, 'aliases', aliases,
      'source_updated_at', public.eup_environment_iso_text(t_upd));
  end if;
  t_obs := public.eup_environment_iso(p -> 'observed_at');
  if t_obs is null then return jsonb_build_object('ok', false, 'reason', 'observed_at'); end if;
  if jsonb_typeof(p -> 'lon') is distinct from 'number' or jsonb_typeof(p -> 'lat') is distinct from 'number' then
    return jsonb_build_object('ok', false, 'reason', 'coordinates');
  end if;
  lon := (p ->> 'lon')::numeric; lat := (p ->> 'lat')::numeric;
  if lon < -180 or lon > 180 or lat < -90 or lat > 90 then return jsonb_build_object('ok', false, 'reason', 'coordinates'); end if;
  v := p -> 'depth_km';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'number' then return jsonb_build_object('ok', false, 'reason', 'depth_km'); end if;
    depth := (v #>> '{}')::numeric;
    if depth < -10 or depth > 800 then return jsonb_build_object('ok', false, 'reason', 'depth_km'); end if;
  end if;
  v := p -> 'magnitude';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'number' then return jsonb_build_object('ok', false, 'reason', 'magnitude'); end if;
    mag := (v #>> '{}')::numeric;
    if mag < -2 or mag > 10.5 then return jsonb_build_object('ok', false, 'reason', 'magnitude'); end if;
  end if;
  v := p -> 'magnitude_type';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'string' then return jsonb_build_object('ok', false, 'reason', 'magnitude_type'); end if;
    mtype := lower(v #>> '{}');
    if mtype !~ '^[a-z][a-z0-9_]{0,11}$' then return jsonb_build_object('ok', false, 'reason', 'magnitude_type'); end if;
  end if;
  v := p -> 'place';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'string' then return jsonb_build_object('ok', false, 'reason', 'place'); end if;
    place := v #>> '{}';
    if length(place) < 1 or length(place) > 200 or place ~ '[[:cntrl:]]' then return jsonb_build_object('ok', false, 'reason', 'place'); end if;
  end if;
  v := p -> 'title';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'string' then return jsonb_build_object('ok', false, 'reason', 'title'); end if;
    title := v #>> '{}';
    if length(title) < 1 or length(title) > 200 or title ~ '[[:cntrl:]]' then return jsonb_build_object('ok', false, 'reason', 'title'); end if;
  end if;
  if jsonb_typeof(p -> 'source_url') is distinct from 'string' then return jsonb_build_object('ok', false, 'reason', 'source_url'); end if;
  url := p ->> 'source_url';
  if length(url) > 300 or url !~ '^https://earthquake[.]usgs[.]gov/[A-Za-z0-9/_.?=&%-]*$' then
    return jsonb_build_object('ok', false, 'reason', 'source_url');
  end if;
  v := p -> 'significance';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'number' then return jsonb_build_object('ok', false, 'reason', 'significance'); end if;
    n := (v #>> '{}')::numeric;
    if n < 0 or n > 10000 or n <> trunc(n) then return jsonb_build_object('ok', false, 'reason', 'significance'); end if;
    sig := n::integer;
  end if;
  v := p -> 'alert';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'string' then return jsonb_build_object('ok', false, 'reason', 'alert'); end if;
    alert := v #>> '{}';
    if alert not in ('green', 'yellow', 'orange', 'red') then return jsonb_build_object('ok', false, 'reason', 'alert'); end if;
  end if;
  if jsonb_typeof(p -> 'tsunami') is distinct from 'boolean' then return jsonb_build_object('ok', false, 'reason', 'tsunami'); end if;
  tsu := (p ->> 'tsunami')::boolean;
  v := p -> 'net';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'string' then return jsonb_build_object('ok', false, 'reason', 'net'); end if;
    net := v #>> '{}';
    if net !~ '^[a-z0-9]{1,10}$' then return jsonb_build_object('ok', false, 'reason', 'net'); end if;
  end if;
  v := p -> 'code';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'string' then return jsonb_build_object('ok', false, 'reason', 'code'); end if;
    code := v #>> '{}';
    if code !~ '^[a-z0-9_]{1,40}$' then return jsonb_build_object('ok', false, 'reason', 'code'); end if;
  end if;
  return jsonb_build_object('ok', true, 'deleted', false, 'provider_event_id', pid, 'aliases', aliases,
    'source_updated_at', public.eup_environment_iso_text(t_upd), 'significance', sig,
    'snapshot', jsonb_build_object('provider_event_id', pid, 'status', st, 'observed_at', public.eup_environment_iso_text(t_obs),
      'lon', trim_scale(round(lon, 5)), 'lat', trim_scale(round(lat, 5)), 'depth_km', trim_scale(round(depth, 3)),
      'magnitude', trim_scale(round(mag, 2)), 'magnitude_type', mtype, 'place', place, 'title', title, 'tsunami', tsu,
      'alert', alert, 'significance', sig, 'source_url', url, 'net', net, 'code', code));
end $$;

-- One ingest run of one provider, in one transaction, idempotent per run id: the same run id with the same payload
-- returns the stored receipt and writes nothing; with another payload it is refused (EUE05). Runs of one provider queue
-- behind each other. Each event resolves through the aliases; a new one is inserted at revision 1 (published at once
-- when it qualifies); a known one gets a new revision only for a substantive change (D6), while USGS `updated`,
-- significance and a new preferred id are refreshed without one; an event listing ids of two stored events merges them;
-- a deletion withdraws (tombstone); a known id that comes back undeleted is restored. An invalid event is refused alone
-- and named in the receipt; one ingest call never applies two different provider events to one canonical event
-- ('alias_conflict'). Exactly one health row per run. A paused provider records only its health row.
create or replace function public.eup_environment_ingest(p_provider text, p_run_id text, p_fetched_at timestamptz,
  p_health jsonb, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  now_ts timestamptz := clock_timestamp();
  pol public.eup_environment_providers%rowtype;
  prior public.eup_environment_source_health%rowtype;
  ev public.eup_environment_events%rowtype;
  counts jsonb := '{"received":0,"inserted":0,"revised":0,"refreshed":0,"unchanged":0,"published":0,"withdrawn":0,"restored":0,"merged":0,"refused":0,"conflicts":0,"unknown_deletions":0,"dropped":0}'::jsonb;
  refusals jsonb := '[]'::jsonb; touched jsonb := '{}'::jsonb;
  digest text; k text; v jsonb; hstatus text; hreason text; hhttp integer; hgen timestamptz; hdropped integer := 0; run_status text;
  item record; inp jsonb; snap jsonb; pid text; sig integer; upd timestamptz; roots text[]; target text; survivor text; r text;
  ch jsonb; new_aliases integer; qual boolean; meta boolean; receipt jsonb; n numeric;
begin
  if p_provider is null or p_provider not in ('usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops') then
    raise exception 'provider_refused' using errcode = 'EUE07';
  end if;
  if p_provider <> 'usgs' then raise exception 'provider_not_supported' using errcode = 'EUE07'; end if;
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9._:-]{8,128}$' or p_fetched_at is null
     or p_fetched_at > now_ts + interval '5 minutes' or p_fetched_at < now_ts - interval '2 days'
     or jsonb_typeof(p_health) is distinct from 'object' or jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'invalid_ingest' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 2000 or octet_length(p_events::text) > 4000000 then
    raise exception 'invalid_ingest' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_health) loop
    if k not in ('status', 'reason', 'http_status', 'upstream_generated_at', 'dropped') then
      raise exception 'invalid_ingest' using errcode = '22023';
    end if;
  end loop;
  hstatus := case when jsonb_typeof(p_health -> 'status') = 'string' then p_health ->> 'status' end;
  if hstatus is null or hstatus not in ('ok', 'unavailable') then raise exception 'invalid_ingest' using errcode = '22023'; end if;
  v := p_health -> 'reason';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'string' then raise exception 'invalid_ingest' using errcode = '22023'; end if;
    if (v #>> '{}') !~ '^[a-z][a-z0-9_]{0,63}$' then raise exception 'invalid_ingest' using errcode = '22023'; end if;
    hreason := v #>> '{}';
  end if;
  v := p_health -> 'http_status';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'number' then raise exception 'invalid_ingest' using errcode = '22023'; end if;
    n := (v #>> '{}')::numeric;
    if n < 100 or n > 599 or n <> trunc(n) then raise exception 'invalid_ingest' using errcode = '22023'; end if;
    hhttp := n::integer;
  end if;
  v := p_health -> 'upstream_generated_at';
  if v is not null and jsonb_typeof(v) <> 'null' then
    hgen := public.eup_environment_iso(v);
    if hgen is null then raise exception 'invalid_ingest' using errcode = '22023'; end if;
  end if;
  v := p_health -> 'dropped';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'number' then raise exception 'invalid_ingest' using errcode = '22023'; end if;
    n := (v #>> '{}')::numeric;
    if n < 0 or n > 100000 or n <> trunc(n) then raise exception 'invalid_ingest' using errcode = '22023'; end if;
    hdropped := n::integer;
  end if;
  -- an outage names its reason and carries no events; a successful read carries no reason
  if (hstatus = 'unavailable') <> (hreason is not null) or (hstatus = 'unavailable' and jsonb_array_length(p_events) > 0) then
    raise exception 'invalid_ingest' using errcode = '22023';
  end if;
  digest := encode(sha256(convert_to(concat_ws('|', p_provider, p_run_id, extract(epoch from p_fetched_at)::text, p_health::text,
    p_events::text), 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(1163219040, hashtext('ingest:' || p_provider));
  select * into prior from public.eup_environment_source_health h where h.provider = p_provider and h.run_id = p_run_id;
  if found then
    if prior.payload_digest <> digest then raise exception 'run_conflict' using errcode = 'EUE05'; end if;
    return prior.receipt;
  end if;
  select * into pol from public.eup_environment_providers p where p.provider = p_provider for share;
  if not found then raise exception 'provider_not_configured' using errcode = 'EUE01'; end if;
  counts := jsonb_set(jsonb_set(counts, '{received}', to_jsonb(jsonb_array_length(p_events))), '{dropped}', to_jsonb(hdropped));
  if pol.ingest = 'paused' then
    run_status := 'paused';
  elsif hstatus = 'unavailable' then
    run_status := 'unavailable';
  else
    run_status := case when jsonb_array_length(p_events) = 0 then 'empty' else 'ok' end;
    for item in select x.value as val, x.ordinality::integer - 1 as idx from jsonb_array_elements(p_events) with ordinality x loop
      inp := public.eup_environment_usgs_input(item.val);
      if not (inp ->> 'ok')::boolean then
        counts := public.eup_environment_inc(counts, 'refused');
        if jsonb_array_length(refusals) < 20 then
          refusals := refusals || jsonb_build_array(jsonb_build_object('index', item.idx, 'reason', inp ->> 'reason'));
        end if;
        continue;
      end if;
      pid := inp ->> 'provider_event_id';
      upd := (inp ->> 'source_updated_at')::timestamptz;
      select array_agg(distinct s.x order by s.x) into roots from (
        select public.eup_environment_root(a.event_id) as x from public.eup_environment_event_aliases a
         where a.provider = p_provider and a.provider_event_id in (select jsonb_array_elements_text(inp -> 'aliases'))) s
       where s.x is not null;
      if roots is not null and exists (select 1 from unnest(roots) x where touched ? x) then
        if (select bool_and(touched ->> x = pid) from unnest(roots) x where touched ? x) then
          counts := public.eup_environment_inc(counts, 'unchanged');
        else
          counts := public.eup_environment_inc(counts, 'conflicts');
          if jsonb_array_length(refusals) < 20 then
            refusals := refusals || jsonb_build_array(jsonb_build_object('index', item.idx, 'reason', 'alias_conflict'));
          end if;
        end if;
        continue;
      end if;

      if (inp ->> 'deleted')::boolean then
        if roots is null then
          counts := public.eup_environment_inc(counts, 'unknown_deletions');
          continue;
        end if;
        foreach target in array roots loop
          touched := touched || jsonb_build_object(target, pid);
          select * into ev from public.eup_environment_events where id = target for update;
          if ev.withdrawn_at is not null then
            counts := public.eup_environment_inc(counts, 'unchanged');
            continue;
          end if;
          snap := ev.snapshot || jsonb_build_object('status', 'deleted');
          insert into public.eup_environment_event_revisions (event_id, revision, cause, snapshot, changes, source_updated_at, fetched_at, run_id)
            values (ev.id, ev.revision + 1, 'source_deleted', snap,
                    jsonb_build_object('status', jsonb_build_object('from', coalesce(ev.snapshot -> 'status', 'null'::jsonb), 'to', 'deleted')),
                    coalesce(upd, ev.source_updated_at), p_fetched_at, p_run_id);
          update public.eup_environment_events
             set revision = revision + 1, snapshot = snap, withdrawn_at = now_ts, revised_at = now_ts,
                 source_updated_at = coalesce(upd, source_updated_at), fetched_at = p_fetched_at,
                 state = public.eup_environment_state_of(merged_into, held_at, retracted_at, now_ts, first_published_at),
                 state_changed_at = case when public.eup_environment_state_of(merged_into, held_at, retracted_at, now_ts, first_published_at) <> state
                                         then now_ts else state_changed_at end
           where id = ev.id;
          perform public.eup_environment_coverage_follow(ev.id, ev.revision + 1, true, null);
          counts := public.eup_environment_inc(counts, 'withdrawn');
        end loop;
        continue;
      end if;

      snap := inp -> 'snapshot';
      sig := (inp ->> 'significance')::integer;
      target := p_provider || ':' || pid;
      if roots is null and exists (select 1 from public.eup_environment_events where id = target) then
        roots := array[public.eup_environment_root(target)];
      end if;
      if roots is null then
        qual := public.eup_environment_qualifies(p_provider, pol.rule, snap, sig);
        insert into public.eup_environment_events (id, provider, kind, state, revision, provider_event_id, snapshot, significance,
            observed_at, source_updated_at, fetched_at, revised_at, first_published_at, state_changed_at)
          values (target, p_provider, 'earthquake', case when qual then 'published' else 'candidate' end, 1, pid, snap, sig,
            (snap ->> 'observed_at')::timestamptz, upd, p_fetched_at, now_ts, case when qual then now_ts end, now_ts);
        insert into public.eup_environment_event_revisions (event_id, revision, cause, snapshot, changes, source_updated_at, fetched_at, run_id)
          values (target, 1, 'source_first_seen', snap, '{}'::jsonb, upd, p_fetched_at, p_run_id);
        insert into public.eup_environment_event_aliases (provider, provider_event_id, event_id)
          select p_provider, a, target from jsonb_array_elements_text(inp -> 'aliases') a
          on conflict (provider, provider_event_id) do nothing;
        touched := touched || jsonb_build_object(target, pid);
        counts := public.eup_environment_inc(counts, 'inserted');
        if qual then counts := public.eup_environment_inc(counts, 'published'); end if;
        continue;
      end if;

      if cardinality(roots) > 1 then
        -- the provider now lists ids of two or more stored events as one: the earliest published stands, the others redirect
        perform 1 from public.eup_environment_events where id = any (roots) order by id for update;
        select e.id into survivor from public.eup_environment_events e where e.id = any (roots)
         order by e.first_published_at asc nulls last, e.created_at asc, e.id asc limit 1;
        foreach r in array roots loop
          continue when r = survivor;
          select * into ev from public.eup_environment_events where id = r;
          insert into public.eup_environment_event_revisions (event_id, revision, cause, snapshot, changes, source_updated_at, fetched_at, run_id)
            values (r, ev.revision + 1, 'source_merged', ev.snapshot,
                    jsonb_build_object('merged_into', jsonb_build_object('from', 'null'::jsonb, 'to', survivor),
                                       'state', jsonb_build_object('from', ev.state, 'to', 'merged')),
                    ev.source_updated_at, p_fetched_at, p_run_id);
          update public.eup_environment_events
             set revision = revision + 1, merged_into = survivor, revised_at = now_ts, state = 'merged', state_changed_at = now_ts
           where id = r;
          perform public.eup_environment_coverage_follow(r, ev.revision + 1, true, null);
          touched := touched || jsonb_build_object(r, pid);
          counts := public.eup_environment_inc(counts, 'merged');
        end loop;
        target := survivor;
      else
        target := roots[1];
      end if;
      touched := touched || jsonb_build_object(target, pid);
      select * into ev from public.eup_environment_events where id = target for update;
      insert into public.eup_environment_event_aliases (provider, provider_event_id, event_id)
        select p_provider, a, target from jsonb_array_elements_text(inp -> 'aliases') a
        on conflict (provider, provider_event_id) do nothing;
      get diagnostics new_aliases = row_count;
      ch := public.eup_environment_usgs_changes(ev.snapshot, snap);

      if ev.withdrawn_at is not null then
        -- the provider brought a withdrawn event back
        qual := ev.first_published_at is null and ev.held_at is null and ev.retracted_at is null
                and public.eup_environment_qualifies(p_provider, pol.rule, snap, sig);
        insert into public.eup_environment_event_revisions (event_id, revision, cause, snapshot, changes, source_updated_at, fetched_at, run_id)
          values (target, ev.revision + 1, 'source_restored', snap, ch, upd, p_fetched_at, p_run_id);
        update public.eup_environment_events
           set revision = revision + 1, snapshot = snap, withdrawn_at = null, provider_event_id = pid, significance = sig,
               observed_at = (snap ->> 'observed_at')::timestamptz, source_updated_at = upd, fetched_at = p_fetched_at,
               revised_at = now_ts, first_published_at = case when qual then now_ts else first_published_at end,
               state = public.eup_environment_state_of(merged_into, held_at, retracted_at, null,
                         case when qual then now_ts else first_published_at end),
               state_changed_at = now_ts
         where id = target;
        perform public.eup_environment_coverage_follow(target, ev.revision + 1, false, null);
        counts := public.eup_environment_inc(counts, 'restored');
        if qual then counts := public.eup_environment_inc(counts, 'published'); end if;
        continue;
      end if;

      qual := ev.first_published_at is null and ev.held_at is null and ev.retracted_at is null
              and public.eup_environment_qualifies(p_provider, pol.rule, case when ch <> '{}'::jsonb then snap else ev.snapshot end, sig);
      meta := ev.source_updated_at is distinct from upd or ev.provider_event_id <> pid or ev.significance is distinct from sig;
      if ch <> '{}'::jsonb then
        insert into public.eup_environment_event_revisions (event_id, revision, cause, snapshot, changes, source_updated_at, fetched_at, run_id)
          values (target, ev.revision + 1, 'source_revised', snap, ch, upd, p_fetched_at, p_run_id);
        update public.eup_environment_events
           set revision = revision + 1, snapshot = snap, provider_event_id = pid, significance = sig,
               observed_at = (snap ->> 'observed_at')::timestamptz, source_updated_at = upd, fetched_at = p_fetched_at,
               revised_at = now_ts, first_published_at = case when qual then now_ts else first_published_at end,
               state = public.eup_environment_state_of(merged_into, held_at, retracted_at, withdrawn_at,
                         case when qual then now_ts else first_published_at end),
               state_changed_at = case when qual then now_ts else state_changed_at end
         where id = target;
        perform public.eup_environment_coverage_follow(target, ev.revision + 1, false, null);
        counts := public.eup_environment_inc(counts, 'revised');
      elsif meta or qual then
        update public.eup_environment_events
           set provider_event_id = pid, significance = sig, source_updated_at = upd, fetched_at = p_fetched_at,
               first_published_at = case when qual then now_ts else first_published_at end,
               state = public.eup_environment_state_of(merged_into, held_at, retracted_at, withdrawn_at,
                         case when qual then now_ts else first_published_at end),
               state_changed_at = case when qual then now_ts else state_changed_at end
         where id = target;
        counts := public.eup_environment_inc(counts, 'refreshed');
      elsif new_aliases > 0 then
        counts := public.eup_environment_inc(counts, 'refreshed');
      else
        counts := public.eup_environment_inc(counts, 'unchanged');
      end if;
      if qual then counts := public.eup_environment_inc(counts, 'published'); end if;
    end loop;
  end if;
  receipt := jsonb_build_object('schema', 'mccluster.environment-ingest/v1', 'provider', p_provider, 'run_id', p_run_id,
    'status', run_status, 'counts', counts, 'refusals', refusals, 'fetched_at', public.eup_environment_iso_text(p_fetched_at),
    'recorded_at', public.eup_environment_iso_text(now_ts));
  insert into public.eup_environment_source_health (provider, run_id, status, reason, http_status, upstream_generated_at, fetched_at,
      counts, payload_digest, receipt)
    values (p_provider, p_run_id, run_status, hreason, hhttp, hgen, p_fetched_at, counts, digest, receipt);
  -- bounded retention: this provider's health rows older than 30 days leave here, 500 per run at most
  perform set_config('eup.environment_health_purge', 'on', true);
  delete from public.eup_environment_source_health h
   where h.seq in (select h2.seq from public.eup_environment_source_health h2
                    where h2.provider = p_provider and h2.recorded_at < now() - interval '30 days' order by h2.seq limit 500);
  perform set_config('eup.environment_health_purge', '', true);
  return receipt;
end $$;

revoke all on function public.eup_environment_usgs_input(jsonb), public.eup_environment_ingest(text, text, timestamptz, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.eup_environment_ingest(text, text, timestamptz, jsonb, jsonb) to service_role;
commit;
