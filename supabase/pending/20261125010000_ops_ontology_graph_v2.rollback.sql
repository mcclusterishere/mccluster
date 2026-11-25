-- ROLLBACK for ops_ontology_graph_v2 (20261125010000_ops_ontology_graph_v2.sql). Owner approval required.
-- Removes only what the forward file created: its functions and views, the objects and links it materialized
-- (source_ref.materializer = 'ontology_graph_v2'), and its 29 link types and 18 object types. A type or link type
-- still used by a row this file did not create (for example a link made by hand through the object_link action)
-- is kept. A hand-made link whose two ends are both materialized objects goes with them (the v1 foreign keys cascade);
-- the action run that made it stays in ops_ontology_action_runs. ops_ontology_lineage rows are kept as audit history.
-- No v1 ontology object, source table or source row is touched.
begin;
set local lock_timeout = '5s';

drop function if exists public.ops_ontology_graph_v2_refresh_service(uuid);
drop function if exists private.ops_ontology_graph_v2_refresh(uuid);
drop view if exists private.ops_ontology_graph_v2_links;
drop view if exists private.ops_ontology_graph_v2_objects;
drop function if exists private.ops_ontology_graph_v2_ensure_types(uuid);

delete from public.ops_ontology_links where source_ref->>'materializer' = 'ontology_graph_v2';
delete from public.ops_ontology_objects where source_ref->>'materializer' = 'ontology_graph_v2';

delete from public.ops_ontology_link_types lt
 where lt.link_key in ('contact_at_company','lead_at_company','client_is_company','client_is_contact','client_from_lead',
   'project_for_client','project_for_company','project_from_lead','project_from_order','order_for_company','order_from_lead',
   'booking_for_company','booking_from_lead','deliverable_of_project','task_about_lead','task_about_company','task_about_order',
   'task_about_booking','payment_for_order','payment_for_project','payment_for_renewal','payment_from_company','payment_from_lead',
   'renewal_for_client','renewal_for_project','renewal_for_order','renewal_for_company','renewal_of_offering','release_has_track')
   and lt.property_schema->>'x-materializer' = 'ontology_graph_v2'
   and not exists (select 1 from public.ops_ontology_links l where l.org_id = lt.org_id and l.link_key = lt.link_key);

delete from public.ops_ontology_types t
 where t.type_key in ('company','contact','lead','client','engagement','project','order','booking','meeting','deliverable',
   'task','payment','renewal','offering','campaign','release','track','approval')
   and t.source_binding->>'materializer' = 'ontology_graph_v2'
   and not exists (select 1 from public.ops_ontology_objects o where o.org_id = t.org_id and o.type_key = t.type_key)
   and not exists (select 1 from public.ops_ontology_link_types lt where lt.org_id = t.org_id
                     and (lt.source_type_key = t.type_key or lt.target_type_key = t.type_key))
   and not exists (select 1 from public.ops_ontology_action_types a where a.org_id = t.org_id and a.target_type_key = t.type_key);

commit;
