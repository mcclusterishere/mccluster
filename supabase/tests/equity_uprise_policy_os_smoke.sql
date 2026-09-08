-- Run against a disposable Supabase branch after all Policy OS migrations.
-- Assertions are transactional and leave no application data behind.
begin;

do $test$
declare
  t text;
  f text;
  missing text[] := '{}';
begin
  foreach t in array array[
    'eu_initiatives','eu_stakeholders','eu_stakeholder_links','eu_communications','eu_events',
    'eu_fellowship_applications','eu_interview_requests','eu_research_projects','eu_sources','eu_claims',
    'eu_manuscripts','eu_publications','eu_deliveries','eu_jobs','eu_monitors','eu_oauth_connections',
    'eu_government_submissions','eu_releases','eu_ddex_messages'
  ] loop
    if to_regclass('public.'||t) is null then missing:=array_append(missing,t); end if;
  end loop;
  if cardinality(missing)>0 then raise exception 'missing Policy OS tables: %',missing; end if;

  foreach f in array array[
    'public.eu_claim_jobs_service(text,integer,integer)',
    'public.eu_claim_external_jobs_service(text,integer,integer)',
    'public.eu_claim_ddex_jobs_service(text,integer,integer)',
    'public.eu_claim_monitors_service(integer)',
    'public.eu_next_publication_id_service(uuid,text)',
    'public.eu_runtime_configure_service(uuid,text,text,text)',
    'public.eu_cron_install_service()'
  ] loop
    if to_regprocedure(f) is null then raise exception 'missing Policy OS function: %',f; end if;
  end loop;
end;$test$;

do $test$
declare n integer;
begin
  select count(*) into n from public.control_capabilities where capability in (
    'policy.read','policy.write','research.read','research.write','research.review',
    'publication.publish','publication.distribute','government.submit','calendar.schedule','integration.manage','music.deliver'
  );
  if n<>11 then raise exception 'expected 11 Policy OS capabilities, found %',n; end if;
  if exists(select 1 from public.control_capabilities where capability in ('publication.publish','publication.distribute','government.submit','calendar.schedule','integration.manage','music.deliver') and risk<>'high') then
    raise exception 'irreversible Policy OS capabilities must remain high risk';
  end if;
end;$test$;

do $test$
declare bad integer;
begin
  select count(*) into bad from information_schema.role_table_grants
   where table_schema='public' and grantee in ('anon','authenticated')
     and table_name in ('eu_stakeholders','eu_communications','eu_events','eu_fellowship_applications','eu_interview_requests','eu_oauth_connections')
     and privilege_type in ('INSERT','UPDATE','DELETE');
  if bad<>0 then raise exception 'client role has forbidden Policy OS mutation grants: %',bad; end if;
end;$test$;

do $test$
declare n integer;
begin
  select count(*) into n from pg_policies where schemaname='public' and tablename='eu_initiatives' and policyname='eu_initiatives_public_read';
  if n<>1 then raise exception 'public initiative read policy missing'; end if;
  select count(*) into n from pg_policies where schemaname='public' and tablename='eu_events' and cmd in ('UPDATE','DELETE','ALL');
  if n<>0 then raise exception 'event ledger must not have update/delete/all client policy'; end if;
end;$test$;

do $test$
declare house uuid; app_count integer; target_count integer;
begin
  select id into house from public.orgs where slug='mccluster';
  if house is null then raise exception 'mccluster org missing'; end if;
  select count(*) into app_count from public.platform_apps where app_key='equity-uprise-web';
  if app_count<>1 then raise exception 'equity-uprise-web platform app missing'; end if;
  select count(*) into target_count from public.eu_distribution_targets where org_id=house and provider in ('equity-uprise','crossref','orcid','zenodo','osf','ssrn','regulations-gov','linkedin','tiktok','youtube','ddex');
  if target_count<>11 then raise exception 'expected 11 seeded distribution targets, found %',target_count; end if;
  if exists(select 1 from public.eu_distribution_targets where org_id=house and enabled=true) then raise exception 'external distribution targets must ship disabled before credential verification'; end if;
end;$test$;

rollback;
