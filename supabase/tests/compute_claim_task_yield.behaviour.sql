-- Isolated fixtures only. Run in a disposable database, never production.
-- Behaviour of compute_claim_task after supabase/pending/compute_claim_task_yield_v3.sql:
-- one 5-argument function, the 4-argument named call unchanged, the yield
-- window, its clamp, a negative value as zero, and the service-role-only grant.
begin;
insert into public.orgs(id) values ('00000000-0000-0000-0000-000000000001');
insert into public.ops_compute_nodes(id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version,capabilities) values
('node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','00000000-0000-0000-0000-000000000001','fixture A','fixture','fingerprintA','mccluster-compute/1','test','[{"capability":"ai.chat","implementation":"qwen3.8b.local","max_concurrency":1}]'),
('node_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','00000000-0000-0000-0000-000000000001','fixture B','fixture','fingerprintB','mccluster-compute/1','test','[{"capability":"ai.chat","implementation":"qwen3.8b.local","max_concurrency":1}]'),
('node_cccccccccccccccccccccccccccccccc','00000000-0000-0000-0000-000000000001','fixture C','fixture','fingerprintC','mccluster-compute/1','test','[{"capability":"ai.chat","implementation":"qwen3.8b.local","max_concurrency":1}]'),
('node_dddddddddddddddddddddddddddddddd','00000000-0000-0000-0000-000000000001','fixture D','fixture','fingerprintD','mccluster-compute/1','test','[{"capability":"ai.chat","implementation":"qwen3.8b.local","max_concurrency":1}]');

do $test$
declare
 a text:='node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; b text:='node_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
 c text:='node_cccccccccccccccccccccccccccccccc'; d text:='node_dddddddddddddddddddddddddddddddd';
 t1 uuid:='20000000-0000-0000-0000-000000000001'; t2 uuid:='20000000-0000-0000-0000-000000000002';
 t3 uuid:='20000000-0000-0000-0000-000000000003'; t4 uuid:='20000000-0000-0000-0000-000000000004';
 org uuid:='00000000-0000-0000-0000-000000000001';
 n integer; args text; claim jsonb;
begin
 -- (1) exactly one compute_claim_task, with the 5-argument identity
 select count(*), min(pg_get_function_identity_arguments(p.oid)) into n, args
   from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname = 'compute_claim_task';
 if n <> 1 then raise exception 'expected one compute_claim_task, found %', n; end if;
 if args <> 'p_node_id text, p_capabilities text[], p_implementations text[], p_lease_seconds integer, p_yield_seconds integer' then
   raise exception 'unexpected signature: %', args; end if;

 -- (2) the 4-argument named call (what the gateway sends today) still claims
 insert into public.ops_compute_tasks(id,org_id,capability,priority) values (t1,org,'ai.chat',7);
 claim := public.compute_claim_task(p_node_id => a, p_capabilities => array['ai.chat'], p_implementations => array['qwen3.8b.local'], p_lease_seconds => 120);
 if claim is null then raise exception '4-argument named call claimed nothing'; end if;
 if claim->>'task_id' <> t1::text or claim->>'attempt' <> '1' then raise exception '4-argument claim mismatch: %', claim; end if;
 if claim->>'yield_seconds' <> '0' then raise exception 'default yield is not 0: %', claim->>'yield_seconds'; end if;
 if claim->'task'->>'priority' <> '7' then raise exception 'task priority missing from the claim: %', claim->'task'; end if;
 if claim->>'lease_token' is null or claim->>'expires_at' is null then raise exception 'lease receipt incomplete'; end if;

 -- (3) a yield of 30 s leaves a fresh task alone and takes it once it is older
 insert into public.ops_compute_tasks(id,org_id,capability) values (t2,org,'ai.chat');
 if public.compute_claim_task(b, array['ai.chat'], array['qwen3.8b.local'], 120, 30) is not null then
   raise exception 'a fresh task was claimed inside the yield window'; end if;
 update public.ops_compute_tasks set created_at = now() - interval '31 seconds' where id = t2;
 claim := public.compute_claim_task(b, array['ai.chat'], array['qwen3.8b.local'], 120, 30);
 if claim is null or claim->>'task_id' <> t2::text then raise exception 'a 31 s old task was not claimed with yield 30: %', claim; end if;
 if claim->>'yield_seconds' <> '30' then raise exception 'yield_seconds not echoed: %', claim; end if;

 -- (4) the yield clamps at 300 s: 301 s old is claimable, 299 s old is not
 insert into public.ops_compute_tasks(id,org_id,capability,created_at) values
   (t3,org,'ai.chat',now() - interval '299 seconds'),
   (t4,org,'ai.chat',now() - interval '301 seconds');
 claim := public.compute_claim_task(c, array['ai.chat'], array['qwen3.8b.local'], 120, 100000);
 if claim is null or claim->>'task_id' <> t4::text then raise exception 'the 301 s task was not the one claimed with yield 100000: %', claim; end if;
 if claim->>'yield_seconds' <> '300' then raise exception 'yield not clamped to 300: %', claim->>'yield_seconds'; end if;
 if public.compute_claim_task(d, array['ai.chat'], array['qwen3.8b.local'], 120, 100000) is not null then
   raise exception 'the 299 s task was claimed inside the clamped yield window'; end if;

 -- (5) a negative yield behaves as zero
 claim := public.compute_claim_task(d, array['ai.chat'], array['qwen3.8b.local'], 120, -5);
 if claim is null or claim->>'task_id' <> t3::text then raise exception 'negative yield did not behave as zero: %', claim; end if;
 if claim->>'yield_seconds' <> '0' then raise exception 'negative yield not reported as 0: %', claim->>'yield_seconds'; end if;

 -- (6) service role only on the 5-argument signature
 if has_function_privilege('anon','public.compute_claim_task(text,text[],text[],integer,integer)','execute')
    or has_function_privilege('authenticated','public.compute_claim_task(text,text[],text[],integer,integer)','execute') then
   raise exception 'public RPC access to compute_claim_task'; end if;
 if not has_function_privilege('service_role','public.compute_claim_task(text,text[],text[],integer,integer)','execute') then
   raise exception 'gateway access lost'; end if;
end;$test$;
rollback;
