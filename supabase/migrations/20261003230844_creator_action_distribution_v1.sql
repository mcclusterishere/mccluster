-- CREATOR -> DISTRIBUTION -> ACTION V1
-- Production migration: 20261003230844_creator_action_distribution_v1
--
-- Give one piece of content a durable identity across the social publisher,
-- the Action Network, mission enrollment and verified completion. The purpose
-- is attribution: a verified action can be traced back to the exact content
-- item and channel that caused the member to take the mission.

create table public.social_content_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  publisher_m_uid uuid references public.m_people(id) on delete set null,
  publisher_key text not null default 'matthew-mccluster'
    check (publisher_key ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  title text check (title is null or char_length(title) <= 160),
  master_caption text not null default ''
    check (char_length(master_caption) <= 5000),
  source_asset_id uuid references public.media_assets(id) on delete set null,
  action_campaign_id text references public.action_campaigns(id) on delete set null,
  action_mission_id uuid references public.action_missions(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','ready','publishing','published','failed','archived')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.social_content_action_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_campaign text;
begin
  if new.action_mission_id is null then return new; end if;
  select m.campaign_id into v_campaign
  from public.action_missions m
  where m.id = new.action_mission_id;
  if not found then raise exception 'action mission not found'; end if;
  if new.action_campaign_id is null then
    new.action_campaign_id := v_campaign;
  elsif new.action_campaign_id is distinct from v_campaign then
    raise exception 'content campaign does not match mission campaign';
  end if;
  return new;
end;
$$;

create trigger social_content_action_guard_trg
before insert or update of action_campaign_id, action_mission_id
on public.social_content_items
for each row execute function public.social_content_action_guard();

create index social_content_org_created_idx
  on public.social_content_items(org_id, created_at desc);
create index social_content_action_idx
  on public.social_content_items(action_campaign_id, action_mission_id)
  where action_campaign_id is not null or action_mission_id is not null;

alter table public.social_content_items enable row level security;
create policy social_content_items_read on public.social_content_items
  for select to authenticated using (private.is_org_member(org_id));
create policy social_content_items_write on public.social_content_items
  for all to authenticated
  using (private.is_org_owner(org_id))
  with check (private.is_org_owner(org_id));
revoke all on table public.social_content_items from public, anon;
grant select, insert, update, delete on table public.social_content_items to authenticated;

alter table public.social_publish_jobs
  add column content_id uuid references public.social_content_items(id) on delete set null;
alter table public.social_posts
  add column content_id uuid references public.social_content_items(id) on delete set null;
alter table public.network_posts
  add column content_id uuid references public.social_content_items(id) on delete set null;
alter table public.action_mission_assignments
  add column source_content_id uuid references public.social_content_items(id) on delete set null,
  add column source_channel text check (
    source_channel is null or (
      char_length(source_channel) between 1 and 32
      and source_channel ~ '^[a-z0-9][a-z0-9._-]*$'
    )
  );

create index social_publish_jobs_content_idx
  on public.social_publish_jobs(content_id) where content_id is not null;
create index social_posts_content_idx
  on public.social_posts(content_id) where content_id is not null;
create index network_posts_content_idx
  on public.network_posts(content_id) where content_id is not null;
create index action_assignments_source_content_idx
  on public.action_mission_assignments(source_content_id, status)
  where source_content_id is not null;

create or replace function public.join_action_mission_attributed(
  p_mission_id uuid,
  p_content_id uuid default null,
  p_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_assignment_id uuid;
  v_content_mission uuid;
  v_source text := nullif(lower(btrim(coalesce(p_source,''))), '');
begin
  if v_source is not null and (
    char_length(v_source) > 32 or v_source !~ '^[a-z0-9][a-z0-9._-]*$'
  ) then
    raise exception 'invalid action source';
  end if;

  if p_content_id is not null then
    select c.action_mission_id into v_content_mission
    from public.social_content_items c
    where c.id = p_content_id;
    if not found or v_content_mission is distinct from p_mission_id then
      raise exception 'that content does not point to this mission';
    end if;
  end if;

  v_result := public.join_action_mission(p_mission_id);
  v_assignment_id := (v_result->>'assignment_id')::uuid;

  if p_content_id is not null or v_source is not null then
    update public.action_mission_assignments
    set source_content_id = coalesce(source_content_id, p_content_id),
        source_channel = coalesce(source_channel, v_source)
    where id = v_assignment_id
      and user_id = (select auth.uid());
  end if;

  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'source_content_id', p_content_id,
    'source_channel', v_source
  ));
end;
$$;

revoke all on function public.join_action_mission_attributed(uuid,uuid,text)
  from public, anon;
grant execute on function public.join_action_mission_attributed(uuid,uuid,text)
  to authenticated, service_role;

-- Preserve the original mission-completion automation, but add the content
-- attribution to the server-minted event. Members still cannot mint verified
-- completion events themselves.
create or replace function public.action_record_verified_mission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign text;
begin
  if new.status <> 'verified' or old.status = 'verified' then
    return new;
  end if;

  select m.campaign_id into v_campaign
  from public.action_missions m
  where m.id = new.mission_id;

  if v_campaign is null then return new; end if;

  insert into public.action_events(campaign_id,user_id,kind,detail,at)
  values(
    v_campaign,
    new.user_id,
    'mission',
    jsonb_strip_nulls(jsonb_build_object(
      'assignment_id',new.id,
      'mission_id',new.mission_id,
      'source_content_id',new.source_content_id,
      'source_channel',new.source_channel
    )),
    coalesce(new.verified_at,now())
  )
  on conflict do nothing;

  return new;
end;
$$;

-- A content-backed mission card is server-vouched exactly like a verified
-- action card. Free-form post metadata alone can never manufacture one.
create or replace function public.action_offer_cards(p_post_ids uuid[])
returns table(
  post_id uuid,
  content_id uuid,
  mission_id uuid,
  campaign_id text,
  title text,
  description text,
  mission_open boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    c.id,
    m.id,
    m.campaign_id,
    m.title,
    m.description,
    m.status = 'open'
      and (m.starts_at is null or m.starts_at <= now())
      and (m.ends_at is null or m.ends_at > now())
  from public.network_posts p
  join public.social_content_items c
    on c.id = p.content_id
   and c.publisher_m_uid = p.author_m_uid
  join public.action_missions m
    on m.id = c.action_mission_id
  where p.id = any(coalesce(p_post_ids[1:100], '{}'::uuid[]))
    and p.deleted_at is null
    and p.reply_to_id is null
    and c.status <> 'archived';
$$;

revoke all on function public.action_offer_cards(uuid[]) from public, anon;
grant execute on function public.action_offer_cards(uuid[])
  to authenticated, service_role;

-- One owner/operator read for the closed loop:
-- social reach -> mission join -> proof submitted -> verified action.
create or replace function public.social_content_action_stats(p_content_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_out jsonb;
begin
  select c.org_id into v_org
  from public.social_content_items c
  where c.id = p_content_id;

  if v_org is null then raise exception 'content not found'; end if;
  if not private.is_org_member(v_org) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with latest_metrics as (
    select distinct on (s.post_id)
      s.post_id, s.views, s.reach, s.comments, s.shares, s.saves
    from public.social_metric_snapshots s
    join public.social_posts p on p.id = s.post_id
    where p.content_id = p_content_id
    order by s.post_id, s.recorded_at desc
  ),
  action_counts as (
    select
      count(*) filter (where a.status <> 'withdrawn')::int as joined,
      count(*) filter (where a.status = 'submitted')::int as submitted,
      count(*) filter (where a.status = 'verified')::int as verified,
      count(*) filter (where a.status = 'rejected')::int as rejected
    from public.action_mission_assignments a
    where a.source_content_id = p_content_id
  ),
  external as (
    select
      count(*)::int as published_posts,
      coalesce(sum(l.views),0)::bigint as views,
      coalesce(sum(l.reach),0)::bigint as reach,
      coalesce(sum(l.comments),0)::bigint as comments,
      coalesce(sum(l.shares),0)::bigint as shares,
      coalesce(sum(l.saves),0)::bigint as saves
    from public.social_posts p
    left join latest_metrics l on l.post_id = p.id
    where p.content_id = p_content_id
  )
  select jsonb_build_object(
    'content_id', p_content_id,
    'joined', a.joined,
    'submitted', a.submitted,
    'verified', a.verified,
    'rejected', a.rejected,
    'published_posts', e.published_posts,
    'views', e.views,
    'reach', e.reach,
    'comments', e.comments,
    'shares', e.shares,
    'saves', e.saves,
    'network_posts', (
      select count(*) from public.network_posts n
      where n.content_id = p_content_id and n.deleted_at is null
    )
  ) into v_out
  from action_counts a cross join external e;

  return v_out;
end;
$$;

revoke all on function public.social_content_action_stats(uuid) from public, anon;
grant execute on function public.social_content_action_stats(uuid)
  to authenticated, service_role;
