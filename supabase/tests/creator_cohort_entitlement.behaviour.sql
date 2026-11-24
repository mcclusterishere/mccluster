-- Disposable native database only. Apply cohort grants, then the five-argument
-- publisher before this fixture. Uses canonical base tables and identity signup
-- trigger unchanged; every account, trigger side effect and publication rolls back.
begin;
set local statement_timeout = '20s';

create temp table creator_cohort_checks(label text primary key);
create function pg_temp.prove(label text, ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if ok is distinct from true then raise exception 'creator cohort: %', label; end if;
  insert into pg_temp.creator_cohort_checks values (label);
end $$;
create function pg_temp.refused(label text, command text, expected_state text) returns void language plpgsql as $$
begin
  begin
    execute command;
  exception when others then
    if expected_state is not null and sqlstate <> expected_state then raise; end if;
    perform pg_temp.prove(label, true);
    return;
  end;
  raise exception 'creator cohort unexpectedly allowed: %', label;
end $$;
create function pg_temp.key(n integer) returns uuid language sql immutable as $$
  select ('d8720000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.publish_command(org_n integer, user_n integer, title text default 'Synthetic creator site')
returns text language sql as $$
  select format('select public.creator_publish_site(%L::uuid,%L,%L,%L,%L::uuid)',
    pg_temp.key(org_n), title, '', '', pg_temp.key(user_n))
$$;

do $baseline$
begin
  assert not exists (select 1 from auth.users where id::text like 'd8720000-%'), 'synthetic account namespace must be unused';
  assert exists (select 1 from pg_trigger where tgrelid='auth.users'::regclass
    and tgname='m_auth_user_after_insert' and tgenabled='O'), 'canonical identity signup trigger required';
end $baseline$;
insert into auth.users(id,email) select pg_temp.key(n), 'cohort-proof-'||n||'@example.invalid' from generate_series(1,3) n;
insert into public.orgs(id,slug,name) values
 (pg_temp.key(101),'cohort-proof-paid','Synthetic paid workspace'),
 (pg_temp.key(102),'cohort-proof-selected','Synthetic selected workspace'),
 (pg_temp.key(103),'cohort-proof-other','Synthetic unrelated workspace');
insert into public.action_cohorts(id,name,status) values
 (pg_temp.key(201),'Synthetic selected cohort','active'),
 (pg_temp.key(202),'Synthetic other cohort','active');
insert into public.action_cohort_members(cohort_id,m_uid)
select pg_temp.key(201), m_uid from public.m_auth_user_links where auth_user_id=pg_temp.key(1);
insert into public.creator_billing_subscriptions
 (stripe_subscription_id,stripe_customer_id,owner_user_id,stripe_price_id,status,current_period_end,org_id)
values ('sub_CohortProof','cus_CohortProof',pg_temp.key(1),'price_CohortProof','active',now()+interval '1 day',pg_temp.key(101));
insert into public.creator_site_cohort_grants(org_id,creator_user_id,cohort_id,granted_by,reason)
values (pg_temp.key(102),pg_temp.key(1),pg_temp.key(201),pg_temp.key(3),'Synthetic owner-reviewed grant');

select pg_temp.prove('grant table has forced RLS',
 (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.creator_site_cohort_grants'::regclass));
select pg_temp.prove('signup trigger linked the creator to the selected cohort',
 (select count(*)=1 from public.action_cohort_members m join public.m_auth_user_links l using(m_uid)
  where m.cohort_id=pg_temp.key(201) and l.auth_user_id=pg_temp.key(1)));
select pg_temp.prove('both publisher overloads are private to service',
 (select bool_and(not has_function_privilege('anon',p.oid,'execute')
   and not has_function_privilege('authenticated',p.oid,'execute')
   and has_function_privilege('service_role',p.oid,'execute'))
 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='creator_publish_site'));

set local role anon;
select pg_temp.refused('anon cannot read grants','select * from public.creator_site_cohort_grants','42501');
select pg_temp.refused('anon cannot publish',pg_temp.publish_command(102,1),'42501');
reset role;
set local role authenticated;
select pg_temp.refused('member cannot read grants','select * from public.creator_site_cohort_grants','42501');
select pg_temp.refused('member cannot update grants','update public.creator_site_cohort_grants set revoked_at=null','42501');
select pg_temp.refused('member cannot publish via the new overload',pg_temp.publish_command(102,1),'42501');
select pg_temp.refused('member cannot publish via the old overload',
 format('select public.creator_publish_site(%L::uuid,%L,%L,%L)',pg_temp.key(101),'Synthetic','',''),'42501');
reset role;

set local role service_role;
select pg_temp.prove('paid creator publishes using the Worker five-argument signature',
 public.creator_publish_site(pg_temp.key(101),'Paid site',null,null,pg_temp.key(1))='site-'||replace(pg_temp.key(101)::text,'-',''));
select pg_temp.prove('cohort membership publishes without a paid subscription',
 public.creator_publish_site(pg_temp.key(102),'Cohort site','','',pg_temp.key(1))='site-'||replace(pg_temp.key(102)::text,'-',''));
select pg_temp.refused('paid workspace rejects another identity',pg_temp.publish_command(101,2),'P0001');
select pg_temp.refused('cohort grant rejects another identity',pg_temp.publish_command(102,2),'P0001');
select pg_temp.refused('entitlement does not cross workspaces',pg_temp.publish_command(103,1),'P0001');
select pg_temp.refused('null identity rejected',
 format('select public.creator_publish_site(%L::uuid,%L,%L,%L,null)',pg_temp.key(101),'Synthetic','',''),'P0001');
select pg_temp.refused('null workspace rejected',
 format('select public.creator_publish_site(null,%L,%L,%L,%L::uuid)','Synthetic','','',pg_temp.key(1)),'P0001');
select pg_temp.refused('legacy overload cannot use a cohort grant',
 format('select public.creator_publish_site(%L::uuid,%L,%L,%L)',pg_temp.key(102),'Synthetic','',''),'P0001');
select pg_temp.prove('legacy paid-only service caller remains compatible',
 public.creator_publish_site(pg_temp.key(101),'Legacy paid site','','')='site-'||replace(pg_temp.key(101)::text,'-',''));
select pg_temp.refused('empty title refused',pg_temp.publish_command(102,1,''),'P0001');
select pg_temp.refused('overlong title refused',pg_temp.publish_command(102,1,repeat('x',121)),'P0001');
select pg_temp.refused('null title refused',pg_temp.publish_command(102,1,null),'23502');
select pg_temp.refused('overlong tagline refused',
 format('select public.creator_publish_site(%L::uuid,%L,%L,%L,%L::uuid)',pg_temp.key(102),'Synthetic',repeat('x',301),'',pg_temp.key(1)),'P0001');
select pg_temp.refused('overlong bio refused',
 format('select public.creator_publish_site(%L::uuid,%L,%L,%L,%L::uuid)',pg_temp.key(102),'Synthetic','',repeat('x',4001),pg_temp.key(1)),'P0001');
select pg_temp.prove('failed publishes preserve stored content',
 (select title='Cohort site' from public.creator_published_sites where org_id=pg_temp.key(102)));
select pg_temp.prove('republication updates one stable site',
 public.creator_publish_site(pg_temp.key(102),'Updated cohort site','Tagline','Plain text',pg_temp.key(1))='site-'||replace(pg_temp.key(102)::text,'-','')
 and (select count(*)=1 from public.creator_published_sites where org_id=pg_temp.key(102)));
select pg_temp.prove('stored publication reloads the updated plain text',
 (select title='Updated cohort site' and tagline='Tagline' and bio='Plain text'
  from public.creator_published_sites where org_id=pg_temp.key(102)));
reset role;

-- Each authoritative entitlement component is re-read by the RPC.
update public.creator_site_cohort_grants set revoked_at=now() where org_id=pg_temp.key(102);
set local role service_role;
select pg_temp.refused('revocation immediately blocks another publish',pg_temp.publish_command(102,1),'P0001');
reset role;
update public.creator_site_cohort_grants set revoked_at=null where org_id=pg_temp.key(102);
update public.action_cohorts set status='archived' where id=pg_temp.key(201);
set local role service_role;
select pg_temp.refused('archived cohort blocked',pg_temp.publish_command(102,1),'P0001');
reset role;
update public.action_cohorts set status='complete' where id=pg_temp.key(201);
set local role service_role;
select pg_temp.refused('completed cohort blocked',pg_temp.publish_command(102,1),'P0001');
reset role;
update public.action_cohorts set status='active' where id=pg_temp.key(201);
update public.action_cohort_members set cohort_id=pg_temp.key(202) where cohort_id=pg_temp.key(201);
set local role service_role;
select pg_temp.refused('membership in a different cohort does not qualify',pg_temp.publish_command(102,1),'P0001');
reset role;
update public.action_cohort_members set cohort_id=pg_temp.key(201) where cohort_id=pg_temp.key(202);
create temp table original_creator_link as select * from public.m_auth_user_links where auth_user_id=pg_temp.key(1);
delete from public.m_auth_user_links where auth_user_id=pg_temp.key(1);
set local role service_role;
select pg_temp.refused('unlinked identity cannot use the grant',pg_temp.publish_command(102,1),'P0001');
reset role;
insert into public.m_auth_user_links select * from pg_temp.original_creator_link;

update public.creator_billing_subscriptions set status='canceled' where org_id=pg_temp.key(101);
set local role service_role;
select pg_temp.refused('canceled paid subscription blocked',pg_temp.publish_command(101,1),'P0001');
reset role;
update public.creator_billing_subscriptions set status='active', current_period_end=now() where org_id=pg_temp.key(101);
set local role service_role;
select pg_temp.refused('subscription ending exactly now is expired',pg_temp.publish_command(101,1),'P0001');
reset role;
update public.creator_billing_subscriptions set current_period_end=null where org_id=pg_temp.key(101);
set local role service_role;
select pg_temp.refused('subscription with no expiry does not qualify',pg_temp.publish_command(101,1),'P0001');
reset role;

-- One valid source remains enough when the other source is removed.
update public.creator_billing_subscriptions set org_id=pg_temp.key(102),status='active',current_period_end=now()+interval '1 day'
where stripe_subscription_id='sub_CohortProof';
update public.creator_site_cohort_grants set revoked_at=now() where org_id=pg_temp.key(102);
set local role service_role;
select pg_temp.prove('revoking cohort grant preserves active paid entitlement',
 public.creator_publish_site(pg_temp.key(102),'Paid survives','','',pg_temp.key(1)) is not null);
reset role;
update public.creator_site_cohort_grants set revoked_at=null where org_id=pg_temp.key(102);
update public.creator_billing_subscriptions set status='canceled' where org_id=pg_temp.key(102);
set local role service_role;
select pg_temp.prove('canceling paid entitlement preserves active cohort grant',
 public.creator_publish_site(pg_temp.key(102),'Cohort survives','','',pg_temp.key(1)) is not null);
select pg_temp.refused('grant reason cannot be blank',
 format('update public.creator_site_cohort_grants set reason=%L where org_id=%L::uuid','        ',pg_temp.key(102)),'23514');
select pg_temp.refused('grant references a real creator account',
 format('update public.creator_site_cohort_grants set creator_user_id=%L::uuid where org_id=%L::uuid',pg_temp.key(999),pg_temp.key(102)),'23503');
select pg_temp.refused('grant references a real reviewing account',
 format('update public.creator_site_cohort_grants set granted_by=%L::uuid where org_id=%L::uuid',pg_temp.key(999),pg_temp.key(102)),'23503');
reset role;

select count(*) as passed_checks from pg_temp.creator_cohort_checks;
rollback;
