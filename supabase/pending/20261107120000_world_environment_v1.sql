-- REVIEW ONLY. Not applied by this feature. One canonical team, missions,
-- assignments and proof lifecycle. No live grant, proof verification, point
-- award, precise member location or new cohort-admission bypass is created.
begin;
insert into public.network_groups(slug,name,purpose,visibility)
select 'environmental-justice-team','Environmental Justice Team',
 'Verify public environmental information and accessible support. Follow emergency authorities; remote research first.','open'
where not exists(select 1 from public.network_groups where lower(slug)='environmental-justice-team');

create table public.action_environment_missions (
 mission_id uuid primary key references public.action_missions(id) on delete cascade,
 event_id text not null check(char_length(event_id) between 1 and 300),
 action_id text not null check(action_id in ('resource-check','evidence-brief')),
 source_snapshot jsonb not null,
 proposed_by uuid not null references auth.users(id),
 approved_by uuid references auth.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default now(), unique(event_id,action_id)
);
create table public.action_environment_reviews (
 id uuid primary key default gen_random_uuid(),
 mission_id uuid not null references public.action_environment_missions(mission_id),
 actor uuid not null references auth.users(id), status text not null check(status in ('open','paused','closed')),
 created_at timestamptz not null default now()
);
alter table public.action_environment_missions enable row level security;
alter table public.action_environment_reviews enable row level security;
revoke all on public.action_environment_missions, public.action_environment_reviews from public,anon,authenticated;
grant all on public.action_environment_missions, public.action_environment_reviews to service_role;

create or replace function public.world_environment_team(p_join boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_me uuid := public.current_m_uid(); v_group public.network_groups%rowtype; v_state text; v_assignments jsonb;
begin
 if auth.uid() is null or v_me is null then raise exception 'identity_required'; end if;
 select * into v_group from public.network_groups where lower(slug)='environmental-justice-team' for update;
 if not found or v_group.visibility <> 'open' then raise exception 'team_unavailable'; end if;
 select state into v_state from public.network_group_members where group_id=v_group.id and m_uid=v_me;
 if v_state='banned' then raise exception 'membership_blocked'; end if;
 if p_join is true then
   insert into public.network_group_members(group_id,m_uid,role,state) values(v_group.id,v_me,'member','joined')
   on conflict(group_id,m_uid) do nothing;
 elsif p_join is false then
   -- A host cannot silently remove their management seat using this member route.
   delete from public.network_group_members where group_id=v_group.id and m_uid=v_me and role='member';
 end if;
 select state into v_state from public.network_group_members where group_id=v_group.id and m_uid=v_me;
 -- Self-only resume context does not depend on the current provider feed. Keep
 -- immutable provenance and canonical availability, never other participants.
 -- One extra row lets the controller disclose the 200-assignment display limit.
 select coalesce(jsonb_agg(jsonb_build_object(
   'mission_id',a.mission_id,'assignment_id',a.id,'status',a.status,
   'title',m.title,'description',m.description,'mission_status',m.status,
   'ends_at',m.ends_at,'event_id',e.event_id,
   'source',jsonb_build_object('label',e.source_snapshot#>>'{source,label}','url',e.source_snapshot#>>'{source,url}'),
   'observed_at',e.source_snapshot->>'observed_at','news_context',e.source_snapshot->'news_context',
   'capture_available',e.approved_by is not null and m.status='open'
     and (m.starts_at is null or m.starts_at<=now())
     and (m.ends_at is null or m.ends_at>now())
     and a.status in ('joined','in_progress','rejected')
 ) order by a.joined_at desc,a.id), '[]'::jsonb)
 into v_assignments from (
   select aa.* from public.action_mission_assignments aa
   join public.action_environment_missions ee on ee.mission_id=aa.mission_id
   where aa.user_id=auth.uid() and aa.status <> 'withdrawn'
   order by aa.joined_at desc,aa.id limit 201
 ) a join public.action_environment_missions e on e.mission_id=a.mission_id
 join public.action_missions m on m.id=a.mission_id;
 return jsonb_build_object('slug',v_group.slug,'name',v_group.name,'joined',coalesce(v_state='joined',false),'assignments',v_assignments);
end $$;
revoke all on function public.world_environment_team(boolean) from public,anon;
grant execute on function public.world_environment_team(boolean) to authenticated;

-- Service role only: the Worker has verified both identity and the current
-- public-source event. Browser-supplied titles, URLs, source snapshots or
-- publication states are never accepted by the Worker.
create or replace function public.world_environment_propose(p_actor uuid,p_event jsonb,p_action jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_mission uuid; v_muid uuid; v_title text; v_news record; v_article record;
begin
 if current_user not in ('service_role','postgres') then raise exception 'server_only'; end if;
 select m_uid into v_muid from public.m_auth_user_links where auth_user_id=p_actor and is_primary=true limit 1;
 if not exists(select 1 from public.network_group_members m join public.network_groups g on g.id=m.group_id where m.m_uid=v_muid and m.state='joined' and lower(g.slug)='environmental-justice-team') then raise exception 'join_team_first'; end if;
 if p_event->>'id' is null or p_action->>'id' not in ('resource-check','evidence-brief') or p_event->>'observed_at' is null or coalesce((p_event->>'stale')::boolean,true) then raise exception 'current_event_required'; end if;
 -- Revalidate/lock approved news and its current article in this transaction.
 -- A correction or revoked review cannot race the privileged source write.
 if p_event ? 'news_context' then
   if p_event#>>'{news_context,schema}' is distinct from 'environment-news-attribution/v1'
      or coalesce(p_event#>>'{news_context,review_id}','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
      or coalesce(p_event#>>'{news_context,article_id}','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   then raise exception 'current_news_review_required'; end if;
   select r.* into v_news from public.ops_recommendations r
   join public.orgs o on o.id=r.org_id and o.slug='mccluster'
   where r.id=(p_event#>>'{news_context,review_id}')::uuid for update of r;
   if not found then raise exception 'current_news_review_required'; end if;
   if v_news.status<>'approved' or v_news.recommendation_type<>'environment_news_context'
      or v_news.proposed_action->>'schema' is distinct from 'environment-news-context/v1'
      or v_news.proposed_action->>'event_id' is distinct from p_event->>'id'
      or v_news.proposed_action->>'article_id' is distinct from p_event#>>'{news_context,article_id}'
      or v_news.proposed_action->>'article_revision' is distinct from p_event#>>'{news_context,revision}'
      or v_news.decided_at is null or v_news.decided_at>now() or v_news.decided_at<now()-interval '1 day'
   then raise exception 'current_news_review_required'; end if;
   perform 1 from public.org_members om where om.org_id=v_news.org_id and om.role='owner'
     and om.profile_id::text=v_news.proposed_action->>'reviewer_id' for share of om;
   if not found then raise exception 'current_news_review_required'; end if;
   perform 1 from public.org_members om where om.org_id=v_news.org_id and om.role='owner' and om.profile_id=p_actor for share of om;
   if not found then raise exception 'owner_only'; end if;
   select a.* into v_article from public.media_news_articles a where a.id=(p_event#>>'{news_context,article_id}')::uuid for share of a;
   if not found then raise exception 'current_news_review_required'; end if;
   if v_article.ingestion_provider not in ('gdelt_gkg_v2','gdelt_doc_v2')
      or v_article.published_at is null or v_article.published_at>now() or v_article.published_at<now()-interval '1 day'
      or v_article.imported_at is null or v_article.imported_at>v_news.decided_at
      or v_article.title is distinct from v_news.proposed_action#>>'{article_snapshot,title}'
      or v_article.canonical_url is distinct from v_news.proposed_action#>>'{article_snapshot,canonical_url}'
      or v_article.ingestion_provider is distinct from v_news.proposed_action#>>'{article_snapshot,ingestion_provider}'
      or v_article.published_at is distinct from (v_news.proposed_action#>>'{article_snapshot,seen_at}')::timestamptz
      or v_article.imported_at is distinct from (v_news.proposed_action#>>'{article_snapshot,imported_at}')::timestamptz
      or v_article.title is distinct from p_event#>>'{news_context,title}'
      or v_article.canonical_url is distinct from p_event#>>'{news_context,url}'
      or v_article.published_at is distinct from (p_event#>>'{news_context,seen_at}')::timestamptz
   then raise exception 'current_news_review_required'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('environment-proposer:'||p_actor::text,0));
 perform pg_advisory_xact_lock(hashtextextended((p_event->>'id')||':'||(p_action->>'id'),0));
 select mission_id into v_mission from public.action_environment_missions where event_id=p_event->>'id' and action_id=p_action->>'id';
 if v_mission is not null then return jsonb_build_object('mission_id',v_mission,'created',false,'status',(select status from public.action_missions where id=v_mission)); end if;
 if (select count(*) from public.action_environment_missions where proposed_by=p_actor and created_at > now()-interval '1 day') >= 20 then raise exception 'proposal_limit'; end if;
 v_title := left((p_action->>'title')||': '||(p_event->>'title'),160);
 insert into public.action_missions(title,description,domain,status,proof_required,verification_mode,skills,ends_at)
 values(v_title,(p_action->>'description')||E'\n\nProof: '||(p_action->>'proof')||E'\n\nSafety: '||(p_action->>'safety')||E'\n\nSource: '||(p_event#>>'{source,url}')||E'\nObserved: '||(p_event->>'observed_at')||E'\nA hazard report is not proof of environmental injustice.'||
 case when p_event#>>'{news_context,schema}'='environment-news-attribution/v1' then
 E'\n\nReviewed news context (reported claim, not verified environmental fact): '||left(p_event#>>'{news_context,title}',1000)||
 E'\n'||left(p_event#>>'{news_context,url}',2000)||E'\nGDELT seen time: '||left(p_event#>>'{news_context,seen_at}',100)
 else '' end,
 'research','draft',true,'review',array['research','accessibility'],least(now()+interval '7 days',coalesce((p_event->>'expires_at')::timestamptz,now()+interval '7 days')))
 returning id into v_mission;
 insert into public.action_environment_missions(mission_id,event_id,action_id,source_snapshot,proposed_by)
 values(v_mission,p_event->>'id',p_action->>'id',p_event,p_actor);
 return jsonb_build_object('mission_id',v_mission,'created',true,'status','draft');
end $$;
revoke all on function public.world_environment_propose(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.world_environment_propose(uuid,jsonb,jsonb) to service_role;

create or replace function public.world_environment_review(p_actor uuid,p_mission uuid,p_status text)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if current_user not in ('service_role','postgres') then raise exception 'server_only'; end if;
 if not exists(select 1 from public.org_members m join public.orgs o on o.id=m.org_id where o.slug='mccluster' and m.profile_id=p_actor and m.role='owner') then raise exception 'owner_only'; end if;
 if p_status not in ('open','paused','closed') then raise exception 'invalid_status'; end if;
 perform 1 from public.action_environment_missions where mission_id=p_mission for update;
 if not found then raise exception 'mission_missing'; end if;
 if p_status='open' and exists(select 1 from public.action_environment_missions where mission_id=p_mission and ((source_snapshot->>'observed_at')::timestamptz > now()+interval '1 minute' or (source_snapshot->>'observed_at')::timestamptz < now()-case when source_snapshot#>>'{source,id}'='eonet' then interval '30 days' else interval '1 day' end or (source_snapshot->>'expires_at')::timestamptz <= now())) then raise exception 'source_expired'; end if;
 if p_status='open' and exists(select 1 from public.action_missions where id=p_mission and ends_at <= now()) then raise exception 'mission_expired'; end if;
 update public.action_missions set status=p_status,updated_at=now() where id=p_mission;
 update public.action_environment_missions set approved_by=p_actor,reviewed_at=now() where mission_id=p_mission;
 insert into public.action_environment_reviews(mission_id,actor,status) values(p_mission,p_actor,p_status);
 return jsonb_build_object('mission_id',p_mission,'status',p_status);
end $$;
revoke all on function public.world_environment_review(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.world_environment_review(uuid,uuid,text) to service_role;

create or replace function public.world_environment_join(p_mission uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.network_group_members m join public.network_groups g on g.id=m.group_id where m.m_uid=public.current_m_uid() and m.state='joined' and lower(g.slug)='environmental-justice-team') then raise exception 'join_team_first'; end if;
 if not exists(select 1 from public.action_environment_missions where mission_id=p_mission and approved_by is not null) then raise exception 'approved_environment_mission_required'; end if;
 return public.join_action_mission(p_mission);
end $$;
revoke all on function public.world_environment_join(uuid) from public,anon;
grant execute on function public.world_environment_join(uuid) to authenticated;
-- Provenance never changes when a mission is reviewed or paused.
create or replace function public.world_environment_immutable_source()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.mission_id is distinct from old.mission_id or new.event_id is distinct from old.event_id or new.action_id is distinct from old.action_id or new.source_snapshot is distinct from old.source_snapshot or new.proposed_by is distinct from old.proposed_by or new.created_at is distinct from old.created_at then raise exception 'immutable_environment_provenance'; end if;
 return new;
end $$;
revoke all on function public.world_environment_immutable_source() from public,anon,authenticated;
create trigger action_environment_immutable_source before update on public.action_environment_missions for each row execute function public.world_environment_immutable_source();
-- The public canonical join RPC is also callable outside this consumer route.
-- Scope an assignment guard to environmental missions so that route choice
-- cannot bypass team membership or owner approval. Existing proof/review
-- status transitions remain valid after a member leaves the team.
create or replace function public.world_environment_assignment_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
   if old.status <> 'withdrawn' and new.mission_id=old.mission_id and new.user_id=old.user_id and new.m_uid is not distinct from old.m_uid then return new; end if;
   if old.status='withdrawn' and new.status='withdrawn' then return new; end if;
 end if;
 if not exists(select 1 from public.action_environment_missions where mission_id=new.mission_id) then return new; end if;
 if not exists(select 1 from public.action_environment_missions e join public.action_missions m on m.id=e.mission_id
   where e.mission_id=new.mission_id and e.approved_by is not null and m.status='open'
   and (m.starts_at is null or m.starts_at<=now()) and (m.ends_at is null or m.ends_at>now())) then raise exception 'approved_environment_mission_required'; end if;
 if not exists(select 1 from public.network_group_members gm join public.network_groups g on g.id=gm.group_id
   join public.m_auth_user_links l on l.m_uid=gm.m_uid
   where l.auth_user_id=new.user_id and (new.m_uid is null or new.m_uid=l.m_uid)
   and gm.state='joined' and lower(g.slug)='environmental-justice-team') then raise exception 'join_team_first'; end if;
 return new;
end $$;
revoke all on function public.world_environment_assignment_guard() from public,anon,authenticated;
create trigger action_environment_assignment_guard before insert or update of status,mission_id,user_id,m_uid
 on public.action_mission_assignments for each row execute function public.world_environment_assignment_guard();
commit;
