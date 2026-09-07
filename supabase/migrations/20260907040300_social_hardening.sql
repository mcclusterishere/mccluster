-- Harden the client social control plane without changing provider behavior.
-- 1) lease external publish side effects so overlapping cron runs cannot process the same job;
-- 2) make insight refresh a fair due-work queue instead of repeatedly selecting the newest posts.

alter table public.social_publish_jobs
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz;

create index if not exists social_publish_jobs_lease_due_idx
  on public.social_publish_jobs (state, scheduled_at, lease_expires_at);

alter table public.social_posts
  add column if not exists last_insights_synced_at timestamptz,
  add column if not exists next_insights_sync_at timestamptz;

update public.social_posts
   set next_insights_sync_at = coalesce(next_insights_sync_at, now())
 where next_insights_sync_at is null;

alter table public.social_posts
  alter column next_insights_sync_at set default now(),
  alter column next_insights_sync_at set not null;

create index if not exists social_posts_insights_due_idx
  on public.social_posts (next_insights_sync_at, published_at)
  where external_media_id is not null;

create or replace function public.claim_social_publish_jobs(
  p_lease_owner text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.social_publish_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(p_lease_owner), '') is null then
    raise exception 'p_lease_owner is required';
  end if;

  return query
  with candidates as (
    select j.id
      from public.social_publish_jobs j
     where j.state in ('queued', 'processing')
       and j.scheduled_at <= now()
       and (j.lease_expires_at is null or j.lease_expires_at <= now())
     order by j.scheduled_at asc, j.created_at asc
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 10), 25))
  )
  update public.social_publish_jobs j
     set lease_owner = p_lease_owner,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 600))),
         updated_at = now()
    from candidates c
   where j.id = c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_social_publish_jobs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_social_publish_jobs(text, integer, integer)
  to service_role;

comment on function public.claim_social_publish_jobs(text, integer, integer) is
  'Atomically leases due queued/processing social publish jobs using row locks and SKIP LOCKED so overlapping schedulers cannot execute the same external Meta phase concurrently.';

create or replace function public.claim_social_insight_posts(
  p_limit integer default 25
)
returns setof public.social_posts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select p.id
      from public.social_posts p
     where p.external_media_id is not null
       and p.published_at >= now() - interval '7 days'
       and p.next_insights_sync_at <= now()
     order by p.next_insights_sync_at asc, p.published_at asc, p.created_at asc
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.social_posts p
     set next_insights_sync_at = now() + interval '5 minutes',
         updated_at = now()
    from candidates c
   where p.id = c.id
  returning p.*;
end;
$$;

revoke all on function public.claim_social_insight_posts(integer)
  from public, anon, authenticated;
grant execute on function public.claim_social_insight_posts(integer)
  to service_role;

comment on function public.claim_social_insight_posts(integer) is
  'Claims the oldest due recent social posts for insight refresh. Advancing next_insights_sync_at inside the same transaction prevents duplicate refreshes and guarantees rotation across clients when capacity is sufficient.';
