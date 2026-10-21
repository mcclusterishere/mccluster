-- Public live chat stays in network_posts. No recording or private AI memory.
alter table public.network_live_sessions add column ai_actor_keys text[] not null default '{}',
 add column ai_epoch uuid not null default gen_random_uuid();
alter table public.network_live_sessions add constraint live_actor_count check(cardinality(ai_actor_keys)<=3);
create table public.ops_live_actor_turns (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.network_live_sessions(id),
 org_id uuid not null references public.orgs(id),
 actor_key text not null references public.ops_platform_actors(actor_key),
 job_id uuid not null unique references public.ops_agent_jobs(id),
 source_post_id uuid not null references public.network_posts(id),
 root_post_id uuid not null references public.network_posts(id),
 response_post_id uuid unique references public.network_posts(id),
 turn integer not null check(turn between 1 and 2),
 epoch uuid not null,
 model text,
 review jsonb,
 created_at timestamptz not null default now(),
 published_at timestamptz,
 unique(session_id,source_post_id)
);
create index live_actor_turns_session_time on public.ops_live_actor_turns(session_id,created_at desc);
create index live_actor_turns_actor on public.ops_live_actor_turns(actor_key);
create index live_actor_turns_org on public.ops_live_actor_turns(org_id);
create index live_actor_turns_root on public.ops_live_actor_turns(root_post_id);
alter table public.ops_live_actor_turns enable row level security;
revoke all on public.ops_live_actor_turns from public,anon,authenticated;
grant select,insert,update on public.ops_live_actor_turns to service_role;

-- Called only by the authenticated host route; toggles invalidate in-flight work.
create function public.ops_live_actor_config(p_session uuid,p_host uuid,p_keys text[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.network_live_sessions; n integer;
begin
 select * into s from public.network_live_sessions where id=p_session for update;
 if s.id is null or s.host_user_id<>p_host or s.status<>'live' then raise exception 'live host required' using errcode='42501'; end if;
 if p_keys is null or cardinality(p_keys)>3 then raise exception 'invalid cast'; end if;
 select count(distinct a.actor_key) into n from public.ops_platform_actors a join public.orgs o on o.id=a.org_id
 where a.actor_key=any(p_keys) and a.enabled and o.slug='mccluster' and o.enabled;
 if n<>cardinality(p_keys) then raise exception 'actor unavailable'; end if;
 update public.network_live_sessions set ai_actor_keys=p_keys,ai_epoch=gen_random_uuid() where id=s.id;
 return jsonb_build_object('actor_keys',p_keys,'max_turns',2,'minimum_interval_seconds',90);
end $$;

-- Host heartbeat samples one shared room context; one pending turn per room.
create function public.ops_live_actor_tick(p_session uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.network_live_sessions; p public.network_posts; previous public.ops_live_actor_turns;
 a public.ops_platform_actors; jid uuid; root_id uuid; next_turn integer:=1;
begin
 perform pg_advisory_xact_lock(hashtextextended('live_actor_queue',0));
 if (select count(*) from public.ops_agent_jobs where job_type='actor_live_comment' and status in ('queued','running'))>=2 then return '{"queued":false}'; end if;
 select * into s from public.network_live_sessions where id=p_session for update;
 if s.id is null or s.status<>'live' or s.last_seen_at<now()-interval '2 minutes' or cardinality(s.ai_actor_keys)=0 then return '{"queued":false}'; end if;
 if exists(select 1 from public.ops_live_actor_turns t join public.ops_agent_jobs j on j.id=t.job_id
 where t.session_id=s.id and (j.status in ('queued','running') or t.created_at>now()-interval '90 seconds'))
 or (select count(*) from public.ops_live_actor_turns where session_id=s.id)>=30 then return '{"queued":false}'; end if;
 select * into p from public.network_posts where reply_to_id=s.post_id and visibility='public' and group_id is null
 and deleted_at is null and removed_at is null and created_at>now()-interval '3 minutes'
 order by created_at desc,id desc limit 1;
 if p.id is null or exists(select 1 from public.ops_live_actor_turns where session_id=s.id and source_post_id=p.id) then return '{"queued":false}'; end if;
 select * into previous from public.ops_live_actor_turns where response_post_id=p.id;
 if exists(select 1 from public.ops_platform_actors where m_uid=p.author_m_uid) then
   if previous.id is null or previous.session_id<>s.id or previous.turn>=2 then return '{"queued":false}'; end if;
   next_turn:=previous.turn+1; root_id:=previous.root_post_id;
 else root_id:=p.id; end if;
 select a0.* into a from public.ops_platform_actors a0 join public.orgs o on o.id=a0.org_id
 where a0.actor_key=any(s.ai_actor_keys) and a0.enabled and o.slug='mccluster' and o.enabled
 and a0.m_uid<>p.author_m_uid
 and (select count(*) from public.ops_live_actor_turns t where t.actor_key=a0.actor_key and t.created_at>now()-interval '1 hour')<10
 order by (select count(*) from public.ops_live_actor_turns t where t.session_id=s.id and t.actor_key=a0.actor_key),a0.actor_key limit 1;
 if a.actor_key is null then return '{"queued":false}'; end if;
 insert into public.ops_agent_jobs(org_id,job_type,target_type,target_id,priority,max_attempts,input)
 values(a.org_id,'actor_live_comment','platform_actor',a.actor_key,10,1,jsonb_build_object('session_id',s.id)) returning id into jid;
 insert into public.ops_live_actor_turns(session_id,org_id,actor_key,job_id,source_post_id,root_post_id,turn,epoch)
 values(s.id,a.org_id,a.actor_key,jid,p.id,root_id,next_turn,s.ai_epoch);
 return jsonb_build_object('queued',true,'job_id',jid);
end $$;

create function public.ops_live_actor_context(p_job uuid,p_org uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.ops_live_actor_turns; s public.network_live_sessions; a public.ops_platform_actors; context jsonb;
begin
 select * into t from public.ops_live_actor_turns where job_id=p_job and org_id=p_org;
 if t.id is null then raise exception 'unknown live turn' using errcode='42501'; end if;
 if t.response_post_id is not null then return jsonb_build_object('published',true,'publication_id',t.id,'comment_id',t.response_post_id,'actor_key',t.actor_key); end if;
 select * into s from public.network_live_sessions where id=t.session_id;
 select * into a from public.ops_platform_actors where actor_key=t.actor_key and org_id=p_org;
 if not a.enabled or not(t.actor_key=any(s.ai_actor_keys)) or t.epoch<>s.ai_epoch
 or s.status<>'live' or s.last_seen_at<now()-interval '2 minutes' or t.created_at<now()-interval '3 minutes'
 or not exists(select 1 from public.network_posts where id=s.post_id and deleted_at is null and removed_at is null and visibility='public' and group_id is null)
 or not exists(select 1 from public.network_posts where id=t.source_post_id and deleted_at is null and removed_at is null and visibility='public' and group_id is null)
 then return jsonb_build_object('published',false,'reason','inactive_or_stale','actor_key',t.actor_key); end if;
 select coalesce(jsonb_agg(x order by x.created_at),'[]') into context from (
 select p.id,left(p.body,600) as body,p.created_at,exists(select 1 from public.ops_platform_actors a1 where a1.m_uid=p.author_m_uid) as is_ai
 from public.network_posts p where p.reply_to_id=s.post_id and p.visibility='public' and p.group_id is null
 and p.deleted_at is null and p.removed_at is null order by p.created_at desc limit 12) x;
 return jsonb_build_object('actor_key',a.actor_key,'persona',a.persona,'session_id',s.id,'title',s.title,
 'source_post_id',t.source_post_id,'source_text',(select left(body,600) from public.network_posts where id=t.source_post_id),'turn',t.turn,'messages',context);
end $$;

create function public.ops_live_actor_publish(p_job uuid,p_org uuid,p_body text,p_model text,p_review jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.ops_live_actor_turns; s public.network_live_sessions; a public.ops_platform_actors; context jsonb; post_id uuid;
begin
 select * into t from public.ops_live_actor_turns where job_id=p_job and org_id=p_org;
 if t.id is null then raise exception 'unknown live turn' using errcode='42501'; end if;
 select * into s from public.network_live_sessions where id=t.session_id for update;
 select * into a from public.ops_platform_actors where actor_key=t.actor_key for share;
 context:=public.ops_live_actor_context(p_job,p_org);
 if context ? 'published' then return context; end if;
 if not exists(select 1 from public.orgs where id=p_org and slug='mccluster' and enabled)
 or not exists(select 1 from public.ops_agent_jobs where id=p_job and org_id=p_org and job_type='actor_live_comment' and target_id=t.actor_key and status='running') then raise exception 'active house job required' using errcode='42501'; end if;
 if p_body is null or char_length(trim(p_body)) not between 10 and 600 or p_model is null or char_length(p_model) not between 1 and 120 or p_review->'approved' is distinct from 'true'::jsonb then raise exception 'invalid reviewed response'; end if;
 insert into public.network_posts(author_m_uid,body,post_type,visibility,reply_to_id,source_org_id,metadata)
 values(a.m_uid,trim(p_body),'update','public',s.post_id,p_org,jsonb_build_object('actor_kind','fictional_ai','live_actor_turn_id',t.id,'source_post_id',t.source_post_id)) returning id into post_id;
 update public.ops_live_actor_turns set response_post_id=post_id,published_at=now(),model=p_model,review=jsonb_build_object('approved',true,'reason',left(p_review->>'reason',180)) where id=t.id;
 return jsonb_build_object('published',true,'publication_id',t.id,'comment_id',post_id,'actor_key',t.actor_key);
end $$;
revoke all on function public.ops_live_actor_config(uuid,uuid,text[]),public.ops_live_actor_tick(uuid),public.ops_live_actor_context(uuid,uuid),public.ops_live_actor_publish(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ops_live_actor_config(uuid,uuid,text[]),public.ops_live_actor_tick(uuid),public.ops_live_actor_context(uuid,uuid),public.ops_live_actor_publish(uuid,uuid,text,text,jsonb) to service_role;

create or replace view private.ops_connected_nodes with (security_invoker=true) as
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
from public.ops_agent_jobs j where j.job_type='actor_news_comment' and j.output ? 'review'
union all
select t.org_id,'live_actor_turn:'||t.id,'live_actor_turn','event','Live room character turn',j.status,t.created_at,
 jsonb_build_object('table','ops_live_actor_turns','id',t.id),
 jsonb_build_object('session_id',t.session_id,'actor_key',t.actor_key,'turn',t.turn,'model',t.model,'review',t.review,'response_post_id',t.response_post_id)
from public.ops_live_actor_turns t join public.ops_agent_jobs j on j.id=t.job_id
union all
select t.org_id,'live_chat_source:'||t.id,'live_chat_source','evidence','Public room context',
 case when p.deleted_at is null and p.removed_at is null then 'unverified' else 'removed' end,p.created_at,
 jsonb_build_object('table','network_posts','id',p.id),
 jsonb_build_object('body',case when p.deleted_at is null and p.removed_at is null then left(p.body,600) else null end,'source',p.metadata->'live_cue','basis','user text; not verified fact')
from public.ops_live_actor_turns t join public.network_posts p on p.id=t.source_post_id
union all
select t.org_id,'live_actor_outcome:'||t.id,'live_actor_outcome','outcome','Human chat after character reply',
 case when now()<t.published_at+interval '5 minutes' then 'measuring' else 'window_complete' end,t.published_at,
 jsonb_build_object('table','ops_live_actor_turns','id',t.id),
 jsonb_build_object('human_messages', (select count(*) from public.network_posts p where p.reply_to_id=s.post_id
 and p.created_at>t.published_at and p.created_at<=t.published_at+interval '5 minutes' and p.visibility='public' and p.deleted_at is null and p.removed_at is null
 and not exists(select 1 from public.ops_platform_actors a where a.m_uid=p.author_m_uid)),
 'basis','5-minute temporal association, not causal attribution','ai_posts_excluded',true,'response_post_id',t.response_post_id)
from public.ops_live_actor_turns t join public.network_live_sessions s on s.id=t.session_id where t.published_at is not null;

create or replace view private.ops_connected_edges with (security_invoker=true) as
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
from public.intel_evidence e where e.outcome_id is not null
union all
select t.org_id,'actor:'||t.actor_key,'live_actor_turn:'||t.id,'performed_live_turn',jsonb_build_object('table','ops_live_actor_turns','id',t.id) from public.ops_live_actor_turns t
union all
select t.org_id,'agent_job:'||t.job_id,'live_actor_turn:'||t.id,'executed',jsonb_build_object('table','ops_live_actor_turns','id',t.id) from public.ops_live_actor_turns t
union all
select t.org_id,'live_actor_turn:'||t.id,'live_chat_source:'||t.id,'reacted_to',jsonb_build_object('table','ops_live_actor_turns','id',t.id) from public.ops_live_actor_turns t
union all
select t.org_id,'live_actor_turn:'||t.id,'live_actor_outcome:'||t.id,'measured_after',jsonb_build_object('table','ops_live_actor_turns','id',t.id) from public.ops_live_actor_turns t where t.published_at is not null;
