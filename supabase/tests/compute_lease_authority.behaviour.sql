-- Isolated fixtures only. Run in a disposable database, never production.
begin;
insert into public.orgs(id) values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.ops_compute_nodes(id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version,capabilities) values
('node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','00000000-0000-0000-0000-000000000001','fixture A','fixture','fingerprintA','mccluster-compute/1','test','[{"capability":"ai.chat","implementation":"fixture.local","max_concurrency":1}]'),
('node_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','00000000-0000-0000-0000-000000000001','fixture B','fixture','fingerprintB','mccluster-compute/1','test','[{"capability":"ai.chat","implementation":"fixture.local","max_concurrency":1}]'),
('node_cccccccccccccccccccccccccccccccc','00000000-0000-0000-0000-000000000002','fixture C','fixture','fingerprintC','mccluster-compute/1','test','[{"capability":"ai.chat","implementation":"fixture.local","max_concurrency":1}]');
insert into public.ops_compute_tasks(id,org_id,capability) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','ai.chat');

do $test$
declare
 a text:='node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; b text:='node_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; c text:='node_cccccccccccccccccccccccccccccccc';
 claim jsonb; second jsonb; started jsonb; lease uuid; token text; task uuid:='10000000-0000-0000-0000-000000000001'; before_time timestamptz;
begin
 if public.compute_claim_task(c,array['ai.chat'],array['fixture.local']) is not null then raise exception 'cross org claim'; end if;
 claim:=public.compute_claim_task(a,array['ai.chat'],array['fixture.local']);
 lease:=(claim->>'lease_id')::uuid;token:=claim->>'lease_token';
 if claim->>'attempt'<>'1' or claim->>'node_id'<>a or claim->>'task_id'<>task::text or claim->>'server_time' is null then raise exception 'missing claim authority';end if;
 if public.compute_claim_task(b,array['ai.chat'],array['fixture.local']) is not null then raise exception 'double lease';end if;
 if public.compute_start_lease(b,lease,token) is not null then raise exception 'cross node start';end if;
 if public.compute_start_lease(a,lease,'tampered') is not null then raise exception 'wrong token start';end if;
 started:=public.compute_start_lease(a,lease,token);
 if started->>'status'<>'running' or started->>'attempt'<>'1' or started->>'lease_id'<>lease::text then raise exception 'start receipt mismatch';end if;
 update public.ops_compute_nodes set state='revoked',revoked_at=clock_timestamp() where id=a;
 if public.compute_complete_lease(a,lease,token,'{"answer":42}') then raise exception 'revoked node committed';end if;
 if public.compute_heartbeat_lease(a,lease,token) is not null then raise exception 'revoked node renewed';end if;
 update public.ops_compute_nodes set state='online',revoked_at=null where id=a;
 update public.ops_compute_tasks set status='canceled' where id=task;
 if public.compute_complete_lease(a,lease,token,'{"answer":42}') then raise exception 'canceled task committed';end if;
 update public.ops_compute_tasks set status='running' where id=task;
 update public.ops_compute_leases set expires_at=clock_timestamp()-interval '1 second' where id=lease;
 if public.compute_complete_lease(a,lease,token,'{"late":true}') then raise exception 'expired completion';end if;
 if public.compute_heartbeat_lease(a,lease,token) is not null then raise exception 'expired renewal';end if;
 perform public.compute_claim_task(b,array['ai.chat'],array['fixture.local']); -- requeues expired attempt
 update public.ops_compute_tasks set run_after=clock_timestamp()-interval '1 second' where id=task;
 second:=public.compute_claim_task(b,array['ai.chat'],array['fixture.local']);
 if second->>'attempt'<>'2' then raise exception 'replacement attempt missing';end if;
 if public.compute_complete_lease(a,lease,token,'{"late":true}') then raise exception 'stale attempt committed';end if;
 if public.compute_fail_lease(a,lease,token,'late failure') then raise exception 'stale attempt failed replacement';end if;
 lease:=(second->>'lease_id')::uuid;token:=second->>'lease_token';
 perform public.compute_start_lease(b,lease,token);
 update public.ops_compute_tasks set attempts=3 where id=task;
 if public.compute_complete_lease(b,lease,token,'{"answer":42}') then raise exception 'attempt fence ignored';end if;
 update public.ops_compute_tasks set attempts=2 where id=task;
 if not public.compute_complete_lease(b,lease,token,'{"answer":42}') then raise exception 'valid completion denied';end if;
 select updated_at into before_time from public.ops_compute_tasks where id=task;
 if not public.compute_complete_lease(b,lease,token,'{"answer":42}') then raise exception 'exact replay denied';end if;
 if (select updated_at from public.ops_compute_tasks where id=task) <> before_time then raise exception 'replay rewrote result';end if;
 if public.compute_complete_lease(b,lease,token,'{"answer":99}') then raise exception 'changed replay overwrote';end if;
 if (select output from public.ops_compute_tasks where id=task)<>'{"answer":42}'::jsonb then raise exception 'output changed';end if;
 if not public.compute_accept_nonce(b,'fixture-nonce',clock_timestamp()+interval '1 minute') then raise exception 'first nonce rejected';end if;
 if public.compute_accept_nonce(b,'fixture-nonce',clock_timestamp()+interval '1 minute') then raise exception 'durable replay accepted';end if;
 if has_function_privilege('anon','public.compute_complete_lease(text,uuid,text,jsonb)','execute') or has_function_privilege('authenticated','public.compute_start_lease(text,uuid,text,integer)','execute') then raise exception 'public RPC access';end if;
 if has_function_privilege('service_role','public.compute_transition_lease_v2(text,text,uuid,text,jsonb,integer,boolean)','execute') then raise exception 'helper exposed';end if;
 if not has_function_privilege('service_role','public.compute_complete_lease(text,uuid,text,jsonb)','execute') then raise exception 'gateway access lost';end if;
end;$test$;
rollback;
