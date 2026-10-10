-- Gap 5: server-derived creator lifecycle milestones. STAGED; no production deployment.
-- Never accept client-claimed publication, earnings, or contribution.
create table if not exists public.creator_lifecycle_events (
 id bigint generated always as identity primary key,
 creator_user_id uuid not null references auth.users(id) on delete cascade,
 org_id uuid references public.orgs(id) on delete set null,
 event_key text not null unique,
 event_type text not null check(event_type in ('site_published','site_updated')),
 occurred_at timestamptz not null default now(),
 source text not null default 'database_trigger' check(source='database_trigger')
);
create index if not exists creator_lifecycle_creator_time_idx
 on public.creator_lifecycle_events(creator_user_id,occurred_at desc);
alter table public.creator_lifecycle_events enable row level security;
alter table public.creator_lifecycle_events force row level security;
revoke all on public.creator_lifecycle_events from anon,authenticated;
-- Existing creator_publish_site RPC is server-only. The trigger derives ownership
-- from the current active subscription, not from arbitrary request payloads.
create or replace function public.creator_lifecycle_from_site()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_owner_count integer;
begin
 select count(distinct owner_user_id),min(owner_user_id) into v_owner_count,v_owner
 from public.creator_billing_subscriptions
 where org_id=new.org_id and status='active' and current_period_end>now();
 -- A cohort-granted creator can publish without a subscription. Only accept
 -- a single currently active, unrevoked grant with actual M-account membership.
 if v_owner_count=0 then
  select count(distinct g.creator_user_id),min(g.creator_user_id)
    into v_owner_count,v_owner
  from public.creator_site_cohort_grants g
  join public.action_cohorts c on c.id=g.cohort_id and c.status='active'
  join public.action_cohort_members m on m.cohort_id=g.cohort_id
  join public.m_auth_user_links l on l.m_uid=m.m_uid
   and l.auth_user_id=g.creator_user_id
  where g.org_id=new.org_id and g.revoked_at is null;
 end if;
 if v_owner_count<>1 or v_owner is null then
  raise exception 'Creator publication requires exactly one attributable eligible owner';
 end if;
 if tg_op='UPDATE' and new.title is not distinct from old.title
  and new.tagline is not distinct from old.tagline
  and new.bio is not distinct from old.bio then return new; end if;
 insert into public.creator_lifecycle_events(creator_user_id,org_id,event_key,event_type)
 values(v_owner,new.org_id,
  'creator-site:'||new.org_id::text||':'||gen_random_uuid()::text,
  case when tg_op='INSERT' then 'site_published' else 'site_updated' end)
 on conflict(event_key) do nothing;
 return new;
end $$;
revoke all on function public.creator_lifecycle_from_site() from public,anon,authenticated;
drop trigger if exists creator_site_lifecycle_event on public.creator_published_sites;
create trigger creator_site_lifecycle_event after insert or update on public.creator_published_sites
for each row execute function public.creator_lifecycle_from_site();
-- Read-only aggregate is service-role only. Recruitment source and costs
-- remain unavailable until verified attribution and expense pipelines exist.
create or replace view public.creator_lifecycle_summary
with (security_invoker=true) as
select creator_user_id,min(occurred_at) filter(where event_type='site_published') first_site_published_at,
 count(*) filter(where event_type='site_updated') site_update_events,
 max(occurred_at) last_activity_at
from public.creator_lifecycle_events group by creator_user_id;
revoke all on public.creator_lifecycle_summary from public,anon,authenticated;
grant select on public.creator_lifecycle_summary to service_role;
