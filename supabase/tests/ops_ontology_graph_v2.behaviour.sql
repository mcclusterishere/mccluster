-- Behaviour of supabase/pending/20261125010000_ops_ontology_graph_v2.sql after ops_ontology_graph_v2.stub.sql and the
-- v1 ontology migration. Disposable database only. Every check raises on failure.
do $t$
declare
  house constant uuid := '00000000-0000-4000-8000-000000000001';
  tenant constant uuid := '00000000-0000-4000-8000-000000000002';
  usr constant uuid := '00000000-0000-4000-8000-0000000000aa';
  c1 uuid; k1 uuid; l1 uuid; l2 uuid; r1 uuid; o1 uuid; p1 uuid; b1 uuid; d1 uuid; t1 uuid; w1 uuid; f1 uuid; y1 uuid;
  s1 uuid; rec1 uuid; m1 uuid; g1 uuid; a1 uuid; e1 uuid;
  res jsonb; n integer; ok boolean; v_obj uuid; v_ver bigint; props jsonb; blob text;
begin
  insert into auth.users(id) values (usr);
  insert into public.orgs(id, slug, name, kind) values (house, 'mccluster', 'McCluster Corp', 'house'), (tenant, 'tenant-a', 'Tenant A', 'tenant');
  insert into public.control_capabilities(capability, description, risk) values ('dispatch.execute', 'test', 'high') on conflict do nothing;

  insert into public.out_companies(org_id, name, domain, kind) values (house, 'Shiloh Church', 'shiloh.example', 'nonprofit') returning id into c1;
  insert into public.out_contacts(org_id, company_id, email, name, consent) values (house, c1, 'pastor@shiloh.example', 'Pastor', 'inquired') returning id into k1;
  insert into public.leads(name, email, want, note, gclid, status, company_id) values ('Pastor', 'pastor@shiloh.example', 'event photos', 'PRIVATE NOTE', 'GCLID-SECRET', 'new', c1) returning id into l1;
  insert into public.leads(name, email, org_id) values ('Tenant Lead', 'lead@tenant.example', tenant) returning id into l2;
  insert into public.work_relationships(org_id, title, company_id, contact_id, lead_id, notes) values (house, 'Shiloh Church', c1, k1, l1, 'PRIVATE') returning id into r1;
  insert into public.engagements(client_name, client_email, note) values ('Shiloh Church', 'pastor@shiloh.example', 'PRIVATE') returning id into e1;
  insert into public.work_orders(org_id, lead_id, company_id, title, amount_cents) values (house, l1, c1, 'Full coverage weekend', 50000) returning id into o1;
  insert into public.work_projects(org_id, title, company_id, relationship_id, lead_id, order_id, budget_cents) values (house, 'Shiloh anniversary', c1, r1, l1, o1, 50000) returning id into p1;
  insert into public.work_bookings(org_id, lead_id, title, state, starts_at, location, note) values (house, l1, 'Anniversary service', 'confirmed', now() + interval '7 days', 'New Haven, CT', 'PRIVATE') returning id into b1;
  insert into public.work_deliverables(org_id, project_id, title, kind) values (house, p1, 'Same-day gallery', 'media') returning id into d1;
  insert into public.work_tasks(org_id, title, related_type, related_id, detail) values (house, 'Confirm shot list', 'booking', b1, 'PRIVATE') returning id into t1;
  insert into public.work_tasks(org_id, title, related_type, related_id) values (house, 'Dangling', 'lead', gen_random_uuid());
  insert into public.offerings(slug, site_id, brand_id, legal_entity_id, offering_type, revenue_type, title, price, fulfillment_type, status)
    values ('event-photo-full', 'matthew', 'mccluster', 'mccluster-corp', 'service', 'service_fee', 'Full coverage', 500, 'service_scheduling', 'live') returning id into f1;
  insert into public.work_renewals(org_id, title, relationship_id, cadence, source_table, source_id) values (house, 'Annual coverage', r1, 'annual', 'offerings', 'event-photo-full') returning id into w1;
  insert into public.work_payments(org_id, title, state, amount_cents, provider, provider_reference, verification, company_id, lead_id, order_id, project_id, renewal_id, paid_at, note)
    values (house, 'Deposit', 'paid', 25000, 'stripe', 'pi_test', 'provider_verified', c1, l1, o1, p1, w1, now(), 'PRIVATE') returning id into y1;
  insert into public.eu_meetings(org_id, title, meeting_type, external_join_url, transcript_ref, notes) values (house, 'Partner call', 'partner', 'https://meet.example/secret', '{"k":"secret"}', 'PRIVATE') returning id into m1;
  insert into public.out_campaigns(org_id, name, sender_id, subject, body_text) values (house, 'CT churches', gen_random_uuid(), 'Event photos', 'SECRET BODY') returning id into g1;
  insert into public.eu_releases(org_id, title, artist, upc) values (house, 'HERE', 'Matthew McCluster', '000000000001') returning id into s1;
  insert into public.eu_recordings(org_id, title, artist, isrc) values (house, 'High Alert', 'Matthew McCluster', 'USXXX2600001') returning id into rec1;
  insert into public.eu_release_tracks(release_id, recording_id, track_no) values (s1, rec1, 1);
  insert into public.control_approvals(org_id, capability, resource_type, resource_id, request_hash, requested_by) values (house, 'dispatch.execute', 'dispatch_turn', 'x', repeat('a', 64), usr) returning id into a1;

  -- first refresh materializes everything
  res := private.ops_ontology_graph_v2_refresh(null);
  assert (res->'objects'->>'new')::int = 20, 'first refresh materializes 20 source rows: ' || res::text;
  assert (res->'objects'->>'removed')::int = 0;
  assert (res->'links'->>'unresolved')::int = 1, 'the dangling task link is unresolved, not invented: ' || res::text;

  select count(*) into n from public.ops_ontology_types where org_id = house;
  assert n = 22, 'house has 4 v1 + 18 v2 object types, got ' || n;
  select count(*) into n from public.ops_ontology_link_types where org_id = house;
  assert n = 30, 'house has 1 v1 + 29 v2 link types, got ' || n;
  assert jsonb_array_length(public.ops_ontology_schema_service(house)->'types') = 22, 'schema service sees the new types';

  select count(distinct type_key) into n from public.ops_ontology_objects where org_id = house and source_ref->>'materializer' = 'ontology_graph_v2';
  assert n = 18, 'every v2 type has an object in the house, got ' || n;
  assert exists (select 1 from public.ops_ontology_objects where org_id = tenant and type_key = 'lead' and object_key = l2::text), 'tenant lead stays in the tenant';
  assert (select properties->>'house_scoped' from public.ops_ontology_objects where type_key = 'lead' and object_key = l1::text) = 'true', 'org-less lead is house scoped';
  assert exists (select 1 from public.ops_ontology_objects where org_id = house and type_key = 'offering' and object_key = f1::text), 'offerings are house scoped';
  assert exists (select 1 from public.ops_ontology_objects where org_id = house and type_key = 'engagement' and object_key = e1::text), 'engagements are house scoped';

  -- privacy: no free text, bodies, tokens, click ids, transcripts or join links
  select coalesce(string_agg(properties::text, '|'), '') into blob from public.ops_ontology_objects where source_ref->>'materializer' = 'ontology_graph_v2';
  assert position('PRIVATE' in blob) = 0, 'notes are not copied';
  assert position('GCLID-SECRET' in blob) = 0, 'click ids are not copied';
  assert position('SECRET BODY' in blob) = 0, 'campaign bodies are not copied';
  assert position('meet.example' in blob) = 0, 'join links are not copied';
  assert position('secret' in blob) = 0, 'transcripts are not copied';
  assert not exists (select 1 from public.ops_ontology_objects where type_key = 'contact' and properties ? 'unsub_token'), 'unsubscribe tokens are not copied';
  assert not exists (select 1 from public.ops_ontology_objects where type_key = 'approval' and properties ? 'request_hash'), 'approval hashes are not copied';

  -- links come from foreign keys only
  assert (select count(*) from public.ops_ontology_links l where l.source_ref->>'materializer' = 'ontology_graph_v2') = 22,
    'expected 22 FK links, got ' || (select count(*) from public.ops_ontology_links l where l.source_ref->>'materializer' = 'ontology_graph_v2');
  assert exists (
    select 1 from public.ops_ontology_links l
    join public.ops_ontology_objects s on s.id = l.source_object_id join public.ops_ontology_objects t on t.id = l.target_object_id
    where l.link_key = 'project_for_client' and s.object_key = p1::text and t.object_key = r1::text), 'project_for_client';
  assert exists (
    select 1 from public.ops_ontology_links l join public.ops_ontology_objects t on t.id = l.target_object_id
    where l.link_key = 'task_about_booking' and t.object_key = b1::text), 'polymorphic task link resolves';
  assert exists (
    select 1 from public.ops_ontology_links l join public.ops_ontology_objects t on t.id = l.target_object_id
    where l.link_key = 'renewal_of_offering' and t.object_key = f1::text), 'renewal resolves an offering by slug';
  assert (select properties->>'track_no' from public.ops_ontology_links where link_key = 'release_has_track') = '1', 'track number carried';
  assert (select count(*) from public.ops_ontology_links where link_key like 'payment_%') = 5, 'five payment links';

  -- second refresh writes nothing
  select count(*) into n from public.ops_ontology_lineage;
  res := private.ops_ontology_graph_v2_refresh(null);
  assert (res->'objects'->>'new')::int = 0 and (res->'objects'->>'changed')::int = 0 and (res->'objects'->>'removed')::int = 0, 'idempotent objects: ' || res::text;
  assert (res->'links'->>'new')::int = 0 and (res->'links'->>'changed')::int = 0 and (res->'links'->>'removed')::int = 0, 'idempotent links: ' || res::text;
  assert (select count(*) from public.ops_ontology_lineage) = n, 'no-op refresh writes no lineage';

  -- owner annotations survive a source change; the change bumps version and is logged
  select id, version into v_obj, v_ver from public.ops_ontology_objects where type_key = 'lead' and object_key = l1::text;
  update public.ops_ontology_objects set properties = properties || '{"_annotations":{"vip":true},"_tags":["church"]}'::jsonb where id = v_obj;
  update public.leads set status = 'booked' where id = l1;
  res := private.ops_ontology_graph_v2_refresh(house);
  assert (res->'objects'->>'changed')::int = 1, 'only the changed lead syncs: ' || res::text;
  select properties into props from public.ops_ontology_objects where id = v_obj;
  assert props->>'status' = 'booked' and props->'_annotations'->>'vip' = 'true' and props->'_tags' = '["church"]'::jsonb, 'annotations preserved';
  assert (select version from public.ops_ontology_objects where id = v_obj) = v_ver + 1, 'version bumped';
  assert exists (select 1 from public.ops_ontology_lineage where object_id = v_obj and event_type = 'object.synced'), 'sync logged';

  -- a hand-made link of a v2 key is never removed by the materializer
  insert into public.ops_ontology_links(org_id, link_key, source_object_id, target_object_id, source_ref)
  select house, 'booking_for_company', b.id, c.id, '{"action_run_id":"manual"}'::jsonb
  from public.ops_ontology_objects b, public.ops_ontology_objects c
  where b.type_key = 'booking' and b.object_key = b1::text and c.type_key = 'company' and c.object_key = c1::text;
  res := private.ops_ontology_graph_v2_refresh(house);
  assert exists (select 1 from public.ops_ontology_links where link_key = 'booking_for_company' and source_ref->>'action_run_id' = 'manual'), 'manual link kept';

  -- a deleted source row removes its object and links, with lineage
  delete from public.work_deliverables where id = d1;
  update public.work_tasks set related_type = 'lead', related_id = l1 where id = t1;
  res := private.ops_ontology_graph_v2_refresh(house);
  assert (res->'objects'->>'removed')::int = 1, 'deliverable removed: ' || res::text;
  assert not exists (select 1 from public.ops_ontology_objects where type_key = 'deliverable'), 'deliverable object gone';
  assert not exists (select 1 from public.ops_ontology_links where link_key = 'deliverable_of_project'), 'deliverable link gone';
  assert not exists (select 1 from public.ops_ontology_links where link_key = 'task_about_booking'), 'stale task link removed';
  assert exists (select 1 from public.ops_ontology_links where link_key = 'task_about_lead'), 'new task link added';
  assert exists (select 1 from public.ops_ontology_lineage where event_type = 'object.source_deleted' and subject_type = 'deliverable'), 'deletion logged';
  assert exists (select 1 from public.ops_ontology_lineage where event_type = 'link.source_deleted' and subject_type = 'task_about_booking'), 'link removal logged';

  -- an org-scoped refresh does not touch another org
  delete from public.leads where id = l2;
  res := private.ops_ontology_graph_v2_refresh(house);
  assert exists (select 1 from public.ops_ontology_objects where org_id = tenant and object_key = l2::text), 'house refresh leaves tenant alone';
  res := public.ops_ontology_graph_v2_refresh_service(tenant);
  assert not exists (select 1 from public.ops_ontology_objects where org_id = tenant and object_key = l2::text), 'tenant refresh removes it';

  ok := false;
  begin perform public.ops_ontology_graph_v2_refresh_service(null);
  exception when invalid_parameter_value then ok := true; end;
  assert ok, 'service refresh needs an org';

  -- v1 objects untouched; no source rows written
  assert (select count(*) from public.ops_ontology_objects where type_key = 'organization') = 2, 'v1 organization objects intact';
  assert not exists (select 1 from public.ops_ontology_objects where type_key in ('organization','objective','agent_job','application')
                     and source_ref->>'materializer' = 'ontology_graph_v2'), 'v1 rows not claimed';
  assert not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
                     where not g.tgisinternal and c.relname in ('leads','work_payments','work_bookings','out_contacts','out_companies','work_orders')),
    'no trigger on source tables';

  -- privileges
  assert has_function_privilege('service_role', 'public.ops_ontology_graph_v2_refresh_service(uuid)', 'execute'), 'service_role can refresh';
  assert not has_function_privilege('authenticated', 'public.ops_ontology_graph_v2_refresh_service(uuid)', 'execute'), 'authenticated cannot refresh';
  assert not has_function_privilege('anon', 'public.ops_ontology_graph_v2_refresh_service(uuid)', 'execute'), 'anon cannot refresh';
  assert not has_function_privilege('authenticated', 'private.ops_ontology_graph_v2_refresh(uuid)', 'execute'), 'private refresh is closed';
  assert not has_table_privilege('authenticated', 'private.ops_ontology_graph_v2_objects', 'select'), 'source view is closed';
  raise notice 'ops_ontology_graph_v2 behaviour: all checks passed';
end $t$;
