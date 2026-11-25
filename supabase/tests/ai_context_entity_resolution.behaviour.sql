-- Behaviour proof for ai_context_entity_resolution_v1 on a disposable database seeded by
-- ai_context_entity_resolution.stub.sql. Every block raises on failure.

do $t$
declare
  house constant uuid := '00000000-0000-4000-8000-000000000001';
  tenant constant uuid := '00000000-0000-4000-8000-000000000002';
  owner_id constant uuid := '00000000-0000-4000-8000-0000000000aa';
  member_id constant uuid := '00000000-0000-4000-8000-0000000000bb';
  h1 constant text := repeat('a', 64);
  h2 constant text := repeat('b', 64);
  h3 constant text := repeat('c', 64);
  h4 constant text := repeat('d', 64);
  res jsonb;
  v_auto uuid; v_review uuid; v_venue uuid; v_approval uuid;
  n integer;
  failed boolean;
begin
  -- 1. Only the house, only an owner.
  failed := false;
  begin perform public.ops_entity_match_record(tenant, owner_id, '{"matcher_version":"entity-match:v1","candidates":[]}'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'tenant org must be refused'; end if;
  failed := false;
  begin perform public.ops_entity_match_record(house, member_id, '{"matcher_version":"entity-match:v1","candidates":[]}'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'non-owner must be refused'; end if;

  -- 2. One scan: an automatic link, an owner review, a caller that claims "auto" without a strong key (database
  --    downgrades it to review), and a below-floor pair (not recorded).
  res := public.ops_entity_match_record(house, owner_id, jsonb_build_object(
    'matcher_version', 'entity-match:v1', 'trigger', 'tool', 'objects_scanned', 7, 'pairs_compared', 4,
    'candidates', jsonb_build_array(
      jsonb_build_object('left_object_id', '10000000-0000-4000-8000-000000000002', 'right_object_id', '10000000-0000-4000-8000-000000000001',
        'family', 'person', 'score', 0.988, 'band', 'auto', 'request_hash', h1,
        'evidence', '{"keys":[{"kind":"email","weight":0.97},{"kind":"name_exact","weight":0.5}]}'::jsonb),
      jsonb_build_object('left_object_id', '10000000-0000-4000-8000-000000000003', 'right_object_id', '10000000-0000-4000-8000-000000000004',
        'family', 'person', 'score', 0.85, 'band', 'review', 'request_hash', h2,
        'evidence', '{"keys":[{"kind":"name_org","weight":0.85}]}'::jsonb),
      jsonb_build_object('left_object_id', '10000000-0000-4000-8000-000000000005', 'right_object_id', '10000000-0000-4000-8000-000000000006',
        'family', 'company', 'score', 0.97, 'band', 'auto', 'request_hash', h3,
        'evidence', '{"keys":[{"kind":"name_fuzzy","weight":0.5}]}'::jsonb),
      jsonb_build_object('left_object_id', '10000000-0000-4000-8000-000000000001', 'right_object_id', '10000000-0000-4000-8000-000000000007',
        'family', 'person', 'score', 0.6, 'band', 'review', 'request_hash', h4, 'evidence', '{"keys":[]}'::jsonb))));
  if (res->>'auto_linked')::int <> 1 or (res->>'queued_for_review')::int <> 2 or (res->>'skipped')::int <> 1 then
    raise exception 'unexpected scan counts %', res;
  end if;

  select id into v_auto from ai_context.entity_matches where request_hash = h1;
  select id, approval_id into v_review, v_approval from ai_context.entity_matches where request_hash = h2;
  select id into v_venue from ai_context.entity_matches where request_hash = h3;
  if (select status from ai_context.entity_matches where id = v_auto) <> 'linked' then raise exception 'strong high-confidence pair must auto-link'; end if;
  if (select left_object_id from ai_context.entity_matches where id = v_auto) <> '10000000-0000-4000-8000-000000000001' then raise exception 'pair must be stored in canonical order'; end if;
  if (select link_method from ai_context.entity_matches where id = v_auto) <> 'rule' then raise exception 'auto link must be method rule'; end if;
  if (select status from ai_context.entity_matches where id = v_review) <> 'pending_review' or v_approval is null then raise exception 'mid-confidence pair must wait for owner review'; end if;
  if (select band || status from ai_context.entity_matches where id = v_venue) <> 'reviewpending_review' then raise exception 'auto without a strong key must be downgraded to review'; end if;
  if exists (select 1 from ai_context.entity_matches where request_hash = h4) then raise exception 'below-floor pair must not be recorded'; end if;
  if (select capability || '/' || resource_type || '/' || state from public.control_approvals where id = v_approval) <> 'entity.resolve/entity_match/pending' then
    raise exception 'review must be an ordinary pending Control approval';
  end if;

  -- 3. Audit: decision + legacy resolution event + match event per transition. No ontology object changed.
  select count(*) into n from ai_context.decisions where metadata->>'ingress' = 'entity_resolution';
  if n <> 3 then raise exception 'expected 3 decisions, got %', n; end if;
  if (select status from ai_context.decisions where metadata->>'match_id' = v_auto::text) <> 'executed' then raise exception 'auto link decision must be executed'; end if;
  if (select status from ai_context.decisions where metadata->>'match_id' = v_review::text) <> 'proposed' then raise exception 'review decision must be proposed'; end if;
  select count(*) into n from public.ops_entity_resolution_events where namespace = 'ontology.same_as';
  if n <> 3 then raise exception 'expected 3 resolution events, got %', n; end if;
  if (select decision || '/' || method from public.ops_entity_resolution_events where namespace = 'ontology.same_as' and alias_key = '10000000-0000-4000-8000-000000000002') <> 'resolve/rule' then
    raise exception 'auto link must log resolve/rule';
  end if;
  select count(*) into n from ai_context.entity_match_events;
  if n <> 3 then raise exception 'expected 3 match events, got %', n; end if;

  -- 4. A replay of the same scan writes nothing new.
  res := public.ops_entity_match_record(house, owner_id, jsonb_build_object('matcher_version', 'entity-match:v1', 'candidates', jsonb_build_array(
      jsonb_build_object('left_object_id', '10000000-0000-4000-8000-000000000001', 'right_object_id', '10000000-0000-4000-8000-000000000002',
        'family', 'person', 'score', 0.988, 'request_hash', h1, 'evidence', '{"keys":[{"kind":"email"}]}'::jsonb))));
  if (res->>'skipped')::int <> 1 or (select count(*) from ai_context.entity_match_events) <> 3 then raise exception 'replay must be a no-op'; end if;

  -- 5. Pending approval: settle does nothing; approval with a different hash is refused; matching hash links.
  res := public.ops_entity_match_settle(house, owner_id, null);
  if jsonb_array_length(res->'settled') <> 0 then raise exception 'pending approvals must not settle'; end if;
  update public.control_approvals set state = 'approved', decided_by = owner_id, decided_at = now(), request_hash = repeat('e', 64) where id = v_approval;
  failed := false;
  begin perform public.ops_entity_match_settle(house, owner_id, v_review); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'approval for another request must not link'; end if;
  update public.control_approvals set request_hash = h2 where id = v_approval;
  res := public.ops_entity_match_settle(house, owner_id, v_review);
  if (select status || '/' || link_method from ai_context.entity_matches where id = v_review) <> 'linked/manual' then raise exception 'approved review must link manually'; end if;
  if (select count(*) from ai_context.decisions where metadata->>'match_id' = v_review::text and status = 'approved') <> 2 then
    raise exception 'approved review must approve the proposal and record the link';
  end if;

  -- 6. Denied in Control -> rejected, and never proposed again.
  update public.control_approvals set state = 'denied', decided_by = owner_id, decided_at = now()
   where id = (select approval_id from ai_context.entity_matches where id = v_venue);
  perform public.ops_entity_match_settle(house, owner_id, null);
  if (select status from ai_context.entity_matches where id = v_venue) <> 'rejected' then raise exception 'denied review must be rejected'; end if;
  res := public.ops_entity_match_record(house, owner_id, jsonb_build_object('matcher_version', 'entity-match:v1', 'candidates', jsonb_build_array(
      jsonb_build_object('left_object_id', '10000000-0000-4000-8000-000000000005', 'right_object_id', '10000000-0000-4000-8000-000000000006',
        'family', 'company', 'score', 0.99, 'request_hash', h3, 'evidence', '{"keys":[{"kind":"domain"}]}'::jsonb))));
  if (select status from ai_context.entity_matches where id = v_venue) <> 'rejected' then raise exception 'a rejected pair must never be re-proposed'; end if;

  -- 7. Cluster: 1~2 linked and 3~4 linked are separate clusters.
  res := public.ops_entity_match_cluster(house, '10000000-0000-4000-8000-000000000002');
  if jsonb_array_length(res->'members') <> 2 then raise exception 'cluster of 2 expected, got %', res; end if;

  -- 8. Reversible: unlink needs a reason, keeps history, and the cluster shrinks.
  failed := false;
  begin perform public.ops_entity_match_unlink(house, owner_id, v_auto, ''); exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'unlink without a reason must be refused'; end if;
  failed := false;
  begin perform public.ops_entity_match_unlink(house, member_id, v_auto, 'not the same'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'non-owner unlink must be refused'; end if;
  res := public.ops_entity_match_unlink(house, owner_id, v_auto, 'Two different Dana Reyes');
  if (res->>'changed')::boolean is not true or (select status from ai_context.entity_matches where id = v_auto) <> 'unlinked' then raise exception 'unlink failed'; end if;
  if jsonb_array_length(public.ops_entity_match_cluster(house, '10000000-0000-4000-8000-000000000002')->'members') <> 1 then raise exception 'unlinked pair must leave the cluster'; end if;
  if (select count(*) from ai_context.entity_match_events where match_id = v_auto) <> 2 then raise exception 'unlink must append history'; end if;
  if (select count(*) from public.ops_ontology_objects) <> 8 then raise exception 'no ontology object may be deleted'; end if;

  -- 9. Expiry: an unanswered review expires and a later scan may re-open it with a fresh approval.
  insert into public.ops_ontology_objects (id, org_id, type_key, object_key, display_name) values
    ('10000000-0000-4000-8000-000000000008', house, 'lead', 'crm:lead:8', 'Ana Silva'),
    ('10000000-0000-4000-8000-000000000009', house, 'client', 'stripe:cus_9', 'Ana Silva');
  res := public.ops_entity_match_record(house, owner_id, jsonb_build_object('matcher_version', 'entity-match:v1', 'candidates', jsonb_build_array(
      jsonb_build_object('left_object_id', '10000000-0000-4000-8000-000000000008', 'right_object_id', '10000000-0000-4000-8000-000000000009',
        'family', 'person', 'score', 0.8, 'request_hash', repeat('f', 64), 'evidence', '{"keys":[{"kind":"name_exact"}]}'::jsonb))));
  update public.control_approvals set expires_at = now() - interval '1 minute'
   where id = (select approval_id from ai_context.entity_matches where request_hash = repeat('f', 64));
  perform public.ops_entity_match_settle(house, owner_id, null);
  if (select status from ai_context.entity_matches where request_hash = repeat('f', 64)) <> 'expired' then raise exception 'stale review must expire'; end if;
  res := public.ops_entity_match_record(house, owner_id, jsonb_build_object('matcher_version', 'entity-match:v1', 'candidates', jsonb_build_array(
      jsonb_build_object('left_object_id', '10000000-0000-4000-8000-000000000008', 'right_object_id', '10000000-0000-4000-8000-000000000009',
        'family', 'person', 'score', 0.8, 'request_hash', repeat('f', 64), 'evidence', '{"keys":[{"kind":"name_exact"}]}'::jsonb))));
  if (select status from ai_context.entity_matches where request_hash = repeat('f', 64)) <> 'pending_review' then raise exception 'expired review must re-open'; end if;

  -- 10. Rejecting a pending review directly denies its Control approval.
  perform public.ops_entity_match_unlink(house, owner_id, (select id from ai_context.entity_matches where request_hash = repeat('f', 64)), 'Different people');
  if (select a.state from public.control_approvals a join ai_context.entity_matches m on m.approval_id = a.id where m.request_hash = repeat('f', 64)) <> 'denied' then
    raise exception 'owner rejection must deny the pending approval';
  end if;

  -- 11. Objects page and list are house-only and bounded.
  res := public.ops_entity_match_objects(house, array['lead', 'client'], null, 2);
  if jsonb_array_length(res->'objects') <> 2 or res->>'next_after_id' is null then raise exception 'objects paging broken %', res; end if;
  if jsonb_array_length(public.ops_entity_match_list(house, 'linked', 50)->'matches') <> 1 then raise exception 'list by status broken'; end if;

  -- 12. Direct table access is closed to API roles.
  if has_table_privilege('service_role', 'ai_context.entity_matches', 'select') or has_table_privilege('authenticated', 'ai_context.entity_matches', 'select') then
    raise exception 'entity_matches must have no direct grants';
  end if;
  if has_function_privilege('authenticated', 'public.ops_entity_match_record(uuid, uuid, jsonb)', 'execute') then raise exception 'record must be service_role only'; end if;
  raise notice 'ai_context_entity_resolution_v1 behaviour: all checks passed';
end $t$;
