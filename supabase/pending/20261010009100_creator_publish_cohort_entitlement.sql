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
revoke all on function public.creator_publish_site(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.creator_publish_site(uuid,text,text,text,uuid) to service_role;
