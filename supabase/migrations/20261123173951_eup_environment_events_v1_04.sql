-- E=UP ENVIRONMENTAL EVENT STORE, version 1, part 04 of 05 (migration name eup_environment_events_v1_04): the owner's read and commands.
-- The house owner's view (providers, health, review queue, decisions) and the owner's commands, each logged.
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
  if to_regprocedure('public.eup_environment_ingest(text, text, timestamptz, jsonb, jsonb)') is null then
    raise exception 'eup_environment_events_v1_04: apply eup_environment_events_v1_03 first' using errcode = '55000';
  end if;
end $order$;

-- The owner's view: the module row, every provider (configured or not) with its rule, last run and last success, the
-- recent health log, the review queue (candidates, held, retracted, withdrawn, merged, corrected, coverage awaiting a
-- decision) and the recent decisions; with p_event_id (canonical id or alias), that event in full.
create or replace function public.eup_environment_owner_read(p_actor uuid, p_event_id text default null, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare house uuid; lim integer := least(greatest(coalesce(p_limit, 50), 1), 200); res jsonb; cid text; e public.eup_environment_events%rowtype;
begin
  house := public.eup_environment_house_owner(p_actor);
  if house is null then raise exception 'House owner required' using errcode = '42501'; end if;
  res := jsonb_build_object(
    'schema', 'mccluster.environment-owner/v1',
    'module', coalesce((select jsonb_build_object('installed', true, 'state', m.state, 'revision', m.revision)
                          from public.eup_module_policies m where m.org_id = house and m.module_id = 'environment'),
                       jsonb_build_object('installed', false)),
    'providers', (select jsonb_agg(jsonb_build_object(
        'provider', v.provider, 'configured', p.provider is not null, 'supported', v.provider = 'usgs',
        'ingest', p.ingest, 'publication', p.publication, 'rule', p.rule, 'revision', coalesce(p.revision, 0),
        'default_rule', public.eup_environment_default_rule(v.provider),
        'updated_at', public.eup_environment_iso_text(p.updated_at), 'updated_by', p.updated_by,
        'last_run', (select jsonb_build_object('seq', h.seq, 'run_id', h.run_id, 'status', h.status, 'reason', h.reason,
              'http_status', h.http_status, 'fetched_at', public.eup_environment_iso_text(h.fetched_at),
              'upstream_generated_at', public.eup_environment_iso_text(h.upstream_generated_at), 'counts', h.counts,
              'recorded_at', public.eup_environment_iso_text(h.recorded_at))
            from public.eup_environment_source_health h where h.provider = v.provider order by h.seq desc limit 1),
        'last_success_at', (select public.eup_environment_iso_text(max(h.fetched_at)) from public.eup_environment_source_health h
                             where h.provider = v.provider and h.status in ('ok', 'empty')),
        'events', coalesce((select jsonb_object_agg(s.state, s.n) from (select x.state, count(*) as n from public.eup_environment_events x
                             where x.provider = v.provider group by x.state) s), '{}'::jsonb)
      ) order by v.ord)
      from (values (1, 'usgs'), (2, 'nws'), (3, 'nhc'), (4, 'eonet'), (5, 'firms'), (6, 'wfigs'), (7, 'coops')) v(ord, provider)
      left join public.eup_environment_providers p on p.provider = v.provider),
    'health', coalesce((select jsonb_agg(jsonb_build_object('seq', h.seq, 'provider', h.provider, 'run_id', h.run_id, 'status', h.status,
          'reason', h.reason, 'http_status', h.http_status, 'fetched_at', public.eup_environment_iso_text(h.fetched_at),
          'upstream_generated_at', public.eup_environment_iso_text(h.upstream_generated_at), 'counts', h.counts,
          'refusals', h.receipt -> 'refusals', 'recorded_at', public.eup_environment_iso_text(h.recorded_at)) order by h.seq desc)
        from (select * from public.eup_environment_source_health x order by x.seq desc limit lim) h), '[]'::jsonb),
    'review', jsonb_build_object(
      'candidates', coalesce((select jsonb_agg(public.eup_environment_owner_summary(x.id) order by x.observed_at desc, x.id desc)
          from (select y.id, y.observed_at from public.eup_environment_events y where y.state = 'candidate'
                 order by y.observed_at desc, y.id desc limit lim) x), '[]'::jsonb),
      'held', coalesce((select jsonb_agg(public.eup_environment_owner_summary(x.id) order by x.t desc, x.id desc)
          from (select y.id, y.state_changed_at as t from public.eup_environment_events y where y.state = 'held'
                 order by y.state_changed_at desc, y.id desc limit lim) x), '[]'::jsonb),
      'retracted', coalesce((select jsonb_agg(public.eup_environment_owner_summary(x.id) order by x.t desc, x.id desc)
          from (select y.id, y.state_changed_at as t from public.eup_environment_events y where y.state = 'retracted'
                 order by y.state_changed_at desc, y.id desc limit lim) x), '[]'::jsonb),
      'withdrawn', coalesce((select jsonb_agg(public.eup_environment_owner_summary(x.id) order by x.t desc, x.id desc)
          from (select y.id, y.withdrawn_at as t from public.eup_environment_events y where y.state = 'withdrawn_by_source'
                 order by y.withdrawn_at desc, y.id desc limit lim) x), '[]'::jsonb),
      'merged', coalesce((select jsonb_agg(public.eup_environment_owner_summary(x.id) order by x.t desc, x.id desc)
          from (select y.id, y.state_changed_at as t from public.eup_environment_events y where y.state = 'merged'
                 order by y.state_changed_at desc, y.id desc limit lim) x), '[]'::jsonb),
      'corrected', coalesce((select jsonb_agg(public.eup_environment_owner_summary(x.id) order by x.t desc, x.id desc)
          from (select y.id, y.revised_at as t from public.eup_environment_events y where y.state = 'published' and y.revision > 1
                 order by y.revised_at desc, y.id desc limit lim) x), '[]'::jsonb),
      'coverage', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'event_id', c.event_id, 'event_revision', c.event_revision,
            'state', c.state, 'basis', c.basis, 'basis_detail', c.basis_detail, 'title', c.title, 'url', c.url, 'domain', c.domain,
            'seen_at', public.eup_environment_iso_text(c.seen_at), 'proposed_at', public.eup_environment_iso_text(c.proposed_at))
            order by c.proposed_at desc, c.id)
          from (select * from public.eup_environment_coverage y where y.state in ('proposed', 'stale')
                 order by y.proposed_at desc, y.id limit lim) c), '[]'::jsonb)),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('seq', d.seq, 'command', d.command, 'target_kind', d.target_kind,
          'target_id', d.target_id, 'expected_revision', d.expected_revision, 'reason', d.reason, 'actor', d.actor,
          'idempotency_key', d.idempotency_key, 'payload', d.payload, 'prior', d.prior, 'receipt', d.receipt,
          'created_at', public.eup_environment_iso_text(d.created_at)) order by d.seq desc)
        from (select * from public.eup_environment_decisions y where y.org_id = house order by y.seq desc limit lim) d), '[]'::jsonb));
  if p_event_id is not null then
    select x.id into cid from public.eup_environment_events x where x.id = p_event_id;
    if cid is null and p_event_id ~ '^(usgs|nws|nhc|eonet|firms|wfigs|coops):' then
      select a.event_id into cid from public.eup_environment_event_aliases a
       where a.provider = split_part(p_event_id, ':', 1) and a.provider_event_id = substr(p_event_id, length(split_part(p_event_id, ':', 1)) + 2);
    end if;
    if cid is null then
      res := res || jsonb_build_object('event', null);
    else
      select * into e from public.eup_environment_events where id = cid;
      res := res || jsonb_build_object('event', jsonb_build_object(
        'summary', public.eup_environment_owner_summary(e.id),
        'root', public.eup_environment_root(e.id),
        'snapshot', e.snapshot,
        'public', public.eup_environment_project(e.id),
        'revisions', coalesce((select jsonb_agg(jsonb_build_object('revision', r.revision, 'cause', r.cause, 'snapshot', r.snapshot,
              'changes', r.changes, 'source_updated_at', public.eup_environment_iso_text(r.source_updated_at),
              'fetched_at', public.eup_environment_iso_text(r.fetched_at), 'run_id', r.run_id, 'decision_seq', r.decision_seq,
              'recorded_at', public.eup_environment_iso_text(r.recorded_at)) order by r.revision desc)
            from (select * from public.eup_environment_event_revisions y where y.event_id = e.id order by y.revision desc limit 200) r), '[]'::jsonb),
        'aliases', coalesce((select jsonb_agg(jsonb_build_object('provider_event_id', a.provider_event_id,
              'first_seen_at', public.eup_environment_iso_text(a.first_seen_at)) order by a.first_seen_at, a.provider_event_id)
            from public.eup_environment_event_aliases a where a.event_id = e.id), '[]'::jsonb),
        'merged_from', coalesce((select jsonb_agg(y.id order by y.id) from public.eup_environment_events y where y.merged_into = e.id), '[]'::jsonb),
        'coverage', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'event_revision', c.event_revision, 'state', c.state,
              'basis', c.basis, 'basis_detail', c.basis_detail, 'title', c.title, 'url', c.url, 'domain', c.domain,
              'seen_at', public.eup_environment_iso_text(c.seen_at), 'decided_by', c.decided_by,
              'decided_at', public.eup_environment_iso_text(c.decided_at), 'decision_seq', c.decision_seq,
              'proposed_at', public.eup_environment_iso_text(c.proposed_at)) order by c.proposed_at desc, c.id)
            from public.eup_environment_coverage c where c.event_id = e.id), '[]'::jsonb),
        'decisions', coalesce((select jsonb_agg(jsonb_build_object('seq', d.seq, 'command', d.command, 'target_kind', d.target_kind,
              'target_id', d.target_id, 'expected_revision', d.expected_revision, 'reason', d.reason, 'actor', d.actor,
              'receipt', d.receipt, 'created_at', public.eup_environment_iso_text(d.created_at)) order by d.seq desc)
            from (select * from public.eup_environment_decisions y
                   where y.org_id = house and ((y.target_kind = 'event' and y.target_id = e.id)
                      or (y.target_kind = 'coverage' and y.target_id in (select c.id::text from public.eup_environment_coverage c where c.event_id = e.id)))
                   order by y.seq desc limit 100) d), '[]'::jsonb)));
    end if;
  end if;
  return res;
end $$;

-- An owner decision, with the module policy's command rules: the house owner only (42501), a reason of 1-500
-- characters, an idempotency key (the same key and the same command return the stored receipt; another command under
-- that key is EUE06), the target's current revision as the expected revision (40001 when it moved; 0 configures a
-- provider), and an append-only log row for every accepted command, including one that changes nothing.
--   events (target: canonical id; expected: the event's revision): hold, release, retract, restore, and rollback with
--     {"to_revision": N}, which makes revision N's content the new current revision (cause 'owner_rollback'). An ingest
--     that still sees the source differ will revise it again: pause the provider first when the source itself is wrong.
--   providers (target: 'usgs'; expected: the policy's revision, 0 when not configured): set_rule {"rule": {...}} (no rule:
--     the D7 default), pause_provider, resume_provider (the ingest), hide_provider, show_provider (the public view).
--   coverage (target: coverage id; expected: the event's revision): attach_coverage (a proposal for the current
--     revision), reject_coverage (sticks: a matcher cannot bring it back), retract_coverage.
create or replace function public.eup_environment_owner_command(p_actor uuid, p_command text, p_target text,
  p_expected_revision bigint, p_key text, p_reason text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  now_ts timestamptz := clock_timestamp();
  house uuid; target_kind text; payload jsonb := coalesce(p_payload, '{}'::jsonb); digest text; k text; n numeric;
  prior_row public.eup_environment_decisions%rowtype; ev public.eup_environment_events%rowtype;
  pol public.eup_environment_providers%rowtype; cov public.eup_environment_coverage%rowtype; old_rev public.eup_environment_event_revisions%rowtype;
  pol_found boolean := false; rule jsonb; to_rev bigint; changed boolean := false; prior jsonb; result jsonb; receipt jsonb; dec_seq bigint;
  n_held timestamptz; n_retracted timestamptz; n_first timestamptz; cov_event text; ch jsonb;
begin
  house := public.eup_environment_house_owner(p_actor);
  if house is null then raise exception 'House owner required' using errcode = '42501'; end if;
  target_kind := case when p_command in ('hold', 'release', 'retract', 'restore', 'rollback') then 'event'
                      when p_command in ('pause_provider', 'resume_provider', 'hide_provider', 'show_provider', 'set_rule') then 'provider'
                      when p_command in ('attach_coverage', 'reject_coverage', 'retract_coverage') then 'coverage' end;
  if target_kind is null or p_target is null or length(p_target) < 1 or length(p_target) > 200 or p_target ~ '[[:cntrl:][:space:]]'
     or p_expected_revision is null or p_expected_revision < 0 or p_key is null or p_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_reason is null or length(p_reason) < 1 or length(p_reason) > 500 or p_reason ~ '[[:cntrl:]]'
     or jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'invalid_command' using errcode = '22023';
  end if;
  if octet_length(payload::text) > 2000 then raise exception 'invalid_command' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(payload) loop
    if not ((p_command = 'rollback' and k = 'to_revision') or (p_command = 'set_rule' and k = 'rule')) then
      raise exception 'invalid_command' using errcode = '22023';
    end if;
  end loop;
  if p_command = 'rollback' then
    if jsonb_typeof(payload -> 'to_revision') is distinct from 'number' then raise exception 'invalid_command' using errcode = '22023'; end if;
    n := (payload ->> 'to_revision')::numeric;
    if n < 1 or n > 9007199254740991 or n <> trunc(n) then raise exception 'invalid_command' using errcode = '22023'; end if;
    to_rev := n::bigint;
  end if;
  if p_command = 'set_rule' then
    rule := case when payload ? 'rule' then payload -> 'rule' else public.eup_environment_default_rule(p_target) end;
  end if;
  digest := encode(sha256(convert_to(concat_ws('|', p_actor::text, p_command, p_target, p_expected_revision::text, p_reason,
    payload::text), 'UTF8')), 'hex');
  -- one key at a time: a concurrent identical command waits here and then replays
  perform pg_advisory_xact_lock(1163219041, hashtext(house::text || ':' || p_key));
  select * into prior_row from public.eup_environment_decisions d where d.org_id = house and d.idempotency_key = p_key;
  if found then
    if prior_row.payload_digest <> digest then raise exception 'command_conflict' using errcode = 'EUE06'; end if;
    return prior_row.receipt;
  end if;

  if target_kind = 'event' then
    select * into ev from public.eup_environment_events where id = p_target for update;
    if not found then raise exception 'event_not_found' using errcode = 'EUE03'; end if;
    if ev.revision <> p_expected_revision then raise exception 'revision_conflict' using errcode = '40001'; end if;
    if ev.merged_into is not null then raise exception 'invalid_transition' using errcode = 'EUE04'; end if;
    select * into pol from public.eup_environment_providers p where p.provider = ev.provider;
    prior := jsonb_build_object('state', ev.state, 'revision', ev.revision);
    n_held := ev.held_at; n_retracted := ev.retracted_at; n_first := ev.first_published_at;
    if p_command = 'hold' then
      if ev.retracted_at is not null then raise exception 'invalid_transition' using errcode = 'EUE04'; end if;
      changed := ev.held_at is null;
      if changed then n_held := now_ts; end if;
    elsif p_command = 'release' then
      changed := ev.held_at is not null;
      if changed then n_held := null; end if;
    elsif p_command = 'retract' then
      changed := ev.retracted_at is null;
      if changed then n_retracted := now_ts; n_held := null; end if;
    elsif p_command = 'restore' then
      changed := ev.retracted_at is not null;
      if changed then n_retracted := null; end if;
    else
      if ev.withdrawn_at is not null then raise exception 'invalid_transition' using errcode = 'EUE04'; end if;
      if to_rev >= ev.revision then raise exception 'invalid_command' using errcode = '22023'; end if;
      select * into old_rev from public.eup_environment_event_revisions r where r.event_id = ev.id and r.revision = to_rev;
      if old_rev.cause in ('source_deleted', 'source_merged') then raise exception 'invalid_transition' using errcode = 'EUE04'; end if;
      changed := old_rev.snapshot is distinct from ev.snapshot;
    end if;
    if changed and p_command in ('release', 'restore') and n_first is null and n_held is null and n_retracted is null
       and ev.withdrawn_at is null and public.eup_environment_qualifies(ev.provider, pol.rule,
             ev.snapshot, ev.significance) then
      n_first := now_ts;
    end if;
    result := jsonb_build_object('state', public.eup_environment_state_of(ev.merged_into, n_held, n_retracted, ev.withdrawn_at, n_first),
      'revision', case when changed and p_command = 'rollback' then ev.revision + 1 else ev.revision end);
  elsif target_kind = 'provider' then
    if p_target not in ('usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops') then raise exception 'provider_refused' using errcode = 'EUE07'; end if;
    if p_target <> 'usgs' then raise exception 'provider_not_supported' using errcode = 'EUE07'; end if;
    select * into pol from public.eup_environment_providers p where p.provider = p_target for update;
    pol_found := found;
    if p_command = 'set_rule' then
      if not coalesce(public.eup_environment_rule_valid(p_target, rule), false) then raise exception 'invalid_command' using errcode = '22023'; end if;
      if not pol_found then
        if p_expected_revision <> 0 then raise exception 'revision_conflict' using errcode = '40001'; end if;
        prior := jsonb_build_object('configured', false, 'revision', 0);
        changed := true;
        result := jsonb_build_object('ingest', 'active', 'publication', 'shown', 'rule', rule, 'revision', 1);
      else
        if pol.revision <> p_expected_revision then raise exception 'revision_conflict' using errcode = '40001'; end if;
        prior := jsonb_build_object('configured', true, 'ingest', pol.ingest, 'publication', pol.publication, 'rule', pol.rule, 'revision', pol.revision);
        changed := pol.rule is distinct from rule;
        result := jsonb_build_object('ingest', pol.ingest, 'publication', pol.publication, 'rule', rule,
          'revision', pol.revision + case when changed then 1 else 0 end);
      end if;
    else
      if not pol_found then raise exception 'provider_not_configured' using errcode = 'EUE01'; end if;
      if pol.revision <> p_expected_revision then raise exception 'revision_conflict' using errcode = '40001'; end if;
      prior := jsonb_build_object('configured', true, 'ingest', pol.ingest, 'publication', pol.publication, 'rule', pol.rule, 'revision', pol.revision);
      changed := case p_command when 'pause_provider' then pol.ingest = 'active' when 'resume_provider' then pol.ingest = 'paused'
                                when 'hide_provider' then pol.publication = 'shown' else pol.publication = 'hidden' end;
      result := jsonb_build_object(
        'ingest', case when changed and p_command = 'pause_provider' then 'paused' when changed and p_command = 'resume_provider' then 'active' else pol.ingest end,
        'publication', case when changed and p_command = 'hide_provider' then 'hidden' when changed and p_command = 'show_provider' then 'shown' else pol.publication end,
        'rule', pol.rule, 'revision', pol.revision + case when changed then 1 else 0 end);
    end if;
  else
    if p_target !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'coverage_not_found' using errcode = 'EUE03';
    end if;
    select c.event_id into cov_event from public.eup_environment_coverage c where c.id = p_target::uuid;
    if cov_event is null then raise exception 'coverage_not_found' using errcode = 'EUE03'; end if;
    select * into ev from public.eup_environment_events where id = cov_event for update;
    select * into cov from public.eup_environment_coverage where id = p_target::uuid for update;
    if ev.revision <> p_expected_revision then raise exception 'revision_conflict' using errcode = '40001'; end if;
    prior := jsonb_build_object('state', cov.state, 'event_revision', cov.event_revision, 'event_state', ev.state);
    if p_command = 'attach_coverage' then
      if cov.state = 'attached' then changed := false;
      elsif cov.state <> 'proposed' or cov.event_revision <> ev.revision or ev.state <> 'published' then
        raise exception 'invalid_transition' using errcode = 'EUE04';
      else changed := true;
      end if;
    elsif p_command = 'reject_coverage' then
      if cov.state = 'rejected' then changed := false;
      elsif cov.state = 'retracted' then raise exception 'invalid_transition' using errcode = 'EUE04';
      else changed := true;
      end if;
    else
      if cov.state = 'retracted' then changed := false;
      elsif cov.state <> 'attached' then raise exception 'invalid_transition' using errcode = 'EUE04';
      else changed := true;
      end if;
    end if;
    result := jsonb_build_object('state', case when not changed then cov.state when p_command = 'attach_coverage' then 'attached'
                                               when p_command = 'reject_coverage' then 'rejected' else 'retracted' end,
                                 'event_revision', cov.event_revision);
  end if;

  receipt := jsonb_build_object('schema', 'mccluster.environment-decision/v1', 'command', p_command, 'target_kind', target_kind,
    'target', p_target, 'changed', changed, 'prior', prior, 'result', result, 'recorded_at', public.eup_environment_iso_text(now_ts));
  insert into public.eup_environment_decisions (org_id, idempotency_key, actor, command, target_kind, target_id, expected_revision,
      reason, payload, payload_digest, prior, receipt)
    values (house, p_key, p_actor, p_command, target_kind, p_target, p_expected_revision, p_reason, payload, digest, prior, receipt)
    returning public.eup_environment_decisions.seq into dec_seq;
  if not changed then return receipt; end if;

  if target_kind = 'event' then
    if p_command = 'rollback' then
      ch := public.eup_environment_usgs_changes(ev.snapshot, old_rev.snapshot);
      insert into public.eup_environment_event_revisions (event_id, revision, cause, snapshot, changes, source_updated_at, fetched_at, decision_seq)
        values (ev.id, ev.revision + 1, 'owner_rollback', old_rev.snapshot, ch, ev.source_updated_at, ev.fetched_at, dec_seq);
      update public.eup_environment_events
         set revision = revision + 1, snapshot = old_rev.snapshot, observed_at = (old_rev.snapshot ->> 'observed_at')::timestamptz,
             revised_at = now_ts
       where id = ev.id;
      perform public.eup_environment_coverage_follow(ev.id, ev.revision + 1, false, dec_seq);
    else
      update public.eup_environment_events
         set held_at = n_held, retracted_at = n_retracted, first_published_at = n_first,
             state = public.eup_environment_state_of(merged_into, n_held, n_retracted, withdrawn_at, n_first), state_changed_at = now_ts
       where id = ev.id;
      if p_command = 'retract' then perform public.eup_environment_coverage_follow(ev.id, ev.revision, true, dec_seq); end if;
    end if;
  elsif target_kind = 'provider' then
    if not pol_found then
      insert into public.eup_environment_providers (provider, ingest, publication, rule, revision, updated_by)
        values (p_target, 'active', 'shown', rule, 1, p_actor);
    else
      update public.eup_environment_providers
         set ingest = result ->> 'ingest', publication = result ->> 'publication', rule = result -> 'rule',
             revision = revision + 1, updated_by = p_actor, updated_at = now_ts
       where provider = p_target;
    end if;
  else
    update public.eup_environment_coverage
       set state = result ->> 'state', decided_by = p_actor, decided_at = now_ts, decision_seq = dec_seq, updated_at = now_ts
     where id = cov.id;
  end if;
  return receipt;
end $$;

revoke all on function public.eup_environment_owner_read(uuid, text, integer),
  public.eup_environment_owner_command(uuid, text, text, bigint, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.eup_environment_owner_read(uuid, text, integer),
  public.eup_environment_owner_command(uuid, text, text, bigint, text, text, jsonb) to service_role;
commit;
