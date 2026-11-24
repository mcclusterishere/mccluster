-- E=UP ENVIRONMENTAL EVENT STORE, version 1, part 05 of 05 (migration name eup_environment_events_v1_05): the coverage intake.
-- The coverage proposal check and intake: news coverage bound to a published event and its revision.
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
  if to_regprocedure('public.eup_environment_owner_command(uuid, text, text, bigint, text, text, jsonb)') is null then
    raise exception 'eup_environment_events_v1_05: apply eup_environment_events_v1_04 first' using errcode = '55000';
  end if;
end $order$;

-- One coverage proposal checked field by field (no table access): {"ok": false, "reason"} or {"ok": true, "value"}.
-- The basis carries words and identifiers only, never coordinates: a GDELT mention point can never be the evidence.
create or replace function public.eup_environment_coverage_input(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare k text; d jsonb; n numeric; v_url text; v_title text; v_domain text; v_seen timestamptz; v_basis text; host text; ident text; term text;
begin
  if jsonb_typeof(p) is distinct from 'object' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('event_id', 'event_revision', 'article_key', 'url', 'title', 'domain', 'seen_at', 'basis', 'basis_detail') then
      return jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;
  end loop;
  if jsonb_typeof(p -> 'event_id') is distinct from 'string' or jsonb_typeof(p -> 'event_revision') is distinct from 'number'
     or jsonb_typeof(p -> 'article_key') is distinct from 'string' or jsonb_typeof(p -> 'url') is distinct from 'string'
     or jsonb_typeof(p -> 'title') is distinct from 'string' or jsonb_typeof(p -> 'domain') is distinct from 'string'
     or jsonb_typeof(p -> 'basis') is distinct from 'string' or jsonb_typeof(p -> 'basis_detail') is distinct from 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if (p ->> 'event_id') !~ '^(usgs|nws|nhc|eonet|firms|wfigs|coops):[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  n := (p ->> 'event_revision')::numeric;
  if n < 1 or n > 9007199254740991 or n <> trunc(n) then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if length(p ->> 'article_key') < 3 or length(p ->> 'article_key') > 240 or (p ->> 'article_key') ~ '[[:cntrl:][:space:]]' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  v_url := p ->> 'url';
  if length(v_url) > 2000 or v_url !~ '^https://[^[:space:][:cntrl:]]+$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  host := lower(substring(v_url from '^https://([^/:?#@]+)'));
  v_domain := p ->> 'domain';
  if v_domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' or host is distinct from v_domain then
    return jsonb_build_object('ok', false, 'reason', 'domain');
  end if;
  v_title := p ->> 'title';
  if length(v_title) < 1 or length(v_title) > 300 or v_title ~ '[[:cntrl:]]' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  v_seen := public.eup_environment_iso(p -> 'seen_at');
  if v_seen is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  v_basis := p ->> 'basis';
  d := p -> 'basis_detail';
  if v_basis = 'official_identifier' then
    if (select count(*) from jsonb_object_keys(d)) <> 2 or not (d ? 'identifier' and d ? 'found_in')
       or jsonb_typeof(d -> 'identifier') is distinct from 'string' or jsonb_typeof(d -> 'found_in') is distinct from 'string' then
      return jsonb_build_object('ok', false, 'reason', 'basis');
    end if;
    ident := d ->> 'identifier';
    if ident !~ '^[a-z0-9][a-z0-9_]{1,63}$' or (d ->> 'found_in') not in ('url', 'title') then return jsonb_build_object('ok', false, 'reason', 'basis'); end if;
    if position(ident in lower(case when d ->> 'found_in' = 'url' then v_url else v_title end)) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'basis');
    end if;
  elsif v_basis = 'type_place_time' then
    if (select count(*) from jsonb_object_keys(d)) <> 2 or not (d ? 'place_term' and d ? 'type_term')
       or jsonb_typeof(d -> 'place_term') is distinct from 'string' or jsonb_typeof(d -> 'type_term') is distinct from 'string' then
      return jsonb_build_object('ok', false, 'reason', 'basis');
    end if;
    term := d ->> 'place_term';
    if length(term) < 2 or length(term) > 120 or term ~ '[[:cntrl:]]' or (d ->> 'type_term') not in ('earthquake', 'quake', 'tremor', 'temblor', 'seismic')
       or position(lower(term) in lower(v_title)) = 0 or position((d ->> 'type_term') in lower(v_title)) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'basis');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'basis');
  end if;
  return jsonb_build_object('ok', true, 'value', jsonb_build_object('event_id', p ->> 'event_id', 'event_revision', n::bigint,
    'article_key', p ->> 'article_key', 'url', v_url, 'title', v_title, 'domain', v_domain, 'seen_at', public.eup_environment_iso_text(v_seen),
    'basis', v_basis, 'basis_detail', d));
end $$;

-- What a coverage matcher found, one proposal per article and event, idempotent per (event, article). A proposal is
-- accepted only for a published event at its CURRENT revision, and only on a defensible basis: an official identifier
-- that is one of the event's own aliases, found in the article's URL or headline; or the incident type, a place term
-- that is in the provider's own place text and in the headline, and a time within 72 hours after the event. News
-- cannot create, revise or publish an event here. An official-identifier match attaches at once; a type+place+time
-- match waits for the owner (attach_coverage). A rejected proposal, or one the owner retracted, stays so.
create or replace function public.eup_environment_coverage_propose(p_proposals jsonb) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  now_ts timestamptz := clock_timestamp();
  counts jsonb := '{"received":0,"attached":0,"proposed":0,"unchanged":0,"revived":0,"refused":0}'::jsonb;
  results jsonb := '[]'::jsonb; item record; chk jsonb; val jsonb; reason text; target_state text; out_state text; out_id uuid;
  ev public.eup_environment_events%rowtype; cov public.eup_environment_coverage%rowtype; seen timestamptz;
begin
  if jsonb_typeof(p_proposals) is distinct from 'array' then raise exception 'invalid_proposals' using errcode = '22023'; end if;
  if jsonb_array_length(p_proposals) > 500 then raise exception 'invalid_proposals' using errcode = '22023'; end if;
  counts := jsonb_set(counts, '{received}', to_jsonb(jsonb_array_length(p_proposals)));
  for item in select x.value as val, x.ordinality::integer - 1 as idx from jsonb_array_elements(p_proposals) with ordinality x loop
    reason := null; out_state := null; out_id := null;
    chk := public.eup_environment_coverage_input(item.val);
    if not (chk ->> 'ok')::boolean then
      reason := chk ->> 'reason';
    else
      val := chk -> 'value';
      seen := (val ->> 'seen_at')::timestamptz;
      select * into ev from public.eup_environment_events where id = val ->> 'event_id' for update;
      if not found then reason := 'event_not_found';
      elsif ev.state <> 'published' then reason := 'event_not_public';
      elsif ev.revision <> (val ->> 'event_revision')::bigint then reason := 'stale_revision';
      elsif val ->> 'basis' = 'official_identifier' and not exists (
              select 1 from public.eup_environment_event_aliases a
               where a.provider = ev.provider and a.provider_event_id = val -> 'basis_detail' ->> 'identifier'
                 and public.eup_environment_root(a.event_id) = ev.id) then
        reason := 'basis';
      elsif val ->> 'basis' = 'type_place_time' and (
              position(lower(val -> 'basis_detail' ->> 'place_term') in lower(coalesce(ev.snapshot ->> 'place', ''))) = 0
              or seen < ev.observed_at or seen > ev.observed_at + interval '72 hours') then
        reason := 'basis';
      end if;
    end if;
    if reason is not null then
      counts := public.eup_environment_inc(counts, 'refused');
      if jsonb_array_length(results) < 100 then
        results := results || jsonb_build_array(jsonb_build_object('index', item.idx, 'reason', reason));
      end if;
      continue;
    end if;
    target_state := case when val ->> 'basis' = 'official_identifier' then 'attached' else 'proposed' end;
    select * into cov from public.eup_environment_coverage c where c.event_id = ev.id and c.article_key = val ->> 'article_key' for update;
    if not found then
      insert into public.eup_environment_coverage (event_id, event_revision, article_key, url, title, domain, seen_at, basis, basis_detail,
          state, decided_at)
        values (ev.id, ev.revision, val ->> 'article_key', val ->> 'url', val ->> 'title', val ->> 'domain', seen, val ->> 'basis',
          val -> 'basis_detail', target_state, case when target_state = 'attached' then now_ts end)
        returning id into out_id;
      out_state := target_state;
      counts := public.eup_environment_inc(counts, target_state);
    elsif cov.state = 'rejected' or (cov.state = 'retracted' and cov.decided_by is not null)
          or (cov.event_revision = ev.revision and (cov.state = 'attached' or (cov.state = 'proposed' and target_state = 'proposed'))) then
      out_state := cov.state; out_id := cov.id;
      counts := public.eup_environment_inc(counts, 'unchanged');
    else
      update public.eup_environment_coverage
         set event_revision = ev.revision, url = val ->> 'url', title = val ->> 'title', domain = val ->> 'domain', seen_at = seen,
             basis = val ->> 'basis', basis_detail = val -> 'basis_detail', state = target_state, decided_by = null,
             decided_at = case when target_state = 'attached' then now_ts end, decision_seq = null, updated_at = now_ts
       where id = cov.id;
      out_state := target_state; out_id := cov.id;
      counts := public.eup_environment_inc(counts, 'revived');
    end if;
    if jsonb_array_length(results) < 100 then
      results := results || jsonb_build_array(jsonb_build_object('index', item.idx, 'id', out_id, 'state', out_state));
    end if;
  end loop;
  return jsonb_build_object('schema', 'mccluster.environment-coverage/v1', 'counts', counts, 'results', results);
end $$;

revoke all on function public.eup_environment_coverage_input(jsonb), public.eup_environment_coverage_propose(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.eup_environment_coverage_propose(jsonb) to service_role;
commit;
