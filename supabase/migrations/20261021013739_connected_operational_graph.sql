-- A read-through projection of existing authorities, not a second graph store.
-- No inference creates an edge. Source foreign keys / typed ontology links do.
update public.network_profiles p set display_name='Royce'
from public.ops_platform_actors a where a.m_uid=p.m_uid and a.actor_key='royce.r01';

create view private.ops_connected_nodes with (security_invoker=true) as
select o.org_id,o.type_key||':'||o.object_key as id,o.type_key as kind,
  case when o.type_key='agent_job' then 'event' else 'entity' end as category,
  o.display_name as label,o.properties->>'status' as status,o.observed_at as occurred_at,
  o.source_ref as source,
  jsonb_strip_nulls(jsonb_build_object('job_type',o.properties->'job_type','priority',o.properties->'priority')) as detail
from public.ops_ontology_objects o
union all
select a.org_id,'actor:'||a.actor_key,'actor','entity',coalesce(p.display_name,a.handle),
 case when a.enabled then 'active' else 'paused' end,a.created_at,
 jsonb_build_object('table','ops_platform_actors','key',a.actor_key),
 jsonb_build_object('handle',a.handle,'actor_kind','fictional_ai','daily_limit',a.daily_limit)
from public.ops_platform_actors a left join public.network_profiles p on p.m_uid=a.m_uid
union all
select e.org_id,'evidence:'||e.id,'evidence','evidence',e.title,e.review_status,coalesce(e.observed_at,e.retrieved_at),
 jsonb_build_object('table','intel_evidence','id',e.id,'url',e.source_url,'sha256',e.content_sha256),
 jsonb_build_object('publisher',e.publisher,'kind',e.kind,'retrieved_at',e.retrieved_at,'retention_until',e.retention_until)
from public.intel_evidence e
union all
select c.org_id,'claim:'||c.id,'claim','evidence',c.statement,c.status,c.created_at,
 jsonb_build_object('table','intel_claims','id',c.id),jsonb_build_object('confidence',c.confidence,'subject_kind',c.subject_kind)
from public.intel_claims c
union all
select b.org_id,'briefing:'||b.id,'briefing','evidence',b.title,b.status,b.as_of,
 jsonb_build_object('table','intel_briefings','id',b.id),jsonb_build_object('drafting',b.drafting,'evidence_oldest_at',b.evidence_oldest_at,'evidence_newest_at',b.evidence_newest_at)
from public.intel_briefings b
union all
select d.org_id,'decision:'||d.id,'decision','decision',d.title,d.status,d.created_at,
 jsonb_build_object('table','ai_context.decisions','id',d.id),jsonb_build_object('risk_class',d.risk_class,'approved_at',d.approved_at)
from ai_context.decisions d
union all
select m.org_id,'mission:'||m.mission_id,'mission','event',a.title,a.status,m.linked_at,
 jsonb_build_object('table','action_missions','id',m.mission_id),jsonb_build_object('target_measures',m.target_measures)
from public.intel_mission_decisions m join public.action_missions a on a.id=m.mission_id
union all
select o.org_id,'outcome:'||o.id,'outcome','outcome',o.summary,o.status,o.occurred_at,
 jsonb_build_object('table','intel_outcomes','id',o.id),jsonb_build_object('measures',o.measures,'reviewed_at',o.reviewed_at)
from public.intel_outcomes o
union all
select a.org_id,'publication:'||p.id,'publication','outcome',p.body,
 case when c.id is null then 'comment_unavailable' when c.deleted_at is not null or c.state<>'visible' then 'hidden' else 'published' end,p.created_at,
 jsonb_build_object('table','ops_actor_publications','id',p.id,'comment_id',p.comment_id),
 jsonb_build_object('model',p.model,'measured_outcome','publication_only','engagement','not_measured')
from public.ops_actor_publications p join public.ops_platform_actors a using(actor_key)
left join public.media_news_comments c on c.id=p.comment_id
union all
select a.org_id,'publication_source:'||p.id,'publication_source','evidence',coalesce(p.source->>'title','Unavailable source title'),'headline_only',p.created_at,
 jsonb_build_object('table','ops_actor_publications','id',p.id,'article_id',p.article_id,'url',p.source->>'url'),
 jsonb_build_object('basis',p.source->>'basis','seen_at',p.source->>'seen_at','truth_status','unverified_headline')
from public.ops_actor_publications p join public.ops_platform_actors a using(actor_key)
union all
select j.org_id,'actor_review:'||j.id,'actor_review','decision','Automated publication review',
 case when j.output->'review'->>'approved'='true' then 'model_approved' else 'not_approved' end,j.updated_at,
 jsonb_build_object('table','ops_agent_jobs','id',j.id),
 jsonb_build_object('reason',j.output->'review'->>'reason','model',j.output->>'model','authority','bounded actor publication; not a human decision')
from public.ops_agent_jobs j where j.job_type='actor_news_comment' and j.output ? 'review';

create view private.ops_connected_edges with (security_invoker=true) as
select l.org_id,s.type_key||':'||s.object_key as source,t.type_key||':'||t.object_key as target,
 l.link_key as relation,l.source_ref as provenance
from public.ops_ontology_links l
join public.ops_ontology_objects s on s.id=l.source_object_id and s.org_id=l.org_id
join public.ops_ontology_objects t on t.id=l.target_object_id and t.org_id=l.org_id
where l.valid_to is null or l.valid_to>now()
union all
select j.org_id,'actor:'||j.target_id,'agent_job:'||j.id,'performed_job',jsonb_build_object('table','ops_agent_jobs','id',j.id)
from public.ops_agent_jobs j join public.ops_platform_actors a on a.actor_key=j.target_id and a.org_id=j.org_id where j.job_type='actor_news_comment'
union all
select j.org_id,'agent_job:'||j.id,'actor_review:'||j.id,'produced_review',jsonb_build_object('table','ops_agent_jobs','id',j.id)
from public.ops_agent_jobs j where j.job_type='actor_news_comment' and j.output ? 'review'
union all
select a.org_id,'actor:'||p.actor_key,'publication:'||p.id,'authored',jsonb_build_object('table','ops_actor_publications','id',p.id)
from public.ops_actor_publications p join public.ops_platform_actors a using(actor_key)
union all
select a.org_id,'actor_review:'||p.job_id,'publication:'||p.id,'allowed_publication',jsonb_build_object('table','ops_actor_publications','id',p.id)
from public.ops_actor_publications p join public.ops_platform_actors a using(actor_key)
union all
select a.org_id,'publication:'||p.id,'publication_source:'||p.id,'reacted_to',jsonb_build_object('table','ops_actor_publications','id',p.id)
from public.ops_actor_publications p join public.ops_platform_actors a using(actor_key)
union all
select e.org_id,'claim:'||e.claim_id,'evidence:'||e.evidence_id,e.stance,jsonb_build_object('table','intel_claim_evidence','claim_id',e.claim_id,'evidence_id',e.evidence_id)
from public.intel_claim_evidence e
union all
select c.org_id,'briefing:'||c.briefing_id,'claim:'||c.claim_id,'cites',jsonb_build_object('table','intel_briefing_citations','briefing_id',c.briefing_id,'ordinal',c.ordinal)
from public.intel_briefing_citations c where c.claim_id is not null
union all
select c.org_id,'briefing:'||c.briefing_id,'evidence:'||c.evidence_id,'cites',jsonb_build_object('table','intel_briefing_citations','briefing_id',c.briefing_id,'ordinal',c.ordinal)
from public.intel_briefing_citations c where c.evidence_id is not null
union all
select b.org_id,'decision:'||b.decision_id,
 case when b.briefing_id is not null then 'briefing:'||b.briefing_id when b.claim_id is not null then 'claim:'||b.claim_id else 'evidence:'||b.evidence_id end,
 'based_on',jsonb_build_object('table','intel_decision_basis','id',b.id)
from public.intel_decision_basis b
union all
select m.org_id,'decision:'||m.decision_id,'mission:'||m.mission_id,'authorized_mission',jsonb_build_object('table','intel_mission_decisions','mission_id',m.mission_id)
from public.intel_mission_decisions m
union all
select o.org_id,'mission:'||o.mission_id,'outcome:'||o.id,'reported_outcome',jsonb_build_object('table','intel_outcomes','id',o.id)
from public.intel_outcomes o
union all
select o.org_id,'decision:'||o.decision_id,'outcome:'||o.id,'evaluated_by',jsonb_build_object('table','intel_outcomes','id',o.id)
from public.intel_outcomes o
union all
select e.org_id,'outcome:'||e.outcome_id,'evidence:'||e.id,'became_evidence',jsonb_build_object('table','intel_evidence','id',e.id)
from public.intel_evidence e where e.outcome_id is not null;

revoke all on private.ops_connected_nodes,private.ops_connected_edges from public,anon,authenticated;
grant usage on schema private to service_role;
grant select on private.ops_connected_nodes,private.ops_connected_edges to service_role;

create function public.ops_connected_graph_service(p_org uuid,p_root text default null,p_kind text default 'actor',p_depth integer default 2,p_limit integer default 80)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ids text[]:='{}'; more text[]; nodes jsonb; edges jsonb; counts jsonb; i integer; clipped boolean:=false;
begin
 if current_user not in ('postgres','service_role') then raise insufficient_privilege; end if;
 if p_org is null or p_depth is null or p_depth not between 0 and 3 or p_limit is null or p_limit not between 1 and 100
 or (p_root is not null and (length(p_root)>550 or p_root !~ '^[a-z_]+:.+$')) then raise exception 'Invalid graph bounds'; end if;
 if p_root is null then
   select coalesce(array_agg(id),'{}') into ids from (
    select n.id from private.ops_connected_nodes n where n.org_id=p_org and (p_kind is null or n.kind=p_kind)
    order by n.occurred_at desc nulls last,n.id limit p_limit+1
   ) x;
   clipped:=cardinality(ids)>p_limit; ids:=ids[1:p_limit];
 else
   if exists(select 1 from private.ops_connected_nodes n where n.org_id=p_org and n.id=p_root) then ids:=array[p_root]; end if;
   for i in 1..p_depth loop
    select coalesce(array_agg(id),'{}') into more from (
     select distinct n.id from private.ops_connected_edges e
     join private.ops_connected_nodes n on n.org_id=p_org and n.id=case when e.source=any(ids) then e.target else e.source end
     where e.org_id=p_org and (e.source=any(ids) or e.target=any(ids)) and not(n.id=any(ids))
     order by n.id limit greatest(0,p_limit-cardinality(ids))+1
    ) x;
    if cardinality(more)>p_limit-cardinality(ids) then clipped:=true; end if;
    ids:=ids||more[1:greatest(0,p_limit-cardinality(ids))];
    exit when cardinality(more)=0 or cardinality(ids)>=p_limit;
   end loop;
 end if;
 select coalesce(jsonb_agg(to_jsonb(n)-'org_id' order by n.category,n.occurred_at,n.id),'[]') into nodes
 from private.ops_connected_nodes n where n.org_id=p_org and n.id=any(ids);
 select coalesce(jsonb_agg(to_jsonb(e)-'org_id' order by e.source,e.relation,e.target),'[]') into edges
 from (select * from private.ops_connected_edges e where e.org_id=p_org and e.source=any(ids) and e.target=any(ids) order by e.source,e.relation,e.target limit 501) e;
 if jsonb_array_length(edges)>500 then clipped:=true; select jsonb_agg(value) into edges from (select value from jsonb_array_elements(edges) limit 500) e; end if;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.kind),'[]') into counts from (
   select n.kind,n.category,count(*) as count from private.ops_connected_nodes n where n.org_id=p_org group by n.kind,n.category
 ) c;
 return jsonb_build_object('schema','connected-operations/v1','root',p_root,'depth',p_depth,'limit',p_limit,'truncated',clipped,
  'nodes',nodes,'edges',edges,'counts',counts,'generated_at',now(),'basis','Existing source records and explicit relationships; connections do not establish causation.');
end $$;
revoke all on function public.ops_connected_graph_service(uuid,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.ops_connected_graph_service(uuid,text,text,integer,integer) to service_role;
