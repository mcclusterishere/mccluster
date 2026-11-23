-- Isolated fixtures only. Run in a disposable database, never production.
-- Behaviour of supabase/pending/compute_scheduler_lease_v1.sql: one active
-- scheduler per org, fencing by term, takeover only after expiry or handover,
-- failback only by handover.
begin;
insert into public.orgs(id) values ('00000000-0000-0000-0000-000000000011');

do $test$
declare
 org uuid:='00000000-0000-0000-0000-000000000011';
 p text:='core-primary'; s text:='core-standby'; r jsonb; st jsonb; i integer;
begin
 -- fresh acquire: term 1, active
 r:=public.compute_scheduler_acquire(org,p,'primary',30);
 if (r->>'active')<>'true' or (r->>'term')<>'1' or r->>'reason'<>'fresh' or r->>'holder_id'<>p or r->>'server_time' is null or r->>'expires_at' is null then raise exception 'fresh acquire: %',r;end if;
 -- same holder re-acquire renews the same term
 r:=public.compute_scheduler_acquire(org,p,'primary',30);
 if (r->>'active')<>'true' or (r->>'term')<>'1' or r->>'reason'<>'renewed' then raise exception 're-acquire: %',r;end if;
 -- other holder while live: held
 r:=public.compute_scheduler_acquire(org,s,'standby',30);
 if (r->>'active')<>'false' or r->>'reason'<>'held' or r->>'holder_id'<>p or (r->>'term')<>'1' then raise exception 'standby preempted live primary: %',r;end if;
 -- renew with the right term works, wrong term fenced
 r:=public.compute_scheduler_renew(org,p,1,30);
 if (r->>'ok')<>'true' or (r->>'term')<>'1' then raise exception 'renew: %',r;end if;
 r:=public.compute_scheduler_renew(org,p,7,30);
 if (r->>'ok')<>'false' or r->>'reason'<>'fenced' or r->>'holder_id'<>p or (r->>'term')<>'1' then raise exception 'wrong term not fenced: %',r;end if;
 -- renew by a non-holder is fenced
 r:=public.compute_scheduler_renew(org,s,1,30);
 if (r->>'ok')<>'false' or r->>'reason'<>'fenced' then raise exception 'non-holder renew: %',r;end if;
 -- status: live
 st:=public.compute_scheduler_status(org);
 if (st->>'live')<>'true' or st->>'holder_id'<>p or (st->>'term')<>'1' or st->>'server_time' is null then raise exception 'status live: %',st;end if;
 -- forced expiry, standby takes over with term 2
 update public.ops_compute_scheduler_leases set expires_at=clock_timestamp()-interval '1 second' where org_id=org;
 st:=public.compute_scheduler_status(org);
 if (st->>'live')<>'false' then raise exception 'status should not be live after expiry: %',st;end if;
 r:=public.compute_scheduler_acquire(org,s,'standby',30);
 if (r->>'active')<>'true' or (r->>'term')<>'2' or r->>'reason'<>'expired_takeover' or r->>'holder_id'<>s or r->>'holder_role'<>'standby' then raise exception 'expired takeover: %',r;end if;
 -- old holder: renew fenced, stale release fenced, handover fenced
 r:=public.compute_scheduler_renew(org,p,1,30);
 if (r->>'ok')<>'false' or r->>'reason'<>'fenced' or r->>'holder_id'<>s or (r->>'term')<>'2' then raise exception 'old holder renew not fenced: %',r;end if;
 r:=public.compute_scheduler_release(org,p,1);
 if (r->>'ok')<>'false' or r->>'reason'<>'fenced' then raise exception 'stale release not fenced: %',r;end if;
 r:=public.compute_scheduler_handover(org,p,1,s,60);
 if (r->>'ok')<>'false' or r->>'reason'<>'fenced' then raise exception 'non-holder handover not fenced: %',r;end if;
 -- primary acquire while standby live: held (a primary never preempts a live standby)
 r:=public.compute_scheduler_acquire(org,p,'primary',30);
 if (r->>'active')<>'false' or r->>'reason'<>'held' or r->>'holder_id'<>s then raise exception 'primary preempted live standby: %',r;end if;
 -- handover to self: invalid
 r:=public.compute_scheduler_handover(org,s,2,s,60);
 if (r->>'ok')<>'false' or r->>'reason'<>'invalid' then raise exception 'handover to self: %',r;end if;
 -- controlled failback: standby hands over to primary
 r:=public.compute_scheduler_handover(org,s,2,p,60);
 if (r->>'ok')<>'false' and (r->>'ok')<>'true' then raise exception 'handover shape: %',r;end if;
 if (r->>'ok')<>'true' or r->>'handover_to'<>p or r->>'handover_expires_at' is null then raise exception 'handover request: %',r;end if;
 r:=public.compute_scheduler_renew(org,s,2,30);
 if (r->>'ok')<>'true' or r->>'handover_to'<>p then raise exception 'renew hides pending handover: %',r;end if;
 st:=public.compute_scheduler_status(org);
 if (st->>'handover_pending')<>'true' or (st->>'live')<>'true' then raise exception 'status handover pending: %',st;end if;
 -- a third party is still held even while a handover is pending for someone else
 r:=public.compute_scheduler_acquire(org,'core-third','standby',30);
 if (r->>'active')<>'false' or r->>'reason'<>'held' then raise exception 'third party took a handover meant for another: %',r;end if;
 r:=public.compute_scheduler_acquire(org,p,'primary',30);
 if (r->>'active')<>'true' or (r->>'term')<>'3' or r->>'reason'<>'handover' or r->>'holder_id'<>p or r->>'handover_to' is not null then raise exception 'handover takeover: %',r;end if;
 r:=public.compute_scheduler_renew(org,s,2,30);
 if (r->>'ok')<>'false' or r->>'reason'<>'fenced' or r->>'holder_id'<>p or (r->>'term')<>'3' then raise exception 'standby renew after handover not fenced: %',r;end if;
 st:=public.compute_scheduler_status(org);
 if st->>'handover_to' is not null or (st->>'handover_pending')<>'false' then raise exception 'handover not cleared: %',st;end if;
 -- handover expiry: target arriving late is held
 r:=public.compute_scheduler_handover(org,p,3,s,60);
 if (r->>'ok')<>'true' then raise exception 'second handover request: %',r;end if;
 update public.ops_compute_scheduler_leases set handover_expires_at=clock_timestamp()-interval '1 second' where org_id=org;
 r:=public.compute_scheduler_acquire(org,s,'standby',30);
 if (r->>'active')<>'false' or r->>'reason'<>'held' or r->>'handover_to' is not null then raise exception 'expired handover honoured: %',r;end if;
 r:=public.compute_scheduler_renew(org,p,3,30);
 if (r->>'ok')<>'true' or r->>'handover_to' is not null then raise exception 'expired handover still shown: %',r;end if;
 -- release by holder, then any acquire takes over
 r:=public.compute_scheduler_release(org,p,3);
 if (r->>'ok')<>'true' then raise exception 'release: %',r;end if;
 st:=public.compute_scheduler_status(org);
 if (st->>'live')<>'false' or st->>'released_at' is null then raise exception 'status after release: %',st;end if;
 r:=public.compute_scheduler_renew(org,p,3,30);
 if (r->>'ok')<>'false' then raise exception 'renew after release: %',r;end if;
 r:=public.compute_scheduler_acquire(org,s,'standby',30);
 if (r->>'active')<>'true' or (r->>'term')<>'4' or r->>'reason'<>'expired_takeover' or r->>'holder_id'<>s then raise exception 'takeover after release: %',r;end if;
 st:=public.compute_scheduler_status(org);
 if (st->>'live')<>'true' or st->>'released_at' is not null then raise exception 'status after takeover: %',st;end if;
 -- TTL clamp: 1 second asks for 10, 9999 gets 300
 r:=public.compute_scheduler_renew(org,s,4,1);
 if (r->>'expires_at')::timestamptz < (r->>'server_time')::timestamptz + interval '9 seconds' then raise exception 'ttl floor: %',r;end if;
 r:=public.compute_scheduler_renew(org,s,4,9999);
 if (r->>'expires_at')::timestamptz > (r->>'server_time')::timestamptz + interval '301 seconds' then raise exception 'ttl ceiling: %',r;end if;
 -- history: bounded to 20 across many transitions
 for i in 1..15 loop
  r:=public.compute_scheduler_release(org,s,(public.compute_scheduler_status(org)->>'term')::bigint);
  if (r->>'ok')<>'true' then raise exception 'loop release %: %',i,r;end if;
  r:=public.compute_scheduler_acquire(org,s,'standby',30);
  if (r->>'active')<>'true' or r->>'reason'<>'expired_takeover' then raise exception 'loop acquire %: %',i,r;end if;
 end loop;
 st:=public.compute_scheduler_status(org);
 if jsonb_array_length(st->'history')<>20 then raise exception 'history not bounded to 20: %',jsonb_array_length(st->'history');end if;
 if (st->'history'->19->>'event')<>'expired_takeover' or (st->'history'->19->>'term')<>st->>'term' then raise exception 'history order: %',st->'history';end if;
 if (st->>'term')<>'19' then raise exception 'term after loop: %',st->>'term';end if;
 -- no row: status null, renew fenced
 if public.compute_scheduler_status('00000000-0000-0000-0000-0000000000ee') is not null then raise exception 'status for missing org';end if;
 r:=public.compute_scheduler_renew('00000000-0000-0000-0000-0000000000ee',p,1,30);
 if (r->>'ok')<>'false' or r->>'reason'<>'fenced' then raise exception 'renew without row: %',r;end if;
 -- invalid inputs are rejected before any write
 begin
  perform public.compute_scheduler_acquire(org,'Bad Holder','primary',30);
  raise exception 'invalid holder id accepted';
 exception when others then
  if sqlerrm='invalid holder id accepted' then raise; end if;
 end;
 begin
  perform public.compute_scheduler_acquire(org,p,'leader',30);
  raise exception 'invalid role accepted';
 exception when others then
  if sqlerrm='invalid role accepted' then raise; end if;
 end;
 -- privileges: service_role only; the history helper is exposed to nobody
 if has_function_privilege('anon','public.compute_scheduler_acquire(uuid,text,text,integer)','execute')
    or has_function_privilege('authenticated','public.compute_scheduler_renew(uuid,text,bigint,integer)','execute')
    or has_function_privilege('anon','public.compute_scheduler_release(uuid,text,bigint)','execute')
    or has_function_privilege('authenticated','public.compute_scheduler_handover(uuid,text,bigint,text,integer)','execute')
    or has_function_privilege('anon','public.compute_scheduler_status(uuid)','execute') then raise exception 'public RPC access';end if;
 if has_function_privilege('service_role','public.compute_scheduler_history_push(jsonb,timestamptz,text,text,text,bigint)','execute') then raise exception 'helper exposed';end if;
 if not has_function_privilege('service_role','public.compute_scheduler_acquire(uuid,text,text,integer)','execute')
    or not has_function_privilege('service_role','public.compute_scheduler_status(uuid)','execute') then raise exception 'gateway access lost';end if;
 if has_table_privilege('anon','public.ops_compute_scheduler_leases','select') or has_table_privilege('authenticated','public.ops_compute_scheduler_leases','select')
    or has_table_privilege('service_role','public.ops_compute_scheduler_leases','insert') then raise exception 'table privilege leak';end if;
end;$test$;
rollback;
