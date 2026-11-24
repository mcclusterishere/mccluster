-- Run only against the disposable Supabase stack after the repository's full migration/replay reset.
-- Apply ai_context_workstreams_v1.sql before this file. No base object is replaced or stubbed here.
-- Every fixture row, including rows created by the real ontology/decision triggers, rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '20s';

do $baseline$
begin
  assert exists (select 1 from pg_trigger where tgrelid = 'ai_context.decisions'::regclass
    and tgname = 'intel_decision_approval_v2' and tgenabled = 'O'), 'real decision guard is required';
  assert exists (select 1 from pg_trigger where tgrelid = 'public.ops_objectives'::regclass
    and tgname = 'ops_ontology_sync_objective_t' and tgenabled = 'O'), 'real objective trigger is required';
  assert exists (select 1 from pg_trigger where tgrelid = 'public.ops_agent_jobs'::regclass
    and tgname = 'ops_ontology_sync_job_t' and tgenabled = 'O'), 'real job trigger is required';
  assert exists (select 1 from public.orgs where slug = 'mccluster' and enabled), 'reset must contain the house org';
  assert (select count(*) = 0 from ai_context.workstreams), 'disposable workstream tables must start empty';
  assert (select count(*) = 0 from ai_context.workstream_events), 'disposable event table must start empty';
end $baseline$;

select set_config('mccluster.workstream_test_org', (select id::text from public.orgs where slug = 'mccluster'), true);
insert into public.orgs(id, slug, name) values
  ('e8320000-0000-4000-8000-000000000002', 'workstream-reset-tenant', 'Synthetic reset tenant');
insert into public.org_members(org_id, profile_id, role) values
  (current_setting('mccluster.workstream_test_org')::uuid, 'e8320000-0000-4000-8000-000000000001', 'owner'),
  (current_setting('mccluster.workstream_test_org')::uuid, 'e8320000-0000-4000-8000-000000000006', 'staff');
insert into public.ops_objectives(id, org_id, name) values
  ('e8320000-0000-4000-8000-000000000003', current_setting('mccluster.workstream_test_org')::uuid, 'Synthetic workstream proof'),
  ('e8320000-0000-4000-8000-000000000004', 'e8320000-0000-4000-8000-000000000002', 'Synthetic foreign objective');
insert into public.ops_agent_jobs(id, org_id, objective_id, job_type) values
  ('e8320000-0000-4000-8000-000000000005', current_setting('mccluster.workstream_test_org')::uuid,
   'e8320000-0000-4000-8000-000000000003', 'repo_health');

do $privileges$
declare t text; r text; p text; f record;
begin
  foreach t in array array['ai_context.workstreams', 'ai_context.workstream_events'] loop
    assert (select relrowsecurity from pg_class where oid = t::regclass), 'RLS must be enabled';
    assert not exists (select 1 from pg_policy where polrelid = t::regclass), 'private tables have no client policies';
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        assert not has_table_privilege(r, t, p), format('%s must not hold %s on %s', r, p, t);
      end loop;
    end loop;
  end loop;
  for f in select oid, prosecdef, proconfig from pg_proc
    where pronamespace = 'public'::regnamespace and proname like 'ops_ai_workstream_%' loop
    assert f.prosecdef, 'workstream RPC must be SECURITY DEFINER';
    assert 'search_path=""' = any(f.proconfig), 'workstream RPC must pin an empty search_path';
    assert has_function_privilege('service_role', f.oid, 'execute'), 'service RPC grant missing';
    assert not has_function_privilege('anon', f.oid, 'execute'), 'anon RPC grant';
    assert not has_function_privilege('authenticated', f.oid, 'execute'), 'member RPC grant';
  end loop;
end $privileges$;

set local role anon;
do $anon$
begin
  begin
    perform public.ops_ai_workstream_resume(current_setting('mccluster.workstream_test_org')::uuid);
    raise exception 'anon unexpectedly reached resume';
  exception when insufficient_privilege then null; end;
end $anon$;
reset role;
set local role authenticated;
do $member$
begin
  begin
    perform public.ops_ai_workstream_checkpoint(current_setting('mccluster.workstream_test_org')::uuid, '{}'::jsonb);
    raise exception 'member unexpectedly reached checkpoint';
  exception when insufficient_privilege then null; end;
end $member$;
reset role;

set local role service_role;
do $behaviour$
declare
  house uuid := current_setting('mccluster.workstream_test_org')::uuid;
  actor uuid := 'e8320000-0000-4000-8000-000000000001';
  provenance jsonb := jsonb_build_object('actor_kind', 'owner', 'actor_id', actor, 'actor_source', 'native-reset-proof');
  stream jsonb := jsonb_build_object('id', 'native-reset-workstream', 'title', 'Native reset proof',
    'goal', 'Exercise the actual canonical dependencies', 'head', 'first-head', 'next', 'Run the proof',
    'objective_id', 'e8320000-0000-4000-8000-000000000003',
    'job_ids', jsonb_build_array('e8320000-0000-4000-8000-000000000005'));
  event jsonb := jsonb_build_object('kind', 'decision', 'text', 'Propose durable checkpoints',
    'objective_id', 'e8320000-0000-4000-8000-000000000003', 'job_id', 'e8320000-0000-4000-8000-000000000005',
    'decision', jsonb_build_object('title', 'Synthetic checkpoint decision', 'risk_class', 'low'));
  first jsonb; replay jsonb; row jsonb;
  private_event jsonb := '{"kind":"verified","text":"Restricted stored evidence"}';
begin
  first := public.ops_ai_workstream_checkpoint(house, stream, 'native-reset:decision', event, provenance);
  assert (first #>> '{workstream,created}')::boolean, 'new workstream was not created';
  assert (first #>> '{event,decision_created}')::boolean, 'canonical decision was not proposed';
  assert first #>> '{event,event,job_id}' = 'e8320000-0000-4000-8000-000000000005', 'job link lost';
  assert first #>> '{workstream,workstream,objective_id}' = 'e8320000-0000-4000-8000-000000000003', 'objective link lost';

  perform public.ops_ai_workstream_checkpoint(house,
    '{"id":"native-reset-workstream","head":"second-head","next":"Review the evidence"}',
    'native-reset:verified', '{"kind":"verified","text":"Native reset call succeeded"}', provenance);
  replay := public.ops_ai_workstream_checkpoint(house, stream, 'native-reset:decision', event, provenance);
  assert (replay #>> '{event,replayed}')::boolean, 'retry was not recognized';
  assert not (replay #>> '{workstream,applied}')::boolean, 'retry rewrote state';
  assert replay #>> '{workstream,workstream,head}' = 'second-head', 'retry rewound the head';
  assert replay #>> '{event,event,decision_id}' = first #>> '{event,event,decision_id}', 'retry duplicated decision';

  begin
    perform public.ops_ai_workstream_checkpoint(house, stream, 'native-reset:decision',
      event || '{"text":"Changed meaning"}', provenance);
    raise exception 'changed event reused the operation key';
  exception when unique_violation then null; end;
  begin
    perform public.ops_ai_workstream_upsert(house, '{"id":"native-reset-workstream"}',
      provenance || '{"actor_id":"e8320000-0000-4000-8000-000000000006"}');
    raise exception 'staff impersonated an owner';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ops_ai_workstream_upsert('e8320000-0000-4000-8000-000000000002', stream, provenance);
    raise exception 'tenant crossed the house boundary';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ops_ai_workstream_upsert(house,
      '{"id":"native-reset-workstream","objective_id":"e8320000-0000-4000-8000-000000000004"}', provenance);
    raise exception 'foreign objective was linked';
  exception when foreign_key_violation then null; end;
  begin
    perform public.ops_ai_workstream_checkpoint(house, '{"id":"native-reset-atomic","title":"T","goal":"G"}',
      'native-reset:bad', '{"kind":"invalid","text":"Invalid event"}', provenance);
    raise exception 'invalid checkpoint was accepted';
  exception when invalid_parameter_value then null; end;
  assert not exists (select 1 from public.ops_ai_workstream_resume(house, 1, 'internal', 'native-reset-atomic', actor)),
    'failed checkpoint left a partial workstream';

  perform public.ops_ai_workstream_upsert(house,
    '{"id":"native-reset-private","title":"Private fixture","goal":"Test the sensitivity boundary","sensitivity":"restricted"}', provenance);
  select value into row from public.ops_ai_workstream_resume(house, 1, 'internal', 'native-reset-private', null) value;
  assert (row->>'withheld')::boolean and not row ? 'title', 'internal resume exposed restricted text';
  select value into row from public.ops_ai_workstream_resume(house, 1, 'restricted', 'native-reset-private', actor) value;
  assert row->>'title' = 'Private fixture', 'verified owner cannot resume restricted work';
  begin
    perform public.ops_ai_workstream_upsert(house, '{"id":"native-reset-private","next":"Changed"}',
      '{"actor_kind":"agent","actor_id":"native-test-agent"}');
    raise exception 'agent crossed the sensitivity ceiling';
  exception when insufficient_privilege then null; end;
  perform public.ops_ai_workstream_event_append(house, 'native-reset-private', 'native-reset:private', private_event, provenance);
  perform public.ops_ai_workstream_upsert(house, '{"id":"native-reset-private","sensitivity":"internal"}', provenance);
  begin
    perform public.ops_ai_workstream_event_append(house, 'native-reset-private', 'native-reset:private', private_event,
      '{"actor_kind":"agent","actor_id":"native-test-agent"}');
    raise exception 'lowered workstream exposed a restricted stored event';
  exception when insufficient_privilege then null; end;
  replay := public.ops_ai_workstream_event_append(house, 'native-reset-private', 'native-reset:private', private_event, provenance);
  assert (replay->>'replayed')::boolean and replay #>> '{event,sensitivity}' = 'restricted',
    'owner replay must preserve the stored event classification';
  begin
    perform 1 from ai_context.workstreams;
    raise exception 'service role directly read the private table';
  exception when insufficient_privilege then null; end;
end $behaviour$;
reset role;

do $canonical_dependencies$
declare decision_row ai_context.decisions%rowtype;
begin
  select * into strict decision_row from ai_context.decisions
    where metadata->>'workstream_key' = 'native-reset-workstream';
  assert decision_row.status = 'proposed' and decision_row.approved_by is null and decision_row.approved_at is null,
    'checkpoint must not approve the canonical decision';
  assert decision_row.proposed_by = 'e8320000-0000-4000-8000-000000000001', 'decision attribution missing';
  assert exists (select 1 from pg_trigger where tgrelid = 'ai_context.decisions'::regclass
    and tgname = 'intel_decision_approval_v2' and tgenabled = 'O'), 'decision guard was changed';
  begin
    update ai_context.workstream_events set body = 'Changed' where operation_key = 'native-reset:decision';
    raise exception 'append-only update was accepted';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    delete from ai_context.workstream_events where operation_key = 'native-reset:decision';
    raise exception 'append-only delete was accepted';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    truncate ai_context.workstream_events;
    raise exception 'append-only truncate was accepted';
  exception when object_not_in_prerequisite_state then null; end;
  assert (select count(*) = 3 from ai_context.workstream_events), 'failed/replayed writes changed the log';
end $canonical_dependencies$;

-- Exercise the actual objective FK and the existing ontology/job triggers without replacing any of them.
delete from public.ops_objectives where id = 'e8320000-0000-4000-8000-000000000003';
do $objective_fk$
begin
  assert (select objective_id is null from ai_context.workstreams where workstream_key = 'native-reset-workstream'),
    'deleted objective did not clear the workstream reference';
  assert (select objective_id is null from public.ops_agent_jobs where id = 'e8320000-0000-4000-8000-000000000005'),
    'canonical job FK did not preserve its existing behavior';
end $objective_fk$;

rollback;
do $clean$
begin
  assert (select count(*) = 0 from ai_context.workstreams), 'fixture workstreams survived rollback';
  assert (select count(*) = 0 from ai_context.workstream_events), 'fixture events survived rollback';
  assert not exists (select 1 from ai_context.decisions where metadata->>'workstream_key' = 'native-reset-workstream'),
    'fixture decision survived rollback';
  assert not exists (select 1 from public.orgs where id = 'e8320000-0000-4000-8000-000000000002'),
    'fixture tenant survived rollback';
end $clean$;
select 'PASS: workstreams integrate with the full reset schema; all fixture rows rolled back' as result;
