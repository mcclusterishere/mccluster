-- Run inside a rollback transaction after the migration; synthetic text only.
do $$
declare org uuid; host_id uuid; host_uid uuid; root uuid; source uuid; sid uuid; jid uuid; r jsonb; j2 jsonb; second_uid uuid; second_job uuid;
begin
 select id into org from public.orgs where slug='mccluster';
 select auth_user_id,m_uid into host_id,host_uid from public.m_auth_user_links where is_primary limit 1;
 insert into public.network_posts(author_m_uid,body,post_type,visibility) values(host_uid,'Synthetic live actor integration fixture','update','public') returning id into root;
 insert into public.network_live_sessions(host_m_uid,host_user_id,title,status,post_id,last_seen_at)
 values(host_uid,host_id,'Synthetic integration fixture','live',root,now()) returning id into sid;
 insert into public.network_posts(author_m_uid,body,reply_to_id,post_type,visibility)
 values(host_uid,'We are testing a community recording studio discussion.',root,'update','public') returning id into source;
 if (public.ops_live_actor_tick(sid)->>'queued')::boolean then raise exception 'disabled room queued'; end if;
 begin perform public.ops_live_actor_config(sid,gen_random_uuid(),array['royce.r01']);raise exception 'wrong host accepted';exception when insufficient_privilege then null;end;
 perform public.ops_live_actor_config(sid,host_id,array['royce.r01']);
 r:=public.ops_live_actor_tick(sid);jid:=(r->>'job_id')::uuid;
 if jid is null then raise exception 'missing queued job'; end if;
 if (public.ops_live_actor_tick(sid)->>'queued')::boolean then raise exception 'duplicate queued'; end if;
 update public.ops_agent_jobs set status='running' where id=jid;
 r:=public.ops_live_actor_context(jid,org);
 if r->>'source_post_id'<>source::text then raise exception 'wrong source';end if;
 r:=public.ops_live_actor_publish(jid,org,'A community studio? That is a room worth making noise in.','test-model','{"approved":true,"reason":"fixture"}');
 if r->>'published'<>'true' then raise exception 'publication failed';end if;
 j2:=public.ops_live_actor_publish(jid,org,'Must not publish a second copy of this reply.','test-model','{"approved":true}');
 if j2->>'comment_id'<>r->>'comment_id' then raise exception 'idempotency failed';end if;
 if exists(select 1 from public.network_live_audience where session_id=sid) then raise exception 'AI counted as viewer';end if;
 -- A second fictional actor can answer once; a third autonomous turn cannot queue.
 insert into public.m_people default values returning id into second_uid;
 insert into public.ops_platform_actors(actor_key,org_id,m_uid,handle,enabled,daily_limit,persona,authority)
 values('test.second',org,second_uid,'test.second',true,1,'{}','rollback test only');
 perform public.ops_live_actor_config(sid,host_id,array['royce.r01','test.second']);
 update public.ops_agent_jobs set status='done' where id=jid;
 update public.ops_live_actor_turns set created_at=now()-interval '100 seconds' where job_id=jid;
 r:=public.ops_live_actor_tick(sid);second_job:=(r->>'job_id')::uuid;
 if second_job is null or (select turn from public.ops_live_actor_turns where job_id=second_job)<>2 then raise exception 'second actor turn missing'; end if;
 update public.ops_agent_jobs set status='running' where id=second_job;
 r:=public.ops_live_actor_publish(second_job,org,'Then make room for the neighbors to build something together.','test-model','{"approved":true}');
 if r->>'published'<>'true' then raise exception 'second publication failed';end if;
 update public.ops_agent_jobs set status='done' where id=second_job;
 update public.ops_live_actor_turns set created_at=now()-interval '100 seconds' where job_id=second_job;
 if (public.ops_live_actor_tick(sid)->>'queued')::boolean then raise exception 'third autonomous turn queued';end if;
 -- Revoke and re-enable: an older job cannot use new authorization.
 update public.ops_live_actor_turns set response_post_id=null,published_at=null where job_id=jid;
 perform public.ops_live_actor_config(sid,host_id,'{}');
 perform public.ops_live_actor_config(sid,host_id,array['royce.r01']);
 if public.ops_live_actor_context(jid,org)->>'reason'<>'inactive_or_stale' then raise exception 'epoch did not invalidate';end if;
 if has_function_privilege('authenticated','public.ops_live_actor_tick(uuid)','EXECUTE') or has_table_privilege('anon','public.ops_live_actor_turns','SELECT') then raise exception 'public permissions leaked';end if;
end $$;
