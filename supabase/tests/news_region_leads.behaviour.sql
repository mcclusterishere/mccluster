-- Disposable native database only, after news_region_leads. Uses the existing
-- canonical m_people table and API roles, without replacing them. All rows roll back.
begin;
set local statement_timeout = '20s';
create temp table news_region_lead_checks(label text primary key);
create function pg_temp.prove(label text, ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if ok is distinct from true then raise exception 'news region leads: %', label; end if;
  insert into pg_temp.news_region_lead_checks values (label);
end $$;
create function pg_temp.refused(label text, command text, expected_state text) returns void language plpgsql as $$
begin
  begin
    execute command;
  exception when others then
    if sqlstate <> expected_state then raise; end if;
    perform pg_temp.prove(label,true);
    return;
  end;
  raise exception 'news region leads unexpectedly allowed: %',label;
end $$;
create function pg_temp.key(n integer) returns uuid language sql immutable as $$
  select ('d8730000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
insert into public.m_people(id) values (pg_temp.key(1)),(pg_temp.key(2));
select pg_temp.prove('RLS enabled with no direct-client policies',
 (select relrowsecurity from pg_class where oid='public.news_region_leads'::regclass)
 and not exists(select 1 from pg_policy where polrelid='public.news_region_leads'::regclass));
select pg_temp.prove('service has explicit CRUD access',
 has_table_privilege('service_role','public.news_region_leads','SELECT')
 and has_table_privilege('service_role','public.news_region_leads','INSERT')
 and has_table_privilege('service_role','public.news_region_leads','UPDATE')
 and has_table_privilege('service_role','public.news_region_leads','DELETE'));
set local role anon;
select pg_temp.refused('anon cannot read leaders','select * from public.news_region_leads','42501');
select pg_temp.refused('anon cannot grant leaders',format('insert into public.news_region_leads(m_uid,country_code,granted_by) values(%L,%L,%L)',pg_temp.key(1),'US',pg_temp.key(3)),'42501');
reset role;
set local role authenticated;
select pg_temp.refused('member cannot read leaders','select * from public.news_region_leads','42501');
select pg_temp.refused('member cannot grant leaders',format('insert into public.news_region_leads(m_uid,country_code,granted_by) values(%L,%L,%L)',pg_temp.key(1),'US',pg_temp.key(3)),'42501');
select pg_temp.refused('member cannot change leaders','update public.news_region_leads set country_code=''US''','42501');
select pg_temp.refused('member cannot revoke leaders','delete from public.news_region_leads','42501');
reset role;
set local role service_role;
insert into public.news_region_leads(m_uid,country_code,granted_by) values
 (pg_temp.key(1),'US',pg_temp.key(3)),(pg_temp.key(1),'CA',pg_temp.key(3)),(pg_temp.key(2),'US',pg_temp.key(3));
select pg_temp.prove('one leader can hold two countries and one country can have two leaders',
 (select count(*)=2 from public.news_region_leads where m_uid=pg_temp.key(1))
 and (select count(*)=2 from public.news_region_leads where country_code='US'));
insert into public.news_region_leads(m_uid,country_code,granted_by)
values(pg_temp.key(1),'US',pg_temp.key(4))
on conflict(m_uid,country_code) do update set granted_by=excluded.granted_by;
select pg_temp.prove('Worker-style upsert repeats one grant and updates its reviewer',
 (select count(*)=1 and bool_and(granted_by=pg_temp.key(4) and granted_at=now()) from public.news_region_leads where m_uid=pg_temp.key(1) and country_code='US'));
select pg_temp.refused('unknown person refused',format('insert into public.news_region_leads(m_uid,country_code,granted_by) values(%L,%L,%L)',pg_temp.key(99),'US',pg_temp.key(3)),'23503');
select pg_temp.refused('lowercase country refused',format('insert into public.news_region_leads(m_uid,country_code,granted_by) values(%L,%L,%L)',pg_temp.key(1),'us',pg_temp.key(3)),'23514');
select pg_temp.refused('three-letter country refused',format('insert into public.news_region_leads(m_uid,country_code,granted_by) values(%L,%L,%L)',pg_temp.key(1),'USA',pg_temp.key(3)),'23514');
select pg_temp.refused('numeric country refused',format('insert into public.news_region_leads(m_uid,country_code,granted_by) values(%L,%L,%L)',pg_temp.key(1),'U1',pg_temp.key(3)),'23514');
select pg_temp.refused('missing reviewer refused',format('insert into public.news_region_leads(m_uid,country_code,granted_by) values(%L,%L,null)',pg_temp.key(1),'GB'),'23502');
delete from public.news_region_leads where m_uid=pg_temp.key(1) and country_code='US';
select pg_temp.prove('revocation affects only the selected person and country',
 not exists(select 1 from public.news_region_leads where m_uid=pg_temp.key(1) and country_code='US')
 and exists(select 1 from public.news_region_leads where m_uid=pg_temp.key(1) and country_code='CA')
 and exists(select 1 from public.news_region_leads where m_uid=pg_temp.key(2) and country_code='US'));
reset role;
delete from public.m_people where id=pg_temp.key(1);
select pg_temp.prove('deleting a person cascades only their remaining grants',
 not exists(select 1 from public.news_region_leads where m_uid=pg_temp.key(1))
 and exists(select 1 from public.news_region_leads where m_uid=pg_temp.key(2)));
select count(*) as passed_checks from pg_temp.news_region_lead_checks;
rollback;
