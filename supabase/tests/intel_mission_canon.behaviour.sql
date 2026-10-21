-- Behaviour test for supabase/migrations/20261017030617_intel_mission_canon_v1.sql.
-- Runs the whole loop as the real API roles on a throwaway database:
-- collect -> evidence -> claim -> briefing -> decision -> mission -> outcome
-- -> evidence again, plus the failure, privacy, privilege and purpose rules.
-- Run by scripts/test-intel-canon-db.sh. Fixture IDs are fixed so failures
-- are readable.
\set ON_ERROR_STOP on

-- fixtures (as the migration owner, standing in for production rows)
insert into public.orgs (id, slug, name) values ('00000000-0000-4000-8000-0000000000a1', 'mccluster', 'McCluster');
insert into public.orgs (id, slug, name) values ('00000000-0000-4000-8000-0000000000a2', 'other', 'Other org');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000b', 'owner@example.test'),
  ('00000000-0000-4000-8000-00000000000c', 'member@example.test');
insert into public.org_members (org_id, profile_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b', 'owner'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000c', 'member');

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to service_role, authenticated, anon;

-- 1. COLLECT: begin, commit a batch with a located row, an unlocated row, a
--    (0,0) row and an in-batch duplicate.
set role service_role;
do $t$
declare r jsonb; c jsonb;
begin
  r := public.intel_collector_begin('00000000-0000-4000-8000-0000000000a1', 'usgs.earthquakes',
    '{"kind":"api","display_name":"USGS earthquakes","license_policy":{"publisher":"U.S. Geological Survey","license":"public-domain (USGS)","attribution":"U.S. Geological Survey"},"retention_policy":{"days":365}}'::jsonb, 900);
  assert (r->>'started')::boolean, 'first run starts';
  insert into t_ids values ('run1', (r->>'run_id')::uuid);
  assert r->'cursor' = '{}'::jsonb, 'initial cursor is empty';

  c := public.intel_collector_commit('00000000-0000-4000-8000-0000000000a1', (r->>'run_id')::uuid, jsonb_build_array(
    jsonb_build_object('external_id','us7000aaaa','record_kind','earthquake','idempotency_key','usgs:us7000aaaa:1','content_hash',repeat('a',64),
      'title','M 4.6 - 10 km S of Example','observed_at','2026-10-15T01:00:00Z','retrieved_at','2026-10-15T02:00:00Z',
      'lat',35.5,'lon',-117.5,'source_url','https://earthquake.usgs.gov/earthquakes/eventpage/us7000aaaa','measures',jsonb_build_object('magnitude',4.6)),
    jsonb_build_object('external_id','us7000bbbb','record_kind','earthquake','idempotency_key','usgs:us7000bbbb:1','content_hash',repeat('b',64),
      'title','M 3.1 - unknown location','observed_at','2026-10-15T01:10:00Z'),
    jsonb_build_object('external_id','us7000cccc','record_kind','earthquake','idempotency_key','usgs:us7000cccc:1','content_hash',repeat('c',64),
      'title','M 2.9 - null island','observed_at','2026-10-15T01:20:00Z','lat',0,'lon',0),
    jsonb_build_object('external_id','us7000aaaa','record_kind','earthquake','idempotency_key','usgs:us7000aaaa:1','content_hash',repeat('a',64),
      'title','M 4.6 duplicate','observed_at','2026-10-15T01:00:00Z'),
    jsonb_build_object('external_id','','idempotency_key','bad','content_hash','nothex','title','')
  ), '{"last_observed_at":"2026-10-15T01:20:00Z"}'::jsonb);
  assert c->>'status' = 'partial', 'a rejected row makes the run partial, not succeeded: ' || c::text;
  assert (c->>'records_seen')::int = 5 and (c->>'records_written')::int = 3 and (c->>'deduplicated')::int = 1
     and (c->>'records_rejected')::int = 1, 'counts: ' || c::text;
  assert (select count(*) from public.intel_evidence where lat is not null) = 1, 'only the source-published pair is located; (0,0) is refused';
  assert (select geo_source from public.intel_evidence where title like 'M 2.9%') = 'none', 'null island is unknown, not a place';

  -- re-delivery of the same upstream rows writes nothing new
  r := public.intel_collector_begin('00000000-0000-4000-8000-0000000000a1', 'usgs.earthquakes', '{}'::jsonb, 900);
  assert not (r->>'started')::boolean and r->>'reason' = 'not_due', 'second tick inside the interval is refused: ' || r::text;
end
$t$;

-- 2. FAILED UPSTREAM is a failed run, never zero rows of success, and the
--    checkpoint does not move.
do $t$
declare r jsonb; h jsonb;
begin
  update public.ops_ingest_runs set started_at = now() - interval '1 hour', finished_at = now() - interval '1 hour';
  r := public.intel_collector_begin('00000000-0000-4000-8000-0000000000a1', 'usgs.earthquakes', '{}'::jsonb, 900);
  assert (r->>'started')::boolean, 'due again after the interval';
  assert r->'cursor'->>'last_observed_at' = '2026-10-15T01:20:00Z', 'checkpoint carried';
  perform public.intel_collector_fail('00000000-0000-4000-8000-0000000000a1', (r->>'run_id')::uuid, 'provider_error: HTTP 503', '{"provider_status":503}'::jsonb);
  h := public.intel_health('00000000-0000-4000-8000-0000000000a1', 'usgs.earthquakes');
  assert h->'latest_run'->>'status' = 'failed', 'latest run is failed';
  assert (h->'latest_run'->>'records_written')::int = 0;
  assert h->'last_successful_run'->>'status' = 'partial', 'last good run still visible';
  assert (h->'failures'->>'last_7d')::int = 1, 'failure counted';
  assert (h->'stored'->>'source_records')::int = 3, 'stored totals unchanged by failure';
  assert h->'connector'->'cursor'->>'last_observed_at' = '2026-10-15T01:20:00Z', 'cursor did not move on failure';
  assert h->'connector'->>'last_error' like 'provider_error%';
end
$t$;

-- 3. REVIEW evidence, CLAIM, BRIEFING
do $t$
declare e1 uuid; e2 uuid; c jsonb; b jsonb; ok boolean;
begin
  select id into e1 from public.intel_evidence where title like 'M 4.6%';
  select id into e2 from public.intel_evidence where title like 'M 3.1%';
  insert into t_ids values ('e1', e1), ('e2', e2);
  perform public.intel_review('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b', 'evidence', e1, 'accepted', 'checked against USGS event page', null, 'public');
  perform public.intel_review('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b', 'evidence', e2, 'accepted', null, null, 'members');

  -- visibility above private needs acceptance
  begin
    update public.intel_evidence set visibility = 'public', review_status = 'unreviewed' where id = e2;
    ok := false;
  exception when check_violation then ok := true; end;
  assert ok, 'unreviewed evidence cannot be public';

  c := public.intel_create_claim('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b',
    'Seismic activity near Example warrants a preparedness check-in mission', 'event', 'nonprofit_program',
    jsonb_build_array(jsonb_build_object('evidence_id', e1, 'stance', 'supports'), jsonb_build_object('evidence_id', e2, 'stance', 'context')));
  insert into t_ids values ('claim', (c->>'claim_id')::uuid);
  perform public.intel_review('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b', 'claim', (c->>'claim_id')::uuid, 'supported', 'one accepted supporting item', 0.6, null);
  assert (select count(*) from public.intel_reviews where subject_type = 'claim') = 2, 'claim review history kept';

  b := public.intel_create_briefing('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b',
    'Example region seismic briefing', 'Summary with citations [1][2].',
    jsonb_build_array(jsonb_build_object('claim_id', c->>'claim_id'), jsonb_build_object('evidence_id', e1, 'locator', 'USGS event page')));
  insert into t_ids values ('briefing', (b->>'briefing_id')::uuid);
  assert (b->>'citations')::int = 2;
  assert b->>'evidence_newest_at' is not null, 'freshness computed from the evidence';

  begin
    perform public.intel_create_briefing('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b',
      'Bad', 'Cites nothing real', jsonb_build_array(jsonb_build_object('evidence_id', gen_random_uuid())));
    ok := false;
  exception when others then ok := true; end;
  assert ok, 'a citation must resolve to a stored record';
end
$t$;
reset role;

-- 4. DECISION (written by context-decision as the human; simulated here as the owner of ai_context)
insert into ai_context.decisions (id, org_id, title, decision, rationale_summary, risk_class, status, proposed_by)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', 'Run a preparedness check-in',
        'Open a check-in mission for the Example region', 'Briefing cites accepted USGS evidence', 'low', 'proposed', 'owner');

set role service_role;
do $t$
declare r jsonb; ok boolean; m jsonb;
begin
  r := public.intel_record_decision_basis('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b',
    '00000000-0000-4000-8000-0000000000d1', (select v from t_ids where k = 'briefing'));
  assert (r->>'basis_items')::int = 3, 'briefing + cited claim + cited evidence: ' || r::text;
  assert public.intel_decision_state('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d1') is null, 'no cross-org read';

  begin
    perform public.intel_create_mission_from_decision('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b',
      '00000000-0000-4000-8000-0000000000d1', 'mission-1', '{"title":"Preparedness check-in"}'::jsonb);
    ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'a proposed decision cannot create a mission';
end
$t$;
reset role;

update ai_context.decisions set status = 'approved', approved_by = '00000000-0000-4000-8000-00000000000b', approved_at = now()
 where id = '00000000-0000-4000-8000-0000000000d1';

set role service_role;
do $t$
declare m jsonb; m2 jsonb; ok boolean;
begin
  m := public.intel_create_mission_from_decision('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b',
    '00000000-0000-4000-8000-0000000000d1', 'mission-1',
    '{"title":"Preparedness check-in","description":"Check in with neighbours","domain":"community","objectives":["Contact 10 households"],"region_label":"Example region","target_measures":{"households_contacted":10}}'::jsonb);
  assert (m->>'created')::boolean and m->>'mission_status' = 'draft', 'mission created as draft: ' || m::text;
  insert into t_ids values ('mission', (m->>'mission_id')::uuid);
  m2 := public.intel_create_mission_from_decision('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b',
    '00000000-0000-4000-8000-0000000000d1', 'mission-1', '{"title":"again"}'::jsonb);
  assert not (m2->>'created')::boolean and m2->>'mission_id' = m->>'mission_id', 'idempotent';
  assert (select status from public.action_missions where id = (m->>'mission_id')::uuid) = 'draft';
end
$t$;
reset role;

-- a member takes the mission and submits proof (production does this through
-- join_action_mission / submit RPCs; inserted directly here)
insert into public.action_mission_assignments (id, mission_id, user_id, status)
values ('00000000-0000-4000-8000-0000000000e1', (select v from t_ids where k = 'mission'), '00000000-0000-4000-8000-00000000000c', 'submitted');
insert into public.action_proofs (id, assignment_id, user_id, proof_type, proof_url, statement, status)
values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000c',
        'link', 'https://example.test/checkin-log', '10 households contacted', 'pending');

-- 5. OUTCOME with proof; acceptance requires a VERIFIED proof; accepted outcome becomes evidence
set role service_role;
do $t$
declare o jsonb; o2 jsonb; ok boolean;
begin
  o := public.intel_submit_outcome('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b',
    (select v from t_ids where k = 'mission'), 'outcome-1', '10 households contacted', '2026-10-16T12:00:00Z',
    '{"households_contacted":{"value":10,"unit":"households"}}'::jsonb, array['00000000-0000-4000-8000-0000000000f1']::uuid[]);
  insert into t_ids values ('outcome', (o->>'outcome_id')::uuid);
  o2 := public.intel_submit_outcome('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b',
    (select v from t_ids where k = 'mission'), 'outcome-1', 'dup', now(), '{}'::jsonb, array['00000000-0000-4000-8000-0000000000f1']::uuid[]);
  assert not (o2->>'created')::boolean, 'outcome submission is idempotent';

  begin
    perform public.intel_review_outcome('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b',
      (o->>'outcome_id')::uuid, 'accepted', 'premature');
    ok := false;
  exception when others then ok := true; end;
  assert ok, 'an outcome whose proof is still pending cannot be accepted';
end
$t$;
reset role;
update public.action_proofs set status = 'verified', reviewer_uid = '00000000-0000-4000-8000-00000000000b', reviewed_at = now()
 where id = '00000000-0000-4000-8000-0000000000f1';

set role service_role;
do $t$
declare r jsonb; l jsonb;
begin
  r := public.intel_review_outcome('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000b',
    (select v from t_ids where k = 'outcome'), 'accepted', 'proof verified', (select v from t_ids where k = 'claim'), 'supports');
  assert r->>'evidence_id' is not null, 'accepted outcome becomes evidence';

  -- 6. LINEAGE: claim -> evidence -> briefing -> decision -> mission -> outcome -> evidence
  l := public.intel_lineage('00000000-0000-4000-8000-0000000000a1', (select v from t_ids where k = 'claim'));
  assert jsonb_array_length(l->'evidence') = 3, 'two source items + the outcome evidence: ' || (l->'evidence')::text;
  assert jsonb_array_length(l->'briefings') = 1;
  assert jsonb_array_length(l->'decisions') = 1 and l->'decisions'->0->>'status' = 'approved';
  assert l->'decisions'->0->>'approved_by' = '00000000-0000-4000-8000-00000000000b', 'approver carried from ai_context';
  assert jsonb_array_length(l->'missions') = 1;
  assert jsonb_array_length(l->'outcomes') = 1 and l->'outcomes'->0->>'status' = 'accepted';
  assert l->'outcomes'->0->>'feedback_evidence_id' = r->>'evidence_id', 'outcome fed back as evidence';
  assert public.intel_lineage('00000000-0000-4000-8000-0000000000a2', (select v from t_ids where k = 'claim')) is null, 'no cross-org lineage';
end
$t$;

-- 7. GEO PROJECTION: k floor, located vs unknown, no invented coordinates
do $t$
declare p jsonb; ok boolean;
begin
  p := public.intel_geo_projection('00000000-0000-4000-8000-0000000000a1', 'public', '2026-10-14T00:00:00Z', '2026-10-17T00:00:00Z', 10, 'day', 1);
  assert (p->>'k_threshold')::int = 5, 'the public k floor cannot be lowered below 5';
  assert (p->'totals'->>'records')::int = 1, 'public sees only the accepted public row';
  assert jsonb_array_length(p->'buckets') = 0 and (p->'totals'->>'suppressed_records')::int = 1, 'a group of 1 is suppressed: ' || p::text;

  p := public.intel_geo_projection('00000000-0000-4000-8000-0000000000a1', 'members', '2026-10-14T00:00:00Z', '2026-10-17T00:00:00Z', 10, 'day', 5);
  assert (p->'totals'->>'located')::int = 1 and (p->'totals'->>'unknown_location')::int = 1, 'members: located vs unknown disclosed: ' || p::text;

  p := public.intel_geo_projection('00000000-0000-4000-8000-0000000000a1', 'owner', '2026-10-14T00:00:00Z', '2026-10-17T00:00:00Z', 10, 'day', 5);
  assert jsonb_array_length(p->'buckets') = 1, 'owner sees the cell';
  assert p->'buckets'->0->>'cell' = 'g10:3:-12', 'cell id: ' || (p->'buckets'->0)::text;
  assert (p->'buckets'->0->'cell_center'->>'lat')::numeric = 35 and (p->'buckets'->0->'cell_center'->>'lon')::numeric = -115;
  assert (p->'totals'->>'unknown_location')::int >= 2, 'unlocated rows are counted, never placed';

  begin
    perform public.intel_geo_projection('00000000-0000-4000-8000-0000000000a1', 'public', now() - interval '1 year', now(), 10, 'day', 5);
    ok := false;
  exception when others then ok := true; end;
  assert ok, 'window is bounded';
end
$t$;

-- 8. APPEND-ONLY review history, even for the service role
do $t$
declare ok boolean;
begin
  begin
    update public.intel_reviews set note = 'rewritten';
    ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'review history cannot be rewritten';
end
$t$;

-- 9. PURPOSE LIMITS: no person subjects, no electoral lane
do $t$
declare ok boolean;
begin
  begin
    insert into public.intel_claims (org_id, statement, subject_kind, purpose, created_by)
    values ('00000000-0000-4000-8000-0000000000a1', 'x', 'person', 'operations', '00000000-0000-4000-8000-00000000000b');
    ok := false;
  exception when check_violation then ok := true; end;
  assert ok, 'person-level subjects are refused';
  begin
    insert into public.intel_claims (org_id, statement, subject_kind, purpose, created_by)
    values ('00000000-0000-4000-8000-0000000000a1', 'x', 'place', 'electoral_targeting', '00000000-0000-4000-8000-00000000000b');
    ok := false;
  exception when check_violation then ok := true; end;
  assert ok, 'no electoral purpose lane';
end
$t$;

-- 10. RETENTION: expired uncited evidence is pruned; cited evidence is kept
do $t$
declare n integer;
begin
  update public.intel_evidence set retention_until = now() - interval '1 day' where kind = 'source_record';
  n := public.intel_prune_expired_evidence('00000000-0000-4000-8000-0000000000a1', 100);
  assert n = 1, 'only the uncited null-island row is pruned, got ' || n;
  assert exists (select 1 from public.intel_evidence where id = (select v from t_ids where k = 'e1')), 'cited evidence kept';
end
$t$;
reset role;

-- 11. PRIVILEGES: anon nothing; a plain member reads no rows; the owner reads via RLS;
--     browser roles cannot call the server functions.
set role anon;
do $t$
declare ok boolean;
begin
  begin perform 1 from public.intel_evidence; ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon has no table access';
  begin perform public.intel_geo_projection('00000000-0000-4000-8000-0000000000a1', 'owner', now() - interval '1 day', now(), 10, 'day', 5); ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon cannot call the projection with an owner audience';
end
$t$;
reset role;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c"}', false);
do $t$
declare ok boolean;
begin
  assert (select count(*) from public.intel_evidence) = 0, 'a member reads no raw evidence';
  assert (select count(*) from public.intel_claims) = 0, 'a member reads no raw claims';
  begin perform public.intel_lineage('00000000-0000-4000-8000-0000000000a1', gen_random_uuid()); ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'authenticated cannot call server functions';
  begin insert into public.intel_claims (org_id, statement, subject_kind, purpose, created_by)
        values ('00000000-0000-4000-8000-0000000000a1', 'x', 'place', 'operations', '00000000-0000-4000-8000-00000000000c'); ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'authenticated cannot write';
end
$t$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b"}', false);
do $t$
begin
  assert (select count(*) from public.intel_evidence) >= 3, 'the org owner reads evidence through RLS';
  assert (select count(*) from public.intel_mission_decisions) = 1, 'the org owner reads the mission link';
end
$t$;
reset role;
select set_config('request.jwt.claims', '', false);

\echo 'intel_mission_canon.behaviour: all assertions passed'
