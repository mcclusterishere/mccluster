-- OPS ONTOLOGY GRAPH v2 (migration name ops_ontology_graph_v2): widen the McCluster operational ontology from its
-- four v1 object types (organization, objective, agent_job, application) to 22, each backed by a table that already
-- exists in production, and add 29 typed link types that come only from foreign keys already in those tables.
-- PENDING ONLY. Never applied to production. Owner approval required before any apply.
-- Contract: docs/control-plane/ONTOLOGY-GRAPH-V2.md and core/ontology/graph-v2.json.
-- Rollback: 20261125010000_ops_ontology_graph_v2.rollback.sql.
-- Needs, already in production: the v1 ontology (20260919053445_operational_ontology_v1), public.orgs and the
-- source tables listed in the guard below with the columns the guard checks.
--
-- What it creates, all additive:
--   private.ops_ontology_graph_v2_ensure_types(org)   registers the 18 new object types and 29 link types for one org
--                                                      (insert ... on conflict do nothing; v1 rows are never touched).
--   private.ops_ontology_graph_v2_objects (view)       one row per source record, already shaped as an ontology object.
--   private.ops_ontology_graph_v2_links (view)         one row per source foreign key, shaped as an ontology link.
--   private.ops_ontology_graph_v2_refresh(org|null)    set-based materializer: inserts new objects and links, updates
--                                                      only changed ones (owner _annotations/_tags are preserved),
--                                                      removes ones whose source row is gone, and writes one
--                                                      ops_ontology_lineage row per change. Safe to run any time.
--   public.ops_ontology_graph_v2_refresh_service(org)  SECURITY DEFINER, search_path pinned, EXECUTE for service_role only.
-- It changes no existing object: no v1 function is replaced, no trigger is added to any source table (a failure
-- in the ontology can never block a lead, payment or booking write), and no source row is written.
-- Only rows this file materializes carry source_ref.materializer = 'ontology_graph_v2', and only those rows are ever
-- updated or deleted by the refresh. Links created by hand through ops_ontology_apply_action_service are left alone.
--
-- Privacy: properties copy operational fields only. Free-text notes, message bodies, unsubscribe tokens, click ids,
-- meeting transcripts and join links, and approval request hashes are deliberately not copied.
-- House scope: rows with no org (leads.org_id is null, offerings, engagements) belong to the house org
-- (orgs.slug = 'mccluster'); with no house org they are skipped.
-- Duplicate-record matching (entity resolution) is a separate change; this file does not touch ops_entity_* tables.
-- One transaction. Safe to run twice. Ends with one backfill refresh.
begin;
set local lock_timeout = '5s';

do $guard$
declare
  need text[] := array[
    'ops_ontology_types.type_key','ops_ontology_objects.object_key','ops_ontology_link_types.link_key',
    'ops_ontology_links.link_key','ops_ontology_lineage.event_type','orgs.slug',
    'out_companies.org_id','out_companies.name','out_companies.domain','out_companies.kind','out_companies.status',
    'out_contacts.org_id','out_contacts.company_id','out_contacts.email','out_contacts.consent',
    'leads.org_id','leads.company_id','leads.email','leads.status','leads.at',
    'work_relationships.org_id','work_relationships.relationship_type','work_relationships.company_id',
    'work_relationships.contact_id','work_relationships.lead_id',
    'engagements.client_name','engagements.decision',
    'work_projects.org_id','work_projects.relationship_id','work_projects.order_id',
    'work_orders.org_id','work_orders.lead_id','work_orders.company_id','work_orders.amount_cents',
    'work_bookings.org_id','work_bookings.starts_at','work_bookings.lead_id','work_bookings.company_id',
    'eu_meetings.org_id','eu_meetings.meeting_type','eu_meetings.starts_at',
    'work_deliverables.org_id','work_deliverables.project_id','work_deliverables.approval_state',
    'work_tasks.org_id','work_tasks.related_type','work_tasks.related_id',
    'work_payments.org_id','work_payments.amount_cents','work_payments.order_id','work_payments.renewal_id',
    'work_renewals.org_id','work_renewals.relationship_id','work_renewals.source_table','work_renewals.source_id',
    'offerings.slug','offerings.offering_type','offerings.status',
    'out_campaigns.org_id','out_campaigns.subject','out_campaigns.status',
    'eu_releases.org_id','eu_releases.upc','eu_releases.status',
    'eu_recordings.org_id','eu_recordings.isrc',
    'eu_release_tracks.release_id','eu_release_tracks.recording_id','eu_release_tracks.track_no',
    'control_approvals.org_id','control_approvals.capability','control_approvals.state'
  ];
  missing text[] := '{}';
  c text;
begin
  if to_regnamespace('private') is null
     or to_regprocedure('public.ops_ontology_schema_service(uuid)') is null then
    raise exception 'ops_ontology_graph_v2 needs the v1 ontology (private schema, ops_ontology_schema_service); nothing changed' using errcode = '55000';
  end if;
  foreach c in array need loop
    if not exists (
      select 1 from pg_attribute a
      where a.attrelid = to_regclass('public.' || split_part(c, '.', 1))
        and a.attname = split_part(c, '.', 2) and a.attnum > 0 and not a.attisdropped
    ) then
      missing := missing || c;
    end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'ops_ontology_graph_v2 source columns missing: %; nothing changed', array_to_string(missing, ', ') using errcode = '55000';
  end if;
end $guard$;

create or replace function private.ops_ontology_graph_v2_ensure_types(p_org uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
begin
  insert into public.ops_ontology_types(org_id,type_key,display_name,description,property_schema,source_binding)
  select p_org, t.type_key, t.display_name, t.description,
         jsonb_build_object('type','object','properties',t.props),
         jsonb_build_object('table',t.src,'id','id','materializer','ontology_graph_v2') || t.extra
  from (values
    ('company','Company','An organization McCluster works with or reaches out to (out_companies)','out_companies',
      '{"name":{"type":"string"},"domain":{"type":"string"},"kind":{"type":"string"},"status":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('contact','Contact','A person at a company with recorded consent state (out_contacts)','out_contacts',
      '{"email":{"type":"string"},"name":{"type":"string"},"consent":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('lead','Lead','An inbound inquiry from a McCluster site or campaign (leads)','leads',
      '{"email":{"type":"string"},"status":{"type":"string"},"source":{"type":"string"}}'::jsonb,'{"scope":"org_or_house"}'::jsonb),
    ('client','Client relationship','A client, prospect, partner, sponsor, vendor or collaborator relationship (work_relationships)','work_relationships',
      '{"relationship_type":{"type":"string"},"state":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('engagement','Engagement','A client activation sprint with its free month and upgrade decision (engagements)','engagements',
      '{"client_name":{"type":"string"},"decision":{"type":"string"}}'::jsonb,'{"scope":"house"}'::jsonb),
    ('project','Project','Post-sale client work with budget and due date (work_projects)','work_projects',
      '{"state":{"type":"string"},"budget_cents":{"type":"integer"}}'::jsonb,'{}'::jsonb),
    ('order','Order','A sold order with amount and fulfilment state (work_orders)','work_orders',
      '{"state":{"type":"string"},"amount_cents":{"type":"integer"},"currency":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('booking','Booking (event)','A booked event or session with time and place (work_bookings)','work_bookings',
      '{"state":{"type":"string"},"starts_at":{"type":"string"},"location":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('meeting','Meeting','A stakeholder, partner, research or government meeting (eu_meetings)','eu_meetings',
      '{"meeting_type":{"type":"string"},"status":{"type":"string"},"starts_at":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('deliverable','Deliverable','A file, site, media or report delivered on a project, with client approval state (work_deliverables)','work_deliverables',
      '{"state":{"type":"string"},"approval_state":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('task','Task','An internal to-do tied to a lead, company, order or booking (work_tasks)','work_tasks',
      '{"state":{"type":"string"},"due_at":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('payment','Payment','Money due or received, owner-recorded or provider-verified (work_payments)','work_payments',
      '{"state":{"type":"string"},"amount_cents":{"type":"integer"},"verification":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('renewal','Renewal','A recurring or one-time renewal with its next date (work_renewals)','work_renewals',
      '{"state":{"type":"string"},"cadence":{"type":"string"},"renews_at":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('offering','Offering','A product, service, booking or subscription McCluster sells (offerings)','offerings',
      '{"slug":{"type":"string"},"offering_type":{"type":"string"},"status":{"type":"string"}}'::jsonb,'{"scope":"house"}'::jsonb),
    ('campaign','Outreach campaign','An outreach campaign definition and its approval state; message bodies are not copied (out_campaigns)','out_campaigns',
      '{"status":{"type":"string"},"audience_kind":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('release','Release','A music release with UPC and distribution status (eu_releases)','eu_releases',
      '{"upc":{"type":"string"},"status":{"type":"string"},"release_type":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('track','Track','A recorded track with ISRC (eu_recordings)','eu_recordings',
      '{"isrc":{"type":"string"},"artist":{"type":"string"}}'::jsonb,'{}'::jsonb),
    ('approval','Approval','A Control approval request and its decision (control_approvals)','control_approvals',
      '{"capability":{"type":"string"},"state":{"type":"string"}}'::jsonb,'{}'::jsonb)
  ) as t(type_key,display_name,description,src,props,extra)
  on conflict (org_id,type_key) do nothing;

  insert into public.ops_ontology_link_types(org_id,link_key,display_name,description,source_type_key,target_type_key,property_schema)
  select p_org, l.link_key, l.display_name, l.description || ' (' || l.fk || ')', l.s, l.t,
         jsonb_build_object('type','object','x-source-fk',l.fk,'x-materializer','ontology_graph_v2')
  from (values
    ('contact_at_company','Contact at company','A contact works at a company','contact','company','out_contacts.company_id'),
    ('lead_at_company','Lead at company','A lead belongs to a company','lead','company','leads.company_id'),
    ('client_is_company','Client is company','A client relationship is with a company','client','company','work_relationships.company_id'),
    ('client_is_contact','Client is contact','A client relationship is with a contact','client','contact','work_relationships.contact_id'),
    ('client_from_lead','Client from lead','A client relationship came from a lead','client','lead','work_relationships.lead_id'),
    ('project_for_client','Project for client','A project is delivered for a client relationship','project','client','work_projects.relationship_id'),
    ('project_for_company','Project for company','A project is delivered for a company','project','company','work_projects.company_id'),
    ('project_from_lead','Project from lead','A project came from a lead','project','lead','work_projects.lead_id'),
    ('project_from_order','Project from order','A project fulfils an order','project','order','work_projects.order_id'),
    ('order_for_company','Order for company','An order was placed by a company','order','company','work_orders.company_id'),
    ('order_from_lead','Order from lead','An order came from a lead','order','lead','work_orders.lead_id'),
    ('booking_for_company','Booking for company','A booking is for a company','booking','company','work_bookings.company_id'),
    ('booking_from_lead','Booking from lead','A booking came from a lead','booking','lead','work_bookings.lead_id'),
    ('deliverable_of_project','Deliverable of project','A deliverable belongs to a project','deliverable','project','work_deliverables.project_id'),
    ('task_about_lead','Task about lead','A task concerns a lead','task','lead','work_tasks.related_type=lead'),
    ('task_about_company','Task about company','A task concerns a company','task','company','work_tasks.related_type=company'),
    ('task_about_order','Task about order','A task concerns an order','task','order','work_tasks.related_type=order'),
    ('task_about_booking','Task about booking','A task concerns a booking','task','booking','work_tasks.related_type=booking'),
    ('payment_for_order','Payment for order','A payment settles an order','payment','order','work_payments.order_id'),
    ('payment_for_project','Payment for project','A payment is for a project','payment','project','work_payments.project_id'),
    ('payment_for_renewal','Payment for renewal','A payment is for a renewal','payment','renewal','work_payments.renewal_id'),
    ('payment_from_company','Payment from company','A payment is owed or made by a company','payment','company','work_payments.company_id'),
    ('payment_from_lead','Payment from lead','A payment is owed or made by a lead','payment','lead','work_payments.lead_id'),
    ('renewal_for_client','Renewal for client','A renewal belongs to a client relationship','renewal','client','work_renewals.relationship_id'),
    ('renewal_for_project','Renewal for project','A renewal continues a project','renewal','project','work_renewals.project_id'),
    ('renewal_for_order','Renewal for order','A renewal continues an order','renewal','order','work_renewals.order_id'),
    ('renewal_for_company','Renewal for company','A renewal is with a company','renewal','company','work_renewals.company_id'),
    ('renewal_of_offering','Renewal of offering','A renewal is of an offering','renewal','offering','work_renewals.source_table=offerings'),
    ('release_has_track','Release has track','A release contains a track at a disc and track number','release','track','eu_release_tracks')
  ) as l(link_key,display_name,description,s,t,fk)
  on conflict (org_id,link_key) do nothing;
end
$$;

create or replace view private.ops_ontology_graph_v2_objects as
with house as (select o.id from public.orgs o where o.slug = 'mccluster' order by o.created_at limit 1)
select r.org_id,'company'::text as type_key,r.id::text as object_key,coalesce(nullif(r.name,''),r.domain,'company') as display_name,
  jsonb_strip_nulls(jsonb_build_object('name',r.name,'domain',r.domain,'kind',r.kind,'city',r.city,'region',r.region,'source',r.source,'status',r.status,'created_at',r.created_at)) as properties,
  jsonb_build_object('table','out_companies','pk',r.id::text,'materializer','ontology_graph_v2') as source_ref, r.created_at as observed_at
from public.out_companies r
union all
select r.org_id,'contact',r.id::text,coalesce(nullif(r.name,''),r.email),
  jsonb_strip_nulls(jsonb_build_object('company_id',r.company_id,'name',r.name,'email',r.email,'title',r.title,'consent',r.consent,'consent_source',r.consent_source,'consent_at',r.consent_at,'created_at',r.created_at)),
  jsonb_build_object('table','out_contacts','pk',r.id::text,'materializer','ontology_graph_v2'), r.created_at
from public.out_contacts r
union all
select coalesce(r.org_id,(select id from house)),'lead',r.id::text,coalesce(nullif(r.name,''),r.email),
  jsonb_strip_nulls(jsonb_build_object('name',r.name,'email',r.email,'want',r.want,'page',r.page,'source',r.source,'medium',r.medium,'campaign',r.campaign,'status',r.status,'company_id',r.company_id,'at',r.at,'house_scoped',r.org_id is null)),
  jsonb_build_object('table','leads','pk',r.id::text,'materializer','ontology_graph_v2'), r.at
from public.leads r where coalesce(r.org_id,(select id from house)) is not null
union all
select r.org_id,'client',r.id::text,r.title,
  jsonb_strip_nulls(jsonb_build_object('title',r.title,'relationship_type',r.relationship_type,'state',r.state,'company_id',r.company_id,'contact_id',r.contact_id,'lead_id',r.lead_id,'owner_id',r.owner_id,'started_at',r.started_at,'ended_at',r.ended_at,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','work_relationships','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.work_relationships r
union all
select h.id,'engagement',r.id::text,r.client_name,
  jsonb_strip_nulls(jsonb_build_object('client_name',r.client_name,'client_email',r.client_email,'site_slug',r.site_slug,'offer_id',r.offer_id,'mode',r.mode,'started_on',r.started_on,'free_until',r.free_until,'decision',r.decision,'decided_at',r.decided_at,'created_at',r.created_at)),
  jsonb_build_object('table','engagements','pk',r.id::text,'materializer','ontology_graph_v2'), coalesce(r.decided_at,r.created_at)
from public.engagements r cross join house h
union all
select r.org_id,'project',r.id::text,r.title,
  jsonb_strip_nulls(jsonb_build_object('title',r.title,'state',r.state,'summary',r.summary,'company_id',r.company_id,'relationship_id',r.relationship_id,'lead_id',r.lead_id,'order_id',r.order_id,'owner_id',r.owner_id,'starts_at',r.starts_at,'due_at',r.due_at,'budget_cents',r.budget_cents,'currency',r.currency,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','work_projects','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.work_projects r
union all
select r.org_id,'order',r.id::text,r.title,
  jsonb_strip_nulls(jsonb_build_object('title',r.title,'state',r.state,'amount_cents',r.amount_cents,'currency',r.currency,'items',r.items,'source_table',r.source_table,'source_id',r.source_id,'lead_id',r.lead_id,'company_id',r.company_id,'placed_at',r.placed_at,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','work_orders','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.work_orders r
union all
select r.org_id,'booking',r.id::text,r.title,
  jsonb_strip_nulls(jsonb_build_object('title',r.title,'state',r.state,'starts_at',r.starts_at,'ends_at',r.ends_at,'location',r.location,'lead_id',r.lead_id,'company_id',r.company_id,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','work_bookings','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.work_bookings r
union all
select r.org_id,'meeting',r.id::text,r.title,
  jsonb_strip_nulls(jsonb_build_object('title',r.title,'meeting_type',r.meeting_type,'status',r.status,'starts_at',r.starts_at,'ends_at',r.ends_at,'timezone',r.timezone,'provider',nullif(r.provider,''),'initiative_id',r.initiative_id,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','eu_meetings','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.eu_meetings r
union all
select r.org_id,'deliverable',r.id::text,r.title,
  jsonb_strip_nulls(jsonb_build_object('project_id',r.project_id,'title',r.title,'kind',r.kind,'state',r.state,'approval_state',r.approval_state,'artifact_url',r.artifact_url,'media_asset_id',r.media_asset_id,'due_at',r.due_at,'delivered_at',r.delivered_at,'approved_at',r.approved_at,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','work_deliverables','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.work_deliverables r
union all
select r.org_id,'task',r.id::text,r.title,
  jsonb_strip_nulls(jsonb_build_object('title',r.title,'state',r.state,'assignee',r.assignee,'due_at',r.due_at,'related_type',r.related_type,'related_id',r.related_id,'completed_at',r.completed_at,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','work_tasks','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.work_tasks r
union all
select r.org_id,'payment',r.id::text,r.title,
  jsonb_strip_nulls(jsonb_build_object('title',r.title,'state',r.state,'amount_cents',r.amount_cents,'currency',r.currency,'provider',r.provider,'provider_reference',r.provider_reference,'verification',r.verification,'company_id',r.company_id,'lead_id',r.lead_id,'order_id',r.order_id,'project_id',r.project_id,'renewal_id',r.renewal_id,'due_at',r.due_at,'paid_at',r.paid_at,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','work_payments','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.work_payments r
union all
select r.org_id,'renewal',r.id::text,r.title,
  jsonb_strip_nulls(jsonb_build_object('title',r.title,'state',r.state,'cadence',r.cadence,'company_id',r.company_id,'relationship_id',r.relationship_id,'project_id',r.project_id,'order_id',r.order_id,'amount_cents',r.amount_cents,'currency',r.currency,'renews_at',r.renews_at,'last_renewed_at',r.last_renewed_at,'source_table',r.source_table,'source_id',r.source_id,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','work_renewals','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.work_renewals r
union all
select h.id,'offering',r.id::text,r.title,
  jsonb_strip_nulls(jsonb_build_object('slug',r.slug,'site_id',r.site_id,'brand_id',r.brand_id,'legal_entity_id',r.legal_entity_id,'offering_type',r.offering_type,'revenue_type',r.revenue_type,'title',r.title,'short_description',r.short_description,'price',r.price,'currency',r.currency,'price_type',r.price_type,'payment_provider',r.payment_provider,'fulfillment_type',r.fulfillment_type,'primary_action',r.primary_action,'status',r.status,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','offerings','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.offerings r cross join house h
union all
select r.org_id,'campaign',r.id::text,r.name,
  jsonb_strip_nulls(jsonb_build_object('name',r.name,'subject',r.subject,'audience_kind',r.audience_kind,'status',r.status,'throttle_per_hour',r.throttle_per_hour,'approved_at',r.approved_at,'created_at',r.created_at)),
  jsonb_build_object('table','out_campaigns','pk',r.id::text,'materializer','ontology_graph_v2'), coalesce(r.approved_at,r.created_at)
from public.out_campaigns r
union all
select r.org_id,'release',r.id::text,r.title,
  jsonb_strip_nulls(jsonb_build_object('title',r.title,'artist',r.artist,'upc',nullif(r.upc,''),'release_type',r.release_type,'release_date',r.release_date,'label',r.label,'territories',to_jsonb(r.territories),'status',r.status,'initiative_id',r.initiative_id,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','eu_releases','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.eu_releases r
union all
select r.org_id,'track',r.id::text,case when r.version_title<>'' then r.title||' ('||r.version_title||')' else r.title end,
  jsonb_strip_nulls(jsonb_build_object('title',r.title,'version_title',nullif(r.version_title,''),'artist',r.artist,'isrc',nullif(r.isrc,''),'duration_ms',r.duration_ms,'recording_year',r.recording_year,'language',r.language,'explicit',r.explicit,'work_id',r.work_id,'initiative_id',r.initiative_id,'created_at',r.created_at,'updated_at',r.updated_at)),
  jsonb_build_object('table','eu_recordings','pk',r.id::text,'materializer','ontology_graph_v2'), r.updated_at
from public.eu_recordings r
union all
select r.org_id,'approval',r.id::text,r.capability||' '||r.resource_type,
  jsonb_strip_nulls(jsonb_build_object('capability',r.capability,'resource_type',r.resource_type,'resource_id',r.resource_id,'state',r.state,'reason',r.reason,'requested_by',r.requested_by,'decided_by',r.decided_by,'created_at',r.created_at,'decided_at',r.decided_at,'expires_at',r.expires_at)),
  jsonb_build_object('table','control_approvals','pk',r.id::text,'materializer','ontology_graph_v2'), coalesce(r.decided_at,r.created_at)
from public.control_approvals r;

create or replace view private.ops_ontology_graph_v2_links as
with house as (select o.id from public.orgs o where o.slug = 'mccluster' order by o.created_at limit 1),
fk(org_id,link_key,source_type_key,source_object_key,target_type_key,target_object_key,properties,source_ref) as (
  select org_id,'contact_at_company','contact',id::text,'company',company_id::text,'{}'::jsonb,jsonb_build_object('table','out_contacts','pk',id::text,'column','company_id') from public.out_contacts where company_id is not null
  union all
  select coalesce(l.org_id,(select id from house)),'lead_at_company','lead',l.id::text,'company',l.company_id::text,'{}'::jsonb,jsonb_build_object('table','leads','pk',l.id::text,'column','company_id') from public.leads l where l.company_id is not null
  union all
  select org_id,'client_is_company','client',id::text,'company',company_id::text,'{}'::jsonb,jsonb_build_object('table','work_relationships','pk',id::text,'column','company_id') from public.work_relationships where company_id is not null
  union all
  select org_id,'client_is_contact','client',id::text,'contact',contact_id::text,'{}'::jsonb,jsonb_build_object('table','work_relationships','pk',id::text,'column','contact_id') from public.work_relationships where contact_id is not null
  union all
  select org_id,'client_from_lead','client',id::text,'lead',lead_id::text,'{}'::jsonb,jsonb_build_object('table','work_relationships','pk',id::text,'column','lead_id') from public.work_relationships where lead_id is not null
  union all
  select org_id,'project_for_client','project',id::text,'client',relationship_id::text,'{}'::jsonb,jsonb_build_object('table','work_projects','pk',id::text,'column','relationship_id') from public.work_projects where relationship_id is not null
  union all
  select org_id,'project_for_company','project',id::text,'company',company_id::text,'{}'::jsonb,jsonb_build_object('table','work_projects','pk',id::text,'column','company_id') from public.work_projects where company_id is not null
  union all
  select org_id,'project_from_lead','project',id::text,'lead',lead_id::text,'{}'::jsonb,jsonb_build_object('table','work_projects','pk',id::text,'column','lead_id') from public.work_projects where lead_id is not null
  union all
  select org_id,'project_from_order','project',id::text,'order',order_id::text,'{}'::jsonb,jsonb_build_object('table','work_projects','pk',id::text,'column','order_id') from public.work_projects where order_id is not null
  union all
  select org_id,'order_for_company','order',id::text,'company',company_id::text,'{}'::jsonb,jsonb_build_object('table','work_orders','pk',id::text,'column','company_id') from public.work_orders where company_id is not null
  union all
  select org_id,'order_from_lead','order',id::text,'lead',lead_id::text,'{}'::jsonb,jsonb_build_object('table','work_orders','pk',id::text,'column','lead_id') from public.work_orders where lead_id is not null
  union all
  select org_id,'booking_for_company','booking',id::text,'company',company_id::text,'{}'::jsonb,jsonb_build_object('table','work_bookings','pk',id::text,'column','company_id') from public.work_bookings where company_id is not null
  union all
  select org_id,'booking_from_lead','booking',id::text,'lead',lead_id::text,'{}'::jsonb,jsonb_build_object('table','work_bookings','pk',id::text,'column','lead_id') from public.work_bookings where lead_id is not null
  union all
  select org_id,'deliverable_of_project','deliverable',id::text,'project',project_id::text,'{}'::jsonb,jsonb_build_object('table','work_deliverables','pk',id::text,'column','project_id') from public.work_deliverables
  union all
  select org_id,'task_about_'||related_type,'task',id::text,related_type,related_id::text,'{}'::jsonb,jsonb_build_object('table','work_tasks','pk',id::text,'column','related_id','related_type',related_type) from public.work_tasks where related_type in ('lead','company','order','booking') and related_id is not null
  union all
  select org_id,'payment_for_order','payment',id::text,'order',order_id::text,'{}'::jsonb,jsonb_build_object('table','work_payments','pk',id::text,'column','order_id') from public.work_payments where order_id is not null
  union all
  select org_id,'payment_for_project','payment',id::text,'project',project_id::text,'{}'::jsonb,jsonb_build_object('table','work_payments','pk',id::text,'column','project_id') from public.work_payments where project_id is not null
  union all
  select org_id,'payment_for_renewal','payment',id::text,'renewal',renewal_id::text,'{}'::jsonb,jsonb_build_object('table','work_payments','pk',id::text,'column','renewal_id') from public.work_payments where renewal_id is not null
  union all
  select org_id,'payment_from_company','payment',id::text,'company',company_id::text,'{}'::jsonb,jsonb_build_object('table','work_payments','pk',id::text,'column','company_id') from public.work_payments where company_id is not null
  union all
  select org_id,'payment_from_lead','payment',id::text,'lead',lead_id::text,'{}'::jsonb,jsonb_build_object('table','work_payments','pk',id::text,'column','lead_id') from public.work_payments where lead_id is not null
  union all
  select org_id,'renewal_for_client','renewal',id::text,'client',relationship_id::text,'{}'::jsonb,jsonb_build_object('table','work_renewals','pk',id::text,'column','relationship_id') from public.work_renewals where relationship_id is not null
  union all
  select org_id,'renewal_for_project','renewal',id::text,'project',project_id::text,'{}'::jsonb,jsonb_build_object('table','work_renewals','pk',id::text,'column','project_id') from public.work_renewals where project_id is not null
  union all
  select org_id,'renewal_for_order','renewal',id::text,'order',order_id::text,'{}'::jsonb,jsonb_build_object('table','work_renewals','pk',id::text,'column','order_id') from public.work_renewals where order_id is not null
  union all
  select org_id,'renewal_for_company','renewal',id::text,'company',company_id::text,'{}'::jsonb,jsonb_build_object('table','work_renewals','pk',id::text,'column','company_id') from public.work_renewals where company_id is not null
  union all
  select w.org_id,'renewal_of_offering','renewal',w.id::text,'offering',o.id::text,'{}'::jsonb,jsonb_build_object('table','work_renewals','pk',w.id::text,'column','source_id','source_table','offerings')
  from public.work_renewals w join public.offerings o on w.source_table='offerings' and (w.source_id=o.id::text or w.source_id=o.slug)
  where w.org_id=(select id from house)
  union all
  select r.org_id,'release_has_track','release',r.id::text,'track',t.recording_id::text,jsonb_build_object('disc_no',t.disc_no,'track_no',t.track_no),
    jsonb_build_object('table','eu_release_tracks','release_id',r.id::text,'recording_id',t.recording_id::text)
  from public.eu_release_tracks t join public.eu_releases r on r.id=t.release_id
)
select fk.org_id,fk.link_key,fk.source_type_key,fk.source_object_key,fk.target_type_key,fk.target_object_key,fk.properties,
       fk.source_ref || jsonb_build_object('materializer','ontology_graph_v2') as source_ref
from fk where fk.org_id is not null;

create or replace function private.ops_ontology_graph_v2_refresh(p_org uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_types constant text[] := array['company','contact','lead','client','engagement','project','order','booking','meeting',
    'deliverable','task','payment','renewal','offering','campaign','release','track','approval'];
  v_org uuid;
  v_new integer := 0; v_changed integer := 0; v_removed integer := 0;
  v_links_new integer := 0; v_links_changed integer := 0; v_links_removed integer := 0;
  v_unchanged integer := 0; v_unresolved integer := 0;
begin
  -- one refresh at a time; a second caller waits instead of racing the first
  perform pg_advisory_xact_lock(hashtext('ops_ontology_graph_v2_refresh'));

  for v_org in
    select distinct s.org_id from private.ops_ontology_graph_v2_objects s where p_org is null or s.org_id = p_org
    union
    select o.id from public.orgs o where o.id = p_org
  loop
    perform private.ops_ontology_graph_v2_ensure_types(v_org);
  end loop;

  create temp table if not exists ops_ontology_graph_v2_src (
    org_id uuid, type_key text, object_key text, display_name text, properties jsonb, source_ref jsonb, observed_at timestamptz
  ) on commit drop;
  truncate ops_ontology_graph_v2_src;
  insert into ops_ontology_graph_v2_src
  select s.org_id,s.type_key,s.object_key,left(coalesce(s.display_name,''),500),s.properties,s.source_ref,s.observed_at
  from private.ops_ontology_graph_v2_objects s where p_org is null or s.org_id = p_org;

  -- removed: only rows this materializer owns, whose source row no longer exists
  with gone as (
    delete from public.ops_ontology_objects o
    where o.type_key = any(v_types)
      and o.source_ref->>'materializer' = 'ontology_graph_v2'
      and (p_org is null or o.org_id = p_org)
      and not exists (select 1 from ops_ontology_graph_v2_src s
                      where s.org_id=o.org_id and s.type_key=o.type_key and s.object_key=o.object_key)
    returning o.*
  )
  insert into public.ops_ontology_lineage(org_id,event_type,subject_type,subject_key,object_id,source_ref,before_state,actor_kind)
  select g.org_id,'object.source_deleted',g.type_key,g.object_key,null,g.source_ref || jsonb_build_object('object_id',g.id),to_jsonb(g),'system'
  from gone g;
  get diagnostics v_removed = row_count;

  -- new and changed; owner annotations and tags survive every sync
  with cur as (
    select o.id,o.org_id,o.type_key,o.object_key,to_jsonb(o) as before_state,o.display_name,o.properties,o.source_ref,o.observed_at
    from public.ops_ontology_objects o
    where o.type_key = any(v_types) and (p_org is null or o.org_id = p_org)
  ),
  delta as (
    select s.*, c.id as cur_id, c.before_state,
           jsonb_strip_nulls(jsonb_build_object('_annotations',c.properties->'_annotations','_tags',c.properties->'_tags')) as preserved
    from ops_ontology_graph_v2_src s
    left join cur c on c.org_id=s.org_id and c.type_key=s.type_key and c.object_key=s.object_key
    where c.id is null
       or c.display_name is distinct from s.display_name
       or (c.properties - '_annotations' - '_tags') is distinct from s.properties
       or c.source_ref is distinct from s.source_ref
       or c.observed_at is distinct from s.observed_at
  ),
  up as (
    insert into public.ops_ontology_objects(org_id,type_key,object_key,display_name,properties,source_ref,observed_at)
    select d.org_id,d.type_key,d.object_key,d.display_name,d.properties || coalesce(d.preserved,'{}'::jsonb),d.source_ref,d.observed_at
    from delta d
    on conflict (org_id,type_key,object_key) do update set
      display_name=excluded.display_name,
      properties=excluded.properties,
      source_ref=excluded.source_ref,
      observed_at=excluded.observed_at,
      version=public.ops_ontology_objects.version+1,
      updated_at=now()
    returning *
  ),
  logged as (
    insert into public.ops_ontology_lineage(org_id,event_type,subject_type,subject_key,object_id,source_ref,before_state,after_state,actor_kind)
    select u.org_id,case when d.cur_id is null then 'object.materialized' else 'object.synced' end,
           u.type_key,u.object_key,u.id,u.source_ref,d.before_state,to_jsonb(u),'system'
    from up u join delta d on d.org_id=u.org_id and d.type_key=u.type_key and d.object_key=u.object_key
    returning event_type
  )
  select count(*) filter (where event_type='object.materialized'), count(*) filter (where event_type='object.synced')
    into v_new, v_changed
  from logged;
  select count(*) - v_new - v_changed into v_unchanged from ops_ontology_graph_v2_src;

  -- links: resolve both ends to materialized objects of the declared types
  create temp table if not exists ops_ontology_graph_v2_lsrc (
    org_id uuid, link_key text, source_object_id uuid, target_object_id uuid, properties jsonb, source_ref jsonb
  ) on commit drop;
  truncate ops_ontology_graph_v2_lsrc;
  insert into ops_ontology_graph_v2_lsrc
  select l.org_id,l.link_key,s.id,t.id,l.properties,l.source_ref
  from private.ops_ontology_graph_v2_links l
  join public.ops_ontology_objects s on s.org_id=l.org_id and s.type_key=l.source_type_key and s.object_key=l.source_object_key
  join public.ops_ontology_objects t on t.org_id=l.org_id and t.type_key=l.target_type_key and t.object_key=l.target_object_key
  where (p_org is null or l.org_id = p_org) and s.id <> t.id;

  select count(*) - (select count(*) from ops_ontology_graph_v2_lsrc) into v_unresolved
  from private.ops_ontology_graph_v2_links l where p_org is null or l.org_id = p_org;

  with gone as (
    delete from public.ops_ontology_links k
    where k.source_ref->>'materializer' = 'ontology_graph_v2'
      and (p_org is null or k.org_id = p_org)
      and not exists (select 1 from ops_ontology_graph_v2_lsrc s
                      where s.org_id=k.org_id and s.link_key=k.link_key
                        and s.source_object_id=k.source_object_id and s.target_object_id=k.target_object_id)
    returning k.*
  )
  insert into public.ops_ontology_lineage(org_id,event_type,subject_type,subject_key,link_id,source_ref,before_state,actor_kind)
  select g.org_id,'link.source_deleted',g.link_key,g.source_object_id::text||'->'||g.target_object_id::text,null,
         g.source_ref || jsonb_build_object('link_id',g.id),to_jsonb(g),'system'
  from gone g;
  get diagnostics v_links_removed = row_count;

  with up as (
    insert into public.ops_ontology_links(org_id,link_key,source_object_id,target_object_id,properties,source_ref,confidence)
    select s.org_id,s.link_key,s.source_object_id,s.target_object_id,s.properties,s.source_ref,1
    from ops_ontology_graph_v2_lsrc s
    on conflict (org_id,link_key,source_object_id,target_object_id) do update set
      properties=excluded.properties, source_ref=excluded.source_ref, updated_at=now()
    where public.ops_ontology_links.source_ref->>'materializer' = 'ontology_graph_v2'
      and (public.ops_ontology_links.properties is distinct from excluded.properties
           or public.ops_ontology_links.source_ref is distinct from excluded.source_ref)
    returning *, (xmax = 0) as inserted
  ),
  logged as (
    insert into public.ops_ontology_lineage(org_id,event_type,subject_type,subject_key,link_id,source_ref,after_state,actor_kind)
    select u.org_id,case when u.inserted then 'link.materialized' else 'link.synced' end,u.link_key,
           u.source_object_id::text||'->'||u.target_object_id::text,u.id,u.source_ref,to_jsonb(u)-'inserted','system'
    from up u
    returning event_type
  )
  select count(*) filter (where event_type='link.materialized'), count(*) filter (where event_type='link.synced')
    into v_links_new, v_links_changed
  from logged;

  return jsonb_build_object(
    'schema','ops-ontology-graph-v2/refresh','org_id',p_org,'at',now(),
    'objects',jsonb_build_object('new',v_new,'changed',v_changed,'unchanged',v_unchanged,'removed',v_removed),
    'links',jsonb_build_object('new',v_links_new,'changed',v_links_changed,'removed',v_links_removed,'unresolved',v_unresolved)
  );
end
$$;

create or replace function public.ops_ontology_graph_v2_refresh_service(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org is null or not exists (select 1 from public.orgs o where o.id = p_org) then
    raise exception 'ops_ontology_graph_v2_refresh_service needs an existing org id' using errcode = '22023';
  end if;
  return private.ops_ontology_graph_v2_refresh(p_org);
end
$$;

revoke all on private.ops_ontology_graph_v2_objects, private.ops_ontology_graph_v2_links from public, anon, authenticated;
grant select on private.ops_ontology_graph_v2_objects, private.ops_ontology_graph_v2_links to service_role;
revoke all on function private.ops_ontology_graph_v2_ensure_types(uuid) from public, anon, authenticated;
revoke all on function private.ops_ontology_graph_v2_refresh(uuid) from public, anon, authenticated;
revoke all on function public.ops_ontology_graph_v2_refresh_service(uuid) from public, anon, authenticated;
grant execute on function public.ops_ontology_graph_v2_refresh_service(uuid) to service_role;

comment on function public.ops_ontology_graph_v2_refresh_service(uuid) is
  'Materialize the 18 graph v2 object types and 29 FK-backed link types for one org from existing source tables. Service role only. Idempotent; writes lineage for every change.';

-- register the types for every org, then backfill once
do $backfill$
declare r record;
begin
  for r in select id from public.orgs loop
    perform private.ops_ontology_graph_v2_ensure_types(r.id);
  end loop;
  perform private.ops_ontology_graph_v2_refresh(null);
end $backfill$;

commit;
