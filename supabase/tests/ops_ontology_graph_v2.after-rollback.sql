-- Run after 20261125010000_ops_ontology_graph_v2.rollback.sql on the behaviour database. Raises on failure.
do $t$
declare house constant uuid := '00000000-0000-4000-8000-000000000001';
begin
  assert to_regprocedure('public.ops_ontology_graph_v2_refresh_service(uuid)') is null, 'service function dropped';
  assert to_regprocedure('private.ops_ontology_graph_v2_refresh(uuid)') is null, 'refresh dropped';
  assert to_regclass('private.ops_ontology_graph_v2_objects') is null and to_regclass('private.ops_ontology_graph_v2_links') is null, 'views dropped';
  assert not exists (select 1 from public.ops_ontology_objects where source_ref->>'materializer' = 'ontology_graph_v2'), 'materialized objects removed';
  assert not exists (select 1 from public.ops_ontology_links where source_ref->>'materializer' = 'ontology_graph_v2'), 'materialized links removed';
  -- the hand-made booking_for_company link joined two materialized objects, so it went with them
  assert (select count(*) from public.ops_ontology_link_types where org_id = house) = 1, 'only the v1 link type remains';
  assert (select count(*) from public.ops_ontology_types where org_id = house) = 4, 'only the 4 v1 types remain';
  assert (select count(*) from public.ops_ontology_objects where type_key = 'organization') = 2, 'v1 objects intact';
  assert exists (select 1 from public.ops_ontology_lineage where event_type = 'object.materialized'), 'lineage kept as history';
  raise notice 'ops_ontology_graph_v2 rollback: all checks passed';
end $t$;
