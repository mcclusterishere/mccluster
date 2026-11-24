-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- The migration runner owns one transaction for this entire file.
set local lock_timeout = '5s';
do $migration_isolation$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='PENDING_REQUIRES_READ_COMMITTED: recovery must see writes committed before its table lock';
  end if;
end $migration_isolation$;
select pg_advisory_xact_lock(20261124,2);
do $prerequisites$
begin
  if to_regclass('public.creator_site_cohort_grants') is null then raise exception using errcode='55000',message='CREATOR_COHORT_GRANTS_REQUIRED'; end if;
end $prerequisites$;
do $reviewed_functions$
declare expected jsonb; actual record; function_oid oid;
begin
  for expected in select value from jsonb_array_elements('[{"signature":"public.creator_publish_site(uuid,text,text,text)","name":"public.creator_publish_site","hashes":["5a2fc324a7486c483771385c5ecc0a03406bade1e18fe2e2f6990ce3c1c1fc40"],"language":"plpgsql","definer":false,"volatility":"v","search_path":"search_path=public, pg_temp","args":["p_org_id","p_title","p_tagline","p_bio"],"default_count":0,"defaults":"","returns":"text"},{"signature":"public.creator_publish_site(uuid,text,text,text,uuid)","name":"public.creator_publish_site","hashes":["d81b98bbc312d18e47d02911980552cd8235ab01d8e57469a2a8c3e6a47021b5"],"language":"plpgsql","definer":false,"volatility":"v","search_path":"search_path=public, pg_temp","args":["p_org_id","p_title","p_tagline","p_bio","p_user_id"],"default_count":0,"defaults":"","returns":"text","allow_absent":true}]'::jsonb) loop
    function_oid:=to_regprocedure(expected->>'signature');
    if function_oid is null then
      if coalesce((expected->>'allow_absent')::boolean,false) then continue; end if;
      raise exception using errcode='55000',message='PENDING_FUNCTION_CHANGED: missing reviewed function '||(expected->>'signature');
    end if;
    select p.*,l.lanname into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=function_oid;
    if not (expected->'hashes' ? encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex'))
      or actual.lanname<>expected->>'language' or actual.prosecdef is distinct from (expected->>'definer')::boolean
      or actual.provolatile::text<>expected->>'volatility' or actual.proparallel<>'u'
      or actual.proconfig is distinct from array[expected->>'search_path']
      or to_jsonb(coalesce(actual.proargnames,'{}'::text[])) is distinct from expected->'args'
      or actual.pronargdefaults<>(expected->>'default_count')::integer
      or coalesce(pg_get_expr(actual.proargdefaults,0),'')<>expected->>'defaults'
      or actual.prorettype<>(expected->>'returns')::regtype or actual.proretset
      or actual.prokind<>'f' or actual.proisstrict or actual.proleakproof
      or pg_get_userbyid(actual.proowner)<>'postgres' then
      raise exception using errcode='55000',message='PENDING_FUNCTION_CHANGED: reviewed function changed '||(expected->>'signature');
    end if;
  end loop;
  if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='creator_publish_site'
    and oid not in ('public.creator_publish_site(uuid,text,text,text)'::regprocedure,coalesce(to_regprocedure('public.creator_publish_site(uuid,text,text,text,uuid)'),0))) then
    raise exception using errcode='55000',message='PENDING_FUNCTION_CHANGED: unexpected creator publisher overload';
  end if;
end $reviewed_functions$;
-- Staged: deploy only after reviewing the cohort-grants prerequisite migration.
-- The service-only RPC binds the authenticated creator identity supplied by the Worker
-- to either a qualifying subscription or a currently selected cohort grant.
create or replace function public.creator_publish_site(
 p_org_id uuid, p_title text, p_tagline text, p_bio text, p_user_id uuid
) returns text
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare v_slug text;
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 if p_user_id is null or p_org_id is null then raise exception 'creator identity required'; end if;
 if not (
  exists (
   select 1 from public.creator_billing_subscriptions s
   where s.org_id=p_org_id and s.owner_user_id=p_user_id
     and s.status='active' and s.current_period_end>now()
  )
  or exists (
   select 1 from public.creator_site_cohort_grants g
   join public.action_cohorts c on c.id=g.cohort_id and c.status='active'
   join public.action_cohort_members m on m.cohort_id=g.cohort_id
   join public.m_auth_user_links l on l.m_uid=m.m_uid
   where g.org_id=p_org_id and g.creator_user_id=p_user_id
     and g.revoked_at is null and l.auth_user_id=p_user_id
  )
 ) then
  raise exception 'creator publishing entitlement required';
 end if;
 if char_length(p_title) not between 1 and 120
    or char_length(coalesce(p_tagline,''))>300
    or char_length(coalesce(p_bio,''))>4000 then
  raise exception 'invalid site content';
 end if;
 v_slug:='site-'||replace(p_org_id::text,'-','');
 insert into public.creator_published_sites(org_id,slug,title,tagline,bio)
 values(p_org_id,v_slug,p_title,coalesce(p_tagline,''),coalesce(p_bio,''))
 on conflict(org_id) do update set title=excluded.title,tagline=excluded.tagline,
 bio=excluded.bio,updated_at=now()
 returning slug into v_slug;
 return v_slug;
end $function$;
-- Keep the old four-argument RPC temporarily for zero-downtime rollout.
-- It continues to require a paid subscription; the new five-argument RPC
-- enforces creator identity and cohort eligibility. Remove the old RPC in
-- a later migration after all deployed Workers use the new signature.
-- Revoke inherited client grants on both overloads in the same promotion.
revoke all on function public.creator_publish_site(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.creator_publish_site(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.creator_publish_site(uuid,text,text,text,uuid) to service_role;
