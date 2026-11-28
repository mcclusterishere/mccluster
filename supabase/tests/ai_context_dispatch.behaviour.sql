-- Behaviour of supabase/migrations/20261128094143_ai_context_dispatch_v1.sql after ai_context_dispatch.stub.sql.
-- Disposable database only. Every check raises on failure.
do $t$
declare
  org constant uuid := '00000000-0000-4000-8000-000000000001';
  tenant constant uuid := '00000000-0000-4000-8000-000000000002';
  owner constant uuid := '00000000-0000-4000-8000-0000000000aa';
  member constant uuid := '00000000-0000-4000-8000-0000000000bb';
  h constant text := repeat('a', 64);
  r jsonb; r2 jsonb; turn uuid; held uuid; approval uuid; job uuid; n integer; ok boolean;
begin
  -- answer route: recorded with an executed decision, nothing gated
  r := public.ops_ai_dispatch_record(org, owner, jsonb_build_object('operation_key', 'dispatch:11111111-1111-4111-8111-111111111111',
        'message', 'what is on today?', 'intent', 'answer', 'route', 'answer', 'reply', 'Nothing urgent.', 'classifier', '{"reason":"model above threshold"}'::jsonb));
  assert (r->>'replayed')::boolean = false, 'first record is not a replay';
  assert r->'turn'->>'status' = 'answered', 'answer route is answered';
  assert (select status from ai_context.decisions where id = (r->'turn'->>'decision_id')::uuid) = 'executed', 'routing decision logged';
  assert (select metadata->>'ingress' from ai_context.decisions where id = (r->'turn'->>'decision_id')::uuid) = 'dispatch';
  -- replay: same key returns the first record and writes nothing
  r2 := public.ops_ai_dispatch_record(org, owner, jsonb_build_object('operation_key', 'dispatch:11111111-1111-4111-8111-111111111111',
        'message', 'different text', 'intent', 'answer', 'route', 'answer'));
  assert (r2->>'replayed')::boolean and r2->'turn'->>'id' = r->'turn'->>'id', 'replay returns the first turn';
  assert (select count(*) from ai_context.decisions) = 1, 'replay wrote no decision';

  -- owner only, house only
  ok := false;
  begin perform public.ops_ai_dispatch_record(org, member, '{"operation_key":"dispatch:22222222-2222-4222-8222-222222222222","message":"x","intent":"answer","route":"answer"}');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'a member who is not an owner is refused';
  ok := false;
  begin perform public.ops_ai_dispatch_record(tenant, owner, '{"operation_key":"dispatch:22222222-2222-4222-8222-222222222222","message":"x","intent":"answer","route":"answer"}');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'a tenant organization is refused';

  -- a capability route must carry tool, capability and hash
  ok := false;
  begin perform public.ops_ai_dispatch_record(org, owner, '{"operation_key":"dispatch:33333333-3333-4333-8333-333333333333","message":"x","intent":"code.build","route":"run"}');
  exception when check_violation then ok := true; end;
  assert ok, 'run without tool/hash is refused';

  -- run route then attach a job
  r := public.ops_ai_dispatch_record(org, owner, jsonb_build_object('operation_key', 'dispatch:44444444-4444-4444-8444-444444444444',
        'message', 'plan the music catalogue audit', 'intent', 'objective.plan', 'route', 'run', 'capability', 'objective.plan',
        'tool', 'core.objective.plan', 'args', jsonb_build_object('org_id', org, 'objective', 'audit'), 'request_hash', h, 'risk_class', 'medium'));
  turn := (r->'turn'->>'id')::uuid;
  assert r->'turn'->>'status' = 'routed';
  insert into public.ops_agent_jobs (org_id, job_type) values (org, 'objective_plan') returning id into job;
  r := public.ops_ai_dispatch_attach(org, turn, jsonb_build_object('status', 'queued', 'job_id', job));
  assert r->>'status' = 'queued' and r->>'job_id' = job::text;
  update public.ops_agent_jobs set status = 'done', output = '{"steps":3}' where id = job;
  r := public.ops_ai_dispatch_get(org, turn);
  assert r->'job'->>'status' = 'done' and r->'job'->'output'->>'steps' = '3', 'get reads the live job';
  ok := false;
  begin perform public.ops_ai_dispatch_attach(org, turn, '{"status":"done"}');
  exception when no_data_found then ok := true; end;
  assert ok, 'a settled turn cannot be re-attached';

  -- a direct runner job route (tool job:<type>) records and attaches too
  r := public.ops_ai_dispatch_record(org, owner, jsonb_build_object('operation_key', 'dispatch:4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a',
        'message', 'run a host health check', 'intent', 'job.host_health', 'route', 'run', 'capability', 'job.host_health',
        'tool', 'job:host_health', 'args', jsonb_build_object('target_id', 'ovh-mccluster-core', 'input', '{}'::jsonb), 'request_hash', h, 'risk_class', 'low'));
  assert r->'turn'->>'tool' = 'job:host_health' and r->'turn'->>'status' = 'routed', 'job routes are recorded';
  ok := false;
  begin perform public.ops_ai_dispatch_record(org, owner, jsonb_build_object('operation_key', 'dispatch:4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b',
        'message', 'x', 'intent', 'job.host_health', 'route', 'run', 'capability', 'job.host_health',
        'tool', 'Job Host Health; drop', 'args', '{}'::jsonb, 'request_hash', h));
  exception when check_violation then ok := true; end;
  assert ok, 'a malformed tool name is refused';

  -- approval route: a pending control approval bound to the hash
  r := public.ops_ai_dispatch_record(org, owner, jsonb_build_object('operation_key', 'dispatch:55555555-5555-4555-8555-555555555555',
        'message', 'fix the footer in mcclusterishere/mccluster', 'intent', 'code.build', 'route', 'approval', 'capability', 'code.build',
        'tool', 'core.code.build', 'args', jsonb_build_object('org_id', org, 'repository', 'mcclusterishere/mccluster', 'task', 'fix'), 'request_hash', h, 'risk_class', 'high'));
  held := (r->'turn'->>'id')::uuid; approval := (r->'turn'->>'approval_id')::uuid;
  assert r->'turn'->>'status' = 'pending_approval';
  assert (select state from public.control_approvals where id = approval) = 'pending';
  assert (select request_hash = h and capability = 'dispatch.execute' and resource_id = held::text and requested_by = owner from public.control_approvals where id = approval);
  assert (select status from ai_context.decisions where id = (r->'turn'->>'decision_id')::uuid) = 'proposed';
  r := public.ops_ai_dispatch_claim(org, owner, held);
  assert (r->>'claimed')::boolean = false and r->>'state' = 'pending_approval', 'pending approval claims nothing';
  ok := false;
  begin perform public.ops_ai_dispatch_claim(org, member, held);
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'only an owner claims';

  -- approved with a different hash: refused
  update public.control_approvals set state = 'approved', decided_by = owner, decided_at = now(), request_hash = repeat('b', 64) where id = approval;
  ok := false;
  begin perform public.ops_ai_dispatch_claim(org, owner, held);
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'an approval for another request does not run this one';
  -- approved, same hash: claimed once
  update public.control_approvals set request_hash = h where id = approval;
  r := public.ops_ai_dispatch_claim(org, owner, held);
  assert (r->>'claimed')::boolean and r->'turn'->>'status' = 'executing';
  assert (select status = 'approved' and approved_by = owner from ai_context.decisions where id = (r->'turn'->>'decision_id')::uuid);
  r := public.ops_ai_dispatch_claim(org, owner, held);
  assert (r->>'claimed')::boolean = false and r->>'state' = 'executing', 'second claim starts nothing';
  r := public.ops_ai_dispatch_attach(org, held, '{"status":"failed","error":"boom"}');
  assert r->>'status' = 'failed';

  -- denied: closes the turn and its decision
  r := public.ops_ai_dispatch_record(org, owner, jsonb_build_object('operation_key', 'dispatch:66666666-6666-4666-8666-666666666666',
        'message', 'make a world', 'intent', 'world.generate', 'route', 'approval', 'capability', 'world.generate',
        'tool', 'core.world.generate', 'args', jsonb_build_object('org_id', org, 'prompt', 'a city'), 'request_hash', h, 'risk_class', 'high'));
  held := (r->'turn'->>'id')::uuid;
  update public.control_approvals set state = 'denied', decided_by = owner, decided_at = now() where id = (r->'turn'->>'approval_id')::uuid;
  r := public.ops_ai_dispatch_claim(org, owner, held);
  assert (r->>'claimed')::boolean = false and r->>'state' = 'denied';
  assert (select status from ai_context.decisions where id = (r->'turn'->>'decision_id')::uuid) = 'rejected';

  -- expired: same
  r := public.ops_ai_dispatch_record(org, owner, jsonb_build_object('operation_key', 'dispatch:77777777-7777-4777-8777-777777777777',
        'message', 'make a game', 'intent', 'game.build', 'route', 'approval', 'capability', 'game.build',
        'tool', 'core.game.build', 'args', jsonb_build_object('org_id', org, 'brief', 'b'), 'request_hash', h, 'risk_class', 'high'));
  update public.control_approvals set expires_at = now() - interval '1 minute' where id = (r->'turn'->>'approval_id')::uuid;
  r := public.ops_ai_dispatch_claim(org, owner, (r->'turn'->>'id')::uuid);
  assert r->>'state' = 'expired';

  -- refused route: rejected decision, no approval
  r := public.ops_ai_dispatch_record(org, owner, jsonb_build_object('operation_key', 'dispatch:88888888-8888-4888-8888-888888888888',
        'message', 'merge it to main', 'intent', 'refuse.production', 'route', 'refused'));
  assert r->'turn'->>'status' = 'refused' and r->'turn'->>'approval_id' is null;
  assert (select status from ai_context.decisions where id = (r->'turn'->>'decision_id')::uuid) = 'rejected';

  -- privileges: service_role only
  assert has_function_privilege('service_role', 'public.ops_ai_dispatch_record(uuid, uuid, jsonb)', 'execute');
  assert not has_function_privilege('anon', 'public.ops_ai_dispatch_record(uuid, uuid, jsonb)', 'execute');
  assert not has_function_privilege('authenticated', 'public.ops_ai_dispatch_claim(uuid, uuid, uuid)', 'execute');
  assert not has_table_privilege('service_role', 'ai_context.dispatch_turns', 'select');
  raise notice 'ai_context_dispatch_v1 behaviour: all checks passed';
end $t$;
